import { execFile } from "node:child_process";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

import { main } from "../src/cli.js";
import { defaultConfigJsonc } from "../src/config.js";
import { initProject } from "../src/scaffold.js";
import { beginStep, completeStep, createTicket, setTicketField } from "../src/tickets.js";
import { commitPlanningTransition, startTicketWork } from "../src/git.js";
import { removeFixtureDir } from "./helpers/fixtures.js";

const execFileAsync = promisify(execFile);
const GIT_AVAILABLE = await hasGit();

async function withRepo(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-board-git-"));
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
    const baseBranch = await currentBranch(root);
    await initProject(root);
    await git(root, ["add", "plans", ".gitignore"]);
    await git(root, ["commit", "-m", "Initialize local board"]);
    await fn(root, baseBranch);
  } finally {
    await removeFixtureDir(root);
  }
}

test("startTicketWork creates a branch, records it, and moves implementation tickets active", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root) => {
    const ticketPath = await createTicket(root, "task", "Implement branch support", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const result = await startTicketWork(root, ticketId, { now: new Date("2026-05-14T21:00:00Z") });

    assert.equal(result.branch, `${"local-board"}/${ticketId}-implement-branch-support`);
    assert.equal(result.status, "implementing");
    assert.equal(await currentBranch(root), result.branch);
    const text = await readFile(result.path, "utf8");
    assert.match(text, new RegExp(`^branch: local-board/${ticketId}-implement-branch-support$`, "m"));
    assert.match(text, /^status: implementing$/m);
    assert.match(text, /Ensured git branch local-board\/.* \(created\)\./);
  });
});

test("begin-step succeeds after start-work moves the ticket to implementing (the ordering footgun, end to end)", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root) => {
    const ticketPath = await createTicket(root, "task", "Order start-work then begin-step", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const started = await startTicketWork(root, ticketId, { now: new Date("2026-05-14T21:00:00Z") });
    assert.equal(started.status, "implementing");

    const begun = await beginStep(root, ticketId);
    assert.equal(begun.action, "implement");
    assert.equal(begun.status, "implementing");
    assert.equal(begun.configuredAgent, "claude-subagent:local-board-implementer");
  });
});

test("startTicketWork stamps workStartedAt on first call and is idempotent thereafter", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root) => {
    const ticketPath = await createTicket(root, "task", "Stamp work started", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const first = await startTicketWork(root, ticketId, { now: new Date("2026-05-16T15:37:00Z") });
    const afterFirst = await readFile(first.path, "utf8");
    assert.match(afterFirst, /^workStartedAt: 2026-05-16T15:37:00Z$/m);

    const second = await startTicketWork(root, ticketId, { now: new Date("2026-05-16T16:00:00Z") });
    const afterSecond = await readFile(second.path, "utf8");
    assert.match(afterSecond, /^workStartedAt: 2026-05-16T15:37:00Z$/m);
  });
});

test("startTicketWork switches to a recorded existing branch", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, baseBranch) => {
    const ticketPath = await createTicket(root, "task", "Review seeded branch", {
      status: "ready_for_review",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    await setTicketField(root, ticketId, "branch", "seeded/work", { now: new Date("2026-05-14T20:57:00Z") });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add seeded branch ticket"]);
    await git(root, ["switch", "-c", "seeded/work"]);
    await git(root, ["switch", baseBranch]);

    const result = await startTicketWork(root, ticketId, { now: new Date("2026-05-14T21:00:00Z") });

    assert.equal(result.branch, "seeded/work");
    assert.equal(result.gitAction, "switched-existing");
    assert.equal(result.status, "ready_for_review");
    assert.equal(await currentBranch(root), "seeded/work");
  });
});

test("startTicketWork refuses to switch to an existing branch with a dirty worktree", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, baseBranch) => {
    const ticketPath = await createTicket(root, "task", "Dirty switch", {
      status: "ready_for_review",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    await setTicketField(root, ticketId, "branch", "seeded/dirty", { now: new Date("2026-05-14T20:57:00Z") });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add dirty branch ticket"]);
    await git(root, ["switch", "-c", "seeded/dirty"]);
    await git(root, ["switch", baseBranch]);
    await writeFile(path.join(root, "dirty.txt"), "uncommitted\n", "utf8");

    await assert.rejects(startTicketWork(root, ticketId), /working tree has uncommitted changes/);
    assert.equal(await currentBranch(root), baseBranch);
  });
});

test("startTicketWork refuses to create a branch with a dirty worktree", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, baseBranch) => {
    const ticketPath = await createTicket(root, "task", "Dirty branch create", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add dirty branch ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    await writeFile(path.join(root, "dirty.txt"), "uncommitted\n", "utf8");

    await assert.rejects(startTicketWork(root, ticketId), /refusing to create branch/);
    assert.equal(await currentBranch(root), baseBranch);
  });
});

test("move done auto-merges the ticket branch when autoMerge is enabled", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, baseBranch) => {
    await writeAutoMergeConfig(root, baseBranch);
    await git(root, ["add", "plans/local-board.config.jsonc"]);
    await git(root, ["commit", "-m", "Enable auto merge"]);
    const oldDonePath = await createTicket(root, "task", "Old merged done", {
      status: "done",
      now: new Date("2026-03-01T12:00:00Z"),
    });
    const oldDoneId = path.basename(oldDonePath).split("_", 1)[0];
    const ticketPath = await createTicket(root, "task", "Auto merge ticket", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add auto merge ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const work = await startTicketWork(root, ticketId, { now: new Date("2026-05-14T21:00:00Z") });
    await writeFile(path.join(root, "feature.txt"), "implemented\n", "utf8");
    await git(root, ["add", "feature.txt"]);
    await git(root, ["commit", "-m", "Implement ticket"]);
    await completeRequiredTaskSteps(root, ticketId);

    const result = await runCli(["--root", root, "move", ticketId, "done", "--json"]);

    assert.equal(result.code, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.autoMerge.branch, work.branch);
    assert.equal(output.autoMerge.defaultBranch, baseBranch);
    assert.equal(output.autoMerge.planningCommit, "committed");
    assert.deepEqual(output.archived.map((record) => record.ticket), [oldDoneId]);
    assert.equal(await currentBranch(root), baseBranch);
    assert.equal((await gitOutput(root, ["rev-list", "--parents", "-n", "1", "HEAD"])).split(" ").length, 3);
    assert.equal((await readFile(path.join(root, "feature.txt"), "utf8")).trim(), "implemented");
    assert.match(await readFile(output.path, "utf8"), /^status: done$/m);
    assert.match(
      await readFile(path.join(root, "plans", "tickets", "archive", path.basename(oldDonePath)), "utf8"),
      /^status: archived$/m,
    );
    assert.equal(await gitOutput(root, ["status", "--porcelain"]), "");
  });
});

test("move done refuses auto-merge when ticket branch is behind default branch and recovers after merge", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, baseBranch) => {
    await writeAutoMergeConfig(root, baseBranch);
    await git(root, ["add", "plans/local-board.config.jsonc"]);
    await git(root, ["commit", "-m", "Enable auto merge"]);
    const ticketPath = await createTicket(root, "task", "Stale auto merge", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add stale auto merge ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const work = await startTicketWork(root, ticketId, { now: new Date("2026-05-14T21:00:00Z") });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Start stale auto merge ticket"]);
    await git(root, ["switch", baseBranch]);
    await writeFile(path.join(root, "default.txt"), "default advanced\n", "utf8");
    await git(root, ["add", "default.txt"]);
    await git(root, ["commit", "-m", "Advance default branch"]);
    await git(root, ["switch", work.branch]);
    await completeRequiredTaskSteps(root, ticketId);
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Complete required steps"]);

    const failed = await runCli(["--root", root, "move", ticketId, "done", "--json"]);

    assert.equal(failed.code, 2);
    assert.match(failed.stderr, new RegExp(`ticket branch ${escapeRegExp(work.branch)} to contain the tip of ${escapeRegExp(baseBranch)}`));
    assert.match(failed.stderr, new RegExp(`git (rebase|merge) ${escapeRegExp(baseBranch)}`));
    assert.equal(await currentBranch(root), work.branch);
    assert.match(await readFile(work.path, "utf8"), /^status: implementing$/m);

    await git(root, ["merge", baseBranch, "-m", "Merge default into ticket"]);
    const recovered = await runCli(["--root", root, "move", ticketId, "done", "--json"]);

    assert.equal(recovered.code, 0, recovered.stderr);
    const output = JSON.parse(recovered.stdout);
    assert.equal(output.autoMerge.branch, work.branch);
    assert.equal(output.autoMerge.defaultBranch, baseBranch);
    assert.equal(await currentBranch(root), baseBranch);
    assert.match(await readFile(output.path, "utf8"), /^status: done$/m);
    assert.equal((await readFile(path.join(root, "default.txt"), "utf8")).trim(), "default advanced");
  });
});

test("move done skips stale branch precondition when autoMerge is disabled", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, baseBranch) => {
    await writeAutoMergeConfig(root, baseBranch, false);
    await git(root, ["add", "plans/local-board.config.jsonc"]);
    await git(root, ["commit", "-m", "Disable auto merge"]);
    const ticketPath = await createTicket(root, "task", "Manual stale done", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add manual stale ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const work = await startTicketWork(root, ticketId, { now: new Date("2026-05-14T21:00:00Z") });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Start manual stale ticket"]);
    await git(root, ["switch", baseBranch]);
    await writeFile(path.join(root, "default.txt"), "default advanced\n", "utf8");
    await git(root, ["add", "default.txt"]);
    await git(root, ["commit", "-m", "Advance default branch"]);
    await git(root, ["switch", work.branch]);
    await completeRequiredTaskSteps(root, ticketId);

    const result = await runCli(["--root", root, "move", ticketId, "done", "--json"]);

    assert.equal(result.code, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.autoMerge, null);
    assert.equal(await currentBranch(root), work.branch);
    assert.match(await readFile(output.path, "utf8"), /^status: done$/m);
  });
});

test("move done auto-merge allows ticket branch head equal to default branch head", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, baseBranch) => {
    await writeAutoMergeConfig(root, baseBranch);
    await git(root, ["add", "plans/local-board.config.jsonc"]);
    await git(root, ["commit", "-m", "Enable auto merge"]);
    const ticketPath = await createTicket(root, "task", "Equal head auto merge", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add equal head auto merge ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const work = await startTicketWork(root, ticketId, { now: new Date("2026-05-14T21:00:00Z") });
    assert.equal(await gitOutput(root, ["rev-parse", "HEAD"]), await gitOutput(root, ["rev-parse", baseBranch]));
    await completeRequiredTaskSteps(root, ticketId);

    const result = await runCli(["--root", root, "move", ticketId, "done", "--json"]);

    assert.equal(result.code, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.autoMerge.branch, work.branch);
    assert.equal(output.autoMerge.defaultBranch, baseBranch);
    assert.equal(await currentBranch(root), baseBranch);
    assert.match(await readFile(output.path, "utf8"), /^status: done$/m);
  });
});

test("move done prunes the merged ticket branch by default", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, baseBranch) => {
    await writeAutoMergeConfig(root, baseBranch);
    await git(root, ["add", "plans/local-board.config.jsonc"]);
    await git(root, ["commit", "-m", "Enable auto merge"]);
    const ticketPath = await createTicket(root, "task", "Prune me", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add prune ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const work = await startTicketWork(root, ticketId, { now: new Date("2026-05-14T21:00:00Z") });
    await writeFile(path.join(root, "feature.txt"), "implemented\n", "utf8");
    await git(root, ["add", "feature.txt"]);
    await git(root, ["commit", "-m", "Implement ticket"]);
    await completeRequiredTaskSteps(root, ticketId);

    const result = await runCli(["--root", root, "move", ticketId, "done", "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.autoMerge.pruned, "deleted");

    const refs = await gitOutput(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"]);
    assert.ok(!refs.split("\n").includes(work.branch), `expected ${work.branch} to be deleted, got refs: ${refs}`);
  });
});

test("move done keeps the merged ticket branch when pruneMergedBranches is false", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, baseBranch) => {
    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      `{
  "git": {
    "defaultBranch": "${baseBranch}",
    "autoMerge": true,
    "pruneMergedBranches": false
  }
}
`,
      "utf8",
    );
    await git(root, ["add", "plans/local-board.config.jsonc"]);
    await git(root, ["commit", "-m", "Enable auto merge without prune"]);
    const ticketPath = await createTicket(root, "task", "Keep my branch", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add keep-branch ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const work = await startTicketWork(root, ticketId, { now: new Date("2026-05-14T21:00:00Z") });
    await writeFile(path.join(root, "feature.txt"), "implemented\n", "utf8");
    await git(root, ["add", "feature.txt"]);
    await git(root, ["commit", "-m", "Implement ticket"]);
    await completeRequiredTaskSteps(root, ticketId);

    const result = await runCli(["--root", root, "move", ticketId, "done", "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.autoMerge.pruned, "skipped");

    const refs = await gitOutput(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"]);
    assert.ok(refs.split("\n").includes(work.branch), `expected ${work.branch} to survive, got refs: ${refs}`);
  });
});

test("move done refuses auto-merge when non-planning changes are uncommitted", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, baseBranch) => {
    await writeAutoMergeConfig(root, baseBranch);
    await git(root, ["add", "plans/local-board.config.jsonc"]);
    await git(root, ["commit", "-m", "Enable auto merge"]);
    const ticketPath = await createTicket(root, "task", "Dirty auto merge", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add dirty auto merge ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const work = await startTicketWork(root, ticketId, { now: new Date("2026-05-14T21:00:00Z") });
    await completeRequiredTaskSteps(root, ticketId);
    await writeFile(path.join(root, "dirty.txt"), "uncommitted\n", "utf8");

    const result = await runCli(["--root", root, "move", ticketId, "done", "--json"]);

    assert.equal(result.code, 2);
    assert.match(result.stderr, /non-planning changes to be committed first/);
    assert.equal(await currentBranch(root), work.branch);
    const ticketText = await readFile(work.path, "utf8");
    assert.match(ticketText, /^status: implementing$/m);
  });
});

// --- git.commitPlanningOnTransition (durable planning state at each stage
// transition, not just at move-done auto-merge) ---

test(
  "commitPlanningOnTransition (scaffold default: true) commits planning-only changes after each mutating command, leaving plans/ clean",
  { skip: !GIT_AVAILABLE },
  async () => {
    await withRepo(async (root) => {
      const created = await runCli(["--root", root, "create", "task", "Commit each transition"]);
      assert.equal(created.code, 0, created.stderr);
      const ticketId = path.basename(created.stdout.trim()).split("_", 1)[0];
      await assertPlansClean(root);
      assert.equal(await gitLastSubject(root), `${ticketId}: create task`);

      const estimated = await runCli(["--root", root, "estimate", ticketId, "4"]);
      assert.equal(estimated.code, 0, estimated.stderr);
      await assertPlansClean(root);
      assert.equal(await gitLastSubject(root), `${ticketId}: estimate 4`);

      const commented = await runCli(["--root", root, "comment", ticketId, "hello there"]);
      assert.equal(commented.code, 0, commented.stderr);
      await assertPlansClean(root);
      assert.equal(await gitLastSubject(root), `${ticketId}: comment Run Log`);

      const sectioned = await runCli(["--root", root, "section", ticketId, "Some design notes.", "--section", "Implementation Notes"]);
      assert.equal(sectioned.code, 0, sectioned.stderr);
      await assertPlansClean(root);
      assert.equal(await gitLastSubject(root), `${ticketId}: section Implementation Notes`);

      const moved = await runCli(["--root", root, "move", ticketId, "ready_for_design", "--override", "--reason", "test setup"]);
      assert.equal(moved.code, 0, moved.stderr);
      await assertPlansClean(root);
      assert.equal(await gitLastSubject(root), `${ticketId}: move ready_for_design`);

      const gateChecked = await runCli(["--root", root, "gate-check", ticketId, "--stage", "test"]);
      assert.equal(gateChecked.code, 0, gateChecked.stderr);
      await assertPlansClean(root);
      assert.equal(await gitLastSubject(root), `${ticketId}: gate-check test`);

      const gateCompleted = await runCli([
        "--root", root, "gate-complete", ticketId, "--stage", "design", "--executor", "inline", "--evidence", "consulted",
      ]);
      assert.equal(gateCompleted.code, 0, gateCompleted.stderr);
      await assertPlansClean(root);
      assert.equal(await gitLastSubject(root), `${ticketId}: gate-complete design`);

      const completedStep = await runCli([
        "--root", root, "complete-step", ticketId, "implement",
        "--executor", "claude-subagent:local-board-implementer", "--model", "sonnet",
        "--evidence", "Implementation done.", "--override", "--reason", "test setup",
      ]);
      assert.equal(completedStep.code, 0, completedStep.stderr);
      await assertPlansClean(root);
      assert.equal(await gitLastSubject(root), `${ticketId}: complete-step implement`);

      const approved = await runCli(["--root", root, "approve-inline", ticketId, "review", "--reason", "trusted reviewer"]);
      assert.equal(approved.code, 0, approved.stderr);
      await assertPlansClean(root);
      assert.equal(await gitLastSubject(root), `${ticketId}: approve-inline review`);

      const setField = await runCli(["--root", root, "set", ticketId, "priority", "P1"]);
      assert.equal(setField.code, 0, setField.stderr);
      await assertPlansClean(root);
      assert.equal(await gitLastSubject(root), `${ticketId}: set priority`);

      const otherTicketPath = await createTicket(root, "task", "Dependency ticket", { now: new Date("2026-06-01T09:00:00Z") });
      await git(root, ["add", "plans"]);
      await git(root, ["commit", "-m", "Add dependency ticket"]);
      const otherId = path.basename(otherTicketPath).split("_", 1)[0];

      const linked = await runCli(["--root", root, "link-parent", ticketId, otherId]);
      assert.equal(linked.code, 0, linked.stderr);
      await assertPlansClean(root);
      assert.equal(await gitLastSubject(root), `${ticketId}: link-parent ${otherId}`);

      const unlinked = await runCli(["--root", root, "unlink-parent", ticketId, otherId]);
      assert.equal(unlinked.code, 0, unlinked.stderr);
      await assertPlansClean(root);
      assert.equal(await gitLastSubject(root), `${ticketId}: unlink-parent ${otherId}`);

      const blocked = await runCli(["--root", root, "block", ticketId, otherId]);
      assert.equal(blocked.code, 0, blocked.stderr);
      await assertPlansClean(root);
      assert.equal(await gitLastSubject(root), `${ticketId}: block ${otherId}`);

      const unblocked = await runCli(["--root", root, "unblock", ticketId, otherId]);
      assert.equal(unblocked.code, 0, unblocked.stderr);
      await assertPlansClean(root);
      assert.equal(await gitLastSubject(root), `${ticketId}: unblock ${otherId}`);
    });
  },
);

test(
  "commitPlanningOnTransition: false leaves current behavior byte-identical (no commits made)",
  { skip: !GIT_AVAILABLE },
  async () => {
    await withRepo(async (root) => {
      await writeFile(
        path.join(root, "plans", "local-board.config.jsonc"),
        defaultConfigJsonc().replace('"commitPlanningOnTransition": true', '"commitPlanningOnTransition": false'),
        "utf8",
      );
      await git(root, ["add", "plans"]);
      await git(root, ["commit", "-m", "Disable commitPlanningOnTransition"]);

      const commitsBefore = await gitOutput(root, ["rev-list", "--count", "HEAD"]);

      const created = await runCli(["--root", root, "create", "task", "No commit ticket"]);
      assert.equal(created.code, 0, created.stderr);
      const ticketId = path.basename(created.stdout.trim()).split("_", 1)[0];
      assert.notEqual(await gitOutput(root, ["status", "--porcelain", "--", "plans"]), "");

      const estimated = await runCli(["--root", root, "estimate", ticketId, "4"]);
      assert.equal(estimated.code, 0, estimated.stderr);
      const commented = await runCli(["--root", root, "comment", ticketId, "hi"]);
      assert.equal(commented.code, 0, commented.stderr);
      const sectioned = await runCli(["--root", root, "section", ticketId, "Notes text.", "--section", "Implementation Notes"]);
      assert.equal(sectioned.code, 0, sectioned.stderr);
      const moved = await runCli(["--root", root, "move", ticketId, "ready_for_design", "--override", "--reason", "test"]);
      assert.equal(moved.code, 0, moved.stderr);

      const commitsAfter = await gitOutput(root, ["rev-list", "--count", "HEAD"]);
      assert.equal(commitsAfter, commitsBefore, "no new commits should be made when the flag is off");
      assert.notEqual(
        await gitOutput(root, ["status", "--porcelain", "--", "plans"]),
        "",
        "plans/ should remain dirty, exactly like current (pre-flag) behavior",
      );
    });
  },
);

test(
  "commitPlanningOnTransition survives a git checkout -- . destructive-op probe after a mutation (field-incident regression)",
  { skip: !GIT_AVAILABLE },
  async () => {
    await withRepo(async (root) => {
      const created = await runCli(["--root", root, "create", "task", "Survive checkout"]);
      assert.equal(created.code, 0, created.stderr);
      const ticketPath = created.stdout.trim();
      const ticketId = path.basename(ticketPath).split("_", 1)[0];
      await assertPlansClean(root);

      const commented = await runCli(["--root", root, "comment", ticketId, "irreplaceable evidence"]);
      assert.equal(commented.code, 0, commented.stderr);
      await assertPlansClean(root);

      // Simulate the field incident: a tester's destructive `git checkout -- .`
      // probe run against the worktree after the CLI mutation already
      // returned. Because the mutation was committed by the transition hook,
      // there is nothing left in the working tree for this to discard.
      //
      // The ticket's other cited incident (an aborted merge) is not a second,
      // independently meaningful variant to simulate here: `git merge --abort`
      // resets to ORIG_HEAD (the state *before* the merge started) and never
      // discards commits made prior to that merge, so it cannot destroy a
      // transition commit made by this helper regardless of whether the
      // helper exists. `git checkout -- .` (which only ever threatens
      // *uncommitted* worktree edits) is the operation this feature actually
      // defends against, and is exercised above.
      await git(root, ["checkout", "--", "."]);

      const ticketText = await readFile(ticketPath, "utf8");
      assert.match(ticketText, /irreplaceable evidence/);
      await assertPlansClean(root);
    });
  },
);

test(
  "commitPlanningOnTransition is a silent no-op on a non-git root (mutation still succeeds, no warning)",
  { skip: !GIT_AVAILABLE },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "local-board-nogit-"));
    try {
      await initProject(root);
      const ticketPath = await createTicket(root, "task", "Non-git ticket", { now: new Date("2026-06-01T09:00:00Z") });
      const ticketId = path.basename(ticketPath).split("_", 1)[0];

      const result = await runCli(["--root", root, "comment", ticketId, "no git here"]);

      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stderr, "");
      const ticketText = await readFile(ticketPath, "utf8");
      assert.match(ticketText, /no git here/);
    } finally {
      await removeFixtureDir(root);
    }
  },
);

test(
  "commitPlanningOnTransition degrades to a stderr warning on a commit failure, without losing the mutation",
  { skip: !GIT_AVAILABLE },
  async () => {
    await withRepo(async (root) => {
      const created = await runCli(["--root", root, "create", "task", "Warn on lock"]);
      assert.equal(created.code, 0, created.stderr);
      const ticketPath = created.stdout.trim();
      const ticketId = path.basename(ticketPath).split("_", 1)[0];
      await assertPlansClean(root);

      // Simulate a colliding concurrent git process (e.g. a mid-merge state,
      // or a second CLI invocation racing this one) holding the index lock.
      await writeFile(path.join(root, ".git", "index.lock"), "", "utf8");
      try {
        const result = await runCli(["--root", root, "comment", ticketId, "still written despite lock"]);

        assert.equal(result.code, 0, result.stderr);
        assert.match(result.stderr, /warning: planning commit skipped/);

        const ticketText = await readFile(ticketPath, "utf8");
        assert.match(ticketText, /still written despite lock/);
      } finally {
        await unlink(path.join(root, ".git", "index.lock")).catch(() => {});
      }
    });
  },
);

test(
  "commitPlanningOnTransition does not double-commit when move done triggers auto-merge",
  { skip: !GIT_AVAILABLE },
  async () => {
    await withRepo(async (root, baseBranch) => {
      await writeFile(
        path.join(root, "plans", "local-board.config.jsonc"),
        `{
  "git": {
    "defaultBranch": "${baseBranch}",
    "autoMerge": true,
    "commitPlanningOnTransition": true
  }
}
`,
        "utf8",
      );
      await git(root, ["add", "plans/local-board.config.jsonc"]);
      await git(root, ["commit", "-m", "Enable auto merge with commitPlanningOnTransition"]);

      const ticketPath = await createTicket(root, "task", "No double commit", {
        status: "ready_for_implementation",
        now: new Date("2026-06-01T10:00:00Z"),
      });
      await git(root, ["add", "plans"]);
      await git(root, ["commit", "-m", "Add ticket"]);
      const ticketId = path.basename(ticketPath).split("_", 1)[0];

      const work = await startTicketWork(root, ticketId, { now: new Date("2026-06-01T10:05:00Z") });
      await writeFile(path.join(root, "feature.txt"), "implemented\n", "utf8");
      await git(root, ["add", "feature.txt"]);
      await git(root, ["commit", "-m", "Implement ticket"]);
      await completeRequiredTaskSteps(root, ticketId);

      const preMoveTip = await gitOutput(root, ["rev-parse", work.branch]);

      const result = await runCli(["--root", root, "move", ticketId, "done", "--json"]);
      assert.equal(result.code, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.autoMerge.planningCommit, "committed");

      // Exactly one commit landed on the ticket branch for this transition
      // (autoMergeTicketBranch's own "Complete <ticketId>" commit) -- the
      // commitPlanningOnTransition hook is skipped (guarded by
      // !shouldAutoMerge) so no second, redundant commit is stacked on top.
      const finalTip = await gitOutput(root, ["rev-parse", "HEAD^2"]);
      assert.equal(await gitOutput(root, ["log", "-1", "--pretty=%s", finalTip]), `Complete ${ticketId}`);
      assert.equal(await gitOutput(root, ["rev-list", "--count", `${preMoveTip}..${finalTip}`]), "1");
    });
  },
);

test(
  "commitPlanningTransition pathspec-limits the commit to plans/** even when a non-planning file is already staged",
  { skip: !GIT_AVAILABLE },
  async () => {
    await withRepo(async (root) => {
      const created = await runCli(["--root", root, "create", "task", "Pathspec scope"]);
      assert.equal(created.code, 0, created.stderr);
      const ticketId = path.basename(created.stdout.trim()).split("_", 1)[0];
      await assertPlansClean(root);

      // Simulate a user who already `git add`ed a non-planning file of their
      // own before running the CLI, then dirty a planning field via a
      // mutating command that triggers the transition commit.
      await writeFile(path.join(root, "staged.txt"), "user work\n", "utf8");
      await git(root, ["add", "staged.txt"]);

      const commented = await runCli(["--root", root, "comment", ticketId, "pathspec regression"]);
      assert.equal(commented.code, 0, commented.stderr);

      // The transition commit must contain only plans/** paths -- never the
      // user's pre-staged non-planning file.
      const committedFiles = (await gitOutput(root, ["show", "--name-only", "--pretty=format:", "HEAD"]))
        .split(/\r?\n/)
        .filter((line) => line !== "");
      assert.ok(committedFiles.length > 0, "transition commit must touch at least one file");
      for (const file of committedFiles) {
        assert.equal(file.startsWith("plans/"), true, `unexpected non-planning path in transition commit: ${file}`);
      }

      // The user's pre-staged non-planning file must remain staged and
      // uncommitted after the transition commit.
      assert.equal(await gitOutput(root, ["status", "--porcelain", "--", "staged.txt"]), "A  staged.txt");
    });
  },
);

test(
  "commitPlanningTransition: a second call after a commit is a true no-op (dirty-check-first, back-to-back calls stay cheap)",
  { skip: !GIT_AVAILABLE },
  async () => {
    await withRepo(async (root) => {
      const created = await runCli(["--root", root, "create", "task", "Clean run"]);
      assert.equal(created.code, 0, created.stderr);
      const ticketId = path.basename(created.stdout.trim()).split("_", 1)[0];
      await assertPlansClean(root);

      const headBefore = await gitOutput(root, ["rev-parse", "HEAD"]);
      const result = await commitPlanningTransition(root, { ticketId, command: "create", detail: "task" });
      assert.deepEqual(result, { committed: false, reason: "clean" });
      const headAfter = await gitOutput(root, ["rev-parse", "HEAD"]);
      assert.equal(headAfter, headBefore, "a clean planning tree must never create a new commit");
    });
  },
);

async function assertPlansClean(root) {
  assert.equal(await gitOutput(root, ["status", "--porcelain", "--", "plans"]), "");
}

async function gitLastSubject(root) {
  return gitOutput(root, ["log", "-1", "--pretty=%s"]);
}

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

async function gitOutput(root, args) {
  const { stdout } = await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });
  return stdout.trim();
}

async function currentBranch(root) {
  const { stdout } = await execFileAsync("git", ["-C", root, "branch", "--show-current"], { encoding: "utf8" });
  return stdout.trim();
}

async function writeAutoMergeConfig(root, baseBranch, autoMerge = true) {
  await writeFile(
    path.join(root, "plans", "local-board.config.jsonc"),
    `{
  "git": {
    "defaultBranch": "${baseBranch}",
    "autoMerge": ${JSON.stringify(autoMerge)}
  }
}
`,
    "utf8",
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function completeRequiredTaskSteps(root, ticketId) {
  await completeStep(root, ticketId, "design", "claude-subagent:local-board-designer@opus", "Design evidence.");
  await completeStep(root, ticketId, "implement", "claude-subagent:local-board-implementer@sonnet", "Implementation evidence.");
  await completeStep(root, ticketId, "review", "codex-task:read-only", "Review evidence.");
  await completeStep(root, ticketId, "test", "claude-subagent:local-board-tester@sonnet", "Test evidence.");
  await completeStep(root, ticketId, "document", "codex-task:workspace-write", "Documentation evidence.");
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
