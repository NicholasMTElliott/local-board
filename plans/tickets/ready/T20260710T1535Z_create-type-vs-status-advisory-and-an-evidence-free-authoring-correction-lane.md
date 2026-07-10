---
id: T20260710T1535Z
type: task
status: ready_for_design
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260710T1535Z-create-type-vs-status-advisory-and-an-evidence-free-authoring-correction-lane
estimate: 2
estimateBasis: T20260710T1533Z
workStartedAt: 2026-07-10T17:45:37Z
workCompletedAt: null
created: 2026-07-10T15:32:23Z
updated: 2026-07-10T18:18:39Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
routingApprovals: []
---
# create: type-vs-status advisory and an evidence-free authoring-correction lane

## Requirement

Retro item from the 2026-07-10 parallel run. The orchestrator created story S20260710T1206Z with --status ready_for_design; the conventional entry status for stories/epics is ready_for_decomposition (statusActions maps ready_for_design to the design action, but stories complete via decompose per doneRequires). Correcting it required a move that enforceTransitions rightly refused (ready_for_design -> ready_for_decomposition is not a mapped or structural transition), forcing an --override with a recorded reason.

## Scope

1. Add a create-time advisory (warning, not refusal) when the requested initial status is conventionally mismatched to the type: story/epic created at a status whose action is not decompose; task/bug created at ready_for_decomposition. Text names the conventional status and the doneRequires rationale.
2. Consider (design decides) extending the structural allow-set or the transition maps with an authoring-correction lane: any ready_* -> any trigger status while the ticket has zero completedSteps (nothing to invalidate), removing the --override ceremony for pure authoring mistakes. If adopted, loop-back invalidation semantics must be a no-op on that lane by construction (no evidence exists).
3. Tests for the advisory (fires/does not fire) and, if adopted, the authoring-correction lane (allowed with zero evidence, refused once any completedSteps token exists).
4. Schema/docs notes (docs/Workflow.md statuses section).

## Acceptance criteria

- create story --status ready_for_design prints the advisory naming ready_for_decomposition; create task --status ready_for_design stays silent.
- Existing boards and scripts are unaffected (warning-only unless the lane is adopted; lane, if adopted, is provably evidence-safe).
- npm run check and node --test pass.

## Non-goals

- No hard refusal at create (statuses remain schema-legal); no change to enforceTransitions defaults.

## Acceptance Criteria

## Related Tickets

## Technical Design

Two independent, additive changes: a create-time stderr advisory that flags a
type-vs-status mismatch, and an adopted authoring-correction lane in the
`enforceTransitions` validator for zero-evidence `ready_*` re-placements. Both
default-off for existing boards; neither refuses anything that was previously
allowed. The lane also actively clears the stale action-kind dispatch record it
leaves behind (revision below closes a FAILED-review High finding).

### Decision summary

- Part 1 (advisory): ADOPT as a warning to stderr from `commandCreate`, backed by
  a pure exported helper. Never refuses (statuses stay schema-legal); stdout
  stays exactly the created path.
- Part 2 (authoring-correction lane): ADOPT. Extend the `enforceTransitions`
  allow condition with a `ready_* -> ready_*/backlog` lane permitted only when the
  ticket has zero `completedSteps` AND zero `routingApprovals`, AND clear any
  lingering `kind: "action"` active-step ledger record when (and only when) a move
  is admitted via that lane. Justification, the provable-no-op argument, and the
  ledger-clear seam are below.

### Related tickets and conflicts

- `T20260707T1329Z` (done) introduced `isStructurallyAllowed`/`isTransitionAllowed`
  and the `enforceTransitions` hard validator. This ticket extends that exact
  machinery; no conflict, but the design deliberately keeps `isStructurallyAllowed`
  status-only and adds the evidence-aware lane as a separate predicate rather than
  overloading the status-only allow-set.
- `B20260710T1225Z` (done) shaped the ledger-sweep predicates
  (`isAnyConsultationLedgerEntry`, `isActionLedgerEntry`) that `moveTicket` and the
  complete-step/gate paths run; Part 2 both relies on and extends that machinery
  (a new kind-only action predicate, `isAnyActionLedgerEntry`) — see the
  ledger-sweep interaction below.
- Gate/loop-back features (`requireGateConsultation`, `requireDesignReview`,
  `invalidateOnLoopBack`, `guardPrematureEvidence`) all interact with `moveTicket`;
  each interaction is analyzed in Part 2.
- No overlapping in-flight tickets touch `createTicket`/`commandCreate` or
  `moveTicket`'s transition gate.

### Part 1 — create-time type-vs-status advisory

Grounding: `config.workflow.statusActions` (status -> action) and
`config.routing.doneRequires` (type -> required action list) in `src/config.js`.

Unified predicate (fire the advisory iff both hold):

1. `statusActions[status]` is defined (so `backlog`, active, `questions`,
   `blocked`, etc. never fire — the default `--status backlog` create stays
   silent), AND
2. that action is NOT a member of `doneRequires[type]`.

Why this single predicate captures both scoped cases exactly:

- story/epic: `doneRequires` is `["decompose"]`. The only trigger status whose
  action is `decompose` is `ready_for_decomposition`; every other trigger status
  (`design`/`implement`/`review`/`test`/`document`) has an action not in the list,
  so it fires. This is precisely "story/epic created at a status whose action is
  not decompose."
- task/bug: `doneRequires` is `["design","implement","review","test","document"]`,
  which covers every trigger action except `decompose`. So the only trigger status
  that fires is `ready_for_decomposition` — precisely "task/bug created at
  ready_for_decomposition." `task@ready_for_design` stays silent (design is in the
  list).

Conventional-status naming: name the status whose action is `doneRequires[type][0]`
by inverting `statusActions` (same inversion pattern as `invertStatusActions` in
`src/tickets.js`). For story/epic that is `ready_for_decomposition` (action
`decompose`); for task/bug it is `ready_for_design` (action `design`). If a custom
config's `doneRequires[type][0]` action has no producing status in `statusActions`
(defensive/edge), fall back to naming the action alone rather than throwing.

Message shape (stderr, single line, `WARNING:` prefix to match the existing
`codexTaskWarning` convention), e.g.:

    WARNING: story created at ready_for_design, but stories complete via
    "decompose" (routing.doneRequires.story = [decompose]); the conventional
    entry status is ready_for_decomposition. The ticket was created; re-place it
    with "move <id> ready_for_decomposition" if this was unintended.

The message names the requested status, the type's `doneRequires`, the offending
vs. conventional action, and the conventional status.

Placement and output channel:

- New pure exported helper, `typeStatusAdvisory(config, type, status) ->
  string | null`, in `src/tickets.js` (co-located with the other config-derived
  status/action predicates and `invertStatusActions`). Pure and deterministic —
  the primary unit-test surface.
- `commandCreate` (`src/cli.js`) loads config once (`loadConfig(root)`), computes
  the advisory after `createTicket` succeeds, and emits it via `console.warn`
  (stderr) BEFORE the existing `console.log(ticketPath)`. stdout remains exactly
  the path, so scripts that capture stdout are unaffected. A `null` return emits
  nothing (byte-identical to today for conventional creates).

No change to `createTicket` itself — it stays free of config concerns, and its
`wx` create + `linkParent` behavior is untouched.

### Part 2 — authoring-correction lane (ADOPTED)

Eligibility predicate (new, evidence-aware; kept separate from the status-only
`isStructurallyAllowed`):

    isAuthoringCorrectionLane(fromStatus, toStatus, frontMatter):
      TRIGGER_STATUSES.has(fromStatus)
      && (TRIGGER_STATUSES.has(toStatus) || toStatus === "backlog")
      && asList(frontMatter.completedSteps).length === 0
      && asList(frontMatter.routingApprovals).length === 0

Adopt zero `completedSteps` AND zero `routingApprovals` (strictly stronger than the
Requirement's "zero completedSteps"). Rationale: the loop-back stripper
(`invalidateDownstreamEvidence`) removes tokens from BOTH lists, so "no evidence
exists by precondition" is only literally true, and the no-op only provable, when
BOTH lists are empty. A `routingApproval` (from `approve-inline`) can exist with
zero `completedSteps`; requiring both empty closes that gap. The retro's target
case — a freshly created, never-worked ticket at the wrong status — has both empty,
so the tighter precondition costs the intended use case nothing.

Wiring in `moveTicket` (`src/tickets.js`), inside the existing
`enforceTransitions === true` block only. Compute a single `admittedViaLane` flag
once, reuse it for both the allow-condition and the ledger clear (below):

    const admittedViaLane =
      config.routing?.enforceTransitions === true
      && !isTransitionAllowed(config, ticket.status, status)
      && isAuthoringCorrectionLane(ticket.status, status, ticket.frontMatter);

    if (config.routing?.enforceTransitions === true
        && !isTransitionAllowed(config, ticket.status, status)
        && !admittedViaLane) {
      ... existing override / refusal ...
    }

The lane is purely additive to the allow condition: it can only turn a would-be
refusal into an allow, never the reverse, so no move that is allowed today becomes
refused. It lives entirely inside the `enforceTransitions` gate, so boards with
`enforceTransitions` false (the `DEFAULT_CONFIG` fallback for pre-existing configs)
see no behavior change at all.

Because `isTransitionAllowed` short-circuits `true` for every mapped/structural
move, the lane predicate is only ever consulted for moves not otherwise allowed —
e.g. `ready_for_design -> ready_for_decomposition` (the exact retro gap),
`ready_for_implementation -> ready_for_decomposition`, or any `ready_* -> backlog`.
Mapped forward pairs (e.g. `ready_for_design -> ready_for_implementation`) are
already allowed by the map, so `admittedViaLane` is false for them (its
`!isTransitionAllowed` conjunct fails) and the lane never becomes the deciding
factor — including for the ledger clear below.

Interaction with `requireGateConsultation` (FORWARD gate, evaluated as a separate
`if` after the transition gate): `gateStageForForwardMove` returns non-null ONLY
for the three exact forward stage-completion pairs (design->impl, impl->review,
test->docs). Genuine authoring corrections target `ready_for_decomposition`,
`backlog`, or an upstream/lateral `ready_*` that is none of those three `to`
values, so `gateStageForForwardMove` returns null and the block is skipped. For the
one overlap where the lane predicate would also match a gated forward pair
(e.g. `ready_for_design -> ready_for_implementation`), that pair is already
map-allowed, so `admittedViaLane` is false and the transition gate passes via the
map regardless; and crucially the gate-consultation `if` runs INDEPENDENTLY of how
the transition gate passed. The lane therefore cannot smuggle a ticket past a gate:
with zero `completedSteps`, `gateConsultationRecords` is empty and the forward move
still refuses. Confirmed: the gate cannot fire on a zero-evidence lateral/upstream
correction, and cannot be bypassed on a forward pair.

Interaction with `requireDesignReview` (FORWARD gate): `isDesignReviewGatedMove`
returns true only for `{ready_for_design,designing} -> ready_for_implementation`.
No lateral/upstream authoring correction matches (`to !== ready_for_implementation`),
so the block is skipped. For the `ready_for_design -> ready_for_implementation`
overlap, same reasoning as above — that move is map-allowed anyway, the design-
review `if` runs independently, and `hasDesignReviewToken` is false on a
zero-`completedSteps` ticket, so it still refuses. No bypass.

Interaction with `invalidateOnLoopBack` (the provable no-op): the loop-back block
runs only when `TRIGGER_STATUSES.has(status)`. For a `-> backlog` correction the
block is skipped entirely (backlog is not a trigger). For a `-> ready_*` correction
it calls `invalidateDownstreamEvidence(ticket.frontMatter, config, status)`; with
`completedSteps` and `routingApprovals` both empty by the lane precondition, both
input lists are empty, so `removed.completedSteps` and `removed.routingApprovals`
are empty, `nextFrontMatter` is unchanged, and no Run Log line is appended. Provable
no-op by construction — nothing to invalidate exists.

### Part 2 — closing the stale-authorization gap (review-fix amendment)

The FAILED design review raised one High finding: empty `completedSteps` +
`routingApprovals` proves nothing has been *recorded as complete*, but it does NOT
prove the ticket was never *dispatched*. `beginStep` (`src/tickets.js:1330-1333`)
stamps a `kind: "action"` active-step ledger record (route = the stage's agent,
e.g. `claude-subagent:local-board-designer`) at dispatch time; that record is only
removed by the matching `completeStep`/`approveInline` (via
`clearActiveStepIf(..., isActionLedgerEntry(record, action))`). Front-matter
`completedSteps` is not written until `complete-step`. So a ticket dispatched but
not yet completed has EMPTY front-matter lists AND a live `kind: "action"` ledger
record. Such a ticket is lane-eligible.

`moveTicket`'s abandonment sweep (`src/tickets.js:915-917`) runs
`clearActiveStepIf(root, ticketId, isAnyConsultationLedgerEntry)`, which is
kind-only for `gate`/`specialty` and *deliberately* preserves `kind: "action"`
records (a move is not, in general, evidence that an in-flight action dispatch was
abandoned — see the sweep comment). Consequently, after a lane correction such as
`ready_for_design -> ready_for_decomposition`, the stale `design` action record
survives. `checkDispatch` (`src/active-steps.js:231-234`) then prioritizes that
ledger record's `route`/`model` over `resolveExpectedStep`, so it would still
authorize `local-board-designer` for a ticket that now sits at
`ready_for_decomposition` — dispatching the WRONG (old-stage) agent. That is the
finding.

Fix (chosen option — clear the action record on lane admission): when, and only
when, a move is `admittedViaLane`, `moveTicket` additionally clears any
`kind: "action"` ledger record for the ticket, using a new kind-only predicate that
matches ANY action name (mirroring `isAnyConsultationLedgerEntry` on the
consultation side):

    // Kind-only action-record predicate — the action-side analogue of
    // isAnyConsultationLedgerEntry. Matches any kind:"action" entry regardless of
    // action name (a legacy record with no `kind` reads as "action").
    function isAnyActionLedgerEntry(record) {
      return (record.kind ?? "action") === "action";
    }

Wiring, folded into the existing sweep block (`src/tickets.js`), gated on a real
status change AND `admittedViaLane` — leaving the general sweep's deliberate
action-preservation intact for every other move:

    if (ticket.status !== status) {
      await clearActiveStepIf(root, ticketId, isAnyConsultationLedgerEntry).catch(() => {});
      if (admittedViaLane) {
        // Authoring re-placement: the old stage's begin-step dispatch is
        // abandoned by construction (zero recorded evidence, new status),
        // so its stale action record must not keep authorizing that agent.
        await clearActiveStepIf(root, ticketId, isAnyActionLedgerEntry).catch(() => {});
      }
    }

Scoping decision (lane-only, and the general sweep MUST stay action-preserving):
the extra action clear is guarded by `admittedViaLane`, never the broad
`ticket.status !== status`. Every non-lane real status change — mapped forward
moves, structural moves, `--override` forced transitions, loop-backs, moves to
`questions`/`blocked` — must continue to preserve `kind: "action"` records, exactly
as today: those moves can legitimately coexist with a live in-flight action
dispatch, and erasing it would deny a legitimate dispatch. Only the
authoring-correction lane carries the by-construction guarantee that there is
nothing worth preserving: zero recorded evidence plus a status change that is a
pure re-placement means the old stage's dispatch is being abandoned. The clear is
best-effort (`.catch(() => {})`), consistent with the existing sweep — a clear
failure never undoes the already-successful move; the residual record would at
worst require a re-`begin-step` overwrite (idempotent self-heal).

Why clear-on-lane-move beats the finding's alternative (lane requires no active
record):

- Front-matter-only eligibility stays pure and deterministic. Making
  `isAuthoringCorrectionLane` depend on the ledger would couple transition
  admission to a runtime cache (`.local-board/active-steps.json`) that is a
  DIFFERENT store from the ticket file, force the predicate async, and make lane
  eligibility non-deterministic w.r.t. the ticket the user is looking at.
- That cache is intentionally self-healing: the write paths read it via
  `readLedgerSelfHeal`, which returns `{}` on a corrupt/unreadable ledger. A
  require-no-record lane would therefore silently *re-open* on a corrupt ledger
  (reads as empty -> "no record" -> eligible) — the opposite of the safe default.
- Require-no-record REFUSES a legitimate authoring correction whenever any stray or
  in-flight action record happens to exist, bouncing the user back to the
  `--override` ceremony the lane exists to remove — defeating the feature for the
  exact retro case (a freshly dispatched-then-mis-placed ticket).
- Clear-on-lane-move is the correct abandonment semantic and reuses the existing
  `clearActiveStepIf` seam and the sweep's own best-effort pattern — the same
  shape B20260710T1225Z already established for consultation stamps. No concrete
  reason to prefer require-no-record was found.

After the clear, `checkDispatch` for the moved ticket falls through the
no-ledger-record branch (`src/active-steps.js:236-254`) and resolves the expected
step from the ticket's NEW status via `resolveExpectedStep` — e.g.
`ready_for_decomposition` resolves to `claude-subagent:local-board-decomposer`, so
the stale designer authorization is gone and the correct next agent resolves from
ticket state.

Interaction with the general dispatch-verification ledger sweep (updated): the
kind-only consultation sweep is unchanged and still runs on every real status
change. The new action clear is strictly additional and lane-scoped. For a
freshly-created, truly never-dispatched ticket the action clear simply matches
nothing (best-effort no-op). For a dispatched-but-not-completed ticket it removes
exactly the stale authorization the finding identified. Harmless in both cases.

Interaction with `guardPrematureEvidence`: out of scope — that guard lives in
`complete-step`, not `moveTicket`, and the lane precondition is precisely zero
recorded evidence.

`allowedTargetsFor` (refusal message): no change. When evidence exists the lane
predicate is false, so a disallowed `ready_* -> ready_*` move still refuses with the
standard allowed-targets list; the lane targets are correctly NOT advertised,
because with evidence present they are genuinely disallowed. When evidence is zero
the move is allowed and no refusal message is produced.

### Affected files

- `src/tickets.js`: add exported `typeStatusAdvisory(config, type, status)` and
  `isAuthoringCorrectionLane(fromStatus, toStatus, frontMatter)`; add the
  kind-only `isAnyActionLedgerEntry(record)` predicate; in `moveTicket` compute the
  `admittedViaLane` flag, add the `&& !admittedViaLane` clause to the
  `enforceTransitions` gate, and add the lane-scoped
  `clearActiveStepIf(root, ticketId, isAnyActionLedgerEntry)` inside the existing
  status-change sweep block.
- `src/cli.js`: `commandCreate` loads config and emits the advisory on stderr
  before printing the path.
- `docs/Workflow.md`: extend the "Hard transition validation" allow-set list with
  the authoring-correction lane bullet and its zero-evidence precondition; note
  that admitting a move via the lane also abandons any in-flight action dispatch
  record (so a stale designer/implementer dispatch cannot survive the correction);
  add a short note (statuses/eligibility area) about the create-time advisory.
- `test/tickets.test.js`: unit tests for the new predicates and the
  begin-step-then-lane-correction dispatch-authorization test.
- `test/cli.test.js`: create-advisory integration test (stderr + stdout) and
  lane end-to-end move tests.

### Risks and edge cases

- stderr capture in tests: the in-process `runCli` helper patches `console.log`
  and `console.error` but NOT `console.warn`. Emitting the advisory via
  `console.warn` (matching `codexTaskWarning`) means the CLI integration test must
  use the child-process `runCliChild` harness (as the codex-task warning tests
  already do) to observe stderr. Alternatively emit via `console.error` to use the
  lighter in-process `runCli`. Recommend `console.warn` + `runCliChild` for
  convention-consistency; the pure-helper unit tests carry the fires/silent
  coverage regardless.
- Custom-config robustness: the advisory reads `doneRequires[type]` and inverts
  `statusActions`; guard against a missing `doneRequires[type]` (no advisory) and a
  `doneRequires[type][0]` action with no producing status (name the action only).
- Lane breadth: the lane permits any zero-evidence `ready_* -> ready_*/backlog`,
  including lateral re-placements that are normally map-blocked (e.g.
  `ready_for_review -> ready_for_test`). This is intentional and safe: zero evidence
  means no stage work has been recorded, so nothing is lost and no gate is
  bypassed; and the lane's action-record clear guarantees no stale in-flight
  dispatch survives the re-placement.
- Action-clear scoping: the action clear is strictly `admittedViaLane`-gated. A
  regression test pins that a NON-lane real status change still preserves a
  `kind: "action"` record — the general sweep's deliberate action-preservation is
  unchanged for every move except the authoring-correction lane.
- No schema change: statuses remain schema-legal at create; `enforceTransitions`
  defaults unchanged. Existing boards and scripts are unaffected.

### Test strategy

Advisory (unit, `typeStatusAdvisory`, deterministic):

- `story` + `ready_for_design` -> non-null, names `ready_for_decomposition` and
  `decompose`.
- `epic` + `ready_for_implementation` -> non-null, names `ready_for_decomposition`.
- `task` + `ready_for_design` -> null (silent).
- `task` + `ready_for_decomposition` -> non-null, names `ready_for_design`.
- `bug` + `ready_for_decomposition` -> non-null.
- any type + `backlog` (and an active/`questions` status) -> null.

Advisory (CLI integration, `runCliChild`):

- `create story ... --status ready_for_design`: exit 0, stdout is exactly the
  ticket path, stderr matches the advisory naming `ready_for_decomposition`.
- `create task ... --status ready_for_design`: exit 0, stderr contains no advisory.

Lane eligibility (unit, `isAuthoringCorrectionLane`): true for
`ready_for_design -> ready_for_decomposition` with empty lists; false once
`completedSteps` has any token; false once `routingApprovals` has any token; false
for a non-`ready_*` source; true for `ready_* -> backlog` with empty lists; false
for `ready_* -> designing` (active target, not covered).

Action predicate (unit, `isAnyActionLedgerEntry`): true for `{kind:"action",...}`
and for a legacy record with no `kind`; false for `{kind:"gate"}` and
`{kind:"specialty"}`.

Lane (end-to-end `moveTicket` with `enforceTransitions: true`):

- zero-evidence `ready_for_design -> ready_for_decomposition` succeeds with NO
  `--override`, no Run Log override/invalidation line, file relocated to the
  `ready` folder.
- the same move on a ticket carrying one `completedSteps` token refuses with the
  standard allowed-targets error (proving the evidence guard).
- a ticket with only a `routingApprovals` token also refuses (proving the
  both-lists precondition).
- regression: an existing mapped move and an existing structural move
  (`backlog -> ready_*`) still behave identically; `enforceTransitions: false`
  boards are unaffected.
- provable-no-op check: zero-evidence lane move to a `ready_*` target with
  `invalidateOnLoopBack: true` produces no invalidation Run Log line and leaves
  `completedSteps`/`routingApprovals` untouched.

Stale-authorization test (the review-fix regression, end-to-end,
`enforceTransitions: true`, on a freshly-created never-completed ticket at
`ready_for_design` with empty `completedSteps`/`routingApprovals`):

1. `beginStep(root, id)` stamps the `kind: "action"`, `action: "design"` ledger
   record (route `claude-subagent:local-board-designer`).
2. Baseline: `checkDispatch(root, { agent: "local-board-designer", ticketId: id })`
   returns allow (code 0, reason `match`) via the ledger record — the stale
   authorization exists.
3. `moveTicket(root, id, "ready_for_decomposition")` (no `--override`) succeeds via
   the lane.
4. Assert the ledger has NO entry for the ticket (`readActiveSteps` -> key absent):
   the action record was cleared on lane admission.
5. Assert `checkDispatch(root, { agent: "local-board-designer", ticketId: id })`
   now DENIES (code 1, reason `agent-mismatch`): the OLD stage's agent is no longer
   authorized.
6. Assert `checkDispatch(root, { agent: "local-board-decomposer", ticketId: id })`
   ALLOWS (code 0) — the new status resolves via the no-ledger `resolveExpectedStep`
   path to `local-board-decomposer`.
7. Scoping regression: repeat begin-step then a NON-lane move (e.g. a ticket with a
   `completedSteps` token forced via `--override`, or a mapped forward move) and
   assert the `kind: "action"` ledger record is PRESERVED — the action clear is
   lane-only.

`npm run check` and `node --test` must pass.

### Documentation updates

`docs/Workflow.md` "Hard transition validation": add a bullet to the structural
allow-set list for the authoring-correction lane — "a `ready_*` status -> any
`ready_*` status or `backlog`, permitted only while the ticket has zero
`completedSteps` and zero `routingApprovals` (a pure authoring re-placement with no
recorded evidence to invalidate); admitting a move via this lane also abandons any
in-flight action-dispatch ledger record, so a stale stage agent (e.g. the designer)
can never keep being authorized after the correction" — and one sentence noting the
create-time advisory (a warning, not a refusal) for a type-vs-status mismatch. No
README index change (no new doc file).

### Open questions

None blocking. Two design choices already resolved in favor of the stronger
invariant: (1) the lane precondition requires zero `routingApprovals` in addition
to the Requirement's zero `completedSteps`, so the loop-back no-op is provable
rather than merely likely; (2) the lane actively clears the abandoned `kind:
"action"` ledger record on admission (chosen over making lane eligibility depend on
runtime cache state), so a stale in-flight dispatch cannot survive an authoring
correction.

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-10T17:45:37Z: Ensured git branch local-board/T20260710T1535Z-create-type-vs-status-advisory-and-an-evidence-free-authoring-correction-lane (already-current).

- 2026-07-10T17:53:21Z: Completed design via claude-subagent:local-board-designer@opus: typeStatusAdvisory helper (stderr warn, statusActions x doneRequires predicate); authoring-correction lane ADOPTED: isAuthoringCorrectionLane requires zero completedSteps AND zero routingApprovals, OR-ed into enforceTransitions; proven no-op vs gate/DR/invalidation/ledger sweeps. Unit+e2e tests incl. evidence-guard matrix; Workflow.md notes. Estimate 2pts basis T20260710T1533Z.

- 2026-07-10T17:54:23Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: none requested (workflow policy, no auth/UI/UX triggers)

- 2026-07-10T18:14:48Z: Design review (sol@xhigh): FAIL. [High] Empty completedSteps+routingApprovals does not imply never-worked: beginStep may have stamped a kind:action ledger record; the moveTicket sweep clears only gate/specialty kinds, so a stale design-action record survives a lane correction (e.g. ready_for_design -> ready_for_decomposition) and checkDispatch would still authorize the designer. Fix: lane move must clear/abandon action-kind records (or lane requires no active-step record); add beginStep-then-correct test proving stale authorization cannot survive. Disposition: designer revision.
