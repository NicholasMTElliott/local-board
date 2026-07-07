---
id: T20260707T1328Z
type: task
status: ready_for_implementation
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: 4
estimateBasis: T20260707T1327Z
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T13:28:41Z
updated: 2026-07-07T21:58:41Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
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

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-07T21:57:57Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): evidence-driven strip on ready_* target moves (target-inclusive rank rule), covers action/gate/specialty tokens + matching approvals, Run Log enumeration, invalidateOnLoopBack switch per the established pattern. Estimate 4 (basis T20260707T1327Z).

- 2026-07-07T21:58:41Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (internal workflow hygiene; no catalog triggers matched)
