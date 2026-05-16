---
id: T20260516T1543Z
type: task
status: backlog
priority: P2
parent: S20260516T1537Z
children: []
blockedBy: []
blocks: [T20260516T1544Z, T20260516T1545Z, T20260516T1546Z, T20260516T1547Z]
branch: null
estimate: null
created: 2026-05-16T15:43:35Z
updated: 2026-05-16T15:45:27Z
completedSteps: []
routingApprovals: []
---
# Schema: add estimateBasis, workStartedAt, workCompletedAt front-matter fields

## Requirement

Extend the canonical front-matter field set to include `estimateBasis`, `workStartedAt`, and `workCompletedAt`. All three are nullable. The existing `estimate` field stays numeric. Update the schema, parser, writer, validator, scaffold, and ticket template so the new fields parse round-trip, validate cleanly when null or correctly typed, and render in the canonical order alongside `estimate`.

Scope: schema only. No behavior changes that read or write these fields beyond what is needed for parse/validate/render. Wall-clock setting, CLI command, enforcement, and prompts are tracked in sibling tasks.

Files of interest:
- src/tickets.js (REQUIRED_FIELDS / NULLABLE_FIELDS / canonical ordering)
- src/scaffold.js
- plans/templates/ticket.md

## Acceptance Criteria

- `estimateBasis`, `workStartedAt`, and `workCompletedAt` are recognized front-matter fields, all nullable.
- Canonical field ordering places them adjacent to `estimate` in the writer output.
- Parser round-trips `null` and well-formed values for all three fields without loss.
- `validate` accepts the new fields when null and when correctly typed; emits a useful error on malformed values.
- `create` scaffolds new tickets with these fields present and null.
- The ticket template at `plans/templates/ticket.md` lists the new fields.
- Tests cover: parse round-trip (null and populated), canonical ordering in serialized output, validator acceptance for nulls, and validator rejection for malformed timestamps / non-string estimateBasis.

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
