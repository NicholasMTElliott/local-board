---
id: T20260710T1533Z
type: task
status: ready_for_design
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260710T1533Z-skills-process-hardening-from-the-2026-07-10-parallel-run-retro-post-merge-suite-denial-hint-reviewer-no-test-run-prompt-edit-full-suite
estimate: null
estimateBasis: null
workStartedAt: 2026-07-10T15:40:30Z
workCompletedAt: null
created: 2026-07-10T15:32:23Z
updated: 2026-07-10T15:40:30Z
completedSteps: []
routingApprovals: []
---
# skills: process hardening from the 2026-07-10 parallel-run retro (post-merge suite, denial hint, reviewer no-test-run, prompt-edit full suite)

## Requirement

Consolidated process-hardening items from the 2026-07-10 parallel-run retrospective. Four skill/prompt text edits, each tied to an observed incident; no production code.

## Scope

1. SKILL_TEAM.md (and skills/codex/local-team/SKILL.md) Closeout: make post-merge verification a contract step — after each move ... done + manual merge (autoMerge off), run the full test suite on the merged default branch before proceeding to refill; on unexpected failures, fix forward immediately before dispatching new work. Incident: the B20260710T1225Z merge auto-merged textually but broke 11 tests via a removed-function call (semantic conflict invisible to git); caught only by ad-hoc discipline. Note the alternative with teeth in the text: boards may instead enable git.autoMerge for the CLI's rebase-onto-default precondition.
2. SKILL_TEAM.md Dispatch (and the single-ticket SKILL.md Delegation section): add the denial-recovery hint — if the routing-validator hook denies a dispatch with agent-mismatch, first verify begin-step was run for the ticket's CURRENT stage (the ledger stamp is the hook's primary evidence). Incident: two orchestrator misses in one session, both exactly this.
3. plans/prompts/roles/code_reviewer.md (and both reviewer agent definitions): add one line — do not attempt to run the test suite; review sandboxes deny child-process spawning; static review only, execution verification belongs to the test stage. Incident: every codex review in the session burned tokens on spawn EPERM attempts and reported it as a caveat.
4. AGENTS.md or SKILL.md maintenance note (design decides placement): prompt files under plans/prompts/ and agents/ are production artifacts — after editing them, run the FULL test suite, not just the guard suites (content-assertion tests exist against prompt text). Incident: a prompt reword broke test/cli.test.js's estimate-prompt assertion; only guard suites were run pre-commit.

Remember the resources mirror: any plans/prompts edit requires npm run sync-resources.

## Acceptance criteria

- All four texts updated at the described locations; CLI Commands fenced blocks untouched and byte-identical; skill-usage-sync suite green.
- Each addition is one to three sentences, executor/orchestrator-audience-correct per the audience-separation convention.
- npm run check and node --test pass.

## Non-goals

- No CLI behavior changes; no new tests beyond keeping existing suites green.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-10T15:40:30Z: Ensured git branch local-board/T20260710T1533Z-skills-process-hardening-from-the-2026-07-10-parallel-run-retro-post-merge-suite-denial-hint-reviewer-no-test-run-prompt-edit-full-suite (already-current).
