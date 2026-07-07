---
id: T20260707T1333Z
type: task
status: ready_for_design
priority: P3
parent: null
children: []
blockedBy: [T20260707T1327Z]
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T13:33:55Z
updated: 2026-07-07T13:29:51Z
completedSteps: []
routingApprovals: []
---
# cli: gate-check returns an explicit skip result when the stage catalog is empty

## Requirement

When a stage's specialty catalog is empty, skipping the gate-agent dispatch is legitimate — but only two of the three skill texts say so (`SKILL_TEAM.md:124-126`, codex skill; `SKILL.md:147-163` does not), so single-ticket Claude runs waste a haiku dispatch on projects with no catalog, and behavior differs by skill.

Fix: make it deterministic — `gate-check` returns `{ "skip": true, "requestedSteps": [] }` (or similar) when the catalog for the stage is empty, and all skills say "dispatch the gate agent only when skip is false". Coordinate with T20260707T1327Z so an empty-catalog skip still records the consultation token.

Acceptance: empty-catalog gate-checks require no agent dispatch in any skill; the skip is visible in gate-check JSON output; skill texts are aligned.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
