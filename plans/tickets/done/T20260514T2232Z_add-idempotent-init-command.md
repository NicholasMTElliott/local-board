---
id: T20260514T2232Z
type: task
status: done
priority: P1
parent: S20260514T2230Z
children: []
blockedBy: []
blocks: []
branch: null
estimate: null
created: 2026-05-14T22:32:51Z
updated: 2026-05-15T13:48:57Z
completedSteps: [design:claude-subagent:local-board-designer, implement:claude-subagent:local-board-implementer, review:codex-task:read-only, test:claude-subagent:local-board-tester, document:codex-task:workspace-write]
---
# Add idempotent init command

## Requirement

Scaffold local-board folders, prompts, templates, and config into another repo.

## Acceptance Criteria

- `init` creates missing files. - Re-running `init` skips existing files unless overwrite is requested.

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
