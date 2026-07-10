---
id: T20260710T1532Z
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
created: 2026-07-10T15:32:22Z
updated: 2026-07-10T15:32:39Z
completedSteps: []
routingApprovals: []
---
# config: ordered fallbackModels on agent profiles for pinned-model outages

## Requirement

Retro item from the 2026-07-10 parallel run. gpt-5.6-terra returned "Selected model is at capacity" twice mid-run. With agents.review pinned to gpt-5.6-terra under strict routing, there was no sanctioned alternative: recording a different model is refused by the pin, and approve-inline requires user interaction. The orchestrator retried and got lucky; a capacity outage lasting hours would have stalled every review on the board.

## Scope

1. Extend agent profiles with an optional ordered fallback list: { route, model, effort?, fallbackModels?: [ ... ] } (config schema validation mirrors model's shape rule; rejected on inline; empty list rejected).
2. begin-step surfaces configuredFallbackModels; the codexDispatch translation carries it (sanitized per model rules).
3. Strict-routing evidence: modelSatisfies accepts the pinned model OR any configured fallback for that action (the recorded model is the model actually used); done-time validation unchanged (route-only, back-compat).
4. Skill text (Delegation section): on a capacity/unavailability failure of the pinned model, the orchestrator retries once, then walks fallbackModels in order, recording the actual model in evidence; effort carries over unchanged unless the fallback entry overrides it (design decides whether fallback entries may be { model, effort } objects).
5. Docs (docs/CodexSupport.md Models/Effort sections) and tests (schema accept/reject, begin-step surface, modelSatisfies fallback acceptance, evidence recording with a fallback model).

## Acceptance criteria

- { "route": "codex-task:read-only", "model": "gpt-5.6-terra", "effort": "high", "fallbackModels": ["gpt-5.5"] } validates; complete-step review --model gpt-5.5 is accepted under strict routing; --model gpt-4o (unlisted) is refused.
- Boards without fallbackModels behave byte-identically.
- npm run check and node --test pass.

## Non-goals

- No automatic in-CLI dispatch retry (dispatch remains the orchestrator's job); no fallback for claude-subagent frontmatter models (separate concern).

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
