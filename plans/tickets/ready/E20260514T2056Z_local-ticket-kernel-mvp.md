---
id: E20260514T2056Z
type: epic
status: ready_for_decomposition
priority: P1
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: null
created: 2026-05-14T20:56:00+00:00
updated: 2026-05-14T20:56:00+00:00
---

# Local Ticket Kernel MVP

## Requirement

Build the first deterministic kernel for repo-native tickets.

## Acceptance Criteria

- Markdown tickets with YAML front matter can be parsed.
- Ticket invariants can be validated locally.
- Tickets can be listed.
- The highest-priority eligible ticket can be selected.
- New tickets can be created from the standard template.
- Ticket front matter can be rewritten deterministically.
- Ticket status can be moved with matching folder relocation.
- Timestamped comments can be added to standard sections.
- The ticket contract is documented.

## Related Tickets

None.

## Technical Design

Use a dependency-free Node.js ESM CLI package. Keep the canonical state in Markdown ticket files. Validate deterministic invariants before orchestration relies on ticket state.

## Implementation Notes

Initial implementation lives in `src/` with the executable entrypoint in `bin/`. The CLI supports validation, listing, next-ticket selection, creation, status moves, field updates, and timestamped comments.

## Review Findings

None yet.

## Test Evidence

None yet.

## Documentation Updates

Update README and ticket/workflow docs when the kernel contract changes.

## Questions

None.

## Run Log

- 2026-05-14: Created as the first MVP epic.
