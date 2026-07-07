---
id: B20260707T1322Z
type: bug
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
created: 2026-07-07T13:22:54Z
updated: 2026-07-07T13:23:07Z
completedSteps: []
routingApprovals: []
---
# No locking for concurrent ticket mutations; link and block write two files non-atomically

## Requirement

All ticket mutations are read-modify-write with no locking. `linkParent`/`blockTicket` (`src/tickets.js:494-567`) write two files non-atomically. Under concurrent CLI invocations against the same checkout (parallel orchestrator appending a Run Log comment while a `complete-step` for the same ticket is in flight), the later write clobbers the earlier one — a `completedSteps` token can silently disappear, and strict routing later refuses `move ... done`. The worktree-per-ticket design bounds exposure, but the mainline board and the two-file link/block writes remain exposed.

Fix: per-ticket lockfile (mkdir or `wx`-sentinel next to the ticket) held across read-modify-write; or at minimum document that only one process may mutate a given checkout's `plans/` at a time.

Acceptance: concurrent mutations of the same ticket cannot lose updates (test with two racing processes), or the single-writer constraint is documented and surfaced.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
