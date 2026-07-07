---
id: S20260516T1537Z
type: story
status: archived
priority: P2
parent: null
children: [T20260516T1543Z, T20260516T1544Z, T20260516T1545Z, T20260516T1546Z, T20260516T1547Z, T20260516T1548Z, T20260516T1549Z]
blockedBy: []
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-05-16T15:37:23Z
updated: 2026-07-07T14:07:41Z
completedSteps: [decompose:claude-subagent:local-board-decomposer]
routingApprovals: []
---
# Relative-sized estimation with calibration and actuals

## Requirement

Add relative-sized estimation to local-board. After the design step of a task or bug, an estimator assigns story points relative to a calibration ticket of the same type. Wall-clock work time is captured automatically from `start-work` to `move done`, including any time the ticket spends in `questions` or `blocked`. Calibration tickets are chosen automatically from prior done work; the first ticket ever sized has no calibration and is anchored at 4.

Ported from the older task-board project's Estimator role and `estimation` config block. The two intentional divergences from task-board: (1) calibration is auto-picked from history rather than hardcoded in config, and (2) actual time is wall-clock on the ticket, not aggregated agent-run timestamps in a database.

## Acceptance Criteria

- Ticket front matter has `estimateBasis`, `workStartedAt`, and `workCompletedAt` fields, all nullable. `estimate` already exists and remains numeric.
- `start-work` sets `workStartedAt` to the current ISO-8601 timestamp on first invocation per ticket. Subsequent `start-work` calls do not overwrite it.
- `move <ticket> done` sets `workCompletedAt` to the current ISO-8601 timestamp. The autoMerge closeout path is also covered.
- A new `local-board estimate <ticket-id> <points>` command writes the estimate, validates it against the configured scale, and records `estimateBasis` (the calibration ticket ID used, or the literal `bootstrap`). Refuses to overwrite an existing non-null estimate without `--force`.
- A new `local-board calibration suggest <ticket-id>` command returns the recommended calibration ticket ID for the given ticket. The pool is filtered to done tickets of the **same type** as the target (tasks calibrate against tasks; bugs against bugs). Algorithm: pick the ticket whose `estimate` is closest to the median estimate in the pool; tie-break by most-recent `workCompletedAt`. Empty pool returns the sentinel `bootstrap`.
- A new `plans/prompts/roles/estimator.md` and `plans/prompts/steps/estimate.md` exist and follow the existing prompt conventions. The estimator prompt branches: if calibration is `bootstrap`, instruct the agent to size the ticket as if it were a 4 on the configured scale and note that this ticket will become the calibration anchor for its type.
- `plans/local-board.config.jsonc` gains an `estimation` block with `enabled`, `scale` (default `[1, 2, 4, 8]`), `bootstrapDefault` (default `4`), `splitThreshold` (default `16`), and `runAfter` (default `design`).
- When `estimation.enabled` is true and the ticket type is task or bug, `complete-step design` refuses unless the ticket has a non-null `estimate`. Stories and epics are exempt.
- `validate` accepts the new fields and surfaces no errors when they are null or correctly formatted.
- `state-report --json` exposes `workStartedAt`, `workCompletedAt`, `estimate`, and `estimateBasis` per ticket so downstream tooling can compute estimate-vs-actual accuracy.
- `npm test` covers: new field parsing/serialization, calibration auto-pick for both empty and populated pools, type-separated pools (a bug never calibrates against a task), the bootstrap branch, `start-work` idempotence on `workStartedAt`, `move done` setting `workCompletedAt`, and the `complete-step design` enforcement gate.

## Related Tickets

- S20260516T1538Z (conditional specialty review steps) — independent feature port from task-board, can ship in either order.
- S20260516T1539Z (structured comment markers) — independent, but specialty steps and estimation both benefit from structured comment markers if that lands first.

Source material in the sibling `task-board` project:
- `prompts/estimator.md` — system prompt for the estimator role.
- `prompts/states/steps/estimate_ticket.md` — step prompt that injects calibration context.
- `workflow.github.json` — `estimation` config block (note: task-board hardcodes calibration; we auto-pick).
- `lambda/src/TaskBoard.Worker/Processing/AgentRunner.cs` — calibration fetch and template injection logic.

## Technical Design

### Schema

Three new front-matter fields. All nullable; all added to the canonical field list in `src/tickets.js`:

```yaml
estimate: 4                               # already reserved; numeric, validated against scale
estimateBasis: T20260514T2228Z            # calibration ticket ID, or literal "bootstrap"
workStartedAt: 2026-05-16T15:37:00Z        # set by start-work, immutable thereafter
workCompletedAt: 2026-05-18T11:02:00Z      # set by move <id> done
```

Actual wall-clock is derived: `workCompletedAt - workStartedAt`. No separate `actualHours` field. Time spent in `questions` or `blocked` is included by design — the goal is calendar-time honesty, not active-work accounting.

### Calibration auto-pick

Pool = done tickets where `type` matches the target ticket's type, `estimate` is non-null, and both `workStartedAt`/`workCompletedAt` are set. Same-type filtering keeps the pools honest: a 1-point bug fix is usually a very different shape from a 1-point task.

Pick: ticket whose `estimate` is closest to the median of the pool (anchor on typical work, not outliers). Tie-break: most-recent `workCompletedAt`. If the pool is empty, return the sentinel string `bootstrap`.

The CLI command `local-board calibration suggest <ticket-id>` returns the ID. The estimator step prompt receives the calibration ticket's full body when the ID is real, or a bootstrap branch when the ID is `bootstrap`.

### Pipeline placement

No new status. The estimate runs as the final action of the `design` step. Two options were considered:

1. Make `design` produce both the design and the estimate. Single agent run.
2. Add an `estimate` action that runs after `design` and before `ready_for_implementation`.

Going with option 1 to keep the pipeline visually unchanged. The design step prompt gains a final instruction: "after writing the design, call `local-board calibration suggest <ticket-id>`, then call the estimator role/prompt with the returned calibration ID, then call `local-board estimate <ticket-id> <points>`."

Enforcement: `complete-step design` reads the ticket. If `estimation.enabled` is true and the type is `task` or `bug` and `estimate` is null, the command exits non-zero with an explanatory message. Stories and epics are unaffected (they get rolled-up estimates from their children, not direct estimates — a follow-up story can add rollup).

### Wall-clock plumbing

- `start-work` (in `src/tickets.js`): if `workStartedAt` is null, set it to the current ISO timestamp. Otherwise leave it alone. This means returning to a ticket after a question doesn't reset the clock.
- `moveTicket` to status `done`: if `workCompletedAt` is null, set it. (Subsequent moves out of done, e.g. reopening, do not clear it — re-opening is rare and the existing clock is the honest one.)
- `archiveDoneTickets` does not touch these fields.

### Config

Add to `plans/local-board.config.jsonc`:

```jsonc
"estimation": {
  "enabled": true,
  "scale": [1, 2, 4, 8],
  "bootstrapDefault": 4,
  "splitThreshold": 16
}
```

`splitThreshold` is informational — when the estimator returns a value at or above it, the prompt instructs the agent to flag the ticket for decomposition rather than implementation.

### Prompts to port

- `plans/prompts/roles/estimator.md` — adapted from `task-board/prompts/estimator.md`. Drop the section-update contract (we don't have managed sections; the comment-markers story addresses a similar need separately). Keep the relative-sizing principles and the powers-of-2 guidance.
- `plans/prompts/steps/estimate.md` — short step prompt: read the ticket, read the calibration ticket if non-`bootstrap`, compare across scope/complexity/risk/unknowns, output a single number on the configured scale, then call `local-board estimate <id> <n>`.

### Out of scope (future stories)

- Story/epic estimate rollup (sum of child estimates). Worth filing once the leaf-level estimation lands and we have data.
- Estimate-vs-actual reporting dashboard. The data will be in front matter; any tooling can read it.
- Per-author calibration pools (if estimates start diverging by who did the work).
- Pausing the clock for `blocked` or `questions` time — the user has explicitly confirmed this is not wanted.

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-05-16T15:46:12Z: Completed decompose via claude-subagent:local-board-decomposer: Decomposed into 7 child tasks (T20260516T1543Z-T20260516T1549Z) covering schema, wall-clock plumbing, estimate CLI, calibration CLI, config block, design-step enforcement, and prompts. Dependencies linked via blockedBy; validate clean.
