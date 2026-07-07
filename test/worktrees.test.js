import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

import { main } from "../src/cli.js";
import { initProject } from "../src/scaffold.js";
import { createTicket, setTicketField } from "../src/tickets.js";
import { worktreesRootFor } from "../src/worktrees.js";
import { defaultConfigJsonc } from "../src/config.js";
import { removeFixtureDir } from "./helpers/fixtures.js";

const execFileAsync = promisify(execFile);
const GIT_AVAILABLE = await hasGit();

async function withRepo(fn, options = {}) {
  const location = options.location ?? "sibling";
  const root = await mkdtemp(path.join(os.tmpdir(), "local-board-worktree-"));
  const worktreesRoot = worktreesRootFor(root, location);
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
    if (location !== "sibling") {
      await writeFile(
        path.join(root, "plans", "local-board.config.jsonc"),
        defaultConfigJsonc().replace('"location": "sibling"', `"location": ${JSON.stringify(location)}`),
        "utf8",
      );
    }
    await git(root, ["add", "plans", ".gitignore"]);
    await git(root, ["commit", "-m", "Initialize local board"]);
    await fn(root, baseBranch, worktreesRoot);
  } finally {
    await removeFixtureDir(worktreesRoot);
    await removeFixtureDir(root);
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

test("create from peer worktrees mints distinct timestamps via the worktree mint offset", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch, worktreesRoot) => {
    const ticketAPath = await createTicket(root, "story", "Peer A", {
      status: "ready_for_decomposition",
      now: new Date("2026-05-22T14:10:00Z"),
    });
    const ticketBPath = await createTicket(root, "story", "Peer B", {
      status: "ready_for_decomposition",
      now: new Date("2026-05-22T14:11:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add peer stories"]);
    const ticketA = path.basename(ticketAPath).split("_", 1)[0];
    const ticketB = path.basename(ticketBPath).split("_", 1)[0];

    const addA = await runCli(["--root", root, "worktree-add", ticketA, "--json"]);
    assert.equal(addA.code, 0, addA.stderr);
    const addB = await runCli(["--root", root, "worktree-add", ticketB, "--json"]);
    assert.equal(addB.code, 0, addB.stderr);
    const worktreeA = path.join(worktreesRoot, ticketA);
    const worktreeB = path.join(worktreesRoot, ticketB);

    const childA = await runCli([
      "--root", worktreeA, "create", "task", "Child of A", "--status", "ready_for_design", "--parent", ticketA,
    ]);
    assert.equal(childA.code, 0, childA.stderr);
    const childB = await runCli([
      "--root", worktreeB, "create", "task", "Child of B", "--status", "ready_for_design", "--parent", ticketB,
    ]);
    assert.equal(childB.code, 0, childB.stderr);

    const childAFile = (await readdir(path.join(worktreeA, "plans", "tickets", "ready"))).find((name) => name.endsWith("child-of-a.md"));
    const childBFile = (await readdir(path.join(worktreeB, "plans", "tickets", "ready"))).find((name) => name.endsWith("child-of-b.md"));
    assert.ok(childAFile, "child of A should exist in worktree A");
    assert.ok(childBFile, "child of B should exist in worktree B");
    const childAId = childAFile.split("_", 1)[0];
    const childBId = childBFile.split("_", 1)[0];
    assert.notEqual(childAId, childBId, "peer worktrees must mint distinct ticket IDs");
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

test("worktree-add places worktrees under .worktrees when location is inside, stamps a branch, and is idempotent", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch, worktreesRoot) => {
    const ticketPath = await createTicket(root, "task", "Inside layout ticket", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T15:00:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const first = await runCli(["--root", root, "worktree-add", ticketId, "--json"]);
    assert.equal(first.code, 0, first.stderr);
    const firstOut = JSON.parse(first.stdout);
    const expectedPath = path.join(worktreesRoot, ticketId);
    assert.equal(worktreesRoot, path.join(path.resolve(root), ".worktrees"));
    assert.equal(firstOut.worktreePath, displayPath(expectedPath));
    assert.equal(firstOut.created, true);
    assert.equal(await currentBranch(expectedPath), firstOut.branch);
    // Workspace-root writability invariant: every created path stays under the
    // resolved repo root — the testable stand-in for "no sandbox escalation".
    assert.equal(expectedPath.startsWith(path.resolve(root) + path.sep), true);

    const second = await runCli(["--root", root, "worktree-add", ticketId, "--json"]);
    assert.equal(second.code, 0, second.stderr);
    assert.deepEqual(JSON.parse(second.stdout), { ...firstOut, created: false });
  }, { location: "inside" });
});

test("worktree-add on inside layout seeds .gitignore idempotently and leaves the main tree clean", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch) => {
    const ticketPath = await createTicket(root, "task", "Gitignore inside ticket", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T15:01:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const gitignoreBefore = await readFile(path.join(root, ".gitignore"), "utf8");
    assert.match(gitignoreBefore, /^\.worktrees\/$/m);

    assert.equal((await runCli(["--root", root, "worktree-add", ticketId, "--json"])).code, 0);
    const gitignoreAfterFirst = await readFile(path.join(root, ".gitignore"), "utf8");
    const occurrencesFirst = gitignoreAfterFirst.split(/\r?\n/).filter((line) => line.trim() === ".worktrees/").length;
    assert.equal(occurrencesFirst, 1);

    // The .gitignore edit is a production-file side effect that must not be
    // auto-committed; it shows up as a modification, not the worktree contents.
    const status = await gitOutput(root, ["status", "--porcelain"]);
    for (const line of status.split(/\r?\n/).filter((line) => line !== "")) {
      assert.equal(line.includes(".worktrees"), false, `unexpected worktrees entry in status: ${line}`);
    }

    const ticketBPath = await createTicket(root, "task", "Second inside ticket", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T15:02:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add second ticket"]);
    const ticketBId = path.basename(ticketBPath).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "worktree-add", ticketBId, "--json"])).code, 0);

    const gitignoreAfterSecond = await readFile(path.join(root, ".gitignore"), "utf8");
    const occurrencesSecond = gitignoreAfterSecond.split(/\r?\n/).filter((line) => line.trim() === ".worktrees/").length;
    assert.equal(occurrencesSecond, 1, "worktree-add must not duplicate the .gitignore entry");
  }, { location: "inside" });
});

test("worktree-list returns the inside path and excludes the main worktree", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch, worktreesRoot) => {
    const ticketPath = await createTicket(root, "task", "List inside worktree", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T15:03:00Z"),
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
  }, { location: "inside" });
});

test("worktree-remove removes the inside worktree and is idempotent", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch, worktreesRoot) => {
    const ticketPath = await createTicket(root, "task", "Remove inside worktree", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T15:04:00Z"),
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
  }, { location: "inside" });
});

test("create from peer worktrees mints distinct timestamps under inside layout", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch, worktreesRoot) => {
    const ticketAPath = await createTicket(root, "story", "Inside peer A", {
      status: "ready_for_decomposition",
      now: new Date("2026-05-22T15:10:00Z"),
    });
    const ticketBPath = await createTicket(root, "story", "Inside peer B", {
      status: "ready_for_decomposition",
      now: new Date("2026-05-22T15:11:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add peer stories"]);
    const ticketA = path.basename(ticketAPath).split("_", 1)[0];
    const ticketB = path.basename(ticketBPath).split("_", 1)[0];

    const addA = await runCli(["--root", root, "worktree-add", ticketA, "--json"]);
    assert.equal(addA.code, 0, addA.stderr);
    const addB = await runCli(["--root", root, "worktree-add", ticketB, "--json"]);
    assert.equal(addB.code, 0, addB.stderr);
    const worktreeA = path.join(worktreesRoot, ticketA);
    const worktreeB = path.join(worktreesRoot, ticketB);

    const childA = await runCli([
      "--root", worktreeA, "create", "task", "Child of inside A", "--status", "ready_for_design", "--parent", ticketA,
    ]);
    assert.equal(childA.code, 0, childA.stderr);
    const childB = await runCli([
      "--root", worktreeB, "create", "task", "Child of inside B", "--status", "ready_for_design", "--parent", ticketB,
    ]);
    assert.equal(childB.code, 0, childB.stderr);

    const childAFile = (await readdir(path.join(worktreeA, "plans", "tickets", "ready"))).find((name) => name.endsWith("child-of-inside-a.md"));
    const childBFile = (await readdir(path.join(worktreeB, "plans", "tickets", "ready"))).find((name) => name.endsWith("child-of-inside-b.md"));
    assert.ok(childAFile, "child of A should exist in worktree A");
    assert.ok(childBFile, "child of B should exist in worktree B");
    const childAId = childAFile.split("_", 1)[0];
    const childBId = childBFile.split("_", 1)[0];
    assert.notEqual(childAId, childBId, "peer worktrees under inside layout must mint distinct ticket IDs");
  }, { location: "inside" });
});

test("validate/list count a ticket exactly once under inside layout (no nested double-count)", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root) => {
    const ticketPath = await createTicket(root, "task", "Discovery guard ticket", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T15:05:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add discovery guard ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "worktree-add", ticketId, "--json"])).code, 0);

    const validated = await runCli(["--root", root, "validate", "--json"]);
    assert.equal(validated.code, 0, validated.stderr);

    const listed = await runCli(["--root", root, "list", "--json"]);
    assert.equal(listed.code, 0, listed.stderr);
    const matches = JSON.parse(listed.stdout).filter((entry) => entry.id === ticketId);
    assert.equal(matches.length, 1, "ticket must be discovered exactly once, not once per nested checkout");
  }, { location: "inside" });
});

test("worktree-add supports an explicit relative worktrees.location outside the repo", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch, worktreesRoot) => {
    const ticketPath = await createTicket(root, "task", "Explicit path ticket", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T15:06:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add explicit path ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    assert.equal(worktreesRoot, path.resolve(root, "..", "explicit-worktrees"));
    const add = await runCli(["--root", root, "worktree-add", ticketId, "--json"]);
    assert.equal(add.code, 0, add.stderr);
    const out = JSON.parse(add.stdout);
    assert.equal(out.worktreePath, displayPath(path.join(worktreesRoot, ticketId)));
    assert.equal(await currentBranch(path.join(worktreesRoot, ticketId)), out.branch);
  }, { location: "../explicit-worktrees" });
});

test("worktree-add ignore-guards an explicit in-repo worktrees.location and leaves git status clean", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch, worktreesRoot) => {
    const ticketPath = await createTicket(root, "task", "Explicit in-repo path ticket", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T15:08:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add explicit in-repo path ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    assert.equal(worktreesRoot, path.resolve(root, "custom-worktrees"));

    const add = await runCli(["--root", root, "worktree-add", ticketId, "--json"]);
    assert.equal(add.code, 0, add.stderr);
    const out = JSON.parse(add.stdout);
    assert.equal(out.worktreePath, displayPath(path.join(worktreesRoot, ticketId)));
    assert.equal(await currentBranch(path.join(worktreesRoot, ticketId)), out.branch);

    const gitignoreAfter = await readFile(path.join(root, ".gitignore"), "utf8");
    assert.match(gitignoreAfter, /^custom-worktrees\/$/m);

    // Same clean-status guarantee as the "inside" layout: the nested worktree's
    // contents must not surface as untracked entries in the parent checkout.
    const status = await gitOutput(root, ["status", "--porcelain"]);
    for (const line of status.split(/\r?\n/).filter((line) => line !== "")) {
      assert.equal(line.includes("custom-worktrees"), false, `unexpected worktrees entry in status: ${line}`);
    }
  }, { location: "custom-worktrees" });
});

test("worktree-add treats a pre-existing explicit-path entry without a trailing slash as already present", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch, worktreesRoot) => {
    const relative = path.relative(root, worktreesRoot).split(path.sep).join("/");
    const before = await readFile(path.join(root, ".gitignore"), "utf8");
    await writeFile(path.join(root, ".gitignore"), `${before}${relative}\n`, "utf8");
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-m", "Add bare custom-worktrees ignore line"]);

    const ticketPath = await createTicket(root, "task", "Bare explicit path ticket", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T15:08:30Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add explicit in-repo path ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const before2 = await readFile(path.join(root, ".gitignore"), "utf8");
    assert.equal((await runCli(["--root", root, "worktree-add", ticketId, "--json"])).code, 0);
    const after = await readFile(path.join(root, ".gitignore"), "utf8");
    assert.equal(after, before2, "a bare entry must be recognized and nothing appended");
  }, { location: "custom-worktrees" });
});

test("worktree-add appends the ignore entry to a board with no existing .gitignore", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch) => {
    await rm(path.join(root, ".gitignore"), { force: true });
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-m", "Remove scaffolded gitignore for this test"]);

    const ticketPath = await createTicket(root, "task", "No gitignore ticket", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T15:09:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    assert.equal((await runCli(["--root", root, "worktree-add", ticketId, "--json"])).code, 0);

    const gitignoreAfter = await readFile(path.join(root, ".gitignore"), "utf8");
    assert.equal(gitignoreAfter, ".worktrees/\n");
  }, { location: "inside" });
});

test("worktree-add appends the ignore entry to an existing .gitignore lacking a trailing newline", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch) => {
    await writeFile(path.join(root, ".gitignore"), "node_modules/\n*.log", "utf8");
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-m", "Rewrite gitignore without trailing newline"]);

    const ticketPath = await createTicket(root, "task", "No trailing newline ticket", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T15:09:30Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    assert.equal((await runCli(["--root", root, "worktree-add", ticketId, "--json"])).code, 0);

    const gitignoreAfter = await readFile(path.join(root, ".gitignore"), "utf8");
    assert.equal(gitignoreAfter, "node_modules/\n*.log\n.worktrees/\n");
  }, { location: "inside" });
});

test("worktree-add rejects an explicit worktrees.location resolving inside plans/", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root) => {
    const ticketPath = await createTicket(root, "task", "Rejected explicit path ticket", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T15:07:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add rejected ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      defaultConfigJsonc().replace('"location": "sibling"', '"location": "plans/tickets"'),
      "utf8",
    );
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Point worktrees at plans/tickets"]);

    const result = await runCli(["--root", root, "worktree-add", ticketId]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /resolves inside plans\//);
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
