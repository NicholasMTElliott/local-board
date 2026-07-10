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
updated: 2026-07-10T16:51:04Z
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

### Summary

Add an optional ordered `fallbackModels` array to agent profiles (both
`agents.<action>` and `optionalSteps[].agent` object-form). It names sanctioned
alternate models to record when the pinned model is unavailable, so strict
routing accepts a fallback model's evidence without an interactive
`approve-inline`. The pin is unchanged; done-time validation stays route-only;
**boards without `fallbackModels` behave byte-identically** — every new field is
emitted only when a fallback list is actually configured, never as a `null`
placeholder. The fallback walk is made operational on **every** hook-gated and
consultation dispatch path (begin-step, gate-check, specialty-run,
design-review-check) through one shared translation seam, so a capacity outage
on any pinned profile has a sanctioned, documented alternative.

### Key decisions

#### D1 — Fallback entries are model-id strings, not `{ model, effort }` objects

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

#### D2 — `fallbackModels` requires a pinned `model` and a non-`inline` route

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

#### D3 — optionalSteps agent profiles also get `fallbackModels`

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

#### D4 — Acceptance predicate: pin OR any fallback; `codex-default` wildcard unchanged

Introduce one shared predicate rather than mutating `modelSatisfies` (kept
as-is so its `codex-default` wildcard semantics and its existing exported
callers are untouched):

```text
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
no per-action code — design-review's fallback *evidence* acceptance is handled
entirely here (its `recordDesignReview` runs `validateStepRouting` with
`enforceModel: true`).

#### D5 — Make the fallback walk operational on every dispatch path via one shared translation seam

This is the corrected threading decision (design-review FAIL rounds 2, 3, and the
round-3 narrow findings). Two distinct hazards must both be closed, on **every**
path, not just begin-step:

1. **Dispatch-hook rejection.** The dispatch hook (`check-dispatch`) compares the
   dispatched model against a stamp in the active-steps ledger via `modelSatisfies`;
   if a path writes **no** stamp, or writes one that omits the fallback list,
   `check-dispatch` either falls back to the ticket's *status* action (rejecting
   the dispatched agent as `agent-mismatch`) or rejects the fallback model as a
   `model-mismatch`.
2. **No sanctioned walk / no sanitized Codex list.** A payload can advertise the
   pinned profile but give the orchestrator no walkable, harness-correct fallback
   list, so neither documented workflow ever dispatches a fallback on that path.

The actual code (read directly) has **four** dispatch positions, and only the
first shares begin-step's translation seam today:

- `beginStep` (src/tickets.js) — stamps `kind: "action"`; `commandBeginStep`
  (src/cli.js) is the *only* caller of `translateCodexDispatch`, spliced under
  `--harness codex`.
- `commandGateCheck` (src/cli.js) — stamps `kind: "gate"` (only for a
  `claude-subagent:` gate route) and emits an **independent** payload with
  `agent`/`model`; it does not call `translateCodexDispatch`, and its payload
  omits `effort` even though `normalizeAgentProfile` permits effort on
  `agents["gate-check"]`.
- `commandSpecialtyRun` (src/cli.js) — stamps `kind: "specialty"` (only for a
  `claude-subagent:` route) and emits an **independent** payload with
  `agent`/`model`/`effort`; no `translateCodexDispatch`.
- `commandDesignReviewCheck` (src/cli.js) — emits an **independent** payload with
  `agent`/`model`/`effort` and writes **no** ledger stamp today. Crucially,
  `agents["design-review"]` may validly route to a `claude-subagent:` reviewer
  (e.g. `claude-subagent:local-board-reviewer`), in which case the dispatched
  agent's bare route starts `local-board-` and **is** hook-gated — see the
  design-review correction below.

**Chosen option: thread fallbacks through every resolver and stamp, and route
every consultation payload through the shared `translateCodexDispatch` seam
(Option A), rather than schema-reject fallbacks on those positions (Option B).**
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
- Option A reuses existing seams: every path already resolves through the same
  profile authority (`profileForAction` / `resolveOptionalStepAgent`) and every
  stamp already carries route/model; `translateCodexDispatch` already exists and
  already sanitizes models. Threading adds one conditionally-present field per
  stamp and reuses one translation function for the sanitized Codex list. No new
  architecture.

Concrete rules (all symmetric, all gated by the D6 "only-when-configured" rule):

- **Ledger stamp (hazard 1).** Every ledger stamp for a hook-gated
  (`claude-subagent:`) dispatch carries `fallbackModels` *when configured*:
  begin-step's `action` stamp, gate-check's `gate` stamp, specialty-run's
  `specialty` stamp, and — new this revision — design-review-check's
  `action`/`design-review` stamp (see the correction below). `check-dispatch`
  (`checkDispatchForTicket` and `checkDispatchByScan`) reads
  `record.fallbackModels ?? null` (and, on the no-ledger-record path,
  `resolved.fallbackModels ?? null` from `resolveExpectedStep`) and gates with
  `modelAccepted(...)` instead of `modelSatisfies(...)`.
- **Consultation payload (hazard 2) — shared seam.** Each consultation command
  (`commandGateCheck` non-skip branch, `commandSpecialtyRun`,
  `commandDesignReviewCheck`) routes its resolved profile
  (`{ route, model, effort, fallbackModels }`) through the **same**
  `translateCodexDispatch` seam that begin-step uses, **passing the profile's own
  `effort`** (never a hardcoded `null`) so the sanitized `codexDispatch` sub-block
  preserves the configured effort across the fallback walk. When the profile
  carries a non-empty `fallbackModels`, the payload gains, and only then:
  - `fallbackModels` at the payload top level — the **raw** list the native
    Claude harness walks (native models are valid here); and
  - a `codexDispatch` sub-block carrying the **sanitized** `fallbackModels` (via
    `sanitizeModel`) plus the carried-over `effort` that the Codex harness walks.

  A fallback-free profile adds neither key, so the payload is byte-identical to
  today except for the additive `effort` field on gate-check (see the effort
  correction below). This is the single seam that repairs both "neither documented
  workflow walks gate/specialty/design-review fallbacks" and "codex paths get no
  sanitized list."
- **Exhaustion is approve-inline / questions, never `codex-default`.** When the
  sanitized `codexDispatch.fallbackModels` is empty (every entry was a Claude
  alias dropped by `sanitizeModel`), or when the pin plus every walkable fallback
  is exhausted, the orchestrator proceeds to the `approve-inline` / `questions`
  path — it **must not** record `@codex-default`, because that is an unconfigured
  model that would bypass the pin's exhaustion-to-approval contract. Both skills'
  prose state this explicitly.

**Design-review correction (round-3 High finding).** The earlier design wrongly
claimed design-review dispatch is never hook-gated. `check-dispatch` gates any
dispatched agent whose bare route starts `local-board-`; when
`agents["design-review"]` routes to a `claude-subagent:local-board-reviewer`, the
reviewer dispatch **is** gated. Because `commandDesignReviewCheck` stamped nothing,
`check-dispatch` found no ledger record, fell back to the ticket's *status* action
(the designer route, not the reviewer), and rejected the reviewer as
`agent-mismatch` — blocking the pinned **and** every fallback model. Fix: when the
resolved `design-review` profile route is a `claude-subagent:` route,
`commandDesignReviewCheck` now stamps a **`kind: "action"`, `action:
"design-review"`** record (route/model, plus `fallbackModels` only when
configured), using the existing `stampActiveStepNoClobber` identity semantics that
gate-check/specialty-run already use. This is preferred over the alternative
(requiring `begin-step --action design-review` before dispatch in both harness
workflows) because:

- The clear side already exists: `recordDesignReview` (src/tickets.js) already
  ends with `clearActiveStepIf(root, ..., (record) => isActionLedgerEntry(record,
  "design-review"))`, and `isActionLedgerEntry(record, "design-review")` matches
  exactly `{ kind: "action", action: "design-review" }`. So the stamp is cleared
  by the existing design-review completion path with **zero** new clear code — the
  stamp/clear pair is symmetric and identity-scoped, matching begin-step's own
  `action` stamp shape (`{ ticket, kind, action, route, model, root, ts }`, no
  `stage`).
- It keeps the fix inside the CLI dispatch-preparation command (parity with
  gate-check/specialty-run), rather than pushing a new mandatory `begin-step`
  call into both harness skill workflows and the documented design-review flow.

The stamp is written **only** when the `design-review` route is a
`claude-subagent:` route (mirroring gate-check/specialty-run's `claude-subagent:`
guard). The default `design-review` route is `codex-task:read-only`, which is not
hook-gated, so the default board writes **no** design-review stamp and stays
byte-identical (D6). The stamp is no-clobber: a re-run of design-review-check is an
idempotent match, and a live unrelated entry is left untouched and reported as a
non-fatal conflict warning.

With the stamp in place, design-review's two concerns are both covered: (a)
evidence acceptance — the generic `validateStepRouting`/`modelAccepted` change
(D4); and (b) dispatch-hook authorization + a walkable, sanitized alternatives
list — the `action`/`design-review` stamp read by `check-dispatch` via
`modelAccepted`, plus the shared `translateCodexDispatch` seam.

Pre-existing no-record limitation (unchanged, noted for honesty): when
`check-dispatch` finds no ledger record it resolves the ticket's *status* action
via `resolveExpectedStep`, not a specific specialty/gate/design-review action, so
the no-record path exposes only the status action's fallbacks. The stamp path (the
normal flow, where gate-check/specialty-run/design-review-check stamp before
dispatch) is the authoritative one and is now fully threaded on all four positions;
the no-record path is still covered for the status action.

#### D6 — Byte-identical back-compat: emit new fields ONLY when configured

This is the corrected back-compat decision (design-review FAIL round 2 finding 1).
An earlier design proposed `configuredFallbackModels: null` on every begin-step
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
- Active-step stamps (action/gate/specialty/design-review): add `fallbackModels`
  only when non-null, so ledger JSON for fallback-free boards is byte-for-byte
  unchanged.
- `translateCodexDispatch`: add `fallbackModels` (sanitized) to the returned
  object only when the input list is non-null; otherwise omit it.
- gate-check / specialty-run / design-review-check payloads: add the raw
  `fallbackModels` key and the `codexDispatch` sub-block only when the profile's
  list is non-null.

Unlike `effort` (which is emitted as `null` on every branch because it predates
this ticket and its `null`-everywhere shape is already the baseline),
`fallbackModels` is brand new, so its baseline is *absence*. Tests assert the
exact legacy shapes when no fallback is configured, for results, stamps, and all
three consultation payloads (see Test strategy).

One deliberate additive exception (round-3 Medium finding): the gate-check payload
gains an `effort` field (see D5's effort correction and Implementation approach).
This is not a `fallbackModels` field, but it does change the gate-check payload
shape for **every** board, so its legacy-shape test is updated to expect the
additive `effort: <profile.effort ?? null>` key. specialty-run and
design-review-check payloads already carry `effort`, so their fallback-free shapes
are otherwise unchanged.

### Implementation approach (files and changes)

#### src/config.js
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

#### src/tickets.js
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
- `recordDesignReview`: **unchanged.** Its existing identity-scoped clear —
  `clearActiveStepIf(root, ..., (record) => isActionLedgerEntry(record,
  "design-review"))` — already clears the new design-review-check `action` stamp,
  because `isActionLedgerEntry` matches `{ kind: "action", action:
  "design-review" }`. No new clear is introduced.

#### src/active-steps.js
- `checkDispatchForTicket` / `checkDispatchByScan`: read
  `record.fallbackModels ?? null` (and `resolved.fallbackModels ?? null` on the
  no-record path) and gate with `modelAccepted(...)` instead of `modelSatisfies`.
  Import `modelAccepted` from tickets.js alongside `modelSatisfies`. The new
  design-review `action` stamp flows through this same `record.fallbackModels`
  read — no design-review-specific branch is required.

#### src/codex-dispatch.js
- `translateCodexDispatch({ ..., effort, fallbackModels })`: when `fallbackModels`
  is a non-empty array, sanitize each entry with the existing `sanitizeModel`
  (Claude aliases / `claude*` / empty -> dropped) and include a `fallbackModels`
  array on the returned object (possibly `[]` if every entry was a Claude alias,
  e.g. a claude-subagent route). When `fallbackModels` is null/undefined, **omit
  the key entirely** (D6). `effort` is already passed through verbatim on every
  branch (unchanged). Update the header contract comment to document (a) that this
  is now the single shared seam used by begin-step **and** the three consultation
  commands, (b) that `codexDispatch.fallbackModels` is the *sanitized* list the
  Codex harness walks while the raw list is what the native harness walks, and (c)
  that the carried-over `effort` applies to the fallback walk too (each consultation
  command passes its own profile effort, never `null`).

#### src/cli.js
- `commandBeginStep`: pass `fallbackModels: result.configuredFallbackModels`
  (which is `undefined` when absent) into `translateCodexDispatch`. No new CLI
  command or flag.
- `commandGateCheck` (non-skip, `claude-subagent:` branch): add
  `fallbackModels: gateProfile.fallbackModels` to the `stampActiveStepNoClobber`
  record **only when present**. Additionally, in **all** branches, add
  `effort: gateProfile.effort ?? null` to the printed `payload` (closing the
  round-3 Medium effort gap — the payload previously omitted effort entirely). And,
  **only when the profile lists a non-empty `fallbackModels`**, add `fallbackModels`
  (raw) to the payload and a `codexDispatch` sub-block computed via
  `translateCodexDispatch({ route: gateProfile.route, model: gateProfile.model,
  effort: gateProfile.effort ?? null, fallbackModels, agentsDir })` — passing the
  **configured effort**, not `null`, so the sanitized fallback walk preserves
  effort. Fallback-free gate-check stamp is byte-identical to today; the payload
  gains only the additive `effort` field.
- `commandSpecialtyRun`: `resolveOptionalStepAgent(entry.agent)` now also yields
  `fallbackModels` (when configured); add it to the `claude-subagent:`
  `stampActiveStepNoClobber` record **only when present**, and add the raw
  `fallbackModels` plus a `codexDispatch` sub-block via
  `translateCodexDispatch({ route: agent, model, effort, fallbackModels, agentsDir })`
  to the `payload` **only when present**. The payload already carries `effort`
  (resolved from the profile); the translate call forwards that same `effort`, so
  the fallback walk preserves it. No hardcoded `null`.
- `commandDesignReviewCheck`: when the resolved `design-review` route is a
  `claude-subagent:` route, stamp a `stampActiveStepNoClobber` record
  `{ ticket, kind: "action", action: "design-review", route: profile.route, model:
  profile.model ?? null, root, ts }`, adding `fallbackModels: profile.fallbackModels`
  **only when present** (D6). Report a non-fatal conflict warning on a no-clobber
  conflict, mirroring gate-check/specialty-run. For a non-`claude-subagent:` route
  (e.g. the default `codex-task:read-only`), write **no** stamp — that route is not
  hook-gated. Independently, **only when the `design-review` profile lists a
  non-empty `fallbackModels`**, add the raw `fallbackModels` and a `codexDispatch`
  sub-block via `translateCodexDispatch({ route: profile.route, model:
  profile.model, effort: profile.effort ?? null, fallbackModels, agentsDir })`
  (sanitized list, configured effort carried over) to the emitted `payload`. The
  payload already carries `effort: profile.effort ?? null`; the translate call
  forwards the same value.

Every "only when present" / "only when non-empty" above is the D6 rule; a
fallback-free board produces byte-identical stamps and payloads on all four paths
(except the additive gate-check `effort` field). The `translateCodexDispatch` seam
is reused unchanged in shape (it already returns
`agentType`/`promptPath`/`model`/`effort`/`evidenceExecutor`); the consultation
commands read its sanitized `fallbackModels` and carried `effort` for the codex
walk (and may surface the whole block for harness parity with begin-step).

#### SKILL.md (native Claude harness — Delegation section, prose only)
- In the model-deviation subsection (after the "pinned model unavailable ->
  approve-inline" paragraph), add the fallback walk keyed to the **raw** fallback
  list surfaced by each dispatch command (native Claude models are valid here):
  begin-step's `configuredFallbackModels`, and the gate-check / specialty-run /
  design-review-check payloads' top-level `fallbackModels`.
  > When the action's (or consultation's) profile surfaces a raw fallback list, a
  > capacity/unavailability failure of the pinned model does not require user
  > approval. Retry the pinned model once; if it still fails, dispatch each
  > fallback entry **in order**, keeping the same route and carrying the
  > configured effort over unchanged. On the first success, record
  > `complete-step`/`gate-complete`/`design-review-complete` with
  > `--model <fallbackModel>` — strict routing accepts it because the model is a
  > sanctioned fallback (no `approve-inline`). Only if the pin and every fallback
  > are exhausted, fall back to the approve-inline / `questions` path above —
  > never invent an unconfigured model.
- State that this walk applies to all four dispatch commands, not only begin-step,
  and that design-review-check now stamps the ledger for a claude-subagent reviewer
  route so the hook authorizes the reviewer (and any configured fallback) dispatch.
- Update the `begin-step returns ...` line to add `configuredFallbackModels`
  (surfaced only when configured).

#### skills/codex/local-board/SKILL.md (Codex harness — Delegation section, prose only)
- Add the same fallback-walk guidance but keyed to the **sanitized**
  `codexDispatch.fallbackModels` (from begin-step and from the gate-check /
  specialty-run / design-review-check payloads' `codexDispatch` sub-block), NOT
  the raw list: a raw entry may be a Claude alias that is not a valid Codex model,
  and translation drops such entries. The Codex orchestrator walks
  `codexDispatch.fallbackModels` in order and records
  `complete-step ... --model <fallbackModel>`; every entry there is by construction
  also in the config-side gate list, so evidence is accepted.
- **Remove any "@codex-default when the list is empty" guidance.** When
  `codexDispatch.fallbackModels` is empty (all entries sanitized out) or the pin
  plus every entry is exhausted, go to `approve-inline` / `questions` — do **not**
  record `@codex-default` (an unconfigured model that would bypass the pin's
  exhaustion contract).
- Note that an entry absent from `codexDispatch.fallbackModels` because it
  sanitized out is intentionally not dispatchable under Codex.
- State that the gate-check / specialty-run / design-review-check payloads now
  carry a `codexDispatch` sub-block (only when a fallback list is configured),
  walked identically, and that the sub-block carries the configured `effort`.

#### CLI-fence / sync invariants (unchanged)
The `## CLI Commands` fenced blocks are **unchanged** (no new command/flag), so
they stay byte-identical across copies; `test/skill-usage-sync.test.js` is
unaffected. `SKILL_TEAM.md` / `skills/codex/local-team/SKILL.md` have no
Delegation section and need no change. No `plans/prompts` files change, so
`npm run sync-resources` is not required.

#### docs/CodexSupport.md
- **Models** section: document `codexDispatch.fallbackModels` (sanitized like
  `model`, present only when a fallback list is configured); note begin-step
  surfaces the raw `configuredFallbackModels` for the native harness, that the
  gate-check / specialty-run / design-review-check payloads carry the same
  raw+sanitized pair (only when configured), and that the two lists can differ
  when an entry is a Claude alias.
- **Effort** section / route-translation: document that strict routing accepts
  the pinned model OR any configured fallback (evidence records the model that
  actually ran; effort carries over, never recorded), that the consultation
  payloads (including the new gate-check `effort` field) carry the configured
  effort into the fallback walk, that `optionalSteps[].agent` accepts
  `fallbackModels` under the same grammar, that a design-review claude-subagent
  route is now hook-authorized via a design-review-check ledger stamp, that an
  exhausted or fully-sanitized-out list falls through to approve-inline / questions
  (never `@codex-default`), and that boards without `fallbackModels` are
  byte-identical (aside from the additive gate-check `effort` field).

### Risks and edge cases

- **Design-review reviewer dispatch hook-blocked (highest, this revision):** when
  `agents["design-review"]` routes to a `claude-subagent` reviewer, the reviewer
  dispatch is hook-gated but design-review-check stamped nothing, so check-dispatch
  fell back to the status action and rejected the reviewer — blocking pinned and
  fallback models alike. Fixed by the `action`/`design-review` stamp (D5), reusing
  recordDesignReview's existing clear. Guarded by a new hook-dispatch test.
- **Gate-check effort loss on the fallback walk (this revision):** the gate-check
  payload omitted effort and the proposed translation passed `effort: null`, so a
  `model+effort+fallbackModels` gate profile lost its effort during the walk. Fixed
  by exposing `effort` on the payload and passing `gateProfile.effort ?? null`
  through `translateCodexDispatch`; specialty-run and design-review-check already
  carry effort and now forward it too. Guarded by a gate-fallback effort-preservation
  test.
- **Consultation paths never walk fallbacks (prior revision):** the earlier design
  threaded raw `fallbackModels` into gate/specialty/design-review payloads but
  neither harness's prose walked them, and Codex got no sanitized list. D5 routes
  every consultation payload through the shared `translateCodexDispatch` seam and
  updates both skills; deep-equality legacy-shape tests plus per-path check-dispatch
  tests guard it.
- **Empty-sanitized list bypassing exhaustion (high):** recording `@codex-default`
  when the sanitized fallback list is empty would let an unconfigured model satisfy
  the pin and skip approve-inline. Both skills mandate the approve-inline / questions
  fall-through and forbid `@codex-default`; docs echo it.
- **Hook regression across paths (high):** a fallback dispatch on a gate-check,
  claude-subagent specialty, or claude-subagent design-review would be blocked by
  the hook if its stamp omitted the fallback list (or, for design-review, if no
  stamp existed). D5 threads all four stamp paths and shares `modelAccepted`; every
  path is dispatch-hook + resolver tested.
- **Back-compat drift (high):** emitting `…: null` placeholders would break
  byte-identical outputs and rewrite ledger JSON. D6 emits fallback fields only when
  configured; guarded by exact-legacy-shape tests at result, dispatch, all three
  consultation payloads, and ledger stamp layers. The one intentional additive
  change is the gate-check `effort` field, whose legacy-shape test is updated.
- **Alias leaking to Codex (medium):** a raw fallback list may hold a Claude alias;
  every Codex walk must use the sanitized `codexDispatch.fallbackModels`, not the
  raw list. Prose split + alias-list test.
- **Dead-config trap:** `fallbackModels` without a `model` pin silently accepts any
  model. D2 rejects it at load time.
- **Claude-route fallbacks sanitize to empty** in `codexDispatch` (aliases dropped,
  possibly `[]`). Expected: the logical fallback list still gates evidence via
  `fallbackModelsForAction` (config-side, un-sanitized); only the *dispatch hint* is
  sanitized, and an empty sanitized list routes Codex to approve-inline / questions
  (never `@codex-default`).
- **Lingering design-review action stamp:** like begin-step's own `action` stamp, a
  design-review-check stamp is cleared by its completion verb
  (`design-review-complete` -> `recordDesignReview`), not by `moveTicket`'s
  consultation-only sweep (`isAnyConsultationLedgerEntry` covers gate/specialty
  only). This matches existing `action`-stamp semantics and is not a new hazard
  class; a stale stamp self-heals on the next `begin-step`/consultation for the
  ticket.

### Test strategy

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

test/ (consultation payloads + stamps — legacy shapes)
- **gate-check:** deep-equal of the JSON payload to today's shape **plus** the new
  additive `effort: <profile.effort ?? null>` field when the gate profile has no
  `fallbackModels` (no `fallbackModels`, no `codexDispatch` key); the `gate` ledger
  stamp is byte-identical to today when absent. When configured: payload gains raw
  `fallbackModels` and a `codexDispatch` sub-block with the sanitized list; the
  `gate` stamp carries `fallbackModels`.
- **gate-check effort preservation (round-3 Medium):** a `claude-subagent`
  `agents["gate-check"]` with `model` + `effort: "high"` + `fallbackModels`
  produces a payload whose top-level `effort === "high"` and whose
  `codexDispatch.effort === "high"` (not `null`), proving the configured effort is
  carried into the fallback walk rather than lost.
- **specialty-run:** exact deep-equal of the payload to today's shape when the
  specialty agent has no `fallbackModels` (payload already carries `effort`); the
  `specialty` stamp is byte-identical when absent. When configured: payload gains
  raw `fallbackModels` + `codexDispatch` (with the resolved `effort` preserved);
  stamp carries `fallbackModels`.
- **design-review-check:** exact deep-equal of the payload to today's shape when the
  `design-review` profile has no `fallbackModels`. Stamping now depends on the route:
  a `codex-task:read-only` (default) design-review route writes **no** stamp
  (byte-identical, hook-free); a `claude-subagent:` reviewer route writes an
  `action`/`design-review` stamp. When `fallbackModels` is configured: payload gains
  raw `fallbackModels` + `codexDispatch` (sanitized, effort preserved); the
  claude-subagent-route stamp carries `fallbackModels`.

test/ (routing / model acceptance)
- complete-step `review --model gpt-5.5` accepted under strict routing when
  `fallbackModels: ["gpt-5.5"]`; token `codex-task:read-only@gpt-5.5` recorded;
  `validate` passes. `review --model gpt-4o` (unlisted) refused with the updated
  message. Pinned model still accepted; `codex-default` still accepted.
- Done-time re-validation remains route-only (fallback-model evidence passes
  `move done`).
- design-review fallback evidence: a `design-review` profile with `fallbackModels`
  accepts fallback-model evidence via `recordDesignReview`.
- `modelAccepted` unit test: pin, codex-default, listed fallback -> true; unlisted
  -> false; `null` fallbacks -> pin/codex-default only.

test/ (check-dispatch — per-path threading, D5)
- **action path:** `check-dispatch --model <fallback>` returns ok=match when the
  begin-step stamp lists it; `--model <unlisted>` returns model-mismatch;
  pinned/`codex-default` still ok; and a fallback-free stamp still gates by
  `modelSatisfies` alone (unchanged).
- **gate path:** a `claude-subagent` `agents["gate-check"]` with `fallbackModels`
  stamps them via gate-check; `check-dispatch --model <fallback>` is authorized.
- **specialty path:** a `claude-subagent`-routed specialty with `fallbackModels`
  stamps them via specialty-run; `check-dispatch --model <fallback>` is authorized;
  unlisted rejected.
- **design-review hook-dispatch path (round-3 High):** with a `claude-subagent`
  `agents["design-review"]` profile (reviewer route), design-review-check stamps an
  `action`/`design-review` record; `check-dispatch --agent local-board-reviewer`
  then accepts the **pinned** model and any **configured-fallback** model, and
  rejects an **unlisted** model as model-mismatch — proving the reviewer dispatch
  is authorized rather than rejected as an agent-mismatch against the status action.
  A companion assertion: a `codex-task:read-only` design-review route writes no
  stamp (unchanged, hook-free).
- **no-ledger path:** with no active-steps record, `check-dispatch` resolves the
  status action via `resolveExpectedStep`; when that status action's profile lists a
  fallback, `check-dispatch --model <fallback>` is accepted (`resolved.fallbackModels`
  threaded), while an unlisted model is model-mismatch.

test/ (codex-dispatch — alias sanitization)
- An **alias-containing** `fallbackModels` (e.g. `["gpt-5.5", "sonnet"]`) on a
  Codex route yields `codexDispatch.fallbackModels === ["gpt-5.5"]` (alias dropped),
  while `fallbackModelsForAction`/the config gate still lists both — proving the
  sanitized dispatch list and the raw gate list diverge as intended. Assert
  `codexDispatch.effort` is carried through unchanged alongside the sanitized list.
- A claude-subagent route whose fallbacks are all aliases yields
  `codexDispatch.fallbackModels === []`.

test/skill-usage-sync.test.js
- Unchanged and passing (no CLI Commands drift).

Full suite: `npm run check` and `node --test`.

### Open questions

None blocking. One deferred product choice recorded in D1 (per-fallback effort
override) is intentionally out of scope and forward-compatible.

**Scope note (estimate 4pts, basis T20260710T1223Z, unchanged):** the original
4-point basis covered begin-step-only threading. This revision makes the fallback
walk operational on three additional consultation paths (gate-check, specialty-run,
design-review-check) via the shared seam — including a design-review-check ledger
stamp so a claude-subagent reviewer dispatch is hook-authorized, and an effort
carry-through fix on the consultation translations — with dual-harness skill prose
and per-path legacy-shape + hook-dispatch + no-ledger tests. The work is mechanical
and reuses existing seams (no new architecture), but it is meaningfully broader than
the begin-step-only estimate — realistically nearer the top of a 4-point band, and
worth flagging if the consultation-payload tests balloon.

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

- 2026-07-10T16:33:47Z: Design review #3 (sol@xhigh): FAIL, narrower. [High] design-review dispatch IS hook-gated when agents[design-review] routes to a claude-subagent: commandDesignReviewCheck stamps nothing, so check-dispatch falls back to status action and rejects the reviewer; stamp a design-review action record (with conditional fallbackModels) or require begin-step --action design-review in both harnesses; add hook-dispatch test. [Medium] gate-check translation passes effort:null, losing configured effort on the fallback walk; pass gateProfile.effort through payload + translateCodexDispatch, test effort preservation. Disposition: revision #3 (findings mechanical).

- 2026-07-10T16:51:04Z: Design review #4 (sol@xhigh): FAIL. [High] DR stamp unreachable after a delegated design specialty: specialty-run leaves kind:specialty record, completeStep clears only action records, sweep happens post-move, so stampActiveStepNoClobber conflicts and the hook rejects the reviewer; clear the matching specialty entry on its complete-step + sequence test. [High] Byte-identical criterion violated: gate-check unconditionally emits effort; DR stamp created for every claude-subagent route even without fallbacks. Disposition: revision #4 - conditional-on-fallbacks everywhere; pre-existing fallback-free claude-subagent DR hook rejection carved out to follow-up ticket. Round-5 FAIL on new blockers escalates to questions.
