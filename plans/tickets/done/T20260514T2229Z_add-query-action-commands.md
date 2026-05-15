---
id: T20260514T2229Z
type: task
status: done
priority: P1
parent: S20260514T2228Z
children: []
blockedBy: []
blocks: []
branch: null
estimate: null
created: 2026-05-14T22:29:49Z
updated: 2026-05-15T13:48:57Z
completedSteps: [design:claude-subagent:local-board-designer, implement:claude-subagent:local-board-implementer, review:codex-task:read-only, test:claude-subagent:local-board-tester, document:codex-task:workspace-write]
---
# Add query action commands

## Requirement

Add deterministic action queries for whole-project and specific-ticket workflows.

## Acceptance Criteria

- `query-next` sorts by priority and pipeline order. - `query-ticket` returns action metadata for a named ticket. - Tests cover both paths.

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
