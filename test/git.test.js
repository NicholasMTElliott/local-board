import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

import { main } from "../src/cli.js";
import { initProject } from "../src/scaffold.js";
import { completeStep, createTicket, setTicketField } from "../src/tickets.js";
import { startTicketWork } from "../src/git.js";

const execFileAsync = promisify(execFile);
const GIT_AVAILABLE = await hasGit();

async function withRepo(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-board-git-"));
  try {
    await git(root, ["init"]);
    await git(root, ["config", "user.email", "local-board@example.test"]);
    await git(root, ["config", "user.name", "local-board test"]);
    await writeFile(path.join(root, "README.md"), "# Test Repo\n", "utf8");
    await git(root, ["add", "README.md"]);
    await git(root, ["commit", "-m", "Initial commit"]);
    const baseBranch = await currentBranch(root);
    await initProject(root);
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Initialize local board"]);
    await fn(root, baseBranch);
  } finally {
    await rm(root, { recursive: true, force: true });
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
    assert.equal((await readFile(path.join(root, "feature.txt"), "utf8")).trim(), "implemented");
    assert.match(await readFile(output.path, "utf8"), /^status: done$/m);
    assert.match(
      await readFile(path.join(root, "plans", "tickets", "archive", path.basename(oldDonePath)), "utf8"),
      /^status: archived$/m,
    );
    assert.equal(await gitOutput(root, ["status", "--porcelain"]), "");
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

async function writeAutoMergeConfig(root, baseBranch) {
  await writeFile(
    path.join(root, "plans", "local-board.config.jsonc"),
    `{
  "git": {
    "defaultBranch": "${baseBranch}",
    "autoMerge": true
  }
}
`,
    "utf8",
  );
}

async function completeRequiredTaskSteps(root, ticketId) {
  await completeStep(root, ticketId, "design", "claude-subagent:local-board-designer", "Design evidence.");
  await completeStep(root, ticketId, "implement", "claude-subagent:local-board-implementer", "Implementation evidence.");
  await completeStep(root, ticketId, "review", "codex-task:read-only", "Review evidence.");
  await completeStep(root, ticketId, "test", "claude-subagent:local-board-tester", "Test evidence.");
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
