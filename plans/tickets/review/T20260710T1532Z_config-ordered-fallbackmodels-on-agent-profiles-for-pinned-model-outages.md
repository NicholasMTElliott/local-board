---
id: T20260710T1532Z
type: task
status: ready_for_review
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
updated: 2026-07-10T18:16:15Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "design-review:codex-task:read-only@gpt-5.6-sol", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", "review:codex-task:read-only@gpt-5.6-terra"]
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
`approve-inline`. The pin is unchanged; done-time validation stays route-only.

The governing constraint this revision enforces is a **single, uniform scope
rule (D6)**: every artifact this feature adds — the new config field, the
begin-step surface, every ledger stamp field, every consultation payload
addition (including the gate-check `effort` field and the `codexDispatch`
sub-blocks), and the design-review-check ledger stamp — exists **iff** the
resolved profile carries a non-empty `fallbackModels` list. **A board with no
`fallbackModels` anywhere is byte-identical to today, full stop** — no new key,
no `null` placeholder, no additive field, no new stamp.

One correctness fix is not gated on fallbacks because it emits nothing: a
lingering `kind: "specialty"` ledger entry is now cleared by the specialty's own
`complete-step` (mirroring the existing `kind: "action"` clear), so a
delegated-design-specialty flow can reach a clean design-review-check stamp on
the fallback-configured path. See D5 and finding-1 resolution below.

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

Consequence for Scope item 4's open question: **fallback entries do NOT carry a
per-entry effort override.** Effort always carries over from the parent profile.
A future ticket can widen the grammar to a `{ model, effort }` union if a real
need appears; string-only is forward-compatible (validation can later accept
objects too).

#### D2 — `fallbackModels` requires a pinned `model` and a non-`inline` route

Validation (in `normalizeAgentProfile`, the shared authority):

- Must be an array; reject non-array with an actionable message.
- Reject an **empty** array (`[]`) — a fallback list with no members is dead
  config; the operator meant to omit the key.
- Every entry must be a string matching `/^[A-Za-z0-9][A-Za-z0-9._-]*$/` (same
  regex as `model`); reject non-string / bad-charset entries.
- Reject on `route === "inline"` (same message pattern as `model`/`effort`).
- **Reject `fallbackModels` when `model` is absent.** Fallbacks are alternatives
  to a pin; with no pin, `modelForAction` returns `null` and the model gate
  accepts any model, making the list inert. Fail fast to avoid silent dead
  config. (This is the one rule with no `model`-field analogue; it is justified
  by the enforcement semantics.)

Duplicates and a fallback equal to the pin are tolerated (harmless);
de-duplication is not required. Crucially, `normalizeAgentProfile` adds
`profile.fallbackModels` **only when the key is present and valid** — so a
profile without it deep-equals today's normalized object (no stray key). This is
the load-time anchor of the D6 byte-identical guarantee.

#### D3 — optionalSteps agent profiles also get `fallbackModels`

Yes. `normalizeOptionalStepAgent` already delegates object-form entries to
`normalizeAgentProfile` (with `allowPrompt: false`), so the grammar and all D2
rules apply for free. The two scaffold security specialties are pinned to
`gpt-5.6-sol/xhigh` — the same capacity-outage exposure as `agents.review`, and
they are the literal motivating scenario in the Requirement. They are enforced
by the same `validateStepRouting` model gate via `profileForAction`. Supporting
fallbacks there is symmetric and nearly free: `resolveOptionalStepAgent` surfaces
`fallbackModels` (only when present) and `specialty-run` threads it (D5). Not
supporting them would leave the exact motivating outage path uncovered.

#### D4 — Acceptance predicate: pin OR any fallback; `codex-default` wildcard unchanged

Introduce one shared predicate rather than mutating `modelSatisfies` (kept as-is
so its `codex-default` wildcard semantics and its exported callers are
untouched):

```text
modelAccepted(configuredModel, fallbackModels, executorModel) =
  modelSatisfies(configuredModel, executorModel)                 // pin or codex-default
  || (Array.isArray(fallbackModels) && fallbackModels.includes(executorModel))
```

Used at **both** enforcement seams so the dispatch-time hook and the evidence
gate agree (D5). `codex-default` still satisfies any pin. Done-time
re-validation stays route-only (`enforceModel` defaults false), so back-compat
is preserved. Because `validateStepRouting` resolves its model via the
action-generic `profileForAction`, this single change also makes **design-review**
and **specialty-step** fallback-model evidence acceptable with no per-action code
(design-review's `recordDesignReview` runs `validateStepRouting` with
`enforceModel: true`).

Note: `modelAccepted` is called with a `null` `fallbackModels` on fallback-free
boards, in which case it degenerates to `modelSatisfies` exactly — so acceptance
behavior on fallback-free boards is unchanged.

#### D5 — Fallback walk operational on every dispatch path, gated uniformly by D6

Two hazards must both be closed on every hook-gated path:

1. **Dispatch-hook rejection.** `check-dispatch` compares the dispatched model
   against a ledger stamp via `modelSatisfies`; if a path writes no stamp, or a
   stamp omitting the fallback list, `check-dispatch` either falls back to the
   ticket's *status* action (rejecting the dispatched agent as `agent-mismatch`)
   or rejects the fallback model as `model-mismatch`.
2. **No sanctioned walk / no sanitized Codex list.** A payload can advertise the
   pinned profile but give the orchestrator no walkable, harness-correct
   fallback list.

The code has four dispatch positions:

- `beginStep` (src/tickets.js) — stamps `kind: "action"`; `commandBeginStep`
  (src/cli.js) is the only caller of `translateCodexDispatch`.
- `commandGateCheck` (src/cli.js) — stamps `kind: "gate"` (only for a
  `claude-subagent:` gate route) and emits an independent payload with
  `agent`/`model`; **today the payload has no `effort` key.**
- `commandSpecialtyRun` (src/cli.js) — stamps `kind: "specialty"` (only for a
  `claude-subagent:` route) and emits an independent payload already carrying
  `effort`.
- `commandDesignReviewCheck` (src/cli.js) — emits an independent payload already
  carrying `effort` and writes **no** ledger stamp today.

**Chosen option: thread fallbacks through every resolver and stamp, and route
every consultation payload through the shared `translateCodexDispatch` seam,
strictly under the D6 "only-when-a-non-empty-fallback-list-is-configured" gate.**

Concrete rules (all symmetric, all gated by D6):

- **Ledger stamp (hazard 1).** Every ledger stamp for a hook-gated
  (`claude-subagent:`) dispatch carries `fallbackModels` **only when the resolved
  profile lists a non-empty one**: begin-step's `action` stamp, gate-check's
  `gate` stamp, specialty-run's `specialty` stamp, and design-review-check's new
  `action`/`design-review` stamp (see below). `check-dispatch`
  (`checkDispatchForTicket` and `checkDispatchByScan`) reads
  `record.fallbackModels ?? null` (and, on the no-ledger-record path,
  `resolved.fallbackModels ?? null` from `resolveExpectedStep`) and gates with
  `modelAccepted(...)` instead of `modelSatisfies(...)`. When the field is absent
  (fallback-free), `modelAccepted` degenerates to `modelSatisfies`, so
  fallback-free dispatch authorization is byte-identical.
- **Consultation payload (hazard 2) — shared seam, fully gated.** Each
  consultation command routes its resolved profile through the same
  `translateCodexDispatch` seam begin-step uses, **passing the profile's own
  `effort`** (never a hardcoded `null`) **and its already-resolved prompt path as
  `prompt: promptPath`** (never omitting it) so the sanitized `codexDispatch`
  sub-block preserves both the configured effort and the resolved `promptPath`
  across the fallback walk. **When — and only when — the profile carries a
  non-empty `fallbackModels`**, the payload gains, together:
  - `fallbackModels` at the payload top level — the **raw** list the native
    Claude harness walks; and
  - a `codexDispatch` sub-block carrying the **sanitized** `fallbackModels` (via
    `sanitizeModel`), the carried-over `effort`, and the resolved `promptPath`
    the Codex harness walks. Passing `prompt: promptPath` is required because for
    a `codex-task:` consultation route `translateCodexDispatch` sets
    `promptPath: prompt ?? null`; without it the sub-block's `promptPath` is
    `null` and a fallback-configured codex-task consultation cannot be dispatched
    directly from its `codexDispatch` block. Each command already resolves and
    prints this prompt path, so it is simply forwarded; and
  - for gate-check specifically, the **`effort` field** (which the gate-check
    payload otherwise lacks). This effort field is now part of the
    fallback-only bundle, not a standalone additive change — a fallback-free
    gate-check payload keeps its exact legacy shape with no `effort` key.

  A fallback-free profile adds **none** of these keys on **any** of the four
  paths, so every payload is byte-identical to today.
- **Exhaustion is approve-inline / questions, never `codex-default`.** When the
  sanitized `codexDispatch.fallbackModels` is empty (every entry was a Claude
  alias dropped by `sanitizeModel`), or the pin plus every walkable fallback is
  exhausted, the orchestrator proceeds to `approve-inline` / `questions` — it
  **must not** record `@codex-default`, an unconfigured model that would bypass
  the pin's exhaustion-to-approval contract. Both skills state this explicitly.

**Design-review-check stamp (D5, gated by D6).** When `agents["design-review"]`
routes to a `claude-subagent:` reviewer (e.g.
`claude-subagent:local-board-reviewer`), the reviewer dispatch **is** hook-gated
(`check-dispatch` gates any dispatched agent whose bare route starts
`local-board-`). To authorize it, `commandDesignReviewCheck` stamps a
`kind: "action"`, `action: "design-review"` record (route/model, plus
`fallbackModels`), using `stampActiveStepNoClobber` — but **only when both** (a)
the route is `claude-subagent:` **and** (b) the profile lists a non-empty
`fallbackModels`. This is tighter than the previous revision (which stamped for
every claude-subagent route) so that a fallback-free board writes **no**
design-review stamp and stays byte-identical (D6). The stamp is cleared by the
existing design-review completion path: `recordDesignReview` already ends with
`clearActiveStepIf(root, ..., (record) => isActionLedgerEntry(record,
"design-review"))`, and `isActionLedgerEntry(record, "design-review")` matches
exactly `{ kind: "action", action: "design-review" }`. So the stamp/clear pair
is symmetric and identity-scoped with **zero** new clear code. It is no-clobber:
a re-run is an idempotent match; a live unrelated entry is left untouched and
reported as a non-fatal conflict warning.

#### D5-finding-1 — Clear the lingering specialty stamp on its complete-step

Round-4 finding 1: after a **delegated design specialty**, `specialty-run` leaves
a `kind: "specialty"` record. `completeStep`'s identity-scoped clear matches only
`isActionLedgerEntry(record, action)` (i.e. `kind: "action"`), so the specialty
record lingers. The broad `moveTicket` sweep (`isAnyConsultationLedgerEntry`)
that would eventually clear it runs only **after** the ticket moves —
design-review-check runs **before** that move, so the lingering specialty entry
makes `stampActiveStepNoClobber` report a conflict and write no design-review
stamp, and `check-dispatch` then rejects the reviewer against the stale specialty
record.

Resolution (directive B): specialties are completed via `complete-step` with the
step name as `action` (`assertAction` accepts optional specialty step names, and
`validateStepRouting` resolves them specialty-aware). Add an identity-scoped
predicate mirroring `isActionLedgerEntry`:

```text
isSpecialtyLedgerEntry(record, action) =
  record.kind === "specialty" && record.action === action
```

and change `completeStep`'s final clear from

```text
clearActiveStepIf(root, ..., (r) => isActionLedgerEntry(r, action))
```

to

```text
clearActiveStepIf(root, ..., (r) =>
  isActionLedgerEntry(r, action) || isSpecialtyLedgerEntry(r, action))
```

The specialty stamp's `action` is `entry.name`, exactly the `action`
`complete-step` records for that specialty, so the clear is scoped to the
specialty that just completed — it can never erase a newer, different-identity
entry (the same guarantee `isActionLedgerEntry` gives). With the lingering
specialty entry cleared at its own completion, design-review-check reaches a
clean slot and its stamp lands. This clear is **not** gated on `fallbackModels`:
it emits no field and changes no payload/evidence/config output. It removes a
stale transient ledger entry that `moveTicket` would have swept anyway; the only
difference is that active-steps.json drops the already-dead specialty entry at
`complete-step` time instead of at the next move/overwrite. No evidence token, no
payload, and no on-disk ticket file changes — so the byte-identical guarantee for
the feature's *added outputs* holds. Update the two stale comments that assert a
specialty stamp is cleared only by `gate-complete` or the move sweep
(src/cli.js near the specialty-run stamp, and the `isGateLedgerEntry` /
`isAnyConsultationLedgerEntry` rationale in src/tickets.js) to note the new
`complete-step` clear point.

#### D6 — Byte-identical back-compat: one uniform rule, no exceptions

> A fallback-related field is present in an output/record **iff** the action's
> resolved profile carries a non-empty `fallbackModels` list. When absent, the
> key is omitted entirely — not set to `null`. This includes the gate-check
> `effort` field and every `codexDispatch` sub-block, which are part of the
> fallback-only bundle.

Applied uniformly at config profile, resolver, result, dispatch, payload, and
ledger layers:

- `normalizeAgentProfile`: sets `profile.fallbackModels` only when present (D2).
- `fallbackModelsForAction(config, action)` returns
  `profileForAction(config, action).fallbackModels ?? null`; a `null` result is
  the signal to **omit** the key downstream.
- `beginStep` result: add `configuredFallbackModels` only when non-null.
- Active-step stamps (action/gate/specialty/design-review): add `fallbackModels`
  only when non-null. The design-review stamp is written **only** when
  fallbacks are configured (and the route is claude-subagent), so a
  fallback-free board writes no design-review stamp at all.
- `translateCodexDispatch`: add `fallbackModels` (sanitized) to the returned
  object only when the input list is non-null; otherwise omit it.
- gate-check / specialty-run / design-review-check payloads: add the raw
  `fallbackModels`, the `codexDispatch` sub-block, and (gate-check only) the
  `effort` field **only when** the profile's list is non-empty.

**This revision removes the previous "one deliberate additive gate-check `effort`
field on every board" exception.** There is now no exception: fallback-free
boards are byte-identical everywhere. Tests assert the exact legacy shapes when
no fallback is configured, for results, stamps, and all three consultation
payloads (see Test strategy). Unlike `effort` on specialty-run/design-review
payloads (which predates this ticket and is already `null`-baseline there),
`fallbackModels` is brand new, so its baseline is *absence*. The `codexDispatch`
sub-block (and therefore its `promptPath`) is likewise part of the fallback-only
bundle: it appears only when fallbacks are configured, so forwarding
`prompt: promptPath` changes nothing on a fallback-free board.

#### D7 — Explicitly out-of-scope pre-existing hook gaps (known limitations)

Two pre-existing gaps are **not** fixed here (directive C), because fixing them
unconditionally would break the D6 byte-identical guarantee. They are recorded as
known limitations; the orchestrator will file follow-up tickets.

- **Fallback-free claude-subagent design-review dispatch is hook-rejected.**
  `commandDesignReviewCheck` stamps nothing today. This revision stamps **only
  when fallbacks are configured**, so a claude-subagent design-review route with
  **no** `fallbackModels` still writes no stamp; `check-dispatch` falls back to
  the status action and rejects the reviewer as `agent-mismatch`. This is a
  pre-existing limitation (it exists today, independent of this feature) and is
  explicitly out of scope. Follow-up: authorize a claude-subagent design-review
  dispatch unconditionally (a stamp, or a required `begin-step --action
  design-review`), decoupled from `fallbackModels`.
- **No-ledger-record path exposes only the status action's fallbacks.** When
  `check-dispatch` finds no ledger record it resolves the ticket's *status*
  action via `resolveExpectedStep`, not the specific specialty/gate/design-review
  action, so the no-record path exposes only the status action's fallbacks. The
  normal stamp path (the authoritative flow) is fully threaded; the no-record
  path is a pre-existing fallback-resolution narrowing, out of scope here.
  Follow-up: resolve the specific pending consultation action on the no-record
  path.

The default `design-review` route is `codex-task:read-only` (not hook-gated), so
the default board is unaffected by the first limitation.

#### D8 — Corollary: effort and prompt preservation is scoped to fallback-configured profiles

With D6, effort preservation across the fallback walk is **guaranteed for
fallback-configured profiles**: every consultation command passes its own
profile `effort` (never `null`) and its resolved `prompt: promptPath` into
`translateCodexDispatch`, and the raw payload plus the `codexDispatch` sub-block
both carry them. **Fallback-free profiles keep today's behavior verbatim**,
including today's gaps: the gate-check payload keeps its no-`effort` legacy
shape, and no `codexDispatch` block is emitted (so the forwarded prompt path is
invisible there). The effort- and prompt-preservation improvement rides entirely
on the fallback-configured path, consistent with the single scope rule.

### Implementation approach (files and changes)

#### src/config.js
- `normalizeAgentProfile`: after the `effort` block, parse `fallbackModels` per
  D1/D2. Add it to the returned `profile` **only when present**. Update the two
  grammar strings to include `fallbackModels?`.
- `resolveOptionalStepAgent`: return `fallbackModels` **only when the profile
  carries it** (conditional spread), keeping the string-sugar branch's shape
  (`{ route, model: null, effort: null }`) byte-identical.
- `defaultConfigJsonc`: comment-only mention of `fallbackModels` in the `agents`
  block comment (no change to default *values*, so the "defaultConfigJsonc
  matches DEFAULT_CONFIG" guard test is unaffected). Do NOT add `fallbackModels`
  to any default entry.

#### src/tickets.js
- Add `fallbackModelsForAction(config, action)` =
  `profileForAction(config, action).fallbackModels ?? null`.
- Add exported `modelAccepted(configuredModel, fallbackModels, executorModel)`
  (D4). Keep `modelSatisfies` unchanged.
- Add `isSpecialtyLedgerEntry(record, action)` =
  `record.kind === "specialty" && record.action === action` (D5-finding-1).
- `validateStepRouting`: in the `enforceModel` branch, replace the
  `modelSatisfies(configuredModel, executorModel)` acceptance with
  `modelAccepted(configuredModel, fallbackModelsForAction(config, action),
  executorModel)`. Extend the failure message to note a configured fallback
  model is also accepted. Action-generic — covers mandatory actions,
  specialties, and design-review with no per-action branches.
- `beginStep`: compute `configuredFallbackModels = fallbackModelsForAction(...)`;
  add `configuredFallbackModels` to the returned `result` and `fallbackModels` to
  the `stampActiveStep` payload **only when non-null** (D6).
- `resolveExpectedStep`: include `fallbackModels` in its returned shape **only
  when non-null** (feeds check-dispatch's no-record path).
- `completeStep`: change the final `clearActiveStepIf` predicate to
  `(record) => isActionLedgerEntry(record, action) ||
  isSpecialtyLedgerEntry(record, action)` (D5-finding-1), so a completed
  specialty clears its own `kind: "specialty"` stamp. No other change.
- `recordDesignReview`: **unchanged.** Its existing identity-scoped clear already
  clears the new design-review-check `action` stamp.
- Update the stale comments in `isGateLedgerEntry` / `isAnyConsultationLedgerEntry`
  to note `complete-step` now clears a completed specialty's stamp (the move
  sweep remains the catch-all for genuinely abandoned specialties).

#### src/active-steps.js
- `checkDispatchForTicket` / `checkDispatchByScan`: read
  `record.fallbackModels ?? null` (and `resolved.fallbackModels ?? null` on the
  no-record path) and gate with `modelAccepted(...)` instead of `modelSatisfies`.
  Import `modelAccepted` from tickets.js alongside `modelSatisfies`. The new
  design-review `action` stamp flows through this same `record.fallbackModels`
  read — no design-review-specific branch is required.

#### src/codex-dispatch.js
- `translateCodexDispatch({ ..., prompt, effort, fallbackModels })`: when
  `fallbackModels` is a non-empty array, sanitize each entry with the existing
  `sanitizeModel` (Claude aliases / `claude*` / empty -> dropped) and include a
  `fallbackModels` array on the returned object (possibly `[]` if every entry was
  an alias). When `fallbackModels` is null/undefined, **omit the key entirely**
  (D6). `prompt` and `effort` are already passed through verbatim on every branch
  (`prompt` populates the returned `promptPath` on the codex-task/inline
  branches — unchanged). Update the header contract comment to document (a) this
  is the single shared seam used by begin-step and the three consultation
  commands, (b) `codexDispatch.fallbackModels` is the *sanitized* list the Codex
  harness walks while the raw list is what the native harness walks, (c) the
  carried-over `effort` applies to the fallback walk too (each consultation
  command passes its own profile effort, never `null`), and (d) each consultation
  command passes `prompt: promptPath` (its already-resolved prompt file) so the
  codex-task consultation `codexDispatch.promptPath` is populated and the fallback
  walk is directly dispatchable.

#### src/cli.js
- `commandBeginStep`: pass `fallbackModels: result.configuredFallbackModels`
  (which is `undefined` when absent) into `translateCodexDispatch`. Already passes
  `prompt: result.configuredPrompt`. No new CLI command or flag.
- `commandGateCheck` (non-skip, `claude-subagent:` branch): add
  `fallbackModels: gateProfile.fallbackModels` to the `stampActiveStepNoClobber`
  record **only when present**. **Only when the profile lists a non-empty
  `fallbackModels`**, add to the printed `payload`, together: `effort:
  gateProfile.effort ?? null`, the raw `fallbackModels`, and a `codexDispatch`
  sub-block computed via `translateCodexDispatch({ route: gateProfile.route,
  model: gateProfile.model, prompt: promptPath, effort: gateProfile.effort ??
  null, fallbackModels, agentsDir })` — passing the **already-resolved
  `promptPath`** (the same value the command resolves and prints) and the
  **configured effort**, not `null`. **A fallback-free gate-check payload gains
  nothing (no `effort`, no `fallbackModels`, no `codexDispatch`) and is
  byte-identical to today.**
- `commandSpecialtyRun`: `resolveOptionalStepAgent(entry.agent)` now also yields
  `fallbackModels` (when configured); add it to the `claude-subagent:`
  `stampActiveStepNoClobber` record **only when present**, and add the raw
  `fallbackModels` plus a `codexDispatch` sub-block via
  `translateCodexDispatch({ route: agent, model, prompt: promptPath, effort,
  fallbackModels, agentsDir })` to the `payload` **only when present** — passing
  the command's resolved `promptPath`. The payload already carries `effort`; the
  translate call forwards that same `effort`. No hardcoded `null`.
- `commandDesignReviewCheck`: **only when** the resolved `design-review` route is
  a `claude-subagent:` route **and** the profile lists a non-empty
  `fallbackModels`, stamp a `stampActiveStepNoClobber` record `{ ticket, kind:
  "action", action: "design-review", route: profile.route, model: profile.model
  ?? null, fallbackModels: profile.fallbackModels, root, ts }`; report a
  non-fatal conflict warning on a no-clobber conflict. For a non-`claude-subagent:`
  route, or a claude-subagent route with no `fallbackModels`, write **no** stamp
  (see D7 known limitation). Independently, **only when** the profile lists a
  non-empty `fallbackModels`, add the raw `fallbackModels` and a `codexDispatch`
  sub-block via `translateCodexDispatch({ route: profile.route, model:
  profile.model, prompt: promptPath, effort: profile.effort ?? null,
  fallbackModels, agentsDir })` to the payload (sanitized list, configured effort
  carried over, resolved `promptPath` forwarded). The payload already carries
  `effort: profile.effort ?? null` on every branch (unchanged); the translate
  call forwards the same value. A fallback-free design-review-check payload and
  ledger are byte-identical to today.
- All three consultation commands already resolve `promptPath` and print it
  today (gate-check/design-review-check under `plans/prompts/steps/...`,
  specialty-run `path.resolve(root, entry.prompt)`); the amendment simply forwards
  that same value as `prompt: promptPath` into the translate call, so no new
  resolution is introduced and the printed prompt-path line is unchanged.
- Update the stale specialty-run comment ("gate-complete's clear covers this
  entry too / there is no separate specialty-completion verb") to reflect that
  `complete-step` clears the specialty's stamp (D5-finding-1).

Every "only when present" / "only when non-empty" above is the D6 rule; a
fallback-free board produces byte-identical stamps and payloads on all four
paths, with **no** exceptions this revision.

#### SKILL.md (native Claude harness — Delegation section, prose only)
- In the model-deviation subsection, add the fallback walk keyed to the **raw**
  fallback list surfaced by each dispatch command (native Claude models are valid
  here): begin-step's `configuredFallbackModels`, and the gate-check /
  specialty-run / design-review-check payloads' top-level `fallbackModels`.
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
- State this walk applies to all four dispatch commands, and that
  design-review-check stamps the ledger for a claude-subagent reviewer route
  **only when the reviewer profile lists fallbacks**, so the hook authorizes the
  reviewer (and any configured fallback) dispatch on that path.
- Update the `begin-step returns ...` line to add `configuredFallbackModels`
  (surfaced only when configured).

#### skills/codex/local-board/SKILL.md (Codex harness — Delegation section, prose only)
- Add the same fallback-walk guidance keyed to the **sanitized**
  `codexDispatch.fallbackModels` (from begin-step and the three consultation
  payloads' `codexDispatch` sub-block), NOT the raw list.
- **Remove any "@codex-default when the list is empty" guidance.** When
  `codexDispatch.fallbackModels` is empty or the pin plus every entry is
  exhausted, go to `approve-inline` / `questions` — do **not** record
  `@codex-default`.
- Note an entry absent from `codexDispatch.fallbackModels` (sanitized out) is
  intentionally not dispatchable under Codex.
- State the gate-check / specialty-run / design-review-check payloads carry a
  `codexDispatch` sub-block **only when a fallback list is configured**, walked
  identically, carrying the configured `effort` and the resolved
  `codexDispatch.promptPath` (so the codex-task consultation walk is directly
  dispatchable from the sub-block).

#### CLI-fence / sync invariants (unchanged)
The `## CLI Commands` fenced blocks are unchanged (no new command/flag), so they
stay byte-identical across copies; `test/skill-usage-sync.test.js` is unaffected.
`SKILL_TEAM.md` / `skills/codex/local-team/SKILL.md` have no Delegation section.
No `plans/prompts` files change, so `npm run sync-resources` is not required.

#### docs/CodexSupport.md
- **Models** section: document `codexDispatch.fallbackModels` (sanitized like
  `model`, present only when a fallback list is configured); note begin-step
  surfaces the raw `configuredFallbackModels`, that the three consultation
  payloads carry the same raw+sanitized pair (only when configured) together with
  the resolved `codexDispatch.promptPath`, and that the two lists can differ when
  an entry is a Claude alias.
- **Effort** section: document that strict routing accepts the pinned model OR
  any configured fallback (evidence records the model that actually ran; effort
  carries over, never recorded), that the consultation payloads carry the
  configured effort and resolved prompt path into the fallback walk **only on the
  fallback-configured path** (including the gate-check `effort` field, which
  appears only then), that `optionalSteps[].agent` accepts `fallbackModels`, that
  a design-review claude-subagent route is hook-authorized via a
  design-review-check stamp **only when it lists fallbacks** (fallback-free
  claude-subagent design-review remains a known limitation, follow-up ticket),
  that an exhausted or fully-sanitized-out list falls through to approve-inline /
  questions (never `@codex-default`), and that boards without `fallbackModels` are
  byte-identical with **no** exceptions.

### Risks and edge cases

- **Design-review stamp unreachable after a delegated design specialty (this
  revision, finding 1):** a lingering `kind: "specialty"` stamp made
  `stampActiveStepNoClobber` conflict, so design-review-check wrote no stamp and
  the reviewer was hook-rejected. Fixed by `isSpecialtyLedgerEntry` +
  `completeStep` clearing a completed specialty's own stamp (D5-finding-1).
  Guarded by the full-sequence test (specialty-run -> specialty complete-step ->
  design-review-check -> reviewer check-dispatch accepts pinned and fallback).
- **Byte-identical drift on fallback-free boards (this revision, finding 2):**
  the previous revision emitted a gate-check `effort` field on every board and a
  design-review stamp for every claude-subagent route. Fixed: both are now inside
  the fallback-only bundle (D6, no exceptions). Guarded by exact-legacy-shape
  tests for all three consultation payloads and stamps on fallback-free boards.
- **Fallback-configured codex-task consultation not dispatchable (this revision,
  finding 5, high):** the three consultation `translateCodexDispatch` calls
  omitted `prompt`, so for a `codex-task:` consultation route the returned
  `codexDispatch.promptPath` was `null` and the orchestrator had no prompt file
  to dispatch the fallback walk from. Fixed by forwarding each command's already-
  resolved `promptPath` as `prompt: promptPath` on all three calls. Guarded by a
  test asserting a fallback-configured codex-task consultation payload's
  `codexDispatch.promptPath` equals the resolved prompt path, while a
  fallback-free profile emits no `codexDispatch` block at all (so the block, and
  its prompt path, stay absent).
- **Fallback-free claude-subagent design-review hook rejection (known
  limitation, D7):** out of scope; follow-up ticket. Covered by an assertion that
  a fallback-free claude-subagent design-review route writes no stamp (documenting
  the limitation) rather than by a fix.
- **Empty-sanitized list bypassing exhaustion (high):** recording `@codex-default`
  when the sanitized fallback list is empty would let an unconfigured model
  satisfy the pin. Both skills mandate the approve-inline / questions fall-through
  and forbid `@codex-default`; docs echo it.
- **Hook regression across paths (high):** a fallback dispatch whose stamp omits
  the fallback list would be blocked. D5 threads all four stamp paths and shares
  `modelAccepted`; every path is dispatch-hook + resolver tested. Fallback-free
  stamps fall through `modelAccepted` -> `modelSatisfies` unchanged.
- **Alias leaking to Codex (medium):** a raw fallback list may hold a Claude
  alias; every Codex walk must use the sanitized `codexDispatch.fallbackModels`.
  Prose split + alias-list test.
- **Dead-config trap:** `fallbackModels` without a `model` pin silently accepts
  any model. D2 rejects it at load time.
- **Claude-route fallbacks sanitize to empty** in `codexDispatch` (aliases
  dropped, possibly `[]`). Expected: the logical fallback list still gates
  evidence via `fallbackModelsForAction` (config-side, un-sanitized); only the
  dispatch hint is sanitized, and an empty sanitized list routes Codex to
  approve-inline / questions.
- **Specialty-clear timing (low):** `complete-step` now drops a completed
  specialty's ledger entry earlier than the `moveTicket` sweep did. This is a
  transient-state hygiene change that emits no field and alters no
  payload/evidence/ticket output; the sweep remains the catch-all for genuinely
  abandoned specialties.
- **Lingering design-review action stamp:** like begin-step's own `action` stamp,
  a design-review-check stamp is cleared by its completion verb
  (`design-review-complete` -> `recordDesignReview`). This matches existing
  `action`-stamp semantics; a stale stamp self-heals on the next
  begin-step/consultation.

### Test strategy

test/config.test.js
- Accept: `{ route, model, effort: "high", fallbackModels: ["gpt-5.5"] }`
  normalizes with `fallbackModels` preserved; multi-entry ordered list preserved.
- Reject: not an array; empty `[]`; non-string / bad-charset entry; on
  `route: "inline"`; without a `model` pin.
- optionalSteps object-form agent accepts `fallbackModels`; `prompt` still
  rejected.
- **Back-compat (D6):** a profile without `fallbackModels` deep-equals today's
  normalized object (no stray key); `resolveOptionalStepAgent` on string-sugar
  and on an object without fallbacks yields no `fallbackModels` key.

test/ (begin-step, D6 legacy shapes)
- `configuredFallbackModels` present only when configured; key absent (exact
  deep-equal to the pre-feature result) when not configured.
- Active-step `action` stamp carries `fallbackModels` only when configured;
  byte-identical when absent.
- `--harness codex`: `codexDispatch.fallbackModels` present (sanitized) only when
  configured; key absent (exact deep-equal) when unset.

test/ (consultation payloads + stamps — legacy shapes, D6 no-exceptions)
- **gate-check:** exact deep-equal of the JSON payload to today's shape (no
  `effort`, no `fallbackModels`, no `codexDispatch`) when the gate profile has no
  `fallbackModels`; the `gate` stamp is byte-identical. When configured: payload
  gains `effort`, raw `fallbackModels`, and a `codexDispatch` sub-block (sanitized
  list); the `gate` stamp carries `fallbackModels`.
- **gate-check effort preservation:** a `claude-subagent` `agents["gate-check"]`
  with `model` + `effort: "high"` + `fallbackModels` produces a payload whose
  top-level `effort === "high"` and whose `codexDispatch.effort === "high"`.
- **consultation prompt-path preservation (finding 5):** for each of gate-check,
  specialty-run, and design-review-check on a **codex-task** route with
  `fallbackModels`, the payload's `codexDispatch.promptPath` equals the command's
  resolved prompt path (gate-check/design-review-check under
  `plans/prompts/steps/...`, specialty-run under the entry's prompt) — i.e. it is
  non-null and dispatchable. Conversely, a **fallback-free** profile on each of
  the three commands emits **no** `codexDispatch` block (so no `promptPath`
  surfaces), preserving the byte-identical legacy shape.
- **specialty-run:** exact deep-equal of the payload to today's shape when the
  specialty agent has no `fallbackModels`; the `specialty` stamp is byte-identical.
  When configured: payload gains raw `fallbackModels` + `codexDispatch` (resolved
  `effort` and `promptPath` preserved); stamp carries `fallbackModels`.
- **design-review-check:** exact deep-equal of the payload to today's shape when
  the profile has no `fallbackModels`, on **every** route — and **no** stamp is
  written on any route without fallbacks (default `codex-task:read-only` and a
  claude-subagent route both write nothing; the latter documents the D7 known
  limitation). When `fallbackModels` is configured on a `claude-subagent:` route:
  payload gains raw `fallbackModels` + `codexDispatch`; the stamp
  (`action`/`design-review`) carries `fallbackModels`. A `codex-task:` route with
  fallbacks: payload gains the fallback bundle (with a non-null
  `codexDispatch.promptPath`) but writes no stamp (not hook-gated).

test/ (routing / model acceptance)
- complete-step `review --model gpt-5.5` accepted under strict routing when
  `fallbackModels: ["gpt-5.5"]`; token `codex-task:read-only@gpt-5.5` recorded;
  `validate` passes. `review --model gpt-4o` refused. Pinned model still accepted;
  `codex-default` still accepted.
- Done-time re-validation remains route-only (`move done` passes fallback-model
  evidence).
- design-review fallback evidence: a `design-review` profile with `fallbackModels`
  accepts fallback-model evidence via `recordDesignReview`.
- `modelAccepted` unit test: pin, codex-default, listed fallback -> true; unlisted
  -> false; `null` fallbacks -> pin/codex-default only (degenerates to
  `modelSatisfies`).

test/ (check-dispatch — per-path threading, D5)
- **action path:** `check-dispatch --model <fallback>` matches when the begin-step
  stamp lists it; `--model <unlisted>` model-mismatch; pinned/`codex-default`
  still ok; a fallback-free stamp gates by `modelSatisfies` alone (unchanged).
- **gate path:** a `claude-subagent` `agents["gate-check"]` with `fallbackModels`
  stamps them; `check-dispatch --model <fallback>` authorized.
- **specialty path:** a `claude-subagent`-routed specialty with `fallbackModels`
  stamps them; `check-dispatch --model <fallback>` authorized; unlisted rejected.
- **design-review full-sequence path (finding 1, primary):** run
  `specialty-run` for a claude-subagent design-stage specialty -> `complete-step`
  that specialty (asserting the `kind: "specialty"` entry is now cleared) ->
  `design-review-check` for a `claude-subagent` `agents["design-review"]` profile
  **with** `fallbackModels` (asserting the `action`/`design-review` stamp lands
  with no conflict) -> `check-dispatch --agent local-board-reviewer` accepts the
  **pinned** model and any **configured-fallback** model, and rejects an
  **unlisted** model as model-mismatch. Companion: without the finding-1 clear the
  stamp would conflict — assert the cleared-entry precondition explicitly.
- **design-review no-stamp assertions (D7 / D6):** a `codex-task:read-only`
  design-review route writes no stamp (unchanged); a `claude-subagent`
  design-review route **without** `fallbackModels` also writes no stamp
  (documenting the known limitation).
- **no-ledger path:** with no active-steps record, `check-dispatch` resolves the
  status action; when that action lists a fallback, `--model <fallback>` is
  accepted (`resolved.fallbackModels` threaded), unlisted is model-mismatch.

test/ (codex-dispatch — alias sanitization + prompt forwarding)
- An alias-containing `fallbackModels` (e.g. `["gpt-5.5", "sonnet"]`) on a Codex
  route yields `codexDispatch.fallbackModels === ["gpt-5.5"]` while
  `fallbackModelsForAction`/the config gate still lists both. Assert
  `codexDispatch.effort` carries through unchanged.
- A claude-subagent route whose fallbacks are all aliases yields
  `codexDispatch.fallbackModels === []`.
- Passing `prompt: promptPath` into `translateCodexDispatch` on a `codex-task:`
  route populates `codexDispatch.promptPath` with that exact path (guards the
  finding-5 forwarding contract at the seam level).

test/ (completeStep specialty clear — finding 1 unit)
- After `specialty-run` stamps a `kind: "specialty"` entry, `complete-step` for
  that specialty clears it (ledger has no entry afterward); a `complete-step` for
  a *different* action leaves the specialty entry intact (identity scoping);
  `isSpecialtyLedgerEntry` matches only `kind: "specialty"` with the same action.

test/skill-usage-sync.test.js
- Unchanged and passing (no CLI Commands drift).

Full suite: `npm run check` and `node --test`.

### Open questions

None blocking. One deferred product choice recorded in D1 (per-fallback effort
override) is intentionally out of scope and forward-compatible. Two pre-existing
hook gaps are carved out to follow-up tickets by the orchestrator (D7).

**Scope note (estimate 4pts, basis T20260710T1223Z, unchanged):** the fallback
walk is operational on begin-step plus three consultation paths (gate-check,
specialty-run, design-review-check) via the shared seam, gated uniformly by the
single D6 scope rule. This revision adds a general ledger-hygiene fix
(`complete-step` clearing a completed specialty's stamp) so the fallback-configured
design-review stamp lands, tightens two additive changes (gate-check `effort`,
design-review stamp) back inside the fallback-only bundle so fallback-free boards
are byte-identical with no exceptions, and forwards each consultation command's
already-resolved `promptPath` (`prompt: promptPath`) into the shared translate
seam so a fallback-configured codex-task consultation is directly dispatchable
from its `codexDispatch` block. Work is mechanical and reuses existing seams (no
new architecture), realistically near the top of a 4-point band.

## Implementation Notes

Implemented the Technical Design exactly as approved (six review rounds).

Merge: `git merge mainline` (commit `5ed49f4`) picked up the section-payload H2 reject guard and scoped duplicate-heading validate in `src/tickets.js`, the four skill payload-note edits, and doc updates, with no conflicts. `node --test test/tickets.test.js` confirmed the merged base sound (170/170 pass, 1 skip) before starting.

D6 uniform-scope rule (fallback-related field present iff the resolved profile carries a non-empty `fallbackModels`) is implemented via conditional spread at every layer: `normalizeAgentProfile`/`resolveOptionalStepAgent` (config), `fallbackModelsForAction` (`?? null`), `beginStep`/`resolveExpectedStep` results, all four ledger stamps (action/gate/specialty/design-review), `translateCodexDispatch`'s `fallbackModels` key, and the three consultation payloads' `effort`+`fallbackModels`+`codexDispatch` bundle (gate-check's `effort` field is part of the bundle, not a standalone addition). No `null` placeholders anywhere; absence is the fallback-free signal.

D4 shared predicate `modelAccepted(pin, fallbackModels, actual)` (`src/tickets.js`) wired at both enforcement seams: `validateStepRouting`'s `enforceModel` branch (replacing the bare `modelSatisfies` call) and `checkDispatchForTicket`/`checkDispatchByScan` (`src/active-steps.js`), including the no-ledger `resolveExpectedStep` path. `modelSatisfies` itself is untouched (still exported, still governs the `codex-default` wildcard and its other callers).

D5-finding-1: added `isSpecialtyLedgerEntry(record, action)` and extended `completeStep`'s final `clearActiveStepIf` predicate to `isActionLedgerEntry(record, action) || isSpecialtyLedgerEntry(record, action)`, so a completed specialty clears its own lingering `kind: "specialty"` stamp before `design-review-check` runs. Verified end-to-end by the full-sequence CLI test (specialty-run stamps `kind: "specialty"` -> its own `complete-step` clears it -> `design-review-check` stamps `action`/`design-review` with no conflict -> `check-dispatch` accepts the pinned model and the configured fallback, rejects an unlisted model).

D7 carve-out preserved as designed and NOT fixed: a fallback-free `claude-subagent:` `agents["design-review"]` route still writes no ledger stamp (asserted by a dedicated legacy-shape test documenting the limitation), and the no-ledger `check-dispatch` path still resolves only the ticket's status action, not the specific pending specialty/gate/design-review action.

`translateCodexDispatch` (`src/codex-dispatch.js`) gained a `fallbackModels` parameter: sanitized (same `sanitizeModel` rule as `model`) and added to the returned object only when the input is a non-empty array; omitted entirely when null/undefined. Every consultation command (`commandGateCheck`, `commandSpecialtyRun`, `commandDesignReviewCheck` in `src/cli.js`) now routes through this shared seam, passing its own resolved `effort` (never hardcoded `null`) and its already-resolved `prompt: promptPath`, closing finding 5 (a fallback-configured codex-task consultation's `codexDispatch.promptPath` was previously `null`).

Deviation from the literal config-normalization test-message text: adding `fallbackModels?` to the two grammar-string error messages in `src/config.js` required updating one pre-existing exact-regex assertion in `test/config.test.js` (`loadConfig rejects a malformed optionalSteps[].agent object`) to match the extended message. No behavior change, message text only.

No changes to `plans/prompts/**`, so `npm run sync-resources` was not required; the CLI Commands fenced blocks (`## CLI Commands` headings) in both skills are untouched (no new command/flag).

**Verification**

- `npm run check`: clean (no output = pass).
- `node --test` (full suite): 566 tests, 565 pass, 1 skip (pre-existing slow smoke test, unaffected), 0 fail.
- `node --test test/skill-usage-sync.test.js test/resources-sync.test.js`: 9/9 pass.
- `node ./bin/local-board.js validate --root <worktree>`: exit 0 ("Ticket validation OK").

**Commits (on this branch, in order)**

- `5ed49f4` — merge mainline (instructed, pre-existing base check).
- `b981ff4` — `T20260710T1532Z: config schema for ordered fallbackModels on agent profiles` (`src/config.js`, `test/config.test.js`).
- `a70165a` — `T20260710T1532Z: thread fallbackModels through routing, dispatch, and CLI` (`src/tickets.js`, `src/active-steps.js`, `src/codex-dispatch.js`, `src/cli.js`, and their four test files).
- `1905cb0` — `T20260710T1532Z: document the fallback model walk in skills and CodexSupport` (`SKILL.md`, `skills/codex/local-board/SKILL.md`, `docs/CodexSupport.md`).

**Remaining risks**

- D7's two carved-out pre-existing gaps (fallback-free `claude-subagent:` design-review hook rejection; no-ledger `check-dispatch` narrowing to the status action) remain open, as scoped — follow-up tickets are the orchestrator's call per the design.
- `docs/Workflow.md`'s "Agent Routing" section still documents the pre-`effort`-era `{ route, model?, prompt? }` grammar (missing `effort` too, predating this ticket) and was left untouched — out of this ticket's explicit doc scope (`docs/CodexSupport.md` only), but worth a follow-up doc-accuracy pass.

## Review Findings

Verdict: changes_requested; target: implementation (codex-task:read-only, gpt-5.6-terra @ high, 2026-07-10, commits b981ff4+a70165a+1905cb0)

1. [Medium] The D6 test contract is incomplete: several tests labelled byte-identical assert only key sets or key absence, so they would miss a regression to an existing legacy field value or nested payload shape. Examples: test/cli.test.js:474-480, 1181-1191, 1685-1715, 2595-2602; test/tickets.test.js:1127-1133; test/codex-dispatch.test.js:187-203. Fix: replace the spot checks with assert.deepEqual against the complete fallback-free result/payload/stamp shapes (controlled or captured ts values where needed), covering begin-step, gate-check, specialty-run, design-review-check, and translated dispatch outputs.

Verified clean by static inspection: routing and schema validation, fallback threading through all consultation paths, specialty-stamp clearing, sanitization, prompt forwarding, and the D7 carve-out.

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

- 2026-07-10T17:10:18Z: Design review #5 (sol@xhigh): FAIL, single finding. [High] All three consultation translateCodexDispatch calls omit prompt: promptPath, so fallback-configured codex payloads carry promptPath:null and cannot dispatch from their codexDispatch blocks; pass prompt through all three + retention test (block still absent without fallbacks). All prior resolutions verified holding. Disposition: minimal revision #5; round 6 hard stop.

- 2026-07-10T17:21:38Z: Design review #6 (sol@xhigh): PASS, no findings. Six rounds total (FAIL x5: null-placeholder back-compat, consultation threading, stranded superseded design, DR-stamp reachability + byte-identical violations, prompt-path omission - all resolved).

- 2026-07-10T17:21:38Z: Recorded design review via codex-task:read-only@gpt-5.6-sol: PASS after 6 rounds; final design: conditional-on-fallbacks everywhere, isSpecialtyLedgerEntry clear seam, shared translateCodexDispatch with prompt passthrough, D7 carve-out for pre-existing fallback-free DR hook rejection

- 2026-07-10T17:21:39Z: Ensured git branch local-board/T20260710T1532Z-config-ordered-fallbackmodels-on-agent-profiles-for-pinned-model-outages (already-current).

- 2026-07-10T17:51:25Z: Completed implement via claude-subagent:local-board-implementer@sonnet: fallbackModels shipped per 6-round design: schema validation, modelAccepted at both seams incl. no-ledger path, conditional threading through begin-step/gate/specialty/DR payloads+stamps, isSpecialtyLedgerEntry clear, translateCodexDispatch sanitized+prompt, skills/docs split prose. Byte-identical legacy shapes tested deep-equal. Suite 565/0/1 (32 new); sync 9/9; board validate 0. Commits b981ff4+a70165a+1905cb0.

- 2026-07-10T17:52:20Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: none requested (config-driven allowlist within already-gated routing; no auth/credential/UI triggers)

- 2026-07-10T17:56:22Z: Completed review via codex-task:read-only@gpt-5.6-terra: changes_requested target implementation: 1 Medium - byte-identical tests assert key sets not full deep-equal shapes (6 cited locations); all functional invariants verified clean statically

- 2026-07-10T17:56:22Z: Invalidated downstream evidence on loop-back to ready_for_implementation: removed completedSteps [implement:claude-subagent:local-board-implementer@sonnet, gate:implement:claude-subagent:local-board-gatecheck@haiku, review:codex-task:read-only@gpt-5.6-terra].

- 2026-07-10T18:09:31Z: Fix pass for review finding: six byte-identical tests strengthened to full deep-equal shapes (39dac82, test-only); exposed and encoded the wholesale agent-profile replacement semantics of loadConfig. Suite 565/0/1.

- 2026-07-10T18:09:31Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Review fix: deep-equal legacy-shape assertions at all six cited locations (39dac82, test-only); suite 565/0/1; production commits b981ff4+a70165a+1905cb0 unchanged

- 2026-07-10T18:10:07Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: none requested (test-only delta)

- 2026-07-10T18:16:15Z: Focused re-review of 39dac82 (terra@medium): pass. Deep-equal shapes concrete for all fallbackModels-relevant fields; scaffold boilerplate sourced from fixture config; nothing weakened.

- 2026-07-10T18:16:15Z: Completed review via codex-task:read-only@gpt-5.6-terra: pass on focused re-review (39dac82); prior full review (terra@high) verified all functional invariants clean
