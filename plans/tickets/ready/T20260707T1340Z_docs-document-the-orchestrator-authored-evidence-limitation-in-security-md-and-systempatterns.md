---
id: T20260707T1340Z
type: task
status: ready_for_design
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
created: 2026-07-07T13:40:06Z
updated: 2026-07-07T13:23:42Z
completedSteps: []
routingApprovals: []
---
# docs: document the orchestrator-authored evidence limitation in SECURITY.md and systemPatterns

## Requirement

Return-only section content (Review Findings, Test Evidence) is persisted by the orchestrator via `section --file`, so even with dispatch verification (T20260707T1325Z/T20260707T1326Z), the orchestrator could substitute or summarize a subagent's findings undetectably. This is inherent to the return-only architecture and should be acknowledged as a known limitation rather than silently trusted.

Fix: document the limitation and its rationale in `SECURITY.md` (threat model section) and `memory-bank/systemPatterns.md` (Safety Pattern section), noting that the dispatch ledger narrows but does not close it, and that the mitigation is human review of ticket diffs.

Acceptance: both documents state the limitation explicitly.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
