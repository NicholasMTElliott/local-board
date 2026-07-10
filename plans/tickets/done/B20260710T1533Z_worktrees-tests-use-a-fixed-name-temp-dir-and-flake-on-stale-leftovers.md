---
id: B20260710T1533Z
type: bug
status: done
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/B20260710T1533Z-worktrees-tests-use-a-fixed-name-temp-dir-and-flake-on-stale-leftovers
estimate: 2
estimateBasis: B20260710T1532Z
workStartedAt: 2026-07-10T17:07:08Z
workCompletedAt: 2026-07-10T17:43:49Z
created: 2026-07-10T15:32:23Z
updated: 2026-07-10T17:43:49Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "design-review:codex-task:read-only@gpt-5.6-sol", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", "review:codex-task:read-only@gpt-5.6-terra", "test:claude-subagent:local-board-tester@sonnet", gate:test:skipped-empty-catalog, document:codex-task:workspace-write]
routingApprovals: []
---
# worktrees tests use a fixed-name temp dir and flake on stale leftovers

## Requirement

Retro item from the 2026-07-10 parallel run. During B20260710T1232Z's implementation, one npm test run hit an unrelated failure in test/worktrees.test.js caused by a stale fixed-name temp directory; an isolated re-run passed. Reported as: "One earlier run hit an unrelated flaky failure in test/worktrees.test.js (stale fixed-name temp dir), confirmed pre-existing by isolated re-run passing."

## Scope

1. Locate the worktrees test fixture(s) using a fixed (non-unique) temp directory name and identify how a stale leftover from an aborted prior run breaks the next run.
2. Fix: unique-per-run fixture directories (mkdtemp pattern) and/or defensive pre-clean, following the existing test/helpers/fixtures.js conventions (removeFixtureDir retried rm; gc.auto=0 fixtures per techContext).
3. Sweep test/worktrees.test.js for any sibling fixed-name usages while there.

## Acceptance criteria

- A deliberately pre-seeded stale directory (simulating an aborted run) no longer fails the suite.
- Repeated full-suite runs remain green (the flake was intermittent; the seeded-stale test makes the failure mode deterministic).
- npm run check and node --test pass.

## Non-goals

- No broader test-infrastructure refactor.

## Acceptance Criteria

## Related Tickets

## Technical Design

### Summary

`test/worktrees.test.js` roots every fixture on a unique `mkdtemp` dir, but one
test resolves its worktrees root to a **fixed** path *outside* that unique root.
An aborted prior run (killed before the `finally` teardown) leaves a stale
directory at that fixed path, and because ticket IDs are deterministic under a
fixed `now`, the next run collides on the exact same target path and fails.
Fix: add a defensive pre-clean of the resolved `worktreesRoot` at the top of
`withRepo`, symmetric with the existing `finally` teardown, and add a
seeded-stale regression test that makes the failure deterministic.

### Root cause (exact fixture + assertion)

`withRepo` (test/worktrees.test.js:19-50) creates a unique root:

```js
const root = await mkdtemp(path.join(os.tmpdir(), "local-board-worktree-"));
const worktreesRoot = worktreesRootFor(root, location);
```

`root` is unique per run, so any `location` that resolves *under* `root` is also
unique and self-cleans when `root` is removed. But `worktreesRootFor`
(src/worktrees.js:285-304) resolves a `..`-relative location *above* `root`:

- For `location: "../explicit-worktrees"` (the test at test/worktrees.test.js:966-983,
  "worktree-add supports an explicit relative worktrees.location outside the repo"),
  `worktreesRootFor` returns `path.resolve(repoRoot, "../explicit-worktrees")`,
  which collapses the unique `root` segment and yields the **fixed** path
  `<os.tmpdir()>/explicit-worktrees`. This equals the assertion at
  test/worktrees.test.js:976: `assert.equal(worktreesRoot, path.resolve(root, "..", "explicit-worktrees"))`.

Ticket IDs are deterministic: `createTicket` derives the ID from `options.now`
(src/tickets.js:2385-2388), and `TYPE_PREFIXES.get("task") === "T"`
(src/tickets.js:59-66). With `now: new Date("2026-05-22T15:06:00Z")` the ID is
always `T20260522T1506Z`, so the target worktree path is always the fixed
`<os.tmpdir()>/explicit-worktrees/T20260522T1506Z`.

Failure chain when a prior run of this test is aborted (SIGINT / crash / a peer
process killed during a parallel suite) after `git worktree add` but before the
`finally` at test/worktrees.test.js:46-49 runs `removeFixtureDir(worktreesRoot)`:

1. `<tmp>/explicit-worktrees/T20260522T1506Z` survives on disk. Its git-worktree
   registration lived in the *old* unique root's `.git/worktrees`, which is gone
   — so it is an orphaned directory, not a registered worktree of any live repo.
2. The next run creates a fresh unique `root`, mints the identical ticket ID, and
   calls `worktree-add`. `addTicketWorktree` (src/worktrees.js:41-43) sees the
   target path already exists but is not registered in the *fresh* root and throws
   `"<path> exists but is not a registered git worktree"`, which the CLI maps to
   exit code 2.
3. The failing assertion is test/worktrees.test.js:978:
   `assert.equal(add.code, 0, add.stderr)`.

This matches the retro exactly: intermittent (only on abort), unrelated to the
code under test, and green on an isolated re-run (which starts clean or first runs
the aborted run's leftover teardown).

### Sweep of sibling fixed-name usages

All `location` fixtures were audited (test/worktrees.test.js:805-1077):

- `location: "sibling"` (default, ~20 tests): `worktreesRootFor` returns
  `<dirname(root)>/<basename(root)>-worktrees` (src/worktrees.js:287-289) —
  derives from the **unique** `root` basename, so unique per run. Safe.
- `location: "inside"` (lines 805, 845, 871, 901, 942, 963, 1056, 1077):
  `<root>/.worktrees` — under the unique root, removed with it. Safe.
- `location: "custom-worktrees"` (lines 1012, 1035): `<root>/custom-worktrees` —
  under the unique root. Safe.
- `location: "../explicit-worktrees"` (line 982): `<os.tmpdir()>/explicit-worktrees`
  — **the only fixed-name path above the unique root. Vulnerable.**
- The non-git guard test (test/worktrees.test.js:636-646) uses its own
  `mkdtemp(... "local-board-guard-nogit-")`. Unique. Safe.

So there is exactly one vulnerable fixture path; there are no additional sibling
fixed-name usages to repair. The fix is still written generically (see below) so
any future `..`-relative fixture is covered without a second audit.

### Chosen fix

Add a defensive pre-clean at the very top of `withRepo`'s `try` block, before
`git init`, reusing the existing retried-rm helper:

```js
  try {
    // Defensive pre-clean (B20260710T1533Z): `root` is unique per run, but a
    // `..`-relative worktrees.location (e.g. "../explicit-worktrees") resolves
    // ABOVE root to a fixed path in os.tmpdir(). A prior run aborted before the
    // finally-teardown can leave a stale worktree dir there; ticket IDs are
    // deterministic under a fixed `now`, so the next run collides on the exact
    // same target path. Clear it up front, symmetric with the finally below.
    await removeFixtureDir(worktreesRoot);
    await git(root, ["init"]);
    ...
```

Rationale:

- Matches the Requirement's "defensive pre-clean" branch and follows existing
  test/helpers/fixtures.js conventions: `removeFixtureDir` already does a
  `force: true` retried `rm` (a no-op when nothing is stale), so it is safe and
  cheap for the unique-name locations too.
- Symmetric with the existing `finally` teardown (`removeFixtureDir(worktreesRoot)`
  then `removeFixtureDir(root)` at test/worktrees.test.js:46-49): the finally
  handles the happy-path exit, the pre-clean handles the aborted-prior-run entry.
- Generic — covers any future `..`-relative fixture location without another
  sweep. Removing only the orphaned *directory* is sufficient; no
  `git worktree prune` is needed, because the stale registration lived in the
  now-deleted old root, and the fresh root has no knowledge of it.

Alternative considered and rejected: making the outside location unique per run
(threading a per-run token into the `"../<token>-explicit-worktrees"` string and
the config it is written into at test/worktrees.test.js:37-42). It would also
work but is more invasive (changes the config payload and the
`assert.equal(worktreesRoot, ...)` shape at line 976), does not generalize to
future fixed-name locations, and duplicates the uniqueness the `mkdtemp` root
already provides for every other fixture. Pre-clean is the smaller, reversible
change the Requirement's Non-goals (no broader refactor) favor.

### Test strategy

Add one seeded-stale regression test that reproduces the abort deterministically.
Because `worktreesRoot` for the explicit-outside location is
`<os.tmpdir()>/explicit-worktrees` independent of the unique root, the stale
leftover can be seeded *before* calling `withRepo`; `withRepo`'s new pre-clean
must then tolerate it:

```js
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
```

Determinism: the seeded path exactly equals the target path the run will build,
so pre-fix this test fails on every run (not intermittently) and post-fix it
passes. This is the AC's "seeded-stale test makes the failure mode deterministic".

Full test list:

1. New: `"worktree-add tolerates a stale fixed-name worktrees dir from an aborted prior run"` (above) — red before the pre-clean, green after.
2. Regression: the existing suite (`node --test test/worktrees.test.js`), especially
   the unchanged "...explicit relative worktrees.location outside the repo" test at
   line 966, must stay green — the pre-clean is a no-op on a clean start.
3. Full gate: `npm run check` and `node --test` (AC).

Optional strengthening (only if cheap): run the new test twice back-to-back in a
single process to prove idempotency across the seeded->clean->seeded cycle. Not
required by the AC; the single seeded test already forces the failure mode.

### Affected files

- `test/worktrees.test.js` — add the pre-clean line in `withRepo`; add the new
  regression test. Test-only.
- No production source changes. `src/worktrees.js` and `src/tickets.js` were read
  only to establish the root cause (fixed-path resolution and deterministic IDs).
- `test/helpers/fixtures.js` — reused unchanged (`removeFixtureDir`).

### Risks and edge cases

- Cross-test interference: the new test and the existing explicit-outside test
  share the fixed `<tmp>/explicit-worktrees` path. `node --test` runs tests within
  one file sequentially by default, and both are guarded by `withRepo`'s pre-clean
  plus `finally` teardown, so they do not race today. If file-internal concurrency
  is ever enabled, the correct fix is the rejected "unique outside location"
  alternative — note it in Implementation Notes but do not pre-build it
  (Non-goals: no broader refactor).
- Leftover predating this ticket: the pre-clean removes it on next run;
  `removeFixtureDir`'s `force: true` swallows ENOENT, so a missing path is fine.
- Windows path/permissions: `removeFixtureDir` already carries the retried-rm
  (ENOTEMPTY/EBUSY/EPERM) handling per its own comment and techContext's gc.auto=0
  fixtures; the pre-clean inherits that resilience.

### Documentation impact

None. Internal test-hygiene fix with no user-facing surface, config, or CLI
change. No `docs/` or `memory-bank/` update warranted (no current-state fact
changes).

### Open questions

None — the failure mode, exact fixture path, deterministic ticket ID, and failing
assertion are all confirmed by inspection.

## Implementation Notes

Implemented the design as written, no deviations.

- Added a defensive `await removeFixtureDir(worktreesRoot);` pre-clean at the
  top of `withRepo`'s try block (test/worktrees.test.js), before `git init`,
  symmetric with the existing `finally` teardown. Reuses the existing
  `test/helpers/fixtures.js` `removeFixtureDir` helper (retried `rm`,
  `force: true`, safe no-op when nothing is stale).
- Added the seeded-stale regression test
  `"worktree-add tolerates a stale fixed-name worktrees dir from an aborted
  prior run"` immediately after the existing
  `"worktree-add supports an explicit relative worktrees.location outside the
  repo"` test. It pre-seeds `<os.tmpdir()>/explicit-worktrees/T20260522T1506Z`
  with a leftover file before calling `withRepo`, then asserts `worktree-add`
  exits 0 against the deterministic ticket id `T20260522T1506Z`.
- Test-only change; no production source touched.

Verification:
- `npm run check`: pass (syntax check across bin/src/hooks).
- `node --test test/worktrees.test.js` run 1: 40 pass, 0 fail.
- `node --test test/worktrees.test.js` run 2 (back-to-back, repeat-run
  stability): 40 pass, 0 fail.
- `node --test` (full suite): 535 tests, 534 pass, 1 skipped, 0 fail.

Commit: d373dcb on branch
local-board/B20260710T1533Z-worktrees-tests-use-a-fixed-name-temp-dir-and-flake-on-stale-leftovers.

## Review Findings

Verdict: pass (codex-task:read-only, gpt-5.6-terra @ high, 2026-07-10, commit d373dcb)

No findings. Pre-clean correctly placed at the top of withRepo's try before git init, mirroring the finally teardown. The regression test pre-seeds os.tmpdir()/explicit-worktrees/T20260522T1506Z, which worktreesRootFor(root, "../explicit-worktrees") provably resolves to, and asserts both the root and the deterministic ticket id before asserting exit 0 (not vacuous). Only test/worktrees.test.js changed; all other fixture roots are unique mkdtemp paths; no in-file concurrency, no cross-file references to explicit-worktrees. Static review only.

## Test Evidence

Verdict: pass (claude-subagent:local-board-tester@sonnet, 2026-07-10, commit d373dcb)

npm run check clean. Full suite 535 tests - 534 pass, 0 fail, 1 skip. test/worktrees.test.js run three times consecutively: 40/40 each, no flakes. Independent stale-abort simulation: manually pre-seeded os.tmpdir()/explicit-worktrees/T20260522T1506Z/junk.txt (separate from the test's own seeding), suite ran green - the withRepo pre-clean recovered; the fixed dir was gone after the run via the finally teardown. Diff scope: exactly test/worktrees.test.js + ticket planning file. Working tree clean after all runs.

## Documentation Updates

Updated `memory-bank/techContext.md` because `techContext.md` already records test fixture conventions. Added one factual sentence noting that worktree tests using `withRepo` pre-clean resolved worktrees roots before setup so fixed-name roots above `mkdtemp` do not inherit stale leftovers.

No `docs/` narrative page covered test fixtures, so no human-facing docs were changed.

Verification: `node --test --test-isolation=none test/skill-usage-sync.test.js test/resources-sync.test.js` passed: 9 tests, 0 failures.

Commit: attempted `B20260710T1533Z: docs note worktree fixture pre-clean`, but git could not create `C:/Users/Nicho/Documents/local-board/.git/worktrees/B20260710T1533Z/index.lock` (`Permission denied`) from this sandbox. Changes are left uncommitted.

## Questions

## Run Log

- 2026-07-10T17:07:08Z: Ensured git branch local-board/B20260710T1533Z-worktrees-tests-use-a-fixed-name-temp-dir-and-flake-on-stale-leftovers (already-current).

- 2026-07-10T17:12:28Z: Completed design via claude-subagent:local-board-designer@opus: Root cause: explicit relative location ../explicit-worktrees collapses to fixed os.tmpdir()/explicit-worktrees with deterministic ticket id; aborted run leaves orphan; next run hits not-a-registered-worktree throw (worktrees.js:41). Fix: removeFixtureDir pre-clean at top of withRepo try; seeded-stale regression test. Only fixed-name path in file. Estimate 2pts basis B20260710T1532Z.

- 2026-07-10T17:13:33Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: none requested (test-only fixture fix; no triggers)

- 2026-07-10T17:25:28Z: Recorded design review via codex-task:read-only@gpt-5.6-sol: PASS, no findings (round 1)

- 2026-07-10T17:25:29Z: Ensured git branch local-board/B20260710T1533Z-worktrees-tests-use-a-fixed-name-temp-dir-and-flake-on-stale-leftovers (already-current).

- 2026-07-10T17:30:18Z: Completed implement via claude-subagent:local-board-implementer@sonnet: removeFixtureDir pre-clean at top of withRepo try + seeded-stale regression test (pre-seeds tmp/explicit-worktrees/T20260522T1506Z, asserts worktree-add exit 0). Test-only. worktrees suite 40/0 twice; full suite 534/0/1. Commit d373dcb.

- 2026-07-10T17:30:51Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: none requested (test-only change)

- 2026-07-10T17:32:55Z: Completed review via codex-task:read-only@gpt-5.6-terra: pass, no findings: pre-clean placement, non-vacuous seeded path, test-only scope, no concurrency hazard all verified

- 2026-07-10T17:39:32Z: Completed test via claude-subagent:local-board-tester@sonnet: pass: full suite 534/0/1; worktrees suite 40/40 x3; independent stale-abort simulation recovered by pre-clean; diff scope test-only

- 2026-07-10T17:43:48Z: Completed document via codex-task:workspace-write: techContext.md gains the withRepo pre-clean convention sentence (only file documenting fixture conventions; docs/ has no coverage). Sync tests 9/9.
