---
id: T20260516T1552Z
type: task
status: backlog
priority: P2
parent: S20260516T1538Z
children: []
blockedBy: [T20260516T1550Z]
blocks: [T20260516T1554Z]
branch: null
estimate: null
created: 2026-05-16T15:52:10Z
updated: 2026-05-16T15:48:48Z
completedSteps: []
routingApprovals: []
---
# Add specialty-run dispatcher CLI

## Requirement

Add a CLI command `local-board specialty-run <ticket-id> <step-name> [--json]`. It is a thin dispatcher analogous to `begin-step`:
1. Resolve the ticket's current stage from its status (e.g. `designing`/`ready_for_design` -> `design`; `implementing`/`ready_for_implementation` -> `implement`; `testing`/`ready_for_test` -> `test`).
2. Look up `<step-name>` in the `optionalSteps` catalog for that stage (loaded via task T20260516T1550Z's config loader).
3. Reject with a non-zero exit and a clear message if the step is not in the stage's catalog.
4. Resolve the agent route from the entry's `agent` field, defaulting to inline if absent.
5. Print a JSON payload with the resolved prompt path, agent route, step name, and ticket context. The orchestrator skill consumes this and dispatches the agent. Completion is recorded later via the existing `complete-step <id> <step-name> ...` command — no new schema or state writes here.

Wire help text and usage line.

## Acceptance Criteria

- `local-board specialty-run <ticket-id> <step-name>` appears in CLI help/usage.
- Unknown ticket IDs produce a clear error and non-zero exit.
- Unknown step names (not present in the current stage's catalog) produce a clear error and non-zero exit.
- Known step name produces a JSON payload (with `--json`) containing: `name`, `prompt` (absolute or repo-relative path), `agent` (resolved route or `inline`), `stage`, and ticket context (id, title, status).
- Stage resolution maps statuses correctly: design statuses -> `design` catalog; implement statuses -> `implement` catalog; test statuses -> `test` catalog.
- The command does NOT mutate the ticket. Evidence recording remains the responsibility of the existing `complete-step` command.
- `npm test` covers: successful dispatch for a known step in each stage; rejection of unknown step; rejection when the ticket's current status has no associated stage in the catalog.
- Depends on `optionalSteps` config (T20260516T1550Z).

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
