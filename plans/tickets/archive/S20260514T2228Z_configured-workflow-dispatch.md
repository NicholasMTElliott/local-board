---
id: S20260514T2228Z
type: story
status: archived
priority: P1
parent: E20260514T2056Z
children: [T20260514T2228Z, T20260514T2229Z]
blockedBy: []
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-05-14T22:28:49Z
updated: 2026-07-07T14:07:41Z
completedSteps: [decompose:claude-subagent:local-board-decomposer]
---
# Configured workflow dispatch

## Requirement

Provide a deterministic way for an orchestrator to ask which ticket and action should run next.

## Acceptance Criteria

- `plans/local-board.config.jsonc` defines pipeline order, status actions, prompts, and agents. - `query-next --json` returns ticket path, action, prompt, agent, and eligibility. - `query-ticket --json` returns the same action bundle for a specific ticket.

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
