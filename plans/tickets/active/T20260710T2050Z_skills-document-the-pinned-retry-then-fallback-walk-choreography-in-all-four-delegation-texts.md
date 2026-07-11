---
id: T20260710T2050Z
type: task
status: designing
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260710T2050Z-skills-document-the-pinned-retry-then-fallback-walk-choreography-in-all-four-delegation-texts
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-10T20:50:02Z
updated: 2026-07-11T19:54:16Z
completedSteps: []
routingApprovals: []
---
# skills: document the pinned-retry-then-fallback-walk choreography in all four Delegation texts

## Requirement

Follow-up from T20260710T1532Z (fallbackModels shipped 2026-07-10) and T20260710T1534Z round-1 design note. The Delegation prose in the two board skills documents the fallback walk for begin-step dispatches (native walks configuredFallbackModels, codex skill walks codexDispatch.fallbackModels; exhausted/empty walks go to approve-inline/questions, never codex-default). What is NOT yet documented is the operational retry choreography the orchestrator should follow: retry the pinned model once on a capacity/unavailability failure BEFORE walking fallbacks, record the actually-used model in evidence, carry effort unchanged, and treat consultation dispatches (gate-check, specialty-run, design-review) with the same walk using their payload fallback fields.

### Scope

1. Add the retry-then-walk guidance to the Delegation section of SKILL.md and skills/codex/local-board/SKILL.md, and the parallel-mode equivalent to SKILL_TEAM.md and skills/codex/local-team/SKILL.md (executor/orchestrator audience-correct; 1-3 sentences per insertion; CLI Commands fences untouched).
2. Mention the consultation-payload walk explicitly (the payloads carry the fallback fields only when configured).
3. Keep byte-identical fenced blocks across the four copies; skill-usage-sync suite green.

### Acceptance criteria

- All four skill texts describe: one pinned-model retry, then the ordered walk, evidence records the actual model, effort carries over, exhaustion goes to approve-inline/questions.
- npm run check and node --test pass (content-assertion and sync suites included).

### Non-goals

- No CLI behavior changes; no automatic in-CLI retry (dispatch remains the orchestrator's job).

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
