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
updated: 2026-07-10T16:18:32Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
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
**boards without `fallbackModels` behave byte-identically** — every new field is
emitted only when a fallback list is actually configured, never as a `null`
placeholder.

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
de-duplication is not required. Crucially, `normalizeAgentProfile` adds
`profile.fallbackModels` **only when the key is present and valid** — so a
profile without it deep-equals today's normalized object (no stray key). This is
the load-time anchor of the byte-identical guarantee (D6).

### D3 — optionalSteps agent profiles also get `fallbackModels`

Yes. `normalizeOptionalStepAgent` already delegates object-form entries to
`normalizeAgentProfile` (with `allowPrompt: false`), so the grammar and all D2
rules apply for free. The two scaffold security specialties are pinned to
`gpt-5.6-sol/xhigh` — the same capacity-outage exposure as `agents.review`, and
they are the literal motivating scenario in the Requirement. They are enforced
by the same `validateStepRouting` model gate via `profileForAction`. Supporting
fallbacks there is symmetric and nearly free: `resolveOptionalStepAgent` surfaces
`fallbackModels` (only when present) and `specialty-run` threads it (D5). Not
supporting them would be an arbitrary asymmetry and would leave the exact
motivating outage path uncovered.

### D4 — Acceptance predicate: pin OR any fallback; `codex-default` wildcard unchanged

Introduce one shared predicate rather than mutating `modelSatisfies` (kept
as-is so its `codex-default` wildcard semantics and its existing exported
callers are untouched):

```
modelAccepted(configuredModel, fallbackModels, executorModel) =
  modelSatisfies(configuredModel, executorModel)                 // pin or codex-default
  || (Array.isArray(fallbackModels) && fallbackModels.includes(executorModel))
```

Used at **both** enforcement seams so the dispatch-time hook and the evidence
gate agree (D5). `codex-default` still satisfies any pin (translated Codex runs
unaffected). Done-time re-validation stays route-only (`enforceModel` defaults
false), so back-compat is preserved. Because `validateStepRouting` resolves its
model via the action-generic `profileForAction`, this single change also makes
**design-review** and **specialty-step** fallback-model evidence acceptable with
no per-action code — design-review's fallback acceptance is handled entirely
here (its `recordDesignReview` runs `validateStepRouting` with
`enforceModel: true`).

### D5 — Thread fallbacks through EVERY hook-gated dispatch path, not just begin-step

This is the corrected threading decision (design-review FAIL finding 2). The
dispatch hook (`check-dispatch`) compares the dispatched model against a stamp in
the active-steps ledger via `modelSatisfies`; if a stamp on any path omits the
fallback list, a fallback dispatch on that path is rejected as `model-mismatch`,
defeating the feature. There are three ledger-stamping / consultation-payload
paths besides normal begin-step, and I read each to decide precisely:

- `beginStep` (src/tickets.js) — stamps `kind: "action"` with route/model.
- `commandGateCheck` non-empty branch (src/cli.js) — stamps `kind: "gate"` with
  the `agents["gate-check"]` route/model, but only for a `claude-subagent:` gate
  route (the default `claude-subagent:local-board-gatecheck`).
- `commandSpecialtyRun` (src/cli.js) — stamps `kind: "specialty"` with the
  resolved specialty route/model, but only for a `claude-subagent:` route.
- `commandDesignReviewCheck` (src/cli.js) — emits a payload with route/model/
  effort and writes **no** ledger stamp.

**Chosen option: thread fallbacks through every resolver and consultation stamp
(Option A), rather than schema-reject them on those positions (Option B).**
Justification that A is both smaller and safer:

- Option B contradicts the ticket's own scope. The Requirement's motivating
  outage is the `gpt-5.6-sol/xhigh` security specialties (`optionalSteps`), and
  D3/Scope item 1 explicitly extend fallbacks to `optionalSteps[].agent`.
  Rejecting `fallbackModels` on specialty positions would leave the primary use
  case unserved.
- Option B is *more* code, not less: `normalizeAgentProfile` is the shared
  authority for `agents.<action>` and `optionalSteps[].agent` alike, so a
  positional reject would require carving label-specific exceptions into a
  deliberately single-authority function and into `normalizeOptionalStepAgent`.
- Option A is incremental: every path already resolves through the same profile
  authority (`profileForAction` / `resolveOptionalStepAgent`) and every stamp
  already carries route/model. Threading adds one conditionally-present field per
  stamp/payload, all fed by one resolver, and check-dispatch's `modelAccepted`
  read is shared. No new architecture.

Concrete rule (symmetric):

- **Every ledger stamp for a hook-gated (`claude-subagent:`) dispatch** carries
  `fallbackModels` *when configured*: begin-step's `action` stamp, gate-check's
  `gate` stamp, specialty-run's `specialty` stamp.
- **Every about-to-dispatch consultation payload** exposes `fallbackModels`
  *when configured* so the orchestrator can walk them on a capacity failure:
  specialty-run and gate-check payloads, plus the design-review-check payload
  (finding 2's "codex design-review profile would not expose its alternatives").
- **`check-dispatch`** reads `record.fallbackModels ?? null` (and, on the
  no-ledger-record path, `resolved.fallbackModels ?? null` from
  `resolveExpectedStep`) and gates with `modelAccepted(...)` instead of
  `modelSatisfies(...)`, for both `checkDispatchForTicket` and
  `checkDispatchByScan`.

Design-review's dispatch itself is **not** ledger-hook-gated and this ticket does
not change that: `check-dispatch` only gates bare routes starting `local-board-`
(claude-subagent roles), the default `design-review` route is `codex-task:read-only`,
and `design-review-check` writes no stamp. So for design-review the only two
concerns are (a) evidence acceptance — covered generically by D4's
`validateStepRouting` change — and (b) surfacing alternatives — covered by adding
`fallbackModels` to its payload. No design-review ledger stamp is introduced.

Pre-existing no-record limitation (unchanged, noted for honesty): when
`check-dispatch` finds no ledger record it resolves the ticket's *status* action
via `resolveExpectedStep`, not a specific specialty/gate/design-review action, so
the no-record path exposes only the status action's fallbacks. The stamp path
(the normal flow, where gate-check/specialty-run stamp before dispatch) is the
authoritative one and is fully threaded.

### D6 — Byte-identical back-compat: emit new fields ONLY when configured

This is the corrected back-compat decision (design-review FAIL finding 1). The
earlier design proposed `configuredFallbackModels: null` on every begin-step
result and `fallbackModels: null` on every `codexDispatch`, which contradicts the
"boards without `fallbackModels` behave byte-identically" acceptance criterion
(and would rewrite the on-disk ledger JSON for every stamp). Corrected rule,
applied uniformly at **config profile, resolver, result, dispatch, payload, and
ledger** layers:

> A fallback field is present in an output/record **iff** the action's resolved
> profile actually carries a non-empty `fallbackModels` list. When absent, the
> key is omitted entirely — not set to `null`.

Consequences:

- `normalizeAgentProfile`: sets `profile.fallbackModels` only when present (D2).
- `fallbackModelsForAction(config, action)` returns
  `profileForAction(config, action).fallbackModels ?? null`; a `null` result is
  the signal to **omit** the key downstream.
- `beginStep` result: add `configuredFallbackModels` only when non-null.
- Active-step stamps (action/gate/specialty): add `fallbackModels` only when
  non-null, so ledger JSON for fallback-free boards is byte-for-byte unchanged.
- `translateCodexDispatch`: add `fallbackModels` (sanitized) to the returned
  object only when the input list is non-null; otherwise omit it.
- specialty-run / gate-check / design-review-check payloads: add `fallbackModels`
  only when non-null.

Unlike `effort` (which is emitted as `null` on every branch because it predates
this ticket and its `null`-everywhere shape is already the baseline),
`fallbackModels` is brand new, so its baseline is *absence*. Tests assert the
exact legacy shapes when no fallback is configured (see Test strategy).

## Implementation approach (files and changes)

### src/config.js
- `normalizeAgentProfile`: after the `effort` block, parse `fallbackModels` per
  D1/D2. Add it to the returned `profile` **only when present**. Update the two
  grammar strings ("must be a { route, model?, effort?, prompt? } object" and the
  optionalSteps "{ route, model?, effort? }" variant) to include `fallbackModels?`.
- `resolveOptionalStepAgent`: return `fallbackModels` **only when the profile
  carries it** (conditional spread), keeping the string-sugar branch's shape
  (`{ route, model: null, effort: null }`) byte-identical — no `fallbackModels`
  key when none is configured. `fallbackModelsForAction` reads it with `?? null`,
  so a missing key is handled uniformly.
- `defaultConfigJsonc`: comment-only mention of `fallbackModels` in the `agents`
  block comment (no change to default *values*, so the guard test
  "defaultConfigJsonc matches DEFAULT_CONFIG" — which parses and ignores comments
  — is unaffected). Do NOT add `fallbackModels` to any default entry.

### src/tickets.js
- Add `fallbackModelsForAction(config, action)` =
  `profileForAction(config, action).fallbackModels ?? null`.
- Add exported `modelAccepted(configuredModel, fallbackModels, executorModel)`
  (D4). Keep `modelSatisfies` unchanged.
- `validateStepRouting`: in the `enforceModel` branch, replace the
  `modelSatisfies(configuredModel, executorModel)` acceptance with
  `modelAccepted(configuredModel, fallbackModelsForAction(config, action), executorModel)`.
  Extend the failure message to note that a configured fallback model is also
  accepted. This is action-generic, so it covers mandatory actions, specialties,
  and design-review with no per-action branches.
- `beginStep`: compute `configuredFallbackModels = fallbackModelsForAction(...)`;
  add `configuredFallbackModels` to the returned `result` and `fallbackModels` to
  the `stampActiveStep` payload **only when non-null** (D6).
- `resolveExpectedStep`: include `fallbackModels` in its returned shape **only
  when non-null** (feeds check-dispatch's no-record path).

### src/active-steps.js
- `checkDispatchForTicket` / `checkDispatchByScan`: read
  `record.fallbackModels ?? null` (and `resolved.fallbackModels ?? null` on the
  no-record path) and gate with `modelAccepted(...)` instead of `modelSatisfies`.
  Import `modelAccepted` from tickets.js alongside `modelSatisfies`.

### src/cli.js
- `commandBeginStep`: pass `fallbackModels: result.configuredFallbackModels`
  (which is `undefined` when absent) into `translateCodexDispatch`. No new CLI
  command or flag.
- `commandGateCheck`: in the non-empty `claude-subagent:` stamp, add
  `fallbackModels: gateProfile.fallbackModels` to the `stampActiveStepNoClobber`
  record **only when present**, and add `fallbackModels` to the printed `payload`
  **only when present**.
- `commandSpecialtyRun`: `resolveOptionalStepAgent(entry.agent)` now also yields
  `fallbackModels`; add it to the `claude-subagent:` `stampActiveStepNoClobber`
  record and to the `payload` **only when present**.
- `commandDesignReviewCheck`: add `fallbackModels: profile.fallbackModels` to the
  emitted `payload` **only when present** (no ledger stamp is added — design-review
  dispatch is not hook-gated).

Every "only when present" above is the D6 rule; a fallback-free board produces
byte-identical stamps and payloads.

### src/codex-dispatch.js
- `translateCodexDispatch({ ..., fallbackModels })`: when `fallbackModels` is a
  non-empty array, sanitize each entry with the existing `sanitizeModel` (Claude
  aliases / `claude*` / empty -> dropped) and include a `fallbackModels` array on
  the returned object (possibly `[]` if every entry was a Claude alias, e.g. a
  claude-subagent route). When `fallbackModels` is null/undefined, **omit the key
  entirely** (D6). Update the header contract comment to document that
  `codexDispatch.fallbackModels` is the *sanitized* list the Codex harness walks,
  while begin-step's `configuredFallbackModels` is the raw list the native
  harness walks (finding 3).

### SKILL.md (native Claude harness — Delegation section, prose only)
- In the model-deviation subsection (after the "pinned model unavailable ->
  approve-inline" paragraph), add the fallback walk keyed to the **raw**
  `configuredFallbackModels` surfaced by begin-step (native Claude models are
  valid here):
  > When the action's profile surfaces `configuredFallbackModels`, a
  > capacity/unavailability failure of the pinned model does not require user
  > approval. Retry the pinned model once; if it still fails, dispatch each
  > `configuredFallbackModels` entry **in order**, keeping the same route and
  > carrying `configuredEffort` over unchanged. On the first success, record
  > `complete-step <id> <action> --executor <configuredAgent> --model <fallbackModel>`
  > — strict routing accepts it because the model is a sanctioned fallback
  > (no `approve-inline`). Only if the pin and every fallback are exhausted, fall
  > back to the approve-inline / `questions` path above.
- Update the `begin-step returns ...` line to add `configuredFallbackModels`
  (surfaced only when configured).

### skills/codex/local-board/SKILL.md (Codex harness — Delegation section, prose only)
- Add the same fallback-walk guidance but keyed to the **sanitized**
  `codexDispatch.fallbackModels`, NOT raw `configuredFallbackModels` (finding 3):
  a raw entry may be a Claude alias that is not a valid Codex model, and
  translation drops such entries. The Codex orchestrator walks
  `codexDispatch.fallbackModels` in order, records
  `complete-step ... --model <fallbackModel>` (or `@codex-default` when the list
  is empty after sanitization), and every entry there is by construction also in
  the config-side gate list, so evidence is accepted.
- Note that an entry absent from `codexDispatch.fallbackModels` because it
  sanitized out is intentionally not dispatchable under Codex.

### CLI-fence / sync invariants (unchanged)
The `## CLI Commands` fenced blocks are **unchanged** (no new command/flag), so
they stay byte-identical across copies; `test/skill-usage-sync.test.js` is
unaffected. `SKILL_TEAM.md` / `skills/codex/local-team/SKILL.md` have no
Delegation section and need no change. No `plans/prompts` files change, so
`npm run sync-resources` is not required.

### docs/CodexSupport.md
- **Models** section: document `codexDispatch.fallbackModels` (sanitized like
  `model`, present only when a fallback list is configured); note begin-step
  surfaces the raw `configuredFallbackModels` for the native harness, and that
  the two lists can differ when an entry is a Claude alias.
- **Effort** section / route-translation: document that strict routing accepts
  the pinned model OR any configured fallback (evidence records the model that
  actually ran; effort carries over, never recorded), that `optionalSteps[].agent`
  accepts `fallbackModels` under the same grammar, and that boards without
  `fallbackModels` are byte-identical.

## Risks and edge cases

- **Hook regression across paths (highest):** the earlier design threaded only
  begin-step, so a fallback dispatch on a gate-check or claude-subagent specialty
  would be blocked by the hook. D5 threads all three stamp paths and shares
  `modelAccepted`; every path is dispatch-hook + resolver tested (Test strategy).
- **Back-compat drift (high):** emitting `…: null` placeholders would break
  byte-identical outputs and rewrite ledger JSON. D6 emits fields only when
  configured; guarded by exact-legacy-shape tests at result, dispatch, payload,
  and ledger layers.
- **Alias leaking to Codex (medium):** raw `configuredFallbackModels` may hold a
  Claude alias; the Codex skill must walk the sanitized
  `codexDispatch.fallbackModels`, not the raw list. Prose split + alias-list test.
- **Dead-config trap:** `fallbackModels` without a `model` pin silently accepts
  any model. D2 rejects it at load time.
- **Claude-route fallbacks sanitize to empty** in `codexDispatch` (aliases
  dropped, possibly `[]`). Expected: Codex uses `codex-default` evidence anyway;
  the logical fallback list still gates evidence via `fallbackModelsForAction`
  (config-side, un-sanitized). Only the *dispatch hint* is sanitized.
- **design-review** fallback acceptance rides on the generic `validateStepRouting`
  change; its dispatch is not hook-gated and this ticket does not change that.

## Test strategy

test/config.test.js
- Accept: `{ route: "codex-task:read-only", model: "gpt-5.6-terra", effort:
  "high", fallbackModels: ["gpt-5.5"] }` normalizes with `fallbackModels`
  preserved; multi-entry ordered list preserved in order.
- Reject: not an array; empty `[]`; non-string / bad-charset entry
  (`["bad/model"]`, `[3]`); on `route: "inline"`; without a `model` pin.
- optionalSteps object-form agent accepts `fallbackModels` (same rules via
  `normalizeOptionalStepAgent`); `prompt` still rejected.
- **Back-compat (D6):** a profile without `fallbackModels` deep-equals today's
  normalized object (no stray key); `resolveOptionalStepAgent` on a string-sugar
  and on an object without fallbacks yields no `fallbackModels` key.

test/ (begin-step, D6 legacy shapes)
- `configuredFallbackModels` present (array) only when configured; **key absent**
  (exact deep-equal to the pre-feature result) when not configured.
- Active-step `action` stamp carries `fallbackModels` only when configured; the
  ledger record is byte-identical to today when absent.
- `--harness codex`: `codexDispatch.fallbackModels` present (sanitized) only when
  configured; gpt ids pass through; the key is **absent** when unset (exact
  deep-equal to the pre-feature `codexDispatch`).

test/ (routing / model acceptance)
- complete-step `review --model gpt-5.5` accepted under strict routing when
  `fallbackModels: ["gpt-5.5"]`; token `codex-task:read-only@gpt-5.5` recorded;
  `validate` passes. `review --model gpt-4o` (unlisted) refused with the updated
  message. Pinned model still accepted; `codex-default` still accepted.
- Done-time re-validation remains route-only (fallback-model evidence passes
  `move done`).
- design-review fallback: a `design-review` profile with `fallbackModels`
  accepts fallback-model evidence via `recordDesignReview`.
- `modelAccepted` unit test: pin, codex-default, listed fallback -> true;
  unlisted -> false; `null` fallbacks -> pin/codex-default only.

test/ (check-dispatch — per-path threading, D5)
- **action path:** `check-dispatch --model <fallback>` returns ok=match when the
  begin-step stamp lists it; `--model <unlisted>` returns model-mismatch;
  pinned/`codex-default` still ok; and a fallback-free stamp still gates by
  `modelSatisfies` alone (unchanged).
- **gate path:** a `claude-subagent` `agents["gate-check"]` with `fallbackModels`
  stamps them via gate-check; `check-dispatch --model <fallback>` is authorized.
- **specialty path:** a `claude-subagent`-routed specialty with `fallbackModels`
  stamps them via specialty-run; `check-dispatch --model <fallback>` is
  authorized; unlisted rejected.

test/ (codex-dispatch — alias sanitization, finding 3)
- An **alias-containing** `fallbackModels` (e.g. `["gpt-5.5", "sonnet"]`) on a
  Codex route yields `codexDispatch.fallbackModels === ["gpt-5.5"]` (alias
  dropped), while `fallbackModelsForAction`/the config gate still lists both —
  proving the sanitized dispatch list and the raw gate list diverge as intended.
- A claude-subagent route whose fallbacks are all aliases yields
  `codexDispatch.fallbackModels === []`.

test/skill-usage-sync.test.js
- Unchanged and passing (no CLI Commands drift).

Full suite: `npm run check` and `node --test`.

## Open questions

None blocking. One deferred product choice recorded in D1 (per-fallback effort
override) is intentionally out of scope and forward-compatible.

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

- 2026-07-10T15:48:42Z: Completed design via claude-subagent:local-board-designer@opus: Ordered fallbackModels as model-id string array (no objects; effort carries over); validation mirrors model rule + rejects empty/no-pin; optionalSteps profiles included; shared modelAccepted predicate wired at both validateStepRouting and check-dispatch seams; no CLI surface change. Estimate 4pts basis T20260710T1223Z.

- 2026-07-10T15:50:48Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: none requested (config-driven policy enforcement, borderline security trigger weighed and omitted per uncertainty rule; no UI/UX)

- 2026-07-10T16:05:05Z: Design review (codex-task:read-only gpt-5.6-sol@xhigh): FAIL. [High] configuredFallbackModels:null / fallbackModels:null on fallback-free outputs contradicts byte-identical back-compat criterion - emit keys only when configured, test exact legacy shapes. [High] fallbacks threaded only through begin-step; specialty-run, gate-check, design-review-check ledger records and payloads omit them, so fallback dispatches on those paths would be hook-rejected - thread through every profile resolver + consultation stamp or explicitly exclude with schema. [Medium] codex skill prose should walk codexDispatch.fallbackModels (sanitized), not raw configuredFallbackModels; test alias-containing list. Disposition: design returns for revision; token withheld until re-review passes.

- 2026-07-10T16:18:32Z: Design re-review (sol@xhigh): FAIL. [High] Superseded design still present after revised text (stray H2 blocks from first design write terminated the section - same defect class as B20260710T1532Z); delete duplicate. [High] Consultation fallbacks not operational: gate-check/specialty-run/design-review-check payloads get raw fallbackModels but neither documented workflow walks them, no sanitized codex list for those paths, and empty-sanitized-list falling back to codex-default bypasses exhaustion-to-approval/questions. [Medium] No exact legacy-shape tests for consultation payloads/stamps, no no-ledger check-dispatch fallback test. Disposition: designer repairs body + revises; review round 3 to follow.
