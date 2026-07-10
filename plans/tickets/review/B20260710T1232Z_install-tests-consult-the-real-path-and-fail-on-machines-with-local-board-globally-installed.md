---
id: B20260710T1232Z
type: bug
status: ready_for_review
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/B20260710T1232Z-install-tests-consult-the-real-path-and-fail-on-machines-with-local-board-globally-installed
estimate: 1
estimateBasis: B20260708T0459Z
workStartedAt: 2026-07-10T13:48:46Z
workCompletedAt: null
created: 2026-07-10T12:32:28Z
updated: 2026-07-10T14:04:42Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", "review:codex-task:read-only@gpt-5.6-terra"]
routingApprovals: []
---
# install tests consult the real PATH and fail on machines with local-board globally installed

## Requirement

Two install tests are non-hermetic: they assert the installer's fail-fast guidance when local-board does NOT resolve on PATH, but they consult the REAL machine PATH. On any machine where local-board is globally installed (npm install -g), the precheck succeeds and both tests fail. Surfaced 2026-07-10 immediately after installing the CLI globally on the dev machine; confirmed failing on clean mainline (466-pass suite dropped to 464 + 2 fail).

Failing tests (test/install.test.js):
- "PATH verification failure (real PATH, clone/git-checkout mode): guidance recommends npm link"
- "PATH verification failure (packaged/no-.git tree): guidance omits npm link"

## Scope

Make the PATH-resolution outcome injectable in these two tests the same way sibling tests already stub the probe (the codebase has a resolvesOnPath seam exported since T20260710T0035Z, and install options accept injected probes). The tests must force the not-on-PATH branch deterministically regardless of machine state.

## Acceptance criteria

- Both tests pass on a machine WITH local-board globally installed and on a machine without it (simulate both via the injected seam).
- No behavior change to src/install.js beyond, if strictly necessary, widening an existing test seam; prefer test-only changes.
- Full suite green: npm run check and node --test.

## Non-goals

- No change to the precheck's user-facing guidance text.

## Acceptance Criteria

## Related Tickets

## Technical Design

Make the two PATH-verification failure tests hermetic by forcing the
not-on-PATH branch through the existing injected `resolvesOnPath` seam
instead of a subprocess that consults the real machine PATH. Test-only
change; `src/install.js` is unchanged.

## Root cause (confirmed on this machine)

`performInstall` gates the install on
`checkResolvesOnPath("local-board")` (src/install.js:199-207). In a
subprocess, `home` is not overridden, so `checkResolvesOnPath` is the
real `resolvesOnPath` (src/install.js:761-769), which shells out to
`where local-board` (win32) / `command -v local-board` (posix).

The two failing tests try to make that probe miss by passing
`{ includeLocalBoardStub: false, sanitizePath: true }`, which replaces
the child PATH with `sanitizedSystemPath()` (test/install.test.js:33-49).
That function lists `path.dirname(process.execPath)` (nodeDir) first,
because `node`/`where` must resolve. On any Node setup where the npm
global prefix equals nodeDir, the global `local-board` shim lives inside
nodeDir and is therefore still on the sanitized PATH.

Verified here: `npm prefix -g` = `C:\nvm4w\nodejs` = nodeDir, and
`where local-board` returns `C:\nvm4w\nodejs\local-board.cmd`. So the
sanitized subprocess still resolves `local-board`, the precheck passes,
no error is thrown, and both `assert.rejects` calls fail. This is exactly
the reported "466 -> 464 + 2 fail" regression after a global install
(nvm-windows, volta, and other node-managers that colocate the global
prefix with nodeDir all trigger it). PATH sanitization cannot fix this:
nodeDir is mandatory for `node`, and the shim is inside it, so no
constructed PATH can both run node and hide `local-board`.

The correct fix is to stop consulting the real PATH in these two tests
and instead inject the resolution outcome, exactly as the sibling
in-process tests already do (test/install.test.js:854-885): the
`options.resolvesOnPath` predicate seam exported since T20260710T0035Z.

## Why production code needs no change

`runInstall` already accepts `options.resolvesOnPath`
(src/install.js:120, 199): when supplied it overrides the real probe
regardless of `homeOverridden`. Both tests can be rewritten to call the
in-process `runInstall` (imported as `runInstallInProcess`) with an
injected predicate, so no seam widening and no behavior change to
`src/install.js` are required. The non-goal (no change to the
user-facing guidance text) is honored — the same `fromClone` branch and
messages at src/install.js:200-206 are exercised, just with a
deterministic probe outcome.

### Predicate shape

Use `(command) => command !== "local-board"` rather than `() => false`.
The injected predicate is the single function that feeds BOTH the
installer's own `local-board` precheck AND, on a claude-target install,
the codex-task hint's `codex` probe (src/install.js:272 passes
`checkResolvesOnPath` into `codexTaskWarning`). Returning `false` only
for `"local-board"` forces the precheck miss while leaving every other
lookup (notably `"codex"`) resolving true. For these two tests the
target is `codex`, so the precheck throws (src/install.js:201-207)
before the claude-only codex hint is reached; the codex branch is never
evaluated. The `command !== "local-board"` form is nonetheless the
correct seam contract: it isolates the miss to the one lookup under test
and stays correct if the target or ordering ever changes. This matches
the T0035Z lesson recorded for that seam.

## The clone-vs-packaged distinction

The guidance text branches on `fromClone = existsSync(join(SCRIPT_DIR,
".git"))` (src/install.js:200):

- clone/checkout (`.git` present) -> "npm install -g . (or: npm link)"
- packaged (`.git` absent)        -> "npm install -g local-board" (no npm link)

The clone test runs in-process against `../src/install.js`, whose
`SCRIPT_DIR` is the repo/worktree root. A git worktree exposes `.git`
as a FILE (confirmed here), and `existsSync` is true for a file, so
`fromClone` is true and the npm-link guidance is produced. (Assumption:
the suite is always run from a checkout that has `.git`; the existing
`createPackagedCopy` helper already relies on the same fact.)

The packaged test needs `fromClone === false`, which the repo's own
`SCRIPT_DIR` cannot give. It is solved test-only by dynamically
importing the packaged copy's OWN `src/install.js`: in that module
instance `SCRIPT_DIR` resolves to the packaged temp dir, which has no
`.git`, so `fromClone` is false and the no-npm-link guidance is
produced. The same `options.resolvesOnPath` seam is injected into that
module's `runInstall`. `createPackagedCopy` already copies `package.json`
and `src/` (test/install.test.js:151-173), and `performInstall` reads
`package.json` (src/install.js:191) before the precheck throws, so the
packaged module loads and runs to the precheck without any other files.
No `options.fromClone`/`options.scriptDir` seam is needed.

## Affected files

- `test/install.test.js` — rewrite the two tests (~887, ~902); add one
  import (`pathToFileURL` from `node:url`). No other files change.
- `src/install.js` — unchanged.

## Exact test rewrites

Add near the existing `node:url` usage at the top of
`test/install.test.js`:

```js
import { pathToFileURL } from "node:url";
```

Replace the clone-mode test (currently ~887) with an in-process call
that throws synchronously (`assert.throws`, matching the sibling test at
878-884, not `assert.rejects`):

```js
test("PATH verification failure (injected PATH miss, clone/git-checkout mode): guidance recommends npm link", async () => {
  await withHome(async (home) => {
    assert.throws(
      () =>
        runInstallInProcess(["--target=codex"], {
          home,
          resolvesOnPath: (command) => command !== "local-board",
        }),
      (error) => {
        assert.match(error.message, /local-board is not on PATH/);
        assert.match(error.message, /npm install -g \./);
        assert.match(error.message, /npm link/);
        return true;
      },
    );
  });
});
```

Replace the packaged-tree test (currently ~902) with a dynamic import of
the packaged copy's own installer, injecting the same predicate:

```js
test("PATH verification failure (injected PATH miss, packaged/no-.git tree): guidance omits npm link", async () => {
  await withHome(async (home) => {
    const packagedDir = createPackagedCopy();
    try {
      assert.equal(existsSync(path.join(packagedDir, ".git")), false);
      const packaged = await import(
        pathToFileURL(path.join(packagedDir, "src", "install.js")).href
      );
      assert.throws(
        () =>
          packaged.runInstall(["--target=codex"], {
            home,
            resolvesOnPath: (command) => command !== "local-board",
          }),
        (error) => {
          assert.match(error.message, /local-board is not on PATH/);
          assert.match(error.message, /npm install -g local-board/);
          assert.doesNotMatch(error.message, /npm link/);
          return true;
        },
      );
    } finally {
      await removeFixtureDir(packagedDir);
    }
  });
});
```

Notes:
- Each `createPackagedCopy()` mints a fresh unique temp dir, so the
  dynamic-import URL is unique per run and never hits a stale module
  cache. The imported module is evaluated before the `finally` cleanup.
- Renaming the tests (dropping the now-false "real PATH" phrasing) is
  recommended for honesty but optional; the acceptance is that both pass
  regardless of machine state.
- The `{ includeLocalBoardStub, sanitizePath }` env plumbing is no longer
  used by these two tests. Leave `installEnv`/`sanitizedSystemPath`
  intact — other tests (e.g. the PATH-success test at ~927) still use the
  stub-bin path, and `sanitizePath` may still be referenced elsewhere.

## Risks and edge cases

- Low blast radius: two tests, one import. No production change.
- The clone test depends on the ambient `.git` at the repo root. This is
  already an established suite assumption; if tests were ever run from a
  packaged tarball the clone test would misbehave, but that is not a
  supported test-run mode.
- Dynamic import evaluates the packaged module once; a subsequent import
  of the same path would be cached, but paths are unique per test run.
- Node/`where`/`command -v` still run for real inside the packaged
  `getVersion("node")` and `nodeVersion` checks, which is fine and
  machine-independent.

## Test strategy / acceptance

- Both tests must pass with `local-board` globally installed AND without
  it. The injected predicate makes the outcome independent of machine
  PATH, so both machine states are simulated by construction: the
  predicate returns `false` for `local-board` regardless of what `where`
  would find. To demonstrate the "with global install" case, note this
  machine already has the global shim (`C:\nvm4w\nodejs\local-board.cmd`);
  under the old tests it fails, under the rewrite it passes.
- Regression guard: run `npm run check` and `node --test` — full suite
  must return to green (466 pass) with no new failures.
- Sanity: temporarily flip the predicate to `() => true` locally and
  confirm the tests then fail (proving they still assert the not-on-PATH
  branch, not a vacuous pass). Do not commit the flip.

## Open questions

None. The seam exists, the root cause is confirmed, and the fix is
test-only.

## Implementation Notes

## Implementation Notes

Rewrote the two non-hermetic "PATH verification failure" tests in
`test/install.test.js` exactly per the Technical Design; `src/install.js`
is unchanged.

- Added `import { pathToFileURL } from "node:url";`.
- Clone-mode test now calls `runInstallInProcess(["--target=codex"], { home, resolvesOnPath: (command) => command !== "local-board" })`
  in-process and asserts with `assert.throws`, matching the sibling
  in-process seam test.
- Packaged-tree test now dynamically imports the packaged copy's own
  `src/install.js` via `pathToFileURL(...).href` and calls its
  `runInstall` with the same injected predicate, asserting with
  `assert.throws`. `createPackagedCopy`/`removeFixtureDir` usage
  unchanged.
- Predicate is `(command) => command !== "local-board"` (not `() =>
  false`) per the T0035Z seam contract, so only the `local-board` lookup
  misses while `codex` still resolves true.
- Ran the design's sanity check locally: temporarily flipped both
  predicates to `() => true`, confirmed both tests then fail with
  "Missing expected exception", then reverted the flip exactly (diff
  confirmed clean before commit).

Test evidence:
- `npm run check`: clean, no output.
- `npm test` (full suite, twice): 497 tests, 496 pass, 1 skip
  (pre-existing `smoke (slow)` skip), 0 fail. One run showed a transient
  unrelated failure in `test/worktrees.test.js` ("worktree-add supports
  an explicit relative worktrees.location outside the repo") caused by a
  stale/fixed-name temp dir (`...\Temp\explicit-worktrees\T20260522T1506Z`)
  from a prior run; re-running the full suite and the file in isolation
  both passed, confirming this is pre-existing flakiness unrelated to
  this change (not present in `test/install.test.js`, and no file in
  scope touches worktree fixtures).
- Isolated run of the two rewritten tests
  (`node --test --test-name-pattern="PATH verification failure"
  test/install.test.js`): 2 pass, 0 fail.
- `node ./bin/local-board.js validate --root <worktree>`: "Ticket
  validation OK".

No production code changed; no new test dependencies.

## Review Findings

verdict: pass

(codex-task:read-only, gpt-5.6-terra @ reasoning-effort high, 55s — reviewed commit 400a400)

No findings.

Reviewer-verified: assertion strength preserved (clone test asserts both checkout guidance commands including npm link; packaged test asserts the package-install command and excludes npm link); the predicate flips only the local-board lookup (installer precheck fails as intended; codex probe unaffected — its only other consumer); packaged module imported from a unique temp file URL gives separate module identity and its own package root (genuine no-.git path, no cache cross-contamination); commit touches only test/install.test.js.

Residual risk: reviewer sandbox could not execute the suite (fixture spawning blocked); execution verification with the test stage.

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-10T13:48:46Z: Ensured git branch local-board/B20260710T1232Z-install-tests-consult-the-real-path-and-fail-on-machines-with-local-board-globally-installed (already-current).

- 2026-07-10T13:54:26Z: Completed design via claude-subagent:local-board-designer@opus: Technical Design: test-only fix via existing options.resolvesOnPath seam with predicate (command) => command !== 'local-board' (T0035Z contract preserved); root cause = nvm-windows nodeDir == npm global prefix defeats PATH sanitization; clone-mode in-process + packaged-copy dynamic import, no seam widening. Estimate 1 (basis B20260708T0459Z, designer-recorded).

- 2026-07-10T13:55:18Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: none - test-only hermeticity fix

- 2026-07-10T13:55:18Z: Ensured git branch local-board/B20260710T1232Z-install-tests-consult-the-real-path-and-fail-on-machines-with-local-board-globally-installed (already-current).

- 2026-07-10T14:00:49Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Commit 400a400: both PATH-verification tests rewritten onto the resolvesOnPath seam (predicate spares codex), packaged copy via pathToFileURL, sanity flip verified then reverted. Full suite 496 pass / 0 fail / 1 pre-existing skip (x2 runs). Noted separate pre-existing worktrees.test.js flake (stale fixed-name temp dir).

- 2026-07-10T14:01:38Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: none - test-only hermeticity rewrite

- 2026-07-10T14:04:42Z: Completed review via codex-task:read-only@gpt-5.6-terra: verdict: pass, no findings. Assertion strength preserved; predicate scoped to local-board lookup only; packaged import hygienic; test-only scope confirmed.
