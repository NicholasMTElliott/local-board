#!/usr/bin/env node
// PreToolUse hook, matcher "Task|Agent". When `tool_input.subagent_type`
// starts with `local-board-`, shells out to `check-dispatch` (T20260707T1325Z)
// and denies a computed mismatch. Fail-open on any ambiguous/error state (CLI
// missing, spawn error, timeout, non-0/1 exit) -- `complete-step` still
// enforces routing at write time, so a permissive dispatch here is not the
// only gate. Self-contained: no imports from src/; talks to the CLI only by
// spawning bin/local-board.js (a sibling of this script under the same
// install root, in both a dev checkout and an installed `~/.local-board/`
// tree), so this file moves into a plugin bundle unchanged.
//
// Exported for tests: `handle(payload, deps)` -> `null` (allow, no output) or
// `{ hookSpecificOutput: { hookEventName, permissionDecision, permissionDecisionReason } }`.
// `deps` = `{ spawnSync, cliPath }`. `LOCAL_BOARD_HOOK_CLI_PATH` env var
// overrides the resolved CLI path (test seam for subprocess-level tests).

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CLI_PATH = path.join(HERE, "..", "bin", "local-board.js");

function extractTicketId(prompt) {
  if (typeof prompt !== "string") {
    return null;
  }
  const match = prompt.match(/^\s*Ticket:\s*(\S+)/m);
  return match ? match[1] : null;
}

function failOpen(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: reason,
    },
  };
}

function deny(body) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: JSON.stringify(body),
    },
  };
}

export function handle(payload = {}, deps = {}) {
  const toolName = payload.tool_name;
  if (toolName !== "Task" && toolName !== "Agent") {
    return null;
  }

  const toolInput = payload.tool_input ?? {};
  const subagentType = toolInput.subagent_type;
  if (typeof subagentType !== "string" || !subagentType.startsWith("local-board-")) {
    return null; // fast path -- not a local-board route, no spawn
  }

  const ticketId = extractTicketId(toolInput.prompt);
  if (ticketId === null) {
    return null; // cannot validate without a "Ticket: <id>" line -- documented residual
  }

  const spawnSyncFn = deps.spawnSync ?? spawnSync;
  const cliPath = deps.cliPath ?? process.env.LOCAL_BOARD_HOOK_CLI_PATH ?? DEFAULT_CLI_PATH;
  const cwd = typeof payload.cwd === "string" && payload.cwd !== "" ? payload.cwd : process.cwd();

  const cliArgs = ["--root", cwd, "check-dispatch", "--agent", subagentType, "--ticket", ticketId];
  if (typeof toolInput.model === "string" && toolInput.model !== "") {
    cliArgs.push("--model", toolInput.model);
  }

  let result;
  try {
    result = spawnSyncFn(process.execPath, [cliPath, ...cliArgs], { encoding: "utf8", timeout: 10000 });
  } catch (error) {
    return failOpen(`routing-validator: failed to spawn check-dispatch (${error.message}); allowing dispatch without verification`);
  }

  if (!result || result.error) {
    const detail = result?.error?.message ?? "unknown spawn failure";
    return failOpen(`routing-validator: check-dispatch spawn error (${detail}); allowing dispatch without verification`);
  }
  if (result.signal) {
    return failOpen(
      `routing-validator: check-dispatch was terminated by signal ${result.signal} (possible timeout); allowing dispatch without verification`,
    );
  }

  if (result.status === 0) {
    return null; // allow
  }

  if (result.status === 1) {
    let body;
    try {
      body = JSON.parse(result.stdout);
    } catch {
      body = { ok: false, reason: "deny", raw: result.stdout };
    }
    return deny(body);
  }

  // exit 2 (ticket-not-found / internal error) or any other unexpected code.
  return failOpen(
    `routing-validator: check-dispatch exited ${result.status} (ambiguous); allowing dispatch without verification`,
  );
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
    // Fail-open: an unexpected bug in this hook must never brick a session.
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
