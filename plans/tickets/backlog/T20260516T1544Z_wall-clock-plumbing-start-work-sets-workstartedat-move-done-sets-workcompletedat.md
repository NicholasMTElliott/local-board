---
id: T20260516T1544Z
type: task
status: backlog
priority: P2
parent: S20260516T1537Z
children: []
blockedBy: [T20260516T1543Z]
blocks: []
branch: null
estimate: null
created: 2026-05-16T15:44:39Z
updated: 2026-05-16T15:45:23Z
completedSteps: []
routingApprovals: []
---
# Wall-clock plumbing: start-work sets workStartedAt; move done sets workCompletedAt

## Requirement

Wire wall-clock timestamps onto the lifecycle commands. Depends on the schema task (T20260516T1543Z) landing first so the fields exist.

Behavior:
- `start-work <id>`: if `workStartedAt` is null, set it to the current ISO-8601 timestamp. If already set, leave it alone (idempotent — returning from `questions` or `blocked` does not reset the clock).
- `moveTicket(..., 'done')`: if `workCompletedAt` is null, set it to the current ISO-8601 timestamp. Once set, do not clear or overwrite it (re-opening a ticket keeps the original closeout time).
- `archiveDoneTickets` does not touch these fields.
- The autoMerge closeout path also sets `workCompletedAt` when it lands a ticket in `done`.

Files of interest:
- src/tickets.js (start-work, moveTicket)
- any autoMerge closeout code that transitions to done

## Acceptance Criteria

- First `start-work` on a ticket sets `workStartedAt` to the current ISO timestamp.
- A second `start-work` on the same ticket leaves `workStartedAt` unchanged.
- `move <id> done` sets `workCompletedAt` when null.
- The autoMerge closeout path sets `workCompletedAt` when it transitions a ticket to done.
- Moving a ticket out of done and back into done does not overwrite an existing `workCompletedAt`.
- `archiveDoneTickets` leaves both fields untouched.
- Tests cover: start-work idempotence on workStartedAt, move-to-done setting workCompletedAt, re-open then move-done not overwriting, autoMerge closeout path setting workCompletedAt.

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
