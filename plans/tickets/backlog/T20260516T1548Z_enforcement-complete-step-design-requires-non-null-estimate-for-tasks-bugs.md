---
id: T20260516T1548Z
type: task
status: backlog
priority: P2
parent: S20260516T1537Z
children: []
blockedBy: [T20260516T1545Z, T20260516T1547Z]
blocks: []
branch: null
estimate: null
created: 2026-05-16T15:48:45Z
updated: 2026-05-16T15:45:29Z
completedSteps: []
routingApprovals: []
---
# Enforcement: complete-step design requires non-null estimate for tasks/bugs

## Requirement

Add an enforcement gate to `complete-step design`. Depends on the estimate CLI (T20260516T1545Z) and the config block (T20260516T1547Z).

Behavior:
- When `estimation.enabled` is true and the ticket type is `task` or `bug`, `complete-step design` refuses to complete if `estimate` is null. Exit non-zero with a message that says the design step must record an estimate first and references `local-board estimate <id> <points>`.
- Stories and epics are exempt regardless of `estimation.enabled`.
- When `estimation.enabled` is false, the gate is a no-op.

## Acceptance Criteria

- `complete-step design` on a task or bug with null `estimate` exits non-zero with a message referencing `local-board estimate`.
- `complete-step design` on a task or bug with a non-null `estimate` proceeds normally.
- `complete-step design` on a story or epic proceeds regardless of `estimate`.
- When `estimation.enabled` is false, the gate is bypassed for all ticket types.
- Tests cover: task with null estimate is blocked, task with estimate proceeds, bug with null estimate is blocked, story with null estimate proceeds, epic with null estimate proceeds, enabled=false bypass.

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
