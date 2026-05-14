# Ticket Format

Tickets are Markdown files with YAML front matter.

The MVP parser supports the documented subset: scalar values, `null`, and inline lists such as `[]` or `[T20260514T1234Z]`. Use that subset for machine-authored tickets.

## Naming

Preferred format:

```text
{Prefix}{yyyyMMddTHHmmZ}_{slug}.md
```

Prefixes:

| Prefix | Type |
|---|---|
| E | Epic |
| S | Story |
| T | Task |
| B | Bug |

Example:

```text
T20260514T1234Z_implement-leaderboard-feature.md
```

## Required Front Matter

```yaml
id: T20260514T1234Z
type: task
status: backlog
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: null
created: 2026-05-14T12:34:00-04:00
updated: 2026-05-14T12:34:00-04:00
```

Front matter is canonical. Folder placement is for humans and should match status.

## Status Folder Mapping

| Status | Folder |
|---|---|
| `backlog` | `plans/tickets/backlog/` |
| `ready_for_decomposition` | `plans/tickets/ready/` |
| `ready_for_design` | `plans/tickets/ready/` |
| `designing` | `plans/tickets/active/` |
| `questions` | `plans/tickets/questions/` |
| `ready_for_implementation` | `plans/tickets/ready/` |
| `implementing` | `plans/tickets/active/` |
| `ready_for_review` | `plans/tickets/review/` |
| `reviewing` | `plans/tickets/review/` |
| `ready_for_test` | `plans/tickets/ready/` |
| `testing` | `plans/tickets/active/` |
| `ready_for_docs` | `plans/tickets/ready/` |
| `done` | `plans/tickets/done/` |
| `blocked` | `plans/tickets/blocked/` |
| `archived` | `plans/tickets/archive/` |

## Standard Sections

```md
# Title

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
```

## State Rule

Do not rely on prose to move a ticket. A transition must update `status`.

## Validation

The CLI validator checks:

- front matter fields and basic types;
- ticket ID, filename, and type-prefix consistency;
- status-to-folder consistency;
- required standard sections;
- parent/child link existence and reciprocity;
- `blockedBy`/`blocks` link existence and reciprocity;
- ISO-8601 `created` and `updated` values with timezone offsets or `Z`.

## Rewriting Front Matter

Use the CLI for state changes that affect canonical front matter:

```sh
node ./bin/local-board.js move T20260514T1234Z implementing
node ./bin/local-board.js set T20260514T1234Z priority P1
node ./bin/local-board.js update-field T20260514T1234Z blockedBy "[T20260514T1200Z]"
```

`move` updates `status`, rewrites `updated`, and relocates the file to the mapped status folder. `set` and `update-field` are aliases for front matter updates. `id`, `type`, `created`, and `updated` are managed fields and cannot be set directly.

The writer emits required fields in canonical order and preserves the Markdown body.
