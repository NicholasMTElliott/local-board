import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { resolveMainRoot, withFileLock } from "./lock.js";
import { modelSatisfies, resolveExpectedStep, writeTicketFile } from "./tickets.js";
import { resolveTicketWorktreeRoot } from "./worktrees.js";

const CLAUDE_SUBAGENT_PREFIX = "claude-subagent:";

export async function ledgerPath(root) {
  const mainRoot = await resolveMainRoot(root);
  return path.join(mainRoot, ".local-board", "active-steps.json");
}

// Strict read: missing file reads as an empty ledger, but an unparseable file
// throws a clear, path-carrying error. Used by `checkDispatch` (a query the
// hook depends on to make a real decision) and exposed for tests/tools that
// want corruption to surface loudly rather than silently disappear.
export async function readActiveSteps(root) {
  const filePath = await ledgerPath(root);
  return readLedgerStrict(filePath);
}

async function readLedgerStrict(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`active-steps ledger at ${filePath} is corrupt (invalid JSON): ${error.message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`active-steps ledger at ${filePath} is corrupt: expected a JSON object at the top level`);
  }
  return parsed;
}

// Self-healing read for the write paths (`stampActiveStep`/`clearActiveStep`):
// a corrupt or unreadable ledger is treated as empty rather than blocking the
// ticket workflow. The next successful write overwrites it with valid JSON.
async function readLedgerSelfHeal(filePath) {
  try {
    return await readLedgerStrict(filePath);
  } catch {
    return {};
  }
}

async function writeLedgerAtomic(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeTicketFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

// Unconditionally (re)stamps this ticket's active-step record. Idempotent: a
// re-`begin-step` for the same ticket simply overwrites its own key, so a
// stale entry self-heals. Not best-effort by design -- a failure here is a
// real filesystem problem and should surface to the caller.
//
// Locked read-modify-write: many tickets share this one ledger file, so two
// concurrent stamps/clears (for the same or different tickets) racing the
// read->write window is a classic lost update -- the atomic rename alone only
// prevents torn writes, not a stale overwrite. `options.__afterRead` is a
// test-only hook invoked after the read, before the write, to deterministically
// force an overlapping second call into the retry window.
export async function stampActiveStep(root, ticketId, record, options = {}) {
  const filePath = await ledgerPath(root);
  return withFileLock(
    `${filePath}.lock`,
    async () => {
      const current = await readLedgerSelfHeal(filePath);
      if (options.__afterRead) {
        await options.__afterRead();
      }
      current[ticketId] = record;
      await writeLedgerAtomic(filePath, current);
    },
    options.lock,
  );
}

// Best-effort, idempotent clear: a missing key (no prior `begin-step`, or an
// already-cleared entry) is a no-op, not an error.
export async function clearActiveStep(root, ticketId, options = {}) {
  const filePath = await ledgerPath(root);
  return withFileLock(
    `${filePath}.lock`,
    async () => {
      const current = await readLedgerSelfHeal(filePath);
      if (!Object.hasOwn(current, ticketId)) {
        return;
      }
      if (options.__afterRead) {
        await options.__afterRead();
      }
      const next = { ...current };
      delete next[ticketId];
      await writeLedgerAtomic(filePath, next);
    },
    options.lock,
  );
}

function bareRoute(route) {
  return typeof route === "string" && route.startsWith(CLAUDE_SUBAGENT_PREFIX)
    ? route.slice(CLAUDE_SUBAGENT_PREFIX.length)
    : route;
}

// Core verdict resolver for `local-board check-dispatch`. Never stamps or
// clears the ledger -- read-only. Returns `{ code, body }`: `code` is the
// process exit code (0 allow, 1 deny, 2 error) and `body` is the JSON verdict
// to print to stdout, matching `{ ok, reason, expected?, ticket? }`.
export async function checkDispatch(root, { agent, model, ticketId } = {}) {
  if (!agent.startsWith("local-board-")) {
    return { code: 0, body: { ok: true, reason: "not-local-board-agent" } };
  }

  if (typeof ticketId === "string" && ticketId.trim() !== "") {
    return checkDispatchForTicket(root, agent, model, ticketId);
  }
  return checkDispatchByScan(root, agent, model);
}

async function checkDispatchForTicket(root, agent, model, ticketId) {
  const steps = await readActiveSteps(root);
  const record = steps[ticketId];

  let expectedRoute;
  let expectedModel;
  if (record !== undefined) {
    expectedRoute = record.route;
    expectedModel = record.model ?? null;
  } else {
    // No ledger record: fall back to the ticket's configured action. Resolve
    // against the ticket's registered worktree (if any) rather than `root`
    // unchanged -- a hook invocation typically runs from the shared main
    // checkout, whose copy of the ticket file can be stale once a worktree
    // has advanced the ticket's status locally. `resolveTicketWorktreeRoot`
    // is itself fail-safe (never throws, returns `null` on any error or when
    // no worktree is registered), so this can only ever narrow `root` to a
    // more accurate path -- never break the existing single-ticket/solo-board
    // behaviour.
    const worktreeRoot = await resolveTicketWorktreeRoot(root, ticketId);
    const resolveRoot = worktreeRoot ?? root;
    let resolved;
    try {
      resolved = await resolveExpectedStep(resolveRoot, ticketId);
    } catch {
      return { code: 2, body: { ok: false, reason: "ticket-not-found", ticket: ticketId } };
    }
    expectedRoute = resolved.route;
    expectedModel = resolved.model ?? null;
  }

  const expected = { agent: bareRoute(expectedRoute), model: expectedModel };

  if (expected.agent !== agent) {
    return { code: 1, body: { ok: false, reason: "agent-mismatch", expected, ticket: ticketId } };
  }

  if (expected.model === null) {
    return { code: 0, body: { ok: true, reason: "match", expected, ticket: ticketId } };
  }

  if (model === undefined) {
    return { code: 0, body: { ok: true, reason: "model-unverifiable", expected, ticket: ticketId } };
  }

  if (!modelSatisfies(expected.model, model)) {
    return { code: 1, body: { ok: false, reason: "model-mismatch", expected, ticket: ticketId } };
  }

  return { code: 0, body: { ok: true, reason: "match", expected, ticket: ticketId } };
}

async function checkDispatchByScan(root, agent, model) {
  const steps = await readActiveSteps(root);
  for (const [ticketId, record] of Object.entries(steps)) {
    const routeBare = bareRoute(record.route);
    if (routeBare !== agent) {
      continue;
    }
    const expectedModel = record.model ?? null;
    const expected = { agent: routeBare, model: expectedModel };

    if (expectedModel === null) {
      return { code: 0, body: { ok: true, reason: "match", ticket: ticketId, expected } };
    }

    if (model === undefined) {
      return { code: 0, body: { ok: true, reason: "model-unverifiable", ticket: ticketId, expected } };
    }

    if (!modelSatisfies(expectedModel, model)) {
      continue;
    }

    return { code: 0, body: { ok: true, reason: "match", ticket: ticketId, expected } };
  }
  return { code: 1, body: { ok: false, reason: "no-active-step-for-agent" } };
}
