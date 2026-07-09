---
id: T20260709T1117Z
type: task
status: ready_for_design
priority: P2
parent: null
children: []
blockedBy: []
blocks: [T20260709T1119Z]
branch: local-board/T20260709T1117Z-cli-commit-planning-changes-at-stage-transitions-durable-ticket-state
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-09T11:17:37Z
updated: 2026-07-09T11:21:27Z
completedSteps: []
routingApprovals: []
---
# cli: commit planning changes at stage transitions (durable ticket state)

## Requirement

Field report from a project on an older local-board version: two incidents destroyed uncommitted worktree ticket state — an aborted merge, then a tester's `git checkout -- .` probe — and both had to be recovered from subagent transcripts. The current version has the same exposure: the only planning commit the CLI ever makes is inside the auto-merge path at `move done` (src/git.js:72, `git.commitPlanningChanges`), so between stages all evidence (complete-step tokens, gate stamps, section bodies, status moves) sits as uncommitted edits in the worktree while executors with full Bash access run against it. Observed in current production runs: testers repeatedly report the ticket's uncommitted status move in `git status` while they work.

Fix: make planning state durable at stage transitions. Add `git.commitPlanningOnTransition` (suggest fallback false / scaffold true, matching the routing-flag pattern): when enabled and the root is a git checkout, `move`, `complete-step`, `gate-complete`, and `section` commit planning-only changes (plans/tickets/** and any planning paths the auto-merge classifier already recognizes — reuse its planning/non-planning split from src/git.js) after a successful mutation, with a terse generated message (e.g. "<ticket-id>: <command> <action|status>"). Batch-friendly: committing only when the working tree's planning paths are dirty makes back-to-back CLI calls cheap. Non-git roots and disabled flag: current behavior. The adopting project's practice ("planning commit at every stage transition") becomes the scaffold default.

Design questions to settle: commit scope strictly planning paths (never src/docs — those belong to the implementer's commits); interaction with worktree-add's existing branch-stamp commit; whether `create`/`estimate`/`comment` also commit (recommend: any mutating command under the flag) — designer decides and justifies.

## Acceptance Criteria

- With the flag on, each mutating CLI command leaves planning files committed; `git status` shows no dirty plans/tickets/** after any single command.
- Planning-only classification reused from the auto-merge path (one source of truth); non-planning files are never swept into these commits.
- Flag off (DEFAULT_CONFIG): byte-for-byte current behavior; config guard test updated per the established divergence pattern.
- An aborted merge or `git checkout -- .` in a worktree after any CLI mutation loses nothing (regression test simulating the destructive op).
- Docs: Workflow.md + memory-bank fact; scaffold comment explains the motivation (executor Bash access + destructive git ops).

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
