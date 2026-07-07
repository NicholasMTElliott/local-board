import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { gitOutput } from "./git.js";

// Mutual-exclusion primitive for the read-modify-write windows that atomic
// single-file writes (writeTicketFile's write-temp-then-rename) do not cover:
// two concurrent processes can each read the same pre-mutation state, then
// each overwrite the other's write. `withFileLock` serializes the whole RMW
// span around `fn`, not just the final write.
//
// `mkdir(lockPath)` (non-recursive) is atomic on both POSIX and Windows and
// fails EEXIST when the directory already exists -- no open file descriptor
// to leak on crash, no Windows EPERM-on-open quirk that a `wx` lockfile can
// hit. Release is a best-effort `rm(lockPath, { recursive: true, force: true
// })`; Windows can throw transient EPERM/EBUSY on removal (AV, indexer), so
// release retries with the same bounded backoff `renameWithRetry` uses.

const DEFAULT_RETRY_BUDGET_MS = 2000;
const INITIAL_RETRY_DELAY_MS = 10;
const DEFAULT_STALE_MS = 30_000;
const RM_RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RM_RETRY_DELAYS_MS = [10, 20, 40, 80];
const META_FILE = "meta";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rmWithRetry(dirPath) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rm(dirPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!RM_RETRY_CODES.has(error.code) || attempt >= RM_RETRY_DELAYS_MS.length) {
        throw error;
      }
      await delay(RM_RETRY_DELAYS_MS[attempt]);
    }
  }
}

async function tryAcquire(lockPath) {
  try {
    await mkdir(lockPath);
    return true;
  } catch (error) {
    if (error.code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

async function writeMeta(lockPath) {
  const meta = { pid: process.pid, ts: new Date().toISOString(), hostname: os.hostname() };
  // Best-effort: a failure here does not affect mutual exclusion, only the
  // diagnostic quality of a later stale-break or "lock held by" error.
  await writeFile(path.join(lockPath, META_FILE), JSON.stringify(meta), "utf8").catch(() => {});
}

async function readMeta(lockPath) {
  try {
    const raw = await readFile(path.join(lockPath, META_FILE), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Age in ms of the lock's meta timestamp. A missing/corrupt meta file is
// treated as infinitely old (safe to break) rather than blocking forever on a
// lock whose diagnostic metadata failed to write.
async function lockAgeMs(lockPath, now) {
  const meta = await readMeta(lockPath);
  if (meta === null) {
    return Number.POSITIVE_INFINITY;
  }
  const ts = Date.parse(meta.ts);
  return Number.isNaN(ts) ? Number.POSITIVE_INFINITY : now - ts;
}

function describeHolder(meta) {
  if (meta === null) {
    return "unknown holder (no meta)";
  }
  return `pid ${meta.pid} on ${meta.hostname} since ${meta.ts}`;
}

// Acquire `lockPath`, retrying on EEXIST with exponential backoff (10ms,
// 20ms, 40ms, ... ) up to a total budget (~2s by default). On exhaustion,
// check the held lock's age: if older than `staleMs`, break it (rm) and
// re-acquire once (a crashed/killed holder never released); otherwise throw a
// clear, path-carrying error naming the holder. Age-based only: cross-
// worktree/cross-host pid-liveness checks are unreliable, so a generous
// `staleMs` is the mitigation for the small risk of breaking a legitimately
// slow holder.
async function acquireLock(lockPath, options = {}) {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const retryBudgetMs = options.retryBudgetMs ?? DEFAULT_RETRY_BUDGET_MS;

  await mkdir(path.dirname(lockPath), { recursive: true });

  let waited = 0;
  let nextDelay = INITIAL_RETRY_DELAY_MS;
  while (true) {
    if (await tryAcquire(lockPath)) {
      await writeMeta(lockPath);
      return;
    }
    if (waited >= retryBudgetMs) {
      break;
    }
    const thisDelay = Math.min(nextDelay, retryBudgetMs - waited);
    await delay(thisDelay);
    waited += thisDelay;
    nextDelay *= 2;
  }

  const age = await lockAgeMs(lockPath, Date.now());
  if (age > staleMs) {
    const meta = await readMeta(lockPath);
    if (typeof options.onStaleBreak === "function") {
      options.onStaleBreak({ lockPath, ageMs: age, meta });
    } else {
      process.stderr.write(
        `local-board: breaking stale lock ${lockPath} (held by ${describeHolder(meta)}, age ${Math.round(age)}ms > staleMs ${staleMs}ms)\n`,
      );
    }
    await rmWithRetry(lockPath).catch(() => {});
    if (await tryAcquire(lockPath)) {
      await writeMeta(lockPath);
      return;
    }
    throw new Error(`lock ${lockPath} was re-acquired by another process immediately after a stale-break; try again`);
  }

  const meta = await readMeta(lockPath);
  throw new Error(`lock ${lockPath} is held by ${describeHolder(meta)}; give up after ${retryBudgetMs}ms of retries`);
}

// Run `fn` (sync or async) while holding the mkdir-sentinel lock at
// `lockPath`, releasing it (best-effort) whether `fn` resolves or throws.
export async function withFileLock(lockPath, fn, options = {}) {
  await acquireLock(lockPath, options);
  try {
    return await fn();
  } finally {
    await rmWithRetry(lockPath).catch(() => {});
  }
}

// Resolves the shared anchor directory for locks and the active-steps
// ledger: the main worktree root, common to every linked worktree of the same
// repo. Mirrors active-steps.js's ledger anchor exactly (same git-common-dir
// resolution) so mainline and every worktree of the same ticket contend on
// the same lock path. Falls back to the passed root when git resolution
// fails (non-git directories, e.g. test fixtures).
export async function resolveMainRoot(root) {
  try {
    const commonDir = await gitOutput(root, ["rev-parse", "--git-common-dir"]);
    const absoluteCommonDir = path.resolve(root, commonDir);
    return path.dirname(absoluteCommonDir);
  } catch {
    return path.resolve(root);
  }
}

export async function ticketLockPath(root, ticketId) {
  const mainRoot = await resolveMainRoot(root);
  return path.join(mainRoot, ".local-board", "locks", `${ticketId}.lock`);
}

// Locks the read-modify-write span of a single-ticket mutation. Anchored at
// the main root (see resolveMainRoot) so the mainline checkout and every
// worktree of the same ticket serialize against one shared lock namespace.
export async function withTicketLock(root, ticketId, fn, options = {}) {
  const lockPath = await ticketLockPath(root, ticketId);
  return withFileLock(lockPath, fn, options);
}

// Locks a two-ticket mutation (linkParent/unlinkParent/blockTicket/
// unblockTicket, each of which reads-then-writes two ticket files) by
// acquiring both ticket locks in sorted-id order. Sorted-order acquisition is
// what makes concurrent dual-lock mutations deadlock-free: two callers
// contending on the same pair of tickets, regardless of which argument order
// they pass them in, always try to take the smaller id's lock first, so they
// serialize instead of each holding one lock and waiting on the other's.
export async function withOrderedTicketLocks(root, ticketIdA, ticketIdB, fn, options = {}) {
  if (ticketIdA === ticketIdB) {
    return withTicketLock(root, ticketIdA, fn, options);
  }
  const [first, second] = [ticketIdA, ticketIdB].sort();
  return withTicketLock(root, first, () => withTicketLock(root, second, fn, options), options);
}
