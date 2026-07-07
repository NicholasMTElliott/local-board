---
id: T20260707T1324Z
type: task
status: ready_for_design
priority: P1
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T13:24:41Z
updated: 2026-07-07T13:23:40Z
completedSteps: []
routingApprovals: []
---
# enforce: validate the executor model suffix against configuredModel in strict routing

## Requirement

Strict routing validates only the route part of executor evidence: `validateStepRouting` (`src/tickets.js:755-776`) strips the `@model` suffix via `routeOf` (line 1285) and never compares against `configuredModel`. Per-step model pinning — the headline feature of the per-step orchestration redesign — has zero deterministic verification: config says design runs on opus, the orchestrator dispatches sonnet and records `...designer@sonnet`, and validation passes. `docs/PerStepOrchestration.md:109-115` and `docs/CodexSupport.md:53` both document the suffix as ignored.

Fix: when strict routing is on and the step profile pins a model, require the executor token to carry a matching `@model` suffix (or an explicit `approve-inline`-style approval for a deviation). Account for the Codex `@codex-default` convention. Update the two docs and skill texts that describe the suffix as decorative.

Acceptance: `complete-step` with a wrong or missing model suffix on a model-pinned step is rejected under strict routing; Codex translation evidence still passes; tests cover match, mismatch, missing, and codex-default cases.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
