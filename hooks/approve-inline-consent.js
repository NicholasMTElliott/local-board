#!/usr/bin/env node
// PreToolUse hook, matcher "Bash". Turns `approve-inline` -- the strict-routing
// escape hatch -- into a human-in-the-loop consent prompt: it returns
// `permissionDecision: "ask"`, so the Claude Code permission prompt itself is
// the deterministic user approval the requirement asks for. Self-contained:
// no imports from src/.
//
// Exported for tests: `handle(payload)` -> `null` (allow, no output) or
// `{ hookSpecificOutput: { hookEventName, permissionDecision: "ask", permissionDecisionReason } }`.

import path from "node:path";
import { fileURLToPath } from "node:url";

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

// Same whitespace-bounded-token match as evidence-gate.js: locates
// `approve-inline` immediately after the program token (skipping a leading
// `--root <value>` pair). A pathological `--reason` value containing the bare
// token in exactly that position is a documented, low-impact residual (the
// direction of the residual is "ask" -- a human prompt -- which is the safe
// side to err toward here, unlike evidence-gate's allow-favoring residual).
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

export function handle(payload = {}) {
  const toolInput = payload.tool_input ?? {};
  const command = typeof toolInput.command === "string" ? toolInput.command : "";

  if (!command.includes("approve-inline")) {
    return null;
  }

  const tokens = tokenize(command);
  if (findSubcommandIndex(tokens, "approve-inline") === -1) {
    return null;
  }

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: "approve-inline is a routing deviation; confirm to record it as user consent.",
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
