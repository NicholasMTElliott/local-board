---
id: T20260707T1325Z
type: task
status: ready_for_design
priority: P1
parent: null
children: []
blockedBy: []
blocks: [T20260707T1326Z]
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T13:25:41Z
updated: 2026-07-07T13:23:55Z
completedSteps: []
routingApprovals: []
---
# enforce: add check-dispatch verdict command and persisted in-flight step state

## Requirement

Nothing persists what dispatch is expected or in flight, and no command answers "is this dispatch correct?" — the two primitives external enforcement (hooks) needs. `begin-step` is a pure query; `begin-step`/`complete-step` are not paired; a PreToolUse hook intercepting an Agent dispatch sees `subagent_type` and `model` but has no deterministic way to know which ticket/action the dispatch serves.

Fix, two parts:
1. Persist in-flight step state: `begin-step` stamps an active-step record (front-matter field `activeStep: <action>:<route>[@<model>]` or a `.local-board/active-steps.json` ledger keyed by ticket), cleared by `complete-step`/`approve-inline`.
2. Add `local-board check-dispatch --agent <subagent_type> [--model <model>] [--ticket <id>]`: exits 0/1 with a JSON reason. With `--ticket`, compares against that ticket's expected step (agent name from `configuredAgent`, model from `configuredModel`); without, scans active steps for any match. `profileForAction` and `beginStep` already provide the pieces (~30 lines).

Acceptance: `check-dispatch` returns correct verdicts for right-agent/right-model, wrong-agent, wrong-model, and no-active-step cases, with tests; active-step state round-trips through begin/complete/approve-inline.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
