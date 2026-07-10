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
updated: 2026-07-10T18:14:48Z
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
allowed.

### Decision summary

- Part 1 (advisory): ADOPT as a warning to stderr from `commandCreate`, backed by
  a pure exported helper. Never refuses (statuses stay schema-legal); stdout
  stays exactly the created path.
- Part 2 (authoring-correction lane): ADOPT. Extend the `enforceTransitions`
  allow condition with a `ready_* -> ready_*/backlog` lane permitted only when the
  ticket has zero `completedSteps` AND zero `routingApprovals`. Justification and
  the provable-no-op argument are below.

### Related tickets and conflicts

- `T20260707T1329Z` (done) introduced `isStructurallyAllowed`/`isTransitionAllowed`
  and the `enforceTransitions` hard validator. This ticket extends that exact
  machinery; no conflict, but the design deliberately keeps `isStructurallyAllowed`
  status-only and adds the evidence-aware lane as a separate predicate rather than
  overloading the status-only allow-set.
- `B20260710T1225Z` (done) shaped the ledger-sweep predicates
  (`isAnyConsultationLedgerEntry`) that `moveTicket` runs on real status changes;
  Part 2 must confirm that sweep stays harmless on the lane (it does — see below).
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

Predicate (new, evidence-aware; kept separate from the status-only
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
`enforceTransitions === true` block only:

    if (config.routing?.enforceTransitions === true
        && !isTransitionAllowed(config, ticket.status, status)
        && !isAuthoringCorrectionLane(ticket.status, status, ticket.frontMatter)) {
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
already allowed by the map, so the lane never becomes the deciding factor for them.

Interaction with `requireGateConsultation` (FORWARD gate, evaluated as a separate
`if` after the transition gate): `gateStageForForwardMove` returns non-null ONLY
for the three exact forward stage-completion pairs (design->impl, impl->review,
test->docs). Genuine authoring corrections target `ready_for_decomposition`,
`backlog`, or an upstream/lateral `ready_*` that is none of those three `to`
values, so `gateStageForForwardMove` returns null and the block is skipped. For the
one overlap where the lane predicate would also match a gated forward pair
(e.g. `ready_for_design -> ready_for_implementation`), that pair is already
map-allowed, so the transition gate passes via the map regardless of the lane; and
crucially the gate-consultation `if` runs INDEPENDENTLY of how the transition gate
passed. The lane therefore cannot smuggle a ticket past a gate: with zero
`completedSteps`, `gateConsultationRecords` is empty and the forward move still
refuses. Confirmed: the gate cannot fire on a zero-evidence lateral/upstream
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

Interaction with the dispatch-verification ledger sweep: `moveTicket` runs
`clearActiveStepIf(root, ticketId, isAnyConsultationLedgerEntry)` on any real status
change (`ticket.status !== status`), which a lane move is. This sweeps lingering
gate/specialty consultation stamps from the active-steps ledger (a separate store
from front-matter `completedSteps`). A freshly created, never-worked ticket has no
`begin-step`/`gate-check` ledger entry, so the sweep matches nothing — a best-effort
no-op. Even in the pathological case of a stray consultation stamp, clearing it on
an authoring re-placement is the correct abandonment behavior, not a regression.
Harmless.

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
  `&& !isAuthoringCorrectionLane(...)` clause to the `enforceTransitions` gate in
  `moveTicket`.
- `src/cli.js`: `commandCreate` loads config and emits the advisory on stderr
  before printing the path.
- `docs/Workflow.md`: extend the "Hard transition validation" allow-set list with
  the authoring-correction lane bullet and its zero-evidence precondition; add a
  short note (statuses/eligibility area) about the create-time advisory.
- `test/tickets.test.js`: unit tests for both new predicates.
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
  bypassed. Documented as such.
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

Lane (unit, `isAuthoringCorrectionLane`): true for
`ready_for_design -> ready_for_decomposition` with empty lists; false once
`completedSteps` has any token; false once `routingApprovals` has any token; false
for a non-`ready_*` source; true for `ready_* -> backlog` with empty lists; false
for `ready_* -> designing` (active target, not covered).

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

`npm run check` and `node --test` must pass.

### Documentation updates

`docs/Workflow.md` "Hard transition validation": add a bullet to the structural
allow-set list for the authoring-correction lane — "a `ready_*` status -> any
`ready_*` status or `backlog`, permitted only while the ticket has zero
`completedSteps` and zero `routingApprovals` (a pure authoring re-placement with no
recorded evidence to invalidate)" — and one sentence noting the create-time
advisory (a warning, not a refusal) for a type-vs-status mismatch. No README index
change (no new doc file).

### Open questions

None blocking. One design choice already resolved in favor of the stronger
invariant: the lane precondition requires zero `routingApprovals` in addition to the
Requirement's zero `completedSteps`, so the loop-back no-op is provable rather than
merely likely.

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
