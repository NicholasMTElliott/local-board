---
id: B20260710T1533Z
type: bug
status: ready_for_design
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/B20260710T1533Z-worktrees-tests-use-a-fixed-name-temp-dir-and-flake-on-stale-leftovers
estimate: null
estimateBasis: null
workStartedAt: 2026-07-10T17:07:08Z
workCompletedAt: null
created: 2026-07-10T15:32:23Z
updated: 2026-07-10T17:07:08Z
completedSteps: []
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

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-10T17:07:08Z: Ensured git branch local-board/B20260710T1533Z-worktrees-tests-use-a-fixed-name-temp-dir-and-flake-on-stale-leftovers (already-current).
