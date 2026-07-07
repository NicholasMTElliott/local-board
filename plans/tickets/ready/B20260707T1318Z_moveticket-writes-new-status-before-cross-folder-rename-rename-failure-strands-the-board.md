---
id: B20260707T1318Z
type: bug
status: ready_for_design
priority: P1
parent: null
children: []
blockedBy: [B20260707T1317Z]
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T13:18:54Z
updated: 2026-07-07T13:29:51Z
completedSteps: []
routingApprovals: []
---
# moveTicket writes new status before cross-folder rename; rename failure strands the board

## Requirement

`moveTicket` (`src/tickets.js:310-315`) writes the content containing the new `status` to the old path, then `rename()`s the file into the new status folder. On Windows, `EPERM`/`EBUSY` from antivirus or an editor holding the file is common. If the rename throws after the write, the ticket claims (for example) `status: done` while sitting in `plans/tickets/active/`. `validateStatusFolder` flags the mismatch, and because board queries throw on any validation issue, the entire board becomes unusable — including for unrelated parallel tickets.

Fix: create the file at the target path first (open with flag `wx`, which also closes the exists() TOCTOU race at line 306), then delete the old path. Alternatively rename first, then rewrite front matter in place. Combine with the atomic-write helper from B20260707T1317Z.

Acceptance: a failed cross-folder move leaves the ticket fully consistent at exactly one path; a test covers rename failure.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
