---
id: T20260516T1545Z
type: task
status: backlog
priority: P2
parent: S20260516T1537Z
children: []
blockedBy: [T20260516T1543Z]
blocks: [T20260516T1548Z, T20260516T1549Z]
branch: null
estimate: null
created: 2026-05-16T15:45:41Z
updated: 2026-05-16T15:45:30Z
completedSteps: []
routingApprovals: []
---
# CLI: local-board estimate <ticket-id> <points> command

## Requirement

Add `local-board estimate <ticket-id> <points>` command. Depends on the schema task (T20260516T1543Z).

Behavior:
- Validates `<points>` against the configured `estimation.scale` (default `[1, 2, 4, 8]`). Reject values not in scale.
- Records the points as `estimate` (numeric).
- Records `estimateBasis` from a `--basis <ticket-id-or-bootstrap>` flag. If `--basis` is omitted, invoke the calibration suggest logic (T20260516T1546Z) to pick one.
- Refuses to overwrite an existing non-null `estimate` unless `--force` is passed.
- Exits non-zero with a clear message on validation failure (out-of-scale, unknown basis ticket, missing ticket).

Out of scope: enforcement at `complete-step design` (separate task), prompts (separate task).

## Acceptance Criteria

- `local-board estimate <id> <n>` writes the estimate and basis when valid.
- Points outside the configured scale are rejected with a non-zero exit and a message that lists allowed values.
- `--basis <ticket-id>` is recorded verbatim in `estimateBasis`.
- `--basis bootstrap` is accepted and recorded literally as `bootstrap`.
- Omitting `--basis` calls the calibration suggester to pick a basis automatically.
- Running the command on a ticket with a non-null `estimate` fails unless `--force` is passed.
- `--force` overwrites both `estimate` and `estimateBasis`.
- Tests cover: happy path, scale rejection, overwrite refusal, `--force` overwrite, explicit `--basis bootstrap`, and auto-pick branch.

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
