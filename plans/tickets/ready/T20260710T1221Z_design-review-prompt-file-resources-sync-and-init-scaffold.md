---
id: T20260710T1221Z
type: task
status: ready_for_design
priority: P2
parent: S20260710T1206Z
children: []
blockedBy: []
blocks: [T20260710T1222Z]
branch: local-board/T20260710T1221Z-design-review-prompt-file-resources-sync-and-init-scaffold
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-10T12:20:25Z
updated: 2026-07-10T12:22:11Z
completedSteps: []
routingApprovals: []
---
# design-review: prompt file, resources sync, and init scaffold

## Requirement

The design reviewer (parent S20260710T1206Z) dispatches through a prompt file, scaffolded into new boards and restored by init when missing. plans/prompts/ is the human-edited source of truth; resources/prompts/ is the packaged mirror produced by scripts/sync-resources.mjs and consumed by initProject (wholesale mirror — see test/prompt-scaffold.test.js).

## Scope

- Author plans/prompts/steps/design_review.md: a read-only review rubric for a codex reviewer inspecting the ## Technical Design against the ## Requirement / acceptance criteria. Cover: design flaws and internal contradictions; missing elements; acceptance-criteria coverage; testability; unstated assumptions. Specify a strict verdict output (PASS / CONCERNS / FAIL) plus findings, and state the reviewer is return-only (persists nothing itself).
- Run npm run sync-resources to regenerate resources/prompts/steps/design_review.md (LF-normalized) so the packaged tree matches.

## Acceptance criteria

- plans/prompts/steps/design_review.md exists, is non-empty, and states the PASS/CONCERNS/FAIL verdict contract and the five rubric dimensions above.
- resources/prompts/steps/design_review.md is a byte-for-byte (LF) mirror; the resources sync test passes.
- After local-board init, plans/prompts/steps/design_review.md is scaffolded; deleting it and re-running init restores it (add-missing-only behavior — no code change expected, but confirm the new file participates).
- npm run check and node --test pass.

## Non-goals

No CLI wiring or assertPromptExists call site (sibling CLI task). No rubric content beyond the review step.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
