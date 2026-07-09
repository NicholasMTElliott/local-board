---
id: B20260709T0134Z
type: bug
status: ready_for_implementation
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: 1
estimateBasis: B20260708T0459Z
workStartedAt: null
workCompletedAt: null
created: 2026-07-09T01:34:33Z
updated: 2026-07-09T01:38:12Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
routingApprovals: []
---
# test: empty --home probe asserts cwd cleanliness against the live board runtime dir

## Requirement

test/install.test.js:411 ("--home '' and --home '   ' are rejected before any install path is touched") asserts existsSync(<cwd>/.local-board) === false and existsSync(<cwd>/.claude/skills/local-board) === false after the rejected installs, with cwd = the invoking checkout. On any checkout where local-board has actually run (this repo dogfoods it), .local-board/ legitimately exists as the board runtime dir (active-steps ledger, locks, tmp — gitignored), so the test fails deterministically: 419 pass 1 fail on mainline, while fresh worktrees and CI pass. Shipped by T20260708T2212Z's rework; the sibling relative-home test already does this correctly by passing a scratch cwd. Fix: run the empty/blank --home probes with a scratch cwd (runInstallCli 4th param, like the relative-home test) and assert nothing appears under THAT cwd; do not assert cleanliness of the developer's checkout. Acceptance: npm test green on a checkout that has a live .local-board/ dir AND on a fresh worktree; the probe still proves fail-closed behavior (nothing created under the scratch cwd).

## Acceptance Criteria

## Related Tickets

## Technical Design

P2 test hotfix. The empty/blank `--home` probe (`test/install.test.js:411`) asserts cleanliness of the *invoking checkout's* cwd (`path.resolve(".")`) after rejected installs. On any checkout that has run local-board, `.local-board/` legitimately exists as the gitignored board runtime dir, so line 425 fails deterministically on mainline while fresh worktrees/CI pass. The assertion conflates "installer created nothing here" with "this dir happens to be clean" — false on a dogfooded checkout.

## Fix

Mirror the sibling relative-home test (`:430-446`), which already isolates cwd correctly:

1. Create a scratch cwd with `mkdtemp(path.join(os.tmpdir(), "local-board-blankhome-cwd-"))`.
2. Pass it as `runInstallCli`'s 4th argument (`cwd`) for both blank-home probes. Signature confirmed: `runInstallCli(home, args, envOptions = {}, cwd = path.resolve("."))` at `:119`.
3. After the rejections, assert absence under the **scratch** cwd:
   - `existsSync(path.join(scratchCwd, ".local-board")) === false`
   - `existsSync(path.join(scratchCwd, ".claude", "skills", "local-board")) === false`
4. Remove the two developer-checkout assertions (`:425-426`, the `path.resolve(".")` ones).
5. `try/finally` cleanup via `removeFixtureDir(scratchCwd)`, matching the sibling test.

This still proves fail-closed behavior: the process ran with cwd = scratch dir, so an empty scratch dir proves the blank flag never fell through to a silent cwd install. It just no longer makes a false claim about the repo checkout's runtime dir.

## Scope

- Single test block, `test/install.test.js:411-428`. No production changes.
- `mkdtemp`, `os`, `path`, `removeFixtureDir`, `runInstallCli` already imported/defined and used by the sibling test — no new imports.

## Risks / edge cases

- Low risk; test-only, pattern already proven by the adjacent passing test.
- Keep the `--home requires a non-empty value` match assertion (`:418`) unchanged — the rejection contract is still what we verify; only the cwd-cleanliness assertion moves.
- Create the scratch cwd inside `withHome` so `envHome` isolation is preserved.

## Test plan

- `node --test test/install.test.js` on THIS checkout (which has a live `.local-board/`) — must go green. This is the regression proof: pre-fix it fails 419/1, post-fix it passes.
- Full suite `npm test` green, and confirm still green on a fresh worktree (no behavior change there).

## Documentation impact

None. Test-internal fix; no docs or memory-bank changes.

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-09T01:37:23Z: Completed design via claude-subagent:local-board-designer@opus: Scratch cwd via mkdtemp + runInstallCli 4th arg (mirrors sibling relative-home test); drop developer-checkout assertions; regression proof = install tests green on this dogfooded checkout; estimate 1 basis B0459

- 2026-07-09T01:38:12Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (test-only)
