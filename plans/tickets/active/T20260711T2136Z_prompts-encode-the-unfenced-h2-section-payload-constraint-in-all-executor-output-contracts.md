---
id: T20260711T2136Z
type: task
status: designing
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260711T2136Z-prompts-encode-the-unfenced-h2-section-payload-constraint-in-all-executor-output-contracts
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-11T21:36:10Z
updated: 2026-07-11T23:04:42Z
completedSteps: []
routingApprovals: []
---
# prompts: encode the unfenced-H2 section-payload constraint in all executor output contracts

## Requirement

From the prompt-library review of 2026-07-11 (items 6, 7, 8): the CLI now rejects section payloads containing unfenced lines starting with "## " (setTicketSection guard, shipped by B20260710T1532Z), but no prompt or agent definition warns the executors who author those payloads. This exact corruption occurred twice in the 2026-07-10 run (designer H2 payloads) and reappears every time a fresh executor invents H2 headings.

### Scope

1. Reviewer/tester output contracts — plans/prompts/roles/code_reviewer.md (Output and Persistence), plans/prompts/steps/test.md (Output and Persistence), agents/claude/local-board-reviewer.md, agents/claude/local-board-tester.md, agents/codex/local-board-reviewer.md, agents/codex/local-board-tester.md: add one sentence — use ### or deeper for internal headings and fence any literal "## " example lines; a payload containing an unfenced "## " line is rejected at persistence.
2. Decomposer requirementBody — agents/claude/local-board-decomposer.md, agents/codex/local-board-decomposer.md (Proposal format bullet), plans/prompts/steps/decompose.md (orchestrator branch): extend the requirementBody bullet — use ### or deeper for internal headings (e.g. ### Acceptance Criteria); never include an unfenced "## " line.
3. Designer heading ambiguity — plans/prompts/steps/design.md (L17-19), agents/claude/local-board-designer.md (step 1), agents/codex/local-board-designer.md (Persist rule): replace "the complete ## Technical Design section body" phrasing with "the section body only - do not include the heading line itself (local-board manages the heading), and fence any literal ## sample lines".
4. npm run sync-resources for the plans/prompts files; agents/ files need no sync. Full node --test per AGENTS.md.

### Acceptance criteria

- Every executor role that authors section payloads or requirementBody content carries the H3+ / fence warning in its output contract.
- No content-assertion test regressions; resources mirror synced; npm run check and node --test pass.

### Non-goals

- No change to the setTicketSection guard itself; no restructuring of the prompts beyond the added sentences.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
