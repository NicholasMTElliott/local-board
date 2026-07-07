---
id: T20260707T1336Z
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
created: 2026-07-07T13:36:55Z
updated: 2026-07-07T13:23:41Z
completedSteps: []
routingApprovals: []
---
# skills: dedupe CLI command blocks across skill texts

## Requirement

Four overlapping skill texts have no single source and are already drifting: the CLI command block is duplicated verbatim in `SKILL.md:231-255` and `skills/codex/local-board/SKILL.md:157-181`, and both omit `worktree-add`/`worktree-remove`/`worktree-list`, `fast-forward`, `team-config`, `list`, and `next` — commands the team skills rely on. The skills also say "use schema --json, don't inspect source", which makes the long duplicated block redundant.

Fix: shrink the command blocks to the core loop plus a pointer to `--help`/`schema --json`, or generate the blocks from `src/cli.js` usage text in CI (a check that fails when skill blocks drift from the usage output). Also restructure the SKILL.md Branch Discipline ordering rule as a numbered sequence (the codex skill's form is clearer), pending T20260707T1332Z which removes the rule entirely.

Acceptance: command documentation exists in one authoritative place (or is generated/CI-checked); no skill lists a stale command set.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
