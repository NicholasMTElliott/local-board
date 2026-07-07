---
id: T20260707T1335Z
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
created: 2026-07-07T13:35:55Z
updated: 2026-07-07T13:23:41Z
completedSteps: []
routingApprovals: []
---
# cli: begin-step --harness codex returns the translated dispatch

## Requirement

The Codex route translation (claude-subagent:local-board-* -> Codex spawned agent + prompt fragment + sanitized model) lives as prose tables in two places that can drift: `skills/codex/local-board/SKILL.md:64-77` (plus the "do not pass Claude aliases" rule at :81) and `docs/CodexSupport.md:36-45`. The codex local-team skill additionally cross-references the other skill's table.

Fix: add `begin-step --harness codex` (or a `harness` config key) that returns the translated dispatch directly — executor agent type, prompt fragment path, sanitized model, and the evidence string to record — one authoritative implementation. Shrink the two markdown tables to a pointer.

Acceptance: a codex orchestrator can dispatch any configured claude-subagent route using only `begin-step --harness codex` output; the translation tables in skill/docs are reduced to references; tests cover alias sanitization and the @codex-default evidence convention.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
