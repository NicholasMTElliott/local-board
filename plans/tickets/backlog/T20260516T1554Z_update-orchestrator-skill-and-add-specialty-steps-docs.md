---
id: T20260516T1554Z
type: task
status: backlog
priority: P2
parent: S20260516T1538Z
children: []
blockedBy: [T20260516T1551Z, T20260516T1552Z, T20260516T1553Z]
blocks: []
branch: null
estimate: null
created: 2026-05-16T15:54:16Z
updated: 2026-05-16T15:48:48Z
completedSteps: []
routingApprovals: []
---
# Update orchestrator skill and add specialty-steps docs

## Requirement

Wire the new gate-check / specialty-run flow into the orchestrator skill and document it.

Skill changes:
- Update `SKILL.md` (and any orchestrator role prompt(s) under `plans/prompts/`) so that after a stage's mandatory review passes for `design`, `implement`, or `test`, the orchestrator runs `local-board gate-check <id> --stage <stage> --json`.
- For each name in the returned `requestedSteps`, the orchestrator runs `local-board specialty-run <id> <name>`, dispatches the resolved prompt via the resolved agent (or inline), then records evidence with `local-board complete-step <id> <name> --executor <executor> --evidence "..."`.
- Only after all specialty steps complete does the orchestrator advance the ticket to the next status.
- Gate-check is NOT run after `decompose` or `document` stages.

Docs:
- Add `docs/specialty-steps.md` describing the feature: what it is, when the gate runs, the v1 catalog, how to add a new specialty, how evidence is recorded, and how `doneRequires` interacts (specialty evidence is preserved but never required for closeout).
- Add a link to the new doc from the README Documentation Index.

## Acceptance Criteria

- `SKILL.md` describes the gate-check + specialty-run loop in the design, implement, and test stages, including the exact CLI invocations.
- Orchestrator role prompts under `plans/prompts/` reflect the new loop wherever stage transitions are documented.
- `docs/specialty-steps.md` exists and covers: overview, when gate-check runs, the v1 catalog (5 prompts across design + implement), authoring a new specialty entry, evidence recording via `complete-step`, and the `doneRequires` interaction.
- README Documentation Index has a link to `docs/specialty-steps.md`.
- No new specialty evidence is treated as mandatory: `local-board validate` and closeout checks still pass on tickets that ran no specialties.
- Depends on T20260516T1551Z (gate-check), T20260516T1552Z (specialty-run), and T20260516T1553Z (ported prompts).

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
