---
id: T20260708T2210Z
type: task
status: backlog
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
created: 2026-07-08T22:10:44Z
updated: 2026-07-08T22:11:52Z
completedSteps: []
routingApprovals: []
---
# cli: warn or refuse complete-step review recorded before ready_for_review

## Requirement

Recording `complete-step <id> review` while the ticket sits at a pre-review status (typically `ready_for_implementation` after a changes_requested loop-back) silently arms a trap: `routing.invalidateOnLoopBack` strips the review token on the later forward move into `ready_for_review`, and the failure only surfaces much later as `move done` refusing with "done ticket is missing completedSteps entry for review". This bit the orchestrator twice in production runs (T20260707T1333Z, T20260707T1335Z); the workaround (record the review disposition only after moving to `ready_for_test`) is convention, not enforcement.

Fix: in `completeStep` (src/tickets.js), when the action is `review` (or any action whose evidence the very next forward transition would invalidate) and the ticket's current status is upstream of that action's stage, either refuse with a message naming the correct ordering, or warn and record a Run Log note. Prefer refuse-with-clear-message for consistency with the other strict-routing guards; allow `--override --reason` as the escape hatch like `enforceTransitions`.

## Acceptance Criteria

- `complete-step <id> review` at `ready_for_implementation`/`implementing` (post loop-back) exits non-zero with a message naming the ordering rule and the earliest status where the evidence will survive.
- `--override --reason "..."` records anyway and appends the reason to the Run Log.
- The guard generalizes from the transitions/invalidation config rather than hardcoding `review` (test evidence recorded before `ready_for_test` gets the same treatment).
- Existing legal orderings (review recorded at `ready_for_review`/`reviewing`/`ready_for_test` or later) are unaffected; full suite stays green.
- Tests cover: refusal, override path, and the legal-ordering no-op.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
