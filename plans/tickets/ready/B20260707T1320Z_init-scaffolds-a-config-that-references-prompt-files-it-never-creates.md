---
id: B20260707T1320Z
type: bug
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
created: 2026-07-07T13:20:54Z
updated: 2026-07-07T13:23:07Z
completedSteps: []
routingApprovals: []
---
# init scaffolds a config that references prompt files it never creates

## Requirement

`local-board init` scaffolds a config whose `optionalSteps` entries point at `plans/prompts/optional-steps/...` (`src/config.js:776-807`) and `gate-check` hardcodes `plans/prompts/steps/gate-check.md` (`src/cli.js:779`), but `src/scaffold.js` FILES creates neither `gate-check.md` nor any `optional-steps/*` prompt. Those files exist only in this repo's live `plans/` tree. In a freshly initialized repo, `gate-check --json` and `specialty-run` return `prompt` paths that do not exist, handing dispatched agents dead file references.

Fix: add the missing prompt files to the scaffold, and make `gate-check`/`specialty-run` verify the resolved prompt file exists and fail loudly when it does not.

Acceptance: after `init` in an empty repo, every prompt path returned by `gate-check` and `specialty-run` exists on disk; missing prompts produce a clear error, not a dead path.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
