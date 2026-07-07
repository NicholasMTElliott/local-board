#!/usr/bin/env node
// PreToolUse hook, matcher "Bash". Denies a `complete-step` call that claims a
// `claude-subagent:*` executor with no matching `dispatch-ledger.jsonl` entry
// scoped to the current session -- closing the "self-reported evidence" hole
// (see dispatch-ledger.js, which appends the entries this hook reads).
// `inline` and `codex-task:*` executors are not ledger-backed and are covered
// CLI-side (not duplicated here). Self-contained: no imports from src/.
//
// v1 gate is session-scoped only (not "newer than the last loop-back"):
// requires >=1 ledger entry matching (ticketId, subagent_type) within the
// current session_id. A same-session loop-back re-run through the same step
// can still satisfy the gate from an earlier iteration's ledger entry --
// documented residual, owned by T20260707T1328Z (loop-back evidence
// invalidation), not solved here.
//
// Exported for tests: `handle(payload, deps)` -> `null` (allow, no output) or
// `{ hookSpecificOutput: { hookEventName, permissionDecision, permissionDecisionReason } }`.
// `deps` = `{ spawnSync, readFile }`.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLAUDE_SUBAGENT_PREFIX = "claude-subagent:";

function tokenize(command) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(command)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

function isProgramToken(token) {
  const normalized = token.replace(/\\/g, "/");
  const base = normalized.split("/").pop();
  return base === "local-board" || base === "local-board.js";
}

// Locates the `complete-step` subcommand token immediately after the
// `local-board`/`local-board.js` program token (skipping a leading
// `--root <value>` pair), so a `--reason`/`--evidence` value that happens to
// contain the literal substring "complete-step" elsewhere in the command
// cannot false-positive this gate (see the fast-path substring check below,
// which only decides whether to run this precise parse at all).
function findSubcommandIndex(tokens, expectedSubcommand) {
  const programIndex = tokens.findIndex(isProgramToken);
  if (programIndex === -1) {
    return -1;
  }
  let i = programIndex + 1;
  while (i < tokens.length && tokens[i] === "--root") {
    i += 2;
  }
  if (i >= tokens.length || tokens[i] !== expectedSubcommand) {
    return -1;
  }
  return i;
}

function takeOptionValue(tokens, name) {
  const index = tokens.indexOf(name);
  if (index === -1 || index === tokens.length - 1) {
    return undefined;
  }
  return tokens[index + 1];
}

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

function readLedgerEntries(ledgerFile, readFileFn) {
  const raw = readFileFn(ledgerFile, "utf8");
  const entries = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === "") {
      continue;
    }
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Tolerate malformed lines (unlocked concurrent-writer race is
      // B20260707T1322Z's concern, not this reader's).
    }
  }
  return entries;
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

export function handle(payload = {}, deps = {}) {
  const toolInput = payload.tool_input ?? {};
  const command = typeof toolInput.command === "string" ? toolInput.command : "";

  // Cheap fast path: no spawn, no parse, unless the literal substring is
  // present at all.
  if (!command.includes("complete-step")) {
    return null;
  }

  const tokens = tokenize(command);
  const subcommandIndex = findSubcommandIndex(tokens, "complete-step");
  if (subcommandIndex === -1) {
    return null; // substring matched elsewhere (e.g. --evidence text), not the actual subcommand
  }

  const executor = takeOptionValue(tokens, "--executor");
  if (typeof executor !== "string" || !executor.startsWith(CLAUDE_SUBAGENT_PREFIX)) {
    return null; // inline / codex-task:* -- not ledger-backed, covered CLI-side
  }

  const ticketId = tokens[subcommandIndex + 1];
  if (typeof ticketId !== "string") {
    return null;
  }
  const subagentType = executor.slice(CLAUDE_SUBAGENT_PREFIX.length).split("@")[0];

  const spawnSyncFn = deps.spawnSync ?? spawnSync;
  const readFileFn = deps.readFile ?? readFileSync;
  const cwd = typeof payload.cwd === "string" && payload.cwd !== "" ? payload.cwd : process.cwd();
  const root = resolveMainRoot(cwd, spawnSyncFn);
  const ledgerFile = path.join(root, ".local-board", "dispatch-ledger.jsonl");

  let entries;
  try {
    entries = readLedgerEntries(ledgerFile, readFileFn);
  } catch (error) {
    return failOpen(`evidence-gate: dispatch ledger unreadable (${error.message}); allowing without verification`);
  }

  const sessionId = payload.session_id;
  const hasEvidence = entries.some(
    (entry) =>
      entry &&
      entry.ticketId === ticketId &&
      entry.subagent_type === subagentType &&
      entry.session_id === sessionId,
  );

  if (hasEvidence) {
    return null; // allow
  }

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        `no dispatch-ledger entry this session for ticket ${ticketId} agent ${subagentType}; ` +
        `a claude-subagent:* executor claim requires a ledgered Task/Agent dispatch in this session`,
    },
  };
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
