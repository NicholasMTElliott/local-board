---
id: T20260516T1546Z
type: task
status: backlog
priority: P2
parent: S20260516T1537Z
children: []
blockedBy: [T20260516T1543Z]
blocks: [T20260516T1549Z]
branch: null
estimate: null
created: 2026-05-16T15:46:42Z
updated: 2026-05-16T15:45:31Z
completedSteps: []
routingApprovals: []
---
# CLI: local-board calibration suggest <ticket-id> command

## Requirement

Add `local-board calibration suggest <ticket-id> [--json]` command. Depends on the schema task (T20260516T1543Z).

Algorithm:
- Pool = done tickets where `type` matches the target ticket's type, `estimate` is non-null, and both `workStartedAt` and `workCompletedAt` are set.
- Pick the ticket whose `estimate` is closest to the median estimate in the pool. Tie-break by most-recent `workCompletedAt`.
- Empty pool returns the sentinel string `bootstrap`.

Output: prints the chosen ticket ID (or `bootstrap`) to stdout. `--json` returns `{ "basis": "<id-or-bootstrap>" }`.

## Acceptance Criteria

- Command prints a calibration ticket ID or the literal `bootstrap`.
- Type filtering is enforced: a `bug` target never returns a `task` (and vice versa).
- Pool requires `estimate`, `workStartedAt`, and `workCompletedAt` all non-null; tickets missing any are excluded.
- Selection picks the estimate closest to the pool's median; ties broken by most-recent `workCompletedAt`.
- Empty pool returns `bootstrap`.
- `--json` emits `{ "basis": "..." }`.
- Unknown ticket ID exits non-zero with a clear message.
- Tests cover: empty pool returns bootstrap, populated pool picks median-anchored, tie-break by workCompletedAt, type separation (bug-vs-task), exclusion of tickets missing required fields.

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
