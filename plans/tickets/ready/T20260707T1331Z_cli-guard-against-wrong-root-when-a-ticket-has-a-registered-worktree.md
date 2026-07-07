---
id: T20260707T1331Z
type: task
status: ready_for_design
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T13:31:54Z
updated: 2026-07-07T13:23:41Z
completedSteps: []
routingApprovals: []
---
# cli: guard against wrong --root when a ticket has a registered worktree

## Requirement

`--root` defaults to `"."` (`src/cli.js:46`) and parallel-mode correctness rides on the model remembering to pass `--root <worktreePath>` on every per-ticket call (`SKILL_TEAM.md:78-87`). One forgotten flag silently mutates the mainline checkout's copy of the ticket instead of the worktree copy, and nothing detects the divergence. Related trap: `worktree-remove` is the lone per-ticket command that must NOT take the worktree root.

Fix: the CLI already knows worktree assignments (`worktree-list`); for per-ticket mutation commands, refuse or warn when the ticket has a registered worktree and the invocation root is not that worktree. For `worktree-remove`, auto-resolve the main root when invoked with a worktree root (`mainRootFor` logic exists in `src/worktrees.js:148-160`).

Acceptance: mutating a worktree-assigned ticket from the wrong root is refused (with an override flag) or loudly warned; `worktree-remove` works when given either root; tests cover both.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
