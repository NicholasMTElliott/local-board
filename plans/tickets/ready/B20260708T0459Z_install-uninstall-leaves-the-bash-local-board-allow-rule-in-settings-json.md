---
id: B20260708T0459Z
type: bug
status: ready_for_design
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/B20260708T0459Z-install-uninstall-leaves-the-bash-local-board-allow-rule-in-settings-json
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-08T04:59:37Z
updated: 2026-07-08T20:12:51Z
completedSteps: []
routingApprovals: []
---
# install: --uninstall leaves the Bash(local-board *) allow rule in settings.json

## Requirement

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-08T04:59:46Z: Found during T20260707T1338Z design. src/install.js --uninstall removes runtime, skill dirs, hooks entries, and agents, but never removes the Bash(local-board *) allow rule it added to ~/.claude/settings.json — the consent grant persists after uninstall. Fix: remove the rule on uninstall when present (and consider removing only if it matches the exact rule text the installer writes). docs/Install.md (T1338) documents manual removal in the meantime.
