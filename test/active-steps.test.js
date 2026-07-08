import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

import { main } from "../src/cli.js";
import { initProject } from "../src/scaffold.js";
import { createTicket } from "../src/tickets.js";
import { addTicketWorktree } from "../src/worktrees.js";
import {
  checkDispatch,
  clearActiveStep,
  ledgerPath,
  readActiveSteps,
  stampActiveStep,
} from "../src/active-steps.js";
import { removeFixtureDir } from "./helpers/fixtures.js";

const execFileAsync = promisify(execFile);
const GIT_AVAILABLE = await hasGit();

async function withBoard(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-board-active-steps-"));
  try {
    await initProject(root);
    await fn(root);
  } finally {
    await removeFixtureDir(root);
  }
}

async function withRepo(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-board-active-steps-repo-"));
  try {
    await git(root, ["init"]);
    // Disable background maintenance so a detached gc/object-packing writer
    // can't still be touching .git when teardown removes the fixture dir.
    await git(root, ["config", "gc.auto", "0"]);
    await git(root, ["config", "gc.autoDetach", "false"]);
    await git(root, ["config", "user.email", "local-board@example.test"]);
    await git(root, ["config", "user.name", "local-board test"]);
    await writeFile(path.join(root, "README.md"), "# Test Repo\n", "utf8");
    await git(root, ["add", "README.md"]);
    await git(root, ["commit", "-m", "Initial commit"]);
    await initProject(root);
    await git(root, ["add", "plans", ".gitignore"]);
    await git(root, ["commit", "-m", "Initialize local board"]);
    await fn(root);
  } finally {
    await removeFixtureDir(root);
  }
}

// --- Unit: ledger path resolution ---

test("ledgerPath falls back to the passed root in a non-git directory", async () => {
  await withBoard(async (root) => {
    const resolved = await ledgerPath(root);
    assert.equal(resolved, path.join(path.resolve(root), ".local-board", "active-steps.json"));
  });
});

// --- Unit: stamp/read/clear round-trip and RMW isolation ---

test("stampActiveStep/readActiveSteps/clearActiveStep round-trip and preserve other tickets' entries", async () => {
  await withBoard(async (root) => {
    await stampActiveStep(root, "T1", {
      ticket: "T1",
      action: "design",
      route: "claude-subagent:local-board-designer",
      model: "opus",
      root: path.resolve(root),
      ts: "2026-07-07T00:00:00Z",
    });
    await stampActiveStep(root, "T2", {
      ticket: "T2",
      action: "implement",
      route: "claude-subagent:local-board-implementer",
      model: "sonnet",
      root: path.resolve(root),
      ts: "2026-07-07T00:01:00Z",
    });

    const afterBothStamps = await readActiveSteps(root);
    assert.equal(afterBothStamps.T1.action, "design");
    assert.equal(afterBothStamps.T2.action, "implement");

    await clearActiveStep(root, "T1");
    const afterClearT1 = await readActiveSteps(root);
    assert.equal(Object.hasOwn(afterClearT1, "T1"), false);
    assert.equal(afterClearT1.T2.action, "implement");

    // Clearing an already-cleared (or never-stamped) key is a no-op, not an error.
    await clearActiveStep(root, "T1");
    await clearActiveStep(root, "T-never-stamped");
    const afterNoopClears = await readActiveSteps(root);
    assert.deepEqual(afterNoopClears, afterClearT1);
  });
});

test("stampActiveStep is idempotent: re-stamping the same ticket overwrites only its own key", async () => {
  await withBoard(async (root) => {
    await stampActiveStep(root, "T1", { ticket: "T1", action: "design", route: "r1", model: "opus" });
    await stampActiveStep(root, "T2", { ticket: "T2", action: "implement", route: "r2", model: "sonnet" });
    await stampActiveStep(root, "T1", { ticket: "T1", action: "review", route: "r1b", model: null });

    const steps = await readActiveSteps(root);
    assert.equal(steps.T1.action, "review");
    assert.equal(steps.T1.route, "r1b");
    assert.equal(steps.T2.action, "implement", "unrelated ticket's entry must survive a re-stamp");
  });
});

test("active-steps ledger corruption is tolerated on write (self-heals) but surfaced on read", async () => {
  await withBoard(async (root) => {
    const filePath = await ledgerPath(root);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "{not valid json", "utf8");

    await assert.rejects(readActiveSteps(root), /is corrupt/);

    // The write path (stamp) self-heals: it does not propagate the corruption
    // and instead starts fresh, producing a valid ledger.
    await stampActiveStep(root, "T1", { ticket: "T1", action: "design", route: "r", model: "opus" });
    const steps = await readActiveSteps(root);
    assert.equal(steps.T1.action, "design");
  });
});

// --- Ledger RMW locking (B20260707T1322Z) ---

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("control: an unlocked ledger read-modify-write loses an update under a forced interleave (reproduces the pre-lock bug)", async () => {
  await withBoard(async (root) => {
    const filePath = await ledgerPath(root);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "{}\n", "utf8");

    // Hand-rolled analog of the OLD (unlocked) stampActiveStep body: read,
    // hold, mutate, write. No withFileLock involved at all -- this is
    // deliberately the naive pattern the ticket's bug describes, used here
    // only to prove the seam reproduces a real lost update.
    async function unsafeStamp(ticketId, holdMs) {
      const current = JSON.parse(await readFile(filePath, "utf8"));
      await delay(holdMs);
      current[ticketId] = { ticket: ticketId };
      await writeFile(filePath, `${JSON.stringify(current, null, 2)}\n`, "utf8");
    }

    // T1 reads first and holds longer; T2 reads (the same pre-mutation {})
    // and writes first (short hold), then T1 writes last with a copy that
    // never saw T2's write, clobbering it.
    await Promise.all([unsafeStamp("T1", 60), unsafeStamp("T2", 5)]);

    const final = JSON.parse(await readFile(filePath, "utf8"));
    assert.deepEqual(Object.keys(final), ["T1"], "T2's update must be lost by the naive unlocked RMW pattern");
  });
});

test("stampActiveStep serializes concurrent stamps for different tickets via the ledger lock: neither entry is lost", async () => {
  await withBoard(async (root) => {
    // T1's stamp is forced to hold the lock for a while between its read and
    // its write (mirroring the control test's interleave above); T2's stamp
    // has no artificial delay and starts concurrently. Without the lock this
    // is exactly the shape that loses an update; with it, T2 must block on
    // the mkdir sentinel until T1 releases, then read T1's already-written
    // state before adding its own key.
    await Promise.all([
      stampActiveStep(
        root,
        "T1",
        { ticket: "T1", action: "design", route: "r1", model: "opus" },
        { __afterRead: () => delay(60) },
      ),
      stampActiveStep(root, "T2", { ticket: "T2", action: "implement", route: "r2", model: "sonnet" }),
    ]);

    const steps = await readActiveSteps(root);
    assert.equal(steps.T1.action, "design", "T1's entry must survive");
    assert.equal(steps.T2.action, "implement", "T2's entry must survive");
  });
});

test("clearActiveStep and stampActiveStep contend on the same ledger lock without losing either update", async () => {
  await withBoard(async (root) => {
    await stampActiveStep(root, "T1", { ticket: "T1", action: "design", route: "r1", model: "opus" });

    await Promise.all([
      clearActiveStep(root, "T1", { __afterRead: () => delay(60) }),
      stampActiveStep(root, "T2", { ticket: "T2", action: "implement", route: "r2", model: "sonnet" }),
    ]);

    const steps = await readActiveSteps(root);
    assert.equal(Object.hasOwn(steps, "T1"), false, "T1 must be cleared");
    assert.equal(steps.T2.action, "implement", "T2's entry must survive the concurrent clear");
  });
});

test("stale ledger lock is broken and the mutation proceeds", async () => {
  await withBoard(async (root) => {
    const filePath = await ledgerPath(root);
    const lockDir = `${filePath}.lock`;
    await mkdir(lockDir, { recursive: true });
    await writeFile(
      path.join(lockDir, "meta"),
      JSON.stringify({ pid: 999999, ts: new Date(Date.now() - 100_000).toISOString(), hostname: "stale-host" }),
      "utf8",
    );

    await stampActiveStep(
      root,
      "T1",
      { ticket: "T1", action: "design", route: "r1", model: "opus" },
      { lock: { staleMs: 50, retryBudgetMs: 50 } },
    );

    const steps = await readActiveSteps(root);
    assert.equal(steps.T1.action, "design");
  });
});

// --- CLI round-trip: begin-step stamps, complete-step/approve-inline clear ---

test("begin-step stamps the ledger; complete-step clears it", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Implement ledger stamping", {
      status: "ready_for_implementation",
      now: new Date("2026-07-07T10:00:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const begin = await runCli(["--root", root, "begin-step", ticketId, "--json"]);
    assert.equal(begin.code, 0, begin.stderr);

    const steps = await readActiveSteps(root);
    assert.equal(steps[ticketId].action, "implement");
    assert.equal(steps[ticketId].route, "claude-subagent:local-board-implementer");
    assert.equal(steps[ticketId].model, "sonnet");
    assert.equal(typeof steps[ticketId].ts, "string");

    const complete = await runCli([
      "--root",
      root,
      "complete-step",
      ticketId,
      "implement",
      "--executor",
      "claude-subagent:local-board-implementer@sonnet",
      "--evidence",
      "Implemented and tested.",
      "--json",
    ]);
    assert.equal(complete.code, 0, complete.stderr);

    const stepsAfterComplete = await readActiveSteps(root);
    assert.equal(Object.hasOwn(stepsAfterComplete, ticketId), false);
  });
});

test("approve-inline clears the ledger entry", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Approve inline clears ledger", {
      status: "ready_for_review",
      now: new Date("2026-07-07T10:05:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    assert.equal((await runCli(["--root", root, "begin-step", ticketId, "--json"])).code, 0);
    assert.ok(Object.hasOwn(await readActiveSteps(root), ticketId));

    const approve = await runCli([
      "--root",
      root,
      "approve-inline",
      ticketId,
      "review",
      "--reason",
      "Codex unavailable; running inline.",
      "--json",
    ]);
    assert.equal(approve.code, 0, approve.stderr);

    assert.equal(Object.hasOwn(await readActiveSteps(root), ticketId), false);
  });
});

test("begin-step re-stamp overwrites a stale entry for the same ticket (idempotent)", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Re-begin overwrites stale entry", {
      status: "ready_for_design",
      now: new Date("2026-07-07T10:10:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    assert.equal((await runCli(["--root", root, "begin-step", ticketId, "--json"])).code, 0);
    const firstRecord = (await readActiveSteps(root))[ticketId];
    assert.equal(firstRecord.action, "design");
    assert.equal(firstRecord.route, "claude-subagent:local-board-designer");

    // Re-begin with an explicit --action override: the same ticket key must be
    // overwritten in place (self-healing a stale/incorrect entry), not appended
    // alongside a second entry.
    assert.equal(
      (await runCli(["--root", root, "begin-step", ticketId, "--action", "implement", "--json"])).code,
      0,
    );
    const steps = await readActiveSteps(root);

    assert.equal(Object.keys(steps).length, 1, "re-stamping must overwrite the ticket's own key, not add a new one");
    assert.equal(steps[ticketId].action, "implement");
    assert.equal(steps[ticketId].route, "claude-subagent:local-board-implementer");
    assert.equal(steps[ticketId].model, "sonnet");
  });
});

// --- Worktree resolution: begin-step in a worktree writes to the MAIN checkout's ledger ---

test("begin-step invoked in a linked worktree stamps the main checkout's ledger", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root) => {
    const ticketPath = await createTicket(root, "task", "Worktree ledger anchoring", {
      status: "ready_for_implementation",
      now: new Date("2026-07-07T10:20:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const worktree = await addTicketWorktree(root, ticketId);

    const begin = await runCli(["--root", worktree.worktreePath, "begin-step", ticketId, "--json"]);
    assert.equal(begin.code, 0, begin.stderr);

    // The ledger must land in the MAIN checkout, not the worktree.
    const mainLedgerPath = path.join(path.resolve(root), ".local-board", "active-steps.json");
    const worktreeLedgerPath = path.join(path.resolve(worktree.worktreePath), ".local-board", "active-steps.json");

    const mainSteps = JSON.parse(await readFile(mainLedgerPath, "utf8"));
    assert.equal(mainSteps[ticketId].action, "implement");

    await assert.rejects(readFile(worktreeLedgerPath, "utf8"), /ENOENT/);

    // check-dispatch invoked from the main checkout (as the hook would) must see it too.
    const check = await runCli([
      "--root",
      root,
      "check-dispatch",
      "--agent",
      "local-board-implementer",
      "--model",
      "sonnet",
      "--ticket",
      ticketId,
    ]);
    assert.equal(check.code, 0, check.stderr);
    assert.deepEqual(JSON.parse(check.stdout), {
      ok: true,
      reason: "match",
      expected: { agent: "local-board-implementer", model: "sonnet" },
      ticket: ticketId,
    });
  });
});

// --- check-dispatch verdict matrix ---

test("check-dispatch: right agent and right model passes", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Right agent right model", {
      status: "ready_for_implementation",
      now: new Date("2026-07-07T10:30:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "begin-step", ticketId, "--json"])).code, 0);

    const result = await runCli([
      "--root",
      root,
      "check-dispatch",
      "--agent",
      "local-board-implementer",
      "--model",
      "sonnet",
      "--ticket",
      ticketId,
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      reason: "match",
      expected: { agent: "local-board-implementer", model: "sonnet" },
      ticket: ticketId,
    });
  });
});

test("check-dispatch: wrong agent denies with agent-mismatch", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Wrong agent", {
      status: "ready_for_implementation",
      now: new Date("2026-07-07T10:31:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "begin-step", ticketId, "--json"])).code, 0);

    const result = await runCli([
      "--root",
      root,
      "check-dispatch",
      "--agent",
      "local-board-reviewer",
      "--ticket",
      ticketId,
    ]);
    assert.equal(result.code, 1);
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: false,
      reason: "agent-mismatch",
      expected: { agent: "local-board-implementer", model: "sonnet" },
      ticket: ticketId,
    });
  });
});

test("check-dispatch: wrong model denies with model-mismatch", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Wrong model", {
      status: "ready_for_implementation",
      now: new Date("2026-07-07T10:32:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "begin-step", ticketId, "--json"])).code, 0);

    const result = await runCli([
      "--root",
      root,
      "check-dispatch",
      "--agent",
      "local-board-implementer",
      "--model",
      "opus",
      "--ticket",
      ticketId,
    ]);
    assert.equal(result.code, 1);
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: false,
      reason: "model-mismatch",
      expected: { agent: "local-board-implementer", model: "sonnet" },
      ticket: ticketId,
    });
  });
});

test("check-dispatch: model omitted while a model is pinned passes with model-unverifiable", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Model omitted", {
      status: "ready_for_implementation",
      now: new Date("2026-07-07T10:33:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "begin-step", ticketId, "--json"])).code, 0);

    const result = await runCli([
      "--root",
      root,
      "check-dispatch",
      "--agent",
      "local-board-implementer",
      "--ticket",
      ticketId,
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      reason: "model-unverifiable",
      expected: { agent: "local-board-implementer", model: "sonnet" },
      ticket: ticketId,
    });
  });
});

test("check-dispatch: configured model null always passes the model check", async () => {
  await withBoard(async (root) => {
    // Craft a ledger record directly to exercise the null-model-pin path
    // (none of the built-in claude-subagent routes ship with an unpinned model).
    await stampActiveStep(root, "T-null-model", {
      ticket: "T-null-model",
      action: "design",
      route: "claude-subagent:local-board-designer",
      model: null,
    });

    const withModelGiven = await checkDispatch(root, {
      agent: "local-board-designer",
      model: "sonnet",
      ticketId: "T-null-model",
    });
    assert.equal(withModelGiven.code, 0);
    assert.equal(withModelGiven.body.reason, "match");

    const withModelOmitted = await checkDispatch(root, {
      agent: "local-board-designer",
      ticketId: "T-null-model",
    });
    assert.equal(withModelOmitted.code, 0);
    assert.equal(withModelOmitted.body.reason, "match");
  });
});

test("check-dispatch: no active step for the scanned agent denies", async () => {
  await withBoard(async (root) => {
    const result = await runCli(["--root", root, "check-dispatch", "--agent", "local-board-implementer"]);
    assert.equal(result.code, 1);
    assert.deepEqual(JSON.parse(result.stdout), { ok: false, reason: "no-active-step-for-agent" });
  });
});

test("check-dispatch: non-local-board agent passes through regardless of ledger state", async () => {
  await withBoard(async (root) => {
    const result = await runCli(["--root", root, "check-dispatch", "--agent", "some-other-agent"]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { ok: true, reason: "not-local-board-agent" });
  });
});

test("check-dispatch: without --ticket scans the ledger for a matching agent+model", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Scan mode match", {
      status: "ready_for_implementation",
      now: new Date("2026-07-07T10:34:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "begin-step", ticketId, "--json"])).code, 0);

    const result = await runCli([
      "--root",
      root,
      "check-dispatch",
      "--agent",
      "local-board-implementer",
      "--model",
      "sonnet",
    ]);
    assert.equal(result.code, 0, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.equal(body.ok, true);
    assert.equal(body.ticket, ticketId);
    assert.deepEqual(body.expected, { agent: "local-board-implementer", model: "sonnet" });
  });
});

test("check-dispatch: scan mode with --model omitted passes with model-unverifiable when the matched step pins a model", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Scan mode model omitted", {
      status: "ready_for_implementation",
      now: new Date("2026-07-07T10:33:30Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "begin-step", ticketId, "--json"])).code, 0);

    const result = await runCli(["--root", root, "check-dispatch", "--agent", "local-board-implementer"]);
    assert.equal(result.code, 0, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.equal(body.ok, true);
    assert.equal(body.reason, "model-unverifiable");
    assert.equal(body.ticket, ticketId);
    assert.deepEqual(body.expected, { agent: "local-board-implementer", model: "sonnet" });
  });
});

test("check-dispatch: --ticket resolves from the ledger snapshot even after config changes", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Ledger snapshot beats live config", {
      status: "ready_for_implementation",
      now: new Date("2026-07-07T10:35:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "begin-step", ticketId, "--json"])).code, 0);

    // Re-pin the configured model after begin-step; the already-stamped ledger
    // record must still report the model that was pinned at begin time.
    const configPath = path.join(root, "plans", "local-board.config.jsonc");
    const configText = await readFile(configPath, "utf8");
    await writeFile(
      configPath,
      configText.replace(
        '"implement": { "route": "claude-subagent:local-board-implementer", "model": "sonnet" }',
        '"implement": { "route": "claude-subagent:local-board-implementer", "model": "opus" }',
      ),
      "utf8",
    );

    const viaLedger = await runCli([
      "--root",
      root,
      "check-dispatch",
      "--agent",
      "local-board-implementer",
      "--model",
      "sonnet",
      "--ticket",
      ticketId,
    ]);
    assert.equal(viaLedger.code, 0, viaLedger.stderr);
    assert.equal(JSON.parse(viaLedger.stdout).expected.model, "sonnet", "ledger snapshot must win over live config");

    // A second ticket with no ledger record at all falls back to the live
    // (now-changed) config via resolveExpectedStep.
    const secondTicketPath = await createTicket(root, "task", "No ledger entry falls back to live config", {
      status: "ready_for_implementation",
      now: new Date("2026-07-07T10:36:00Z"),
    });
    const secondTicketId = path.basename(secondTicketPath).split("_", 1)[0];

    const viaFallback = await runCli([
      "--root",
      root,
      "check-dispatch",
      "--agent",
      "local-board-implementer",
      "--model",
      "opus",
      "--ticket",
      secondTicketId,
    ]);
    assert.equal(viaFallback.code, 0, viaFallback.stderr);
    assert.equal(JSON.parse(viaFallback.stdout).expected.model, "opus", "no ledger entry must fall back to live config");
  });
});

test("check-dispatch: --ticket works for an active-status ticket with no ledger record (resolveExpectedStep fallback)", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Active status, no ledger entry", {
      status: "implementing",
      now: new Date("2026-07-07T10:34:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const result = await runCli([
      "--root",
      root,
      "check-dispatch",
      "--agent",
      "local-board-implementer",
      "--model",
      "sonnet",
      "--ticket",
      ticketId,
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      reason: "match",
      expected: { agent: "local-board-implementer", model: "sonnet" },
      ticket: ticketId,
    });
  });
});

test("check-dispatch: unknown ticket with no ledger record returns ticket-not-found (exit 2)", async () => {
  await withBoard(async (root) => {
    const result = await runCli([
      "--root",
      root,
      "check-dispatch",
      "--agent",
      "local-board-implementer",
      "--ticket",
      "T99999999T9999Z",
    ]);
    assert.equal(result.code, 2);
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: false,
      reason: "ticket-not-found",
      ticket: "T99999999T9999Z",
    });
  });
});

test("check-dispatch: missing --agent is a bad-args error (exit 2, plain stderr message)", async () => {
  await withBoard(async (root) => {
    const result = await runCli(["--root", root, "check-dispatch"]);
    assert.equal(result.code, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /check-dispatch requires: --agent/);
  });
});

test("check-dispatch: a corrupt ledger is an error (exit 2, JSON verdict on stdout) rather than a silent pass", async () => {
  await withBoard(async (root) => {
    const filePath = await ledgerPath(root);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "{not valid json", "utf8");

    const result = await runCli(["--root", root, "check-dispatch", "--agent", "local-board-implementer"]);
    assert.equal(result.code, 2);
    const body = JSON.parse(result.stdout);
    assert.equal(body.ok, false);
    assert.equal(body.reason, "error");
    assert.match(body.error, /active-steps ledger.*is corrupt/);
  });
});

async function hasGit() {
  try {
    await execFileAsync("git", ["--version"], { encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

async function git(root, args) {
  await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });
}

async function runCli(args) {
  const stdout = [];
  const stderr = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (message = "") => stdout.push(String(message));
  console.error = (message = "") => stderr.push(String(message));
  try {
    const code = await main(args);
    return {
      code,
      stdout: stdout.join("\n"),
      stderr: stderr.join("\n"),
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}
