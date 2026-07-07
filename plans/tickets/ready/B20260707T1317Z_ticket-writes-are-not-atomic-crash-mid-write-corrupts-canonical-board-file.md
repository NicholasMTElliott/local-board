---
id: B20260707T1317Z
type: bug
status: ready_for_design
priority: P1
parent: null
children: []
blockedBy: []
blocks: [B20260707T1318Z]
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T13:17:14Z
updated: 2026-07-07T13:29:51Z
completedSteps: []
routingApprovals: []
---
# Ticket writes are not atomic; crash mid-write corrupts canonical board file

## Requirement

Every ticket mutation writes the full file directly with `writeFile(ticket.path, ...)` (`src/tickets.js:310, 367, 379, 387, 444, 490, 1400`). A process crash or disk-full during any mutation (for example `complete-step`) leaves a truncated ticket. Front matter is the canonical database, and `query-next`/`begin-step`/`validate` hard-fail on any ticket load error, so one corrupt file wedges the entire board until a human repairs it.

Fix: write to a temp file next to the target (`${path}.tmp-${pid}`) and `rename()` over the destination. `install.mjs:396-398` already uses this pattern for settings.json. Extract a shared `writeTicketFile` helper and route all ticket writes through it.

Acceptance: all ticket mutations are atomic (temp-write-then-rename); a test simulates a partial write and shows the original file survives.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
