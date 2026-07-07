---
id: T20260707T1338Z
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
created: 2026-07-07T13:38:06Z
updated: 2026-07-07T13:23:41Z
completedSteps: []
routingApprovals: []
---
# docs: add Install.md covering both harness installs and settings side effects

## Requirement

The installer has no human-readable documentation. `install.mjs` (409 lines, multi-target) copies the runtime to `~/.local-board`, installs skills to five harness locations, installs seven agents to `~/.claude/agents/`, and patches `~/.claude/settings.json` with a permission allow rule — a consent-sensitive side effect documented nowhere outside memory-bank. Codex install is partially covered by `docs/CodexSupport.md`; the Claude side is not covered at all. AGENTS.md requires new docs pages to be added to the README Documentation Index.

Fix: add `docs/Install.md` covering all targets, what is written where, the settings.json permission side effect, uninstall, and (once available) the npm install story from T20260707T1320Z. Add it to the README Documentation Index.

Acceptance: docs/Install.md exists, is indexed in README, and accurately lists every path the installer touches per target.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
