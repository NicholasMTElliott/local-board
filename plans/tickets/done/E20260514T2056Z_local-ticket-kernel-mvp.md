---
id: E20260514T2056Z
type: epic
status: done
priority: P1
parent: null
children: [S20260514T2228Z, S20260514T2229Z, S20260514T2230Z, S20260514T2231Z]
blockedBy: []
blocks: []
branch: null
estimate: null
created: 2026-05-14T20:56:00+00:00
updated: 2026-05-14T22:28:52Z
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

Decomposed into configured workflow dispatch, relationship primitives, project bootstrap/installable skill, and ticket content editing stories with supporting tasks.

## Review Findings

None yet.

## Test Evidence

- Created child stories and tasks using local-board CLI. - Linked all child tickets with reciprocal parent/children fields. - Verified with `npm test`, `npm run check`, and `npm run validate` before closeout.

## Documentation Updates

Update README and ticket/workflow docs when the kernel contract changes.

## Questions

None.

## Run Log

- 2026-05-14: Created as the first MVP epic.

- 2026-05-14T22:28:52Z: Decomposition completed through local-board CLI primitives.
