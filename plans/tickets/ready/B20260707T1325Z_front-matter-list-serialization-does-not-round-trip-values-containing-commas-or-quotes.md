---
id: B20260707T1325Z
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
created: 2026-07-07T13:25:08Z
updated: 2026-07-07T13:23:23Z
completedSteps: []
routingApprovals: []
---
# Front matter list serialization does not round-trip values containing commas or quotes

## Requirement

`parseScalar` (`src/tickets.js:214-236`) splits front-matter list interiors on bare commas, while `formatString` (line 1425) quotes values containing commas via `JSON.stringify`. A list item like `"a, b"` re-parses as two corrupt items (`"a` and `b"`), and quoted strings are stripped without unescaping (line 221). This is currently safe only because list fields hold ticket IDs and step tokens whose charset excludes commas and quotes — the invariant is accidental, not enforced.

Fix: reject commas and quotes in list items at write time so the round-trip invariant is enforced. Alternatively implement proper quoted-scalar parsing.

Acceptance: writing a list item containing a comma or quote either round-trips correctly or is rejected with a clear error; a round-trip property test covers list serialization.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
