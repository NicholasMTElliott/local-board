---
id: T20260707T1323Z
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
created: 2026-07-07T13:23:26Z
updated: 2026-07-07T13:23:24Z
completedSteps: []
routingApprovals: []
---
# npm: evaluate Claude Code plugin packaging for skills, agents, and hooks

## Requirement

Claude Code plugins can bundle skills, agents, hooks, MCP servers, and default settings in one installable unit (git repo, zip archive, marketplace, or local path — npm is not a documented plugin source). This could replace the Claude-side portion of the custom installer entirely and is the natural delivery vehicle for the enforcement hooks (T20260707T1326Z): plugin hooks ship and update atomically with the skills they guard.

Scope: evaluate packaging `skills/` (Claude variants), `agents/claude/`, and the enforcement hooks as a plugin; determine precedence interactions with existing `~/.claude/skills` installs (plugin assets rank below user/project dirs — the installer must not leave stale user-dir copies shadowing plugin copies); decide whether the plugin lives in this repo or a sibling; note that plugin subagents ignore frontmatter `hooks`/`mcpServers`/`permissionMode`.

End-state to evaluate: npm for the CLI, plugin for Claude harness assets, `local-board install` only for Codex/opencode/cline/cursor.

Acceptance: a written decision (docs/) with a spike branch or a rejection rationale.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
