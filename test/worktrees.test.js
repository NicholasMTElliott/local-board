import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

import { main } from "../src/cli.js";
import { initProject } from "../src/scaffold.js";
import { createTicket, setTicketField } from "../src/tickets.js";
import { assertInvocationRootForTicket, worktreesRootFor } from "../src/worktrees.js";
import { defaultConfigJsonc } from "../src/config.js";
import { removeFixtureDir } from "./helpers/fixtures.js";

const execFileAsync = promisify(execFile);
const GIT_AVAILABLE = await hasGit();

async function withRepo(fn, options = {}) {
  const location = options.location ?? "sibling";
  const root = await mkdtemp(path.join(os.tmpdir(), "local-board-worktree-"));
  const worktreesRoot = worktreesRootFor(root, location);
  try {
    // Defensive pre-clean (B20260710T1533Z): `root` is unique per run, but a
    // `..`-relative worktrees.location (e.g. "../explicit-worktrees") resolves
    // ABOVE root to a fixed path in os.tmpdir(). A prior run aborted before the
    // finally-teardown can leave a stale worktree dir there; ticket IDs are
    // deterministic under a fixed `now`, so the next run collides on the exact
    // same target path. Clear it up front, symmetric with the finally below.
    await removeFixtureDir(worktreesRoot);
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

test(
  "worktree-add's repair path (branch field re-stamp on an already-registered worktree) commits durably inside the worktree",
  { skip: !GIT_AVAILABLE },
  async () => {
    await withRepo(async (root, _baseBranch, worktreesRoot) => {
      const ticketPath = await createTicket(root, "task", "Repair path commit", {
        status: "ready_for_implementation",
        now: new Date("2026-05-22T14:20:00Z"),
      });
      await git(root, ["add", "plans"]);
      await git(root, ["commit", "-m", "Add ticket"]);
      const ticketId = path.basename(ticketPath).split("_", 1)[0];
      const worktreePath = path.join(worktreesRoot, ticketId);

      const first = await runCli(["--root", root, "worktree-add", ticketId, "--json"]);
      assert.equal(first.code, 0, first.stderr);
      const branch = JSON.parse(first.stdout).branch;
      const worktreeTicketPath = path.join(worktreePath, "plans", "tickets", "ready", path.basename(ticketPath));
      const worktreeTipAfterFirst = await gitOutput(worktreePath, ["rev-parse", "HEAD"]);
      const rootTipBeforeSecond = await gitOutput(root, ["rev-parse", "HEAD"]);

      // The repair path re-writes the branch field into the worktree's copy
      // via setTicketField, which always bumps `updated` to the real current
      // time -- but that only produces a textual (and therefore committable)
      // diff if `updated` actually changes. Back-date the worktree's own
      // `updated` field first so the repair write is guaranteed to differ,
      // independent of the two CLI calls landing in the same wall-clock
      // second (formatIsoSeconds truncates to whole seconds).
      await writeFile(
        worktreeTicketPath,
        (await readFile(worktreeTicketPath, "utf8")).replace(/^updated: .*$/m, "updated: 2020-01-01T00:00:00Z"),
        "utf8",
      );
      await git(worktreePath, ["add", "plans"]);
      await git(worktreePath, ["commit", "-m", "Back-date updated for repair-path test"]);

      // The main checkout's own ticket copy never learns the branch field
      // (addTicketWorktree only stamps it inside the newly created worktree),
      // so a second worktree-add call always takes the repair path: it
      // re-writes the branch field into the worktree's copy, which must now
      // be committed durably inside that worktree.
      const second = await runCli(["--root", root, "worktree-add", ticketId, "--json"]);
      assert.equal(second.code, 0, second.stderr);
      assert.equal(JSON.parse(second.stdout).created, false);

      assert.equal(
        await gitOutput(worktreePath, ["status", "--porcelain", "--", "plans"]),
        "",
        "the repair path's branch re-stamp must be committed, leaving the worktree's plans/ clean",
      );
      const worktreeTipAfterSecond = await gitOutput(worktreePath, ["rev-parse", "HEAD"]);
      assert.notEqual(worktreeTipAfterSecond, worktreeTipAfterFirst, "the repair path must land a new commit");
      assert.equal(
        await gitOutput(worktreePath, ["log", "-1", "--pretty=%s"]),
        `${ticketId}: worktree-add ${branch}`,
      );

      // The main checkout is untouched by the repair commit -- it landed in
      // the worktree's own git history, not the main root's.
      assert.equal(await gitOutput(root, ["rev-parse", "HEAD"]), rootTipBeforeSecond);
    });
  },
);

test(
  "worktree-add's repair path leaves the branch re-stamp uncommitted when commitPlanningOnTransition is false",
  { skip: !GIT_AVAILABLE },
  async () => {
    await withRepo(async (root, _baseBranch, worktreesRoot) => {
      await writeFile(
        path.join(root, "plans", "local-board.config.jsonc"),
        defaultConfigJsonc().replace('"commitPlanningOnTransition": true', '"commitPlanningOnTransition": false'),
        "utf8",
      );
      await git(root, ["add", "plans"]);
      await git(root, ["commit", "-m", "Disable commitPlanningOnTransition"]);

      const ticketPath = await createTicket(root, "task", "Repair path no commit", {
        status: "ready_for_implementation",
        now: new Date("2026-05-22T14:21:00Z"),
      });
      await git(root, ["add", "plans"]);
      await git(root, ["commit", "-m", "Add ticket"]);
      const ticketId = path.basename(ticketPath).split("_", 1)[0];
      const worktreePath = path.join(worktreesRoot, ticketId);

      assert.equal((await runCli(["--root", root, "worktree-add", ticketId, "--json"])).code, 0);
      const worktreeTicketPath = path.join(worktreePath, "plans", "tickets", "ready", path.basename(ticketPath));

      // Back-date `updated` for the same reason as the sibling test above:
      // guarantee the repair path's re-stamp produces a real diff, independent
      // of the two CLI calls landing in the same wall-clock second.
      await writeFile(
        worktreeTicketPath,
        (await readFile(worktreeTicketPath, "utf8")).replace(/^updated: .*$/m, "updated: 2020-01-01T00:00:00Z"),
        "utf8",
      );
      await git(worktreePath, ["add", "plans"]);
      await git(worktreePath, ["commit", "-m", "Back-date updated for repair-path test"]);
      const worktreeTipAfterFirst = await gitOutput(worktreePath, ["rev-parse", "HEAD"]);

      const second = await runCli(["--root", root, "worktree-add", ticketId, "--json"]);
      assert.equal(second.code, 0, second.stderr);
      assert.equal(JSON.parse(second.stdout).created, false);

      assert.equal(
        await gitOutput(worktreePath, ["rev-parse", "HEAD"]),
        worktreeTipAfterFirst,
        "no commit should be made when the flag is off",
      );
      assert.notEqual(
        await gitOutput(worktreePath, ["status", "--porcelain", "--", "plans"]),
        "",
        "the branch re-stamp should remain uncommitted, exactly like current (pre-flag) behavior",
      );
    });
  },
);

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

test("worktree-add refuses an untracked ticket file, creating no worktree, branch, or directory", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch, worktreesRoot) => {
    const ticketPath = await createTicket(root, "task", "Untracked ticket", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T14:07:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    const branch = `local-board/${ticketId}-untracked-ticket`;
    const worktreePath = path.join(worktreesRoot, ticketId);

    // Deliberately do not commit the ticket: it is untracked relative to HEAD.
    const result = await runCli(["--root", root, "worktree-add", ticketId]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /not committed \(untracked at HEAD\)/);
    assert.match(result.stderr, /[Cc]ommit plans\//);

    assert.deepEqual(JSON.parse((await runCli(["--root", root, "worktree-list", "--json"])).stdout), []);
    assert.equal(await gitOutput(root, ["branch", "--list", branch]), "");
    assert.equal(await pathExists(worktreePath), false, "no worktree directory should be created on refusal");
  });
});

test("worktree-add refuses a dirty (tracked-but-modified) ticket file, creating no worktree, branch, or directory", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch, worktreesRoot) => {
    const ticketPath = await createTicket(root, "task", "Dirty ticket", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T14:08:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    const branch = `local-board/${ticketId}-dirty-ticket`;
    const worktreePath = path.join(worktreesRoot, ticketId);

    // Committed once, then edited without a follow-up commit: tracked but dirty.
    await setTicketField(root, ticketId, "priority", "P1", { now: new Date("2026-05-22T14:09:00Z") });

    const result = await runCli(["--root", root, "worktree-add", ticketId]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /has uncommitted changes/);
    assert.match(result.stderr, /[Cc]ommit plans\//);

    assert.deepEqual(JSON.parse((await runCli(["--root", root, "worktree-list", "--json"])).stdout), []);
    assert.equal(await gitOutput(root, ["branch", "--list", branch]), "");
    assert.equal(await pathExists(worktreePath), false, "no worktree directory should be created on refusal");
  });
});

test("worktree-add on a committed ticket is unaffected by the commit preflight (clean happy path)", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch, worktreesRoot) => {
    const ticketPath = await createTicket(root, "task", "Clean committed ticket", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T14:10:30Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const result = await runCli(["--root", root, "worktree-add", ticketId, "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.equal(out.created, true);
    assert.equal(await currentBranch(path.join(worktreesRoot, ticketId)), out.branch);
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

test("worktree-remove resolves the main root and succeeds when invoked with the ticket's own worktree root", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch, worktreesRoot) => {
    const ticketPath = await createTicket(root, "task", "Remove from worktree root", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T14:04:30Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add removable ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    const worktreePath = path.join(worktreesRoot, ticketId);
    assert.equal((await runCli(["--root", root, "worktree-add", ticketId, "--json"])).code, 0);

    // Invoked with --root <worktreePath> (the "wrong" root for git's own
    // rev-parse --show-toplevel, which would resolve to the worktree itself)
    // -- removeTicketWorktree must resolve the shared main root instead, so
    // `git worktree remove` targets the worktree from outside it.
    const removed = await runCli(["--root", worktreePath, "worktree-remove", ticketId, "--json"]);
    assert.equal(removed.code, 0, removed.stderr);
    assert.deepEqual(JSON.parse(removed.stdout), {
      ticketId,
      worktreePath: displayPath(worktreePath),
      removed: true,
    });

    const again = await runCli(["--root", root, "worktree-remove", ticketId, "--json"]);
    assert.equal(again.code, 0, again.stderr);
    assert.equal(JSON.parse(again.stdout).removed, false);
  });
});

test("guard refuses a per-ticket mutation from the main root when the ticket has a registered worktree", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch, worktreesRoot) => {
    // withRepo scaffolds the default config, whose worktrees block ships
    // guardWrongRoot: true.
    const ticketPath = await createTicket(root, "task", "Guard refuse ticket", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T16:00:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "worktree-add", ticketId, "--json"])).code, 0);
    const worktreePath = path.join(worktreesRoot, ticketId);
    const before = await readFile(ticketPath, "utf8");

    const result = await runCli(["--root", root, "move", ticketId, "questions"]);

    assert.equal(result.code, 2);
    assert.match(result.stderr, new RegExp(`^refusing to mutate ${escapeRegExp(ticketId)} from `));
    assert.match(
      result.stderr,
      new RegExp(`registered worktree at ${escapeRegExp(displayPath(worktreePath))}`),
    );
    assert.match(
      result.stderr,
      new RegExp(`Re-run with --root ${escapeRegExp(displayPath(worktreePath))}, or pass --allow-main-root to override\\.$`),
    );

    const after = await readFile(ticketPath, "utf8");
    assert.equal(after, before, "mainline ticket file must be byte-unchanged after a refused mutation");
  });
});

test("guard is overridden by --allow-main-root", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root) => {
    const ticketPath = await createTicket(root, "task", "Guard override ticket", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T16:01:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "worktree-add", ticketId, "--json"])).code, 0);

    const result = await runCli(["--root", root, "move", ticketId, "questions", "--allow-main-root"]);
    assert.equal(result.code, 0, result.stderr);
  });
});

test("guard allows a mutation from the ticket's own registered worktree root", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch, worktreesRoot) => {
    const ticketPath = await createTicket(root, "task", "Guard correct root ticket", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T16:02:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "worktree-add", ticketId, "--json"])).code, 0);
    const worktreePath = path.join(worktreesRoot, ticketId);

    const result = await runCli(["--root", worktreePath, "move", ticketId, "questions"]);
    assert.equal(result.code, 0, result.stderr);
  });
});

test("guard no-ops when the ticket has no registered worktree (single-ticket mode)", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root) => {
    const ticketPath = await createTicket(root, "task", "No worktree guard ticket", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T16:03:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const result = await runCli(["--root", root, "move", ticketId, "questions"]);
    assert.equal(result.code, 0, result.stderr);
  });
});

test("guard refuses promote from the main root when the ticket has a registered worktree; succeeds with --allow-main-root and from the worktree root", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch, worktreesRoot) => {
    const ticketPath = await createTicket(root, "task", "Guard promote ticket", {
      status: "backlog",
      now: new Date("2026-05-22T16:04:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "worktree-add", ticketId, "--json"])).code, 0);
    const worktreePath = path.join(worktreesRoot, ticketId);

    const refused = await runCli(["--root", root, "promote", ticketId]);
    assert.equal(refused.code, 2);
    assert.match(refused.stderr, new RegExp(`^refusing to mutate ${escapeRegExp(ticketId)} from `));

    const overridden = await runCli(["--root", root, "promote", ticketId, "--allow-main-root"]);
    assert.equal(overridden.code, 0, overridden.stderr);
  });
});

test("guard is a no-op when worktrees.guardWrongRoot is false (non-breaking default for older boards)", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root) => {
    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      defaultConfigJsonc().replace('"guardWrongRoot": true', '"guardWrongRoot": false'),
      "utf8",
    );
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Disable guardWrongRoot"]);

    const ticketPath = await createTicket(root, "task", "Guard disabled ticket", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T16:04:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "worktree-add", ticketId, "--json"])).code, 0);

    // Wrong root (main checkout), guard disabled: succeeds despite the
    // registered worktree.
    const result = await runCli(["--root", root, "move", ticketId, "questions"]);
    assert.equal(result.code, 0, result.stderr);
  });
});

test("gate-check refuses the empty-catalog auto-stamp from the main root when the ticket has a registered worktree", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch, worktreesRoot) => {
    const ticketPath = await createTicket(root, "task", "Gate-check guard refuse ticket", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T16:05:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "worktree-add", ticketId, "--json"])).code, 0);
    const worktreePath = path.join(worktreesRoot, ticketId);
    const before = await readFile(ticketPath, "utf8");

    // optionalSteps.test is empty in the scaffold config: this is the
    // mutating (auto-stamp) branch of gate-check, so the guard must fire
    // before recordGateSkippedEmptyCatalog writes the ticket.
    const result = await runCli(["--root", root, "gate-check", ticketId, "--stage", "test"]);

    assert.equal(result.code, 2);
    assert.match(result.stderr, new RegExp(`^refusing to mutate ${escapeRegExp(ticketId)} from `));
    assert.match(
      result.stderr,
      new RegExp(`Re-run with --root ${escapeRegExp(displayPath(worktreePath))}, or pass --allow-main-root to override\\.$`),
    );

    const after = await readFile(ticketPath, "utf8");
    assert.equal(after, before, "mainline ticket file must be byte-unchanged after a refused gate-check");
  });
});

test("gate-check --allow-main-root overrides the guard on the empty-catalog auto-stamp", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root) => {
    const ticketPath = await createTicket(root, "task", "Gate-check guard override ticket", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T16:06:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "worktree-add", ticketId, "--json"])).code, 0);

    const result = await runCli(["--root", root, "gate-check", ticketId, "--stage", "test", "--allow-main-root", "--json"]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(await readFile(ticketPath, "utf8"), /^completedSteps: \[gate:test:skipped-empty-catalog\]$/m);
  });
});

test("gate-check succeeds from the ticket's own registered worktree root on the empty-catalog auto-stamp", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch, worktreesRoot) => {
    const ticketPath = await createTicket(root, "task", "Gate-check guard correct root ticket", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T16:07:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "worktree-add", ticketId, "--json"])).code, 0);
    const worktreePath = path.join(worktreesRoot, ticketId);

    const result = await runCli(["--root", worktreePath, "gate-check", ticketId, "--stage", "test", "--json"]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(
      await readFile(path.join(worktreePath, "plans", "tickets", "ready", path.basename(ticketPath)), "utf8"),
      /^completedSteps: \[gate:test:skipped-empty-catalog\]$/m,
    );
  });
});

test("design-review-complete refuses from the main root before any write when the ticket has a registered worktree; succeeds from the worktree root", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch, worktreesRoot) => {
    // withRepo scaffolds the default config: routing.requireDesignReview and
    // worktrees.guardWrongRoot both ship true.
    const ticketPath = await createTicket(root, "task", "Design-review-complete guard ticket", {
      status: "ready_for_design",
      now: new Date("2026-05-22T16:08:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "worktree-add", ticketId, "--json"])).code, 0);
    const worktreePath = path.join(worktreesRoot, ticketId);
    const before = await readFile(ticketPath, "utf8");

    // AC: "wrong root refused before write" -- assertInvocationRootForTicket
    // must throw before recordDesignReview acquires the lock or writes.
    const result = await runCli([
      "--root", root, "design-review-complete", ticketId,
      "--executor", "codex-task:read-only", "--model", "gpt-5.6-sol", "--evidence", "PASS",
    ]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, new RegExp(`^refusing to mutate ${escapeRegExp(ticketId)} from `));
    assert.match(
      result.stderr,
      new RegExp(`Re-run with --root ${escapeRegExp(displayPath(worktreePath))}, or pass --allow-main-root to override\\.$`),
    );

    const after = await readFile(ticketPath, "utf8");
    assert.equal(after, before, "mainline ticket file must be byte-unchanged after a refused design-review-complete");
    assert.doesNotMatch(after, /design-review/);

    // Correct root (the ticket's own registered worktree) succeeds.
    const ok = await runCli([
      "--root", worktreePath, "design-review-complete", ticketId,
      "--executor", "codex-task:read-only", "--model", "gpt-5.6-sol", "--evidence", "PASS", "--json",
    ]);
    assert.equal(ok.code, 0, ok.stderr);
    assert.match(
      await readFile(path.join(worktreePath, "plans", "tickets", "ready", path.basename(ticketPath)), "utf8"),
      /design-review:codex-task:read-only@gpt-5\.6-sol/,
    );
  });
});

test("design-review-check refuses from the main root before any resolution when the ticket has a registered worktree; --allow-main-root overrides", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, _baseBranch, worktreesRoot) => {
    const ticketPath = await createTicket(root, "task", "Design-review-check guard ticket", {
      status: "ready_for_design",
      now: new Date("2026-05-22T16:09:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "worktree-add", ticketId, "--json"])).code, 0);
    const worktreePath = path.join(worktreesRoot, ticketId);

    const refused = await runCli(["--root", root, "design-review-check", ticketId]);
    assert.equal(refused.code, 2);
    assert.match(refused.stderr, new RegExp(`^refusing to mutate ${escapeRegExp(ticketId)} from `));
    assert.match(
      refused.stderr,
      new RegExp(`Re-run with --root ${escapeRegExp(displayPath(worktreePath))}, or pass --allow-main-root to override\\.$`),
    );

    // --allow-main-root overrides the guard even though design-review-check
    // performs no write of its own.
    const overridden = await runCli(["--root", root, "design-review-check", ticketId, "--allow-main-root", "--json"]);
    assert.equal(overridden.code, 0, overridden.stderr);
    assert.equal(JSON.parse(overridden.stdout).agent, "codex-task:read-only");
  });
});

test("design-review-complete --allow-main-root overrides the wrong-root guard from the main root", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root) => {
    const ticketPath = await createTicket(root, "task", "Design-review-complete guard override ticket", {
      status: "ready_for_design",
      now: new Date("2026-05-22T16:10:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "worktree-add", ticketId, "--json"])).code, 0);

    const result = await runCli([
      "--root", root, "design-review-complete", ticketId,
      "--executor", "codex-task:read-only", "--model", "gpt-5.6-sol", "--evidence", "PASS",
      "--allow-main-root", "--json",
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(
      await readFile(ticketPath, "utf8"),
      /design-review:codex-task:read-only@gpt-5\.6-sol/,
    );
  });
});

test("assertInvocationRootForTicket fails open when git resolution fails (non-git directory)", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-board-guard-nogit-"));
  try {
    await mkdir(path.join(root, "plans"), { recursive: true });
    await writeFile(path.join(root, "plans", "local-board.config.jsonc"), defaultConfigJsonc(), "utf8");

    await assert.doesNotReject(assertInvocationRootForTicket(root, "T20260101T0000Z", {}));
  } finally {
    await removeFixtureDir(root);
  }
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

// Flips the scaffolded config's git.autoVersionBump from its false default
// to true, committing the change (mirroring how this repo's own
// plans/local-board.config.jsonc opts itself in). Ticket T20260712T1415Z.
async function enableAutoVersionBump(root) {
  const configPath = path.join(root, "plans", "local-board.config.jsonc");
  const current = await readFile(configPath, "utf8");
  const updated = current.replace('"autoVersionBump": false', '"autoVersionBump": true');
  assert.notEqual(updated, current, "expected to find autoVersionBump: false in the scaffolded config");
  await writeFile(configPath, updated, "utf8");
  await git(root, ["add", "plans"]);
  await git(root, ["commit", "-m", "Enable autoVersionBump for test"]);
}

test("fast-forward with git.autoVersionBump=true bumps and commits chore: bump version, advancing the marker, when the range touches an installable path", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, baseBranch, worktreesRoot) => {
    await enableAutoVersionBump(root);
    await writeFile(path.join(root, "package.json"), `${JSON.stringify({ name: "fixture", version: "1.0.0" }, null, 2)}\n`, "utf8");
    await git(root, ["add", "package.json"]);
    await git(root, ["commit", "-m", "Add package.json"]);

    const ticketPath = await createTicket(root, "task", "Version bump via fast-forward", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T16:00:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add version-bump ticket"]);
    const previousHead = await gitOutput(root, ["rev-parse", "HEAD"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const add = await runCli(["--root", root, "worktree-add", ticketId, "--json"]);
    assert.equal(add.code, 0, add.stderr);
    const worktreePath = path.join(worktreesRoot, ticketId);
    await mkdir(path.join(worktreePath, "src"), { recursive: true });
    await writeFile(path.join(worktreePath, "src", "feature.js"), "// feature\n", "utf8");
    await git(worktreePath, ["add", "plans", "src/feature.js"]);
    await git(worktreePath, ["commit", "-m", `Implement ${ticketId}`]);
    const newHead = await gitOutput(worktreePath, ["rev-parse", "HEAD"]);
    await git(worktreePath, ["update-ref", `refs/heads/${baseBranch}`, newHead, previousHead]);

    const advanced = await runCli(["--root", root, "fast-forward", "--json"]);
    assert.equal(advanced.code, 0, advanced.stderr);
    const result = JSON.parse(advanced.stdout);
    assert.equal(result.advanced, true);
    assert.equal(result.versionBump.bumped, true);
    assert.equal(result.versionBump.reason, "bumped");
    assert.equal(result.versionBump.from, "1.0.0");
    assert.equal(result.versionBump.to, "1.0.1");

    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    assert.equal(pkg.version, "1.0.1");
    const headSubject = await gitOutput(root, ["log", "-1", "--pretty=%s"]);
    assert.match(headSubject, /^chore: bump version 1\.0\.1$/);
    const marker = await gitOutput(root, ["rev-parse", "refs/local-board/version-bump-head"]);
    const head = await gitOutput(root, ["rev-parse", "HEAD"]);
    assert.equal(marker, head);
  });
});

test("fast-forward with git.autoVersionBump=true reports no-payload-change (no commit) when the advanced range touches only plans/", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, baseBranch, worktreesRoot) => {
    await enableAutoVersionBump(root);

    const ticketPath = await createTicket(root, "task", "Planning-only fast-forward", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T16:10:00Z"),
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add planning-only ticket"]);
    const previousHead = await gitOutput(root, ["rev-parse", "HEAD"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const add = await runCli(["--root", root, "worktree-add", ticketId, "--json"]);
    assert.equal(add.code, 0, add.stderr);
    const worktreePath = path.join(worktreesRoot, ticketId);
    await writeFile(path.join(worktreePath, "plans", "note.md"), "note\n", "utf8");
    await git(worktreePath, ["add", "plans"]);
    await git(worktreePath, ["commit", "-m", `Planning-only change for ${ticketId}`]);
    const newHead = await gitOutput(worktreePath, ["rev-parse", "HEAD"]);
    await git(worktreePath, ["update-ref", `refs/heads/${baseBranch}`, newHead, previousHead]);

    const advanced = await runCli(["--root", root, "fast-forward", "--json"]);
    assert.equal(advanced.code, 0, advanced.stderr);
    const result = JSON.parse(advanced.stdout);
    assert.equal(result.advanced, true);
    assert.deepEqual(result.versionBump, { bumped: false, from: null, to: null, level: null, reason: "no-payload-change" });

    // No extra bump commit landed on top of the fast-forwarded tip.
    assert.equal(await gitOutput(root, ["rev-parse", "HEAD"]), newHead);
  });
});

// versionBump's no-range self-resolved base (marker -> last bump commit ->
// root commit) scans the WHOLE history back to the repo root, not just
// fast-forward's own before/after pair -- so on this fixture (withRepo's own
// setup commits: README.md, then the scaffolded plans/.gitignore) the
// no-marker/no-prior-bump base is the root (README-only) commit, and the
// range to HEAD covers only the scaffold-init commit, which touches no
// installable path. The correct reason is therefore no-payload-change, not
// not-advanced (which src/version-bump.js's own unit coverage in
// test/version-bump.test.js exercises directly, e.g. the fresh-clone
// no-re-bump regression). This still proves the property this test names:
// "nothing installable has happened yet" never spuriously bumps.
test("fast-forward with git.autoVersionBump=true does not spuriously bump when nothing installable has happened yet (advanced stays false; no prior bump/marker)", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root) => {
    await enableAutoVersionBump(root);

    const clean = await runCli(["--root", root, "fast-forward", "--json"]);
    assert.equal(clean.code, 0, clean.stderr);
    const result = JSON.parse(clean.stdout);
    assert.equal(result.advanced, false);
    assert.deepEqual(result.versionBump, { bumped: false, from: null, to: null, level: null, reason: "no-payload-change" });
  });
});

// The three tests above use the EXTERNAL-ADVANCE topology (a detached
// worktree pushes a ref this checkout then adopts via reflog-tree-match),
// where cleanCheckoutHead legitimately resolves previousHead !== newHead.
// The two tests below cover the PRIMARY real-workflow topology instead: the
// merge lands directly IN the project root checkout (`git merge --no-ff` on
// the default branch, exactly what every closeout skill contract does)
// before `fast-forward` ever runs. That topology always resolves
// previousHead === newHead (nothing EXTERNAL advanced this checkout) and
// `advanced: false` — a range built from that pair is always empty, which is
// exactly the acceptance gap fastForwardDefaultBranch's no-range
// runVersionBump call (marker -> last bump commit -> root, tip = HEAD) now
// closes. Regression per ticket T20260712T1415Z test-stage finding.
test("fast-forward with git.autoVersionBump=true bumps when the merge lands IN the checkout (git merge --no-ff on the default branch; advanced stays false)", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, baseBranch) => {
    await enableAutoVersionBump(root);
    await writeFile(path.join(root, "package.json"), `${JSON.stringify({ name: "fixture", version: "1.0.0" }, null, 2)}\n`, "utf8");
    await git(root, ["add", "package.json"]);
    await git(root, ["commit", "-m", "Add package.json"]);

    await git(root, ["switch", "-c", "feature/in-checkout"]);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "feature.js"), "// feature\n", "utf8");
    await git(root, ["add", "src"]);
    await git(root, ["commit", "-m", "Implement feature"]);
    await git(root, ["switch", baseBranch]);
    await git(root, ["merge", "--no-ff", "feature/in-checkout", "-m", "Merge feature/in-checkout"]);

    const advanced = await runCli(["--root", root, "fast-forward", "--json"]);
    assert.equal(advanced.code, 0, advanced.stderr);
    const result = JSON.parse(advanced.stdout);
    // Confirms the topology: nothing external moved this checkout, so the
    // top-level advanced flag is false even though a real bump must fire.
    assert.equal(result.advanced, false);
    assert.equal(result.versionBump.bumped, true);
    assert.equal(result.versionBump.reason, "bumped");
    assert.equal(result.versionBump.from, "1.0.0");
    assert.equal(result.versionBump.to, "1.0.1");

    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    assert.equal(pkg.version, "1.0.1");
    const headSubject = await gitOutput(root, ["log", "-1", "--pretty=%s"]);
    assert.match(headSubject, /^chore: bump version 1\.0\.1$/);
    const marker = await gitOutput(root, ["rev-parse", "refs/local-board/version-bump-head"]);
    const head = await gitOutput(root, ["rev-parse", "HEAD"]);
    assert.equal(marker, head);
  });
});

test("fast-forward with git.autoVersionBump=true reports no-payload-change when an in-checkout merge (git merge --no-ff) touches only plans/", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, baseBranch) => {
    await enableAutoVersionBump(root);

    await git(root, ["switch", "-c", "feature/planning-only"]);
    await writeFile(path.join(root, "plans", "note.md"), "note\n", "utf8");
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Planning-only change"]);
    await git(root, ["switch", baseBranch]);
    await git(root, ["merge", "--no-ff", "feature/planning-only", "-m", "Merge feature/planning-only"]);

    const advanced = await runCli(["--root", root, "fast-forward", "--json"]);
    assert.equal(advanced.code, 0, advanced.stderr);
    const result = JSON.parse(advanced.stdout);
    assert.equal(result.advanced, false);
    assert.deepEqual(result.versionBump, { bumped: false, from: null, to: null, level: null, reason: "no-payload-change" });
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

test("worktree-add tolerates a stale fixed-name worktrees dir from an aborted prior run", { skip: !GIT_AVAILABLE }, async () => {
  // Simulate an aborted prior run: pre-seed the FIXED outside worktrees root
  // (<tmp>/explicit-worktrees) with a leftover ticket-id subdir + junk file,
  // exactly what a run killed before its finally-teardown would leave behind.
  const staleWorktreesRoot = path.join(os.tmpdir(), "explicit-worktrees");
  await mkdir(path.join(staleWorktreesRoot, "T20260522T1506Z"), { recursive: true });
  await writeFile(path.join(staleWorktreesRoot, "T20260522T1506Z", "leftover.txt"), "stale\n", "utf8");

  await withRepo(async (root, _baseBranch, worktreesRoot) => {
    assert.equal(worktreesRoot, staleWorktreesRoot); // proves the fixed path
    const ticketPath = await createTicket(root, "task", "Explicit path ticket", {
      status: "ready_for_implementation",
      now: new Date("2026-05-22T15:06:00Z"), // -> T20260522T1506Z, the seeded id
    });
    await git(root, ["add", "plans"]);
    await git(root, ["commit", "-m", "Add explicit path ticket"]);
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    assert.equal(ticketId, "T20260522T1506Z");

    // Pre-fix: worktree-add throws "exists but is not a registered git worktree"
    // (code 2) on the stale collision. Post-fix: withRepo's pre-clean wiped it.
    const add = await runCli(["--root", root, "worktree-add", ticketId, "--json"]);
    assert.equal(add.code, 0, add.stderr);
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
