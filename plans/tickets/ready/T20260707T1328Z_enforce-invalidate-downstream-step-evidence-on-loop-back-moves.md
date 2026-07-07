---
id: T20260707T1328Z
type: task
status: ready_for_design
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T13:28:41Z
updated: 2026-07-07T13:23:41Z
completedSteps: []
routingApprovals: []
---
# enforce: invalidate downstream step evidence on loop-back moves

## Requirement

Loop-backs do not invalidate stale evidence. `completeStep` uses `addUnique` on `completedSteps` (`src/tickets.js:481`) and `validateRouting` (`:744-750`) checks token presence only at `done`. After test-fail -> `ready_for_implementation` -> new code, the old `review:...` and `test:...` tokens survive, so the ticket can reach `done` without re-review or re-test of the changed code — unreviewed code merges with a clean audit trail. The PerStepOrchestration real run exercised exactly this loop-back path.

Fix: on `move` back to an earlier pipeline status (per `workflow.pipelineOrder`), strip or timestamp-invalidate `completedSteps` tokens for actions downstream of the target status. Record the invalidation in the Run Log.

Acceptance: after a loop-back move, downstream evidence no longer satisfies `doneRequires`; re-running the steps re-records it; tests cover the test-fail -> re-implement -> done path.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
