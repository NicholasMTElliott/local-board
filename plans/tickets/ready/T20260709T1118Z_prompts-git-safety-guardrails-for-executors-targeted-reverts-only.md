---
id: T20260709T1118Z
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
created: 2026-07-09T11:17:38Z
updated: 2026-07-09T11:21:14Z
completedSteps: []
routingApprovals: []
---
# prompts: git-safety guardrails for executors (targeted reverts only)

## Requirement

Same field report: a tester's `git checkout -- .` destroyed uncommitted ticket state in a worktree. Nothing in the executor prompt templates guards against this — return-only executors (reviewer, tester, gatecheck, decomposer) have unrestricted Bash, and the current templates (resources/prompts/steps/test.md and siblings, plus the skill texts) never mention git revert hygiene. The "revert your probe edits exactly, targeted paths only" rule exists only in ad-hoc orchestrator dispatch briefs.

Fix: add a git-safety rule to the executor-facing surfaces:
1. Step prompt templates (resources/prompts/steps/{test,review}.md and any other template that authorizes probe mutations): temporary probe edits must be reverted by TARGETED path (`git checkout -- <specific-file>` / `git restore <specific-file>` or exact fs operations); NEVER `git checkout -- .`, `git restore .`, `git stash`, `git reset --hard`, `git merge`/`git merge --abort`, or branch switches inside a ticket worktree — uncommitted orchestrator-owned ticket state may be present.
2. Skill texts (single-ticket + team, both harness variants where applicable): one sentence in the delegation section noting executors must follow the targeted-revert rule, and one sentence stating codex-task dispatches are serial-by-design and must never be backgrounded with shell `&` (concurrent CODEX_HOME use corrupts session state) — use the harness's background dispatch instead.
3. Run `npm run sync-resources` so the prompt mirror stays in lockstep (resources drift test).

Scope: prompt/skill text only; no CLI changes (T20260709T1117Z makes the state durable; this ticket reduces the chance the destructive op happens at all — defense in depth).

## Acceptance Criteria

- Both test and review step templates carry the targeted-revert rule; resources mirror synced; drift test green.
- Skill texts carry the executor git-safety sentence and the no-shell-& codex rule; skill-usage-sync test green (prose-only edits).
- Wording is executor-facing (imperative, concrete command names), not narrative.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
