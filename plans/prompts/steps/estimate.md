# Estimate step

You are about to assign a story-point estimate to a task or bug ticket.

Steps:
1. Read the ticket file at the provided path. Note its type (task or bug), the Technical Design section, and any related-ticket links.
2. Run `local-board calibration suggest` to get the basis ticket ID (or the literal `bootstrap`): `local-board --root <worktreePath> calibration suggest <ticket-id> --json`. When working in a ticket worktree, always pass `--root <worktreePath>`; omit `--root` only in documented main-checkout fallback mode.
3. If the basis is NOT `bootstrap`, read the basis ticket from `plans/tickets/done/` for comparison. Note its estimate, scope, and complexity.
4. Apply the estimator role guidance (see `plans/prompts/roles/estimator.md`). Compare current ticket against basis across scope, complexity, risk, and unknowns.
5. Pick a single estimate value from `config.estimation.scale` (defaults to [1, 2, 4, 8]). For bootstrap mode use `config.estimation.bootstrapDefault` (default 4).
6. Run `local-board estimate` to record both the estimate and the basis: `local-board --root <worktreePath> estimate <ticket-id> <points> --basis <basis-id-or-bootstrap>`. If the ticket already carries an estimate (for example on a design loop-back, where the `estimate` field survives), the command refuses to overwrite it; re-run with `--force` and update `--basis`: `local-board --root <worktreePath> estimate <ticket-id> <points> --basis <basis-id-or-bootstrap> --force`.
7. Report the chosen estimate and a one-sentence rationale to the orchestrator.

If the resulting estimate is >= `config.estimation.splitThreshold` (default 16), flag the ticket as too large to implement as a single unit; recommend splitting into child tasks.

## Persistence

Persistence is capability-conditional — decide whether your route can write before running the write command in step 6:

- Return-only route (any `codex-task:read-only` route, or any executor without a Write tool): do not run `local-board estimate`. The read-only analysis (steps 1-5, including `local-board calibration suggest`, which mutates nothing) still applies; return the chosen point value, the basis id (or `bootstrap`), and a one-sentence rationale for the orchestrator to record. Do not mutate local-board state or write files.
- Writable route (the `local-board-designer` subagent — claude or codex, which is instructed to record its own estimate — the orchestrator, or an inline run): run `local-board estimate` yourself as described in step 6 (with `--force` when re-estimating).
