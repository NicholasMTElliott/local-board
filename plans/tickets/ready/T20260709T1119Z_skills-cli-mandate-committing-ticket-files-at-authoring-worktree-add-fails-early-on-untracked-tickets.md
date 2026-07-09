---
id: T20260709T1119Z
type: task
status: ready_for_design
priority: P3
parent: null
children: []
blockedBy: [T20260709T1117Z]
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
# skills+cli: mandate committing ticket files at authoring; worktree-add fails early on untracked tickets

## Requirement

No skill text mandates committing ticket files after authoring (create / section Requirement / link / block / decompose child creation / backlog promotion), yet worktree mode structurally requires it: `worktree-add` branches from HEAD, so a ticket file that exists only as an uncommitted edit on the default branch does not exist inside the new worktree. The add then breaks midway — the worktree and branch are created, but the branch-stamp write into the worktree's copy of the ticket (src/worktrees.js:51 setTicketField at worktreePath) fails because the file is absent there. Current runs avoid this purely by orchestrator habit (committing after creation/decomposition/promotion).

Fix, two layers:
1. Skills (single-ticket + team, both harness variants): make it explicit that ticket authoring ends with a planning commit — after `create`+`section`+links, after decompose child creation, and after backlog promotions, commit plans/ before dispatching or running `worktree-add`. One imperative sentence per flow, placed where each flow is described. (If T20260709T1117Z's commit-on-transition flag ships and covers `create`/`section`, the skill sentence becomes "verify committed" rather than "commit manually" — coordinate wording, don't duplicate machinery.)
2. CLI fail-early: `worktree-add` checks whether the ticket file is tracked and unmodified in HEAD of the default branch before creating anything; if the file is untracked or has uncommitted changes, refuse with a clear message ("ticket file not committed; commit plans/ before worktree-add") instead of half-creating the worktree. A `--force`-style escape is unnecessary — there is no valid uncommitted-ticket worktree flow.

## Acceptance Criteria

- `worktree-add` on an uncommitted (untracked or dirty) ticket file exits non-zero with a message naming the fix, creating no worktree and no branch.
- `worktree-add` on a committed ticket behaves exactly as today (existing tests green).
- Both skill files (and codex mirrors) state the authoring-ends-with-a-commit rule in the create/decompose/promotion flows; skill-usage-sync + resources drift tests green.
- Tests: refusal case (untracked ticket), dirty-ticket case (committed then edited), and the happy path.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
