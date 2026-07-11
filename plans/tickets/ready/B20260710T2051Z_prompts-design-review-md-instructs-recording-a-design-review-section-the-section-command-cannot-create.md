---
id: B20260710T2051Z
type: bug
status: ready_for_design
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/B20260710T2051Z-prompts-design-review-md-instructs-recording-a-design-review-section-the-section-command-cannot-create
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-10T20:50:03Z
updated: 2026-07-11T20:30:42Z
completedSteps: []
routingApprovals: []
---
# prompts: design_review.md instructs recording a Design Review section the section command cannot create

## Requirement

Observed 2026-07-10 during the parallel run. plans/prompts/steps/design_review.md tells the executor "The orchestrator records the ## Design Review section", but the section command writes only STANDARD_SECTIONS (Requirement, Acceptance Criteria, Related Tickets, Technical Design, Implementation Notes, Review Findings, Test Evidence, Documentation Updates, Questions, Run Log) and refuses unknown section names - there is no Design Review section and no CLI way to create one. In practice the orchestrator recorded verdicts via comment (Run Log) plus design-review-complete evidence, which worked but contradicts the prompt.

### Scope

1. Decide the contract (design decides): (a) amend the prompt (and its resources/prompts mirror via npm run sync-resources) to say the orchestrator records the verdict via comment and design-review-complete evidence - the minimal fix; or (b) add "Design Review" to STANDARD_SECTIONS and the ticket template so the section command can persist full findings - the richer fix; weigh template churn on existing boards and validate implications (missing-section checks).
2. Implement the chosen contract; keep the verdict-first TEXT contract (PASS/CONCERNS/FAIL first line) unchanged.
3. Tests: prompt content assertion updated if (a); template/section/validate coverage if (b). Sync suites green.

### Acceptance criteria

- The design_review prompt and the CLI agree on where the review is persisted; a fresh scaffold plus the documented flow produces no dead-end instruction.
- npm run check and node --test pass.

### Non-goals

- No change to the design-review token, preconditions, or routing.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
