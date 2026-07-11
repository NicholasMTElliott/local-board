---
id: T20260711T2138Z
type: task
status: designing
priority: P4
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260711T2138Z-prompts-operational-reality-gaps-sandbox-commit-fallback-orchestrator-obligations-loop-back-re-design-guidance-routing-pin-drift
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-11T21:36:10Z
updated: 2026-07-11T23:04:44Z
completedSteps: []
routingApprovals: []
---
# prompts: operational-reality gaps - sandbox commit fallback, orchestrator obligations, loop-back re-design guidance, routing-pin drift

## Requirement

From the prompt-library review of 2026-07-11 (items 3, 12, 13, 15): operational realities learned in the 2026-07-10/11 runs that the prompts do not yet encode.

1. [Item 3] plans/prompts/steps/document.md L17 (Commit scope), agents/codex/local-board-documenter.md L28, agents/codex/local-board-implementer.md L28: the commit instruction is unsatisfiable for codex workspace-write executors on Windows (sandbox denies git commit against the main repo .git; observed on every docs step across two runs — the orchestrator commits instead). Append to each Commit scope block: if the sandbox denies git commit, do not retry - list the exact intended paths in your returned summary and the orchestrator commits them on the ticket branch.
2. [Item 12] plans/prompts/roles/orchestrator.md encodes none of the run-learned orchestrator obligations. Add two bullets under Responsibilities: (a) persist return-only executor output yourself via Write + section --file; never ask a return-only executor to write files; (b) after a loop-back to a ready_* status, downstream evidence AND gate/design-review consultations are stripped - re-run the affected steps and gates before the next forward move.
3. [Item 13] plans/prompts/steps/design.md never tells the designer to address loop-back findings. Add under Include: on a re-design after a loop-back, read the Review Findings, Test Evidence, and Run Log design-review comments for the findings that caused it and address each explicitly. (Note: reference the Run Log design-review comments, NOT a "Design Review" section - B20260710T2051Z established that flow.)
4. [Item 15] plans/prompts/steps/design_review.md L4 hardcodes "default pin gpt-5.6-sol @ xhigh reasoning", which silently drifts from config. Reword to: routed per the design-review agent profile in plans/local-board.config.jsonc.

### Scope

- Edits per above; npm run sync-resources (document.md, orchestrator.md, design.md, design_review.md are all under plans/prompts); agents/ files need no sync. Verify the B20260710T2051Z content assertion on design_review.md still passes after the L4 reword. Full node --test per AGENTS.md.

### Acceptance criteria

- Codex documenter/implementer prompts describe the sandbox-commit fallback; orchestrator role prompt carries both obligations; design.md covers re-design after loop-back with the correct persistence references; design_review.md no longer pins a model in prose.
- npm run check and node --test pass; resources mirror synced.

### Non-goals

- No behavior/CLI changes; no changes to the design-review verdict contract or routing config.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
