import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  clearActiveStepIf,
  clearActiveStepStrict,
  ledgerPath,
  readActiveSteps,
  stampActiveStep,
  stampActiveStepNoClobber,
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

test("check-dispatch (T20260710T1532Z, D5): action-path fallback model is accepted, unlisted is refused, pin/codex-default still accepted; a fallback-free stamp gates by modelSatisfies alone", async () => {
  await withBoard(async (root) => {
    // Ledger record carrying fallbackModels, as begin-step now stamps when
    // the resolved profile lists a non-empty fallbackModels (D6).
    await stampActiveStep(root, "T-fallback-action", {
      ticket: "T-fallback-action",
      kind: "action",
      action: "review",
      route: "claude-subagent:local-board-reviewer",
      model: "gpt-5.6-terra",
      fallbackModels: ["gpt-5.5"],
    });

    const fallbackAccepted = await checkDispatch(root, {
      agent: "local-board-reviewer",
      model: "gpt-5.5",
      ticketId: "T-fallback-action",
    });
    assert.equal(fallbackAccepted.code, 0);
    assert.equal(fallbackAccepted.body.reason, "match");

    const unlisted = await checkDispatch(root, {
      agent: "local-board-reviewer",
      model: "gpt-4o",
      ticketId: "T-fallback-action",
    });
    assert.equal(unlisted.code, 1);
    assert.equal(unlisted.body.reason, "model-mismatch");

    const pinned = await checkDispatch(root, {
      agent: "local-board-reviewer",
      model: "gpt-5.6-terra",
      ticketId: "T-fallback-action",
    });
    assert.equal(pinned.code, 0);
    assert.equal(pinned.body.reason, "match");

    // A fallback-free ledger record for a different ticket gates by
    // modelSatisfies alone -- unlisted model is still refused, no fallback list.
    await stampActiveStep(root, "T-no-fallback-action", {
      ticket: "T-no-fallback-action",
      kind: "action",
      action: "review",
      route: "claude-subagent:local-board-reviewer",
      model: "gpt-5.6-terra",
    });
    const noFallbackDenied = await checkDispatch(root, {
      agent: "local-board-reviewer",
      model: "gpt-5.5",
      ticketId: "T-no-fallback-action",
    });
    assert.equal(noFallbackDenied.code, 1);
    assert.equal(noFallbackDenied.body.reason, "model-mismatch");
  });
});

test("checkDispatch (B20260710T2050Z, D7 fix): a fallback-free design-review action stamp is authorized like any other fallback-free action stamp -- pinned model matches, wrong model denies, wrong agent denies, and model omitted is model-unverifiable", async () => {
  await withBoard(async (root) => {
    await stampActiveStep(root, "T-design-review-no-fallback", {
      ticket: "T-design-review-no-fallback",
      kind: "action",
      action: "design-review",
      route: "claude-subagent:local-board-reviewer",
      model: "sonnet",
      root: path.resolve(root),
      ts: "2026-07-11T00:00:00Z",
    });

    const pinned = await checkDispatch(root, {
      agent: "local-board-reviewer",
      model: "sonnet",
      ticketId: "T-design-review-no-fallback",
    });
    assert.equal(pinned.code, 0);
    assert.equal(pinned.body.reason, "match");

    const wrongModel = await checkDispatch(root, {
      agent: "local-board-reviewer",
      model: "opus",
      ticketId: "T-design-review-no-fallback",
    });
    assert.equal(wrongModel.code, 1);
    assert.equal(wrongModel.body.reason, "model-mismatch");

    const wrongAgent = await checkDispatch(root, {
      agent: "local-board-designer",
      model: "sonnet",
      ticketId: "T-design-review-no-fallback",
    });
    assert.equal(wrongAgent.code, 1);
    assert.equal(wrongAgent.body.reason, "agent-mismatch");
    assert.deepEqual(wrongAgent.body.expected, { agent: "local-board-reviewer", model: "sonnet" });

    const modelOmitted = await checkDispatch(root, {
      agent: "local-board-reviewer",
      ticketId: "T-design-review-no-fallback",
    });
    assert.equal(modelOmitted.code, 0);
    assert.equal(modelOmitted.body.reason, "model-unverifiable");

    // Scan mode (no --ticket): checkDispatchByScan must resolve the same
    // fallback-free design-review stamp by route/model when the caller
    // doesn't know the ticket id up front.
    const scanPinned = await checkDispatch(root, { agent: "local-board-reviewer", model: "sonnet" });
    assert.equal(scanPinned.code, 0);
    assert.equal(scanPinned.body.reason, "match");
    assert.equal(scanPinned.body.ticket, "T-design-review-no-fallback");
    assert.deepEqual(scanPinned.body.expected, { agent: "local-board-reviewer", model: "sonnet" });

    const scanWrongModel = await checkDispatch(root, { agent: "local-board-reviewer", model: "opus" });
    assert.equal(scanWrongModel.code, 1);
    assert.deepEqual(scanWrongModel.body, { ok: false, reason: "no-active-step-for-agent" });

    const scanWrongAgent = await checkDispatch(root, { agent: "local-board-designer", model: "sonnet" });
    assert.equal(scanWrongAgent.code, 1);
    assert.deepEqual(scanWrongAgent.body, { ok: false, reason: "no-active-step-for-agent" });
  });
});

test("check-dispatch (T20260710T1532Z, D5/D7): no-ledger path threads the status action's fallbackModels", async () => {
  await withBoard(async (root) => {
    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      JSON.stringify({
        agents: {
          implement: {
            route: "claude-subagent:local-board-implementer",
            model: "sonnet",
            fallbackModels: ["haiku-fallback"],
          },
        },
      }),
      "utf8",
    );

    const ticketPath = await createTicket(root, "task", "No-ledger fallback resolution", {
      status: "implementing",
      now: new Date("2026-07-07T10:33:40Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const fallbackAccepted = await runCli([
      "--root", root, "check-dispatch", "--agent", "local-board-implementer", "--model", "haiku-fallback", "--ticket", ticketId,
    ]);
    assert.equal(fallbackAccepted.code, 0, fallbackAccepted.stderr);
    assert.equal(JSON.parse(fallbackAccepted.stdout).reason, "match");

    const unlisted = await runCli([
      "--root", root, "check-dispatch", "--agent", "local-board-implementer", "--model", "gpt-4o", "--ticket", ticketId,
    ]);
    assert.equal(unlisted.code, 1);
    assert.equal(JSON.parse(unlisted.stdout).reason, "model-mismatch");
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

// --- Gate/specialty consultation stamping (B20260710T1225Z) ---

test("gate-check stamps a scoped gate consultation entry; check-dispatch allows the correctly-routed gate dispatch at each gated stage boundary", async () => {
  await withBoard(async (root) => {
    // Give the "test" stage a non-empty catalog too (the seeded default
    // leaves it empty), so all three gated stages exercise the non-skip
    // stamp path.
    const configPath = path.join(root, "plans", "local-board.config.jsonc");
    const configText = await readFile(configPath, "utf8");
    await writeFile(
      configPath,
      configText.replace(
        '"test": []',
        '"test": [{ "name": "regression_notes", "prompt": "plans/prompts/optional-steps/test/regression_notes.md", "triggers": "Any change." }]',
      ),
      "utf8",
    );
    await mkdir(path.join(root, "plans", "prompts", "optional-steps", "test"), { recursive: true });
    await writeFile(
      path.join(root, "plans", "prompts", "optional-steps", "test", "regression_notes.md"),
      "# Regression Notes\n",
      "utf8",
    );

    const stages = [
      { stage: "design", status: "ready_for_design", action: "design", executor: "claude-subagent:local-board-designer@opus" },
      { stage: "implement", status: "ready_for_implementation", action: "implement", executor: "claude-subagent:local-board-implementer@sonnet" },
      { stage: "test", status: "ready_for_test", action: "test", executor: "claude-subagent:local-board-tester@sonnet" },
    ];

    for (const { stage, status, action, executor } of stages) {
      const create = await runCli(["--root", root, "create", "task", `Gate boundary ${stage}`, "--status", status, "--priority", "P2"]);
      assert.equal(create.code, 0, create.stderr);
      const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

      if (action === "design") {
        assert.equal((await runCli(["--root", root, "estimate", ticketId, "2"])).code, 0);
      }
      assert.equal((await runCli(["--root", root, "begin-step", ticketId, "--json"])).code, 0);

      const complete = await runCli([
        "--root", root, "complete-step", ticketId, action,
        "--executor", executor, "--evidence", "Done.", "--json",
      ]);
      assert.equal(complete.code, 0, complete.stderr);
      // complete-step clears the action ledger entry (existing behaviour).
      assert.equal(Object.hasOwn(await readActiveSteps(root), ticketId), false);

      const gate = await runCli(["--root", root, "gate-check", ticketId, "--stage", stage, "--json"]);
      assert.equal(gate.code, 0, gate.stderr);
      assert.equal(JSON.parse(gate.stdout).skip, false);

      const steps = await readActiveSteps(root);
      assert.equal(steps[ticketId].kind, "gate");
      assert.equal(steps[ticketId].stage, stage);
      assert.equal(steps[ticketId].route, "claude-subagent:local-board-gatecheck");
      assert.equal(steps[ticketId].model, "haiku");

      const dispatch = await runCli([
        "--root", root, "check-dispatch",
        "--agent", "local-board-gatecheck", "--model", "haiku", "--ticket", ticketId,
      ]);
      assert.equal(dispatch.code, 0, dispatch.stderr);
      assert.deepEqual(JSON.parse(dispatch.stdout), {
        ok: true,
        reason: "match",
        expected: { agent: "local-board-gatecheck", model: "haiku" },
        ticket: ticketId,
      });
    }
  });
});

test("check-dispatch denies a misrouted gate dispatch, and denies a gate dispatch when no consultation was ever stamped (fallback to the action route)", async () => {
  await withBoard(async (root) => {
    const create = await runCli(["--root", root, "create", "task", "Gate misroute", "--status", "ready_for_design", "--priority", "P2"]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "estimate", ticketId, "2"])).code, 0);
    assert.equal((await runCli(["--root", root, "begin-step", ticketId, "--json"])).code, 0);
    assert.equal(
      (
        await runCli([
          "--root", root, "complete-step", ticketId, "design",
          "--executor", "claude-subagent:local-board-designer@opus",
          "--evidence", "Designed.", "--json",
        ])
      ).code,
      0,
    );

    // No gate-check has run yet: the ledger is empty (complete-step cleared
    // the action record). check-dispatch falls back to the *action* route
    // (designer), so a gate-agent dispatch is denied -- proving the stamp,
    // not the agent name, is what authorises a gate dispatch.
    const beforeGateCheck = await runCli([
      "--root", root, "check-dispatch",
      "--agent", "local-board-gatecheck", "--model", "haiku", "--ticket", ticketId,
    ]);
    assert.equal(beforeGateCheck.code, 1);
    assert.deepEqual(JSON.parse(beforeGateCheck.stdout), {
      ok: false,
      reason: "agent-mismatch",
      expected: { agent: "local-board-designer", model: "opus" },
      ticket: ticketId,
    });

    assert.equal((await runCli(["--root", root, "gate-check", ticketId, "--stage", "design", "--json"])).code, 0);

    // A misrouted dispatch (wrong agent) still denies once the consultation
    // stamp exists.
    const misrouted = await runCli(["--root", root, "check-dispatch", "--agent", "local-board-tester", "--ticket", ticketId]);
    assert.equal(misrouted.code, 1);
    assert.deepEqual(JSON.parse(misrouted.stdout), {
      ok: false,
      reason: "agent-mismatch",
      expected: { agent: "local-board-gatecheck", model: "haiku" },
      ticket: ticketId,
    });

    // The correctly-routed gate dispatch is now allowed.
    const correct = await runCli([
      "--root", root, "check-dispatch",
      "--agent", "local-board-gatecheck", "--model", "haiku", "--ticket", ticketId,
    ]);
    assert.equal(correct.code, 0, correct.stderr);
    assert.equal(JSON.parse(correct.stdout).reason, "match");
  });
});

test("gate-complete clears the gate consultation ledger entry, so a later gate dispatch falls back to the action route and denies", async () => {
  await withBoard(async (root) => {
    const create = await runCli(["--root", root, "create", "task", "Gate-complete clears", "--status", "ready_for_design", "--priority", "P2"]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "estimate", ticketId, "2"])).code, 0);
    assert.equal((await runCli(["--root", root, "begin-step", ticketId, "--json"])).code, 0);
    assert.equal(
      (
        await runCli([
          "--root", root, "complete-step", ticketId, "design",
          "--executor", "claude-subagent:local-board-designer@opus",
          "--evidence", "Designed.", "--json",
        ])
      ).code,
      0,
    );
    assert.equal((await runCli(["--root", root, "gate-check", ticketId, "--stage", "design", "--json"])).code, 0);
    assert.ok(Object.hasOwn(await readActiveSteps(root), ticketId), "gate-check must stamp the consultation entry");

    assert.equal(
      (
        await runCli([
          "--root", root, "gate-complete", ticketId,
          "--stage", "design",
          "--executor", "claude-subagent:local-board-gatecheck@haiku",
          "--evidence", "security_threat_model", "--json",
        ])
      ).code,
      0,
    );
    assert.equal(Object.hasOwn(await readActiveSteps(root), ticketId), false, "gate-complete must clear the ledger entry");

    const afterComplete = await runCli([
      "--root", root, "check-dispatch",
      "--agent", "local-board-gatecheck", "--model", "haiku", "--ticket", ticketId,
    ]);
    assert.equal(afterComplete.code, 1);
    assert.deepEqual(JSON.parse(afterComplete.stdout), {
      ok: false,
      reason: "agent-mismatch",
      expected: { agent: "local-board-designer", model: "opus" },
      ticket: ticketId,
    });
  });
});

test("specialty-run stamps a scoped consultation entry for a claude-subagent profile; check-dispatch allows it (and reports model-unverifiable with --model omitted)", async () => {
  await withBoard(async (root) => {
    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      JSON.stringify({
        version: 1,
        optionalSteps: {
          design: [
            {
              name: "custom_review",
              prompt: "plans/prompts/optional-steps/design/custom_review.md",
              triggers: "Anything.",
              agent: { route: "claude-subagent:local-board-reviewer", model: "opus" },
            },
          ],
          implement: [],
          test: [],
        },
      }),
      "utf8",
    );
    await mkdir(path.join(root, "plans", "prompts", "optional-steps", "design"), { recursive: true });
    await writeFile(
      path.join(root, "plans", "prompts", "optional-steps", "design", "custom_review.md"),
      "# Custom Review\n",
      "utf8",
    );

    const create = await runCli(["--root", root, "create", "task", "Specialty consultation", "--status", "ready_for_design", "--priority", "P2"]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const run = await runCli(["--root", root, "specialty-run", ticketId, "custom_review", "--json"]);
    assert.equal(run.code, 0, run.stderr);

    const steps = await readActiveSteps(root);
    assert.equal(steps[ticketId].kind, "specialty");
    assert.equal(steps[ticketId].action, "custom_review");
    assert.equal(steps[ticketId].stage, "design");
    assert.equal(steps[ticketId].route, "claude-subagent:local-board-reviewer");
    assert.equal(steps[ticketId].model, "opus");

    const withModel = await runCli([
      "--root", root, "check-dispatch",
      "--agent", "local-board-reviewer", "--model", "opus", "--ticket", ticketId,
    ]);
    assert.equal(withModel.code, 0, withModel.stderr);
    assert.equal(JSON.parse(withModel.stdout).reason, "match");

    const withoutModel = await runCli(["--root", root, "check-dispatch", "--agent", "local-board-reviewer", "--ticket", ticketId]);
    assert.equal(withoutModel.code, 0, withoutModel.stderr);
    assert.equal(JSON.parse(withoutModel.stdout).reason, "model-unverifiable");
  });
});

test(
  "check-dispatch: stale-main-root fallback resolves the expected route via the ticket's registered worktree",
  { skip: !GIT_AVAILABLE },
  async () => {
    await withRepo(async (root) => {
      // Zero out optionalSteps so gate-check's empty-catalog auto-stamp
      // satisfies requireGateConsultation without a real agent dispatch --
      // this test targets Decision 2 (stale-root fallback), not Decision 1
      // (consultation stamping), which has dedicated tests above.
      await writeFile(
        path.join(root, "plans", "local-board.config.jsonc"),
        JSON.stringify({ version: 1, optionalSteps: { design: [], implement: [], test: [] } }),
        "utf8",
      );
      await git(root, ["add", "plans"]);
      await git(root, ["commit", "-m", "Zero optionalSteps for worktree fallback test"]);

      const ticketPath = await createTicket(root, "task", "Stale main root fallback", {
        status: "ready_for_implementation",
        now: new Date("2026-07-10T14:00:00Z"),
      });
      await git(root, ["add", "plans"]);
      await git(root, ["commit", "-m", "Add ticket"]);
      const ticketId = path.basename(ticketPath).split("_", 1)[0];

      const worktree = await addTicketWorktree(root, ticketId);

      // Advance status inside the worktree, past two transitions (the first
      // gate-satisfied via the empty-catalog auto-stamp, the second gate-free),
      // so the worktree's ticket file diverges from the main checkout's stale
      // copy (still "ready_for_implementation").
      assert.equal((await runCli(["--root", worktree.worktreePath, "begin-step", ticketId, "--json"])).code, 0);
      assert.equal(
        (
          await runCli([
            "--root", worktree.worktreePath, "complete-step", ticketId, "implement",
            "--executor", "claude-subagent:local-board-implementer@sonnet",
            "--evidence", "Implemented.", "--json",
          ])
        ).code,
        0,
      );
      assert.equal(
        (await runCli(["--root", worktree.worktreePath, "gate-check", ticketId, "--stage", "implement", "--json"])).code,
        0,
      );
      assert.equal(
        (await runCli(["--root", worktree.worktreePath, "move", ticketId, "ready_for_review", "--json"])).code,
        0,
      );
      assert.equal(
        (await runCli(["--root", worktree.worktreePath, "move", ticketId, "ready_for_test", "--json"])).code,
        0,
      );

      // No ledger entry at this point (begin-step's stamp was cleared by
      // complete-step). check-dispatch invoked from the MAIN checkout (as the
      // hook would be) must resolve the expected route from the WORKTREE's
      // current status ("ready_for_test" -> test -> tester/sonnet), not the
      // main checkout's stale copy ("ready_for_implementation" -> implement).
      const viaWorktree = await runCli([
        "--root", root, "check-dispatch",
        "--agent", "local-board-tester", "--model", "sonnet", "--ticket", ticketId,
      ]);
      assert.equal(viaWorktree.code, 0, viaWorktree.stderr);
      assert.deepEqual(JSON.parse(viaWorktree.stdout), {
        ok: true,
        reason: "match",
        expected: { agent: "local-board-tester", model: "sonnet" },
        ticket: ticketId,
      });

      // Control: a ticket with no registered worktree still resolves from the
      // invocation root unchanged -- today's behaviour, unaffected by the fix.
      const controlPath = await createTicket(root, "task", "No worktree control", {
        status: "ready_for_implementation",
        now: new Date("2026-07-10T14:05:00Z"),
      });
      const controlId = path.basename(controlPath).split("_", 1)[0];
      const control = await runCli([
        "--root", root, "check-dispatch",
        "--agent", "local-board-implementer", "--model", "sonnet", "--ticket", controlId,
      ]);
      assert.equal(control.code, 0, control.stderr);
      assert.equal(JSON.parse(control.stdout).reason, "match");
    });
  },
);

test(
  "check-dispatch: a registered-but-missing worktree directory (manually removed, not pruned) falls back to the invocation root instead of erroring",
  { skip: !GIT_AVAILABLE },
  async () => {
    await withRepo(async (root) => {
      const ticketPath = await createTicket(root, "task", "Missing worktree dir fallback", {
        status: "ready_for_implementation",
        now: new Date("2026-07-10T15:00:00Z"),
      });
      await git(root, ["add", "plans"]);
      await git(root, ["commit", "-m", "Add ticket"]);
      const ticketId = path.basename(ticketPath).split("_", 1)[0];

      const worktree = await addTicketWorktree(root, ticketId);
      // Manually remove the worktree directory without `git worktree remove`
      // (which would also drop it from the registry): `git worktree list
      // --porcelain` keeps reporting the now-missing path until `git worktree
      // prune` runs.
      await rm(worktree.worktreePath, { recursive: true, force: true });

      // No ledger entry: check-dispatch falls back. Before the fix,
      // resolveTicketWorktreeRoot would hand back the missing directory,
      // resolveExpectedStep would throw reading a nonexistent ticket file, and
      // checkDispatchForTicket would return ticket-not-found (exit 2) -- the
      // hook fail-opens for every agent instead of validating against the
      // main checkout. After the fix, the missing directory is detected and
      // the fallback resolves against `root` (the invocation root / main
      // checkout) instead, producing a real verdict.
      const dispatch = await runCli([
        "--root", root, "check-dispatch",
        "--agent", "local-board-implementer", "--model", "sonnet", "--ticket", ticketId,
      ]);
      assert.equal(dispatch.code, 0, dispatch.stderr);
      assert.deepEqual(JSON.parse(dispatch.stdout), {
        ok: true,
        reason: "match",
        expected: { agent: "local-board-implementer", model: "sonnet" },
        ticket: ticketId,
      });
    });
  },
);

// --- No-clobber consultation stamps (B20260710T1225Z review finding 1) ---

test(
  "gate-check does not clobber a live begin-step (action) stamp; it warns and leaves the action entry intact",
  async () => {
    await withBoard(async (root) => {
      const create = await runCli(["--root", root, "create", "task", "Gate before complete-step", "--status", "ready_for_design", "--priority", "P2"]);
      assert.equal(create.code, 0, create.stderr);
      const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];
      assert.equal((await runCli(["--root", root, "estimate", ticketId, "2"])).code, 0);
      assert.equal((await runCli(["--root", root, "begin-step", ticketId, "--json"])).code, 0);

      const beforeGate = (await readActiveSteps(root))[ticketId];
      assert.equal(beforeGate.kind, "action");
      assert.equal(beforeGate.route, "claude-subagent:local-board-designer");

      // Out-of-order use: gate-check runs before complete-step, so the action
      // stamp is still live. It must not be silently overwritten.
      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (message = "") => warnings.push(String(message));
      let gate;
      try {
        gate = await runCli(["--root", root, "gate-check", ticketId, "--stage", "design", "--json"]);
      } finally {
        console.warn = originalWarn;
      }
      assert.equal(gate.code, 0, gate.stderr);
      assert.ok(
        warnings.some((message) => message.includes(ticketId) && message.includes("not stamped")),
        `expected a not-stamped warning naming ${ticketId}, got: ${JSON.stringify(warnings)}`,
      );

      const afterGate = (await readActiveSteps(root))[ticketId];
      assert.deepEqual(afterGate, beforeGate, "the live action stamp must survive the conflicting gate-check");

      const dispatch = await runCli([
        "--root", root, "check-dispatch",
        "--agent", "local-board-designer", "--model", "opus", "--ticket", ticketId,
      ]);
      assert.equal(dispatch.code, 0, dispatch.stderr);
      assert.equal(JSON.parse(dispatch.stdout).reason, "match", "the still-legitimate designer dispatch must remain authorized");
    });
  },
);

test(
  "specialty-run does not clobber a different in-flight specialty stamp; it warns and leaves the first entry intact",
  async () => {
    await withBoard(async (root) => {
      await writeFile(
        path.join(root, "plans", "local-board.config.jsonc"),
        JSON.stringify({
          version: 1,
          optionalSteps: {
            design: [
              {
                name: "custom_review",
                prompt: "plans/prompts/optional-steps/design/custom_review.md",
                triggers: "Anything.",
                agent: { route: "claude-subagent:local-board-reviewer", model: "opus" },
              },
              {
                name: "second_review",
                prompt: "plans/prompts/optional-steps/design/second_review.md",
                triggers: "Anything else.",
                agent: { route: "claude-subagent:local-board-tester", model: "sonnet" },
              },
            ],
            implement: [],
            test: [],
          },
        }),
        "utf8",
      );
      await mkdir(path.join(root, "plans", "prompts", "optional-steps", "design"), { recursive: true });
      await writeFile(
        path.join(root, "plans", "prompts", "optional-steps", "design", "custom_review.md"),
        "# Custom Review\n",
        "utf8",
      );
      await writeFile(
        path.join(root, "plans", "prompts", "optional-steps", "design", "second_review.md"),
        "# Second Review\n",
        "utf8",
      );

      const create = await runCli(["--root", root, "create", "task", "Two in-flight specialties", "--status", "ready_for_design", "--priority", "P2"]);
      assert.equal(create.code, 0, create.stderr);
      const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

      assert.equal((await runCli(["--root", root, "specialty-run", ticketId, "custom_review", "--json"])).code, 0);
      const beforeSecond = (await readActiveSteps(root))[ticketId];
      assert.equal(beforeSecond.action, "custom_review");

      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (message = "") => warnings.push(String(message));
      let secondRun;
      try {
        secondRun = await runCli(["--root", root, "specialty-run", ticketId, "second_review", "--json"]);
      } finally {
        console.warn = originalWarn;
      }
      assert.equal(secondRun.code, 0, secondRun.stderr);
      assert.ok(
        warnings.some((message) => message.includes(ticketId) && message.includes("not stamped")),
        `expected a not-stamped warning naming ${ticketId}, got: ${JSON.stringify(warnings)}`,
      );

      const afterSecond = (await readActiveSteps(root))[ticketId];
      assert.deepEqual(
        afterSecond,
        beforeSecond,
        "the first in-flight specialty stamp must survive the conflicting second specialty-run",
      );

      const dispatch = await runCli([
        "--root", root, "check-dispatch",
        "--agent", "local-board-reviewer", "--model", "opus", "--ticket", ticketId,
      ]);
      assert.equal(dispatch.code, 0, dispatch.stderr);
      assert.equal(JSON.parse(dispatch.stdout).reason, "match", "the first-run specialty dispatch must remain authorized");
    });
  },
);

// --- Identity-complete collisions (B20260710T1225Z re-review: idempotent
// match must compare action/stage too, not just kind+route+model) ---

test(
  "gate-check for a different stage with the SAME gate profile is a conflict, not an idempotent match",
  async () => {
    await withBoard(async (root) => {
      const create = await runCli(["--root", root, "create", "task", "Same gate profile, different stage", "--status", "ready_for_design", "--priority", "P2"]);
      assert.equal(create.code, 0, create.stderr);
      const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

      // Default board config gives both "design" and "implement" a non-empty
      // catalog and both stages resolve the SAME configured gate profile
      // (agents["gate-check"]: claude-subagent:local-board-gatecheck@haiku).
      // Before the fix, `isIdempotentStampMatch` compared only kind+route+
      // model, so this second gate-check (a different stage) would have been
      // wrongly treated as a harmless re-stamp of the FIRST gate-check and
      // silently overwritten it -- losing the "design" stage's authorization.
      const first = await runCli(["--root", root, "gate-check", ticketId, "--stage", "design", "--json"]);
      assert.equal(first.code, 0, first.stderr);
      const beforeSecond = (await readActiveSteps(root))[ticketId];
      assert.equal(beforeSecond.stage, "design");
      assert.equal(beforeSecond.route, "claude-subagent:local-board-gatecheck");
      assert.equal(beforeSecond.model, "haiku");

      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (message = "") => warnings.push(String(message));
      let second;
      try {
        second = await runCli(["--root", root, "gate-check", ticketId, "--stage", "implement", "--json"]);
      } finally {
        console.warn = originalWarn;
      }
      assert.equal(second.code, 0, second.stderr);
      assert.ok(
        warnings.some((message) => message.includes(ticketId) && message.includes("not stamped")),
        `expected a not-stamped warning naming ${ticketId}, got: ${JSON.stringify(warnings)}`,
      );

      const afterSecond = (await readActiveSteps(root))[ticketId];
      assert.deepEqual(
        afterSecond,
        beforeSecond,
        "the design-stage gate stamp must survive a same-profile gate-check for a different stage",
      );
    });
  },
);

test(
  "specialty-run for a different specialty with the SAME agent route/model is a conflict, not an idempotent match",
  async () => {
    await withBoard(async (root) => {
      // Two specialty entries in the same stage, deliberately configured with
      // the identical agent (route+model). Before the fix, the second run's
      // stamp would have matched the first on kind+route+model alone and been
      // treated as a harmless self-heal re-stamp -- silently overwriting the
      // still-live first specialty's authorization.
      await writeFile(
        path.join(root, "plans", "local-board.config.jsonc"),
        JSON.stringify({
          version: 1,
          optionalSteps: {
            design: [
              {
                name: "custom_review",
                prompt: "plans/prompts/optional-steps/design/custom_review.md",
                triggers: "Anything.",
                agent: { route: "claude-subagent:local-board-reviewer", model: "opus" },
              },
              {
                name: "second_review",
                prompt: "plans/prompts/optional-steps/design/second_review.md",
                triggers: "Anything else.",
                agent: { route: "claude-subagent:local-board-reviewer", model: "opus" },
              },
            ],
            implement: [],
            test: [],
          },
        }),
        "utf8",
      );
      await mkdir(path.join(root, "plans", "prompts", "optional-steps", "design"), { recursive: true });
      await writeFile(
        path.join(root, "plans", "prompts", "optional-steps", "design", "custom_review.md"),
        "# Custom Review\n",
        "utf8",
      );
      await writeFile(
        path.join(root, "plans", "prompts", "optional-steps", "design", "second_review.md"),
        "# Second Review\n",
        "utf8",
      );

      const create = await runCli(["--root", root, "create", "task", "Same route/model, different specialty", "--status", "ready_for_design", "--priority", "P2"]);
      assert.equal(create.code, 0, create.stderr);
      const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

      assert.equal((await runCli(["--root", root, "specialty-run", ticketId, "custom_review", "--json"])).code, 0);
      const beforeSecond = (await readActiveSteps(root))[ticketId];
      assert.equal(beforeSecond.action, "custom_review");
      assert.equal(beforeSecond.route, "claude-subagent:local-board-reviewer");
      assert.equal(beforeSecond.model, "opus");

      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (message = "") => warnings.push(String(message));
      let second;
      try {
        second = await runCli(["--root", root, "specialty-run", ticketId, "second_review", "--json"]);
      } finally {
        console.warn = originalWarn;
      }
      assert.equal(second.code, 0, second.stderr);
      assert.ok(
        warnings.some((message) => message.includes(ticketId) && message.includes("not stamped")),
        `expected a not-stamped warning naming ${ticketId}, got: ${JSON.stringify(warnings)}`,
      );

      const afterSecond = (await readActiveSteps(root))[ticketId];
      assert.deepEqual(
        afterSecond,
        beforeSecond,
        "the custom_review stamp must survive a same-route/model specialty-run for a different specialty",
      );
    });
  },
);

// --- Stamp identity + abandonment cleanup (B20260710T1225Z review finding 2) ---

test(
  "complete-step clears only its own action entry (by kind), preserving a newer gate stamp created before the clear runs",
  async () => {
    await withBoard(async (root) => {
      const create = await runCli(["--root", root, "create", "task", "Clear by identity", "--status", "ready_for_implementation", "--priority", "P2"]);
      assert.equal(create.code, 0, create.stderr);
      const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];
      assert.equal((await runCli(["--root", root, "begin-step", ticketId, "--json"])).code, 0);

      // Simulate a gate stamp landing between complete-step's ticket write and
      // its ledger clear (e.g. a gate-check that ran concurrently for this
      // ticket). A real production race is timing-dependent; overwriting the
      // ledger directly makes the race deterministic for the test.
      const newerStamp = {
        ticket: ticketId,
        kind: "gate",
        action: "gate-check",
        stage: "implement",
        route: "claude-subagent:local-board-gatecheck",
        model: "haiku",
        root: path.resolve(root),
        ts: "2026-07-10T12:00:00Z",
      };
      await stampActiveStep(root, ticketId, newerStamp);

      const complete = await runCli([
        "--root", root, "complete-step", ticketId, "implement",
        "--executor", "claude-subagent:local-board-implementer@sonnet",
        "--evidence", "Implemented.", "--json",
      ]);
      assert.equal(complete.code, 0, complete.stderr);

      const steps = await readActiveSteps(root);
      assert.deepEqual(
        steps[ticketId],
        newerStamp,
        "complete-step must not clear a gate-kind entry it doesn't correspond to",
      );
    });
  },
);

test(
  "a stale gate-complete for an earlier stage does not clear a NEWER gate stamp for a different stage (re-review 2: same-kind clears must compare full identity)",
  async () => {
    await withBoard(async (root) => {
      const create = await runCli(["--root", root, "create", "task", "Stale gate-complete, newer stage stamp", "--status", "ready_for_design", "--priority", "P2"]);
      assert.equal(create.code, 0, create.stderr);
      const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];
      assert.equal((await runCli(["--root", root, "estimate", ticketId, "2"])).code, 0);
      assert.equal((await runCli(["--root", root, "begin-step", ticketId, "--json"])).code, 0);
      assert.equal(
        (
          await runCli([
            "--root", root, "complete-step", ticketId, "design",
            "--executor", "claude-subagent:local-board-designer@opus",
            "--evidence", "Designed.", "--json",
          ])
        ).code,
        0,
      );
      assert.equal((await runCli(["--root", root, "gate-check", ticketId, "--stage", "design", "--json"])).code, 0);

      // Simulate a fresh "implement" gate-check landing before this stale
      // "design" gate-complete gets around to clearing -- e.g. the ticket
      // looped forward and a new consultation was already stamped for the
      // next gated stage by the time this delayed/retried gate-complete call
      // for "design" runs. Overwriting the ledger directly (rather than a
      // second real gate-check call, which would itself be a no-clobber
      // conflict against the still-live "design" entry) makes the race
      // deterministic for the test.
      const newerStamp = {
        ticket: ticketId,
        kind: "gate",
        action: "gate-check",
        stage: "implement",
        route: "claude-subagent:local-board-gatecheck",
        model: "haiku",
        root: path.resolve(root),
        ts: "2026-07-10T13:00:00Z",
      };
      await stampActiveStep(root, ticketId, newerStamp);

      // Before the fix, `isConsultationLedgerEntry` matched on `kind` alone,
      // so this stale gate-complete for "design" would have cleared the
      // newer "implement" stamp it has nothing to do with.
      const gateComplete = await runCli([
        "--root", root, "gate-complete", ticketId,
        "--stage", "design",
        "--executor", "claude-subagent:local-board-gatecheck@haiku",
        "--evidence", "security_threat_model", "--json",
      ]);
      assert.equal(gateComplete.code, 0, gateComplete.stderr);

      const steps = await readActiveSteps(root);
      assert.deepEqual(
        steps[ticketId],
        newerStamp,
        "gate-complete for a stale stage must not clear a newer gate stamp for a DIFFERENT stage",
      );
    });
  },
);

test(
  "an abandoned gate consultation stamp (gate-check run, never completed) is cleared when the ticket moves to a different status",
  async () => {
    await withBoard(async (root) => {
      const create = await runCli(["--root", root, "create", "task", "Abandoned gate stamp", "--status", "ready_for_design", "--priority", "P2"]);
      assert.equal(create.code, 0, create.stderr);
      const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];
      assert.equal((await runCli(["--root", root, "estimate", ticketId, "2"])).code, 0);
      assert.equal((await runCli(["--root", root, "begin-step", ticketId, "--json"])).code, 0);
      assert.equal(
        (
          await runCli([
            "--root", root, "complete-step", ticketId, "design",
            "--executor", "claude-subagent:local-board-designer@opus",
            "--evidence", "Designed.", "--json",
          ])
        ).code,
        0,
      );
      assert.equal((await runCli(["--root", root, "gate-check", ticketId, "--stage", "design", "--json"])).code, 0);
      assert.ok(Object.hasOwn(await readActiveSteps(root), ticketId), "gate-check must stamp the consultation entry");

      // The gate consultation is abandoned: no gate-complete, the ticket moves
      // to "blocked" (a non-ticket blocker) instead.
      const move = await runCli(["--root", root, "move", ticketId, "blocked", "--json"]);
      assert.equal(move.code, 0, move.stderr);

      assert.equal(
        Object.hasOwn(await readActiveSteps(root), ticketId),
        false,
        "moving the ticket must clear the abandoned gate stamp",
      );
    });
  },
);

test(
  "a same-status move (re-save) does NOT sweep a live consultation stamp; only a real status change abandons it (third review edge case)",
  async () => {
    await withBoard(async (root) => {
      const create = await runCli(["--root", root, "create", "task", "Same-status re-save", "--status", "ready_for_design", "--priority", "P2"]);
      assert.equal(create.code, 0, create.stderr);
      const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];
      assert.equal((await runCli(["--root", root, "estimate", ticketId, "2"])).code, 0);
      assert.equal((await runCli(["--root", root, "begin-step", ticketId, "--json"])).code, 0);
      assert.equal(
        (
          await runCli([
            "--root", root, "complete-step", ticketId, "design",
            "--executor", "claude-subagent:local-board-designer@opus",
            "--evidence", "Designed.", "--json",
          ])
        ).code,
        0,
      );
      assert.equal((await runCli(["--root", root, "gate-check", ticketId, "--stage", "design", "--json"])).code, 0);
      const stamp = (await readActiveSteps(root))[ticketId];
      assert.ok(stamp, "gate-check must stamp the consultation entry");

      // Re-save the ticket at its CURRENT status (ready_for_design ->
      // ready_for_design). This is not an abandonment -- the ticket never
      // left the stage -- so the pending gate consultation must survive.
      const resave = await runCli(["--root", root, "move", ticketId, "ready_for_design", "--json"]);
      assert.equal(resave.code, 0, resave.stderr);

      assert.deepEqual(
        (await readActiveSteps(root))[ticketId],
        stamp,
        "a same-status re-save must not sweep a live consultation stamp",
      );

      // Control: a real status change still sweeps it (existing behaviour,
      // unchanged by this fix).
      const move = await runCli(["--root", root, "move", ticketId, "blocked", "--json"]);
      assert.equal(move.code, 0, move.stderr);
      assert.equal(
        Object.hasOwn(await readActiveSteps(root), ticketId),
        false,
        "a real status change must still sweep the abandoned stamp",
      );
    });
  },
);

test(
  "gate-complete --stage design does NOT clear a live specialty consultation stamp for a design-stage specialty (third review residual); the specialty dispatch still passes check-dispatch",
  async () => {
    await withBoard(async (root) => {
      await writeFile(
        path.join(root, "plans", "local-board.config.jsonc"),
        JSON.stringify({
          version: 1,
          optionalSteps: {
            design: [
              {
                name: "custom_review",
                prompt: "plans/prompts/optional-steps/design/custom_review.md",
                triggers: "Anything.",
                agent: { route: "claude-subagent:local-board-reviewer", model: "opus" },
              },
            ],
            implement: [],
            test: [],
          },
        }),
        "utf8",
      );
      await mkdir(path.join(root, "plans", "prompts", "optional-steps", "design"), { recursive: true });
      await writeFile(
        path.join(root, "plans", "prompts", "optional-steps", "design", "custom_review.md"),
        "# Custom Review\n",
        "utf8",
      );

      const create = await runCli(["--root", root, "create", "task", "Gate-complete must not clear a specialty stamp", "--status", "ready_for_design", "--priority", "P2"]);
      assert.equal(create.code, 0, create.stderr);
      const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

      const run = await runCli(["--root", root, "specialty-run", ticketId, "custom_review", "--json"]);
      assert.equal(run.code, 0, run.stderr);
      const specialtyStamp = (await readActiveSteps(root))[ticketId];
      assert.equal(specialtyStamp.kind, "specialty");
      assert.equal(specialtyStamp.stage, "design");

      // A stale/retried gate-complete for the SAME stage ("design"). Before
      // the fix, isConsultationLedgerEntry matched any "gate" OR "specialty"
      // entry sharing `stage`, so this call would wrongly erase the live
      // specialty stamp even though gate-complete only ever records the GATE
      // agent's verdict.
      const gateComplete = await runCli([
        "--root", root, "gate-complete", ticketId,
        "--stage", "design",
        "--executor", "claude-subagent:local-board-gatecheck@haiku",
        "--evidence", "none", "--json",
      ]);
      assert.equal(gateComplete.code, 0, gateComplete.stderr);

      const steps = await readActiveSteps(root);
      assert.deepEqual(
        steps[ticketId],
        specialtyStamp,
        "gate-complete must not clear a live specialty consultation stamp for the same stage",
      );

      const dispatch = await runCli([
        "--root", root, "check-dispatch",
        "--agent", "local-board-reviewer", "--model", "opus", "--ticket", ticketId,
      ]);
      assert.equal(dispatch.code, 0, dispatch.stderr);
      assert.equal(JSON.parse(dispatch.stdout).reason, "match", "the specialty dispatch must remain authorized after the same-stage gate-complete");
    });
  },
);

test("clearActiveStepIf clears only when the predicate matches the current entry, atomically under the ledger lock", async () => {
  await withBoard(async (root) => {
    await stampActiveStep(root, "T1", { ticket: "T1", kind: "action", action: "design", route: "r1", model: "opus" });

    const notCleared = await clearActiveStepIf(root, "T1", (record) => record.kind === "gate");
    assert.equal(notCleared, false);
    assert.ok(Object.hasOwn(await readActiveSteps(root), "T1"), "predicate mismatch must leave the entry intact");

    const cleared = await clearActiveStepIf(root, "T1", (record) => record.kind === "action");
    assert.equal(cleared, true);
    assert.equal(Object.hasOwn(await readActiveSteps(root), "T1"), false);

    // Missing entry is a no-op, not an error.
    assert.equal(await clearActiveStepIf(root, "T-never-stamped", () => true), false);
  });
});

// --- clearActiveStepStrict (T20260710T2051Z): fail-closed clear ---

test("clearActiveStepStrict on a healthy ledger: predicate match deletes the target entry and leaves other tickets intact", async () => {
  await withBoard(async (root) => {
    await stampActiveStep(root, "T1", { ticket: "T1", kind: "action", action: "design", route: "r1", model: "opus" });
    await stampActiveStep(root, "T2", { ticket: "T2", kind: "action", action: "implement", route: "r2", model: "sonnet" });

    const cleared = await clearActiveStepStrict(root, "T1", (record) => record.kind === "action");
    assert.equal(cleared, true);

    const steps = await readActiveSteps(root);
    assert.equal(Object.hasOwn(steps, "T1"), false);
    assert.equal(steps.T2.action, "implement", "unrelated ticket's entry must survive");
  });
});

test("clearActiveStepStrict on a healthy ledger: predicate mismatch for a present entry is a no-op", async () => {
  await withBoard(async (root) => {
    await stampActiveStep(root, "T1", { ticket: "T1", kind: "action", action: "design", route: "r1", model: "opus" });

    const notCleared = await clearActiveStepStrict(root, "T1", (record) => record.kind === "gate");
    assert.equal(notCleared, false);
    assert.ok(Object.hasOwn(await readActiveSteps(root), "T1"), "predicate mismatch must leave the entry intact");
  });
});

test("clearActiveStepStrict on a genuinely-missing entry is a no-op success, ledger bytes unchanged", async () => {
  await withBoard(async (root) => {
    await stampActiveStep(root, "T2", { ticket: "T2", kind: "action", action: "implement", route: "r2", model: "sonnet" });
    const filePath = await ledgerPath(root);
    const before = await readFile(filePath, "utf8");

    const cleared = await clearActiveStepStrict(root, "T-never-stamped", () => true);
    assert.equal(cleared, false);

    const after = await readFile(filePath, "utf8");
    assert.equal(after, before, "ledger bytes must be unchanged by a no-op clear");
  });
});

test("clearActiveStepStrict on a missing ledger FILE (ENOENT) is a no-op success and creates no file", async () => {
  await withBoard(async (root) => {
    // The no-op-success guarantee holds AFTER lock acquisition -- lock
    // contention/a failed stale-break would still throw, as with every other
    // ledger op; this test only exercises the ordinary case where the lock
    // is freely acquired and the ledger file simply does not exist yet.
    const filePath = await ledgerPath(root);

    const cleared = await clearActiveStepStrict(root, "T1", () => true);
    assert.equal(cleared, false);

    await assert.rejects(readFile(filePath, "utf8"), { code: "ENOENT" }, "no ledger file must be created by the no-op clear");
  });
});

test("clearActiveStepStrict on a corrupt (invalid JSON) ledger throws and leaves the raw bytes untouched", async () => {
  await withBoard(async (root) => {
    const filePath = await ledgerPath(root);
    await mkdir(path.dirname(filePath), { recursive: true });
    const corrupt = "{not valid json";
    await writeFile(filePath, corrupt, "utf8");

    await assert.rejects(clearActiveStepStrict(root, "T1", () => true), /is corrupt/);

    const after = await readFile(filePath, "utf8");
    assert.equal(after, corrupt, "the corrupt bytes must be byte-identical before and after the throw");
  });
});

test("clearActiveStepStrict on a non-object top-level ledger throws and leaves the raw bytes untouched", async () => {
  await withBoard(async (root) => {
    const filePath = await ledgerPath(root);
    await mkdir(path.dirname(filePath), { recursive: true });
    const arrayShape = "[]";
    await writeFile(filePath, arrayShape, "utf8");

    await assert.rejects(clearActiveStepStrict(root, "T1", () => true), /expected a JSON object/);
    assert.equal(await readFile(filePath, "utf8"), arrayShape);

    const scalarShape = "42";
    await writeFile(filePath, scalarShape, "utf8");
    await assert.rejects(clearActiveStepStrict(root, "T1", () => true), /expected a JSON object/);
    assert.equal(await readFile(filePath, "utf8"), scalarShape);
  });
});

test("legacy regression: clearActiveStepIf on a corrupt ledger self-heals -- does not throw, returns false, and leaves the raw corrupt bytes byte-identical", async () => {
  await withBoard(async (root) => {
    const filePath = await ledgerPath(root);
    await mkdir(path.dirname(filePath), { recursive: true });
    const corrupt = "{not valid json";
    await writeFile(filePath, corrupt, "utf8");

    const cleared = await clearActiveStepIf(root, "T1", () => true);
    assert.equal(cleared, false, "self-healing clear must not throw and must report nothing-to-clear");

    const after = await readFile(filePath, "utf8");
    assert.equal(after, corrupt, "self-heal reads the corruption as {} in-memory only -- it must not rewrite the file");

    // stampActiveStep, by contrast, does overwrite corruption with valid JSON.
    await stampActiveStep(root, "T1", { ticket: "T1", kind: "action", action: "design", route: "r", model: "opus" });
    const steps = await readActiveSteps(root);
    assert.equal(steps.T1.action, "design");
  });
});

test("clearActiveStepStrict: a predicate that throws propagates the error, performs no write, and releases the ledger lock", async () => {
  await withBoard(async (root) => {
    await stampActiveStep(root, "T1", { ticket: "T1", kind: "action", action: "design", route: "r1", model: "opus" });
    const filePath = await ledgerPath(root);
    const before = await readFile(filePath, "utf8");

    await assert.rejects(
      clearActiveStepStrict(root, "T1", () => {
        throw new Error("predicate boom");
      }),
      /predicate boom/,
    );

    const after = await readFile(filePath, "utf8");
    assert.equal(after, before, "a predicate throw must not write the ledger");

    // Prove the lock was released (not leaked) by `withFileLock`'s `finally`:
    // a follow-on operation on the same ledger must acquire the lock and
    // succeed.
    const cleared = await clearActiveStepStrict(root, "T1", (record) => record.kind === "action");
    assert.equal(cleared, true, "the ledger lock must have been released after the predicate threw");
  });
});

test("clearActiveStepStrict serializes a concurrent stamp via the ledger lock: neither update is lost", async () => {
  await withBoard(async (root) => {
    await stampActiveStep(root, "T1", { ticket: "T1", kind: "action", action: "design", route: "r1", model: "opus" });

    await Promise.all([
      clearActiveStepStrict(root, "T1", (record) => record.kind === "action", { __afterRead: () => delay(60) }),
      stampActiveStep(root, "T2", { ticket: "T2", action: "implement", route: "r2", model: "sonnet" }),
    ]);

    const steps = await readActiveSteps(root);
    assert.equal(Object.hasOwn(steps, "T1"), false, "T1 must be cleared");
    assert.equal(steps.T2.action, "implement", "T2's entry must survive the concurrent clear");
  });
});

test("stampActiveStepNoClobber stamps an empty slot, self-heals an idempotent re-stamp, and reports a conflict without overwriting", async () => {
  await withBoard(async (root) => {
    const first = { ticket: "T1", kind: "gate", route: "claude-subagent:local-board-gatecheck", model: "haiku" };
    const emptySlot = await stampActiveStepNoClobber(root, "T1", first);
    assert.equal(emptySlot.stamped, true);
    assert.equal(emptySlot.conflict, null);

    // Idempotent re-run: same kind+route+model self-heals (overwrites).
    const idempotent = await stampActiveStepNoClobber(root, "T1", { ...first, ts: "2026-07-10T12:00:00Z" });
    assert.equal(idempotent.stamped, true);
    assert.equal((await readActiveSteps(root)).T1.ts, "2026-07-10T12:00:00Z");

    // Conflicting stamp (different kind): left untouched, conflict reported.
    const conflicting = await stampActiveStepNoClobber(root, "T1", {
      ticket: "T1",
      kind: "action",
      route: "claude-subagent:local-board-designer",
      model: "opus",
    });
    assert.equal(conflicting.stamped, false);
    assert.equal(conflicting.conflict.kind, "gate");
    assert.equal((await readActiveSteps(root)).T1.kind, "gate", "the live entry must survive the conflicting stamp attempt");
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
