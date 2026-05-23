import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

import { main } from "../src/cli.js";
import { initProject } from "../src/scaffold.js";
import { createTicket, setTicketField } from "../src/tickets.js";

const execFileAsync = promisify(execFile);
const GIT_AVAILABLE = await hasGit();

async function withRepo(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-board-worktree-"));
  const worktreesRoot = path.join(path.dirname(root), `${path.basename(root)}-worktrees`);
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
    await fn(root, baseBranch, worktreesRoot);
  } finally {
    await rm(worktreesRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
}

test("worktree-add creates a sibling worktree, stamps a new branch, and is idempotent", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch, worktreesRoot) => {
    const ticketPath = await createTicket(root, "task", "Parallel worktree ticket", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T14:00:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const first = await runCli(["--root", root, "worktree-add", ticketId, "--json"]);
    assert.equal(first.code, 0, first.stderr);
    const firstOut = JSON.parse(first.stdout);
    const expectedPath = path.join(worktreesRoot, ticketId);
    assert.equal(firstOut.ticketId, ticketId);
    assert.equal(firstOut.branch, `local-board/${ticketId}-parallel-worktree-ticket`);
    assert.equal(firstOut.worktreePath, displayPath(expectedPath));
    assert.equal(firstOut.created, true);
    assert.equal(await currentBranch(expectedPath), firstOut.branch);
    assert.match(await readFile(path.join(expectedPath, "plans", "tickets", "ready", path.basename(ticketPath)), "utf8"), new RegExp(`^branch: ${escapeRegExp(firstOut.branch)}$`, "m"));
    assert.doesNotMatch(await readFile(path.join(expectedPath, "plans", "tickets", "ready", path.basename(ticketPath)), "utf8"), /^workStartedAt: 2026-/m);

    const second = await runCli(["--root", root, "worktree-add", ticketId, "--json"]);
    assert.equal(second.code, 0, second.stderr);
    assert.deepEqual(JSON.parse(second.stdout), { ...firstOut, created: false });
  });
});

test("worktree-add uses an existing recorded branch", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch, worktreesRoot) => {
    const ticketPath = await createTicket(root, "task", "Existing branch worktree", {
      status: "ready_for_review",
      now: new Date("2026-05-22T14:01:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    await setTicketField(root, ticketId, "branch", "seeded/worktree", { now: new Date("2026-05-22T14:02:00Z") });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add seeded branch ticket"]);
    await git(root, ["branch", "seeded/worktree"]);

    const result = await runCli(["--root", root, "worktree-add", ticketId, "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.equal(out.created, true);
    assert.equal(out.branch, "seeded/worktree");
    assert.equal(out.worktreePath, displayPath(path.join(worktreesRoot, ticketId)));
    assert.equal(await currentBranch(path.join(worktreesRoot, ticketId)), "seeded/worktree");
  });
});

test("worktree-add rejects a non-worktree directory at the target path", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch, worktreesRoot) => {
    const ticketPath = await createTicket(root, "task", "Squatted path", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T14:03:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add squatted path ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    await mkdir(path.join(worktreesRoot, ticketId), { recursive: true });

    const result = await runCli(["--root", root, "worktree-add", ticketId]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /exists but is not a registered git worktree/);
  });
});

test("worktree-remove removes a ticket worktree and is idempotent", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch, worktreesRoot) => {
    const ticketPath = await createTicket(root, "task", "Remove worktree", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T14:04:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add removable ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    const worktreePath = path.join(worktreesRoot, ticketId);
    assert.equal((await runCli(["--root", root, "worktree-add", ticketId, "--json"])).code, 0);

    const removed = await runCli(["--root", root, "worktree-remove", ticketId, "--json"]);
    assert.equal(removed.code, 0, removed.stderr);
    assert.deepEqual(JSON.parse(removed.stdout), {
      ticketId,
      worktreePath: displayPath(worktreePath),
      removed: true,
    });

    const again = await runCli(["--root", root, "worktree-remove", ticketId, "--json"]);
    assert.equal(again.code, 0, again.stderr);
    assert.deepEqual(JSON.parse(again.stdout), {
      ticketId,
      worktreePath: displayPath(worktreePath),
      removed: false,
    });
  });
});

test("worktree-list returns empty and populated ticket worktree shapes", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch, worktreesRoot) => {
    const empty = await runCli(["--root", root, "worktree-list", "--json"]);
    assert.equal(empty.code, 0, empty.stderr);
    assert.deepEqual(JSON.parse(empty.stdout), []);

    const ticketPath = await createTicket(root, "task", "List worktree", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T14:05:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add list ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    const add = await runCli(["--root", root, "worktree-add", ticketId, "--json"]);
    assert.equal(add.code, 0, add.stderr);
    const branch = JSON.parse(add.stdout).branch;

    const listed = await runCli(["--root", root, "worktree-list", "--json"]);
    assert.equal(listed.code, 0, listed.stderr);
    assert.deepEqual(JSON.parse(listed.stdout), [
      {
        ticketId,
        branch,
        worktreePath: displayPath(path.join(worktreesRoot, ticketId)),
        locked: false,
      },
    ]);
  });
});

test("fast-forward succeeds on a clean default branch, advances after local ref movement, and no-ops thereafter", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, baseBranch, worktreesRoot) => {
    const clean = await runCli(["--root", root, "fast-forward", "--json"]);
    assert.equal(clean.code, 0, clean.stderr);
    assert.equal(JSON.parse(clean.stdout).advanced, false);

    const ticketPath = await createTicket(root, "task", "Advance default from worktree", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T14:06:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add advance ticket"]);
    const previousHead = await gitOutput(root, ["rev-parse", "HEAD"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    const add = await runCli(["--root", root, "worktree-add", ticketId, "--json"]);
    assert.equal(add.code, 0, add.stderr);
    const worktreePath = path.join(worktreesRoot, ticketId);
    await writeFile(path.join(worktreePath, "feature.txt"), "from worktree\n", "utf8");
    await git(worktreePath, ["add", "plans", "feature.txt"]);
    await git(worktreePath, ["commit", "-m", "Implement in worktree"]);
    const newHead = await gitOutput(worktreePath, ["rev-parse", "HEAD"]);
    await git(worktreePath, ["update-ref", `refs/heads/${baseBranch}`, newHead, previousHead]);

    const advanced = await runCli(["--root", root, "fast-forward", "--json"]);
    assert.equal(advanced.code, 0, advanced.stderr);
    assert.deepEqual(JSON.parse(advanced.stdout), {
      defaultBranch: baseBranch,
      previousHead,
      newHead,
      advanced: true,
    });
    assert.equal((await readFile(path.join(root, "feature.txt"), "utf8")).trim(), "from worktree");

    const unchanged = await runCli(["--root", root, "fast-forward", "--json"]);
    assert.equal(unchanged.code, 0, unchanged.stderr);
    assert.equal(JSON.parse(unchanged.stdout).advanced, false);
  });
});

test("fast-forward refuses on a non-default branch", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, baseBranch) => {
    await git(root, ["switch", "-c", "side"]);

    const result = await runCli(["--root", root, "fast-forward"]);

    assert.equal(result.code, 2);
    assert.match(result.stderr, new RegExp(`on branch side; switch to ${escapeRegExp(baseBranch)} before fast-forwarding`));
  });
});

test("fast-forward refuses with a dirty worktree", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root) => {
    await writeFile(path.join(root, "dirty.txt"), "uncommitted\n", "utf8");

    const result = await runCli(["--root", root, "fast-forward"]);

    assert.equal(result.code, 2);
    assert.match(result.stderr, /fast-forward requires a clean working tree; commit or stash changes first/);
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
  return gitOutput(root, ["branch", "--show-current"]);
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

function displayPath(value) {
  return path.resolve(value).replace(/\\/g, "/");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
