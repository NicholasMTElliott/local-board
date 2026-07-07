---
id: T20260707T1334Z
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
created: 2026-07-07T13:34:55Z
updated: 2026-07-07T13:23:41Z
completedSteps: []
routingApprovals: []
---
# cli: complete-step accepts --model and composes executor evidence server-side

## Requirement

The executor evidence string `<route>@<model>` is composed by the orchestrating model from prose rules (`SKILL.md:36, 219`) — a compliance point that can drift (wrong suffix, missing suffix), and which T20260707T1324Z will start validating strictly.

Fix: accept `--model <model>` on `complete-step` and compose the `<route>@<model>` token server-side; keep the combined form accepted for backward compatibility. Update skill texts to pass `--executor <configuredAgent> --model <configuredModel>` verbatim from `begin-step` output.

Acceptance: `complete-step --executor <route> --model <m>` records `<route>@<m>`; both forms validate identically; skills updated.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
