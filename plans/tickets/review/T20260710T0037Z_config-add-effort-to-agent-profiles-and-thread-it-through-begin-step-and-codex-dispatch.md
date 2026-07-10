---
id: T20260710T0037Z
type: task
status: ready_for_review
priority: P2
parent: null
children: []
blockedBy: [T20260710T0036Z]
blocks: []
branch: local-board/T20260710T0037Z-config-add-effort-to-agent-profiles-and-thread-it-through-begin-step-and-codex-dispatch
estimate: 2
estimateBasis: T20260710T0036Z
workStartedAt: 2026-07-10T01:31:18Z
workCompletedAt: null
created: 2026-07-10T00:36:10Z
updated: 2026-07-10T01:52:33Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku"]
routingApprovals: []
---
# config: add effort to agent profiles and thread it through begin-step and codex dispatch

## Requirement

local-board agent profiles pin a per-step model (`{ route, model?, prompt? }`) but have no reasoning-effort knob. With GPT-5.6's tiered reasoning (and the Claude harness's own per-agent effort option), boards need e.g. `review` routed to `codex-task:read-only` on `gpt-5.6-sol` at `xhigh` while `document` runs `gpt-5.6-luna` at `medium`. Depends on the codex-task wrapper ticket that adds `--reasoning-effort` (blockedBy T20260710T0036Z).

Validated 2026-07-09 against local codex-cli 0.144.1: model IDs `gpt-5.6-sol|terra|luna` all accepted; effort enum is model-dependent (`none|minimal|low|medium|high|xhigh` on terra; sol additionally accepts `max` and `ultra`). Effort values must therefore stay schema-shape-checked only, never enumerated in local-board.

## Scope

1. **Config schema** (`src/config.js`): extend agent profiles to `{ route, model?, effort?, prompt? }`. `effort` is a non-empty token matching the same shape rule as model (`^[A-Za-z0-9][A-Za-z0-9._-]*$`), rejected on `inline` routes (same rationale as model). Applies to `agents.*` and `optionalSteps[].agent` object forms if those accept profiles today (match existing behavior; do not widen otherwise).
2. **begin-step** (`src/cli.js`): surface `configuredEffort` (or null) alongside `configuredAgent`/`configuredModel`.
3. **Codex translation** (`src/codex-dispatch.js`): thread `effort` through `translateCodexDispatch` into the dispatch block (`effort` field, null when unset). No sanitization denylist needed beyond the schema shape — effort names are not Claude/Codex-partitioned the way model aliases are.
4. **Evidence policy**: effort stays OUT of the executor evidence token. `<route>@<model>` composition, `modelSatisfies`, strict routing, `complete-step`, and `gate-complete` are untouched. Effort is a dispatch hint, not routed-work identity.
5. **Skill text**: SKILL.md (and the byte-identical `skills/codex/local-board/SKILL.md` CLI block, per test/skill-usage-sync.test.js) — document the profile field and dispatch rule: for `claude-subagent:*` routes pass effort as the subagent dispatch effort option; for `codex-task:*` routes pass `--reasoning-effort <effort>`.
6. **Docs**: docs/CodexSupport.md Models section gains an Effort paragraph; config comment blocks (`plans/local-board.config.jsonc` scaffold text in config.js) updated.
7. **Tests**: config validation (accepted, rejected-on-inline, shape-rejected), begin-step JSON surface, codex-dispatch threading, and skill-sync remain green.

## Acceptance criteria

- `{ "route": "codex-task:read-only", "model": "gpt-5.6-sol", "effort": "xhigh" }` validates; `begin-step --json` returns `configuredEffort: "xhigh"`; `begin-step --harness codex --json` returns it in `codexDispatch`.
- `{ "route": "inline", "effort": "high" }` is rejected with an actionable message.
- Boards with no `effort` keys behave byte-identically to today (JSON adds only the new null field).
- Evidence recording is unchanged: `complete-step --executor <route> --model <model>` still composes `<route>@<model>`; no effort appears in `completedSteps`.
- `npm run check` and `node --test` pass.

## Non-goals

- No effort enforcement or evidence matching; no schema for allowed effort values (plan/model-dependent, validated by the target harness).
- No change to the gate-check/specialty routing surface beyond profile parity.

## Acceptance Criteria

## Related Tickets

## Technical Design

Add an optional `effort` token to agent profiles and thread it through `begin-step` (`configuredEffort`) and the Codex dispatch block, mirroring the existing `model` field one-for-one. Effort is a dispatch hint only: it never enters evidence tokens, `modelSatisfies`, strict routing, or the active-step ledger.

## Related tickets and conflicts

- **Depends on T20260710T0036Z (DONE, merged).** The codex-task wrapper now accepts `--reasoning-effort <level>` (unvalidated pass-through; echoes `reasoningEffort` in result JSON). That is the dispatch surface `codex-task:*` routes target. No further change to the wrapper is in scope here.
- **Concurrent collision risk — T20260710T0035Z (in review, separate branch).** It touches the same two files this ticket edits:
  - `src/config.js`: adds an exported `codexTaskRoutedActions` function *near the profile code*.
  - `src/cli.js`: adds a `commandValidate` warning.
  - **Mitigation:** all edits here are additive and localized. In `config.js` the only change is inside the existing `normalizeAgentProfile` body (add an `effort` block) plus two scaffold comment lines; do not restructure the surrounding profile region or the exports list. In `cli.js` the only change is inside `commandBeginStep` (pass one extra field into `translateCodexDispatch`); stay out of `commandValidate`. These regions do not overlap, so a merge in either order is a clean additive union.

## Implementation approach

The whole change follows the established `model` field precedent. Every place that already special-cases `model` gains a sibling `effort` treatment, with two deliberate differences: effort has **no** Claude/Codex sanitization denylist (effort names are not harness-partitioned), and effort is **absent** from all evidence/ledger/routing surfaces.

### 1. Config schema (`src/config.js`, `normalizeAgentProfile`, ~line 394-421)

- Destructure `effort` alongside `route, model, prompt`.
- Add a validation block after the `model` block, before `prompt`:
  - If `effort` is `undefined`/`null`, omit it (backward-compatible; boards with no `effort` keys produce byte-identical profiles).
  - Else require `typeof effort === "string"` matching the same shape rule as model: `^[A-Za-z0-9][A-Za-z0-9._-]*$`. Reject with an actionable message, e.g. `agents.${key} effort must be a non-empty reasoning-effort token; got ${JSON.stringify(effort)}`.
  - Reject effort on `inline` routes, same rationale as model: `agents.${key} route "inline" cannot carry an effort; route the step to a subagent to pin reasoning effort`.
  - On success set `profile.effort = effort`.
- Do **not** enumerate effort values (`none|minimal|low|medium|high|xhigh|max|ultra` are model- and plan-dependent; the target harness validates). Shape-only, matching the validated 2026-07-09 codex-cli facts.
- Update the `normalizeAgentProfile` error string on the non-object branch (~line 390) from `{ route, model?, prompt? }` to `{ route, model?, effort?, prompt? }`, and the leading comment block (~line 368).

**`optionalSteps[].agent` is out of scope.** `validateOptionalStepEntry` (~line 570) only accepts a bare route **string**, never a profile object, so there is no profile form to extend there. This matches the ticket's "do not widen otherwise" guard.

### 2. Profile resolution + begin-step surface (`src/tickets.js`)

- Add `effortForAction(config, action)` next to `modelForAction`/`promptForAction` (~line 2244): `return profileForAction(config, action).effort ?? null;`. `profileForAction` already returns the normalized profile, so no other plumbing is needed.
- In `beginStep` (~line 1156): compute `const configuredEffort = effortForAction(config, action);` and add `configuredEffort` to the returned `result` object next to `configuredModel` / `configuredPrompt`.
- **Ledger stamping — intentionally unchanged.** `stampActiveStep` (~line 1175) records `{ ticket, action, route, model, root, ts }` and `check-dispatch` verifies route+model against a later Task dispatch. Effort is not part of dispatch *identity*, so it stays out of the stamp. This keeps `check-dispatch`, its tests, and the ledger shape untouched, and preserves the "effort is a hint, not routed-work identity" invariant. Call this out as an explicit design decision so a reviewer does not "fix" it by adding effort to the stamp.

### 3. Codex dispatch threading (`src/codex-dispatch.js`, `translateCodexDispatch`)

- Add `effort` to the destructured input: `translateCodexDispatch({ route, model, prompt, effort, agentsDir })`.
- Add `effort: effort ?? null` to **every** returned dispatch object (inline, spawn_agent for claude-subagent, native codex-task passthrough, and both unknown/unrecognized branches) so the shape stays uniform. No sanitization: unlike `sanitizeModel`, effort passes through verbatim (or null). Because config rejects effort on inline, the inline branch's effort is null in practice, but include the field for shape uniformity.
- No change to `evidenceExecutor`/`evidenceExecutorFor`/`sanitizeModel` — evidence composition is untouched.

### 4. begin-step CLI wiring (`src/cli.js`, `commandBeginStep`, ~line 599)

- In the `--harness codex` block, pass `effort: result.configuredEffort` into the `translateCodexDispatch({ route, model, prompt, agentsDir })` call.
- JSON `--json` output already serializes the whole `result`, so `configuredEffort` and `codexDispatch.effort` appear automatically.
- Leave the terse non-JSON `codexDispatch:` summary line untouched to minimize the `cli.js` diff near the concurrent ticket. The JSON surface is the contract.

### 5. Evidence policy — no change (verify, do not edit)

`<route>@<model>` composition (`composeExecutor`), `modelSatisfies`, `validateStepRouting`, `complete-step`, `gate-complete`, and `completedSteps` tokens are all untouched. Effort never appears in evidence. This is an explicit non-goal to preserve; the test plan asserts it.

### 6. Skill text (two files; keep the CLI Commands block byte-identical)

- **`SKILL.md` Delegation section (~line 285-289):**
  - Update the profile description: `{ route, model?, prompt? }` -> `{ route, model?, effort?, prompt? }`, and note `begin-step` also resolves `configuredEffort` (or null).
  - Add a dispatch rule sentence per route kind:
    - `claude-subagent:*`: when `configuredEffort` is set, pass it as the subagent dispatch **effort option** at dispatch (the Claude harness's per-agent reasoning-effort control).
    - `codex-task:*`: when `configuredEffort` is set, pass `--reasoning-effort <effort>` to the codex-task wrapper.
    - `inline`: cannot carry effort (parallels the model rule).
- **`skills/codex/local-board/SKILL.md`:** in the Route Translation Contract / Dispatch Rules region, document that the `codexDispatch` block now carries `effort` (null when unset) and that native `codex-task:*` dispatches append `--reasoning-effort <effort>` when it is non-null; claude-subagent Codex spawns pass it as the spawn effort option. Note effort is pass-through (no sanitization, unlike model).
- **CLI Commands fenced block: do NOT touch.** No new command or flag is added to the `local-board` CLI surface (effort rides inside `begin-step --json`), so the byte-identical `## CLI Commands` ```sh block in both SKILL files stays unchanged and `test/skill-usage-sync.test.js` remains green. If any edit ever lands inside that fenced block it must be mirrored verbatim in both files — but the plan is to avoid it entirely.

### 7. Docs + scaffold comments

- **`docs/CodexSupport.md` Models section (~line 81-83):** add an Effort paragraph: agent profiles may pin `effort`; `begin-step --harness codex` surfaces it as `codexDispatch.effort` (null when unset, no sanitization); a non-null effort maps to `--reasoning-effort <effort>` on codex-task routes; effort values are plan/model-dependent and validated by the target harness, never by local-board.
- **`src/config.js` scaffold comment (`defaultConfigJsonc`, ~line 840-845):** extend the "Each entry is a route string or a `{ route, model?, prompt? }` profile" comment to mention `effort` (optional reasoning-effort token, rejected on inline, shape-checked not enumerated). The scaffold `agents` example entries stay as-is (no effort in defaults) to keep boards byte-identical. `DEFAULT_CONFIG` (~line 278) needs no change.

## Affected files

- `src/config.js` — `normalizeAgentProfile` validation + two comment updates. (collision-sensitive; additive only)
- `src/tickets.js` — `effortForAction` helper + `configuredEffort` in `beginStep` result.
- `src/codex-dispatch.js` — `effort` param + `effort` field on all return branches.
- `src/cli.js` — one field into the `translateCodexDispatch` call. (collision-sensitive; stay out of `commandValidate`)
- `SKILL.md`, `skills/codex/local-board/SKILL.md` — Delegation / Dispatch Rules prose (not the CLI Commands block).
- `docs/CodexSupport.md` — Models/Effort paragraph.
- Tests: `test/config.test.js`, `test/codex-dispatch.test.js`, `test/cli.test.js`.

## Risks and edge cases

- **Concurrent-ticket merge conflict** (T20260710T0035Z) in `config.js`/`cli.js`. Mitigated by additive, localized edits (see Related tickets). Highest-risk file is `config.js` if T20260710T0035Z inserts near `normalizeAgentProfile`; the effort block is self-contained inside that function body and should union cleanly.
- **Shape-check drift with the model rule.** Use the exact same regex string so the two validations cannot diverge. Do not refactor the model regex into a shared const if that widens the diff near the collision zone; parity by copy is acceptable here.
- **`translateCodexDispatch` deepEqual tests break.** `test/codex-dispatch.test.js` (inline case ~line 68) asserts the full object with `deepEqual`; adding `effort` changes the shape. Those assertions must be updated to include `effort: null`. Expected, not a regression.
- **Backward compatibility.** Boards with no `effort` keys must be byte-identical except the new null JSON fields (`configuredEffort: null`, `codexDispatch.effort: null`). Assert this explicitly.
- **Inline + effort.** Must be rejected at config load with an actionable message (acceptance criterion). Guard against a future refactor that lets effort reach the inline dispatch branch.
- **No evidence leakage.** A reviewer might add effort to the ledger stamp or evidence token "for completeness". The design forbids it; the test plan pins `completedSteps` unchanged.

## Test plan

Config (`test/config.test.js`), mirroring the existing model tests:
- accepts `{ route: "codex-task:read-only", model: "gpt-5.6-sol", effort: "xhigh" }` and returns the profile with `effort: "xhigh"`.
- accepts effort without model, and model without effort (independence).
- rejects `{ route: "inline", effort: "high" }` with a message matching `/inline.*cannot carry an effort/`.
- rejects a shape-invalid effort (e.g. `"x high"`, `""`, non-string) with `/effort must be/`.
- boards with no effort key: profile has no `effort` property (backward-compat).

Codex dispatch (`test/codex-dispatch.test.js`):
- `effort` threads onto the returned block for claude-subagent, codex-task passthrough, and inline branches (null when unset, verbatim when set).
- update the inline `deepEqual` assertion to include `effort: null`.
- no sanitization: an arbitrary effort token passes through unchanged (contrast with model alias sanitization).

begin-step CLI (`test/cli.test.js`):
- `begin-step --json` returns `configuredEffort: "xhigh"` for an effort-pinned profile, and `null` when unset.
- `begin-step --harness codex --json` returns `codexDispatch.effort` matching (and `configuredEffort` at top level).
- base fields (`configuredAgent`, `configuredModel`) and the active-step ledger stamp are unchanged when effort is present (assert the stamp has no effort field).
- evidence unchanged: `complete-step --executor <route> --model <model>` still composes `<route>@<model>`; no effort in `completedSteps`.

Sync/regression:
- `test/skill-usage-sync.test.js` stays green (CLI Commands block untouched).
- `npm run check` and `node --test` pass.

## Open questions

None blocking. One design decision is recorded rather than asked: effort is deliberately excluded from the active-step ledger stamp and all evidence tokens (dispatch hint, not routed-work identity), consistent with the ticket's Evidence policy scope item.

## Implementation Notes

## Review Findings

Verdict: CONCERNS (codex-task:read-only, gpt-5.6-terra @ reasoning-effort high — first production use of the T20260710T0036Z flag; 123s)

Reviewed commit d3c425d (peer-merge 7fbcf15 and planning commits excluded).

1. [minor — accepted] docs/CodexSupport.md:100: text claims local-board "never enumerates or validates" effort values, but normalizeAgentProfile does shape-validate the token. Fix: state that local-board shape-validates the token locally while the target harness/server validates model support; keep the --reasoning-effort mapping.

2. [minor — accepted] test/codex-dispatch.test.js:79: effort threading is untested on the unknown claude-subagent:* branch and the unrecognized-route fallback; a regression dropping effort from those dispatch shapes would pass. Fix: assert claude-subagent:foo and an unrecognized route return the supplied effort unchanged alongside the existing known:false assertions.

Verified clean by the reviewer: whitespace-only/non-string effort rejected; effort rejected on object-form inline; bare-string profiles cannot carry effort; effortForAction falls back safely; all current translateCodexDispatch branches include effort; ledger stamps carry only ticket/action/route/model/root/timestamp; completion tokens remain action:executor (effort cannot leak); CLI Commands blocks byte-identical; npm run check passed (node --test blocked by read-only sandbox spawn EPERM — environment restriction, covered by implement/test stages).

Disposition: both findings accepted; ticket looped back to ready_for_implementation for the two fixes (loop-back strips implement/gate evidence per invalidateOnLoopBack; this section records the review outcome).

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-10T01:31:18Z: Ensured git branch local-board/T20260710T0037Z-config-add-effort-to-agent-profiles-and-thread-it-through-begin-step-and-codex-dispatch (already-current).

- 2026-07-10T01:37:00Z: Completed design via claude-subagent:local-board-designer@opus: Technical Design written by opus designer: effort mirrors model field (same shape regex, inline rejection, no harness denylist), configuredEffort on begin-step, codexDispatch threading, effort excluded from evidence/ledger by design, additive low-collision edits vs T0035Z. Estimate 2 (basis T20260710T0036Z, designer-recorded).

- 2026-07-10T01:37:42Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: none - config schema field + JSON surface, no auth/UI/UX

- 2026-07-10T01:37:43Z: Ensured git branch local-board/T20260710T0037Z-config-add-effort-to-agent-profiles-and-thread-it-through-begin-step-and-codex-dispatch (already-current).

- 2026-07-10T01:45:45Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Commits 7fbcf15 (clean peer merge of T0035Z) + d3c425d: effort field in normalizeAgentProfile, effortForAction helper, configuredEffort in begin-step, codexDispatch effort threading (null default, no sanitization), skill/docs prose, 7 net new tests. 465 pass/1 skip; check + validate green; ledger/evidence exclusion test-verified.

- 2026-07-10T01:46:26Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: none - internal config parsing and JSON surface; ledger/evidence untouched

- 2026-07-10T01:50:05Z: Invalidated downstream evidence on loop-back to ready_for_implementation: removed completedSteps [implement:claude-subagent:local-board-implementer@sonnet, gate:implement:claude-subagent:local-board-gatecheck@haiku].

- 2026-07-10T01:50:05Z: Ensured git branch local-board/T20260710T0037Z-config-add-effort-to-agent-profiles-and-thread-it-through-begin-step-and-codex-dispatch (already-current).

- 2026-07-10T01:51:53Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Original d3c425d (effort field end-to-end, 7 new tests) + review-fix 75b4116 (docs shape-validation wording; unknown-branch effort assertions). 466 pass/1 skip; check + validate green.

- 2026-07-10T01:52:33Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: none - docs wording + test assertions only
