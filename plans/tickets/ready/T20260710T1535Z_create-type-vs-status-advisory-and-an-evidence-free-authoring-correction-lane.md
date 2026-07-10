---
id: T20260710T1535Z
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
created: 2026-07-10T15:32:23Z
updated: 2026-07-10T15:32:40Z
completedSteps: []
routingApprovals: []
---
# create: type-vs-status advisory and an evidence-free authoring-correction lane

## Requirement

Retro item from the 2026-07-10 parallel run. The orchestrator created story S20260710T1206Z with --status ready_for_design; the conventional entry status for stories/epics is ready_for_decomposition (statusActions maps ready_for_design to the design action, but stories complete via decompose per doneRequires). Correcting it required a move that enforceTransitions rightly refused (ready_for_design -> ready_for_decomposition is not a mapped or structural transition), forcing an --override with a recorded reason.

## Scope

1. Add a create-time advisory (warning, not refusal) when the requested initial status is conventionally mismatched to the type: story/epic created at a status whose action is not decompose; task/bug created at ready_for_decomposition. Text names the conventional status and the doneRequires rationale.
2. Consider (design decides) extending the structural allow-set or the transition maps with an authoring-correction lane: any ready_* -> any trigger status while the ticket has zero completedSteps (nothing to invalidate), removing the --override ceremony for pure authoring mistakes. If adopted, loop-back invalidation semantics must be a no-op on that lane by construction (no evidence exists).
3. Tests for the advisory (fires/does not fire) and, if adopted, the authoring-correction lane (allowed with zero evidence, refused once any completedSteps token exists).
4. Schema/docs notes (docs/Workflow.md statuses section).

## Acceptance criteria

- create story --status ready_for_design prints the advisory naming ready_for_decomposition; create task --status ready_for_design stays silent.
- Existing boards and scripts are unaffected (warning-only unless the lane is adopted; lane, if adopted, is provably evidence-safe).
- npm run check and node --test pass.

## Non-goals

- No hard refusal at create (statuses remain schema-legal); no change to enforceTransitions defaults.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
