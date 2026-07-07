---
id: T20260707T1322Z
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
created: 2026-07-07T13:22:26Z
updated: 2026-07-07T13:23:24Z
completedSteps: []
routingApprovals: []
---
# npm: add where --json and absolute fallback prompt paths; retire INSTALL_PATH placeholder

## Requirement

Even with a PATH-based command, skills still reference `<<INSTALL_PATH>>` for fallback prompts (`SKILL.md:90`) and Codex executor prompts (`skills/codex/*/SKILL.md:18`). Under npm the assets live in the global `node_modules` at a path the skill text cannot know.

Fix: make the CLI report its own asset locations — add `local-board where --json` (install dir, prompts dir, templates dir, agents dir, version, from install-info.json plus import.meta.url resolution), and/or have `begin-step`/`gate-check`/`specialty-run` return absolute fallback-prompt paths directly (they already return project-prompt paths). Then remove the `<<INSTALL_PATH>>` placeholder from all skill templates.

Acceptance: no `<<INSTALL_PATH>>` remains in any skill template; an orchestrator can locate fallback prompts and Codex executor prompts purely from CLI output.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
