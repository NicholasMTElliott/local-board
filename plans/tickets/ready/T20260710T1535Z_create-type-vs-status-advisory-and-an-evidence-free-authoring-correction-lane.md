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
updated: 2026-07-10T18:39:13Z
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
would otherwise leave behind. This revision (#2) makes that clear **atomic and
fail-closed** inside `moveTicket`'s ticket-locked span, closing the re-review
finding that the clear ran after the status was published and swallowed failures.

### Decision summary

- Part 1 (advisory): ADOPT as a warning to stderr from `commandCreate`, backed by
  a pure exported helper. Never refuses (statuses stay schema-legal); stdout
  stays exactly the created path.
- Part 2 (authoring-correction lane): ADOPT. Extend the `enforceTransitions`
  allow condition with a `ready_* -> ready_*/backlog` lane permitted only when the
  ticket has zero `completedSteps` AND zero `routingApprovals`, AND clear any
  lingering `kind: "action"` ledger record — the clear performed inside the
  ticket lock, before the status is published, and fail-closed (a clear failure
  refuses the move rather than publishing a half-corrected state).

### Related tickets and conflicts

- `T20260707T1329Z` (done) introduced `isStructurallyAllowed`/`isTransitionAllowed`
  and the `enforceTransitions` hard validator. This ticket extends that exact
  machinery; the design keeps `isStructurallyAllowed` status-only and adds the
  evidence-aware lane as a separate predicate rather than overloading the
  status-only allow-set.
- `B20260710T1225Z` (done) shaped the ledger-sweep predicates
  (`isAnyConsultationLedgerEntry`, `isActionLedgerEntry`) and the identity-scoped
  `clearActiveStepIf` seam that `moveTicket` and the complete-step/gate paths run;
  Part 2 both relies on and extends that machinery (a new kind-only action
  predicate, `isAnyActionLedgerEntry`).
- Gate/loop-back features (`requireGateConsultation`, `requireDesignReview`,
  `invalidateOnLoopBack`, `guardPrematureEvidence`) all interact with `moveTicket`;
  each interaction is analyzed below.
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
  so it fires — precisely "story/epic created at a status whose action is not
  decompose."
- task/bug: `doneRequires` is `["design","implement","review","test","document"]`,
  covering every trigger action except `decompose`. So the only trigger status
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

Placement and output channel:

- New pure exported helper `typeStatusAdvisory(config, type, status) -> string |
  null` in `src/tickets.js` (co-located with the config-derived status/action
  predicates and `invertStatusActions`). Pure and deterministic — the primary
  unit-test surface.
- `commandCreate` (`src/cli.js`) loads config once, computes the advisory after
  `createTicket` succeeds, and emits it via `console.warn` (stderr) BEFORE the
  existing `console.log(ticketPath)`. stdout remains exactly the path; a `null`
  return emits nothing (byte-identical to today for conventional creates).

No change to `createTicket` itself — it stays free of config concerns.

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
`enforceTransitions === true` block. Compute a single `admittedViaLane` flag once
and reuse it for both the allow-condition and the fail-closed clear:

    const admittedViaLane =
      config.routing?.enforceTransitions === true
      && !options.overrideTransition
      && !isTransitionAllowed(config, ticket.status, status)
      && isAuthoringCorrectionLane(ticket.status, status, ticket.frontMatter);

    if (config.routing?.enforceTransitions === true
        && !isTransitionAllowed(config, ticket.status, status)
        && !admittedViaLane) {
      ... existing override / refusal ...
    }

The `!options.overrideTransition` conjunct is new in this revision and matters for
the fail-closed contract below: an explicit `--override` takes the manual escape
path (records the override, preserves action records like every other non-lane
move) and is NOT treated as a lane admission, so the fail-closed clear never runs
on a forced transition and the refusal message can honestly point the user to
`--override` as the fallback. The lane remains purely additive — it can only turn a
would-be refusal into an allow, never the reverse, and lives entirely inside the
`enforceTransitions` gate, so `enforceTransitions: false` boards see no change.

Because `isTransitionAllowed` short-circuits `true` for every mapped/structural
move, the lane predicate is only ever consulted for moves not otherwise allowed —
e.g. `ready_for_design -> ready_for_decomposition` (the exact retro gap),
`ready_for_implementation -> ready_for_decomposition`, or any `ready_* -> backlog`.
Mapped forward pairs are already allowed by the map, so `admittedViaLane` is false
for them and the lane never becomes the deciding factor.

Gate interactions (unchanged from prior revision, still valid): a genuine
zero-evidence lateral/upstream correction targets `ready_for_decomposition`,
`backlog`, or an upstream `ready_*` — never one of the three gated forward `to`
values — so `gateStageForForwardMove`/`isDesignReviewGatedMove` return null/false
and those blocks are skipped. For the one overlap (`ready_for_design ->
ready_for_implementation`) the move is map-allowed anyway, the gate/design-review
`if`s run independently of how the transition gate passed, and with zero evidence
they still refuse — the lane cannot smuggle a ticket past a gate.

Loop-back no-op (provable): the `invalidateOnLoopBack` block runs only when
`TRIGGER_STATUSES.has(status)`. For `-> backlog` it is skipped; for `-> ready_*` it
calls `invalidateDownstreamEvidence` with both input lists empty by the lane
precondition, so nothing is removed, `nextFrontMatter` is unchanged, and no Run Log
line is appended. No-op by construction.

### Part 2 — atomic, fail-closed clear of the stale action record

The finding this revision closes: `beginStep` (`src/tickets.js:1330`) stamps a
`kind: "action"` ledger record (route = the stage's agent, e.g.
`claude-subagent:local-board-designer`) at dispatch time. Front-matter
`completedSteps` is not written until `complete-step`, so a ticket that was
dispatched but not yet completed has EMPTY front-matter lists AND a live
`kind: "action"` record — and is lane-eligible. If that record survives a lane
correction (e.g. `ready_for_design -> ready_for_decomposition`), `checkDispatch`
(`src/active-steps.js:231-234`) prioritizes the record's route/model over
`resolveExpectedStep` and would still authorize the OLD-stage agent.

The prior revision cleared the record in the post-publish sweep block
(`src/tickets.js:915-917`), best-effort (`.catch(() => {})`). Re-review found three
interleavings that let stale authorization survive: (a) the clear ran AFTER
`writeTicketFile` published the new status, (b) a failed clear was swallowed so the
ticket published its new status with the stale record intact, and (c) — out of
scope, see Known limitations. This revision fixes (a) and (b) by relocating the
action clear to BEFORE publish and making it fail-closed.

Predicate (kind-only action-record analogue of `isAnyConsultationLedgerEntry`):

    // Matches any kind:"action" entry regardless of action name. A legacy
    // record with no `kind` reads as "action".
    function isAnyActionLedgerEntry(record) {
      return (record.kind ?? "action") === "action";
    }

Exact placement: inside `moveTicket`'s `withTicketLock` callback, AFTER all refusal
gates (transition gate, gate consultation, design review, loop-back invalidation —
all no-ops for a lane move) and AFTER `content`/`targetFolder`/`targetPath` are
computed, but BEFORE the first filesystem mutation of the ticket, i.e. immediately
before `await mkdir(targetFolder, { recursive: true });` (currently line 872). At
that point nothing about the ticket has been written or renamed, so a throw leaves
the ticket entirely unchanged:

    if (admittedViaLane) {
      // Fail-closed: clear the abandoned in-flight action-dispatch record BEFORE
      // the new status is published (the mkdir/rename/write below). This runs
      // inside the ticket lock, so the corrected status and the ledger clear are
      // published as one unit from the ticket writer's perspective. If the clear
      // throws, the move REFUSES with the ticket untouched -- no half-corrected
      // ticket whose folder/front matter say ready_for_decomposition while the
      // ledger still authorizes the designer. Deliberately NOT best-effort,
      // unlike the post-publish consultation sweep below.
      try {
        await clearActiveStepIf(
          root, ticketId, isAnyActionLedgerEntry, options.__laneClearLedgerOptions,
        );
      } catch (error) {
        throw new Error(
          `${ticket.path}: move refused: could not clear the in-flight ` +
            `action-dispatch record for ${ticket.id} before re-placing it to ` +
            `${status} (${error.message}); the ticket was NOT moved. Re-run with ` +
            `--override --reason <text> to force ${ticket.status} -> ${status}, ` +
            `or resolve the active-steps ledger and retry.`,
        );
      }
    }

Fail-closed error shape: a `move refused:` prefix consistent with the transition
and gate refusals, naming the ticket, the intended target, the underlying cause
(`error.message`), an explicit "the ticket was NOT moved", and the `--override`
fallback path (which is why `admittedViaLane` excludes `overrideTransition` — the
override path does not run this clear).

Ordering constraint with the existing post-publish consultation sweep: the two
clears stay SEPARATE and are not merged.

- The lane action clear runs pre-publish and fail-closed, and is lane-scoped.
- The consultation sweep (`clearActiveStepIf(root, ticketId,
  isAnyConsultationLedgerEntry)` at lines 915-917) stays exactly where it is —
  post-publish, best-effort (`.catch(() => {})`), on every real status change. It
  targets disjoint kinds (`gate`/`specialty`), so removing the action record early
  cannot affect it. It MUST stay best-effort and post-publish: it handles
  abandonment for ALL moves, and making an unrelated gate/specialty cleanup able to
  fail a move would change behavior for every status transition. Only the lane's
  own action clear carries a by-construction guarantee strong enough to justify
  fail-closed semantics.

Ledger/ticket consistency if the write fails AFTER a successful clear: the clear is
the first side effect; if the subsequent rename/write throws, the ledger entry is
already gone but the ticket stays at its ORIGINAL status. `checkDispatch` then falls
through to `resolveExpectedStep` for that original status, which resolves the
correct original-stage agent — so no wrong-agent authorization results, and a
re-`begin-step` idempotently re-stamps. This is strictly safer than the reverse
ordering and is the intended fail-closed direction.

Why clear-on-lane-move (not "lane requires no active record"): front-matter-only
eligibility stays pure and deterministic; coupling admission to the runtime
`.local-board/active-steps.json` cache would make the predicate async and
non-deterministic, and — because that cache self-heals to `{}` on corruption — a
require-no-record lane would silently re-open on a corrupt ledger (the opposite of
the safe default) and would bounce legitimate corrections back to `--override`. The
chosen approach reuses the existing `clearActiveStepIf` seam.

### Known limitations (interleaving explicitly out of scope)

Interleaving (c) from the finding — a concurrent `beginStep` re-stamping an action
record after the clear — is NOT addressed and is documented as a pre-existing
systemic property, not a regression this ticket introduces:

- `beginStep` (`src/tickets.js:1298`) takes only the ledger file lock (via
  `stampActiveStep` -> `withFileLock` on `<ledger>.lock`); it does NOT take the
  per-ticket `withTicketLock`. So no `moveTicket` clear — the new lane clear
  included — can exclude a concurrent `beginStep` re-stamp under a shared lock.
- This exposure is IDENTICAL for the existing consultation sweep and for every
  other status change today: any `moveTicket` can be raced by a concurrent
  `begin-step`/`gate-check`/`specialty-run` that re-stamps immediately after the
  sweep. Nothing about the authoring-correction lane is uniquely affected.
- The dispatch layer is advisory/fail-open by design: `checkDispatch` is a
  verification query behind a fail-open PreToolUse hook, and the ledger stamp is a
  best-effort authorization cache (systemPatterns: "the active-steps ledger stamp
  always records the configured logical route/model"; self-healing reads return
  `{}` on corruption). A stray re-stamp at worst re-authorizes a stage the user is
  about to re-dispatch anyway, and self-heals on the next `begin-step`.
- Engineering cross-process generation counters / ticket-lock sharing into
  `beginStep` is a systemic change far beyond a 2-point QoL ticket and would touch
  every dispatch path, not just this lane. Out of scope here; if it is ever wanted
  it belongs in its own ticket covering the whole `beginStep`/sweep family.

I read `beginStep`, the sweep, and the hook rationale and concur with scoping this
out; the fix genuinely belongs to the shared dispatch machinery, not this lane.

### Affected files

- `src/tickets.js`: add exported `typeStatusAdvisory(config, type, status)` and
  `isAuthoringCorrectionLane(fromStatus, toStatus, frontMatter)`; add the kind-only
  `isAnyActionLedgerEntry(record)` predicate; in `moveTicket` compute
  `admittedViaLane` (now also gated on `!options.overrideTransition`), add the
  `&& !admittedViaLane` clause to the `enforceTransitions` gate, and add the
  pre-publish, fail-closed lane action clear immediately before the mkdir/rename
  block. The post-publish consultation sweep is unchanged.
- `src/cli.js`: `commandCreate` loads config and emits the advisory on stderr
  before printing the path.
- `docs/Workflow.md`: extend the "Hard transition validation" allow-set list with
  the authoring-correction lane bullet and its zero-evidence precondition; note
  that admitting a move via the lane also clears any in-flight action-dispatch
  record (fail-closed: a clear failure refuses the move and directs the user to
  `--override`); add a short note about the create-time advisory.
- `test/tickets.test.js`: unit tests for the new predicates and the
  begin-step-then-lane-correction dispatch-authorization tests (sequential success
  plus the clear-failure regression).
- `test/cli.test.js`: create-advisory integration test (stderr + stdout) and lane
  end-to-end move tests.

### Risks and edge cases

- stderr capture in tests: the in-process `runCli` helper patches `console.log`
  and `console.error` but NOT `console.warn`. Emitting via `console.warn` (matching
  `codexTaskWarning`) means the CLI integration test uses the child-process
  `runCliChild` harness (as the codex-task warning tests already do); the pure
  `typeStatusAdvisory` unit tests carry the fires/silent coverage regardless.
- Custom-config robustness: guard against a missing `doneRequires[type]` (no
  advisory) and a `doneRequires[type][0]` action with no producing status (name the
  action only).
- Lane breadth: the lane permits any zero-evidence `ready_* -> ready_*/backlog`,
  including lateral re-placements normally map-blocked. Intentional and safe: zero
  evidence means no stage work is recorded, nothing is lost, no gate is bypassed,
  and the fail-closed action clear guarantees no stale in-flight dispatch survives.
- Action-clear scoping: the clear is strictly `admittedViaLane`-gated (and thus
  never on an `--override` forced move). A regression test pins that a NON-lane real
  status change still PRESERVES a `kind: "action"` record.
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

Predicate units:

- `isAuthoringCorrectionLane`: true for `ready_for_design ->
  ready_for_decomposition` with empty lists; false once `completedSteps` has any
  token; false once `routingApprovals` has any token; false for a non-`ready_*`
  source; true for `ready_* -> backlog` with empty lists; false for `ready_* ->
  designing`.
- `isAnyActionLedgerEntry`: true for `{kind:"action",...}` and for a legacy record
  with no `kind`; false for `{kind:"gate"}` and `{kind:"specialty"}`.

Lane (end-to-end `moveTicket` with `enforceTransitions: true`):

- zero-evidence `ready_for_design -> ready_for_decomposition` succeeds with NO
  `--override`, no override/invalidation Run Log line, file relocated to `ready`.
- the same move with one `completedSteps` token refuses with the standard
  allowed-targets error; a ticket with only a `routingApprovals` token also refuses
  (proving the both-lists precondition).
- regression: an existing mapped move and an existing structural move
  (`backlog -> ready_*`) behave identically; `enforceTransitions: false` boards are
  unaffected.
- provable-no-op check: zero-evidence lane move to a `ready_*` target with
  `invalidateOnLoopBack: true` produces no invalidation Run Log line and leaves
  `completedSteps`/`routingApprovals` untouched.

Stale-authorization sequential test (RETAINED), `enforceTransitions: true`, on a
freshly-created never-completed ticket at `ready_for_design`:

1. `beginStep(root, id)` stamps the `kind: "action"`, `action: "design"` record.
2. Baseline: `checkDispatch(root, { agent: "local-board-designer", ticketId: id })`
   returns allow (code 0, reason `match`) via the record.
3. `moveTicket(root, id, "ready_for_decomposition")` (no `--override`) succeeds via
   the lane.
4. Assert the ledger has NO entry for the ticket — the action record was cleared.
5. Assert `checkDispatch(... local-board-designer ...)` now DENIES (code 1, reason
   `agent-mismatch`): the old-stage agent is no longer authorized.
6. Assert `checkDispatch(... local-board-decomposer ...)` ALLOWS (code 0) via the
   no-ledger `resolveExpectedStep` path for the new status.

Non-lane preservation assertion (RETAINED): begin-step, then a NON-lane real status
change (a ticket carrying a `completedSteps` token forced via `--override`, or a
mapped forward move) — assert the `kind: "action"` record is PRESERVED (the action
clear is lane-only; the general sweep still preserves action kinds).

Clear-failure regression (NEW — proves fail-closed atomicity):

- Test seam: the lane clear is `clearActiveStepIf(root, ticketId,
  isAnyActionLedgerEntry, options.__laneClearLedgerOptions)`. `moveTicket` threads
  an (undefined-in-production) `options.__laneClearLedgerOptions` bag straight
  through to `clearActiveStepIf`, whose existing `__afterRead` hook — invoked under
  the ledger lock AFTER the predicate matches and BEFORE the delete
  (`src/active-steps.js:139-141`) — is the injection point. This is the same
  `__afterRead` seam pattern the ledger-race tests already use, and is chosen over
  a filesystem-permission approach because it is deterministic and cross-platform
  (a read-only ledger file fails a rename-over on Windows but not on POSIX, where
  rename permission derives from the directory).
- Steps: `beginStep(root, id)` stamps the action record (so the predicate matches
  and `__afterRead` is reached), then call `moveTicket(root, id,
  "ready_for_decomposition", { __laneClearLedgerOptions: { __afterRead: () => {
  throw new Error("simulated ledger write failure"); } } })`.
- Assert the move REJECTS with the `move refused: could not clear the in-flight
  action-dispatch record ... the ticket was NOT moved` error.
- Assert the ticket file still lives in the ORIGINAL (`ready_for_design`) folder
  and its front matter `status` is still `ready_for_design` — no publish happened.
- Assert the ledger STILL holds the `kind: "action"` record (the throw fired before
  the delete), i.e. no partial ledger mutation either.

`npm run check` and `node --test` must pass.

### Documentation updates

`docs/Workflow.md` "Hard transition validation": add a bullet to the structural
allow-set for the authoring-correction lane — "a `ready_*` status -> any `ready_*`
status or `backlog`, permitted only while the ticket has zero `completedSteps` and
zero `routingApprovals` (a pure authoring re-placement with no recorded evidence to
invalidate); admitting a move via this lane first clears any in-flight
action-dispatch ledger record, inside the same lock and before the new status is
published, so a stale stage agent (e.g. the designer) can never keep being
authorized — and if that clear fails the move is refused (use `--override --reason`
to force the transition instead)" — plus one sentence noting the create-time
advisory (a warning, not a refusal) for a type-vs-status mismatch. No README index
change (no new doc file).

### Open questions

None blocking. Design choices resolved in favor of the stronger invariant: (1) the
lane precondition requires zero `routingApprovals` in addition to zero
`completedSteps`, so the loop-back no-op is provable; (2) the abandoned
`kind: "action"` record is cleared inside the ticket lock, before publish, and
fail-closed, so a stale in-flight dispatch can neither survive an authoring
correction nor leave a half-corrected ticket on a clear failure; (3) the
unlocked-`beginStep` re-stamp interleaving is a pre-existing systemic property of
the shared dispatch machinery (fail-open hook, best-effort ledger) and is scoped
out with rationale rather than expanded into this 2-point ticket.

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

- 2026-07-10T18:32:21Z: Design re-review (sol@xhigh): FAIL. [High] Lane clear not atomic: moveTicket publishes status before clearing and swallows clear failures; unlocked beginStep can re-stamp after the clear; sequential test misses all interleavings. Disposition: revision #2 - clear moves INSIDE moveTicket's locked span BEFORE publish, lane move fails closed (falls back to --override path) if the clear errors; the beginStep-no-shared-lock interleaving is pre-existing systemic (identical for the gate/specialty sweep) and will be documented as out of scope with a rationale. Round 3 = hard stop.
