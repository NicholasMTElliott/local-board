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
estimateBasis: null
workStartedAt: null
workCompletedAt: null
completedSteps: []
routingApprovals: []
created: 2026-05-14T12:34:00-04:00
updated: 2026-05-14T12:34:00-04:00
```

`branch` is the git branch associated with task, bug, review, test, or documentation work. Prefer `local-board start-work <ticket-id>` over editing it manually; the command creates or switches branches and records the selected branch.
`estimateBasis` records the ticket ID of the calibration ticket used for `estimate`, or `bootstrap` when no prior calibration ticket of the same type existed. It is null when `estimate` is null. `workStartedAt` is the ISO-8601 timestamp set by `start-work` the first time it is invoked on the ticket; later calls preserve it. `workCompletedAt` is the ISO-8601 timestamp set by `move <id> done` when it is null and `workStartedAt` is already set; direct move-to-done without prior `start-work` leaves both null. Wall-clock actual is `workCompletedAt - workStartedAt`, with pauses such as questions or blocked time intentionally included.
`completedSteps` records deterministic workflow evidence as `<action>:<executor>` tokens. `routingApprovals` records explicit user-approved route deviations such as `review:inline`.

Front matter is canonical. Folder placement is for humans and should match status.
`create` accepts schema-legal initial statuses but warns on stderr when the status action does not match the ticket type's `routing.doneRequires`; correcting an unintended off-map placement remains an explicit `move <id> <status> --override --reason <text>`.

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

`blocked` is for non-ticket blockers. If one ticket waits on another ticket, keep the dependent ticket in its intended ready status and set `blockedBy` with `block <ticket-id> <dependency-id>`.

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
- dependency-blocked tickets are not placed in `status: blocked`;
- ISO-8601 `created`, `updated`, and non-null work timestamp values with timezone offsets or `Z`.

For duplicated standard-section headings, `validate` reports the issue only for tickets whose status is neither `done` nor `archived`; closed history is exempt.

## Rewriting Front Matter

Use the CLI for state changes that affect canonical front matter:

```sh
node ./bin/local-board.js move T20260514T1234Z implementing
node ./bin/local-board.js move T20260514T1234Z done --json
node ./bin/local-board.js set T20260514T1234Z priority P1
node ./bin/local-board.js begin-step T20260514T1234Z --json
node ./bin/local-board.js complete-step T20260514T1234Z review --executor codex-task:read-only --evidence "Review findings recorded."
node ./bin/local-board.js approve-inline T20260514T1234Z review --reason "User approved fallback."
node ./bin/local-board.js section T20260514T1234Z "A clear requirement." --section Requirement
node ./bin/local-board.js section T20260514T1234Z --file /tmp/design.md --section "Technical Design"
node ./bin/local-board.js update-field T20260514T1234Z blockedBy "[T20260514T1200Z]"
node ./bin/local-board.js link-parent S20260514T1235Z E20260514T1234Z
node ./bin/local-board.js block T20260514T1236Z T20260514T1235Z
```

`move` updates `status`, rewrites `updated`, and relocates the file to the mapped status folder. With `git.autoMerge: true`, `move <ticket-id> done` also commits planning-only closeout changes and merges the recorded ticket branch into the configured or detected default branch. It refuses uncommitted non-planning changes.
When the target is `done`, `move` stamps `workCompletedAt` only if it is null and `workStartedAt` is already set. It does not overwrite an existing completion timestamp.

With `retention.archiveOnMoveDone: true`, `move <ticket-id> done` also moves older done tickets to `archived`. Archived tickets remain closed for dependency checks and are retained in `plans/tickets/archive/`.

`set` and `update-field` are aliases for front matter updates. `id`, `type`, `created`, and `updated` are managed fields and cannot be set directly.

The writer emits required fields in canonical order and preserves the Markdown body. `section` replaces one Markdown section body by heading name. Inline text is supported for short updates; `section --file <path>` is preferred for multi-line Markdown. Create the `--file` target with the Write tool, never with shell redirection (`echo`, heredoc, `Set-Content`, `Out-File`). The payload is the section body only; do not include the section's own `## Heading`, and fence any literal top-level `## ` sample lines.

`link-parent` and `link-child` update reciprocal `parent`/`children` fields. `block` and `unblock` update reciprocal `blockedBy`/`blocks` fields.
`block` does not move ticket status. Dependency-blocked tickets stay in their ready status and become eligible automatically when dependencies close.

`complete-step` updates `completedSteps` and appends a run-log entry. Under strict routing, the executor must match `plans/local-board.config.jsonc` unless `approve-inline` has recorded an explicit approval.
