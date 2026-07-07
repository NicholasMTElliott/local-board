import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

import { handle as dispatchLedgerHandle } from "../hooks/dispatch-ledger.js";
import { handle as routingValidatorHandle } from "../hooks/routing-validator.js";
import { handle as evidenceGateHandle } from "../hooks/evidence-gate.js";
import { handle as approveInlineConsentHandle } from "../hooks/approve-inline-consent.js";
import { removeFixtureDir } from "./helpers/fixtures.js";

const execFileAsync = promisify(execFile);
const HOOKS_DIR = path.resolve("hooks");

async function withRepo(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-board-hooks-"));
  try {
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    // Disable background maintenance so a detached gc/object-packing writer
    // can't still be touching .git when teardown removes the fixture dir.
    await execFileAsync("git", ["config", "gc.auto", "0"], { cwd: root });
    await execFileAsync("git", ["config", "gc.autoDetach", "false"], { cwd: root });
    await fn(root);
  } finally {
    await removeFixtureDir(root);
  }
}

// Deliberately does NOT use `child_process.execFile`'s `input` option: on
// this Windows/Node combination that option hangs indefinitely (a Node
// child_process bug, reproduced independently of these hook scripts -- a
// manual stdin write/end on the ChildProcess works fine, which is what this
// helper does). This exercises the exact real-world contract a hook runner
// uses: write JSON to stdin, close it, read stdout once the process exits.
function runHookProcess(script, payload, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(HOOKS_DIR, script)], {
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}

function parseStdout(stdout) {
  return stdout.trim() === "" ? null : JSON.parse(stdout);
}

// ---------------------------------------------------------------------------
// dispatch-ledger.js
// ---------------------------------------------------------------------------

test("dispatch-ledger: Task payload with a Ticket: line appends a correct record silently (spawned)", async () => {
  await withRepo(async (root) => {
    const payload = {
      tool_name: "Task",
      session_id: "sess-a",
      cwd: root,
      tool_input: {
        subagent_type: "local-board-implementer",
        model: "sonnet",
        prompt: "Ticket: T20260707T0001Z\nDo the thing.",
      },
    };
    // PostToolUse hooks must be silent on success -- stdout stays empty even
    // though the ledger file gains the entry.
    const { stdout } = await runHookProcess("dispatch-ledger.js", payload);
    assert.equal(stdout.trim(), "");

    const ledgerRaw = await readFile(path.join(root, ".local-board", "dispatch-ledger.jsonl"), "utf8");
    const lines = ledgerRaw.trim().split("\n");
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.equal(record.ticketId, "T20260707T0001Z");
    assert.equal(record.subagent_type, "local-board-implementer");
    assert.equal(record.model, "sonnet");
    assert.equal(record.session_id, "sess-a");
    assert.ok(typeof record.ts === "string" && record.ts.length > 0);
  });
});

test("dispatch-ledger: also matches tool_name Agent", () => {
  const result = dispatchLedgerHandle(
    {
      tool_name: "Agent",
      session_id: "sess-b",
      cwd: process.cwd(),
      tool_input: { subagent_type: "local-board-designer", model: "opus", prompt: "Ticket: T1\nHi" },
    },
    { appendLedger: () => {}, now: () => "2026-01-01T00:00:00.000Z" },
  );
  assert.equal(result.appended, true);
  assert.equal(result.record.ticketId, "T1");
});

test("dispatch-ledger: a Ticket: line with leading whitespace is still extracted", () => {
  const appended = [];
  const result = dispatchLedgerHandle(
    {
      tool_name: "Task",
      session_id: "sess-ws",
      cwd: process.cwd(),
      tool_input: {
        subagent_type: "local-board-implementer",
        model: "sonnet",
        prompt: "Some preamble.\n   Ticket: T20260707T9999Z\nDo the thing.",
      },
    },
    { appendLedger: (file, record) => appended.push(record), now: () => "2026-01-01T00:00:00.000Z" },
  );
  assert.equal(result.record.ticketId, "T20260707T9999Z");
  assert.equal(appended.length, 1);
});

test("dispatch-ledger: no Ticket: line records ticketId null", () => {
  const appended = [];
  const result = dispatchLedgerHandle(
    {
      tool_name: "Task",
      session_id: "sess-c",
      cwd: process.cwd(),
      tool_input: { subagent_type: "local-board-implementer", model: "sonnet", prompt: "no ticket line" },
    },
    { appendLedger: (file, record) => appended.push(record), now: () => "2026-01-01T00:00:00.000Z" },
  );
  assert.equal(result.record.ticketId, null);
  assert.equal(appended.length, 1);
});

test("dispatch-ledger: non-Task/Agent tool is a no-op (no ledger write)", () => {
  let called = false;
  const result = dispatchLedgerHandle(
    { tool_name: "Bash", tool_input: { command: "ls" } },
    { appendLedger: () => (called = true) },
  );
  assert.equal(result, null);
  assert.equal(called, false);
});

test("dispatch-ledger: append failure is swallowed (PostToolUse never denies)", () => {
  const result = dispatchLedgerHandle(
    { tool_name: "Task", tool_input: { subagent_type: "x", prompt: "Ticket: T1" } },
    {
      appendLedger: () => {
        throw new Error("disk full");
      },
    },
  );
  assert.equal(result, null);
});

test("dispatch-ledger: malformed stdin payload does not crash the process (spawned)", async () => {
  const { stdout, code } = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(HOOKS_DIR, "dispatch-ledger.js")]);
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ stdout: out, code: exitCode }));
    child.stdin.end("not json{{{");
  });
  assert.equal(code, 0);
  assert.equal(stdout.trim(), "");
});

// ---------------------------------------------------------------------------
// routing-validator.js
// ---------------------------------------------------------------------------

test("routing-validator: non-local-board- subagent allows without invoking spawn", () => {
  let spawnCalls = 0;
  const result = routingValidatorHandle(
    { tool_name: "Task", tool_input: { subagent_type: "some-other-agent", prompt: "Ticket: T1\nHi" } },
    { spawnSync: () => (spawnCalls += 1) },
  );
  assert.equal(result, null);
  assert.equal(spawnCalls, 0);
});

test("routing-validator: missing Ticket: line allows without invoking spawn", () => {
  let spawnCalls = 0;
  const result = routingValidatorHandle(
    { tool_name: "Task", tool_input: { subagent_type: "local-board-implementer", prompt: "no ticket here" } },
    { spawnSync: () => (spawnCalls += 1) },
  );
  assert.equal(result, null);
  assert.equal(spawnCalls, 0);
});

test("routing-validator: a Ticket: line with leading whitespace still triggers the check-dispatch spawn", () => {
  let spawnCalls = 0;
  const result = routingValidatorHandle(
    {
      tool_name: "Task",
      tool_input: { subagent_type: "local-board-implementer", model: "sonnet", prompt: "  Ticket: T9\nHi" },
    },
    { spawnSync: () => ((spawnCalls += 1), { status: 0, stdout: JSON.stringify({ ok: true, reason: "match" }) }) },
  );
  assert.equal(spawnCalls, 1);
  assert.equal(result, null);
});

test("routing-validator: non-Task/Agent tool is a fast-path no-op", () => {
  let spawnCalls = 0;
  const result = routingValidatorHandle(
    { tool_name: "Bash", tool_input: { command: "ls" } },
    { spawnSync: () => (spawnCalls += 1) },
  );
  assert.equal(result, null);
  assert.equal(spawnCalls, 0);
});

test("routing-validator: spawnSync exit 0 allows", () => {
  const result = routingValidatorHandle(
    { tool_name: "Task", tool_input: { subagent_type: "local-board-implementer", model: "sonnet", prompt: "Ticket: T1\nHi" } },
    { spawnSync: () => ({ status: 0, stdout: JSON.stringify({ ok: true, reason: "match" }) }) },
  );
  assert.equal(result, null);
});

test("routing-validator: spawnSync exit 1 denies carrying the JSON reason", () => {
  const body = { ok: false, reason: "agent-mismatch", expected: { agent: "local-board-designer" } };
  const result = routingValidatorHandle(
    { tool_name: "Task", tool_input: { subagent_type: "local-board-implementer", model: "sonnet", prompt: "Ticket: T1\nHi" } },
    { spawnSync: () => ({ status: 1, stdout: JSON.stringify(body) }) },
  );
  assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
  assert.deepEqual(JSON.parse(result.hookSpecificOutput.permissionDecisionReason), body);
});

test("routing-validator: spawnSync exit 2 fails open (allow) with a warning reason", () => {
  const result = routingValidatorHandle(
    { tool_name: "Task", tool_input: { subagent_type: "local-board-implementer", prompt: "Ticket: T1\nHi" } },
    { spawnSync: () => ({ status: 2, stdout: JSON.stringify({ ok: false, reason: "ticket-not-found" }) }) },
  );
  assert.equal(result.hookSpecificOutput.permissionDecision, "allow");
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /exited 2/);
});

test("routing-validator: thrown ENOENT (spawn failure) fails open (allow)", () => {
  const result = routingValidatorHandle(
    { tool_name: "Task", tool_input: { subagent_type: "local-board-implementer", prompt: "Ticket: T1\nHi" } },
    {
      spawnSync: () => {
        const error = new Error("spawn node ENOENT");
        error.code = "ENOENT";
        throw error;
      },
    },
  );
  assert.equal(result.hookSpecificOutput.permissionDecision, "allow");
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /ENOENT/);
});

test("routing-validator: timeout (signal set, no error) fails open (allow)", () => {
  const result = routingValidatorHandle(
    { tool_name: "Task", tool_input: { subagent_type: "local-board-implementer", prompt: "Ticket: T1\nHi" } },
    { spawnSync: () => ({ status: null, signal: "SIGTERM", stdout: "" }) },
  );
  assert.equal(result.hookSpecificOutput.permissionDecision, "allow");
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /signal/);
});

test("routing-validator: spawned subprocess end-to-end with a stub CLI (deny)", async () => {
  await withRepo(async (root) => {
    const stubPath = path.join(root, "stub-deny.js");
    await writeFile(
      stubPath,
      'console.log(JSON.stringify({ ok: false, reason: "model-mismatch" })); process.exit(1);\n',
      "utf8",
    );
    const { stdout } = await runHookProcess(
      "routing-validator.js",
      { tool_name: "Task", cwd: root, tool_input: { subagent_type: "local-board-implementer", model: "opus", prompt: "Ticket: T1\nHi" } },
      { LOCAL_BOARD_HOOK_CLI_PATH: stubPath },
    );
    const result = parseStdout(stdout);
    assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
    assert.match(result.hookSpecificOutput.permissionDecisionReason, /model-mismatch/);
  });
});

test("routing-validator: spawned subprocess end-to-end with a stub CLI (allow)", async () => {
  await withRepo(async (root) => {
    const stubPath = path.join(root, "stub-allow.js");
    await writeFile(stubPath, 'console.log(JSON.stringify({ ok: true, reason: "match" })); process.exit(0);\n', "utf8");
    const { stdout } = await runHookProcess(
      "routing-validator.js",
      { tool_name: "Task", cwd: root, tool_input: { subagent_type: "local-board-implementer", model: "sonnet", prompt: "Ticket: T1\nHi" } },
      { LOCAL_BOARD_HOOK_CLI_PATH: stubPath },
    );
    assert.equal(stdout.trim(), "");
  });
});

// ---------------------------------------------------------------------------
// evidence-gate.js
// ---------------------------------------------------------------------------

function makeCompleteStepCommand(ticketId, executor) {
  return `local-board complete-step ${ticketId} implement --executor ${executor} --evidence "done"`;
}

test("evidence-gate: command lacking complete-step allows via fast path (no ledger read)", () => {
  let readCalls = 0;
  const result = evidenceGateHandle(
    { tool_input: { command: "local-board list --json" } },
    { readFile: () => (readCalls += 1) },
  );
  assert.equal(result, null);
  assert.equal(readCalls, 0);
});

test("evidence-gate: inline executor allows without a ledger read", () => {
  let readCalls = 0;
  const result = evidenceGateHandle(
    { tool_input: { command: makeCompleteStepCommand("T1", "inline") } },
    { readFile: () => (readCalls += 1) },
  );
  assert.equal(result, null);
  assert.equal(readCalls, 0);
});

test("evidence-gate: codex-task:* executor allows without a ledger read", () => {
  let readCalls = 0;
  const result = evidenceGateHandle(
    { tool_input: { command: makeCompleteStepCommand("T1", "codex-task:workspace-write") } },
    { readFile: () => (readCalls += 1) },
  );
  assert.equal(result, null);
  assert.equal(readCalls, 0);
});

test("evidence-gate: claude-subagent executor with a matching in-session ledger entry allows", () => {
  const ledger = [{ ticketId: "T1", subagent_type: "local-board-implementer", session_id: "sess-x" }]
    .map((entry) => JSON.stringify(entry))
    .join("\n");
  const result = evidenceGateHandle(
    {
      session_id: "sess-x",
      tool_input: { command: makeCompleteStepCommand("T1", "claude-subagent:local-board-implementer@sonnet") },
    },
    { spawnSync: () => ({ status: 128 }), readFile: () => ledger },
  );
  assert.equal(result, null);
});

test("evidence-gate: claude-subagent executor with no matching ledger entry denies", () => {
  const ledger = [{ ticketId: "T1", subagent_type: "local-board-implementer", session_id: "sess-OTHER" }]
    .map((entry) => JSON.stringify(entry))
    .join("\n");
  const result = evidenceGateHandle(
    {
      session_id: "sess-x",
      tool_input: { command: makeCompleteStepCommand("T1", "claude-subagent:local-board-implementer@sonnet") },
    },
    { spawnSync: () => ({ status: 128 }), readFile: () => ledger },
  );
  assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /T1/);
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /local-board-implementer/);
});

test("evidence-gate: missing/corrupt ledger fails open (allow)", () => {
  const result = evidenceGateHandle(
    {
      session_id: "sess-x",
      tool_input: { command: makeCompleteStepCommand("T1", "claude-subagent:local-board-implementer@sonnet") },
    },
    {
      spawnSync: () => ({ status: 128 }),
      readFile: () => {
        const error = new Error("ENOENT: no such file");
        error.code = "ENOENT";
        throw error;
      },
    },
  );
  assert.equal(result.hookSpecificOutput.permissionDecision, "allow");
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /unreadable/);
});

test("evidence-gate: tolerates malformed ledger lines when checking for a match", () => {
  const ledger = ["not json{{{", JSON.stringify({ ticketId: "T1", subagent_type: "local-board-implementer", session_id: "sess-x" })].join(
    "\n",
  );
  const result = evidenceGateHandle(
    {
      session_id: "sess-x",
      tool_input: { command: makeCompleteStepCommand("T1", "claude-subagent:local-board-implementer@sonnet") },
    },
    { spawnSync: () => ({ status: 128 }), readFile: () => ledger },
  );
  assert.equal(result, null);
});

test("evidence-gate: both local-board and node .../local-board.js command forms parse identically", () => {
  const ledger = JSON.stringify({ ticketId: "T1", subagent_type: "local-board-implementer", session_id: "sess-x" });
  const commandA = "local-board complete-step T1 implement --executor claude-subagent:local-board-implementer@sonnet --evidence \"done\"";
  const commandB =
    'node /some/install/dir/bin/local-board.js complete-step T1 implement --executor claude-subagent:local-board-implementer@sonnet --evidence "done"';
  for (const command of [commandA, commandB]) {
    const result = evidenceGateHandle(
      { session_id: "sess-x", tool_input: { command } },
      { spawnSync: () => ({ status: 128 }), readFile: () => ledger },
    );
    assert.equal(result, null, command);
  }
});

test("evidence-gate: a quoted --executor value is parsed identically to an unquoted one", () => {
  const ledger = JSON.stringify({ ticketId: "T1", subagent_type: "local-board-implementer", session_id: "sess-x" });
  const command =
    'local-board complete-step T1 implement --executor "claude-subagent:local-board-implementer@sonnet" --evidence "done"';
  const result = evidenceGateHandle(
    { session_id: "sess-x", tool_input: { command } },
    { spawnSync: () => ({ status: 128 }), readFile: () => ledger },
  );
  assert.equal(result, null);
});

test("evidence-gate: a Windows-style node C:\\...\\local-board.js command form is recognized as the program token", () => {
  const ledger = JSON.stringify({ ticketId: "T1", subagent_type: "local-board-implementer", session_id: "sess-x" });
  const command =
    'node C:\\Users\\jane\\.local-board\\bin\\local-board.js complete-step T1 implement --executor claude-subagent:local-board-implementer@sonnet --evidence "done"';
  const result = evidenceGateHandle(
    { session_id: "sess-x", tool_input: { command } },
    { spawnSync: () => ({ status: 128 }), readFile: () => ledger },
  );
  assert.equal(result, null);
});

test("evidence-gate: a --evidence value containing the literal substring does not false-positive the gate", () => {
  let readCalls = 0;
  const result = evidenceGateHandle(
    {
      tool_input: {
        command: 'local-board approve-inline T1 implement --reason "will complete-step later"',
      },
    },
    { readFile: () => (readCalls += 1) },
  );
  assert.equal(result, null);
  assert.equal(readCalls, 0);
});

test("evidence-gate: end-to-end against a real ledger file (spawned)", async () => {
  await withRepo(async (root) => {
    const dispatchPayload = {
      tool_name: "Task",
      session_id: "sess-e2e",
      cwd: root,
      tool_input: { subagent_type: "local-board-implementer", model: "sonnet", prompt: "Ticket: T-E2E\nHi" },
    };
    await runHookProcess("dispatch-ledger.js", dispatchPayload);

    const allowPayload = {
      session_id: "sess-e2e",
      cwd: root,
      tool_input: {
        command: 'local-board complete-step T-E2E implement --executor claude-subagent:local-board-implementer@sonnet --evidence "done"',
      },
    };
    const { stdout: allowOut } = await runHookProcess("evidence-gate.js", allowPayload);
    assert.equal(allowOut.trim(), "");

    const denyPayload = { ...allowPayload, session_id: "sess-different" };
    const { stdout: denyOut } = await runHookProcess("evidence-gate.js", denyPayload);
    const denyResult = parseStdout(denyOut);
    assert.equal(denyResult.hookSpecificOutput.permissionDecision, "deny");
  });
});

// ---------------------------------------------------------------------------
// approve-inline-consent.js
// ---------------------------------------------------------------------------

test("approve-inline-consent: command with the approve-inline token asks", () => {
  const result = approveInlineConsentHandle({
    tool_input: { command: 'local-board approve-inline T1 implement --reason "no reviewer available"' },
  });
  assert.equal(result.hookSpecificOutput.permissionDecision, "ask");
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /routing deviation/);
});

test("approve-inline-consent: node .../local-board.js form also asks", () => {
  const result = approveInlineConsentHandle({
    tool_input: { command: 'node /some/dir/bin/local-board.js approve-inline T1 implement --reason "x"' },
  });
  assert.equal(result.hookSpecificOutput.permissionDecision, "ask");
});

test("approve-inline-consent: unrelated command allows", () => {
  const result = approveInlineConsentHandle({ tool_input: { command: "local-board complete-step T1 implement --executor inline --evidence x" } });
  assert.equal(result, null);
});

test("approve-inline-consent: spawned subprocess contract", async () => {
  const { stdout } = await runHookProcess("approve-inline-consent.js", {
    tool_input: { command: 'local-board approve-inline T1 implement --reason "x"' },
  });
  const result = parseStdout(stdout);
  assert.equal(result.hookSpecificOutput.permissionDecision, "ask");
});
