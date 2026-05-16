---
id: T20260516T1550Z
type: task
status: backlog
priority: P2
parent: S20260516T1538Z
children: []
blockedBy: []
blocks: [T20260516T1551Z, T20260516T1552Z, T20260516T1553Z]
branch: null
estimate: null
created: 2026-05-16T15:50:03Z
updated: 2026-05-16T15:48:47Z
completedSteps: []
routingApprovals: []
---
# Add optionalSteps config block

## Requirement

Extend `plans/local-board.config.jsonc` with a new top-level `optionalSteps` object keyed by stage name (`design`, `implement`, `test`). Each value is an array of catalog entries shaped `{ name, prompt, triggers, agent? }`. Seed the v1 catalog with the entries listed in the parent story's Technical Design: `security_threat_model`, `ui_component_review`, `ux_interaction_review` under `design`; `security_audit` and `ui_visual_review` under `implement`. The `test` array ships empty for now.

Update the config loader / schema validation so the new shape is parsed and exposed to consumers (gate-check and specialty-run will read it in later tasks). Loader must not break for configs that omit `optionalSteps` entirely — treat missing as `{}`. Per-entry `agent` field is optional; when absent, treat as inline.

## Acceptance Criteria

- `plans/local-board.config.jsonc` contains the `optionalSteps` block with the five v1 entries described in the parent story Technical Design, plus an empty `test` array.
- Each entry has `name`, `prompt`, `triggers`; `agent` is omitted (inline default) unless explicitly overridden.
- Config loader parses the new block and exposes it on the loaded config object.
- Loader accepts configs without the `optionalSteps` key (backward compatible) and returns an empty catalog in that case.
- `npm test` adds coverage for: (a) parsing the new shape, (b) missing `optionalSteps` returns empty catalog without error, (c) malformed entries surface a clear validation error.
- `local-board validate` remains clean against the updated config.

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
