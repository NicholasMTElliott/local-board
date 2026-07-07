---
id: T20260707T1321Z
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
created: 2026-07-07T13:21:26Z
updated: 2026-07-07T13:23:24Z
completedSteps: []
routingApprovals: []
---
# npm: add version command and skill version-skew preflight

## Requirement

The CLI has no `version`/`--version`/`help` command (`src/cli.js` — zero matches). Once the CLI is updated via `npm update -g` while installed skill copies stay frozen, skill text can silently reference commands or flags that moved — version skew becomes the main drift risk of npm distribution.

Fix: add `local-board --version` (read package.json via `new URL("../package.json", import.meta.url)`). Have `local-board install` stamp the package version into the rendered skills, and add a one-line preflight to the skills comparing the stamped version against `local-board --version`, warning on mismatch (re-run `local-board install`).

Acceptance: `local-board --version` prints the package version; installed skills carry the stamped version; a skew between the two is detectable by the documented preflight.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
