---
id: T20260710T1206Z
type: task
status: ready_for_test
priority: P2
parent: null
children: []
blockedBy: [T20260710T1156Z]
blocks: []
branch: local-board/T20260710T1206Z-config-scaffold-defaults-ship-gpt-5-6-pins-for-review-and-security-specialty-steps
estimate: 2
estimateBasis: T20260710T1156Z
workStartedAt: 2026-07-10T13:11:07Z
workCompletedAt: null
created: 2026-07-10T12:06:56Z
updated: 2026-07-10T13:32:20Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", "review:codex-task:read-only@gpt-5.6-terra"]
routingApprovals: []
---
# config: scaffold defaults ship GPT-5.6 pins for review and security specialty steps

## Requirement

User decision (2026-07-10, overriding the plan-portability caution): the init scaffold's delivered routing defaults should ship GPT-5.6 pins, matching this board's live config. New boards scaffolded by local-board init get them out of the box.

## Scope

All changes in src/config.js defaultConfigJsonc() (the init scaffold), NOT DEFAULT_CONFIG (the ENOENT/deep-merge fallback — leave that unpinned for backward compat; the guard test in test/config.test.js keeps the two defaults' structure in sync and must be updated deliberately for this intentional divergence in values):

1. Scaffold agents.review becomes { "route": "codex-task:read-only", "model": "gpt-5.6-terra", "effort": "high" }.
2. Scaffold optionalSteps design/security_threat_model and impl/security_audit entries gain agent profiles { "route": "codex-task:read-only", "model": "gpt-5.6-sol", "effort": "xhigh" } — DEPENDS on T20260710T1156Z (optionalSteps profile support); blockedBy records this.
3. Scaffold config comment text documents the pins and names the escape hatch (delete model/effort keys, or reroute, if the plan lacks GPT-5.6; codex validates server-side and the T20260710T0035Z validate warning plus the codex-task failure hint cover the missing/unsupported cases).
4. docs: docs/CodexSupport.md and docs/specialty-steps.md note the scaffolded pins and how to remove them.

## Acceptance criteria

- Fresh local-board init in a temp repo produces a config whose review profile carries gpt-5.6-terra/high and whose two security specialty entries carry gpt-5.6-sol/xhigh, and local-board validate passes on the scaffolded board.
- Boards with existing configs are untouched (init never overwrites existing config).
- DEFAULT_CONFIG fallback behavior unchanged; the defaults-sync guard test updated with an explicit allowlist for the intentional value divergence.
- npm run check and node --test pass.

## Non-goals

- No change to this repo's own plans/local-board.config.jsonc (already pinned, commit 20edd13).
- No scaffold default for the design-review step (separate ticket; it adds its own scaffold entry when it lands).
- No model-availability probing at init time (server-side validation + the existing detection warning are the guardrails).

## Acceptance Criteria

## Related Tickets

## Technical Design

## Overview

Ship GPT-5.6 routing pins in the **init scaffold only** (`defaultConfigJsonc()` in
`src/config.js`), leaving `DEFAULT_CONFIG` (the ENOENT fallback / deep-merge base)
unpinned for backward compat. Three config edits, one guard-test allowlist update,
two existing-assertion fixes, a new init-in-temp-repo acceptance test, and two doc
notes. No production *logic* changes — this is data + comment text + test surgery.
The dependency (T20260710T1156Z) is merged, so `optionalSteps[].agent` already
accepts `{ route, model?, effort? }` profiles and `agents.<action>` already accepts
`effort`; `normalizeAgentProfile` validates all three fields. No normalizer changes
are needed — the pins use grammar the loader already supports.

## Related tickets and conflicts

- **blockedBy T20260710T1156Z — DONE, merged.** This worktree branched after that
  merge. `normalizeOptionalStepAgent` and the collision/duplicate validation are
  present. The pin values in this design are byte-identical to shapes already
  covered by existing passing tests (`test/config.test.js` lines 134-149 for
  `agents.review` effort, 485-507 for the `optionalSteps[].agent` profile), so no
  new normalizer behavior is exercised.
- **T20260710T1220Z — in review, separate branch.** It adds
  `routing.requireDesignReview` (false in `DEFAULT_CONFIG`, true in the scaffold)
  and an `agents["design-review"]` profile `{ route: "codex-task:read-only",
  model: "gpt-5.6-sol", effort: "xhigh" }` added *identically to both* defaults.
  **Expected merge points at its closeout** (all additive, no logical conflict):
  1. `src/config.js` `agents` block — both defaults gain a new `design-review`
     key; this ticket only touches the `review` value. Different keys, textual
     adjacency only.
  2. `src/config.js` `routing` block + `DEFAULT_CONFIG` header comment — 1220Z adds
     a seventh backward-compat flag; independent of this ticket's value pins.
  3. `test/config.test.js` guard test — 1220Z adds `routing.requireDesignReview`
     to the same `expected.*` assignment list and the same `collapsed` diff array
     this ticket edits. Both are sorted-array / assignment-list insertions; resolve
     by keeping both entries in sorted order (see Test strategy for the exact final
     array so the merge is mechanical).
  Design these edits as pure additions so the 1220Z merge is a two-line insert per
  site, not a rewrite.

## Implementation approach

### Edit 1 — scaffold `agents.review` pin

In `defaultConfigJsonc()` (currently line 967), change:

```jsonc
"review": { "route": "codex-task:read-only" },
```
to:
```jsonc
"review": { "route": "codex-task:read-only", "model": "gpt-5.6-terra", "effort": "high" },
```

`DEFAULT_CONFIG.agents.review` (line 275) stays `{ route: "codex-task:read-only" }`
— untouched. This is the intentional value divergence the ticket calls out.

### Edit 2 — scaffold security specialty `agent` profiles

In `defaultConfigJsonc()` `optionalSteps`, add an `agent` field to two entries.
`design/security_threat_model` (after its `triggers`, line ~1083):

```jsonc
{
  "name": "security_threat_model",
  "prompt": "plans/prompts/optional-steps/design/security_threat_model.md",
  "triggers": "Auth, authorization, cryptography, external API integrations, PII handling, new attack surface.",
  "agent": { "route": "codex-task:read-only", "model": "gpt-5.6-sol", "effort": "xhigh" }
},
```

`implement/security_audit` (line ~1098) gains the same `agent` line (keep the long
`triggers` string unchanged; append `,` + the `agent` line). The other three
entries (`ui_component_review`, `ux_interaction_review`, `ui_visual_review`) stay
inline — no `agent` field. `DEFAULT_CONFIG.optionalSteps` stays all-empty arrays.

### Edit 3 — scaffold comment text (the pins + escape hatch)

Two comment sites in `defaultConfigJsonc()`:

- The `agents` block comment (currently lines 953-961): add a sentence naming the
  shipped pins and the escape hatch, e.g.:
  > New boards ship `review` pinned to `gpt-5.6-terra`/`high` and the two security
  > specialty steps pinned to `gpt-5.6-sol`/`xhigh`. If your plan lacks GPT-5.6,
  > delete the `model`/`effort` keys (falls back to the plan's default model) or
  > reroute the step; Codex validates the model server-side, and `local-board
  > validate` plus the `codex-task` failure hint surface a missing/unsupported
  > model.
- The `optionalSteps` block comment (currently lines 1065-1077): add a short note
  that the two `security_*` entries ship pinned to `gpt-5.6-sol`/`xhigh` and point
  back to the same escape hatch (delete `model`/`effort` or reroute).

Keep both notes terse; they are documentation of an intentional default, not a
tutorial.

### Edit 4 — `DEFAULT_CONFIG` header comment (lines 8-51)

Add one bullet to the enumerated divergence list documenting that scaffold
`agents.review` carries a `gpt-5.6-terra`/`high` pin (and the security specialties
carry `gpt-5.6-sol`/`xhigh`) while `DEFAULT_CONFIG` stays unpinned. Unlike the
existing bullets (which are backward-compat *flags*), note this is a deliberate
**value** divergence: the fallback stays model-agnostic so ENOENT/omitted-block
boards never inherit a model that their plan may not offer. This keeps the header
comment and the guard-test comment honest about *why* the allowlist grows.

## Affected files

- `src/config.js` — `defaultConfigJsonc()` (edits 1-3) and the `DEFAULT_CONFIG`
  header comment (edit 4). **`DEFAULT_CONFIG` data is not touched.**
- `test/config.test.js` — guard-test allowlist (edit 5) + existing-assertion fixes
  (edit 6) + new acceptance test (edit 7). See Test strategy.
- `docs/CodexSupport.md` — note the scaffolded pins + removal (edit 8).
- `docs/specialty-steps.md` — note the two security entries ship pinned + removal
  (edit 9).

## Test strategy

### The guard test — exact allowlist changes

`test/config.test.js` "defaultConfigJsonc matches DEFAULT_CONFIG except for
documented differences" (line 309) does two things; both must change:

1. **First assertion** (`assert.deepEqual(scaffolded, expected)`): `expected` is
   `structuredClone(DEFAULT_CONFIG)` with documented divergences applied. Note
   `expected.optionalSteps = scaffolded.optionalSteps` (line 346) **already absorbs
   the security-entry `agent` additions wholesale** — no allowlist change is needed
   for Edit 2. Only the `agents.review` value divergence needs a new line, mirroring
   the existing pattern:
   ```js
   expected.agents.review = scaffolded.agents.review;
   ```
   (or, equivalently, set `.model`/`.effort` explicitly). Placing it as an
   assignment keeps it robust to the exact pin values.

2. **Second assertion** (the `collapsed` sorted-diff array, lines 358-372): guards
   against the allowlist silently masking drift. `leafDiffPaths(DEFAULT_CONFIG,
   scaffold)` now yields two new leaf paths — `agents.review.model` and
   `agents.review.effort` (route matches; model/effort are undefined in
   `DEFAULT_CONFIG`). The `optionalSteps.*.agent` diffs still collapse to
   `"optionalSteps"` via the existing `.map` collapse, so Edit 2 adds nothing here.
   The final array must become (sorted):
   ```js
   assert.deepEqual(collapsed, [
     "agents.review.effort",
     "agents.review.model",
     "estimation.enabled",
     "git.commitPlanningOnTransition",
     "optionalSteps",
     "routing.enforceTransitions",
     "routing.guardPrematureEvidence",
     "routing.invalidateOnLoopBack",
     "routing.requireGateConsultation",
     "worktrees.guardWrongRoot",
   ]);
   ```
   Also update the guard-test's own explanatory comment (lines 313-344) to add the
   `agents.review` value-divergence bullet and bump the "these eight paths" count
   language (it becomes ten leaf paths / nine collapsed entries). This is the
   deliberate allowlist edit the acceptance criteria require.

### Existing assertions that break and must be fixed

1. "loadConfig reads the commented default config" (line 43) asserts
   `config.agents.review` deepEquals `{ route: "codex-task:read-only" }` (line 59).
   This loads `defaultConfigJsonc()`, so the pin breaks it. Update to:
   ```js
   assert.deepEqual(config.agents.review, {
     route: "codex-task:read-only", model: "gpt-5.6-terra", effort: "high",
   });
   ```
2. "loadConfig parses the v1 optionalSteps catalog from the default config"
   (line 250): its loop at lines 272-276 asserts *no* entry sets `agent`. That now
   fails for the two security entries. Fix it to assert `security_threat_model`
   (design) and `security_audit` (implement) carry the `{ route:
   codex-task:read-only, model: gpt-5.6-sol, effort: xhigh }` profile and the other
   three specialties remain agent-less.

### New acceptance test — init in a temp repo

Add a test exercising the real `init` scaffold end to end (acceptance criterion 1),
mirroring the file's `withRoot` helper:

1. `withRoot` temp dir; write the scaffold via `writeDefaultConfig(root)` (the real
   scaffold writer) — or `defaultConfigJsonc()` + `writeConfig` if avoiding fs
   plumbing — then `loadConfig(root)`.
2. Assert `config.agents.review` deepEquals the terra/high profile.
3. Assert the `security_threat_model` (design) and `security_audit` (implement)
   entries' `.agent` deepEqual the sol/xhigh profile; assert the other three
   specialties have no `agent`.
4. Assert `loadConfig` does not throw (the profile grammar is valid), implicitly
   proving `validate` would pass on the scaffolded board. Optionally add a
   CLI-level `validate` invocation against the temp root for the literal "validate
   passes" wording if the suite already shells the CLI; otherwise prefer the
   in-process `loadConfig` assertion to keep the unit test hermetic.

### Regression / full-suite

- `codexTaskRoutedActions` already covers object-form codex routes in both `agents`
  and `optionalSteps` (lines 629-657); the pins are inert to it (route unchanged),
  so no new codex-detect test is required. A quick manual check that the scaffold
  still reports `review`, `document`, `security_threat_model (design)`,
  `security_audit (implement)` is worthwhile.
- Run `npm run check` and `node --test` (acceptance criterion 4).

## Risks and edge cases

- **Guard-test double-guard is the main trap.** Editing only the first assertion
  and forgetting the `collapsed` array (or vice versa) fails the suite. Both edits
  are specified above verbatim to make this mechanical.
- **`optionalSteps` wholesale absorption is easy to over-correct.** Do *not* add an
  `optionalSteps`-related entry to the `collapsed` array for the new `agent`
  fields — they already collapse to the existing `"optionalSteps"` entry. Adding a
  second would itself trip the `deepEqual`.
- **Two pre-existing assertions break** (line 59 and the 272-276 loop). Both are
  fixes, not new tests; missing either fails `node --test` even though the guard
  test passes.
- **Backward compat is preserved by construction** — no `DEFAULT_CONFIG` data
  changes, so every "backward-compat disabled" test and the ENOENT-fallback path
  are untouched. `init` never overwrites an existing config (`writeDefaultConfig`
  uses the `wx` flag unless `overwrite`), so criterion 2 (existing boards untouched)
  needs no code change.
- **Plan portability** — the user explicitly overrode this caution; server-side
  Codex validation + the existing detection/validate warnings are the guardrails,
  and the escape-hatch comment tells operators how to drop the pins. No init-time
  model probing (non-goal).
- **1220Z merge** — keep edits additive (see Related tickets) so its closeout is a
  sorted-insert, not a rewrite.

## Open questions

None blocking. One judgment call left to implementation: whether the new acceptance
test shells out to `validate` for the literal "validate passes" wording or proves
it in-process via `loadConfig` not throwing. Recommend in-process for hermeticity;
either satisfies the criterion.

## Implementation Notes

## Implementation Notes

Implemented exactly per the Technical Design (no deviations from the design's edit plan):

- `src/config.js`: `defaultConfigJsonc()` `agents.review` now `{ route: "codex-task:read-only", model: "gpt-5.6-terra", effort: "high" }`; `design/security_threat_model` and `implement/security_audit` optionalSteps entries gained `agent: { route: "codex-task:read-only", model: "gpt-5.6-sol", effort: "xhigh" }`; agents-block and optionalSteps-block scaffold comments document the pins + escape hatch; `DEFAULT_CONFIG` header comment gained the `agents.review` value-divergence bullet. `DEFAULT_CONFIG` data untouched.
- `test/config.test.js`: guard-test allowlist updated (`expected.agents.review = scaffolded.agents.review` plus `agents.review.effort`/`agents.review.model` in the sorted `collapsed` array, now 11 leaf paths / 10 collapsed entries after also absorbing the sibling T20260710T1220Z `requireDesignReview` insert); fixed the two flagged pre-existing assertions (`loadConfig reads the commented default config` line ~59, and the v1 optionalSteps-catalog no-agent loop, now asserting the two security entries carry the sol/xhigh profile); added new test "init scaffold in a temp repo ships the GPT-5.6 pins and loads without error" using `writeDefaultConfig` + `loadConfig`.
- `test/cli.test.js` and `test/tickets.test.js`: fixed CLI/tickets tests that exercised the real scaffold and asserted the old unpinned/inline behavior for `agents.review`, `security_threat_model`, and `security_audit` (model-pin enforcement on `complete-step` now requires `@gpt-5.6-terra`/`@gpt-5.6-sol` executor suffixes on these three call sites; not called out explicitly in the design's file list but required to keep `npm test` green against the real scaffold).
- `docs/CodexSupport.md` and `docs/specialty-steps.md`: noted the shipped pins and the escape hatch (delete `model`/`effort` keys or reroute).

STEP 0 sibling merge: `local-board/T20260710T1220Z-...` merged cleanly with **zero conflicts** (git auto-merged `src/config.js` and `test/config.test.js`); the design's enumerated merge points (agents block, routing block, guard-test allowlist) all landed as clean additive inserts as predicted. Baseline after merge was 3 pre-existing failures (2 `install.test.js` PATH-verification tests, B20260710T1232Z, plus one `cli.test.js:2031` "estimation prompts" failure present on both parent branches pre-merge, unrelated to this ticket or the sibling).

Final `npm test`: 497 tests, 493 pass, 3 fail (the same 3 baseline failures, confirmed unchanged in count and identity). `npm run check` clean. `node ./bin/local-board.js validate --root <worktree>` -> "Ticket validation OK".

## Review Findings

verdict: pass

(codex-task:read-only, gpt-5.6-terra @ reasoning-effort high, 150s — reviewed commit dce310c; peer merge and planning commits excluded)

No findings.

Reviewer-verified:

- Defaults-sync allowlist matches the actual leaf diff exactly (only agents.review.model/.effort diverge); DEFAULT_CONFIG keeps route-only review and empty optionalSteps arrays, so mergeConfig cannot leak GPT-5.6 pins into boards that omit those blocks.
- Scaffold JSONC parses and normalizes cleanly; executor-suffix test updates are the required consequence of write-time model enforcement, not regression masks.
- Scaffold comments + docs/CodexSupport.md + docs/specialty-steps.md state the pins and the removal/reroute escape hatch accurately; T0035Z detection covers prerequisites while unavailable-model rejection stays server-side.

Residual risk: acceptance coverage is distributed across config/CLI tests rather than one direct init-plus-validate CLI assertion; reviewer sandbox could not run the suite (fixture spawning blocked) — verification stays with the test stage.

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-10T13:11:07Z: Ensured git branch local-board/T20260710T1206Z-config-scaffold-defaults-ship-gpt-5-6-pins-for-review-and-security-specialty-steps (already-current).

- 2026-07-10T13:15:59Z: Completed design via claude-subagent:local-board-designer@opus: Technical Design: scaffold-only pins (review terra@high, security specialties sol@xhigh), DEFAULT_CONFIG unpinned, exact guard-test allowlist mechanics (agents.review line + 2 collapsed paths) with 2 pre-existing assertions flagged for update, escape-hatch comment, init-in-temp-repo test plan, T1220Z merge points enumerated. Estimate 2 (basis T20260710T1156Z, designer-recorded).

- 2026-07-10T13:16:46Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: none - config default values, comments, tests, docs

- 2026-07-10T13:16:47Z: Ensured git branch local-board/T20260710T1206Z-config-scaffold-defaults-ship-gpt-5-6-pins-for-review-and-security-specialty-steps (already-current).

- 2026-07-10T13:27:53Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Commits (peer merge clean) + dce310c: scaffold agents.review terra@high, both security specialties sol@xhigh, escape-hatch comments, DEFAULT_CONFIG unpinned, guard allowlist combined with sibling insert, init-in-temp-repo test, executor-suffix test updates (necessary consequence of pin enforcement). 493 pass + branch baseline (3rd failure is the estimate-prompt assertion already fixed on mainline post-branch).

- 2026-07-10T13:29:13Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: none - config default values/comments/tests/docs; no execution-gating surface

- 2026-07-10T13:32:20Z: Completed review via codex-task:read-only@gpt-5.6-terra: verdict: pass, no findings. Allowlist exact, merge-leak impossibility traced, escape hatch accurate.
