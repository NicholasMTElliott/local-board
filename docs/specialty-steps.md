# Specialty Steps

Specialty steps are optional, pattern-matched review passes that the orchestrator runs after a mandatory stage action completes. A gate-check classifier looks at the work just finished and recommends zero or more entries from a per-stage catalog. Each recommended entry resolves to a prompt and an agent route; the orchestrator runs them and records evidence the same way mandatory actions do, but specialty evidence never gates closeout.

## Why specialty reviews

Manual triage of "does this change need a security review" or "should UX look at this" is unreliable. Reviewers either over-fire on every ticket or get forgotten entirely. A small classifier with a fixed catalog turns the decision into a deterministic CLI handoff: gate-check returns a list, the orchestrator runs that list, and the ticket history shows which specialties fired.

## The gate-check and specialty-run pattern

The pattern is a two-CLI loop attached to each stage that supports specialty review:

```text
mandatory action -> gate-check --stage <stage> -> for each requested name:
    specialty-run <name> -> dispatch prompt -> complete-step <name> -> next status
```

1. The orchestrator completes the mandatory action (`design`, `implement`, or `test`) and records evidence with `complete-step`.
2. The orchestrator runs `local-board gate-check <ticket-id> --stage <stage> --json`. If the catalog is empty, the command self-certifies the stage with a `gate:<stage>:skipped-empty-catalog` token, returns `skip: true` with `recorded` set to that token, and there is no agent dispatch.
3. If the catalog is non-empty, the orchestrator dispatches the returned `prompt` through the configured gate agent, then records that consultation with `local-board gate-complete <ticket-id> --stage <stage> --executor <executor>`. The gate agent returns strict JSON: `{ "requestedSteps": ["security_audit", ...] }`. An empty array is the normal case.
4. For each requested name, the orchestrator runs `local-board specialty-run <ticket-id> <name> --json`, dispatches the resolved `prompt` through the resolved `agent` with the resolved `model`/`effort` pins, parses the specialty agent's `verdict` (`PASS` / `CONCERNS` / `FAIL`) plus `findings`, and records evidence with `local-board complete-step <ticket-id> <name> --executor <agent> --model <model> --evidence "<VERDICT>: <summary>"` (omit `--model` when null).
5. After every requested specialty completes, the orchestrator advances the ticket using `move`.

`gate-check` and `specialty-run` do not invoke agents. `gate-check` mutates only for the empty-catalog self-certification path; non-empty consultations are recorded by `gate-complete`, and specialty evidence is recorded by `complete-step`.

When `routing.requireGateConsultation` is true, `move` refuses the forward transition out of `design`, `implement`, or `test` until the matching `gate:<stage>:...` token exists. Those gate tokens are consultation evidence only; they are invisible to normal routing evidence and `doneRequires`.

## Stages where specialty steps run

Gate-check supports three stages:

- `design`: after the design action records evidence and before the move to `ready_for_implementation`.
- `implement`: after the implement action records evidence and before the move to `ready_for_review`.
- `test`: after the test action records evidence and before the move to `ready_for_docs`.

`decompose` and `document` are intentionally excluded. Specialty steps target the work product, not the planning or wrap-up surface.

`specialty-run` derives the stage from ticket status, so the orchestrator never passes `--stage` to it.

## v1 Catalog

The v1 catalog is shipped in [`plans/local-board.config.jsonc`](../plans/local-board.config.jsonc) under `optionalSteps`.

| Stage | Name | Prompt | What it produces |
|---|---|---|---|
| design | `security_threat_model` | [`plans/prompts/optional-steps/design/security_threat_model.md`](../plans/prompts/optional-steps/design/security_threat_model.md) | STRIDE-style threat model findings JSON. |
| design | `ui_component_review` | [`plans/prompts/optional-steps/design/ui_component_review.md`](../plans/prompts/optional-steps/design/ui_component_review.md) | Component-level design findings (API, state, accessibility, design-system fit). |
| design | `ux_interaction_review` | [`plans/prompts/optional-steps/design/ux_interaction_review.md`](../plans/prompts/optional-steps/design/ux_interaction_review.md) | Flow-level findings (edge states, feedback, keyboard, workflow ergonomics). |
| implement | `security_audit` | [`plans/prompts/optional-steps/impl/security_audit.md`](../plans/prompts/optional-steps/impl/security_audit.md) | Code-level security findings, severity-ranked. |
| implement | `ui_visual_review` | [`plans/prompts/optional-steps/impl/ui_visual_review.md`](../plans/prompts/optional-steps/impl/ui_visual_review.md) | Visual review findings (layout, responsive, a11y markup, regressions). |

The `test` catalog is intentionally empty in v1. `gate-check --stage test` self-certifies the empty catalog and returns no requested specialties until entries are added.

The `init` scaffold ships `security_threat_model` and `security_audit` pinned to `gpt-5.6-sol`/`xhigh` (an `agent` profile on the catalog entry in `plans/local-board.config.jsonc`). If your plan lacks GPT-5.6, delete the entry's `model`/`effort` keys (falls back to the plan's default model) or reroute the step; Codex validates the model server-side.

## Trigger guidance

Concrete examples mapping work types to recommended specialties:

- New login form or token-handling code: gate recommends `security_threat_model` at design and `security_audit` at implement.
- New modal or major visual component: gate recommends `ui_component_review` at design and `ui_visual_review` at implement.
- New multi-step wizard or onboarding flow: gate recommends `ux_interaction_review` at design.
- External API integration with credentials: gate recommends `security_threat_model` at design and `security_audit` at implement.
- Pure backend refactor with no user-facing or security surface: gate returns an empty array.
- Change that mutates `~/.claude/settings.json` permission grants, allow rules, or hooks entries: gate recommends `security_audit` at implement.

The classifier prompt at [`plans/prompts/steps/gate-check.md`](../plans/prompts/steps/gate-check.md) defines the decision contract. The `triggers` text in each `optionalSteps` entry is the human-readable rule the classifier pattern-matches against.

**Write triggers as consequence surfaces, not technique keywords.** A `triggers` string should name *what a change can grant, leak, or execute* — concrete nouns a classifier can match — not the coding technique involved. "Input validation" is a technique and over-fires on harmless internal parsing; "settings files that gate tool execution" and "validation of untrusted cross-trust-boundary input" are consequence surfaces that fire only when something can actually be granted or leaked. When a trigger both over-fires and misses (as `security_audit` did on internal flag parsing vs. `settings.json` permission grants), rewrite it around the surface and add an explicit negative carve-out for the benign look-alike.

## Adding a new specialty step

Two steps:

1. Add an entry under the appropriate stage in `optionalSteps` in [`plans/local-board.config.jsonc`](../plans/local-board.config.jsonc). Required fields: `name` (lowercase snake_case, unique across all stages, never a mandatory action name), `prompt` (repo-relative path), `triggers` (human-readable rule). Optional: `agent` to override the default `inline` route — either a bare route string (`claude-subagent:<agent-name>` or `codex-task:<mode>`) or a `{ route, model?, effort? }` profile object to also pin a per-step model and/or reasoning effort. The profile object uses the same grammar as `agents.<action>` (see [docs/CodexSupport.md](CodexSupport.md)) except it must NOT carry a `prompt` field — the entry's own top-level `prompt` above is used instead.
2. Create the prompt file at the configured path. Follow the verdict + findings contract used by the v1 catalog: prompts end with a strict JSON output block shaped `{ "verdict": "PASS" | "CONCERNS" | "FAIL", "findings": [...] }`.

The next gate-check run that targets the entry's stage will see the new entry in its catalog automatically. No source code changes are required.

## Output contract

Specialty agents return strict JSON shaped:

```json
{
  "verdict": "CONCERNS",
  "findings": [
    {
      "severity": "High",
      "summary": "Session cookie missing Secure flag",
      "location": "src/auth/session.js:42",
      "recommendation": "Set Secure and HttpOnly on the session cookie."
    }
  ]
}
```

The orchestrator parses `verdict` and produces a short evidence summary for `complete-step`. The full findings JSON can be attached to a ticket section if the project wants a richer trail; the canonical record is the `completedSteps` entry.

## Evidence recording

`complete-step <ticket-id> <step-name> --executor <executor> [--model <model>] --evidence "<text>"` writes a `<step-name>:<executor>` (or `<step-name>:<executor>@<model>` when `--model` is given) entry into the ticket's `completedSteps` front-matter list. Example:

```sh
local-board complete-step T20260516T1554Z security_audit --executor inline --evidence "CONCERNS: 1 high-severity finding on cookie flags"
```

The resulting `completedSteps` entry is `security_audit:inline`. Strict routing matches the `<step-name>:<executor>` pair against the resolved route from `specialty-run`. Use the `agent` value returned by `specialty-run` (or `inline` when no override applies) verbatim.

When a specialty's `agent` is a `{ route, model }` profile, also pass `--model <model>` (the value `specialty-run` returned): `complete-step` composes `<step-name>:<route>@<model>` server-side and enforces the pin exactly like a mandatory action — `@codex-default` satisfies any pinned model (a Codex-translated run), a mismatched or missing model is refused with an actionable message, and an approved deviation via `approve-inline --executor <route>@<model>` is still honored. `effort` is a dispatch hint only; it is never part of the evidence token.

`specialty-run`'s JSON payload names these fields `agent`/`model`/`effort` (not `configuredAgent`/`configuredModel`/`configuredEffort` like `begin-step`) — `specialty-run` is a pure resolver with no configured-vs-actual ledger duality, so the plain names are used, and the wire contract predates the profile form.

## Interaction with doneRequires

`routing.doneRequires` only lists mandatory actions (`design`, `implement`, `review`, `test`, `document` for tasks and bugs; `decompose` for epics and stories). Specialty step names never appear in `doneRequires` and never gate `move <ticket-id> done`.

`local-board validate` and `move ... done` both pass on tickets that ran zero specialties. If a specialty did run, its `<step-name>:<executor>` evidence is preserved in `completedSteps` for traceability but is not re-checked at closeout.

Strict routing still applies while the specialty runs. A specialty with a non-inline `agent` override must record matching evidence or an explicit `approve-inline`. Specialties are exempt from `doneRequires`, not from routing strictness.

## Forward links

- [SKILL.md](../SKILL.md) - orchestrator runbook section "Specialty Steps".
- [plans/local-board.config.jsonc](../plans/local-board.config.jsonc) - v1 catalog and per-entry agent overrides.
- [plans/prompts/steps/gate-check.md](../plans/prompts/steps/gate-check.md) - classifier prompt and decision contract.
- [plans/prompts/optional-steps/](../plans/prompts/optional-steps/) - shipped specialty prompts.
- [docs/Workflow.md](Workflow.md) - lifecycle context for the stages that support specialty review.

## Out of scope (future)

- Porting the remaining 19 specialty prompts from the task-board project.
- Auto-rerunning specialty steps after a failed review verdict.
- Per-ticket overrides that force or suppress a specific specialty regardless of the classifier.
- Specialty support for `decompose` or `document` stages.

## Related stories and tickets

- Parent story: [S20260516T1538Z](../plans/tickets/done/S20260516T1538Z_conditional-specialty-review-steps-security-ui-ux.md) - Conditional specialty review steps (security, UI, UX).
- [T20260516T1550Z](../plans/tickets/done/T20260516T1550Z_add-optionalsteps-config-block.md) - optionalSteps config block.
- [T20260516T1551Z](../plans/tickets/done/T20260516T1551Z_add-gate-check-prompt-and-cli-command.md) - gate-check prompt and CLI.
- [T20260516T1552Z](../plans/tickets/done/T20260516T1552Z_add-specialty-run-dispatcher-cli.md) - specialty-run dispatcher CLI.
- [T20260516T1553Z](../plans/tickets/done/T20260516T1553Z_port-initial-specialty-prompts-from-task-board.md) - port initial specialty prompts.
- Sibling story: [S20260516T1537Z](../plans/tickets/done/S20260516T1537Z_relative-sized-estimation-with-calibration-and-actuals.md) - Relative-sized estimation (separate feature in the same epic).
