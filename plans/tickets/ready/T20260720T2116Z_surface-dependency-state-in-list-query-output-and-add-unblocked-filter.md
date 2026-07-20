---
id: T20260720T2116Z
type: task
status: ready_for_design
priority: P1
parent: null
children: []
blockedBy: []
blocks: [T20260720T2118Z]
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-20T21:16:01Z
updated: 2026-07-20T22:01:08Z
completedSteps: []
routingApprovals: []
---
# Surface dependency state in list/query output and add --unblocked filter

## Requirement

### Problem

Eligibility is dependency-aware internally (`isEligibleForConfig` walks `blockedBy`), but no query output exposes dependency state. `actionRecord` (`query-next`, `query-ticket`, `list --ready`) and `ticketRecord` (plain `list`) omit `blockedBy`/`blocks`/`parent`/`children` entirely. A ticket shows `eligible: false` with no visible reason. In a 2026-07-20 `local-team` run against an all-backlog board, the orchestrator grepped 47 ticket files and hand-built the dependency graph to find unblocked work.

### Requirement

1. Add dependency fields to both record shapes (`actionRecord` and `ticketRecord`):
   - `blockedBy`: the ticket's declared dependency ids (as authored);
   - `blockedByOpen`: the subset whose dependency is missing or not in a closed status (`done`/`archived`) — the reason a ticket is ineligible;
   - `parent`, `children`, `blocks`: pass through from front matter.
2. Add an `--unblocked` flag to `list`, composable with the existing `--status <status>` option, so dependency analysis works for ANY status — e.g. `list --status backlog --unblocked --json` (promotion candidates), `list --status questions --unblocked --json`. `--unblocked` keeps tickets whose `blockedByOpen` is empty. Deliberately reuse `--status` rather than adding a hard-coded `--backlog` or new `--state` flag.
3. `--unblocked` combined with `--ready` is either redundant-but-accepted or rejected with a clear message — pick one and test it.
4. Update the `list` usage line and the local-team skill's CLI reference (`SKILL_TEAM.md` + codex mirror) where `list` is documented.

### Acceptance Criteria

- `list --status backlog --unblocked --json` returns exactly the backlog tickets whose every `blockedBy` entry is closed, each record carrying `blockedBy` and `blockedByOpen`.
- `query-ticket <id> --json` for a dependency-blocked ticket shows non-empty `blockedByOpen` explaining `eligible: false`.
- Existing consumers are not broken: added fields are additive; `list --ready` output retains all current fields.
- Tests cover: open vs closed dependencies, missing dependency id (counts as open), `--unblocked` with and without `--status`.
- Full suite (`node --test`) green.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
