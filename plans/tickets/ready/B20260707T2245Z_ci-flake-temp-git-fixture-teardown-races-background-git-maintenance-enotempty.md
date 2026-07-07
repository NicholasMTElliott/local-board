---
id: B20260707T2245Z
type: bug
status: ready_for_design
priority: P1
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T22:45:32Z
updated: 2026-07-07T22:46:01Z
completedSteps: []
routingApprovals: []
---
# CI flake: temp git fixture teardown races background git maintenance (ENOTEMPTY)

## Requirement

GitHub Actions CI (ubuntu, Node 20/22) fails intermittently — roughly half of today's mainline pushes — always with the same signature: `ENOTEMPTY: directory not empty, rmdir '/tmp/local-board-*/.git/objects/pack'` (or `.git/objects`, `.git/info`) thrown during the recursive removal of a temp git fixture in test teardown. The failing test varies per run (worktree-add, validate/list, move done, gitignore append — runs 28901276019, 28901212625, 28897378880, 28893075980, 28891314668); the assertion itself passed in every case. Local Windows runs never hit it.

Root cause: test fixtures run real `git` commands (init/commit/worktree), which can spawn background maintenance (auto gc, detached object packing). Teardown then does an unretried recursive `rm` of the fixture directory while a git process is still writing into `.git`, so a directory becomes non-empty between readdir and rmdir.

Fix direction:
1. Disable background maintenance in fixtures: create fixture repos with `gc.auto=0` and `gc.autoDetach=false` (via `git -c` flags on init/commit, a fixture-level `git config`, or GIT_CONFIG_* env in the test helpers) so git never detaches a writer.
2. Make teardown resilient: a shared removeFixtureDir helper using fs.rm with { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } (Node retries ENOTEMPTY/EBUSY with these options) instead of bare rmSync.
Apply both to every test helper that creates temp git repos (test/git.test.js, test/worktrees.test.js, test/tickets.test.js fixture helpers, and any others found by grep for mkdtemp + git).

Acceptance: all fixture-creating test helpers disable auto-gc and use retrying teardown; a CI run (or several consecutive pushes) passes; no ENOTEMPTY teardown failures reproducible under a stress loop of the worktree suite.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
