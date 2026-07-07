---
id: T20260707T1337Z
type: task
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
created: 2026-07-07T13:37:06Z
updated: 2026-07-07T13:23:41Z
completedSteps: []
routingApprovals: []
---
# docs: refresh PerStepOrchestration status and reconcile the maxInFlight default

## Requirement

`docs/PerStepOrchestration.md` is stale and self-contradictory: line 1 still titles it "(Design Proposal)"; line 3 says "implemented on branch feature/per-step-orchestration" (it is merged to mainline); lines 7-8 say the maxInFlight default is "deferred to a real run" while the Resolved section (lines 310-312) says the real run pinned ~3. Meanwhile `README.md:86` and `SKILL_TEAM.md` say default 6 (from team-config / LOCAL_BOARD_MAX_TEAMMATES). Three different answers for one knob. Also: the config sample at lines 60-69 pins models (gpt-5.5, claude-opus-4-6) that the live config does not — fine as illustration but reads as current state. The planned LOCAL_BOARD_MAX_TEAMMATES -> maxInFlight rename (noted at lines 292-293) is presented as current-state naming in README/SKILL_TEAM.

Fix: retitle to a current-state doc, fix the status lines, reconcile the default in one place (config default 6, recommended ~3 — say both explicitly everywhere or change the config default), label the config sample as illustrative, and either do the maxInFlight rename (alias the old env var) or note it consistently.

Acceptance: doc header reflects merged status; exactly one documented answer for the maxInFlight default across README, SKILL_TEAM, and the doc.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
