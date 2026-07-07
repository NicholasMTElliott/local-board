---
id: T20260707T1318Z
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
created: 2026-07-07T13:18:26Z
updated: 2026-07-07T13:23:55Z
completedSteps: []
routingApprovals: []
---
# npm: add files allowlist and move runtime prompts and templates out of the live plans tree

## Requirement

`package.json` has no `files` field, so `npm publish`/`npm pack` today would ship the repo's live board: `plans/tickets/`, `memory-bank/`, `.local-board/`, `docs/`, `test/`, plus stray dirs. Additionally `install.mjs:135-136` copies `plans/prompts` and `plans/templates` as runtime assets — conflating the package's runtime resources with this repo's own planning artifacts.

Fix: move the runtime prompt/template copies out of the live `plans/` tree into a `resources/` directory that is unambiguously package content, update `install.mjs` and any CLI fallback-path logic, and add a `files` allowlist (`bin`, `src`, `resources`, `install.mjs`, `SKILL.md`, `SKILL_TEAM.md`, `agents`, `skills`). Also add `repository`, `description` polish, and `keywords` to package.json.

Acceptance: `npm pack --dry-run` lists only intended files; no live tickets, memory-bank, or test content in the tarball; installer and CLI resolve prompts/templates from the new location.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
