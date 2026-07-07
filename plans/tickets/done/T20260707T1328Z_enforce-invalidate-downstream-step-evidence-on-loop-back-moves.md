---
id: T20260707T1328Z
type: task
status: done
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260707T1328Z-enforce-invalidate-downstream-step-evidence-on-loop-back-moves
estimate: 4
estimateBasis: T20260707T1327Z
workStartedAt: 2026-07-07T21:58:42Z
workCompletedAt: 2026-07-07T22:22:40Z
created: 2026-07-07T13:28:41Z
updated: 2026-07-07T22:22:40Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", review:codex-task:read-only, "test:claude-subagent:local-board-tester@sonnet", gate:test:skipped-empty-catalog, document:codex-task:workspace-write]
routingApprovals: []
---
# enforce: invalidate downstream step evidence on loop-back moves

## Requirement

Loop-backs do not invalidate stale evidence. `completeStep` uses `addUnique` on `completedSteps` (`src/tickets.js:481`) and `validateRouting` (`:744-750`) checks token presence only at `done`. After test-fail -> `ready_for_implementation` -> new code, the old `review:...` and `test:...` tokens survive, so the ticket can reach `done` without re-review or re-test of the changed code — unreviewed code merges with a clean audit trail. The PerStepOrchestration real run exercised exactly this loop-back path.

Fix: on `move` back to an earlier pipeline status (per `workflow.pipelineOrder`), strip or timestamp-invalidate `completedSteps` tokens for actions downstream of the target status. Record the invalidation in the Run Log.

Acceptance: after a loop-back move, downstream evidence no longer satisfies `doneRequires`; re-running the steps re-records it; tests cover the test-fail -> re-implement -> done path.

## Acceptance Criteria

## Related Tickets

## Technical Design

Invalidate stale downstream step evidence when a ticket moves back to an earlier
pipeline status, so a loop-back forces the re-run steps to re-record their
evidence before the ticket can reach `done`.

## Problem restated

`completeStep` records evidence with `addUnique(completedSteps, "<action>:<executor>")`
(`src/tickets.js:748`) and never removes it. `validateRouting` (`:1129-1135`)
only checks token *presence* at `done`. So after
`ready_for_test` -> (test fails) -> `ready_for_implementation` -> new code, the
old `review:...` and `test:...` tokens survive and still satisfy
`doneRequires`, letting unreviewed/untested code reach `done` with a clean audit
trail. Gate-consultation tokens (`gate:implement:...`, `gate:test:...`, T1327)
have the same staleness problem.

## Approach

Add a **strip-on-loop-back** step inside `moveTicket`, executed under the
existing ticket lock, before the front-matter is rendered. When the move target
is an earlier pipeline status than evidence already present, remove the
`completedSteps` tokens (including `gate:` tokens), the matching
`routingApprovals` tokens, and append one Run Log line enumerating exactly what
was removed.

### Strip vs timestamp-invalidate — recommend strip

Strip. The token grammar (`action:executor`, `gate:stage:executor`) has no
timestamp slot, so timestamp-invalidation would require a grammar change and a
migration; stripping needs neither. History is not lost: the Run Log line
records the removal, and git history preserves prior front-matter. The
requirement's "or timestamp-invalidate" is satisfied more cheaply by strip. The
firm requirement on strip: **the Run Log line must enumerate the exact tokens
removed** (audit trail).

### Which tokens are "downstream of the target" — precise mapping from pipelineOrder

`config.workflow.pipelineOrder` ranks statuses by closeness to `done` (index 0 =
`ready_for_docs`, nearest done; index 5 = `ready_for_decomposition`, furthest).
`pipelineRank(status)` already exists (`:1471`). Map every evidence token to the
**producing status** that emits it, then strip the token when
`pipelineRank(producingStatus) <= pipelineRank(targetStatus)` — i.e. the token's
stage is at or after the target in chronological flow.

Producing-status resolution:

- Mandatory action token (`design`, `implement`, `review`, `test`, `document`,
  `decompose`): invert `workflow.statusActions` to get the `ready_*` status.
  Inverse is `decompose->ready_for_decomposition`, `design->ready_for_design`,
  `implement->ready_for_implementation`, `review->ready_for_review`,
  `test->ready_for_test`, `document->ready_for_docs`.
- Gate token (`gate:<stage>:<executor>`, stage in {design, implement, test}):
  map stage via `{design:"ready_for_design", implement:"ready_for_implementation",
  test:"ready_for_test"}`. Parse with the existing `GATE_TOKEN_RE`/`isGateToken`
  so a gate token is never mis-split as an action token.
- Optional specialty token (e.g. `security_audit:inline`): find its catalog
  stage in `config.optionalSteps` (design/implement/test), then map stage to the
  same `ready_*` status. This is required, not optional: a re-implement must also
  invalidate implement-stage specialty evidence that ran against the old code.
- Anything that resolves to no producing status (truly unknown action) is left
  untouched — defensive; never strip what we cannot place.

**Target-inclusive.** The target status's own action is stripped too. Arriving at
`ready_for_implementation` means `implement` will run again on new code, so the
old `implement` token must go; `complete-step` re-records it during the re-run.

Worked examples (default pipeline):

- Move -> `ready_for_implementation` (rank 3): strip `implement`, `review`,
  `test`, `document` and `gate:implement`, `gate:test` and any implement/test-stage
  specialties and their approvals. **Keep** `design`, `decompose`, `gate:design`,
  design-stage specialties (ranks 4-5).
- Move -> `ready_for_design` (rank 4): strip everything except `decompose`.
- Move -> `ready_for_docs` (rank 0): strip only `document` (nothing is downstream
  of docs).

### Loop-back detection — evidence-driven, self-guarding

Do **not** compare to the current status. Compute purely: for a target status
that has a pipeline rank, strip every token whose producing-status rank `<=`
target rank. This is self-guarding because such at-or-downstream tokens can only
exist if the ticket has *already been* at or past the target — i.e. a genuine
loop-back. On a normal forward move (e.g. `ready_for_design` ->
`ready_for_implementation`) no `implement`/`review`/`test`/`document` tokens exist
yet, so nothing is stripped. This robustly handles the `questions`/`blocked` ->
`ready_for_implementation` case: current status has no pipeline rank, but the
target does and the stale review/test evidence is still stripped.

Guard on the *target*: only run when `TRIGGER_STATUSES.has(status)` (the six
`ready_*` pipeline statuses). This automatically excludes:

- moves to `questions` / `blocked` (pauses, not loop-backs — must not strip);
- moves to `done` / `archived` (not in pipelineOrder);
- moves to active statuses (`designing`/`implementing`/... — not trigger
  statuses; out of scope, see Open Questions).

### Config switch — recommend gating, scaffold-true / fallback-false

Add `routing.invalidateOnLoopBack`, following the exact B1321/T1327 pattern:
`true` in `defaultConfigJsonc()` (new repos get correct behavior), `false` in
`DEFAULT_CONFIG` (the ENOENT fallback / deep-merge base, so a pre-existing config
that omits the key does **not** silently change behavior on upgrade). Rationale:
AGENTS.md prefers small, reversible changes, and this repo has a strong,
test-locked precedent for exactly this divergence shape. The behavior change is
milder than `requireGateConsultation` (it never *refuses* a move; it strips and
logs), so an always-on design is defensible — but gating keeps it reversible and
consistent, so gate it. When the switch is off, `moveTicket` skips the strip
entirely (and can skip the extra config need for pure back-compat).

### routingApprovals — strip alongside

Strip `routingApprovals` tokens for stripped actions using the same
producing-status rule. An approval sanctioning the OLD attempt's deviation must
not silently sanction the NEW re-run; the re-run re-approves if needed.

### Estimate / front-matter fields — survive (out of scope)

`estimate`, `estimateBasis`, `workStartedAt` are front-matter fields, not
`completedSteps` tokens, and are untouched. A loop-back to `ready_for_design`
keeps the estimate. Intentional and correct — noted so a reviewer does not expect
otherwise.

### Model suffixes ride along (T1324)

Tokens like `implement:claude-subagent:local-board-implementer@sonnet` split on
the first `:` to `action="implement"`, and stripping is keyed on **action**, so
the whole token including the `@model` suffix is removed as a unit. No special
handling needed; add a test asserting it.

## Affected files

- `src/tickets.js`
  - `moveTicket` (`:391`): after `findTicket`, expand `needsConfig` to
    `gateStage !== null || status === "done" || TRIGGER_STATUSES.has(status)`;
    when `config.routing?.invalidateOnLoopBack === true` and
    `TRIGGER_STATUSES.has(status)`, run the pure invalidation, splice the reduced
    `completedSteps`/`routingApprovals` into `frontMatter`, and
    `appendToSection(body, "Run Log", line)` when anything was removed. No Run Log
    line and no token change when the strip set is empty (avoid churn).
  - New pure helper, e.g. `invalidateDownstreamEvidence(frontMatter, config, targetStatus)`
    returning `{ completedSteps, routingApprovals, removed }`. Reuse
    `pipelineRank`, `isGateToken`/`GATE_TOKEN_RE`, `optionalStepEntry` (extend to
    surface the owning stage), `asList`.
  - Small maps: `STAGE_TO_STATUS = {design, implement, test}` and an inverse of
    `statusActions` computed per-call from config.
- `src/config.js`: add `routing.invalidateOnLoopBack` to `DEFAULT_CONFIG`
  (`false`, `:255-264`) and to `defaultConfigJsonc()` (`true`, with a doc
  comment next to `requireGateConsultation`, `:797-812`).
- `test/tickets.test.js`: move/invalidation unit + integration tests.
- `test/config.test.js`: extend the divergence allowlist in
  "defaultConfigJsonc matches DEFAULT_CONFIG except for documented differences"
  (`:231-264`) to include `routing.invalidateOnLoopBack`, and add a
  backward-compat-disabled assertion (omitted key -> `false`).
- Docs: `docs/PerStepOrchestration.md` and/or `docs/Workflow.md` (evidence
  lifecycle / loop-back semantics), plus the config-reference comment; note the
  new key. Update `memory-bank/systemPatterns.md` if it records the evidence
  model. Update README Documentation Index only if a new doc file is added.

## Risks and edge cases

- **This repo's own recent loop-backs did not strip.** The PerStepOrchestration
  real run and other tickets earlier today loop-backed while carrying stale
  tokens. Two back-compat notes: (1) with `DEFAULT_CONFIG` fallback `false`, this
  repo's existing `plans/local-board.config.jsonc` (which predates the key) gets
  `false` and will **not** enable the fix until `routing.invalidateOnLoopBack:
  true` is added to it; (2) invalidation only affects *future* moves — already
  recorded stale tokens are not retroactively cleaned, only stripped if/when a
  future loop-back move crosses them. Call both out in the ticket and docs.
- **Off-by-one / inclusive-exclusive.** A wrong comparison could strip `design`
  on an `implement` loop-back (forcing a needless redesign) or fail to strip
  `review`/`test`. The `<=` target-inclusive rule must be pinned by tests at each
  boundary (design vs implement vs review vs test vs docs).
- **Gate-token mis-parse.** Must route gate tokens through `GATE_TOKEN_RE`, never
  the first-`:` action split, or `gate:implement:...` is misread. Reuse existing
  helpers.
- **Optional-specialty coverage.** Forgetting to map optional tokens to a stage
  leaves stale specialty evidence (partial fix) — explicitly tested.
- **Interaction with the T1327 gate precondition.** Loop-backs are backward
  moves, so `gateStageForForwardMove` returns null and the gate precondition does
  not fire during the loop-back. After stripping `gate:implement`, the *next*
  forward move `ready_for_implementation -> ready_for_review` correctly demands a
  fresh gate consultation. This is the desired T1327-consistent behavior; assert
  it.
- **Done-time validation unchanged.** `validateRouting` reads whatever tokens
  remain; with downstream tokens stripped, a premature move to `done` now fails
  as intended.
- **Churn.** No token change and no Run Log line when the strip set is empty, so
  ordinary forward/lateral moves are byte-identical to today.

## Test strategy

Unit (pure helper):
- Full-evidence task, target `ready_for_implementation`: asserts exactly
  `implement`/`review`/`test`/`document` + `gate:implement`/`gate:test` +
  implement/test specialties + their approvals removed; `design`/`decompose`/
  `gate:design`/design specialties kept.
- Target `ready_for_design`: strips all but `decompose`.
- Target `ready_for_docs`: strips only `document`.
- Forward move (`ready_for_design` -> `ready_for_implementation`) with no
  downstream evidence: no-op (empty `removed`).
- Model-suffixed token (`implement:...@sonnet`) stripped wholesale.
- Optional specialty stripped for its stage; kept when its stage is upstream.

Integration (`moveTicket`, the acceptance path):
- Build a task with full evidence sitting at `ready_for_test`; move to
  `ready_for_implementation`; assert `implement`/`review`/`test` tokens gone and a
  Run Log line enumerates them; then assert a direct move to `done` **fails**
  `validateRouting` (missing implement/review/test). Re-run `complete-step` for
  implement/review/test/document, then move to `done` **succeeds**. This is the
  required `test-fail -> re-implement -> done` coverage.
- Move to `questions` and to `blocked`: assert no stripping (config not even
  loaded / switch guard).
- Switch off (`invalidateOnLoopBack:false` or key omitted): loop-back does NOT
  strip (back-compat); switch on: it strips.

Config:
- Extend the divergence-allowlist guard test and add the omitted-key ->
  `false` assertion.

## Documentation impact

- Config reference comment for `routing.invalidateOnLoopBack`.
- `docs/PerStepOrchestration.md` / `docs/Workflow.md`: document that a loop-back
  invalidates at-or-downstream evidence and that re-running re-records it; note
  the migration caveat for boards created before this key.
- `memory-bank/systemPatterns.md` if it records the evidence/routing model.

## Open questions

- **Active-status moves.** Should a move directly into an active status
  (`implementing`, `testing`, ...) also strip? They are not in `pipelineOrder`,
  so this design skips them. Orchestrator moves target `ready_*` statuses, so
  this is believed out of scope — confirm no path moves backward straight into an
  active status.
- **Switch default here-and-now.** Recommend gating with scaffold-true /
  fallback-false; confirm you want this repo's own config updated to
  `invalidateOnLoopBack: true` in the same change (otherwise the fix stays dormant
  on this board).

## Implementation Notes

Implemented per the Technical Design: strip-on-loop-back, evidence-driven, target-inclusive rank rule.

`src/tickets.js`:
- Added `STAGE_TO_STATUS` (fixed `{design, implement, test}` -> `ready_for_*`, independent of configurable `statusActions`), `pipelineRankOfStatus`, `invertStatusActions`, `producingStatusForToken` (routes gate tokens through `GATE_TOKEN_RE`, mandatory actions through the inverted `statusActions`, specialty tokens through `optionalStepEntry`'s new `stage` field; returns `null` for anything unplaceable — never stripped).
- Added exported pure helper `invalidateDownstreamEvidence(frontMatter, config, targetStatus)` returning `{ completedSteps, routingApprovals, removed: { completedSteps, routingApprovals } }`. No-op when `targetStatus` has no pipeline rank.
- `optionalStepEntry` now returns `{ ...entry, stage }` (additive; existing callers unaffected).
- `pipelineRank(ticket, config)` refactored to reuse `pipelineRankOfStatus` (no behavior change).
- `moveTicket`: `needsConfig` expanded to `gateStage !== null || status === "done" || TRIGGER_STATUSES.has(status)`. When `config.routing?.invalidateOnLoopBack === true` and the target is a trigger status, runs `invalidateDownstreamEvidence` against the pre-move front matter, splices the reduced lists into front matter, and appends one Run Log line (`invalidationRunLogMessage`) enumerating exactly what was removed — only when the removed sets are non-empty (empty-diff no-op, byte-identical to before for ordinary moves). All inside the existing `withTicketLock` span, before rendering.

`src/config.js`:
- `DEFAULT_CONFIG.routing.invalidateOnLoopBack = false` (ENOENT fallback / merge base, back-compat).
- `defaultConfigJsonc()` scaffold: `"invalidateOnLoopBack": true` with a doc comment next to `requireGateConsultation`, including the migration caveat (invalidation is forward-only; pre-existing stale tokens are not retroactively cleaned).

Tests added (`test/tickets.test.js`, `test/config.test.js`):
- 7 unit tests on `invalidateDownstreamEvidence`: full-evidence strip at `ready_for_implementation` (implement/review/test/document + their gate tokens + implement/test-stage specialties + matching approvals stripped; design/decompose/gate:design/design-specialty + design approval survive); boundary at `ready_for_design` (strips all but decompose) and `ready_for_docs` (strips only document); forward-move no-op; model-suffixed token stripped wholesale; specialty stripped only for its own stage; non-pipeline target (`questions`) is a defensive no-op.
- 3 `moveTicket` integration tests: full acceptance path (design→...→ready_for_docs with all evidence + gate tokens, loop back to `ready_for_implementation`, assert exact stripped set + Run Log enumeration + estimate survives untouched, direct move to `done` fails routing validation, re-`complete-step` implement/review/test/document, `done` then succeeds and board `validate`s clean); `questions`/`blocked` moves never strip even with the switch on; switch off (implicit default and explicit `false`) preserves old behavior vs switch on strips.
- `test/config.test.js`: guard-test allowlist extended to a 4th documented divergence (`routing.invalidateOnLoopBack`); new dedicated backward-compat test (omitted key / explicit false / explicit true / shipped scaffold).

Docs: `docs/Workflow.md` gets a new "Loop-back evidence invalidation" subsection (plus a cross-reference fix in the enforcement-hooks "Documented limits" paragraph that previously said this was "a separate concern"); `docs/PerStepOrchestration.md` real-run write-up now notes the loop-back path it exercised carried stale evidence and points at the fix; `memory-bank/systemPatterns.md` updated (Config key list, DEFAULT_CONFIG/scaffold divergence count 3→4, gate-check paragraph gets a new invalidateOnLoopBack paragraph, `move` line updated).

Deviations from the design: none substantive. One interpretation choice not spelled out verbatim in the design: `routingApprovals` stripping re-applies the *same* producing-status rule directly to each approval token (rather than deriving a stripped-actions set from the completedSteps removals and filtering approvals by membership). This matches the design's literal instruction ("Strip routingApprovals tokens... using the same producing-status rule") and additionally covers an approval recorded for an action with no completedSteps token yet (edge case, not otherwise specified) — same firm outcome for every case the test strategy specifies.

Repo-live config: `plans/local-board.config.jsonc` was intentionally left untouched (still has no `invalidateOnLoopBack` key, so it resolves to the `false` back-compat default via `DEFAULT_CONFIG`) per the ticket's explicit instruction. Turning it on for this board is an orchestrator decision to make post-merge.

Verification: `npm run check` (syntax check, clean), `npm test` (314 tests, 313 pass, 1 pre-existing skip, 0 fail), `npm run validate` (board validates clean).

## Review Findings

Reviewed by codex-task:read-only (gpt-5.5) against commit a188c1c.

No blocking findings.

Non-blocking observations:
- src/config.js:24,44 comments still say the default/scaffold split has "exactly three" divergences — this commit adds the fourth (invalidateOnLoopBack). Guard test correct; comment text stale (fix in the doc pass).
- No dedicated failed-move-does-not-strip test; existing moveTicket rollback tests cover the same write mechanics, and invalidation is staged in memory until the normal write path — acceptable.

Trace notes (all verified):
- Rank rule target-inclusive per design (pipelineRank(producing) <= pipelineRank(target), src/tickets.js:204); ready_for_implementation strips implement/review/test/document and keeps design/decompose.
- Token production mapping sound for gate/action/specialty tokens; model suffixes stay inside stripped tokens.
- routingApprovals use the same producing-status rule — covers approvals without matching tokens.
- T1327 interaction correct: gate refusal precedes invalidation; a stripped gate:implement forces a fresh consultation on the next forward move.
- Estimates/lifecycle fields untouched; atomicity holds (invalidation persists only via the normal write path with the B1318 rollback).
- Config split + fourth allowlist entry + docs accurate.

Verdict: pass

## Test Evidence

Tested by claude-subagent:local-board-tester (sonnet) on branch local-board/T20260707T1328Z-..., commit a188c1c.

**Suite:** `npm run check` pass; `npm test` 313 pass / 1 gated-skip; `npm run validate` OK.

**End-to-end acceptance probe (fresh board, both switches on):** walked a ticket to ready_for_docs with all 7 tokens, looped back to ready_for_implementation — implement/review/test + gate:implement/gate:test stripped; design + gate:design + estimate survived; the Run Log line enumerates exactly the five removed tokens (full text captured). Re-run path: fresh implement recorded, forward move REFUSED until a fresh gate consultation (T1327 interaction verified live), then re-recorded review/test/document and move done succeeded. Bonus: a wrong-executor document attempt was correctly rejected by strict routing mid-probe.

**Pause probe:** questions round-trip left completedSteps byte-identical, no invalidation log line.

**Switch-off probe:** ENOENT-fallback board (invalidateOnLoopBack false) — loop-back left all tokens intact, no log line. (Explicit-false-with-gates-on covered by the unit suite.)

**Gaps / caveats:** routingApprovals stripping and blocked-target no-strip verified via the automated suite only; the "exactly three places" comment staleness confirmed (cosmetic, flagged for the doc pass).

Result: pass

## Documentation Updates

Documented by codex-task:workspace-write (gpt-5.5).

- `src/config.js` — stale "exactly three"/"only these three" divergence comments replaced with count-proof phrasing (review nit closed).
- `docs/Workflow.md`, `docs/PerStepOrchestration.md`, `memory-bank/systemPatterns.md` — implementation-pass updates verified accurate: target-inclusive rank rule, fallback/scaffold defaults, Run Log enumeration, no-retroactive-cleanup migration caveat.
- No README change needed.

## Questions

## Run Log

- 2026-07-07T21:57:57Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): evidence-driven strip on ready_* target moves (target-inclusive rank rule), covers action/gate/specialty tokens + matching approvals, Run Log enumeration, invalidateOnLoopBack switch per the established pattern. Estimate 4 (basis T20260707T1327Z).

- 2026-07-07T21:58:41Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (internal workflow hygiene; no catalog triggers matched)

- 2026-07-07T21:58:42Z: Ensured git branch local-board/T20260707T1328Z-enforce-invalidate-downstream-step-evidence-on-loop-back-moves (created).

- 2026-07-07T22:09:43Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Implementer (sonnet): invalidateDownstreamEvidence helper wired into moveTicket under lock, config switch per the established pattern, Run Log enumeration; 313 pass + 1 gated-skip.

- 2026-07-07T22:11:02Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (backend workflow logic; no catalog triggers matched)

- 2026-07-07T22:13:54Z: Completed review via codex-task:read-only: Codex (gpt-5.5, read-only) verdict pass: rank rule, token mapping, gate interaction, and atomicity all traced correct; one stale comment ('exactly three' divergences) to fix in the doc pass.

- 2026-07-07T22:20:43Z: Completed test via claude-subagent:local-board-tester@sonnet: Tester (sonnet): 313+1 gated; full acceptance loop-back probed live with exact Run Log enumeration, fresh-gate refusal on re-run, pause and switch-off probes clean. Result: pass.

- 2026-07-07T22:22:39Z: Completed document via codex-task:workspace-write: Codex (workspace-write): stale divergence comment count-proofed; impl-pass docs verified accurate.
