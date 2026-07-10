---
id: T20260710T1535Z
type: task
status: implementing
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260710T1535Z-create-type-vs-status-advisory-and-an-evidence-free-authoring-correction-lane
estimate: 1
estimateBasis: T20260710T1533Z
workStartedAt: 2026-07-10T17:45:37Z
workCompletedAt: null
created: 2026-07-10T15:32:23Z
updated: 2026-07-10T19:09:33Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "design-review:codex-task:read-only@gpt-5.6-sol"]
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

A single additive change ships: a create-time stderr advisory that flags a
type-vs-status mismatch at ticket creation. It is warning-only, defaults-off for
existing boards, and refuses nothing that was previously allowed. The proposed
authoring-correction lane (Part 2 of the Requirement) was considered across three
design-review rounds and is REJECTED as disproportionate; `--override --reason`
remains the sanctioned correction path. See "Authoring-correction lane:
considered and rejected" below.

### Decision summary

- Part 1 (advisory): ADOPT as a warning to stderr from `commandCreate`, backed by
  a pure exported helper. Never refuses (statuses stay schema-legal); stdout
  stays exactly the created path.
- Part 2 (authoring-correction lane): REJECTED. The Requirement made lane
  adoption design-optional ("Consider (design decides)"). Three review rounds each
  surfaced a real ledger-atomicity edge that a 2-point QoL ticket should not be
  carrying. `--override --reason` stays the correction path. Rationale and a
  future-ticket pointer below.

### Related tickets and conflicts

- `T20260707T1329Z` (done) introduced `isStructurallyAllowed`/`isTransitionAllowed`
  and the `enforceTransitions` hard validator. Part 1 does not touch that
  machinery; the create-time advisory is orthogonal to transition validation.
- No overlapping in-flight tickets touch `createTicket`/`commandCreate`.

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
`codexTaskWarning` convention). It must name the conventional status and cite the
`doneRequires` rationale for why that status is conventional, e.g.:

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

### Authoring-correction lane: considered and rejected

The Requirement (Scope item 2) made the lane explicitly design-optional:
"Consider (design decides) extending the structural allow-set ... with an
authoring-correction lane." It was designed in full and taken through three
design-review rounds. Each round surfaced a distinct, real ledger-atomicity edge
in the lane's clear-the-stale-dispatch-record obligation:

1. Round 1 (stale action-record authorization): empty `completedSteps` +
   `routingApprovals` does NOT imply never-worked. `beginStep`
   (`src/tickets.js:1330`) stamps a `kind: "action"` ledger record at dispatch
   time, before any front-matter list is written. A lane correction (e.g.
   `ready_for_design -> ready_for_decomposition`) would leave that record live, and
   `checkDispatch` (`src/active-steps.js:231-234`) prioritizes the record's route
   over `resolveExpectedStep`, so the OLD-stage agent stays authorized.
2. Round 2 (publish-before-clear ordering): the proposed clear ran in the
   post-publish sweep, best-effort (`.catch(() => {})`) — it executed AFTER
   `writeTicketFile` published the new status and swallowed failures, so a failed
   clear published a half-corrected ticket (new status, stale record intact).
3. Round 3 (self-heal defeats fail-closed): relocating the clear pre-publish and
   making it throw-on-failure still does not hold, because `clearActiveStepIf`
   reads via `readLedgerSelfHeal`, which converts a corrupt/unreadable ledger to
   `{}`. On a transient read failure the clear silently no-ops (matches nothing)
   instead of throwing, so the fail-closed guarantee is illusory on exactly the
   corruption case it was meant to guard.

Disposition: REJECT. The lane's entire value is removing the `--override --reason`
ceremony for a rare, freshly-created-at-the-wrong-status authoring mistake. That
convenience does not justify carrying a clear primitive that has now failed to be
provably fail-closed three times against the shared dispatch machinery. Per the
acceptance criterion "existing boards and scripts are unaffected (warning-only
unless the lane is adopted ...)", shipping advisory-only is a sanctioned outcome:
existing boards stay warning-only and the lane is simply not adopted.

`--override --reason <text>` remains the sanctioned correction path for the retro
case (the same path the retro itself used successfully). `enforceTransitions`
correctly refuses `ready_for_design -> ready_for_decomposition` as unmapped, and
`--override` records the reason — the ceremony is the intended audit trail for a
manual off-map re-placement, not a defect.

Future-ticket pointer (NOT scoped here): a safe lane would first need two
primitives that do not exist today — (a) a strict-read ledger clear that
distinguishes "no matching record" from "ledger unreadable" and fails closed on
the latter (rather than `readLedgerSelfHeal`'s convert-to-`{}`), and (b)
shared-lock `beginStep` semantics so a `moveTicket` clear can exclude a concurrent
re-stamp (today `beginStep` at `src/tickets.js:1298` takes only the ledger file
lock, never the per-ticket `withTicketLock`). Both are systemic changes to the
`beginStep`/sweep family touching every dispatch path; they belong in their own
ticket, not this QoL item.

### Affected files

- `src/tickets.js`: add exported `typeStatusAdvisory(config, type, status)`
  (co-located with `invertStatusActions` and the config-derived status/action
  predicates). No change to `moveTicket` or the transition gate.
- `src/cli.js`: `commandCreate` loads config and emits the advisory on stderr
  before printing the path.
- `docs/Workflow.md`: add a short note about the create-time advisory (a warning,
  not a refusal) for a type-vs-status mismatch. No transition-validation or
  allow-set change. No README index change (no new doc file).
- `test/tickets.test.js`: unit tests for `typeStatusAdvisory`.
- `test/cli.test.js`: create-advisory integration test (stderr + stdout) via the
  child-process harness.

### Risks and edge cases

- stderr capture in tests: the in-process `runCli` helper patches `console.log`
  and `console.error` but NOT `console.warn`. Emitting via `console.warn` (matching
  `codexTaskWarning`) means the CLI integration test uses the child-process
  `runCliChild` harness (as the codex-task warning tests already do); the pure
  `typeStatusAdvisory` unit tests carry the fires/silent coverage regardless.
- Custom-config robustness: guard against a missing `doneRequires[type]` (no
  advisory) and a `doneRequires[type][0]` action with no producing status (name the
  action only).
- No schema change: statuses remain schema-legal at create; `enforceTransitions`
  defaults unchanged. Existing boards and scripts are unaffected.

### Test strategy

Advisory (unit, `typeStatusAdvisory`, deterministic):

- `story` + `ready_for_design` -> non-null, names `ready_for_decomposition` and
  cites `decompose`.
- `epic` + `ready_for_implementation` -> non-null, names `ready_for_decomposition`.
- `task` + `ready_for_design` -> null (silent).
- `task` + `ready_for_decomposition` -> non-null, names `ready_for_design`.
- `bug` + `ready_for_decomposition` -> non-null.
- any type + `backlog` (and an active/`questions` status) -> null.

Advisory (CLI integration, `runCliChild`):

- `create story ... --status ready_for_design`: exit 0, stdout is exactly the
  ticket path, stderr matches the advisory naming `ready_for_decomposition` and
  citing the `doneRequires` rationale.
- `create task ... --status ready_for_design`: exit 0, stderr contains no advisory.

`npm run check` and `node --test` must pass.

### Documentation updates

`docs/Workflow.md`: add one sentence noting the create-time advisory — a warning
(not a refusal) printed to stderr when a ticket is created at a status whose action
is not in that type's `doneRequires` (e.g. a story created at `ready_for_design`),
naming the conventional entry status. No change to the "Hard transition validation"
allow-set (the lane was not adopted). No README index change (no new doc file).

### Open questions

None blocking. The lane was descoped by orchestrator hard-stop decision after three
review rounds; the advisory (Part 1) was never faulted in any round and ships
unchanged.

## Implementation Notes

Implemented the descoped Part 1 (advisory-only). Part 2 (authoring-correction lane) is REJECTED per the Technical Design and was not implemented; no lane code exists in the diff.

Merge: branch predated several mainline merges (section H2 guard, skill prose, fallbackModels). `git merge mainline` completed with no conflicts (ort strategy, merge commit auto-created). Baseline `node --test test/tickets.test.js test/cli.test.js` after the merge: 242 pass, 1 skip, 0 fail.

`src/tickets.js`: added `pluralize(word)` (private, naive English pluralizer for the four fixed types) and exported `typeStatusAdvisory(config, type, status)`, co-located immediately after `invertStatusActions`. Predicate: `statusActions[status]` defined AND that action not in `doneRequires[type]`; guards a missing `doneRequires[type]` (returns null, nothing to compare against) and a `doneRequires[type][0]` action with no producing status in `statusActions` (names the action instead of throwing or fabricating a status) per the design's defensive-edge note.

`src/cli.js`: `commandCreate` now loads config (already-imported `loadConfig`) after `createTicket` succeeds, computes `typeStatusAdvisory(config, ticketType, status)`, and emits it via `console.warn` (stderr) before `console.log(ticketPath)`. Unconditional invocation; `null` return emits nothing, so stdout and the no-advisory path are byte-identical to pre-change behavior.

Design-review CONCERNS folded in: (1) code comment above `typeStatusAdvisory` and in `commandCreate`, plus the docs/Workflow.md note, describe the behavior as "warning-only for existing boards" -- never "defaults-off" (invocation is unconditional); (2) the warning's suggested correction is the working form `move <id> <status> --override --reason "<text>"`, not a plain `move` (which `enforceTransitions` would refuse as an unmapped transition).

Warning text emitted (story@ready_for_design example):
`WARNING: story created at ready_for_design, but stories complete via "decompose" (routing.doneRequires.story = [decompose]); the conventional entry status is ready_for_decomposition. The ticket was created; re-place it with "move <id> ready_for_decomposition --override --reason "<text>"" if this was unintended.`

Tests added:
- `test/tickets.test.js`: two unit tests for `typeStatusAdvisory` -- the fires/silent matrix from the design's Test Strategy (story@ready_for_design, epic@ready_for_implementation, task@ready_for_design silent, task@ready_for_decomposition, bug@ready_for_decomposition, every other doneRequires-covered task/bug status silent, backlog/questions silent for all four types, and the --override --reason suggestion is present), plus a custom-config-edge test (missing `doneRequires[type]` never fires; an action with no producing status names the action instead of throwing).
- `test/cli.test.js`: two `runCliChild` (child-process harness, required since `console.warn` is not one of the streams the in-process `runCli` helper patches -- same reason the existing codex-task-warning tests use it) integration tests -- `create story ... --status ready_for_design` warns on stderr naming `ready_for_decomposition` and the `--override --reason` form, stdout still exactly the created path, exit 0; `create task ... --status ready_for_design` is silent on stderr, stdout/exit unaffected.

`docs/Workflow.md`: one paragraph after the trigger-statuses list documenting the advisory as warning-only, independent of `enforceTransitions`, and naming the `--override --reason` correction path.

Verification: `npm run check` clean. Full `node --test`: 571 tests, 570 pass, 1 skipped (pre-existing slow smoke test, unrelated), 0 fail. `node --test test/skill-usage-sync.test.js test/resources-sync.test.js`: 9 pass, 0 fail.

Commits on branch `local-board/T20260710T1535Z-create-type-vs-status-advisory-and-an-evidence-free-authoring-correction-lane`:
- merge commit (git merge mainline, no conflicts)
- eb542c8 "T20260710T1535Z: add create-time type-vs-status advisory (stderr warning)"

No deviations from the descoped design.

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

- 2026-07-10T18:55:42Z: Design review #3 (sol@xhigh): FAIL. [High] clearActiveStepIf reads via readLedgerSelfHeal which converts corrupt/unreadable ledgers to {} - the lane clear silently no-ops instead of throwing, so fail-closed does not hold on transient read failures. Orchestrator hard-stop decision: DESCOPE per the Requirement's own latitude (lane adoption was design-optional). Part 1 advisory ships; Part 2 lane is REJECTED with rationale - three review rounds surfaced stale-authorization, publish-ordering, and self-heal-vs-fail-closed edges, disproportionate to removing --override ceremony for a rare authoring mistake. --override remains the correction path.

- 2026-07-10T19:02:02Z: Design review #4 (sol@xhigh): CONCERNS - 2 Medium wording fixes for the implementer: (1) opening says defaults-off but invocation is unconditional - phrase as warning-only for existing boards; (2) warning's suggested correction must use the working form move <id> <status> --override --reason <text> (plain move is refused under enforceTransitions). Disposition: proceed to implementation with both folded in.

- 2026-07-10T19:02:03Z: Recorded design review via codex-task:read-only@gpt-5.6-sol: CONCERNS after 4 rounds (3 on the now-rejected lane, 1 on descoped advisory): 2 Medium wording fixes folded into implementation; advisory design sound

- 2026-07-10T19:02:04Z: Ensured git branch local-board/T20260710T1535Z-create-type-vs-status-advisory-and-an-evidence-free-authoring-correction-lane (already-current).
