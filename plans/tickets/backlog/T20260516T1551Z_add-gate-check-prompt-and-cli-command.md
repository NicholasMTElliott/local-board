---
id: T20260516T1551Z
type: task
status: backlog
priority: P2
parent: S20260516T1538Z
children: []
blockedBy: [T20260516T1550Z]
blocks: [T20260516T1554Z]
branch: null
estimate: null
created: 2026-05-16T15:51:06Z
updated: 2026-05-16T15:48:48Z
completedSteps: []
routingApprovals: []
---
# Add gate-check prompt and CLI command

## Requirement

Add `plans/prompts/steps/gate-check.md`. The prompt instructs the agent to read the current ticket file plus the recent diff (or, for design-stage gates, the design draft sections) and emit a strict-JSON object `{ "requestedSteps": ["<step-name>", ...] }`. Empty list is the common case. Steps must be drawn from the catalog for the current stage; the prompt enumerates the available names and their `triggers` text so the agent can pattern-match without quality-judging.

Add a new CLI command `local-board gate-check <ticket-id> --stage <stage> [--json]`. It:
1. Loads the ticket and the catalog from config (depends on task T20260516T1550Z).
2. Validates `--stage` is one of `design`, `implement`, `test`.
3. Prints a JSON payload containing the resolved prompt path, the ticket context (id, title, status, requirement, acceptance criteria, current stage), and the available catalog entries for that stage. The orchestrator skill consumes this and dispatches the gate-check agent.

Wire help text and usage line.

## Acceptance Criteria

- `plans/prompts/steps/gate-check.md` exists and documents the `{ requestedSteps: [...] }` JSON contract, empty-list semantics, and the per-stage catalog lookup rule.
- `local-board gate-check <ticket-id> --stage <stage>` is registered in the CLI help/usage output.
- The command rejects unknown stages with a clear error.
- The command rejects unknown ticket IDs with a clear error.
- With `--json`, the command emits a JSON object containing the prompt path, ticket context, and the catalog entries for the requested stage.
- Without `--json`, a human-readable summary is printed (path + catalog names).
- `npm test` covers: command exits non-zero on invalid stage; JSON payload contains the expected keys and the correct catalog entries for `design` and `implement`; ticket without `optionalSteps` configured returns an empty catalog and the command still succeeds.
- Depends on `optionalSteps` config (T20260516T1550Z).

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
