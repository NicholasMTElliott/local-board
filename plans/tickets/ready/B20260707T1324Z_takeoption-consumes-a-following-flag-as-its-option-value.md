---
id: B20260707T1324Z
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
created: 2026-07-07T13:24:08Z
updated: 2026-07-07T13:23:23Z
completedSteps: []
routingApprovals: []
---
# takeOption consumes a following flag as its option value

## Requirement

`takeOption` (`src/cli.js:924-935`) consumes whatever token follows an option flag, including another flag. `complete-step T1 test --evidence --json` silently records the string `--json` as evidence instead of erroring.

Fix: error when an option value starts with `--`.

Acceptance: passing a flag where a value is expected produces a clear usage error; existing tests still pass.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
