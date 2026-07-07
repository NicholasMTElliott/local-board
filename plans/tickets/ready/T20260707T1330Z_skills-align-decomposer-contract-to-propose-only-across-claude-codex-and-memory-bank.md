---
id: T20260707T1330Z
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
created: 2026-07-07T13:30:54Z
updated: 2026-07-07T13:23:41Z
completedSteps: []
routingApprovals: []
---
# skills: align decomposer contract to propose-only across Claude, Codex, and memory-bank

## Requirement

The decomposer's mutation contract contradicts itself across harnesses. `agents/claude/local-board-decomposer.md` says "Create child tickets ... through the local-board CLI commands"; `agents/codex/local-board-decomposer.md` says "Do not create child tickets yourself. Return a concrete proposal for the orchestrator to create." `memory-bank/systemPatterns.md` labels the decomposer both "Return-only" and "creates tickets via CLI" in the same table row, and `SKILL.md` never says who runs `create`. Decompose therefore behaves differently (and leaves different audit trails) depending on harness; a Claude run may create tickets the orchestrator also creates, or the orchestrator may wait for files that never appear.

Fix: pick propose-only (matches the "orchestrator owns mutations" principle and the return-only pattern) and align `agents/claude/local-board-decomposer.md`, `SKILL.md` (copy the codex skill's explicit sentence), and the memory-bank table. If create-directly is chosen instead, align the codex side and document the worktree ID-offset implications.

Acceptance: all decomposer references state one contract; SKILL.md says explicitly who runs `create`.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
