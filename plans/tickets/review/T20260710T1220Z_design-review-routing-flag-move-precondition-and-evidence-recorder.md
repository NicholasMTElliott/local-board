---
id: T20260710T1220Z
type: task
status: ready_for_review
priority: P2
parent: S20260710T1206Z
children: []
blockedBy: []
blocks: [T20260710T1222Z]
branch: local-board/T20260710T1220Z-design-review-routing-flag-move-precondition-and-evidence-recorder
estimate: 2
estimateBasis: T20260710T0037Z
workStartedAt: 2026-07-10T12:22:11Z
workCompletedAt: null
created: 2026-07-10T12:20:25Z
updated: 2026-07-10T13:13:02Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", "review:codex-task:read-only@gpt-5.6-terra"]
routingApprovals: []
---
# design-review: routing flag, move precondition, and evidence recorder

## Requirement

Parent S20260710T1206Z adds a design-review step gated on the design -> ready_for_implementation forward move, mirroring the requireGateConsultation pattern (mechanism decision recorded in the parent's decomposition). This task lands the config surface and all src/config.js + src/tickets.js logic; the CLI task and skill/docs task build on it.

## Scope

- src/config.js: add routing.requireDesignReview — false in DEFAULT_CONFIG (ENOENT fallback / deep-merge base), true in defaultConfigJsonc() (init scaffold), with an explanatory comment matching the six existing backward-compat flags. Add an agents["design-review"] default profile { "route": "codex-task:read-only", "model": "gpt-5.6-sol", "effort": "xhigh" } to BOTH DEFAULT_CONFIG and defaultConfigJsonc() identically (the agents block is a shared, non-allowlisted block in the guard test, so the two copies must match). normalizeAgents/normalizeAgentProfile already validate route+model+effort — confirm the profile normalizes cleanly.
- src/tickets.js:
  - Recognize design-review as a known routed action: isKnownAction/configuredRouteForAction/profileForAction must resolve it via agents["design-review"] even though it is absent from statusActions.
  - Add a design -> implementation precondition in moveTicket, active only when config.routing.requireDesignReview === true, refusing the forward move (from ready_for_design/designing to ready_for_implementation) when no design-review:<executor> token is present in completedSteps. The refusal must be a hard error naming the missing step and the command to run (parallel to the gate-consultation refusal at src/tickets.js:715). It must run in the same "no side effects on refusal" position as the gate check, and must never gate backward/lateral/archive moves.
  - Add a recorder (e.g. recordDesignReview(root, ticketId, executor, evidence, options)) that composes the design-review:<executor>@<model> token, runs validateStepRouting with model enforcement so the model pin is enforced (codex-default wildcard via modelSatisfies), applies the guardPrematureEvidence check, appends a Run Log line, and writes atomically under withTicketLock. Effort is a dispatch-time hint only and must never enter the executor token/evidence.
  - Extend producingStatusForToken so a design-review token maps to ready_for_design, making invalidateDownstreamEvidence (loop-back) and evidenceStrippedByPendingForwardMove (premature-evidence guard) treat design-review evidence consistently with design evidence. A FAIL loop-back to ready_for_design must strip the design-review token so a re-run re-records fresh evidence.
  - Do NOT add design-review to routing.doneRequires (deliberate: doneRequires is not conditional on the flag; adding it would break byte-identical behavior for boards with the feature off).

## Acceptance criteria

- With requireDesignReview: true, move <id> ready_for_implementation from ready_for_design/designing is refused (hard error naming the missing design-review step) until a design-review token is recorded; then it succeeds.
- With requireDesignReview omitted/false, the same move and all moveTicket/evidence behavior are byte-identical to today (new test/config.test.js backward-compat-disabled case for the flag; agents["design-review"] is inert when the flag is off).
- The recorder enforces the configured model pin (gpt-5.6-sol; codex-default accepted; a mismatched model is refused with the same shape as complete-step's model gate) and rejects empty evidence; effort never appears in the token.
- A loop-back move <id> ready_for_design (with invalidateOnLoopBack: true) strips the design-review token and enumerates it in the Run Log line, exactly as design/action tokens are stripped.
- test/config.test.js "defaultConfigJsonc matches DEFAULT_CONFIG except for documented differences" passes with routing.requireDesignReview added to the allowlist (and only that path added).
- npm run check and node --test pass.

## Non-goals

No CLI commands (sibling CLI task). No prompt file (sibling prompt task). No skill/docs text (sibling docs task). No second reviewer, no human-approval gate, no doneRequires entry.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Related Tickets

- Parent story **S20260710T1206Z** (done): chose mechanism (b) — a
  `requireGateConsultation`-style stage-scoped required step, not a new pipeline
  status — and deliberately excluded design-review from `routing.doneRequires`.
- **T20260710T1156Z** (concurrent, same two files): edits `normalizeAgentProfile`
  and `profileForAction`. This design is deliberately additive and does **not**
  touch either of those functions (see Merge coordination below).
- **T20260710T1222Z** (blocked by this): CLI verbs (`design-review` begin/record).
  Relies on the `isKnownAction`/`configuredRouteForAction` recognition and the
  `recordDesignReview` recorder landed here.
- **T20260710T1221Z** (prompt/scaffold), **T20260710T1223Z** (skills/docs): no
  code dependency on this ticket beyond the config surface.

## Implementation approach

Mirror the existing `requireGateConsultation` triad exactly: a config flag, a
scoped hard precondition in `moveTicket`, and an atomic recorder modeled on
`recordGateConsultation`/`completeStep`. Reuse the established
producing-status/pipeline-rank machinery so loop-back stripping and the
premature-evidence guard treat design-review evidence identically to design
evidence. No new architecture, no new pipeline status, no `doneRequires` entry.

### Token grammar

The design-review evidence token lives in `completedSteps` and reuses
`stepToken(action, executor)`:

```
design-review:<executor>            e.g. design-review:codex-task:read-only
design-review:<executor>@<model>    e.g. design-review:codex-task:read-only@gpt-5.6-sol
```

Parsing facts that make this safe with the existing splitters:
- It does **not** start with `gate:`, so `GATE_TOKEN_RE`/`isGateToken` ignore it;
  it is therefore a routing-evidence record, not a gate token.
- `completedStepRecords` splits on the **first** `:`, yielding
  `action = "design-review"`, `executor = "codex-task:read-only@gpt-5.6-sol"`
  (the executor legitimately contains a second `:` and an `@model`, exactly like
  a `codex-task:read-only@model` executor already does elsewhere).
- Effort (`xhigh`) is a dispatch-time hint only and **never** appears in the
  token or evidence.

### src/tickets.js changes

1. **New constant** near the top, beside `GATE_TOKEN_RE`:
   ```js
   const DESIGN_REVIEW_ACTION = "design-review";
   ```

2. **`isKnownAction`** — recognize design-review even though it is absent from
   `statusActions` and `optionalSteps`:
   ```js
   function isKnownAction(config, action) {
     if (action === DESIGN_REVIEW_ACTION) return true;
     const actions = new Set(Object.values(config.workflow.statusActions));
     return actions.has(action) || optionalStepEntry(config, action) !== null;
   }
   ```
   This is what lets `validateStepRouting` (and the sibling CLI's
   `actionOverride`/`assertAction`) accept the action.

3. **`configuredRouteForAction`** — route design-review through the agents map:
   ```js
   function configuredRouteForAction(config, action) {
     const actions = new Set(Object.values(config.workflow.statusActions));
     if (action === DESIGN_REVIEW_ACTION || actions.has(action)) {
       return agentForAction(config, action);
     }
     const entry = optionalStepEntry(config, action);
     return entry ? entry.agent ?? "inline" : "inline";
   }
   ```
   `profileForAction`/`agentForAction`/`modelForAction`/`effortForAction` need
   **no change**: they already resolve `config.agents["design-review"]` via the
   generic `config.agents[action]` lookup. This is the deliberate structural
   seam with the sibling ticket (see Merge coordination).

4. **`producingStatusForToken`** — map a design-review token to
   `ready_for_design` so the loop-back stripper and premature-evidence guard
   treat it as design-stage evidence. Add immediately after the `gateMatch`
   block, before the generic first-`:` split resolves an action:
   ```js
   const separator = token.indexOf(":");
   const action = separator === -1 ? token : token.slice(0, separator);
   if (action === DESIGN_REVIEW_ACTION) {
     return STAGE_TO_STATUS.design; // ready_for_design
   }
   ```
   Consequence: `invalidateDownstreamEvidence` (loop-back) and
   `evidenceStrippedByPendingForwardMove` (premature guard) both place the token
   at `ready_for_design` rank with zero further changes, because both already
   route through `producingStatusForToken`.

5. **New move predicate** beside `gateStageForForwardMove`:
   ```js
   const DESIGN_REVIEW_FROM = new Set(["ready_for_design", "designing"]);
   function isDesignReviewGatedMove(fromStatus, toStatus) {
     return DESIGN_REVIEW_FROM.has(fromStatus) && toStatus === "ready_for_implementation";
   }
   function hasDesignReviewToken(ticket) {
     return asList(ticket.frontMatter.completedSteps).some(
       (token) => token === DESIGN_REVIEW_ACTION
         || token.startsWith(`${DESIGN_REVIEW_ACTION}:`),
     );
   }
   ```

6. **`moveTicket` precondition** — placed **immediately after the
   gate-consultation block (current src/tickets.js:711-722) and before the
   loop-back invalidation block (:724)**, i.e. in the identical "no side effects
   on refusal" window as the two existing hard gates. `moveTicket` performs no
   fs mutation until the `mkdir`/`rename` block near the end, so a throw here
   leaves the board byte-identical. Ordering rationale: `enforceTransitions`
   (structural) -> gate-consultation -> **design-review** -> loop-back strip ->
   render/write. Gate-consultation and design-review both guard the
   design->implementation move and are mutually independent hard throws; ordering
   between them is cosmetic (design-review second keeps the pre-existing
   gate error surfacing first for boards that enable both).
   ```js
   if (isDesignReviewGatedMove(ticket.status, status) && config.routing?.requireDesignReview === true) {
     if (!hasDesignReviewToken(ticket)) {
       throw new Error(
         `${ticket.path}: move refused: ticket ${ticket.id} has no recorded design review. ` +
           `Run the design-review step and record it with ` +
           `"design-review ${ticket.id} --executor <route> --evidence <summary>" before moving to ${status}.`,
       );
     }
   }
   ```
   The command name in the message anticipates the sibling CLI verb; the recorder
   API name is `recordDesignReview`. Never gates backward/lateral/archive moves
   because `isDesignReviewGatedMove` returns true only for the two forward pairs.

7. **New recorder `recordDesignReview(root, ticketId, executor, evidence, options)`**
   — modeled on `completeStep` (not `recordGateConsultation`, because it must run
   `validateStepRouting` with model enforcement and the premature-evidence
   guard). Signature and validation order:
   ```
   1. if evidence.trim() === "" -> throw "design-review requires non-empty evidence"
   2. if options.override === true && (options.overrideReason ?? "").trim() === ""
        -> throw "design-review --override requires a non-empty overrideReason"
   3. config = await loadConfig(root)
   4. if !isValidAgentValue(executor) -> throw "executor must be one of ..."
   5. withTicketLock(root, ticketId, async () => {
        findTicket; (__afterRead hook for tests)
        token = stepToken(DESIGN_REVIEW_ACTION, executor)
        routingIssues = validateStepRouting(ticket, config, DESIGN_REVIEW_ACTION, executor, { enforceModel: true })
          -> throw on non-empty (this is the model-pin gate: same shape as
             complete-step's "completed on model X, but configured model is Y")
        if config.routing?.guardPrematureEvidence === true:
          check = evidenceStrippedByPendingForwardMove(ticket, config, token)
          if check.stripped: override-or-throw exactly like completeStep
        frontMatter.completedSteps = addUnique(..., token)  // via withUpdated
        Run Log: "Recorded design review via <executor>: <evidence>"
          (+ premature-evidence override line when overridden, mirroring completeStep)
        writeTicketFile(atomic)
      })
   6. await clearActiveStep(root, ticketId).catch(() => {})
   ```
   Model enforcement path: `validateStepRouting` with `enforceModel: true`
   resolves `configuredRouteForAction` = `codex-task:read-only`,
   `modelForAction` = `gpt-5.6-sol`, and accepts an executor model of
   `gpt-5.6-sol` or the `codex-default` wildcard via `modelSatisfies`; any other
   `@model` is refused with the existing "completed on model ... but configured
   model is ..." message. Effort is never read here, so it cannot leak into the
   token or evidence.

### src/config.js changes

Both `DEFAULT_CONFIG` and `defaultConfigJsonc()` get an **identical**
`agents["design-review"]` entry (the `agents` block is a shared, non-allowlisted
block in the guard test, so the two copies must be byte-identical after JSONC
parse), and diverge only on the new `routing.requireDesignReview` flag.

**`DEFAULT_CONFIG` (ENOENT fallback / deep-merge base):**
- `agents`: add
  `"design-review": { route: "codex-task:read-only", model: "gpt-5.6-sol", effort: "xhigh" },`
- `routing`: add `requireDesignReview: false,` (backward-compat OFF, beside the
  other five backward-compat flags).
- Extend the block comment on `DEFAULT_CONFIG` with a
  `routing.requireDesignReview` bullet in the six-flag style: "false here (vs
  true in the scaffold) so a pre-existing config that omits the key does not
  silently start refusing the design->implementation forward move."

**`defaultConfigJsonc()` (init scaffold):**
- `agents` block: add identical
  `"design-review": { "route": "codex-task:read-only", "model": "gpt-5.6-sol", "effort": "xhigh" }`
  (adjust the trailing comma on the preceding line to keep valid JSONC).
- `routing` block: add `"requireDesignReview": true` with an explanatory comment
  matching the `requireGateConsultation` comment style, e.g. "requireDesignReview:
  true refuses 'move' out of ready_for_design/designing toward
  ready_for_implementation unless a design-review:<executor> token is recorded in
  completedSteps (via the design-review recorder). Backward, lateral, and
  archive/done moves are never gated. Set to false to opt out."

`normalizeAgents`/`normalizeAgentProfile` already validate route+model+effort;
the profile normalizes cleanly (route `codex-task:read-only` is valid, model
`gpt-5.6-sol` matches the model regex, effort `xhigh` matches the effort regex,
none on an inline route). **No `normalizeAgentProfile` edit is required.**

### Merge coordination with T20260710T1156Z

The sibling edits `normalizeAgentProfile` and `profileForAction`. This design:
- **Does not touch** either function. Design-review recognition rides on
  `profileForAction`'s existing `config.agents[action]` lookup, so whatever the
  sibling does to that function is transparent as long as it keeps returning the
  `config.agents["design-review"]` profile for a present key.
- Touches **different functions** in tickets.js (`isKnownAction`,
  `configuredRouteForAction`, `producingStatusForToken`) plus **new** functions
  (`isDesignReviewGatedMove`, `hasDesignReviewToken`, `recordDesignReview`) and a
  **new** `moveTicket` block. Expected textual merge points:
  - `src/config.js` `DEFAULT_CONFIG.agents` object literal and the
    `defaultConfigJsonc()` agents block — both tickets may add sibling lines; a
    one-line additive conflict at most, resolved by keeping both entries.
  - `src/tickets.js` `configuredRouteForAction` — additive one-line branch; if
    the sibling also edits it, keep both conditions.
  - `test/config.test.js` guard-test allowlist — additive.

## Risks and edge cases

- **Double-gated move (both flags on):** a design->implementation move with
  neither a gate token nor a design-review token throws the gate error first
  (ordering above). Documented, not a defect. Tests assert each in isolation.
- **Token second-colon parsing:** relies on first-`:` split semantics already
  proven by `codex-task:*@model` executors; covered by an explicit
  `completedStepRecords`/`producingStatusForToken` unit test.
- **Done-time re-validation:** at `move done`, `validateRouting` iterates every
  `completedStepRecords` entry, including the design-review token, route-only
  (enforceModel defaults false). `codex-task:read-only` matches, so no spurious
  failure. Because design-review is **not** in `doneRequires`, its absence never
  fails a done move — boards with the flag off are byte-identical.
- **Premature recording:** recording design-review anywhere upstream of
  `ready_for_design` (backlog/questions) is refused by the existing
  `guardPrematureEvidence` guard once the producing-status mapping is in place;
  recording at `ready_for_design`/`designing` is allowed (equal rank, not
  stripped).
- **Flag OFF (default):** `agents["design-review"]` is inert (never consulted),
  `requireDesignReview` is false, and every move/evidence path is byte-identical
  to today.

## Test plan (acceptance criterion -> test)

- **AC1 (refuse then allow):** `test/tickets.test.js` — with
  `{ routing: { requireDesignReview: true } }`, a ticket at `ready_for_design`
  (and a second at `designing`) moving to `ready_for_implementation` is rejected
  with `/no recorded design review.*design-review .*before moving to/s`; after
  `recordDesignReview(root, id, "codex-task:read-only@gpt-5.6-sol", "verdict PASS")`
  the same move succeeds and lands `status: ready_for_implementation`.
- **AC2 (off = byte-identical):** `test/tickets.test.js` — no config file and
  explicit `requireDesignReview: false`: the same move succeeds with no token.
  `test/config.test.js` — new "loadConfig defaults routing.requireDesignReview to
  false when omitted (backward-compat disabled)" mirroring the enforceTransitions
  case (ENOENT, `{version:1}`, explicit false/true, scaffold true).
- **AC3 (model pin + empty evidence + no effort):** `test/tickets.test.js` —
  `recordDesignReview` with `@gpt-5.6-sol` succeeds; with `@codex-default`
  succeeds; with `@wrong-model` rejects with `/completed on model .*configured
  model is gpt-5.6-sol/`; empty evidence rejects with `/non-empty evidence/`;
  assert the written `completedSteps` token contains no `xhigh`/effort substring.
- **AC4 (loop-back strips + enumerates):** `test/tickets.test.js` — with
  `{ routing: { invalidateOnLoopBack: true } }`, a ticket carrying both a design
  and a design-review token, moved back to `ready_for_design`, has the
  design-review token removed and named in the
  `/Invalidated downstream evidence on loop-back to ready_for_design: .*design-review/`
  Run Log line; a re-run re-records fresh evidence.
- **AC5 (guard test):** `test/config.test.js` "defaultConfigJsonc matches
  DEFAULT_CONFIG except for documented differences" — set
  `expected.routing.requireDesignReview = true;` and add
  `"routing.requireDesignReview"` (only that path) to the collapsed allowlist
  (now nine paths). The identical `agents["design-review"]` entry produces no
  agents diff.
- **AC6 (green):** `npm run check` and `node --test` pass.
- **Unit:** a `gateStageForForwardMove`-style direct test for
  `isDesignReviewGatedMove` (true only for the two forward pairs; false for
  backward/lateral/archive/the reverse) and `producingStatusForToken` mapping a
  design-review token to `ready_for_design`.

## Documentation impact

None in this ticket (docs/skills are sibling T20260710T1223Z). The only prose
touched is the two in-file config comments (the DEFAULT_CONFIG block-comment
bullet and the scaffold `requireDesignReview` comment) and the guard-test comment
listing documented differences.

## Open questions

None — the Requirement is prescriptive and the mechanism is a direct mirror of
the shipped `requireGateConsultation` triad.

## Implementation Notes

Merged sibling T20260710T1156Z first (STEP 0, clean auto-merge, no conflicts). Baseline `npm test` after merge: 475 pass / 2 known-baseline `install.test.js` failures (real-PATH, tracked B20260710T1232Z) / 1 skipped.

Implemented the `requireGateConsultation`-mirror triad exactly per design, with one necessary adaptation forced by the merge: the sibling ticket refactored `configuredRouteForAction` into a thin wrapper over a restructured `profileForAction` (mandatory-action branch vs. optional-specialty branch). The design's original "no `profileForAction` edit required" assumption was written against the pre-merge function shape. Post-merge, `profileForAction`'s mandatory branch had to be extended with `|| action === DESIGN_REVIEW_ACTION` (one-line additive change, same seam the design anticipated for `configuredRouteForAction`) so `config.agents["design-review"]` resolves correctly, including its `agents.default` fallback for parity with mandatory actions.

`src/config.js`: added `agents["design-review"]` (route `codex-task:read-only`, model `gpt-5.6-sol`, effort `xhigh`) identically to both `DEFAULT_CONFIG` and `defaultConfigJsonc()`; added `routing.requireDesignReview` (`false`/`true` respectively) with comments matching the six existing backward-compat flags.

`src/tickets.js`: added `DESIGN_REVIEW_ACTION` constant; `isKnownAction` and `profileForAction` recognize it; `producingStatusForToken` maps a design-review token to `ready_for_design`; `isDesignReviewGatedMove`/`hasDesignReviewToken` beside `gateStageForForwardMove`; a `moveTicket` precondition placed immediately after the gate-consultation block (same no-side-effects-on-refusal window); `recordDesignReview` modeled on `completeStep` (model-pin enforcement via `validateStepRouting({ enforceModel: true })`, `guardPrematureEvidence`, atomic write, `clearActiveStep`).

Tests: `test/config.test.js` gained a `requireDesignReview` backward-compat-disabled case and the guard-test allowlist now has nine paths (added `routing.requireDesignReview`). `test/tickets.test.js` gained the full AC1-AC6 suite (refuse-then-allow for both `ready_for_design`/`designing`, backward/lateral/archive never gated, flag-off byte-identical, model-pin + `@codex-default` + empty-evidence + no-effort-leak, `guardPrematureEvidence` early/on-time, loop-back strip + Run Log enumeration + re-record, and confirmation design-review is absent from `doneRequires`) plus a direct `isDesignReviewGatedMove` unit test and a `producingStatusForToken`-mapping test via the exported `invalidateDownstreamEvidence`.

Two pre-existing tests needed updates because the scaffold now ships `requireDesignReview: true` and a `codex-task`-routed `design-review` agent: `test/tickets.test.js`'s scaffold happy-path pipeline test now records a design review before its `ready_for_design -> ready_for_implementation` move; `test/cli.test.js`'s "zero codex-task routes" test now also overrides `design-review` to `inline`.

`npm run check`, `npm test` (490 tests: 487 pass, 2 known-baseline `install.test.js` failures, 1 skipped), and `node ./bin/local-board.js validate` all green.

Deviation from the written design: `profileForAction` edit (see above) - required by the post-merge function shape, not by the original pre-merge design text; scope and intent unchanged (design-review resolves through `config.agents["design-review"]`, never through the optionalSteps catalog).

### Review-fix pass (2026-07-10)

Fixed the two accepted Review Findings, scope limited to exactly those two:

1. **High - flag-off inertness.** `isKnownAction` now returns `config.routing?.requireDesignReview === true` for the `design-review` action instead of unconditional `true`, so `begin-step --action design-review`, `resolveExpectedStep`, and `completeStep` all refuse it as an unknown action on flag-off boards (same `assertAction` error as any unconfigured action). `profileForAction`'s mandatory-action branch gates its `action === DESIGN_REVIEW_ACTION` arm on the same flag, so dispatch/profile resolution (route/model/effort/prompt) never consults `config.agents["design-review"]` while the flag is off. `recordDesignReview` now refuses up front (`config.routing?.requireDesignReview !== true`) with a message naming the flag: "design-review is disabled: set routing.requireDesignReview to true...". `codexTaskRoutedActions` (src/config.js) now skips the `agents["design-review"]` entry unless `config?.routing?.requireDesignReview === true`, so `validate`/`install` emit no codex-task warning from the default profile on flag-off boards. Restored `test/cli.test.js` "zero codex-task routes" test to its pre-change form (dropped the `"design-review": "inline"` override) — it now passes unmodified, proving inertness. Added regression tests: `test/tickets.test.js` new tests cover `begin-step`/`resolveExpectedStep`/`completeStep` refusal and `recordDesignReview` refusal (both no-config and explicit-false); `test/config.test.js` gained a `codexTaskRoutedActions` flag-off/flag-on test. Four pre-existing `recordDesignReview` unit tests (model pin, `@codex-default`, `guardPrematureEvidence`) had to add `routing: { requireDesignReview: true }` to their config, since the recorder is no longer flag-independent — this is the intended behavior change, not a regression.

2. **Medium - malformed-token bypass.** `hasDesignReviewToken` now parses on the first colon (mirroring `completedStepRecords`) and requires a non-empty (post-trim) executor, so a bare `"design-review"` token (no colon at all) or a `"design-review:"`/`"design-review:   "` token (empty/whitespace executor) no longer satisfies the precondition. Added a regression test through the public path: `setTicketField(root, id, "completedSteps", [malformed])` for each of `"design-review"`, `"design-review:"`, `"design-review:   "`, followed by the gated move, asserting refusal with the same "no recorded design review" error; a sibling assertion confirms a genuine recorder-produced token (`design-review:codex-task:read-only@gpt-5.6-sol`) still passes.

`npm run check`, `npm test` (494 tests: 491 pass, 2 known-baseline `install.test.js` failures tracked B20260710T1232Z, 1 skipped), and `node ./bin/local-board.js validate --root <worktree>` all green.

## Review Findings

verdict: changes_requested; target: implementation

(codex-task:read-only, gpt-5.6-terra @ reasoning-effort high, 139s — reviewed commit 4d54bce; peer merge bdcbf96 excluded)

1. High — src/tickets.js:2348 + src/config.js:289: flag-off inertness violated. design-review is unconditionally a known action, so begin-step --action design-review, resolveExpectedStep, and completeStep all work on flag-off boards and can stamp/record routing evidence; the default agents profile is also scanned by codexTaskRoutedActions, producing new validate/install codex-task warnings on flag-off boards (test/cli.test.js:230 was adjusted to compensate — itself evidence of the behavior change). Fix: gate recognition, dispatch/profile resolution, and codex-task warning discovery must exclude design-review unless routing.requireDesignReview is true; the recorder should refuse while disabled (or be explicitly documented as the sole inert-safe API). Restore test/cli.test.js:230 to its pre-change form as proof of inertness.

2. Medium — src/tickets.js:137: hasDesignReviewToken accepts bare "design-review" and any "design-review:" prefix including empty/garbage executors; set <id> completedSteps ["design-review:"] followed by the gated move bypasses the precondition without recorder-produced evidence. Fix: parse on the first colon and require a non-empty executor token; add regression coverage through the public set-then-move path.

Verified clean by the reviewer: transition enforcement ordering; deterministic gate-consultation precedence with no write side effects on refusal; recorder validation order (empty evidence -> model pin -> premature guard); first-colon parsing preserves codex-task:read-only; lock + Run Log mirror completeStep; identical default profiles; allowlist gained exactly one path. Coverage gaps noted for the two findings plus combined-refusal ordering and single-emission of the loop-back Run Log line. (Reviewer sandbox could not spawn test workers; suite verification stays with the test stage.)

Disposition: both findings accepted; looped back, fixed in commit 18c0580, re-reviewed.

Re-review: verdict: pass (codex-task:read-only, gpt-5.6-terra @ reasoning-effort medium, 48s). Verified: recognition/recorder/scanner all flag-gated with the zero-codex-routes test restored as inertness proof and omitted/false/on regression coverage; token parse requires a non-whitespace executor after the first colon with a public set-then-move regression plus well-formed control; commit scope limited to the two fixes, no plans/ changes.

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-10T12:22:11Z: Ensured git branch local-board/T20260710T1220Z-design-review-routing-flag-move-precondition-and-evidence-recorder (already-current).

- 2026-07-10T12:28:57Z: Completed design via claude-subagent:local-board-designer@opus: Technical Design: requireGateConsultation-mirror triad (flag, scoped precondition after the gate block, recordDesignReview recorder), design-review token with producingStatus ready_for_design, config diffs for both defaults + guard allowlist, explicit merge coordination with T1156Z (no shared-function edits). Estimate 2 (basis T20260710T0037Z, designer-recorded).

- 2026-07-10T12:30:38Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: none - workflow-internal gating, no auth/UI/UX

- 2026-07-10T12:42:28Z: Ensured git branch local-board/T20260710T1220Z-design-review-routing-flag-move-precondition-and-evidence-recorder (already-current).

- 2026-07-10T12:54:32Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Commits bdcbf96 (peer merge, clean) + 4d54bce: requireDesignReview flag, agents design-review profile (sol@xhigh) in both defaults, moveTicket precondition after gate block, recordDesignReview recorder, producing-status mapping, AC1-AC6 tests. 487 pass + 2 baseline. One-line documented deviation (profileForAction mandatory branch).

- 2026-07-10T12:55:27Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: none - internal workflow state machinery

- 2026-07-10T13:00:06Z: Invalidated downstream evidence on loop-back to ready_for_implementation: removed completedSteps [implement:claude-subagent:local-board-implementer@sonnet, gate:implement:claude-subagent:local-board-gatecheck@haiku].

- 2026-07-10T13:00:06Z: Ensured git branch local-board/T20260710T1220Z-design-review-routing-flag-move-precondition-and-evidence-recorder (already-current).

- 2026-07-10T13:09:47Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Original 4d54bce + review-fix 18c0580: design-review recognition/recorder/scanner all gated on requireDesignReview (flag-off byte-identical, zero-codex-routes test restored to pre-change form as proof), first-colon token parse requires non-empty executor, set-then-move bypass regression. 491 pass + 2 baseline.

- 2026-07-10T13:11:04Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: none - internal workflow machinery + flag gating

- 2026-07-10T13:13:02Z: Completed review via codex-task:read-only@gpt-5.6-terra: Initial changes_requested (2 findings, terra@high) fixed in 18c0580; focused re-review verdict: pass (terra@medium). No open findings.
