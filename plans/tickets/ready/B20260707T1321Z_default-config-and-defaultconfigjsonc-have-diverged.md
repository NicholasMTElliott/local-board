---
id: B20260707T1321Z
type: bug
status: ready_for_design
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T13:21:54Z
updated: 2026-07-07T13:23:07Z
completedSteps: []
routingApprovals: []
---
# DEFAULT_CONFIG and defaultConfigJsonc have diverged

## Requirement

Two hand-maintained defaults have diverged: `DEFAULT_CONFIG` (`src/config.js:16-259`) has all `optionalSteps` empty and `estimation.enabled: false`, while `defaultConfigJsonc()` (`src/config.js:499-822`) ships populated optionalSteps and `estimation.enabled: true`. A repo running without a config file silently gets different workflow behavior (no estimation gate, no specialty catalogs) than an `init`-scaffolded repo.

Fix: generate the JSONC from `DEFAULT_CONFIG` plus a comment map, or add a test asserting `parseJsonc(defaultConfigJsonc())` deep-equals `DEFAULT_CONFIG`. If the divergence is intentional, make it explicit and documented.

Acceptance: the two defaults are provably in sync (generated or test-asserted), or the intended difference is documented.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
