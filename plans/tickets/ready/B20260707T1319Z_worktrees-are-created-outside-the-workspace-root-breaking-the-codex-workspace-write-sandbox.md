---
id: B20260707T1319Z
type: bug
status: ready_for_design
priority: P1
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T13:19:54Z
updated: 2026-07-07T13:23:07Z
completedSteps: []
routingApprovals: []
---
# Worktrees are created outside the workspace root, breaking the Codex workspace-write sandbox

## Requirement

`src/worktrees.js:128-129` places ticket worktrees at `<parent>/<repo>-worktrees/<ticket-id>` — outside the workspace root. Codex's default `workspace-write` sandbox blocks writes there, so `worktree-add`, every worker edit inside the worktree, and the rebase-in-worktree flow in `skills/codex/local-team/SKILL.md` hit approval escalations or hard denials. `docs/CodexSupport.md` does not mention sandbox modes, writable roots, or approval policy.

Fix: add a config option to place worktrees inside the repo (for example `.worktrees/`, git-ignored) or another configurable location, and document the required Codex configuration (additional writable root) in `docs/CodexSupport.md` for the out-of-repo layout.

Acceptance: a Codex `workspace-write` session can run the full parallel flow without sandbox escalations, or the docs state exactly what config is required.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
