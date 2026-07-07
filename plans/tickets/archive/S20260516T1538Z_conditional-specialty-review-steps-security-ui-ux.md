---
id: S20260516T1538Z
type: story
status: archived
priority: P2
parent: null
children: [T20260516T1550Z, T20260516T1551Z, T20260516T1552Z, T20260516T1553Z, T20260516T1554Z]
blockedBy: []
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-05-16T15:38:28Z
updated: 2026-07-07T14:07:41Z
completedSteps: [decompose:claude-subagent:local-board-decomposer]
routingApprovals: []
---
# Conditional specialty review steps (security, UI, UX)

## Requirement

Add optional specialty review steps to local-board: security review, UI visual review, and UX/interaction design review. These steps are not part of every ticket's pipeline; they are recommended per-run by a gate-check agent based on what the work actually touches (auth code, UI components, new user flows, etc.).

Ported from the older task-board project's gate-checker pattern, where after the mandatory steps in a state pass, the gate emits a `requestedSteps` array picking from a per-state catalog of optional reviews. We will start with a small catalog (3–5 specialties at most) rather than porting all 24 of task-board's specialty prompts.

## Acceptance Criteria

- `plans/local-board.config.jsonc` gains an `optionalSteps` block. Keys are stage names (`design`, `implement`, `test`). Each value is an array of `{ name, prompt, triggers, agent? }` entries. The `triggers` field is human-readable guidance used by the gate-checker prompt to decide relevance.
- A new `plans/prompts/steps/gate-check.md` exists. It instructs the agent to read the current ticket and the diff (or design draft, for design-stage gates), then return a JSON list of specialty step names from the relevant stage catalog. An empty list is the common case and means "no specialty review warranted".
- A new CLI command `local-board gate-check <ticket-id> --stage <stage> --json` returns the structured request: `{ requestedSteps: ["security_audit", ...] }`. The orchestrator skill invokes this between mandatory and specialty work.
- A new CLI command `local-board specialty-run <ticket-id> <step-name>` looks up the step in the catalog for the ticket's current stage, runs the prompt via the configured agent (or inline if no agent is configured), and records evidence as `<step-name>:<executor>` in `completedSteps`. This piggybacks on the existing `complete-step` evidence mechanism — no new schema.
- The orchestrator flow is updated (skill prompt + step prompts) so that after a stage's mandatory work passes review, the orchestrator runs `gate-check`, dispatches each requested specialty step, and only then advances the ticket.
- Initial catalog ships with: `security_threat_model` and `ui_component_review` and `ux_interaction_review` (design stage); `security_audit` and `ui_visual_review` (implement stage). All ported from `task-board/prompts/optional-steps/`.
- `validate` does not require any specialty evidence. The catalog is advisory — specialty steps are optional by definition. Strict routing remains unchanged for mandatory actions.
- Specialty step names appear in `completedSteps` exactly like mandatory action names. State reports surface them. Grep-friendliness is preserved (e.g., `security_audit:claude-subagent:local-board-reviewer`).
- `npm test` covers: gate-check command parses ticket and returns a JSON shape; specialty-run records evidence with the correct format; specialty step names that don't exist in the catalog are rejected; the orchestrator's mandatory routing requirements ignore specialty entries (a `security_audit` evidence does not satisfy `review`).

## Related Tickets

- S20260516T1537Z (estimation) — independent.
- S20260516T1539Z (structured comment markers) — specialty step results are good first-customer data for marker-tagged comments; ship comment markers first if both are queued.

Source material in the sibling `task-board` project:
- `prompts/gate_checker.md` — gate-check role prompt, including the `requestedSteps` contract.
- `prompts/optional-steps/design/` and `prompts/optional-steps/impl/` and `prompts/optional-steps/test/` — 24 specialty prompts to draw from; we only port the 5 listed in AC for v1.
- `workflow.github.json` — per-state `optionalSteps` arrays (lines ~46–132 design, ~247–343 impl).
- `lambda/src/TaskBoard.Worker/Processing/AgentRunner.cs` — `ExecuteOptionalStepsAsync` orchestration logic (validates requested step against catalog, executes, applies section updates, posts marker comment).

## Technical Design

### Config shape

```jsonc
"optionalSteps": {
  "design": [
    {
      "name": "security_threat_model",
      "prompt": "plans/prompts/optional-steps/design/security_threat_model.md",
      "triggers": "Auth, authorization, cryptography, external API integrations, PII handling, new attack surface."
    },
    {
      "name": "ui_component_review",
      "prompt": "plans/prompts/optional-steps/design/ui_component_review.md",
      "triggers": "New or substantially modified user-facing UI components, layout changes, design-system additions."
    },
    {
      "name": "ux_interaction_review",
      "prompt": "plans/prompts/optional-steps/design/ux_interaction_review.md",
      "triggers": "New user-facing flows, interaction patterns, or significant changes to existing flows."
    }
  ],
  "implement": [
    {
      "name": "security_audit",
      "prompt": "plans/prompts/optional-steps/impl/security_audit.md",
      "triggers": "Changes to auth code, input validation, external API calls, credential handling."
    },
    {
      "name": "ui_visual_review",
      "prompt": "plans/prompts/optional-steps/impl/ui_visual_review.md",
      "triggers": "Visible UI changes — styles, layouts, components, accessibility-relevant markup."
    }
  ]
}
```

Optional per-entry `agent` field overrides the global routing. Default routing: inline (orchestrator runs the prompt directly via the active model).

### Gate-check action

The gate-check agent's job is pattern matching, not quality evaluation. Given a ticket and the work just completed, it picks zero or more specialty names from the current stage's catalog. It returns:

```json
{ "requestedSteps": ["security_audit", "ui_visual_review"] }
```

Empty list means "no specialty review needed for this stage". This is the common case for routine internal refactors. The CLI returns the same JSON. The orchestrator skill loops over the returned names and dispatches each one.

The gate-check runs after `design`, `implement`, and `test`. Not after `decompose` or `document`.

### Specialty-run dispatcher

`local-board specialty-run <ticket-id> <step-name>`:
1. Look up the ticket's current stage (from status: `designing`/`ready_for_design` → design; etc.).
2. Look up `step-name` in the stage's catalog. Reject if unknown.
3. Resolve the prompt path and agent route.
4. Print the resolved prompt path, agent route, and ticket context as JSON. The skill consumes this and invokes the agent (same pattern as how the existing action prompts get dispatched today).
5. The agent's completion is recorded by the existing `complete-step` command with the specialty name as the action: `local-board complete-step <id> security_audit --executor claude-subagent:local-board-reviewer --evidence "..."`.

This is a thin layer — most of the runtime lives in the orchestrator skill, the same way the existing actions do.

### Evidence and routing

Specialty step evidence lives in `completedSteps` alongside mandatory action evidence. Strict routing in `complete-step` already permits arbitrary action names; only the `doneRequires` list in routing config gates closeout, and that list does not include specialty steps. So a ticket can close `done` without any specialty work, but if specialty work ran, its evidence is preserved in the history.

If `routing.strict` is true, the existing inline-completion rules apply to specialty steps too: an agent-routed specialty needs evidence whose executor matches, or an `approve-inline` record. No special-case logic.

### Initial prompts to port

Port verbatim from `task-board/prompts/optional-steps/`, then trim each to the local-board prompt conventions (no `section_update` contract, no managed sections — the comment-markers story addresses durable per-step comments separately). The five prompts in v1: `security_threat_model.md`, `ui_component_review.md`, `ux_interaction_review.md`, `security_audit.md`, `ui_visual_review.md`.

### Out of scope (future)

- The remaining ~19 specialty prompts from task-board (api_design_review, performance_review, accessibility_audit, observability_design_review, etc.). Easy to add later — they're config + prompt files, no schema changes.
- An "auto-rerun specialty on failed review" loop. v1 is single-pass.
- Specialty-specific routing overrides at the per-ticket level (e.g. "always run security_audit on this ticket"). Worth considering once we see whether the gate-check classifier is reliable.

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-05-16T15:49:27Z: Completed decompose via claude-subagent:local-board-decomposer: Decomposed into 5 child tasks (T20260516T1550Z-T20260516T1554Z) covering config, gate-check, specialty-run dispatcher, prompt port, and orchestrator/docs. Dependencies linked via blockedBy; validate clean.
