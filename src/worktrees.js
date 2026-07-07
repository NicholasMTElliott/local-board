import { mkdir, access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { discover, findTicket, setTicketField } from "./tickets.js";
import { loadConfig } from "./config.js";
import {
  assertBranchName,
  currentBranch,
  gitOk,
  gitOutput,
  gitRawOutput,
  gitRun,
  resolveDefaultBranch,
  ticketBranchName,
} from "./git.js";

export async function addTicketWorktree(root, ticketId) {
  const repoRoot = await gitOutput(root, ["rev-parse", "--show-toplevel"]);
  const { ticket } = await findTicket(repoRoot, ticketId);
  const branch = ticketBranchName(ticket);
  await assertBranchName(repoRoot, branch);

  const config = await loadConfig(repoRoot);
  const location = config.worktrees.location;
  const worktreesRoot = worktreesRootFor(repoRoot, location);
  const worktreePath = path.join(worktreesRoot, ticketId);
  const existing = await findRegisteredWorktree(repoRoot, worktreePath);
  if (existing !== null) {
    if (existing.branch !== branch) {
      throw new Error(
        `worktree for ${ticketId} already exists at ${displayPath(worktreePath)} on branch ${existing.branch ?? "(detached)"}; expected ${branch}`,
      );
    }
    if (ticket.frontMatter.branch !== branch) {
      await setTicketField(worktreePath, ticketId, "branch", branch);
    }
    return worktreeAddRecord(ticketId, branch, worktreePath, false);
  }

  if (await pathExists(worktreePath)) {
    throw new Error(`${displayPath(worktreePath)} exists but is not a registered git worktree`);
  }

  await mkdir(path.dirname(worktreePath), { recursive: true });
  if (isChildPath(repoRoot, worktreesRoot)) {
    await ensureWorktreeIgnore(repoRoot, worktreesRoot);
  }
  if (ticket.frontMatter.branch === null) {
    await gitRun(repoRoot, ["worktree", "add", "-b", branch, worktreePath]);
    await setTicketField(worktreePath, ticketId, "branch", branch);
    await commitBranchStamp(worktreePath, ticketId, branch);
  } else {
    await gitRun(repoRoot, ["worktree", "add", worktreePath, branch]);
  }

  return worktreeAddRecord(ticketId, branch, worktreePath, true);
}

// Idempotently appends the repo-relative worktrees-root ignore entry to
// <repoRoot>/.gitignore when absent. Append-only; never rewrites or reorders
// existing lines. Does not commit the edit — that is left to the
// user/orchestrator so worktree-add never produces a surprise commit.
//
// Called for ANY resolved worktrees root that lives inside the repo (the
// "inside" layout and any explicit in-repo location), not just the literal
// "inside" constant, so a custom in-repo location gets the same protection
// against dirtying the parent checkout with untracked nested worktree
// contents.
async function ensureWorktreeIgnore(repoRoot, worktreesRoot) {
  const relative = path.relative(path.resolve(repoRoot), path.resolve(worktreesRoot)).split(path.sep).join("/");
  const entry = `${relative}/`;

  const gitignorePath = path.join(repoRoot, ".gitignore");
  let current = "";
  try {
    current = await readFile(gitignorePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const lines = current.length === 0 ? [] : current.split(/\r?\n/);
  if (lines.some((line) => line.trim() === entry)) {
    return;
  }

  const needsNewlineBefore = current.length > 0 && !current.endsWith("\n");
  const prefix = needsNewlineBefore ? "\n" : "";
  await writeFile(gitignorePath, `${current}${prefix}${entry}\n`, "utf8");
}

async function commitBranchStamp(worktreePath, ticketId, branch) {
  await gitRun(worktreePath, ["add", "plans"]);
  if (await gitOk(worktreePath, ["diff", "--cached", "--quiet"])) {
    return;
  }
  await gitRun(worktreePath, ["commit", "-m", `local-board: stamp branch ${branch} on ${ticketId}`]);
}

export async function removeTicketWorktree(root, ticketId, options = {}) {
  const repoRoot = await gitOutput(root, ["rev-parse", "--show-toplevel"]);
  await findTicket(repoRoot, ticketId);
  const config = await loadConfig(repoRoot);
  const worktreePath = ticketWorktreePath(repoRoot, ticketId, config.worktrees.location);
  const existing = await findRegisteredWorktree(repoRoot, worktreePath);
  if (existing === null) {
    return {
      ticketId,
      worktreePath: displayPath(worktreePath),
      removed: false,
    };
  }

  await gitRun(repoRoot, ["worktree", "remove", ...(options.force ? ["--force"] : []), worktreePath]);
  return {
    ticketId,
    worktreePath: displayPath(worktreePath),
    removed: true,
  };
}

export async function listTicketWorktrees(root) {
  const repoRoot = await gitOutput(root, ["rev-parse", "--show-toplevel"]);
  const config = await loadConfig(repoRoot);
  const worktreesRoot = worktreesRootFor(repoRoot, config.worktrees.location);
  if (!(await pathExists(worktreesRoot))) {
    return [];
  }

  const board = await discover(repoRoot);
  if (board.loadErrors.length > 0) {
    throw new Error(board.loadErrors.join("\n"));
  }
  const knownTicketIds = new Set(board.tickets.map((ticket) => ticket.id));

  const records = await listRegisteredWorktrees(repoRoot);
  return records
    .filter((record) => isChildPath(worktreesRoot, record.worktreePath))
    .map((record) => ({ record, ticketId: path.basename(record.worktreePath) }))
    .filter(({ ticketId }) => knownTicketIds.has(ticketId))
    .sort((left, right) => left.ticketId.localeCompare(right.ticketId))
    .map(({ record, ticketId }) => ({
      ticketId,
      branch: record.branch,
      worktreePath: displayPath(record.worktreePath),
      locked: record.locked,
    }));
}

export async function fastForwardDefaultBranch(root, options = {}) {
  const defaultBranch = await resolveDefaultBranch(root, options.defaultBranch ?? null);
  const current = await currentBranch(root);
  if (current !== defaultBranch) {
    throw new Error(`on branch ${current}; switch to ${defaultBranch} before fast-forwarding`);
  }

  const newHead = await gitOutput(root, ["rev-parse", "HEAD"]);
  const previousHead = await cleanCheckoutHead(root, defaultBranch, newHead);

  await gitRun(root, ["reset", "--hard", "HEAD"]);
  return {
    defaultBranch,
    previousHead,
    newHead,
    advanced: previousHead !== newHead,
  };
}

// Pure placement resolver, given the resolved location string. "sibling" and
// "inside" are fixed layouts; any other non-empty string is an explicit path
// (absolute as-is, relative resolved against repoRoot). Explicit paths resolving
// inside <repoRoot>/plans are rejected — that placement would make ticket
// discovery walk the nested checkout's plans/tickets and double-count tickets.
export function worktreesRootFor(repoRoot, location) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  if (location === "sibling") {
    return path.join(path.dirname(resolvedRepoRoot), `${path.basename(resolvedRepoRoot)}-worktrees`);
  }
  if (location === "inside") {
    return path.join(resolvedRepoRoot, ".worktrees");
  }

  const resolved = path.isAbsolute(location)
    ? path.resolve(location)
    : path.resolve(resolvedRepoRoot, location);
  const plansRoot = path.join(resolvedRepoRoot, "plans");
  if (resolved === path.resolve(plansRoot) || isChildPath(plansRoot, resolved)) {
    throw new Error(
      `worktrees.location "${location}" resolves inside plans/ (${displayPath(plansRoot)}); choose a location outside plans/`,
    );
  }
  return resolved;
}

// Thin back-compat wrapper defaulting to the "sibling" layout. Kept so any
// external caller that only passes repoRoot keeps working unchanged; real call
// sites in this module route through the config-aware worktreesRootFor.
export function ticketWorktreesRoot(repoRoot) {
  return worktreesRootFor(repoRoot, "sibling");
}

export function ticketWorktreePath(repoRoot, ticketId, location = "sibling") {
  return path.join(worktreesRootFor(repoRoot, location), ticketId);
}

export async function ticketWorktreeMintOffsetMinutes(root) {
  let records;
  try {
    records = await listRegisteredWorktrees(root);
  } catch {
    return 0;
  }
  if (records.length === 0) {
    return 0;
  }

  const mainRoot = records[0].worktreePath;
  let worktreesRoot;
  try {
    const location = (await loadConfig(mainRoot)).worktrees.location;
    worktreesRoot = worktreesRootFor(mainRoot, location);
  } catch {
    // Config-load or resolution failure degrades safely to the sibling default;
    // this hot path must never block ticket creation.
    worktreesRoot = worktreesRootFor(mainRoot, "sibling");
  }
  const ticketIds = records
    .filter((record) => isChildPath(worktreesRoot, record.worktreePath))
    .map((record) => path.basename(record.worktreePath))
    .sort();

  if (ticketIds.length === 0) {
    return 0;
  }

  let topLevel;
  try {
    topLevel = path.resolve(await gitOutput(root, ["rev-parse", "--show-toplevel"]));
  } catch {
    return 0;
  }

  const index = ticketIds.indexOf(path.basename(topLevel));
  return index < 0 ? 0 : index;
}

async function cleanCheckoutHead(root, branch, newHead) {
  if (!(await gitOk(root, ["diff-files", "--quiet", "--"]))) {
    throw new Error("fast-forward requires a clean working tree; commit or stash changes first");
  }

  const untracked = await gitRawOutput(root, ["ls-files", "--others", "--exclude-standard"]);
  if (untracked.trim() !== "") {
    throw new Error("fast-forward requires a clean working tree; commit or stash changes first");
  }

  const candidates = await reflogCandidates(root, branch, newHead);
  for (const candidate of candidates) {
    if (await gitOk(root, ["diff-index", "--cached", "--quiet", candidate, "--"])) {
      return candidate;
    }
  }

  throw new Error("fast-forward requires a clean working tree; commit or stash changes first");
}

async function reflogCandidates(root, branch, newHead) {
  const seen = new Set();
  const candidates = [];
  const add = (value) => {
    if (value !== "" && !seen.has(value)) {
      seen.add(value);
      candidates.push(value);
    }
  };

  add(newHead);
  try {
    const reflog = await gitRawOutput(root, ["reflog", "--format=%H", "-n", "25", branch]);
    for (const line of reflog.split(/\r?\n/)) {
      add(line.trim());
    }
  } catch {
    // A missing reflog should not prevent the ordinary no-op case above.
  }
  return candidates;
}

async function findRegisteredWorktree(root, worktreePath) {
  const target = path.resolve(worktreePath);
  const records = await listRegisteredWorktrees(root);
  return records.find((record) => path.resolve(record.worktreePath) === target) ?? null;
}

async function listRegisteredWorktrees(root) {
  const output = await gitRawOutput(root, ["worktree", "list", "--porcelain"]);
  return output
    .split(/\r?\n\r?\n/)
    .map((block) => parseWorktreeBlock(block))
    .filter((record) => record !== null);
}

function parseWorktreeBlock(block) {
  const lines = block.split(/\r?\n/).filter((line) => line !== "");
  if (lines.length === 0) {
    return null;
  }

  const record = {
    worktreePath: null,
    branch: null,
    locked: false,
  };

  for (const line of lines) {
    if (line.startsWith("worktree ")) {
      record.worktreePath = path.resolve(line.slice("worktree ".length));
    } else if (line.startsWith("branch ")) {
      const branch = line.slice("branch ".length);
      record.branch = branch.startsWith("refs/heads/") ? branch.slice("refs/heads/".length) : branch;
    } else if (line === "locked" || line.startsWith("locked ")) {
      record.locked = true;
    }
  }

  return record.worktreePath === null ? null : record;
}

function worktreeAddRecord(ticketId, branch, worktreePath, created) {
  return {
    ticketId,
    branch,
    worktreePath: displayPath(worktreePath),
    created,
  };
}

function isChildPath(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function displayPath(value) {
  return path.resolve(value).replace(/\\/g, "/");
}
