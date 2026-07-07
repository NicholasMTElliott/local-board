---
id: T20260707T1329Z
type: task
status: ready_for_design
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T13:29:41Z
updated: 2026-07-07T13:23:41Z
completedSteps: []
routingApprovals: []
---
# enforce: promote workflow.transitions to a hard validator with an override escape

## Requirement

Intermediate transitions are advisory: `moveTicket` (`src/tickets.js:279-300`) validates routing only for `done` and accepts any known status from any status; `plans/local-board.config.jsonc:42` notes it is "not a hard transition validator yet" (also listed as an open decision in memory-bank/techContext.md). An orchestrator can move `ready_for_implementation -> ready_for_test`, skipping review; ordering (review-before-test) is never checked anywhere.

Fix: promote `workflow.transitions` to a hard validator — `move` refuses a target status not listed in the current status's transitions — with an explicit `--override` escape that records itself in the Run Log. Config switch for advisory mode to preserve current behavior where wanted.

Acceptance: illegal transitions are refused with the allowed list in the error; `--override` works and leaves a trace; all existing tests and skill flows pass under the hard validator.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
