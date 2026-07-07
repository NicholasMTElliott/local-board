---
id: B20260707T1326Z
type: bug
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
created: 2026-07-07T13:26:08Z
updated: 2026-07-07T13:23:23Z
completedSteps: []
routingApprovals: []
---
# Section boundary detection mis-fires on heading-like lines inside fenced code blocks

## Requirement

`getSectionText`/`appendToSection`/`replaceSection` (`src/tickets.js:1330-1372`) each re-derive the same section-boundary search and treat any line starting with `## ` as a section heading — including lines inside fenced code blocks. Review Findings or Test Evidence containing a fenced code sample with `## ` truncates or misplaces section content.

Fix: extract a shared `locateSection` helper that tracks fence state (``` and ~~~) and ignores heading-like lines inside fences; use it from all three call sites.

Acceptance: section commands round-trip content containing fenced code blocks with heading-like lines; a regression test covers this.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
