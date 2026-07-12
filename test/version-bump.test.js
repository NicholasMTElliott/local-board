import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceVersionBumpMarker,
  mapBumpLevel,
  maxLevel,
  MERGE_SUBJECT_RE,
  nextVersion,
  readVersionBumpMarker,
  runVersionBump,
  selectBump,
  VERSION_BUMP_MARKER_REF,
} from "../src/version-bump.js";
import { TICKET_ID_RE } from "../src/tickets.js";
import { removeFixtureDir } from "./helpers/fixtures.js";

const execFileAsync = promisify(execFile);
const GIT_AVAILABLE = await hasGit();

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

async function withRepo(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-board-version-bump-"));
  try {
    await git(root, ["init"]);
    await git(root, ["config", "gc.auto", "0"]);
    await git(root, ["config", "gc.autoDetach", "false"]);
    await git(root, ["config", "user.email", "local-board@example.test"]);
    await git(root, ["config", "user.name", "local-board test"]);
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "plans", "tickets", "active"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify({ name: "fixture", version: "1.0.0" }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(path.join(root, "README.md"), "# Fixture\n", "utf8");
    await writeFile(path.join(root, "src", "index.js"), "// index\n", "utf8");
    await writeFile(path.join(root, "plans", "tickets", "active", ".gitkeep"), "", "utf8");
    await git(root, ["add", "package.json", "README.md", "src", "plans"]);
    await git(root, ["commit", "-m", "Initial commit"]);
    const defaultBranch = await gitOutput(root, ["branch", "--show-current"]);
    await fn(root, defaultBranch);
  } finally {
    await removeFixtureDir(root);
  }
}

function baseConfig(defaultBranch, overrides = {}) {
  return { git: { autoVersionBump: true, defaultBranch, ...overrides } };
}

let commitSeq = 0;
function nextSeq() {
  commitSeq += 1;
  return commitSeq;
}

async function commitInstallable(root, message, relPath) {
  const target = relPath ?? `src/feature-${nextSeq()}.js`;
  await mkdir(path.dirname(path.join(root, target)), { recursive: true });
  await writeFile(path.join(root, target), `// ${message}\n`, "utf8");
  await git(root, ["add", "--", target]);
  await git(root, ["commit", "-m", message]);
  return gitOutput(root, ["rev-parse", "HEAD"]);
}

async function commitPlansOnly(root, message) {
  const target = `plans/tickets/active/note-${nextSeq()}.md`;
  await writeFile(path.join(root, target), "note\n", "utf8");
  await git(root, ["add", "--", target]);
  await git(root, ["commit", "-m", message]);
  return gitOutput(root, ["rev-parse", "HEAD"]);
}

// Real merge commits (not plain commits) so `git log --merges` finds them,
// mirroring how ticket branches land on the default branch in real usage.
async function mergeTicketBranch(root, defaultBranch, ticketId, relPath) {
  const branch = `feature/${ticketId}`;
  await git(root, ["switch", "-c", branch]);
  await mkdir(path.dirname(path.join(root, relPath)), { recursive: true });
  await writeFile(path.join(root, relPath), `// ${ticketId}\n`, "utf8");
  await git(root, ["add", "--", relPath]);
  await git(root, ["commit", "-m", `Implement ${ticketId}`]);
  await git(root, ["switch", defaultBranch]);
  await git(root, ["merge", "--no-ff", branch, "-m", `Merge ${ticketId}`]);
  return gitOutput(root, ["rev-parse", "HEAD"]);
}

function ticketFixtureText(id, type) {
  return `---
id: ${id}
type: ${type}
status: done
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: 4
estimateBasis: bootstrap
workStartedAt: null
workCompletedAt: null
created: 2026-07-01T00:00:00Z
updated: 2026-07-01T00:00:00Z
completedSteps: []
routingApprovals: []
---
# Fixture ${id}
`;
}

// Ticket files are discovered from the live working tree (not a specific git
// revision), so it is enough for them to exist on disk at call time; folder
// placement (done/archived) is human organization only. Committed
// immediately so later `git status --porcelain` checks stay clean.
async function writeTicket(root, id, type, dir = "done") {
  const filePath = path.join(root, "plans", "tickets", dir, `${id}_fixture-${type}.md`);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, ticketFixtureText(id, type), "utf8");
  await git(root, ["add", "plans"]);
  await git(root, ["commit", "-m", `Add fixture ticket ${id}`]);
}

test("mapBumpLevel maps each ticket type to its semver level; unknown types map to null", () => {
  assert.equal(mapBumpLevel("bug"), "patch");
  assert.equal(mapBumpLevel("task"), "minor");
  assert.equal(mapBumpLevel("story"), "minor");
  assert.equal(mapBumpLevel("epic"), "major");
  assert.equal(mapBumpLevel("unknown"), null);
});

test("maxLevel reduces to the highest-ranked level; empty/null-only input defaults to patch", () => {
  assert.equal(maxLevel([]), "patch");
  assert.equal(maxLevel([null, undefined]), "patch");
  assert.equal(maxLevel(["patch"]), "patch");
  assert.equal(maxLevel(["patch", "minor"]), "minor");
  assert.equal(maxLevel(["minor", "major", "patch"]), "major");
  assert.equal(maxLevel([null, "minor", undefined]), "minor");
});

test("nextVersion increments the given part and zeroes lower parts", () => {
  assert.equal(nextVersion("1.2.3", "patch"), "1.2.4");
  assert.equal(nextVersion("1.2.3", "minor"), "1.3.0");
  assert.equal(nextVersion("1.2.3", "major"), "2.0.0");
  assert.throws(() => nextVersion("1.2.3", "bogus"), /invalid bump level/);
  assert.throws(() => nextVersion("not-semver", "patch"), /invalid semver version/);
});

test("selectBump no-ops on plans-only changes and bumps (max level) on any installable change", () => {
  assert.deepEqual(
    selectBump({ changedPaths: ["plans/tickets/active/foo.md"], levels: ["major"] }),
    { bump: false, level: null },
  );
  assert.deepEqual(
    selectBump({ changedPaths: ["src/index.js", "plans/x.md"], levels: ["patch", "minor"] }),
    { bump: true, level: "minor" },
  );
  assert.deepEqual(selectBump({ changedPaths: [], levels: [] }), { bump: false, level: null });
});

test("MERGE_SUBJECT_RE matches Merge <B|S|E|T-id> subjects and rejects non-merge subjects", () => {
  assert.match("Merge B20260707T1317Z", MERGE_SUBJECT_RE);
  assert.match("Merge S20260707T1317Z into main", MERGE_SUBJECT_RE);
  assert.match("Merge E20260707T1317Z", MERGE_SUBJECT_RE);
  assert.match("Merge T20260707T1317Z", MERGE_SUBJECT_RE);
  assert.doesNotMatch("chore: bump version to 1.2.3", MERGE_SUBJECT_RE);
  assert.doesNotMatch("Merge pull request #12", MERGE_SUBJECT_RE);
  const match = "Merge T20260707T1317Z".match(MERGE_SUBJECT_RE);
  assert.equal(match[1], "T20260707T1317Z");
});

test("MERGE_SUBJECT_RE's ticket-id character class stays in lockstep with tickets.js's TICKET_ID_RE", () => {
  // MERGE_SUBJECT_RE is not derived from TICKET_ID_RE at module-load time
  // (see the comment in src/version-bump.js -- an import-cycle TDZ hazard),
  // so this test is the guard that keeps the two hand-maintained character
  // classes identical.
  const idClass = TICKET_ID_RE.source.slice(1, -1);
  assert.ok(MERGE_SUBJECT_RE.source.includes(idClass), `${MERGE_SUBJECT_RE.source} does not embed ${idClass}`);
});

test("runVersionBump bumps and commits chore: bump version when the range touches an installable path", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, defaultBranch) => {
    const before = await gitOutput(root, ["rev-parse", "HEAD"]);
    const after = await commitInstallable(root, "Add feature");
    const config = baseConfig(defaultBranch);

    const result = await runVersionBump(root, { range: { previousHead: before, newHead: after }, config });

    assert.equal(result.bumped, true);
    assert.equal(result.from, "1.0.0");
    assert.equal(result.level, "patch");
    assert.equal(result.to, "1.0.1");
    assert.equal(result.reason, "bumped");

    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    assert.equal(pkg.version, "1.0.1");
    const headSubject = await gitOutput(root, ["log", "-1", "--format=%s"]);
    assert.match(headSubject, /^chore: bump version 1\.0\.1$/);
    const marker = await readVersionBumpMarker(root);
    const head = await gitOutput(root, ["rev-parse", "HEAD"]);
    assert.equal(marker, head);
  });
});

test("runVersionBump no-ops (no-payload-change) when the range touches only plans/", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, defaultBranch) => {
    const before = await gitOutput(root, ["rev-parse", "HEAD"]);
    const after = await commitPlansOnly(root, "Planning-only change");
    const config = baseConfig(defaultBranch);

    const result = await runVersionBump(root, { range: { previousHead: before, newHead: after }, config });

    assert.deepEqual(result, { bumped: false, from: null, to: null, level: null, reason: "no-payload-change" });
    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    assert.equal(pkg.version, "1.0.0");
    assert.equal(await readVersionBumpMarker(root), null);
  });
});

test("runVersionBump refuses (dirty-package-json) when package.json has uncommitted changes at entry, and writes nothing", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, defaultBranch) => {
    const before = await gitOutput(root, ["rev-parse", "HEAD"]);
    const after = await commitInstallable(root, "Add feature");
    const dirtyText = `${JSON.stringify({ name: "fixture", version: "1.0.0", extra: true }, null, 2)}\n`;
    await writeFile(path.join(root, "package.json"), dirtyText, "utf8");
    const config = baseConfig(defaultBranch);

    const result = await runVersionBump(root, { range: { previousHead: before, newHead: after }, config });

    assert.equal(result.bumped, false);
    assert.equal(result.reason, "dirty-package-json");
    const raw = await readFile(path.join(root, "package.json"), "utf8");
    assert.equal(raw, dirtyText);
    assert.equal(await readVersionBumpMarker(root), null);
  });
});

test("runVersionBump no-ops (not-on-default) off the default branch", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, defaultBranch) => {
    await git(root, ["switch", "-c", "side"]);
    const config = baseConfig(defaultBranch);

    const result = await runVersionBump(root, { config });

    assert.deepEqual(result, { bumped: false, from: null, to: null, level: null, reason: "not-on-default" });
  });
});

test("runVersionBump no-ops (not-enabled) when git.autoVersionBump is not true", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, defaultBranch) => {
    const config = baseConfig(defaultBranch, { autoVersionBump: false });
    const result = await runVersionBump(root, { config });
    assert.deepEqual(result, { bumped: false, from: null, to: null, level: null, reason: "not-enabled" });
  });
});

test("runVersionBump takes the MAX level across a multi-merge range and resolves done/archived ticket types (B/T/E)", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, defaultBranch) => {
    await writeTicket(root, "B20260701T0100Z", "bug", "done");
    await writeTicket(root, "T20260701T0200Z", "task", "archived");
    await writeTicket(root, "E20260701T0300Z", "epic", "done");

    const before = await gitOutput(root, ["rev-parse", "HEAD"]);
    await mergeTicketBranch(root, defaultBranch, "B20260701T0100Z", "src/bug-fix.js");
    await mergeTicketBranch(root, defaultBranch, "T20260701T0200Z", "src/task-feature.js");
    const after = await mergeTicketBranch(root, defaultBranch, "E20260701T0300Z", "src/epic-feature.js");
    const config = baseConfig(defaultBranch);

    const result = await runVersionBump(root, { range: { previousHead: before, newHead: after }, config });

    assert.equal(result.bumped, true);
    assert.equal(result.level, "major");
    assert.equal(result.to, "2.0.0");
  });
});

test("runVersionBump resolves a merged story ticket (S) to a minor bump", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, defaultBranch) => {
    await writeTicket(root, "S20260701T0400Z", "story", "done");
    const before = await gitOutput(root, ["rev-parse", "HEAD"]);
    const after = await mergeTicketBranch(root, defaultBranch, "S20260701T0400Z", "src/story-feature.js");
    const config = baseConfig(defaultBranch);

    const result = await runVersionBump(root, { range: { previousHead: before, newHead: after }, config });

    assert.equal(result.bumped, true);
    assert.equal(result.level, "minor");
    assert.equal(result.to, "1.1.0");
  });
});

test("runVersionBump falls back to a flat patch bump when a merge subject's ticket id does not resolve", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, defaultBranch) => {
    const before = await gitOutput(root, ["rev-parse", "HEAD"]);
    // T20260701T0999Z has no fixture ticket file anywhere on disk.
    const after = await mergeTicketBranch(root, defaultBranch, "T20260701T0999Z", "src/unknown-ticket.js");
    const config = baseConfig(defaultBranch);

    const result = await runVersionBump(root, { range: { previousHead: before, newHead: after }, config });

    assert.equal(result.bumped, true);
    assert.equal(result.level, "patch");
    assert.equal(result.to, "1.0.1");
  });
});

test("runVersionBump --range explicit range recovery: an explicit range is used verbatim for level computation even when HEAD has since advanced further", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, defaultBranch) => {
    await writeTicket(root, "B20260701T0600Z", "bug", "done");
    await writeTicket(root, "E20260701T0700Z", "epic", "done");

    const before = await gitOutput(root, ["rev-parse", "HEAD"]);
    const after = await mergeTicketBranch(root, defaultBranch, "B20260701T0600Z", "src/bug-range.js");
    // HEAD advances further past `after` with a major-level merge that must
    // NOT be included when the range is given explicitly.
    await mergeTicketBranch(root, defaultBranch, "E20260701T0700Z", "src/epic-range.js");
    const config = baseConfig(defaultBranch);

    const result = await runVersionBump(root, { range: { previousHead: before, newHead: after }, config });

    assert.equal(result.bumped, true);
    assert.equal(result.level, "patch");
    assert.equal(result.to, "1.0.1");
  });
});

test("runVersionBump with no marker and no prior bump commit uses the root commit as the first-run base", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, defaultBranch) => {
    await commitInstallable(root, "Add feature");
    const config = baseConfig(defaultBranch);

    const result = await runVersionBump(root, { config });

    assert.equal(result.bumped, true);
    assert.equal(result.to, "1.0.1");
  });
});

test("marker contract: a no-range version-bump on the same clone immediately after an auto bump is a no-op (already-bumped)", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, defaultBranch) => {
    const before = await gitOutput(root, ["rev-parse", "HEAD"]);
    const after = await commitInstallable(root, "Add feature");
    const config = baseConfig(defaultBranch);

    const first = await runVersionBump(root, { range: { previousHead: before, newHead: after }, config });
    assert.equal(first.bumped, true);

    const markerAfterFirst = await readVersionBumpMarker(root);
    const headAfterFirst = await gitOutput(root, ["rev-parse", "HEAD"]);
    assert.equal(markerAfterFirst, headAfterFirst);

    const second = await runVersionBump(root, { config });
    assert.deepEqual(second, { bumped: false, from: null, to: null, level: null, reason: "already-bumped" });
  });
});

test("marker contract: a fresh clone with no marker does not re-bump an already-bumped range (detects the last bump commit)", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, defaultBranch) => {
    const before = await gitOutput(root, ["rev-parse", "HEAD"]);
    const after = await commitInstallable(root, "Add feature");
    const config = baseConfig(defaultBranch);

    const first = await runVersionBump(root, { range: { previousHead: before, newHead: after }, config });
    assert.equal(first.bumped, true);

    // Simulate a fresh clone: no local marker ref present.
    await git(root, ["update-ref", "-d", VERSION_BUMP_MARKER_REF]);
    assert.equal(await readVersionBumpMarker(root), null);

    const second = await runVersionBump(root, { config });
    assert.deepEqual(second, { bumped: false, from: null, to: null, level: null, reason: "not-advanced" });
  });
});

test("an unrelated commit whose subject starts 'chore: bump version' does not falsely suppress a real bump", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, defaultBranch) => {
    await writeFile(path.join(root, "docs-note.txt"), "note\n", "utf8");
    await git(root, ["add", "docs-note.txt"]);
    await git(root, ["commit", "-m", "chore: bump version policy docs (unrelated, not our commit)"]);
    await commitInstallable(root, "Add feature");
    const config = baseConfig(defaultBranch);

    const result = await runVersionBump(root, { config });

    assert.equal(result.bumped, true);
    assert.equal(result.to, "1.0.1");
  });
});

test("a concurrent marker move fails the CAS safely", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root) => {
    const head = await gitOutput(root, ["rev-parse", "HEAD"]);
    await advanceVersionBumpMarker(root, head, "");
    await assert.rejects(
      advanceVersionBumpMarker(root, head, "0000000000000000000000000000000000000000"),
    );
  });
});

test("--level major forces the level and skips the merge-subject scan / ticket lookup", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, defaultBranch) => {
    const before = await gitOutput(root, ["rev-parse", "HEAD"]);
    // Unresolved ticket id would otherwise fall back to patch on its own.
    const after = await mergeTicketBranch(root, defaultBranch, "B20260701T0500Z", "src/level-override.js");
    const config = baseConfig(defaultBranch);

    const result = await runVersionBump(root, { range: { previousHead: before, newHead: after }, level: "major", config });

    assert.equal(result.bumped, true);
    assert.equal(result.level, "major");
    assert.equal(result.to, "2.0.0");
  });
});

test("user edits to other files are never folded into the bump commit", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, defaultBranch) => {
    const before = await gitOutput(root, ["rev-parse", "HEAD"]);
    const after = await commitInstallable(root, "Add feature");
    await writeFile(path.join(root, "README.md"), "# Fixture\nlocal edit\n", "utf8");
    const config = baseConfig(defaultBranch);

    const result = await runVersionBump(root, { range: { previousHead: before, newHead: after }, config });
    assert.equal(result.bumped, true);

    const status = await gitOutput(root, ["status", "--porcelain", "--", "README.md"]);
    assert.notEqual(status.trim(), "");
    const committedFiles = (await gitOutput(root, ["show", "--name-only", "--format=", "HEAD"]))
      .split(/\r?\n/)
      .filter(Boolean);
    assert.deepEqual(committedFiles, ["package.json"]);
  });
});

test("a commit failure during the bump rolls package.json back and leaves the marker unmoved (a re-run recomputes the same target)", { skip: !GIT_AVAILABLE }, async () => {
  await withRepo(async (root, defaultBranch) => {
    const before = await gitOutput(root, ["rev-parse", "HEAD"]);
    const after = await commitInstallable(root, "Add feature");

    const hookPath = path.join(root, ".git", "hooks", "pre-commit");
    await writeFile(hookPath, "#!/bin/sh\nexit 1\n", "utf8");
    await chmod(hookPath, 0o755);

    const originalPkg = await readFile(path.join(root, "package.json"), "utf8");
    const config = baseConfig(defaultBranch);

    await assert.rejects(runVersionBump(root, { range: { previousHead: before, newHead: after }, config }));

    const afterFailure = await readFile(path.join(root, "package.json"), "utf8");
    assert.equal(afterFailure, originalPkg);
    assert.equal(await readVersionBumpMarker(root), null);
    const status = await gitOutput(root, ["status", "--porcelain"]);
    assert.equal(status.trim(), "");
  });
});
