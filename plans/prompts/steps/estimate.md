# Estimate step

You are about to assign a story-point estimate to a task or bug ticket.

Steps:
1. Read the ticket file at the provided path. Note its type (task or bug), the Technical Design section, and any related-ticket links.
2. Run `local-board --root <worktreePath> calibration suggest <ticket-id> --json` to get the basis ticket ID (or the literal `bootstrap`). When working in a ticket worktree, always pass `--root <worktreePath>`; omit `--root` only in documented main-checkout fallback mode.
3. If the basis is NOT `bootstrap`, read the basis ticket from `plans/tickets/done/` for comparison. Note its estimate, scope, and complexity.
4. Apply the estimator role guidance (see `plans/prompts/roles/estimator.md`). Compare current ticket against basis across scope, complexity, risk, and unknowns.
5. Pick a single estimate value from `config.estimation.scale` (defaults to [1, 2, 4, 8]). For bootstrap mode use `config.estimation.bootstrapDefault` (default 4).
6. Run `local-board --root <worktreePath> estimate <ticket-id> <points> --basis <basis-id-or-bootstrap>` to record both the estimate and the basis.
7. Report the chosen estimate and a one-sentence rationale to the orchestrator.

If the resulting estimate is >= `config.estimation.splitThreshold` (default 16), flag the ticket as too large to implement as a single unit; recommend splitting into child tasks.
