---
id: T20260710T1222Z
type: task
status: ready_for_design
priority: P2
parent: S20260710T1206Z
children: []
blockedBy: [T20260710T1220Z, T20260710T1221Z]
blocks: [T20260710T1223Z]
branch: local-board/T20260710T1222Z-design-review-cli-check-and-complete-commands
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-10T12:20:25Z
updated: 2026-07-10T13:25:24Z
completedSteps: []
routingApprovals: []
---
# design-review: CLI check and complete commands

## Requirement

The orchestrator needs a command to resolve the design-review route/model/effort + prompt + ticket context (analogous to gate-check), and a command to record the reviewer's verdict as evidence (analogous to gate-complete/complete-step). Core recorder and route resolution land in the sibling core task (T20260710T1220Z); this task exposes them on the CLI. Parent: S20260710T1206Z.

## Scope

- src/cli.js: add a resolution command design-review-check <ticket-id> [--json] [--allow-main-root] that returns the resolved agent (route), model, effort, the resolved prompt path (plans/prompts/steps/design_review.md, via promptForAction/actionPrompts with assertPromptExists), and a narrow ticketContext (id/type/status/priority/path/title/requirement/acceptanceCriteria/currentAction) — modeled on commandGateCheck/commandSpecialtyRun. It performs no dispatch.
- Add a completion command design-review-complete <ticket-id> --executor <executor> [--model <model>] --evidence <text> [--allow-main-root] [--json] that calls composeExecutor then the core recorder, and runs maybeCommitPlanning.
- Wire both into main() dispatch and the usage/help text; enforce assertInvocationRootForTicket on the mutating command as the gate commands do.

## Acceptance criteria

- On a requireDesignReview: true board, the resolution command returns agent codex-task:read-only, model gpt-5.6-sol, effort xhigh, and the scaffolded prompt path; a missing prompt yields an actionable error naming local-board init (parallel to the gate-check missing-prompt test).
- The completion command records the design-review:<executor>@<model> token, enforces the model pin, appends a Run Log line, and unblocks the subsequent move <id> ready_for_implementation; a wrong-root invocation is refused before any write.
- End-to-end CLI test in test/cli.test.js: design -> design-review-check -> design-review-complete -> move to implementation succeeds; skipping design-review-complete is refused.
- npm run check and node --test pass.

## Non-goals

No core-logic changes (they land in T20260710T1220Z). No skill/docs prose (sibling docs task).

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-10T12:26:04Z: Contract note from T20260710T1221Z design: the design-review prompt returns a FIRST-LINE TEXT verdict (PASS/CONCERNS/FAIL + numbered findings), NOT JSON like the optional-steps reviewers. design-review-complete / orchestrator parsing must read the first-line token, not JSON.parse.
