---
id: B20260710T1232Z
type: bug
status: ready_for_design
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/B20260710T1232Z-install-tests-consult-the-real-path-and-fail-on-machines-with-local-board-globally-installed
estimate: null
estimateBasis: null
workStartedAt: 2026-07-10T13:48:46Z
workCompletedAt: null
created: 2026-07-10T12:32:28Z
updated: 2026-07-10T13:48:46Z
completedSteps: []
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

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-10T13:48:46Z: Ensured git branch local-board/B20260710T1232Z-install-tests-consult-the-real-path-and-fail-on-machines-with-local-board-globally-installed (already-current).
