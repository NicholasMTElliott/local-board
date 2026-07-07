---
id: T20260707T1324Z
type: task
status: implementing
priority: P1
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260707T1324Z-enforce-validate-the-executor-model-suffix-against-configuredmodel-in-strict-routing
estimate: 2
estimateBasis: T20260707T1320Z
workStartedAt: 2026-07-07T16:54:27Z
workCompletedAt: null
created: 2026-07-07T13:24:41Z
updated: 2026-07-07T17:07:26Z
completedSteps: ["design:claude-subagent:local-board-designer@opus"]
routingApprovals: []
---
# enforce: validate the executor model suffix against configuredModel in strict routing

## Requirement

Strict routing validates only the route part of executor evidence: `validateStepRouting` (`src/tickets.js:755-776`) strips the `@model` suffix via `routeOf` (line 1285) and never compares against `configuredModel`. Per-step model pinning — the headline feature of the per-step orchestration redesign — has zero deterministic verification: config says design runs on opus, the orchestrator dispatches sonnet and records `...designer@sonnet`, and validation passes. `docs/PerStepOrchestration.md:109-115` and `docs/CodexSupport.md:53` both document the suffix as ignored.

Fix: when strict routing is on and the step profile pins a model, require the executor token to carry a matching `@model` suffix (or an explicit `approve-inline`-style approval for a deviation). Account for the Codex `@codex-default` convention. Update the two docs and skill texts that describe the suffix as decorative.

Acceptance: `complete-step` with a wrong or missing model suffix on a model-pinned step is rejected under strict routing; Codex translation evidence still passes; tests cover match, mismatch, missing, and codex-default cases.

## Acceptance Criteria

## Related Tickets

## Technical Design

Enforce the executor `@model` suffix against the per-step pinned model at
`complete-step` time under strict routing. Today `validateStepRouting`
(`src/tickets.js:820-841`) compares only the route (`routeOf`, `src/tickets.js:1350-1353`)
and never consults `modelForAction` (`src/tickets.js:1327-1329`), so a step pinned to
`opus` accepts `...designer@sonnet`, a bare `...designer`, or nothing — the headline
per-step-model guarantee has zero deterministic verification.

## Scope and enforcement point

Enforce at **write time only** — inside the `completeStep` call path
(`src/tickets.js:513-557`, which calls `validateStepRouting` at line 526).
Leave **done-time** re-validation (`validateRouting`, `src/tickets.js:796-818`,
calling `validateStepRouting` at line 806) **route-only**, as it is today.

Mechanism: add an opt-in parameter.

- `validateStepRouting(ticket, config, action, executor, { enforceModel = false } = {})`.
- `completeStep` passes `{ enforceModel: true }`.
- `validateRouting` keeps the default (`false`).

Rationale for asymmetry (deliberate, not an oversight):

- `complete-step` is the single deterministic gate through which every new token is
  written; enforcing there catches the wrong-model dispatch at the moment of record.
- Done-time validation exists to guarantee the *presence and route* of required
  evidence and the integrity of already-recorded tokens. Retroactively applying the
  model check there would break existing `done` tickets whose tokens predate this
  rule — e.g. legacy `design:claude-subagent:local-board-designer` (no suffix) on an
  action that config now pins to `opus`, or a token recorded before per-step models
  existed. Those were valid when written; re-litigating them at done-time is
  retroactive breakage the ticket explicitly warns against.
- Going forward every new token flows through `complete-step`, so the gate is
  comprehensive for all newly-recorded evidence without touching history.

## Matching rule

Inside `validateStepRouting`, after the existing route comparison, only run the model
check when the **route matches exactly** (`configuredAgent === executorRoute`). If the
route itself deviates, the existing approved/unapproved route logic owns the outcome and
we do not separately demand a model (a route deviation subsumes the model question, and
`inline` — the common approved deviation — cannot carry a model at all).

When the route matches and `enforceModel` is set:

1. `configuredModel = modelForAction(config, action)`. If `null`, no pin → skip
   (this scopes out `codex-task:read-only`/`workspace-write` in the default config and
   every optional specialty step — see "Specialty steps" below).
2. If `executorRoute === "inline"`, skip (inline never carries a model).
3. `executorModel = modelOf(executor)` (new sibling helper to `routeOf`: the part after
   `@`, or `null`).
4. Accept when `executorModel === configuredModel` **or** `executorModel === "codex-default"`
   (the documented Codex-translation sentinel — see below).
5. Otherwise require an explicit approval: `approvals.includes(stepToken(action, executor))`
   — the *full* executor token including `@model`. This reuses the exact
   `routingApprovals` grammar already consulted for route deviations at line 833.
6. If neither accepted nor approved, push an issue.

New helper (mirror of `routeOf`, `src/tickets.js:1350-1353`):

```js
function modelOf(value) {
  const at = value.indexOf("@");
  return at === -1 ? null : value.slice(at + 1);
}
```

Extract the accept predicate into a small exported helper so future callers
(check-dispatch, hooks — related tickets below) share one source of truth:

```js
export function modelSatisfies(configuredModel, executorModel) {
  return executorModel === configuredModel || executorModel === "codex-default";
}
```

## codex-default

Per `docs/CodexSupport.md:47-53`, when Codex physically runs a Claude-routed step it
records the *logical* route with `@codex-default` because there is no valid Codex model
id to pin. Treat `codex-default` as a wildcard that satisfies **any** pinned model,
regardless of route family. Keying acceptance off a config flag marking "the harness is
Codex" would be fragile (the runtime harness is not reliably reflected in config); the
documented convention is a literal sentinel token, so match it literally. This keeps the
rule simple and matches the docs exactly. (Noted as an open question whether to restrict
it to `claude-subagent:` routes; recommend uniform for simplicity.)

## approve-inline / model-deviation interaction

- An **approved route deviation** (e.g. `inline`) already bypasses the whole check
  because model enforcement only runs on an exact route match. No change needed for the
  existing approved-inline path; the test at `test/tickets.test.js:594-619` stays green.
- To approve a **model** deviation while keeping the configured route (e.g. `opus`
  unavailable, run `sonnet`), the operator needs a `routingApprovals` entry equal to the
  full executor token `design:claude-subagent:local-board-designer@sonnet`. Today
  `approveInline` (`src/tickets.js:491-511`) hardcodes `stepToken(action, "inline")`
  (line 499), so there is no way to author such an approval.

Minimal, in-scope decision: extend `approve-inline` with an **optional** `--executor`
(defaulting to `inline`, preserving today's behavior and CLI shape). It validates via
`isValidAgentValue` and records `stepToken(action, executor)`. This is the smallest
change that keeps the feature from being all-or-nothing, and it reuses the existing
approval matcher verbatim — no new `--model-reason` concept, no new command. CLI:
`src/cli.js:488-504` gains a `takeOption(args, "--executor")` with an `inline` default;
`approveInline` gains an `executor` parameter. Reason stays required.

## Specialty steps (gate-check catalog) — out of scope by construction

Optional specialty step entries (`config.js:471-510`) carry only `{ name, prompt,
triggers, agent? }` — no model field — and their names are not keys in `config.agents`.
So `profileForAction`/`modelForAction` return `null` for them, and step 1 above skips
the model check automatically. The `gate-check` action itself is in `config.agents`
(pinned `haiku`) but is a dispatch, not a `complete-step`-recorded action, so it is never
a `completedSteps` token. No special-casing required; the scope stays tight.

## Error message

Must name the exact expected suffix so the orchestrator can self-correct:

```
${ticket.path}: ${action} completed on model ${executorModel ?? "(none)"}, but
configured model is ${configuredModel}; record --executor
${configuredAgent}@${configuredModel} (or @codex-default for a Codex-translated run),
or approve the deviation with approve-inline --executor ${configuredAgent}@<model>.
```

## Back-compat analysis

- Well-behaved orchestrators already append `@<configuredModel>` per SKILL.md step 10
  (`SKILL.md:35`), so the happy path (`...designer@opus`) passes unchanged.
- Actions with no pinned model (`review`, `document` in default config) are unaffected;
  the existing test `completeStep accepts a route@model executor` (`review` +
  `@gpt-5.5`, `test/tickets.test.js:573-591`) still passes (no pin → no enforcement).
- Existing `done` tickets keep validating: done-time stays route-only.
- Legacy suffix-less tokens on now-pinned actions never re-run through `complete-step`
  and are not re-checked at done-time → no retroactive failure.
- The behavior change is intentional and narrow: a subagent/codex step with a pinned
  model, recorded with a wrong/missing suffix and no approval, is now rejected.

## Implementation approach (current line numbers)

1. `src/tickets.js:820-841` — add `{ enforceModel = false } = {}` param to
   `validateStepRouting`; restructure so route-match is the gate for the new model
   block; add the model check using `modelForAction` + `modelOf` + `modelSatisfies`.
2. `src/tickets.js:526` — `completeStep` passes `{ enforceModel: true }`.
3. `src/tickets.js:806` — `validateRouting` unchanged (default `false`); add a one-line
   comment documenting the deliberate route-only done-time posture.
4. `src/tickets.js` — add `modelOf` (near `routeOf`, 1350) and exported `modelSatisfies`.
5. `src/tickets.js:491-511` + `src/cli.js:488-504` — optional `--executor` on
   `approve-inline`.
6. Docs (acceptance requires): `docs/PerStepOrchestration.md:109-113` and
   `docs/CodexSupport.md:53` stop calling the suffix "ignored"; `SKILL.md:35` and
   `SKILL.md:218` stop saying "matches route only / ignores the @model suffix". Replace
   with: under strict routing, a pinned model requires a matching `@model` (or
   `@codex-default`, or an approved deviation).

## Related tickets and conflicts

- **T20260707T1334Z** (`complete-step --model` composes the token server-side): this
  validation is the enforcement half; T1334Z is the ergonomics half. Once the CLI
  composes `route@model` from `begin-step`'s resolved profile, the recorded token
  matches config by construction, making T1334Z trivial. Seam: keep
  `validateStepRouting` the single authority; T1334Z only changes how the executor
  string is built before `completeStep`. Sequence this ticket first. No conflict.
- **T20260707T1325Z / T20260707T1326Z** (check-dispatch + hooks): both mirror this rule
  pre-dispatch / at hook time. Export `modelSatisfies` (and reuse `modelOf`) so they
  call the same predicate rather than re-implementing it — avoids drift. Potential
  conflict only if they hardcode matching logic; the shared helper prevents it.
- Docs tickets: overlap on the same three files; coordinate so the suffix-is-decorative
  language is removed exactly once.

## Risks

- Orchestrators that dispatch a subagent but omit `@model` are now rejected — the intent,
  but a live behavior change. Mitigated by the explicit error naming the expected suffix
  and by T1334Z removing the footgun.
- The recorded model is still self-reported evidence; "deterministic verification" means
  the token must *match config*, catching honest drift/mistakes, not forgery. State this
  plainly so expectations are calibrated.
- `codex-default` is a genuine wildcard bypass by design; document it so it is not
  mistaken for a hole.

## Test strategy (`test/tickets.test.js`)

- match: `complete-step design --executor claude-subagent:local-board-designer@opus` passes.
- mismatch: `@sonnet` rejected; assert the error names `configured model is opus` and the
  expected suffix.
- missing: bare `claude-subagent:local-board-designer` on opus-pinned `design` rejected.
- codex-default: `@codex-default` passes.
- approved model deviation: `approve-inline design --executor claude-subagent:local-board-designer@sonnet`
  then `complete-step ... @sonnet` passes; assert the approval token round-trips.
- no-pin unaffected: existing `review` + `@gpt-5.5` test stays green.
- done-time back-compat: hand-write a suffix-less token on a model-pinned action, then
  `move ... done` still succeeds (route-only at done-time).
- CLI: `approve-inline` without `--executor` still records `:inline` (regression).

## Open questions

1. Restrict `@codex-default` acceptance to `claude-subagent:` routes, or accept for any
   route family? Recommend uniform (simpler, matches "no valid model id" convention).
2. Include the `approve-inline --executor` extension in this ticket, or split it out?
   Recommend include — without it, model deviations are unapprovable and the feature is
   all-or-nothing.
3. Ever enforce the model at done-time for tokens recorded *after* this change?
   Recommend no (route-only) to keep one enforcement point and preserve back-compat;
   revisit only if evidence tampering becomes a concern.

## Implementation Notes

Implemented exactly per the Technical Design.

`src/tickets.js`:
- `validateStepRouting(ticket, config, action, executor, { enforceModel = false } = {})`: restructured so the route comparison is the gate. On route match with `enforceModel` set and the action's profile pinning a model (`modelForAction`), require `modelOf(executor)` to satisfy `modelSatisfies(configuredModel, executorModel)` (`configuredModel` or `codex-default`) or an exact `routingApprovals` entry for the full `route@model` token; otherwise push an issue naming the expected suffix. `inline` routes are always skipped (cannot carry a model).
- Added `modelOf` (mirrors `routeOf`) and exported `modelSatisfies` for reuse by related tickets (check-dispatch, hooks).
- `completeStep` now calls `validateStepRouting(..., { enforceModel: true })` — the only enforcement point.
- `validateRouting` (done-time) keeps the default `enforceModel: false`; added a comment documenting the deliberate route-only posture for back-compat.
- `approveInline` gained an optional `executor` option (`options.executor`, default `"inline"`), validated via `isValidAgentValue`, recording `stepToken(action, executor)`; `approvedExecutor` in the return value reflects it.

`src/cli.js`:
- `commandApproveInline` takes optional `--executor <executor>` (default `inline`) and passes it through. Usage string updated.

Docs (removed "suffix is ignored" framing, replaced with the enforcement rule and the approval escape hatch): `docs/PerStepOrchestration.md`, `docs/CodexSupport.md`, `docs/Workflow.md`, `SKILL.md` (steps 10 and the completion-evidence section, plus CLI usage line), `skills/codex/local-board/SKILL.md`. `memory-bank/systemPatterns.md` updated with the enforcement rule as current-state fact.

Tests added/updated:
- `test/tickets.test.js`: new tests — match/mismatch/missing suffix on opus-pinned `design`; `@codex-default` wildcard acceptance; `approve-inline --executor` approving a model deviation end-to-end; done-time back-compat with a hand-written suffix-less token on now-pinned actions; `approve-inline` without `--executor` still records `:inline` (regression).
- `test/cli.test.js`: new CLI-level test for `approve-inline --executor` on a model-pinned action (had to add an `estimate` CLI call first since `init`-scaffolded config enables estimation).
- Updated pre-existing tests across `test/tickets.test.js`, `test/cli.test.js`, and `test/git.test.js` that called `completeStep`/CLI `complete-step` on model-pinned actions (`design`→opus, `implement`/`test`→sonnet, `decompose`→opus) with bare (suffix-less) executors — these were previously "well-behaved" only by accident (the model check didn't exist). Added the correct `@<model>` suffix so those tests keep exercising their original intent (estimate gating, done-time gating, atomic-write behavior, etc.) rather than newly tripping the model-enforcement gate. Front-matter serialization quotes any list item containing `@` (per existing `formatString`), so regex assertions on `completedSteps` for these tokens now expect the quoted form, consistent with the pre-existing `@gpt-5.5` test.

Verification:
- `npm run check`: clean (all `node --check` targets pass).
- `npm test`: 185/185 passing (up from 179 before this ticket; +6 new tests).
- `npm run validate`: `Ticket validation OK` — confirms the live board (including this session's own `@opus`/`@sonnet`-suffixed evidence and suffix-less inline approvals) still validates cleanly under the new enforcement.

Deviations from the design: none in behavior. Test-file updates to pre-existing bare-executor `completeStep` calls were necessary but not explicitly enumerated in the ticket's test strategy (which only called out the `review`+`@gpt-5.5` no-pin regression); they were required to keep the suite green given the design's own enforcement rule applies to `design`/`implement`/`test`/`decompose`, all of which are model-pinned in the default config and were exercised bare by unrelated pre-existing tests.

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-07T16:53:42Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): write-time enforceModel flag in validateStepRouting (done-time stays route-only for back-compat), shared modelSatisfies helper for reuse by check-dispatch/hooks, codex-default wildcard honored, approve-inline --executor extension for model deviations, doc updates listed. Estimate 2 (basis T20260707T1320Z).

- 2026-07-07T16:54:27Z: Ensured git branch local-board/T20260707T1324Z-enforce-validate-the-executor-model-suffix-against-configuredmodel-in-strict-routing (created).
