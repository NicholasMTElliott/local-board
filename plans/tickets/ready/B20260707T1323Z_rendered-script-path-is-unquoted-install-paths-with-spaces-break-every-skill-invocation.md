---
id: B20260707T1323Z
type: bug
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
created: 2026-07-07T13:23:08Z
updated: 2026-07-07T13:23:23Z
completedSteps: []
routingApprovals: []
---
# Rendered SCRIPT_PATH is unquoted; install paths with spaces break every skill invocation

## Requirement

Every rendered skill command is `node C:/Users/<user>/.local-board/bin/local-board.js ...` with no quotes (`install.mjs:138`, `renderSkill` at 218-222). A Windows username containing a space breaks every invocation. Worse, the quoted form a model would then write no longer matches the registered allow rule `Bash(node <path> *)` (`install.mjs:139`, `SKILL.md:5`), so even the workaround triggers permission prompts. Related: the allow rule uses forward slashes, so a model writing the same path with backslashes (natural on Windows) also prompts.

Fix: render with quotes and make the allow rule match the quoted form. Note: T20260707T1320Z (PATH-based `local-board` command) eliminates this class entirely; this ticket is the short-term mitigation and may be closed as superseded if npm distribution lands first.

Acceptance: an install under a home path containing a space produces working skill invocations that match the allow rule.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
