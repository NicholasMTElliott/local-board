---
id: T20260710T1532Z
type: task
status: ready_for_design
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260710T1532Z-config-ordered-fallbackmodels-on-agent-profiles-for-pinned-model-outages
estimate: 4
estimateBasis: T20260710T1223Z
workStartedAt: 2026-07-10T15:40:30Z
workCompletedAt: null
created: 2026-07-10T15:32:22Z
updated: 2026-07-10T15:48:02Z
completedSteps: []
routingApprovals: []
---
# config: ordered fallbackModels on agent profiles for pinned-model outages

## Requirement

Retro item from the 2026-07-10 parallel run. gpt-5.6-terra returned "Selected model is at capacity" twice mid-run. With agents.review pinned to gpt-5.6-terra under strict routing, there was no sanctioned alternative: recording a different model is refused by the pin, and approve-inline requires user interaction. The orchestrator retried and got lucky; a capacity outage lasting hours would have stalled every review on the board.

## Scope

1. Extend agent profiles with an optional ordered fallback list: { route, model, effort?, fallbackModels?: [ ... ] } (config schema validation mirrors model's shape rule; rejected on inline; empty list rejected).
2. begin-step surfaces configuredFallbackModels; the codexDispatch translation carries it (sanitized per model rules).
3. Strict-routing evidence: modelSatisfies accepts the pinned model OR any configured fallback for that action (the recorded model is the model actually used); done-time validation unchanged (route-only, back-compat).
4. Skill text (Delegation section): on a capacity/unavailability failure of the pinned model, the orchestrator retries once, then walks fallbackModels in order, recording the actual model in evidence; effort carries over unchanged unless the fallback entry overrides it (design decides whether fallback entries may be { model, effort } objects).
5. Docs (docs/CodexSupport.md Models/Effort sections) and tests (schema accept/reject, begin-step surface, modelSatisfies fallback acceptance, evidence recording with a fallback model).

## Acceptance criteria

- { "route": "codex-task:read-only", "model": "gpt-5.6-terra", "effort": "high", "fallbackModels": ["gpt-5.5"] } validates; complete-step review --model gpt-5.5 is accepted under strict routing; --model gpt-4o (unlisted) is refused.
- Boards without fallbackModels behave byte-identically.
- npm run check and node --test pass.

## Non-goals

- No automatic in-CLI dispatch retry (dispatch remains the orchestrator's job); no fallback for claude-subagent frontmatter models (separate concern).

## Acceptance Criteria

## Related Tickets

## Technical Design

## Summary

Add an optional ordered `fallbackModels` array to agent profiles (both
`agents.<action>` and `optionalSteps[].agent` object-form). It names sanctioned
alternate models to record when the pinned model is unavailable, so strict
routing accepts a fallback model's evidence without an interactive
`approve-inline`. The pin is unchanged; done-time validation stays route-only;
boards without `fallbackModels` behave byte-identically.

## Key decisions

### D1 — Fallback entries are model-id strings, not `{ model, effort }` objects

`fallbackModels` is an array of model-id strings only (e.g. `["gpt-5.5"]`),
validated with the same charset rule as `model`. Justification:

- Evidence tokens are `route@model`; effort never appears in `completedSteps`.
  The strict-routing acceptance predicate only needs a *set of acceptable model
  ids*, so an object form adds grammar with no bearing on what the gate checks.
- The outage scenario is "pinned model at capacity, run an equivalent
  alternative." The pin's `effort` (thoroughness intent) carries over to the
  fallback unchanged; `effort` is shape-validated only and passed through
  verbatim (the server validates support), so carrying `high` onto `gpt-5.5` is
  harmless.
- One grammar to validate/test, mirroring the existing `model` rule exactly.

Consequence for requirement item 4's open question: **fallback entries do NOT
carry a per-entry effort override.** Effort always carries over from the parent
profile. A future ticket can widen the grammar to a `{ model, effort }` union if
a real need appears; string-only is forward-compatible with that (validation can
later accept objects too).

### D2 — `fallbackModels` requires a pinned `model` and a non-`inline` route

Validation (in `normalizeAgentProfile`, the shared authority):

- Must be an array; reject non-array with an actionable message.
- Reject an **empty** array (`[]`) — a fallback list with no members is dead
  config; the operator meant to omit the key.
- Every entry must be a string matching `/^[A-Za-z0-9][A-Za-z0-9._-]*$/` (same
  regex as `model`); reject non-string / bad-charset entries.
- Reject on `route === "inline"` (same message pattern as `model`/`effort`:
  inline cannot pin a model, so it cannot list fallbacks).
- **Reject `fallbackModels` when `model` is absent.** Fallbacks are alternatives
  to a pin; with no pin, `modelForAction` returns `null` and the model gate
  accepts any model, making the list inert. Failing fast avoids silent dead
  config. (This is the one rule that does not have a `model`-field analogue; it
  is justified by the enforcement semantics.)

Duplicates and a fallback equal to the pin are tolerated (harmless);
de-duplication is not required.

### D3 — optionalSteps agent profiles also get `fallbackModels`

Yes. `normalizeOptionalStepAgent` already delegates object-form entries to
`normalizeAgentProfile` (with `allowPrompt: false`), so the grammar and all D2
rules apply for free. The two scaffold security specialties are pinned to
`gpt-5.6-sol/xhigh` — the same capacity-outage exposure as `agents.review`, and
they are enforced by the same `validateStepRouting` model gate via
`profileForAction`. Supporting fallbacks there is symmetric and nearly free:
`resolveOptionalStepAgent` gains a `fallbackModels` field and `specialty-run`
surfaces it. Not supporting them would be an arbitrary asymmetry.

### D4 — Acceptance predicate: pin OR any fallback; `codex-default` wildcard unchanged

Introduce one shared predicate rather than mutating `modelSatisfies` (kept
as-is so its `codex-default` wildcard semantics and its existing exported
callers are untouched):

```
modelAccepted(configuredModel, fallbackModels, executorModel) =
  modelSatisfies(configuredModel, executorModel)                 // pin or codex-default
  || (Array.isArray(fallbackModels) && fallbackModels.includes(executorModel))
```

Used at both enforcement seams so the dispatch-time hook and the evidence gate
agree (see D5). `codex-default` still satisfies any pin (translated Codex runs
unaffected). Done-time re-validation stays route-only (`enforceModel` defaults
false), so back-compat is preserved.

### D5 — check-dispatch must accept fallbacks too (otherwise the hook blocks the fallback dispatch)

Material interaction: `begin-step` stamps the active-step ledger with the
*configured* (pinned) model, and `check-dispatch --model <actual>` compares the
dispatched model against that stamp via `modelSatisfies`. If the orchestrator
dispatches a fallback (`gpt-5.5`), the hook would return `model-mismatch` and
block it — defeating the feature. Fix:

- Extend the `begin-step` active-step stamp (`stampActiveStep` payload in
  `beginStep`) with `fallbackModels: configuredFallbackModels`.
- `checkDispatchForTicket` and `checkDispatchByScan` read `record.fallbackModels`
  and use `modelAccepted(...)` instead of `modelSatisfies(...)`.
- `resolveExpectedStep` (the no-ledger-record fallback path) also surfaces
  `fallbackModels`, so the hook accepts a fallback even when the stamp is
  missing.

## Implementation approach (files and changes)

### src/config.js
- `normalizeAgentProfile`: after the `effort` block, parse `fallbackModels` per
  D1/D2. Add it to the returned `profile` only when present (so profiles without
  it are byte-identical objects). Update the two "must be a { route, model?,
  effort?, prompt? }" grammar strings to include `fallbackModels?`.
- `resolveOptionalStepAgent`: return `fallbackModels: value.fallbackModels ?? null`
  alongside `route`/`model`/`effort` (and `null` in the string-sugar branch).
- `defaultConfigJsonc`: comment-only mention of `fallbackModels` in the
  `agents` block comment (no change to default *values*, so the
  `defaultConfigJsonc matches DEFAULT_CONFIG` guard test — which parses and
  ignores comments — is unaffected). Do NOT add `fallbackModels` to any default
  entry (keeps byte-identical default behavior).

### src/tickets.js
- Add `fallbackModelsForAction(config, action)` =
  `profileForAction(config, action).fallbackModels ?? null`.
- Add exported `modelAccepted(configuredModel, fallbackModels, executorModel)`
  (D4). Keep `modelSatisfies` unchanged.
- `validateStepRouting`: in the `enforceModel` branch, replace the
  `modelSatisfies(configuredModel, executorModel)` acceptance with
  `modelAccepted(configuredModel, fallbackModelsForAction(config, action), executorModel)`.
  Extend the failure message to note that a configured fallback model is also
  accepted.
- `beginStep`: compute `configuredFallbackModels = fallbackModelsForAction(...)`;
  add it to the returned `result` (next to `configuredEffort`) and to the
  `stampActiveStep` payload (D5).
- `resolveExpectedStep`: include `fallbackModels` in its returned shape (D5).

### src/active-steps.js
- `checkDispatchForTicket` / `checkDispatchByScan`: read
  `record.fallbackModels ?? null` (and `resolved.fallbackModels` on the
  no-record path) and gate with `modelAccepted(...)` instead of `modelSatisfies`.

### src/codex-dispatch.js
- `translateCodexDispatch({ ..., fallbackModels })`: sanitize each entry with the
  existing `sanitizeModel` (Claude aliases / empty -> dropped), producing a
  `fallbackModels` array (entries that sanitize to null removed). Include
  `fallbackModels` on every returned branch for shape uniformity (like `effort`):
  `null` when none configured, else the sanitized array (possibly `[]` if all
  entries were Claude aliases, e.g. on a claude-subagent route). Update the
  header contract comment.

### src/cli.js
- `commandBeginStep`: pass `fallbackModels: result.configuredFallbackModels` into
  `translateCodexDispatch`. No new CLI command or flag is added.

### SKILL.md and skills/codex/local-board/SKILL.md (Delegation section, prose only)
- In the model-deviation subsection (after the "pinned model unavailable ->
  approve-inline" paragraph), add the fallback walk:
  > When the action's profile lists `configuredFallbackModels`, a
  > capacity/unavailability failure of the pinned model does not require user
  > approval. Retry the pinned model once; if it still fails, dispatch each
  > `configuredFallbackModels` entry **in order**, keeping the same route and
  > carrying `configuredEffort` over unchanged. On the first success, record
  > `complete-step <id> <action> --executor <configuredAgent> --model <fallbackModel>`
  > — strict routing accepts it because the model is a sanctioned fallback
  > (no `approve-inline`). Only if the pin and every fallback are exhausted, fall
  > back to the approve-inline / `questions` path above.
- Update the `begin-step returns ...` lines to add `configuredFallbackModels`.
- The `## CLI Commands` fenced blocks are **unchanged** (no new command/flag), so
  they stay byte-identical across copies; `test/skill-usage-sync.test.js` is
  unaffected. `SKILL_TEAM.md` / `skills/codex/local-team/SKILL.md` have no
  Delegation section and need no change. No `plans/prompts` files change, so
  `npm run sync-resources` is not required.

### docs/CodexSupport.md
- **Models** section: document `codexDispatch.fallbackModels` (sanitized like
  `model`); note begin-step surfaces `configuredFallbackModels`.
- **Effort** section / route-translation: document that strict routing accepts
  the pinned model OR any configured fallback (evidence records the model that
  actually ran; effort carries over, never recorded), and that
  `optionalSteps[].agent` accepts `fallbackModels` under the same grammar.

## Risks and edge cases

- **Hook regression (highest):** missing the D5 check-dispatch change would let
  the evidence gate accept a fallback while the pre-dispatch hook blocks it.
  Both seams must move together and share `modelAccepted`.
- **Dead-config trap:** `fallbackModels` without a `model` pin silently accepts
  any model. D2 rejects it at load time.
- **Claude-route fallbacks sanitize to empty** in `codexDispatch` (aliases
  dropped). Expected: Codex uses `codex-default` evidence anyway; the logical
  fallback list still gates evidence via `fallbackModelsForAction` (config-side,
  un-sanitized). Only the *dispatch hint* is sanitized.
- **Back-compat:** every new field is added only when present; profiles/results
  without `fallbackModels` serialize identically. Guarded by the byte-identical
  tests below.
- **design-review action** inherits fallback acceptance for free (it routes via
  the agents map through `profileForAction`); acceptable and consistent.

## Test strategy

test/config.test.js
- Accept: `{ route: "codex-task:read-only", model: "gpt-5.6-terra", effort:
  "high", fallbackModels: ["gpt-5.5"] }` normalizes with `fallbackModels`
  preserved.
- Accept: multi-entry ordered list preserved in order.
- Reject: `fallbackModels` not an array.
- Reject: empty array `[]`.
- Reject: non-string entry / bad-charset entry (e.g. `["bad/model"]`, `[3]`).
- Reject: `fallbackModels` on `route: "inline"`.
- Reject: `fallbackModels` without a `model` pin.
- optionalSteps object-form agent accepts `fallbackModels` (same rules via
  `normalizeOptionalStepAgent`); `prompt` still rejected.
- Back-compat: a profile without `fallbackModels` deep-equals today's normalized
  object (no stray key).

test/ (begin-step)
- `configuredFallbackModels` surfaced (array) when configured; `null` when
  absent.
- Active-step stamp carries `fallbackModels`.
- `--harness codex`: `codexDispatch.fallbackModels` present; gpt ids pass
  through; claude aliases sanitize out; `null` when unset.
- Byte-identical begin-step result when `fallbackModels` absent.

test/ (routing / modelSatisfies-fallback)
- complete-step `review --model gpt-5.5` accepted under strict routing when
  `fallbackModels: ["gpt-5.5"]`; token `codex-task:read-only@gpt-5.5` recorded;
  `validate` passes.
- complete-step `review --model gpt-4o` (unlisted) refused with the updated
  message.
- Pinned model still accepted; `codex-default` still accepted.
- Done-time re-validation remains route-only (fallback model evidence passes
  `move done` unchanged).
- `modelAccepted` unit test: pin, codex-default, listed fallback -> true;
  unlisted -> false; `null` fallbacks -> pin/codex-default only.

test/ (check-dispatch)
- `check-dispatch --model <fallback>` returns ok=match when the stamp lists it;
  `--model <unlisted>` returns model-mismatch; pinned/`codex-default` still ok.

test/skill-usage-sync.test.js
- Unchanged and passing (no CLI Commands drift, since no command was added).

Full suite: `npm run check` and `node --test`.

## Open questions

None blocking. One deferred product choice recorded in D1 (per-fallback effort
override) is intentionally out of scope and forward-compatible.

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-10T15:40:30Z: Ensured git branch local-board/T20260710T1532Z-config-ordered-fallbackmodels-on-agent-profiles-for-pinned-model-outages (already-current).
