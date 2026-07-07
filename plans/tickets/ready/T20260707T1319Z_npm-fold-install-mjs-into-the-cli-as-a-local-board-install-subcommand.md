---
id: T20260707T1319Z
type: task
status: ready_for_design
priority: P1
parent: null
children: []
blockedBy: []
blocks: [T20260707T1320Z]
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T13:19:26Z
updated: 2026-07-07T13:23:55Z
completedSteps: []
routingApprovals: []
---
# npm: fold install.mjs into the CLI as a local-board install subcommand

## Requirement

`install.mjs` is a standalone script with a shebang but no `bin` entry; once the package is on npm there is no way to run the harness installer from an installed copy. Harness installation (skills to `~/.claude/skills`, `~/.codex/skills`, opencode/cline/cursor dirs, Claude agents to `~/.claude/agents`, the settings.json allow rule, legacy-dir cleanup) must remain an explicit, consent-visible step.

Fix: fold install.mjs into the CLI as `local-board install [--target=...] [--list-targets] [--uninstall]`, reusing the existing TARGETS logic. Do NOT wire it to npm postinstall: postinstall fires in CI and when installed as a dependency, is skipped under --ignore-scripts, and writing to `~/.claude/settings.json` implicitly is intrusive. At most, print a one-line pointer from postinstall.

Acceptance: `local-board install` performs everything `node install.mjs` does today; `install.mjs` delegates to it or is removed; no postinstall side effects.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
