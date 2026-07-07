---
id: T20260707T1327Z
type: task
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
created: 2026-07-07T13:27:41Z
updated: 2026-07-07T13:23:40Z
completedSteps: []
routingApprovals: []
---
# enforce: record gate-check consultation and require it when leaving gated stages

## Requirement

Gate-check is entirely skippable with no trace: `routing.doneRequires` lists only the six mandatory actions, and `SKILL.md:181` states specialty evidence never blocks closeout. No token records that gate-check was consulted for the design/implement/test stages, so an orchestrator that never runs it silently drops security_threat_model/security_audit — and the ticket cannot show the difference between "judged unnecessary" and "never asked".

Fix: record a `gate:<stage>:<executor>` token in `completedSteps` at gate time (new CLI verb or extend `complete-step`), and have `move` out of a gated stage require the consultation token for that stage. Keep specialty *results* non-gating — gate only the *consultation*. An empty catalog should still record a (skipped) consultation deterministically (see T20260707T1333Z).

Acceptance: `move` out of design/implement/test without a recorded gate consultation is refused (with a config switch for projects that opt out); tickets show which stages were gate-checked; existing flows with empty catalogs still pass without dispatching an agent.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
