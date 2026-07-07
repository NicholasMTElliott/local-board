---
id: B20260707T1327Z
type: bug
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
created: 2026-07-07T13:27:08Z
updated: 2026-07-07T13:23:23Z
completedSteps: []
routingApprovals: []
---
# Claude designer agent CLI placeholder is never rendered at install time

## Requirement

`agents/claude/local-board-designer.md:41` instructs the designer to run `node <local-board-cli> section ...`, but `installClaudeAgents` (`install.mjs:244-259`) copies agent files verbatim with `copyFileSync` — the pseudo-placeholder is never rendered, unlike skill files which go through `renderSkill`. The executor knowing the real CLI path is pure dispatch-time model compliance.

Fix: run the Claude agent files through `renderSkill` at install time (the machinery already exists; one-line change), using a real `<<SCRIPT_PATH>>` placeholder in the agent source. Superseded if the PATH-based `local-board` command (T20260707T1320Z) lands first — then the agent text can just say `local-board section ...`.

Acceptance: installed agent files contain a concrete, working CLI invocation with no unrendered placeholders.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
