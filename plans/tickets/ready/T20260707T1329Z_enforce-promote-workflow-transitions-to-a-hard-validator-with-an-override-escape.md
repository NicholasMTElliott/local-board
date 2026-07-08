---
id: T20260707T1329Z
type: task
status: ready_for_implementation
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: 4
estimateBasis: T20260707T1331Z
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T13:29:41Z
updated: 2026-07-08T01:50:53Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
routingApprovals: []
---
# enforce: promote workflow.transitions to a hard validator with an override escape

## Requirement

Intermediate transitions are advisory: `moveTicket` (`src/tickets.js:279-300`) validates routing only for `done` and accepts any known status from any status; `plans/local-board.config.jsonc:42` notes it is "not a hard transition validator yet" (also listed as an open decision in memory-bank/techContext.md). An orchestrator can move `ready_for_implementation -> ready_for_test`, skipping review; ordering (review-before-test) is never checked anywhere.

Fix: promote `workflow.transitions` to a hard validator — `move` refuses a target status not listed in the current status's transitions — with an explicit `--override` escape that records itself in the Run Log. Config switch for advisory mode to preserve current behavior where wanted.

Acceptance: illegal transitions are refused with the allowed list in the error; `--override` works and leaves a trace; all existing tests and skill flows pass under the hard validator.

## Acceptance Criteria

## Related Tickets

## Technical Design

Promote `workflow.transitions` from advisory guidance to a hard, refusable
validator in `moveTicket`, gated by a new `routing.enforceTransitions` config
switch (off in `DEFAULT_CONFIG` for back-compat, on in the `init` scaffold). A
refused move throws before any side effect and names the allowed targets. An
explicit `--override --reason <text>` escape forces the move and records a
"Transition override" line in the Run Log. The map alone is insufficient — it
is missing several legitimate moves this session actually performs — so the
change also completes the DEFAULT/scaffold map and adds a small structural
allow-set in code for administrative transitions that are not pipeline
decisions.

## Related Tickets

- T20260707T1327Z — gate-consultation precondition in `moveTicket`; also
  confirmed `set <id> status` routes through `moveTicket` (`setTicketField`
  short-circuits `field === "status"` to `moveTicket`, `src/tickets.js:680`).
  The new validator lands in the same function and therefore covers `set
  status` for free.
- T20260707T1328Z — loop-back invalidation in `moveTicket`
  (`invalidateDownstreamEvidence`). The transition check must run *before* this
  so a refused move strips nothing.
- T20260707T1332Z / T20260707T1325Z — `start-work` (`begin-step` ordering) path
  performs an internal `moveTicket` `ready_for_implementation -> implementing`
  (`src/git.js:30`); the map must permit it or it must be structurally allowed
  (see audit below).

## Approach

### 1. Config switch: `routing.enforceTransitions`

Follow the exact pattern of `requireGateConsultation` / `invalidateOnLoopBack` /
`worktrees.guardWrongRoot`:

- `DEFAULT_CONFIG.routing.enforceTransitions = false` (`src/config.js`) — the
  ENOENT fallback and deep-merge base keep it off, so a pre-existing config that
  omits the key does not silently start refusing moves on upgrade.
- `defaultConfigJsonc()` scaffold sets `"enforceTransitions": true` with a
  comment block mirroring the two adjacent routing switches — new repos get the
  hard validator.
- Read it exactly like the siblings: `config.routing?.enforceTransitions ===
  true`. No normalizer is needed (these booleans are never run through
  `normalize*`; they are read defensively with `=== true`).
- Extend the guard test `test/config.test.js` "defaultConfigJsonc matches
  DEFAULT_CONFIG except for documented differences": add
  `routing.enforceTransitions` as the fifth allowlisted diff path (both the
  `expected.routing.enforceTransitions = true` line and the collapsed
  `leafDiffPaths` array). Add a focused back-compat test mirroring the
  `invalidateOnLoopBack` one: omitted key -> false; explicit true/false honored;
  scaffold -> true.

Because this repo dogfoods its own board, `plans/local-board.config.jsonc` is a
separate real config; flipping `enforceTransitions` on *there* (post-merge) is
the orchestrator's call, not part of this change. Note it in the ticket's
Documentation Updates / hand-off, and update the inline comment at
`plans/local-board.config.jsonc:42` ("not a hard transition validator yet").

### 2. The validator in `moveTicket`

Add a pure helper alongside the existing structural constants
(`GATE_FORWARD_TRANSITIONS`, `ACTIVE_STATUS_TO_READY`, `STAGE_TO_STATUS`):

```
isTransitionAllowed(config, fromStatus, toStatus) -> boolean
```

It returns true when EITHER:

- `toStatus` is one of the `.status` values in
  `config.workflow.transitions[fromStatus]` (the map — the pipeline-ordering
  authority), OR
- the move is in a fixed **structural allow-set** (administrative transitions
  that are not pipeline decisions; see §3).

In `moveTicket`, load config unconditionally now (today it is loaded lazily via
`needsConfig`; the validator needs it on nearly every call, so just load it once
up front — cheap, and it already loads for gated/`done`/trigger moves). Then, as
the **first** gate after `findTicket` and before the gate-consultation
precondition and before loop-back invalidation:

```
if (config.routing?.enforceTransitions === true
    && !isTransitionAllowed(config, ticket.status, status)) {
  if (options.overrideTransition) {
    // record it, proceed (see §4)
  } else {
    throw new Error(<refusal with allowed list>);  // zero side effects
  }
}
```

Ordering rationale (design decision 3): the refusal `throw` happens before the
gate precondition check, before `invalidateDownstreamEvidence`, and long before
the rename/write. `moveTicket` performs no fs mutation until the `mkdir` /
`renameWithRetry` block near the end, so a refused move is guaranteed
side-effect-free (nothing is written, nothing stripped, no folder created). A
same-status move (`ticket.status === status`) should short-circuit as allowed
(no-op re-save) — verify it is not accidentally refused (self-transition is not
in the map); simplest is `fromStatus === toStatus` returns true in
`isTransitionAllowed`.

### 3. Map completeness audit + structural allow-set

The hard validator is only as safe as the set of legal moves. I traced every
move this session and the internal callers against the current map (source keys:
`ready_for_decomposition`, `ready_for_design`, `ready_for_implementation`,
`implementing`, `ready_for_review`, `reviewing`, `ready_for_test`, `testing`,
`ready_for_docs`; no entries for `backlog`, `designing`, `questions`, `blocked`,
`done`, `archived`).

Moves that occur but the current map does NOT allow:

| Move | Source | Status quo | Fix |
|---|---|---|---|
| `ready_for_implementation -> implementing` (`start-work`, `src/git.js:30`) | code | refused | structural (ready_* -> paired active) |
| `questions -> ready_*` (resume after answer) | session round-trip | refused (no `questions` key) | structural |
| `blocked -> ready_*` (resume after unblock) | session | refused (no `blocked` key) | structural |
| `ready_* -> archived` (supersede a ticket, e.g. from `ready_for_design`/`ready_for_decomposition`) | session | refused (no `archived` target anywhere) | structural (any -> archived) |
| `done -> archived` (retention, `archiveDoneTickets` -> same `moveTicket`, `src/tickets.js:663`) | internal | refused | structural (any -> archived) |
| `backlog -> ready_*` (promote/groom out of backlog) | session/tests | refused (no `backlog` key) | structural |
| Forward-from-`designing` (`designing -> ready_for_implementation`) | asymmetry: `implementing`/`reviewing`/`testing` have map entries, `designing` does not | refused if ever entered | **map addition** |

Decision — split the fixes into two mechanisms:

**A. Map additions (agent-facing, DEFAULT_CONFIG + scaffold, kept in sync per
the guard test).** Only the pipeline-decision gap: add a `designing` source
entry mirroring `ready_for_design` (`-> ready_for_implementation`, `->
questions`, `-> blocked`). This restores symmetry with the other three active
statuses and keeps the advisory `transitions` guidance (surfaced by `begin-step`
/ `query-*` via `transitionsForStatus`) meaningful. Do NOT bloat the map with
`archived`/active/resume targets on every status — those are not orchestrator
decision points and would pollute the advisory `when` guidance.

**B. Structural allow-set in code (a fixed constant, like
`GATE_FORWARD_TRANSITIONS`; NOT surfaced as advisory guidance).** These are
administrative/escape transitions, independent of pipeline ordering, always
permitted when enforcement is on:

1. `fromStatus === toStatus` (idempotent re-save).
2. `backlog -> any TRIGGER_STATUS` (promote out of backlog).
3. ready_* -> its paired active status — the inverse of `ACTIVE_STATUS_TO_READY`
   (`ready_for_design->designing`, `ready_for_implementation->implementing`,
   `ready_for_review->reviewing`, `ready_for_test->testing`) — `start-work`.
4. active status -> its own ready_* (revert/back-out), i.e.
   `ACTIVE_STATUS_TO_READY` direct.
5. `questions -> any TRIGGER_STATUS` and `blocked -> any TRIGGER_STATUS`
   (resume; origin is not tracked, so allow any ready_*).
6. any status -> `archived` (supersede + retention `done -> archived`).
7. any status -> `questions` and any status -> `blocked` (escape hatches from
   any state; covers `designing`/`backlog` which the map does not list, and
   makes the redundant map `questions`/`blocked` entries harmless).

What the map still exclusively gates after this split: `ready_*`/active ->
`ready_*` forward and backward moves. That is precisely the ordering the ticket
targets — e.g. `ready_for_implementation -> ready_for_test` (skip review) is
neither in the map nor structural, so it is refused;
`ready_for_review -> ready_for_test` is in the map, so it passes. Back-loops
(`ready_for_review -> ready_for_implementation`, `ready_for_test ->
ready_for_design`, etc.) remain map-governed.

Consequence for design decision 4: because "any -> archived" is structural, the
internal retention move (`done -> archived`) is allowed **by construction** with
no special bypass. I still add an internal `options.overrideTransition` escape
(see §4) for the CLI path; retention does not need to pass it.

### 4. `--override` semantics

- CLI: `commandMove` (`src/cli.js:642`) takes `--override` (flag) and `--reason`
  (option, via `takeOption` — already used by `approve-inline`). Recommend
  `--reason` **optional but encouraged**; keep the flag surface to these two.
  Thread through `moveAndMaybeMerge` -> `moveTicket(root, id, status, {
  overrideTransition: { reason } })`.
- Semantics: `overrideTransition` only matters when enforcement is on AND the
  move would otherwise be refused. If the move is already allowed, `--override`
  is a silent no-op (no misleading Run Log line). So: run `isTransitionAllowed`;
  if disallowed and `overrideTransition` present -> append Run Log line and
  proceed; if disallowed and absent -> throw; if allowed -> proceed regardless.
- Run Log line (appended in the same locked write span, like the invalidation
  line): `Transition override: <from> -> <to>: <reason>` — omit `: <reason>`
  when no reason was given. Appended to the `body` before `renderMarkdownTicket`
  so it lands in the moved file atomically.
- `set <id> status` (design decision 5): confirmed routes through `moveTicket`
  and inherits the validator automatically. `commandSet` does not currently
  parse `--override`; recommend adding the same two flags to `commandSet`'s
  status branch for parity (small), or document that forced moves use `move`.
  Prefer adding them for parity.

### 5. Error message (safety-valve requirement)

The refusal must name the legal targets so an operator is never stuck. Compute
the allowed set = map targets for `fromStatus` (the `.status` values) UNION the
structural targets applicable to `fromStatus`, de-duplicated and stable-ordered.
Example:

```
<path>: move refused: transition ready_for_implementation -> ready_for_test is
not allowed. Allowed targets: ready_for_review, ready_for_design, implementing,
questions, blocked, archived. Re-run with --override --reason <text> to force
this transition (it will be recorded in the Run Log), or set
routing.enforceTransitions to false for advisory-only mode.
```

## Affected Files

- `src/config.js` — `DEFAULT_CONFIG.routing.enforceTransitions = false`;
  scaffold `enforceTransitions: true` + comment; update the
  `plans/local-board.config.jsonc:42` "not a hard transition validator yet"
  comment (separate real config file).
- `src/tickets.js` — new `isTransitionAllowed` + structural allow-set constant +
  `allowedTargetsFor` (for the error message); validator block at the top of the
  `moveTicket` lock body; unconditional config load; add `designing` map entry
  in `DEFAULT_CONFIG` (and scaffold string in `config.js`).
- `src/cli.js` — `--override`/`--reason` parsing in `commandMove` (and
  `commandSet` status branch); thread `overrideTransition` through
  `moveAndMaybeMerge`; usage/help lines (`move` and `set` usage strings).
- `test/config.test.js` — extend guard-test allowlist (fifth diff path);
  back-compat default test.
- `test/tickets.test.js` (+ possibly `test/git.test.js`, `test/cli.test.js`) —
  validator behavior tests; audit existing move sequences under the scaffold
  config.
- Docs: `docs/Workflow.md`, `memory-bank/systemPatterns.md`,
  `memory-bank/techContext.md` (resolve the "Open Decision"), `SKILL.md` /
  `skills/codex/local-board/SKILL.md` (override verb), README config reference if
  present.

## Risks & Edge Cases

- **The map/allow-set being wrong blocks legitimate work.** This is the headline
  risk. Mitigations: (a) the completeness audit above, promoted into the DEFAULT
  map + structural set in this same change (design decision 1); (b) the
  `--override` safety valve; (c) the error message names allowed targets so an
  operator is never guessing. Recommend the implementer re-run the audit against
  the full CLI verb surface, not just this design's list.
- **Scaffold turns it on -> existing tests break.** Acceptance requires all
  tests pass. Any test that writes `defaultConfigJsonc()` then performs a
  non-pipeline move (e.g. `backlog -> ready_for_test`, skip-ahead setups) will
  now be refused. The structural allow-set is sized to cover the legitimate ones
  (backlog promote, start-work, archive, resume); genuinely illegal test setups
  must switch to a legal path or pass `--override` / disable enforcement. Audit
  is a required implementation step.
- **Unconditional config load in `moveTicket`.** Minor behavior/perf change;
  confirm no test asserts config is *not* loaded on a plain move. Low risk.
- **Same-status re-save** must not be refused (self-transition not in map) —
  handled by the `from === to` short-circuit.
- **`archived` as a universal sink** is intentionally permissive; acceptable
  since archive is a terminal administrative state and retention depends on it.
- **Override with no reason** is allowed (encouraged not required); the Run Log
  line degrades gracefully. If a reason should be mandatory, that is a one-line
  change — flag as an open question.
- **Advisory mode parity:** with `enforceTransitions:false` behavior is
  byte-identical to today (validator short-circuits), preserving back-compat.

## Test Strategy

- Config: omitted key -> false; explicit true/false honored; scaffold -> true;
  guard-test allowlist now lists exactly five diff paths.
- Refusal: with enforcement on, `ready_for_implementation -> ready_for_test`
  throws, error names allowed targets, and the ticket file is byte-unchanged
  (assert no move, no Run Log line, no stripped evidence — proves zero side
  effects and correct ordering vs invalidation/gate).
- Allowed pipeline move (`ready_for_review -> ready_for_test`) passes unchanged.
- Structural moves each pass under enforcement: `start-work`
  (`ready_for_implementation -> implementing`), `backlog -> ready_for_design`,
  `questions -> ready_for_implementation`, `blocked -> ready_for_test`, supersede
  `ready_for_design -> archived`, retention `done -> archived`
  (`archiveDoneTickets`), same-status re-save.
- `--override`: forces a refused move, appends exactly one `Transition override:
  <from> -> <to>: <reason>` line; no-reason variant omits the suffix; override
  on an already-allowed move writes no override line.
- Ordering interaction: an override/allowed loop-back move (e.g.
  `ready_for_test -> ready_for_implementation`) still runs invalidation; a
  *refused* loop-back strips nothing.
- `set <id> status` inherits refusal (T1327 path); `move` and `set` override
  parity.
- Advisory mode (`enforceTransitions:false`): the same illegal move succeeds,
  confirming back-compat.
- Full existing suite green under the scaffold's `enforceTransitions:true`.

## Documentation Updates

- `docs/Workflow.md` — document the hard validator, the switch, and `--override`.
- `memory-bank/techContext.md` — remove/flip the "Open Decision" bullet
  ("Whether advisory transition guidance should become a hard transition
  validator").
- `memory-bank/systemPatterns.md` — record the map-vs-structural split and the
  override-records-to-Run-Log invariant.
- `SKILL.md` + `skills/codex/local-board/SKILL.md` — the `--override` verb and
  when to use it.
- Hand-off note: flipping `enforceTransitions` on in this repo's own
  `plans/local-board.config.jsonc` is a post-merge orchestrator decision.

## Open Questions

- Should `--reason` be mandatory for `--override` (stronger audit trail) rather
  than encouraged? Design assumes optional-but-encouraged.
- Should `set <id> status` accept `--override` too, or should forced moves be
  restricted to `move` for a single obvious path? Design recommends parity
  (accept on both).

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-08T01:50:00Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): hard validator first in moveTicket behind routing.enforceTransitions (established defaults pattern), --override --reason escape logging in the locked span, structural allow-set for administrative moves (start-work, resumes, any->archived covering retention), map gap for designing added; set status inherits. Estimate 4 (basis T20260707T1331Z).

- 2026-07-08T01:50:53Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (workflow enforcement)
