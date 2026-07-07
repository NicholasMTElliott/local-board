#!/usr/bin/env node
// PostToolUse hook, matcher "Task|Agent" (registered under both tool names --
// see routing-validator.js for the same note). Appends one JSONL record per
// subagent/Task dispatch to `<mainRoot>/.local-board/dispatch-ledger.jsonl`.
// Self-contained: no imports from src/, so this file can move into a plugin
// bundle unchanged (see T20260707T1323Z). Talks to the outside world only
// through node:fs/child_process and stdin/stdout.
//
// Contract: stdin carries the Claude Code PostToolUse hook payload as JSON.
// This hook never denies (PostToolUse cannot) and always exits 0, even on a
// malformed payload or a ledger-write failure -- a buggy hook must never
// brick a session.
//
// Exported for tests: `handle(payload, deps)` -> `null` (no-op) or
// `{ ok: true, appended: true, record }`. `deps` = `{ spawnSync, appendLedger, now }`.

import { appendFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

function extractTicketId(prompt) {
  if (typeof prompt !== "string") {
    return null;
  }
  const match = prompt.match(/^\s*Ticket:\s*(\S+)/m);
  return match ? match[1] : null;
}

// Resolves the main worktree root the same way `src/active-steps.js`'s
// `resolveMainRoot` does, reimplemented inline (git shelled directly) so this
// script stays import-free from src/. Falls back to `cwd` when git resolution
// fails (non-git directories, e.g. test fixtures).
function resolveMainRoot(cwd, spawnSyncFn) {
  try {
    const result = spawnSyncFn("git", ["rev-parse", "--git-common-dir"], { cwd, encoding: "utf8" });
    if (result && result.status === 0 && typeof result.stdout === "string" && result.stdout.trim() !== "") {
      const absoluteCommonDir = path.resolve(cwd, result.stdout.trim());
      return path.dirname(absoluteCommonDir);
    }
  } catch {
    // fall through to the cwd fallback below
  }
  return path.resolve(cwd);
}

function defaultAppendLedger(ledgerFile, record) {
  mkdirSync(path.dirname(ledgerFile), { recursive: true });
  // Unlocked append. A sub-4KB line is near-atomic on POSIX, weaker on
  // Windows; concurrent-writer locking is B20260707T1322Z's concern. The
  // reader (evidence-gate.js) tolerates malformed lines.
  appendFileSync(ledgerFile, `${JSON.stringify(record)}\n`);
}

export function handle(payload = {}, deps = {}) {
  const toolName = payload.tool_name;
  if (toolName !== "Task" && toolName !== "Agent") {
    return null;
  }

  const spawnSyncFn = deps.spawnSync ?? spawnSync;
  const appendLedgerFn = deps.appendLedger ?? defaultAppendLedger;
  const nowFn = deps.now ?? (() => new Date().toISOString());

  const toolInput = payload.tool_input ?? {};
  const cwd = typeof payload.cwd === "string" && payload.cwd !== "" ? payload.cwd : process.cwd();
  const root = resolveMainRoot(cwd, spawnSyncFn);
  const ledgerFile = path.join(root, ".local-board", "dispatch-ledger.jsonl");

  const record = {
    ts: nowFn(),
    subagent_type: toolInput.subagent_type ?? null,
    model: toolInput.model ?? null,
    ticketId: extractTicketId(toolInput.prompt),
    session_id: payload.session_id ?? null,
  };

  try {
    appendLedgerFn(ledgerFile, record);
  } catch {
    // Swallow -- PostToolUse cannot deny, and a ledger-write failure must not
    // surface as a session-breaking error.
    return null;
  }

  return { ok: true, appended: true, record };
}

// Reads stdin asynchronously via stream events rather than
// `fs.readFileSync(0)`. The sync read hangs indefinitely on Windows when the
// hook is launched through an async spawn (the common case for a real tool
// runner) -- it only works reliably with a synchronous spawn (execFileSync/
// spawnSync). Stream-based reading works under both.
function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
    process.stdin.resume();
  });
}

function parsePayload(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function main() {
  try {
    const payload = parsePayload(await readStdin());
    const result = handle(payload);
    if (result !== null && result !== undefined) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    }
  } catch {
    // Fail-open: never brick the session on an unexpected error.
  }
  process.exit(0);
}

function isMainModule() {
  try {
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "");
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main();
}
