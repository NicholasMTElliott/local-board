---
id: T20260708T2213Z
type: task
status: backlog
priority: P4
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-08T22:10:45Z
updated: 2026-07-08T22:11:53Z
completedSteps: []
routingApprovals: []
---
# skill: make worktrees the default for single-ticket mode

## Requirement

Single-ticket orchestration (the local-board skill) works on the main checkout and switches branches via `start-work`. In a 2026-07 production run this produced stacked branches: after a ticket's commits, `start-work` for the next ticket branched off the previous ticket's branch instead of the default branch, yielding divergent board state that required manual reconciliation merges (T20260707T1335Z/T20260707T1336Z). Parallel mode (local-team) never hit this because per-ticket worktrees structurally isolate each ticket from the orchestrator's checkout and from each other.

Fix: make worktrees the default working style for single-ticket mode too. Update the local-board skill text (SKILL.md, canonical root copy + the codex mirror per the lockstep rule, plus resources/ so installs inherit it): before implement/review/test/document, run `worktree-add <id>`, pass `--root <worktreePath>` on per-ticket calls, and `worktree-remove` after done — i.e. the same lifecycle local-team already documents, at N=1. Document the main-checkout flow as a fallback for environments where worktrees are unavailable, with an explicit warning about the branch-stacking hazard and the fast-forward check that mitigates it.

## Acceptance Criteria

- SKILL.md (root, codex mirror, resources copies) describe the worktree lifecycle as the default single-ticket flow; skill-usage-sync and resources drift tests stay green.
- The branch-stacking hazard and its symptom (start-work branching off a prior ticket branch) are documented in the fallback section.
- No CLI changes required (worktree-add/remove already exist); if any small gap blocks N=1 usage, note it as a follow-up rather than expanding scope.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
