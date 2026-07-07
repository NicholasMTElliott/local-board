import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { gitOutput } from "./git.js";
import { modelSatisfies, resolveExpectedStep, writeTicketFile } from "./tickets.js";

const CLAUDE_SUBAGENT_PREFIX = "claude-subagent:";

// Resolves the ledger's anchor directory: the main worktree root, shared by
// every linked worktree of the same repo. `git rev-parse --git-common-dir`
// returns the common .git directory (relative to `root` in the ordinary case,
// absolute when `root` is a linked worktree); its parent is the main worktree
// root. Falls back to the passed root when git resolution fails (non-git
// directories, e.g. test fixtures), so the module stays usable outside git.
async function resolveMainRoot(root) {
  try {
    const commonDir = await gitOutput(root, ["rev-parse", "--git-common-dir"]);
    const absoluteCommonDir = path.resolve(root, commonDir);
    return path.dirname(absoluteCommonDir);
  } catch {
    return path.resolve(root);
  }
}

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
export async function stampActiveStep(root, ticketId, record) {
  const filePath = await ledgerPath(root);
  const current = await readLedgerSelfHeal(filePath);
  current[ticketId] = record;
  await writeLedgerAtomic(filePath, current);
}

// Best-effort, idempotent clear: a missing key (no prior `begin-step`, or an
// already-cleared entry) is a no-op, not an error.
export async function clearActiveStep(root, ticketId) {
  const filePath = await ledgerPath(root);
  const current = await readLedgerSelfHeal(filePath);
  if (!Object.hasOwn(current, ticketId)) {
    return;
  }
  const next = { ...current };
  delete next[ticketId];
  await writeLedgerAtomic(filePath, next);
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
    let resolved;
    try {
      resolved = await resolveExpectedStep(root, ticketId);
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
    if (model !== undefined && expectedModel !== null && !modelSatisfies(expectedModel, model)) {
      continue;
    }
    return {
      code: 0,
      body: { ok: true, reason: "match", ticket: ticketId, expected: { agent: routeBare, model: expectedModel } },
    };
  }
  return { code: 1, body: { ok: false, reason: "no-active-step-for-agent" } };
}
