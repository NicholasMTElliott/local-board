---
id: T20260707T1339Z
type: task
status: ready_for_implementation
priority: P4
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T13:39:06Z
updated: 2026-07-07T13:23:42Z
completedSteps: []
routingApprovals: []
---
# chore: remove stray empty local_board and tests directories

## Requirement

Stray empty directories `local_board/` and `tests/` exist at the repo root alongside the real `test/` directory. They are cruft from earlier layouts and confuse both humans and agents scanning the tree.

Fix: remove both directories (verify they are empty / contain nothing referenced first). Check `.gitignore`/`.gitattributes` and `package.json` scripts for any references.

Acceptance: directories gone; `npm run check` and `npm test` still pass.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
