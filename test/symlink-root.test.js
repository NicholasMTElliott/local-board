// Regression tests: a board root reached through a symlink (macOS's
// /var -> /private/var, a symlinked ~/code) or a Windows junction. git
// reports physical paths, so before src/paths.js canonicalized the root the
// wrong-root guard failed open, worktree-remove reported removed:false and
// left the worktree, and check-dispatch's worktree fallback missed.
//
// Every CLI call here passes the LINKED spelling on purpose. Don't switch
// the fixtures to physical paths: the linked spelling is the case under test.

import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

import { main } from "../src/cli.js";
import { initProject } from "../src/scaffold.js";
import { createTicket } from "../src/tickets.js";
import { removeFixtureDir } from "./helpers/fixtures.js";
import { physicalPath } from "./helpers/paths.js";

const execFileAsync = promisify(execFile);
const GIT_AVAILABLE = await hasGit();

// Builds <base>/repo (a git repo with an initialized board) and
// <base>-link -> <base>, then calls fn with the repo's LINKED path. Junctions
// on Windows need no symlink privilege; if the link still can't be created
// the test is skipped rather than failed.
async function withLinkedRepo(t, fn) {
  const base = await mkdtemp(path.join(os.tmpdir(), "local-board-symlink-"));
  const link = `${base}-link`;
  try {
    try {
      await symlink(base, link, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      t.skip(`cannot create a directory link here (${error.code ?? error.message})`);
      return;
    }
    const realRepo = path.join(base, "repo");
    await mkdir(realRepo);
    const repo = path.join(link, "repo");
    assert.notEqual(physicalPath(repo), path.resolve(repo), "fixture must reach the repo through a link");

    await git(repo, ["init"]);
    await git(repo, ["config", "gc.auto", "0"]);
    await git(repo, ["config", "gc.autoDetach", "false"]);
    await git(repo, ["config", "user.email", "local-board@example.test"]);
    await git(repo, ["config", "user.name", "local-board test"]);
    await writeFile(path.join(repo, "README.md"), "# Test Repo\n", "utf8");
    await git(repo, ["add", "README.md"]);
    await git(repo, ["commit", "-m", "Initial commit"]);
    await initProject(repo);
    await git(repo, ["add", "plans", ".gitignore"]);
    await git(repo, ["commit", "-m", "Initialize local board"]);
    await fn(repo, link);
  } finally {
    await removeFixtureDir(link);
    await removeFixtureDir(base);
  }
}

async function addTicket(repo, title, now) {
  const ticketPath = await createTicket(repo, "task", title, { status: "ready_for_implementation", now });
  await git(repo, ["add", "plans"]);
  await git(repo, ["commit", "-m", `Add ${title}`]);
  return { ticketPath, ticketId: path.basename(ticketPath).split("_", 1)[0] };
}

test("symlinked --root: the wrong-root guard refuses a mutation from the main root", { skip: !GIT_AVAILABLE }, async (t) => {
  await withLinkedRepo(t, async (repo, link) => {
    const { ticketPath, ticketId } = await addTicket(repo, "Guard via symlink", new Date("2026-10-27T10:00:00Z"));
    const added = await runCli(["--root", repo, "worktree-add", ticketId, "--json"]);
    assert.equal(added.code, 0, added.stderr);
    const before = await readFile(ticketPath, "utf8");

    const refused = await runCli(["--root", repo, "move", ticketId, "questions"]);
    assert.equal(refused.code, 2, `guard failed open: ${refused.stdout}${refused.stderr}`);
    assert.match(refused.stderr, new RegExp(`^refusing to mutate ${ticketId} from `));
    assert.equal(await readFile(ticketPath, "utf8"), before, "main-checkout ticket must be unchanged");

    // From the ticket's own worktree, also reached through the link, the
    // guard lets the mutation through.
    const linkedWorktree = path.join(link, "repo-worktrees", ticketId);
    const allowed = await runCli(["--root", linkedWorktree, "move", ticketId, "questions"]);
    assert.equal(allowed.code, 0, allowed.stderr);
  });
});

test("symlinked --root: worktree-remove finds and removes the ticket worktree", { skip: !GIT_AVAILABLE }, async (t) => {
  await withLinkedRepo(t, async (repo, link) => {
    const { ticketId } = await addTicket(repo, "Remove via symlink", new Date("2026-10-27T10:05:00Z"));
    assert.equal((await runCli(["--root", repo, "worktree-add", ticketId, "--json"])).code, 0);
    const linkedWorktree = path.join(link, "repo-worktrees", ticketId);
    assert.equal(await pathExists(linkedWorktree), true);

    const removed = await runCli(["--root", repo, "worktree-remove", ticketId, "--json"]);
    assert.equal(removed.code, 0, removed.stderr);
    assert.equal(JSON.parse(removed.stdout).removed, true);
    assert.equal(await pathExists(linkedWorktree), false, "worktree directory must be gone");
    const registered = await gitOutput(repo, ["worktree", "list", "--porcelain"]);
    assert.doesNotMatch(registered, new RegExp(ticketId));
  });
});

test("symlinked --root: check-dispatch resolves the route from the ticket's registered worktree", { skip: !GIT_AVAILABLE }, async (t) => {
  await withLinkedRepo(t, async (repo, link) => {
    // Empty optional-step catalogs, so gate-check auto-stamps without a real
    // agent dispatch (same setup as the active-steps fallback test).
    await writeFile(
      path.join(repo, "plans", "local-board.config.jsonc"),
      JSON.stringify({ version: 1, optionalSteps: { design: [], implement: [], test: [] } }),
      "utf8",
    );
    await git(repo, ["add", "plans"]);
    await git(repo, ["commit", "-m", "Zero optionalSteps"]);
    const { ticketId } = await addTicket(repo, "Dispatch via symlink", new Date("2026-10-27T10:10:00Z"));
    assert.equal((await runCli(["--root", repo, "worktree-add", ticketId, "--json"])).code, 0);
    const wt = path.join(link, "repo-worktrees", ticketId);

    // Advance the ticket inside the worktree only; the main checkout's copy
    // stays at ready_for_implementation.
    for (const args of [
      ["begin-step", ticketId, "--json"],
      [
        "complete-step", ticketId, "implement",
        "--executor", "claude-subagent:local-board-implementer@sonnet",
        "--evidence", "Implemented.", "--json",
      ],
      ["gate-check", ticketId, "--stage", "implement", "--json"],
      ["move", ticketId, "ready_for_review", "--json"],
      ["move", ticketId, "ready_for_test", "--json"],
    ]) {
      const result = await runCli(["--root", wt, ...args]);
      assert.equal(result.code, 0, `${args[0]}: ${result.stderr}`);
    }

    // From the main root (as the hook would run): the expected route must
    // come from the worktree's ready_for_test (tester), not the stale
    // ready_for_implementation (implementer).
    const result = await runCli([
      "--root", repo, "check-dispatch",
      "--agent", "local-board-tester", "--model", "sonnet", "--ticket", ticketId,
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      reason: "match",
      expected: { agent: "local-board-tester", model: "sonnet" },
      ticket: ticketId,
    });
  });
});

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
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

async function runCli(args) {
  const stdout = [];
  const stderr = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (message = "") => stdout.push(String(message));
  console.error = (message = "") => stderr.push(String(message));
  try {
    const code = await main(args);
    return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}
