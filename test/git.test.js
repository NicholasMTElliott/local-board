import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

import { initProject } from "../src/scaffold.js";
import { createTicket, setTicketField } from "../src/tickets.js";
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

async function currentBranch(root) {
  const { stdout } = await execFileAsync("git", ["-C", root, "branch", "--show-current"], { encoding: "utf8" });
  return stdout.trim();
}
