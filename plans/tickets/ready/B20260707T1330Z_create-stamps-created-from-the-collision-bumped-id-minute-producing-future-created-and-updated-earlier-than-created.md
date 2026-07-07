---
id: B20260707T1330Z
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
created: 2026-07-07T13:30:06Z
updated: 2026-07-07T13:30:33Z
completedSteps: []
routingApprovals: []
---
# create stamps created from the collision-bumped ID minute, producing future created and updated earlier than created

## Requirement

When `create` bumps the ID minute to avoid a collision (sequential creates in the same minute), it stamps `created` from the bumped ID timestamp rather than the actual wall clock. A ticket minted at 13:17 real time can carry `created: 13:40`, and a `section`/`block` mutation moments later stamps `updated` with real time — producing `updated` earlier than `created` and `created` timestamps in the future. Observed on 22 of the 34 tickets created on 2026-07-07 (e.g. T20260707T1340Z: created 13:40:06, updated 13:23:42). Confuses chronology-based tooling like done-ticket retention (`retention.archiveDoneAfterDays` compares `updated`).

Fix: keep the bumped minute for the ID (uniqueness), but stamp `created`/`updated` from the actual clock. Alternatively clamp `updated` to be >= `created` on every mutation. Ensure test-mode `now` injection still produces deterministic values.

Acceptance: sequential same-minute creates yield unique IDs with truthful `created` timestamps; `updated` is never earlier than `created`; a regression test covers the collision-bump path.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
