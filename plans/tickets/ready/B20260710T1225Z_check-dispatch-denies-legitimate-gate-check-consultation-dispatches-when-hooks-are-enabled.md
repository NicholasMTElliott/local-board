---
id: B20260710T1225Z
type: bug
status: ready_for_test
priority: P1
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/B20260710T1225Z-check-dispatch-denies-legitimate-gate-check-consultation-dispatches-when-hooks-are-enabled
estimate: 4
estimateBasis: B20260708T0459Z
workStartedAt: 2026-07-10T13:11:07Z
workCompletedAt: null
created: 2026-07-10T12:25:41Z
updated: 2026-07-10T14:34:13Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", "review:codex-task:read-only@gpt-5.6-terra", "test:claude-subagent:local-board-tester@sonnet", gate:test:skipped-empty-catalog]
routingApprovals: []
---
# check-dispatch denies legitimate gate-check consultation dispatches when hooks are enabled

## Requirement

With enforcement hooks installed (local-board install --hooks), the routing-validator PreToolUse hook denies every legitimate gate-check consultation dispatch. Found live 2026-07-10 on this board, first gated stage after enabling hooks.

## Repro

1. Board with hooks installed and a gated stage (e.g. design) whose action agent is claude-subagent:local-board-designer@opus and gate-check profile claude-subagent:local-board-gatecheck@haiku.
2. Complete the design step (complete-step design ... clears the active-steps ledger entry).
3. Run gate-check <id> --stage design (non-empty catalog; pure read, stamps nothing).
4. Dispatch the gate agent with the documented "Ticket: <id>" first line.
5. routing-validator shells check-dispatch --agent local-board-gatecheck --ticket <id>, which exits 1: {"ok":false,"reason":"agent-mismatch","expected":{"agent":"local-board-designer","model":"opus"}}. Dispatch denied.

## Root cause

checkDispatchForTicket (src/active-steps.js:132-156) has two sources of expectation: the ledger entry, or (fallback) resolveExpectedStep = the ticket's status-configured ACTION agent. There is no representation of a gate-check consultation as a valid dispatch: complete-step has already cleared the ledger by the time gate-check runs (by design — the gate fires between action completion and the move), and the fallback resolves the action route (designer), never the config agents["gate-check"] route. The same structural gap applies to specialty-step dispatches routed to claude-subagent:* (specialty-run is also a pure read that stamps nothing) — the fallback will expect the action agent and deny the specialty agent.

## Expected behavior (design decides the mechanism; constraints below)

- A gate-check dispatch for the configured gate agent must be allowed at the point the documented flow requires it (after action complete-step, ticket still in the stage's ready/active status).
- Same for a configured specialty route once T20260710T1156Z lands specialty profiles.
- The fix must not simply allow any local-board-gatecheck dispatch unconditionally — the point of the hook is to catch misrouted dispatches. Candidate mechanisms: gate-check (and specialty-run) stamp a scoped consultation entry in the ledger that check-dispatch consumes (mirroring begin-step's stamp + gate-complete/complete-step clear), or check-dispatch consults config agents["gate-check"] / the stage's specialty catalog as additional valid expectations when the ticket sits at a gated stage boundary.
- Fail-open semantics of the hook itself are unchanged.

## Acceptance criteria

- With hooks installed, the full documented flow (begin-step -> action dispatch -> complete-step -> gate-check -> gate agent dispatch -> gate-complete -> move) runs with zero hook denials on a correctly-routed board.
- A deliberately misrouted gate dispatch (e.g. dispatching local-board-tester for the gate, or gatecheck for a ticket with no completed action evidence) is still denied.
- check-dispatch unit tests cover: gate dispatch allowed at stage boundary, gate dispatch denied when misrouted, specialty dispatch allowed for a configured specialty route (or explicitly deferred to the T1156Z follow-up if profiles land later).
- npm run check and node --test pass.

## Workaround in use until fixed (recorded for transparency)

Dispatching the gate agent without the "Ticket: <id>" first line — the hook's documented residual (extractTicketId null -> allow, routing-validator.js:64-67). This sacrifices dispatch-ledger verification for gate dispatches only; the consultation itself remains verified server-side by gate-complete evidence. Remove the workaround from the orchestrator flow once this bug is fixed.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Summary

Two structural gaps make `check-dispatch` deny correctly-routed dispatches once
hooks are installed:

1. **No representation of a consultation dispatch.** After `complete-step` clears
   the ledger, `gate-check` and `specialty-run` are pure resolvers that stamp
   nothing. `checkDispatchForTicket` (src/active-steps.js:132) then falls back to
   `resolveExpectedStep`, which always yields the stage's *action* route
   (designer), so the gate/specialty agent is denied with `agent-mismatch`.
2. **Stale-root fallback.** When the fallback path runs, `resolveExpectedStep`
   reads the ticket file under the hook's cwd (the main checkout), not the
   ticket's registered worktree. A worktree-local status advance is invisible, so
   the fallback resolves the wrong action and denies against stale status.

The fix has two coordinated parts: (A) make `gate-check`/`specialty-run` stamp a
scoped consultation entry in the ledger that `check-dispatch` consumes and
`gate-complete`/`complete-step` clear; (B) make the residual fallback resolve the
ticket's true root via the worktrees registry before reading status. Hook
fail-open semantics are untouched.

## Decision 1 — consultation dispatch: stamp the ledger (chosen) vs. config-consult at a stage boundary

**Chosen: stamping**, mirroring `beginStep`'s stamp + `completeStep`'s clear.

Rationale over the config-consult alternative (`check-dispatch` accepting
`agents["gate-check"]` / the stage specialty catalog as extra valid expectations
when the ticket sits at a gated boundary):

- **Precision.** A stamp exists only if a `gate-check`/`specialty-run` actually
  ran, so a gate dispatch with no preceding consultation is still denied — this is
  exactly the acceptance criterion "gatecheck for a ticket with no completed
  action evidence is still denied." Config-consult would allow *any* gate dispatch
  for *any* ticket parked at a stage boundary, weakening misroute detection.
- **Neutralises facet 2 for the gate/specialty path.** The ledger is main-root
  anchored (`ledgerPath` -> `resolveMainRoot`), and `gate-check`/`specialty-run`
  invoked in a worktree already write to the main ledger (same anchoring
  `beginStep` relies on). So when a stamp is present, `checkDispatchForTicket`
  uses the ledger record and never reads ticket status at all — the stale-root
  problem cannot bite the consultation path. Config-consult would have to read
  status and would inherit facet 2.
- **Minimal new surface.** No new "is this a gated boundary?" predicate in the
  read-only checker; reuses the existing stamp/clear/scan machinery unchanged.

`checkDispatch` needs **no change** for this part: it already compares
`bareRoute(record.route)` against the agent and `record.model` against the model.
A gate stamp of `{ route: "claude-subagent:local-board-gatecheck", model: "haiku" }`
makes `check-dispatch --agent local-board-gatecheck --model haiku` match.

### Ledger entry shape

Reuse the existing per-ticket record shape (keyed by `ticketId`), adding a `kind`
discriminator for observability and clear-time clarity. Gate stamp written by
`gate-check` (non-skip branch only):

```json
{
  "ticket": "<id>",
  "kind": "gate",
  "action": "gate-check",
  "stage": "design",
  "route": "claude-subagent:local-board-gatecheck",
  "model": "haiku",
  "root": "<abs invocation root>",
  "ts": "2026-07-10T13:00:00Z"
}
```

Specialty stamp written by `specialty-run`:

```json
{
  "ticket": "<id>",
  "kind": "specialty",
  "action": "<step-name>",
  "stage": "design",
  "route": "claude-subagent:local-board-<agent>",
  "model": "<model-or-null>",
  "root": "<abs invocation root>",
  "ts": "..."
}
```

`kind`/`stage`/`action` are additive; `checkDispatch` ignores them (it reads only
`route`/`model`), so `checkDispatchByScan` and every existing verdict test keep
passing. The `route`/`model` for the gate stamp come from
`config.agents["gate-check"]` (the same `gateProfile` the command already
resolves at src/cli.js:1169); for the specialty stamp from
`resolveOptionalStepAgent(entry.agent)` (already resolved at src/cli.js:1266).

### Single-record invariant (why overwrite is safe)

The ledger holds one record per ticket. A consultation stamp overwrites the
action record — but the two never overlap in time: `complete-step` clears the
action record before `gate-check`/`specialty-run` run (the gate fires between
action completion and the move). So overwriting cannot clobber a live action
dispatch. The invariant to preserve and comment: *at most one dispatch is in
flight per ticket at any time* (the orchestrator is serial per ticket).
Re-stamping is idempotent and self-healing exactly as `beginStep`'s is; a
lingering stamp (consultation resolved but never dispatched/cleared) is
overwritten by the next `begin-step`.

### When to stamp

- `gate-check`: stamp **only on the non-skip branch** (`catalog.length > 0`). The
  empty-catalog branch dispatches no agent (it self-certifies via
  `recordGateSkippedEmptyCatalog`), so there is nothing to validate; stamping
  there would leave a spurious entry. Stamp only when `gateProfile.route`
  starts with `claude-subagent:` (an `inline`/`codex-task:` gate is not dispatched
  through the Task/Agent hook; a stamp is harmless but pointless). Place the stamp
  after `assertInvocationRootForTicket` (already at src/cli.js:1117) so a
  wrong-root invocation is still refused before any write.
- `specialty-run`: stamp when the resolved `route` starts with `claude-subagent:`.
  Inline/codex specialties are not Task-dispatched.

### Clear semantics / ordering

- `gate-complete` clears the ledger entry after recording the consultation
  (add `await clearActiveStep(root, ticketId)` to the `commandGateComplete` /
  `recordGateConsultation` path, mirroring how `completeStep` clears at
  src/tickets.js:1330). Clear *after* the successful record write, best-effort
  (`.catch(() => {})`), same as `completeStep`.
- `complete-step` already clears `steps[ticketId]` and remains the catch-all: if a
  stage is re-entered, the next `begin-step` re-stamps the action record over any
  stale consultation entry.
- Specialty completions are recorded through `gate-complete` at the stage level
  (there is no separate `specialty-complete` verb), so `gate-complete`'s clear
  covers both the gate stamp and any specialty stamp left by the last
  `specialty-run` in that stage. If a dedicated specialty-completion verb is ever
  added, it must also `clearActiveStep`.
- `move` needs no new clear: the ledger is already empty by the documented flow
  (`gate-complete` cleared it), and any residual entry self-heals on the next
  `begin-step`.

## Decision 2 — fallback resolves the ticket's true root (facet 2)

`checkDispatchForTicket`'s no-ledger fallback (src/active-steps.js:141-150) must
resolve the ticket against its **registered worktree** before reading status,
falling back to the invocation root when no worktree is registered. This mirrors
the resolution `assertInvocationRootForTicket` (src/worktrees.js:133) already
performs for the wrong-root guard.

Approach:

- Add an exported resolver in src/worktrees.js, e.g.
  `resolveTicketWorktreeRoot(root, ticketId)`, that: `resolveMainRoot(root)` ->
  `loadConfig(mainRoot).worktrees.location` -> `ticketWorktreePath(mainRoot,
  ticketId, location)` -> `findRegisteredWorktree(mainRoot, expected)`; returns
  the registered worktree path or `null`. Swallow any git/config error and return
  `null` (fail-safe, exactly like the existing guard).
- In `checkDispatchForTicket`, before `resolveExpectedStep`, call the resolver;
  when it returns a non-null path, pass that path to `resolveExpectedStep` instead
  of `root`. On `null` (or resolver error) use `root` unchanged — today's
  behaviour, so single-ticket/solo boards and non-git fixtures are unaffected.
- This keeps the consultation path (Decision 1) as the primary fix; Decision 2
  only hardens the residual fallback (action dispatch with no ledger entry, e.g.
  `begin-step` skipped or an active-status ticket) against stale main-root status.

Fail-open is preserved end to end: any throw inside `checkDispatch` is caught by
`commandCheckDispatch` (src/cli.js:709) and returned as exit 2, which the hook
(hooks/routing-validator.js:110) maps to allow. The resolver must never throw;
worst case it returns `null` and the fallback behaves as today.

Note: to avoid a `src/active-steps.js` -> `src/worktrees.js` import that risks a
cycle, prefer importing the resolver into `active-steps.js` directly (worktrees.js
does not import active-steps.js today, so no cycle), or inject it. Confirm no
cycle at implementation time; if one appears, lift the small resolver into its
own tiny helper module (it needs config + git, so `src/lock.js` is not the right
home).

## Affected files

- `src/active-steps.js` — `checkDispatchForTicket` fallback resolves via worktree
  root before `resolveExpectedStep`. No change to the ledger-record branch or to
  `checkDispatch`/`checkDispatchByScan` verdict logic.
- `src/cli.js` — `commandGateCheck` stamps a gate consultation on the non-skip
  branch; `commandSpecialtyRun` stamps a specialty consultation for
  claude-subagent routes; `commandGateComplete` clears the ledger after recording.
- `src/worktrees.js` — export `resolveTicketWorktreeRoot(root, ticketId)` (or
  equivalent), reusing `findRegisteredWorktree`/`ticketWorktreePath`.
- Possibly `src/tickets.js` — if the clear is wired inside `recordGateConsultation`
  rather than the command wrapper (mirror `completeStep`'s in-function clear).
- Tests: `test/active-steps.test.js` (new cases), and hook-level coverage in
  `test/hooks.test.js` if end-to-end deny/allow parity is asserted there.
- Docs: `docs/specialty-steps.md` and any gate/hook doc that states gate-check
  "stamps nothing" must be updated to note the scoped consultation stamp (see
  Documentation Updates).

## Risks / edge cases

- **Overwriting the action record.** Safe only under the single-in-flight-dispatch
  invariant; a `gate-check` run *before* `complete-step` would clobber a live
  action stamp. The documented flow forbids this, and `gate-check` at an
  action-in-progress status is already out of sequence. Add a test asserting the
  gate stamp is written only after the action ledger entry is cleared, and rely on
  idempotent self-heal for the pathological case.
- **Lingering stamp.** Consultation resolved but agent never dispatched and
  `gate-complete` never run: entry lingers until the next `begin-step` overwrites
  it or `complete-step` clears it. Matches today's begin-step lingering behaviour;
  acceptable.
- **codex/inline gate or specialty.** Not Task-dispatched, so no hook and no
  need to stamp; stamping guard is `route.startsWith("claude-subagent:")`.
- **Import cycle** between `active-steps.js` and `worktrees.js` — verify at
  implementation; mitigation noted above.
- **Non-git / solo boards.** Worktree resolver returns `null`, fallback unchanged;
  existing `withBoard` (non-git) tests must stay green.
- **Fail-open regression.** The most important invariant. A corrupt ledger, a
  git failure in the resolver, or a thrown error must still yield exit 2 -> allow,
  never a spurious deny. Covered by an explicit test.

## Test plan (test/active-steps.test.js, CLI round-trip via runCli/withRepo)

1. **Gate dispatch allowed at the stage boundary.** With a non-empty design
   catalog: `begin-step design` -> `complete-step design` (clears action stamp) ->
   `gate-check <id> --stage design` -> `check-dispatch --agent
   local-board-gatecheck --model haiku --ticket <id>` returns
   `{ ok: true, reason: "match", expected: { agent: "local-board-gatecheck",
   model: "haiku" } }` (exit 0). Repeat for the `implement` and `test` stage
   boundaries to cover each gated stage.
2. **Misrouted gate dispatch denied.** After the same `gate-check`, dispatching a
   different agent (`--agent local-board-tester`) denies with `agent-mismatch`
   (exit 1). And: `gate-check` never run (no consultation stamp) -> gate dispatch
   falls back to the action route and denies (exit 1) — proves the stamp, not the
   agent name, is what authorises.
3. **Specialty dispatch with a profile allowed.** Config an `optionalSteps.design`
   entry with `agent: { route: "claude-subagent:local-board-<x>", model: "<m>" }`;
   run `specialty-run <id> <step>`; `check-dispatch --agent local-board-<x>
   --model <m>` returns match (exit 0). Include a `--model`-omitted variant
   asserting `model-unverifiable`.
4. **Stale-main-root fallback resolved via worktree.** `withRepo` +
   `addTicketWorktree`; advance status in the worktree so the worktree ticket file
   differs from the main checkout; no ledger entry; `check-dispatch` invoked from
   the **main** root resolves the expected route from the worktree's current
   status and allows the correctly-routed dispatch. A control assertion (no
   worktree registered) shows the fallback still uses the invocation root.
5. **Fail-open preserved.** (a) Corrupt ledger -> exit 2, JSON verdict on stdout
   (existing test stays green). (b) `gate-complete` clears the entry: after
   `gate-complete`, `check-dispatch` for the gate agent falls back and denies
   (proves the clear fired). (c) Resolver error path returns `null` and the
   fallback behaves as today (no throw, no spurious deny).
6. **Ledger clear ordering.** Assert `gate-check` stamps, `gate-complete` clears;
   and `complete-step` still clears the action entry (existing round-trip test
   unchanged).

`npm run check` and `node --test` must pass.

## Open questions

None blocking. One implementation note to confirm during coding: whether to house
the clear inside `recordGateConsultation` (mirrors `completeStep`) or in the
`commandGateComplete` wrapper — either is acceptable; prefer the in-function clear
for symmetry with `completeStep`.

## Implementation Notes

Implemented per Technical Design, both decisions:

**Decision 1 (consultation stamping):**
- `src/cli.js` `commandGateCheck`: on the non-skip branch (`catalog.length > 0`), stamps `{ ticket, kind: "gate", action: "gate-check", stage, route, model, root, ts }` into the active-steps ledger via `stampActiveStep`, gated on `gateProfile.route.startsWith("claude-subagent:")`. Moved `gateProfile` resolution earlier in the function (was previously computed only for the payload) so it's available before the skip/non-skip branch.
- `src/cli.js` `commandSpecialtyRun`: after resolving `{ route: agent, model }` via `resolveOptionalStepAgent`, stamps `{ ticket, kind: "specialty", action: entry.name, stage, route, model, root, ts }`, gated on `agent.startsWith("claude-subagent:")`.
- `src/tickets.js` `recordGateConsultation`: added `await clearActiveStep(root, ticketId).catch(() => {})` after the token/Run Log write, mirroring `completeStep`'s clear. This is the single clear point for both a gate-check stamp and any lingering specialty-run stamp (no separate specialty-completion verb exists).
- No change needed to `checkDispatch`/`checkDispatchForTicket`'s ledger-record branch: it already compares `bareRoute(record.route)`/`record.model` generically, so a `kind: "gate"`/`"specialty"` record is consumed identically to an action record.

**Decision 2 (stale-root fallback):**
- `src/worktrees.js`: added exported `resolveTicketWorktreeRoot(root, ticketId)` — resolves `resolveMainRoot` -> `loadConfig` -> `ticketWorktreePath` -> `findRegisteredWorktree`; returns the registered worktree path or `null`; swallows all errors (fail-safe).
- `src/active-steps.js` `checkDispatchForTicket`: in the no-ledger-record branch, calls `resolveTicketWorktreeRoot(root, ticketId)` before `resolveExpectedStep`; uses the resolved worktree root when non-null, else `root` unchanged.

**Import-cycle check:** `active-steps.js` now imports `worktrees.js`, which imports `tickets.js`, which already imports `active-steps.js` (pre-existing cycle). Verified at implementation time by `node -e "import('./src/active-steps.js')"`, `import('./src/cli.js')`, `import('./src/tickets.js')`, `import('./src/worktrees.js')` — all load cleanly, no `ReferenceError`/TDZ issue. No structural change needed; the existing cycle already tolerates this extension since all cross-references are used inside function bodies, not at module-eval time.

**Docs:** `docs/specialty-steps.md` line reworded — "gate-check mutates only for the empty-catalog...path" was inaccurate once the non-skip branch also stamps the ledger; clarified the distinction between ticket evidence (`completedSteps`, unchanged) and the internal active-steps dispatch ledger (new stamp/clear). `test/cli.test.js`'s "does not stamp a gate token on a non-empty catalog (pure read)" test renamed and extended to assert the ledger IS stamped (kind/action/stage/route/model) while ticket evidence remains untouched — the two concepts (ticket evidence vs. dispatch ledger) were conflated in the old title.

**Tests added** (`test/active-steps.test.js`): stage-boundary allow for design/implement/test (test-stage catalog seeded non-empty via config override for this test only), misrouted-and-unstamped-denies, gate-complete-clears-then-denies, specialty-run stamp + model-unverifiable variant, stale-main-root fallback via a registered worktree (with a no-worktree control). `test/cli.test.js`: extended two existing gate-check tests with ledger assertions (stamped on non-empty branch, not stamped on empty-catalog branch).

**Deviation/pre-existing issue noted, not fixed (out of scope):** `npm test` full run shows a 3rd failure beyond the 2 documented install.test.js baseline failures (B20260710T1232Z): `test/cli.test.js` "estimation prompts are present and reference the estimate pipeline" — `plans/prompts/steps/estimate.md` contains `local-board --root <worktreePath> calibration suggest` (the ticket's `--root` mandate) but the test asserts the literal contiguous substring `"local-board calibration suggest"`. Untouched by this ticket's file set; unrelated to gate/specialty dispatch. Confirmed via `git log` that both the prompt and its wording predate this ticket.

### Review-fix pass 3 (third review residual)

Scope: exactly the single residual from the third review, plus the deferred edge-case decision.

**Residual fix — `recordGateConsultation`'s clear predicate was kind-agnostic:**
`src/tickets.js`'s `isConsultationLedgerEntry(record, stage)` matched `kind === "gate" || kind === "specialty"` as long as `stage` matched, so a stale/retried `gate-complete --stage design` could erase a live `specialty-run` stamp for a still-unconsulted design-stage specialty. Replaced it with `isGateLedgerEntry(record, stage)` (`kind === "gate" && stage` match only) and pointed `recordGateConsultation`'s clear at the new predicate. `recordGateConsultation` now clears only its own gate stamp, never a specialty entry. Specialty stamps are left to `moveTicket`'s broad abandonment sweep (`isAnyConsultationLedgerEntry`, kind-only, unchanged) or self-heal on the next `begin-step`/`specialty-run` overwrite. `isAnyConsultationLedgerEntry` (used only by `moveTicket`) and `isActionLedgerEntry` (used by `completeStep`/`approveInline`) are unchanged.

**Edge-case decision (reviewer-flagged, resolved as instructed):** same-status re-saves previously triggered `moveTicket`'s broad consultation sweep even though a re-save abandons nothing. Implemented the preferred resolution: `moveTicket` now skips the abandonment sweep when `ticket.status === status` (the move target equals the ticket's current status). A real status change (including a loop-back or a move into questions/blocked) still sweeps unconditionally, matching existing behaviour.

**Tests added** (`test/active-steps.test.js`):
- `gate-complete --stage design does NOT clear a live specialty consultation stamp for a design-stage specialty (third review residual); the specialty dispatch still passes check-dispatch` — regression for the residual: stamps a design-stage specialty via `specialty-run`, then calls `gate-complete --stage design` (no prior gate-check), asserts the specialty stamp survives byte-identical and the specialty agent still passes `check-dispatch`.
- `a same-status move (re-save) does NOT sweep a live consultation stamp; only a real status change abandons it` — stamps a gate consultation, re-saves the ticket at its current status via `move <id> <same-status>`, asserts the stamp survives; then moves to a different status as a control and asserts the existing sweep-on-real-move behaviour is unchanged.

Both new tests pass (43/43 in `test/active-steps.test.js`, up from 41).

`npm run check` clean. `npm test`: 493 pass, 3 fail (2 tracked `install.test.js` PATH tests + the pre-existing `estimate-prompt` assertion, both documented in earlier passes and unchanged by this pass), 1 skipped (pre-existing smoke test) — matches the declared branch baseline exactly. `node ./bin/local-board.js validate --root <worktree>` passes.

## Review-fix pass (commit cbf3527, following changes_requested)

Addressed all three accepted review findings without revisiting the original design:

**Finding 1 (High) — no-clobber stamping:** `src/active-steps.js` gained `stampActiveStepNoClobber(root, ticketId, record, options)`: under the ledger lock, stamps only when the ticket's slot is empty or the existing entry is an idempotent match (same `kind`+`route`+`model`) for `record`; otherwise leaves the existing entry untouched and returns `{ stamped: false, conflict: existingRecord }`. `src/cli.js`'s `commandGateCheck`/`commandSpecialtyRun` now call this instead of the unconditional `stampActiveStep`, and print a non-fatal `console.warn` (via the new `describeLedgerStampConflict` helper) naming the ticket and the live entry when a conflict is reported — the command itself still succeeds and returns its normal payload. `begin-step`'s own stamp is intentionally left unconditional (unchanged): the design's self-heal invariant ("a lingering consultation stamp is overwritten by the next begin-step") still needs an unconditional writer somewhere, and it's begin-step's job, not gate-check/specialty-run's.

**Finding 2 (High) — stamp identity + abandonment cleanup:** Ledger records now carry a `kind` discriminator (`"action"` for `beginStep`'s stamp, `"gate"`/`"specialty"` for the consultation stamps — already present for the latter two, added to `beginStep`'s record in `src/tickets.js`). `src/active-steps.js` gained `clearActiveStepIf(root, ticketId, predicate, options)`: reads the current entry and deletes it only if `predicate(existing)` is true, evaluated inside the SAME lock as the delete (atomic — no read-then-write race window). `completeStep`/`approveInline` (`src/tickets.js`) now clear via `clearActiveStepIf(..., isActionLedgerEntry)` (kind is `"action"` or absent, for backward compatibility with pre-fix ledger data); `recordGateConsultation` clears via `clearActiveStepIf(..., isConsultationLedgerEntry)` (kind is `"gate"` or `"specialty"`). None of the three can now erase a newer entry of a different kind stamped in the gap between their own ticket write and their clear call. Abandonment cleanup: `moveTicket` (`src/tickets.js`) now clears any lingering consultation-kind entry for the ticket on every successful move (best-effort, after the write succeeds), so a gate-check run without a following gate-complete (ticket moved to questions/blocked/a loop-back instead) no longer lingers to wrongly authorize a later gate/specialty dispatch for a different stage. Action-kind entries are untouched by `moveTicket` — a move is not evidence an in-flight action dispatch was abandoned.

**Finding 3 (Medium) — prunable-worktree fallback:** `src/worktrees.js`'s `resolveTicketWorktreeRoot` now verifies the registered worktree's directory actually exists (`pathExists`) before returning it; `git worktree list --porcelain` keeps reporting a manually-removed-but-unpruned worktree, and handing that stale path back made `resolveExpectedStep` throw (ticket file not found), which `checkDispatchForTicket` turned into exit 2 (`ticket-not-found`) — the hook fail-opens for every agent instead of validating against the main checkout. On a missing directory the resolver now returns `null`, and `checkDispatchForTicket`'s existing `resolveRoot = worktreeRoot ?? root` fallback takes over unchanged, resolving against the invocation root.

**Tests added** (`test/active-steps.test.js`, all passing): a registered-but-missing-worktree-directory case (finding 3); gate-check-vs-live-action-stamp and specialty-run-vs-live-specialty-stamp no-clobber cases with warning assertions (finding 1); complete-step-preserves-a-newer-gate-stamp and abandoned-gate-stamp-cleared-by-move cases (finding 2); direct unit coverage for `clearActiveStepIf` and `stampActiveStepNoClobber`. `test/cli.test.js` and `test/tickets.test.js` updated for the new `kind: "action"` field on `beginStep`'s ledger record (two pre-existing deep-equality assertions enumerated the record's exact key set / full shape).

`npm run check` clean. `npm test`: 488/492 pass; the 4 non-passing are the 2 tracked `install.test.js` PATH tests, 1 skipped smoke test (pre-existing, unrelated), and the pre-existing `estimate-prompt` assertion documented above (confirmed still present, unrelated to this ticket's files). `node ./bin/local-board.js validate` passes.

## Review-fix pass 2 (commit 02e3dac, following re-review changes_requested)

Re-review found the review-fix pass 1 identity semantics incomplete: (a) `stampActiveStepNoClobber`'s idempotent match compared only `kind`/`route`/`model`, so two specialties sharing a route/model, or two gate stamps for different stages, were wrongly treated as idempotent (silently overwritten) instead of conflicts; (b) `completeStep`/`approveInline`/`recordGateConsultation`'s clears compared only `kind`, so a stale/retried completion could erase a NEWER record of the same kind for a different action/stage.

**Fix (a):** `src/active-steps.js`'s `isIdempotentStampMatch` now also compares `action` and `stage` (in addition to `kind`/`route`/`model`) — a full-identity match is required before a re-stamp is treated as a harmless self-heal.

**Fix (b):** `src/tickets.js`'s `isActionLedgerEntry(record, action)` now also requires `record.action === action`; `isConsultationLedgerEntry(record, stage)` now also requires `record.stage === stage`. `completeStep`, `approveInline`, and `recordGateConsultation` now pass their own `action`/`stage` into the predicate via a closure at each `clearActiveStepIf` call site, so each clears ONLY the entry it created — never a same-kind entry for a different action/stage created in the gap between its own ticket write and its ledger clear. `moveTicket`'s abandonment-cleanup clear is deliberately left broad (`isAnyConsultationLedgerEntry`, kind-only): unlike the three call sites above, it is not clearing "its own" stamp — it's a catch-all sweep for any lingering consultation stamp when a ticket moves away without ever reaching gate-complete, and there is no single "the stage this move is leaving" for a non-forward move (e.g. into questions/blocked).

**Tests added** (`test/active-steps.test.js`): two identity-completeness collision tests — `gate-check` for a different stage with the SAME gate profile is now a conflict, not an idempotent match; `specialty-run` for a different specialty with the SAME route/model is now a conflict, not an idempotent match (both assert the live entry survives and a non-fatal warning is printed). One same-kind newer-stamp-preserved test — a stale `gate-complete` for an earlier stage does not clear a NEWER gate stamp already landed for a different stage (simulates the race by directly overwriting the ledger, same pattern as the existing `completeStep`-preserves-a-newer-gate-stamp test).

`npm run check` clean. `npm test`: 491 pass, 3 fail (2 tracked `install.test.js` PATH tests + the pre-existing `estimate-prompt` assertion, both documented above and unchanged by this pass), 1 skipped (pre-existing smoke test) — matches the declared branch baseline exactly. `node ./bin/local-board.js validate --root <worktree>` passes.

## Review-fix pass (commit cbf3527, following changes_requested)

Addressed all three accepted review findings without revisiting the original design:

**Finding 1 (High) — no-clobber stamping:** `src/active-steps.js` gained `stampActiveStepNoClobber(root, ticketId, record, options)`: under the ledger lock, stamps only when the ticket's slot is empty or the existing entry is an idempotent match (same `kind`+`route`+`model`) for `record`; otherwise leaves the existing entry untouched and returns `{ stamped: false, conflict: existingRecord }`. `src/cli.js`'s `commandGateCheck`/`commandSpecialtyRun` now call this instead of the unconditional `stampActiveStep`, and print a non-fatal `console.warn` (via the new `describeLedgerStampConflict` helper) naming the ticket and the live entry when a conflict is reported — the command itself still succeeds and returns its normal payload. `begin-step`'s own stamp is intentionally left unconditional (unchanged): the design's self-heal invariant ("a lingering consultation stamp is overwritten by the next begin-step") still needs an unconditional writer somewhere, and it's begin-step's job, not gate-check/specialty-run's.

**Finding 2 (High) — stamp identity + abandonment cleanup:** Ledger records now carry a `kind` discriminator (`"action"` for `beginStep`'s stamp, `"gate"`/`"specialty"` for the consultation stamps — already present for the latter two, added to `beginStep`'s record in `src/tickets.js`). `src/active-steps.js` gained `clearActiveStepIf(root, ticketId, predicate, options)`: reads the current entry and deletes it only if `predicate(existing)` is true, evaluated inside the SAME lock as the delete (atomic — no read-then-write race window). `completeStep`/`approveInline` (`src/tickets.js`) now clear via `clearActiveStepIf(..., isActionLedgerEntry)` (kind is `"action"` or absent, for backward compatibility with pre-fix ledger data); `recordGateConsultation` clears via `clearActiveStepIf(..., isConsultationLedgerEntry)` (kind is `"gate"` or `"specialty"`). None of the three can now erase a newer entry of a different kind stamped in the gap between their own ticket write and their clear call. Abandonment cleanup: `moveTicket` (`src/tickets.js`) now clears any lingering consultation-kind entry for the ticket on every successful move (best-effort, after the write succeeds), so a gate-check run without a following gate-complete (ticket moved to questions/blocked/a loop-back instead) no longer lingers to wrongly authorize a later gate/specialty dispatch for a different stage. Action-kind entries are untouched by `moveTicket` — a move is not evidence an in-flight action dispatch was abandoned.

**Finding 3 (Medium) — prunable-worktree fallback:** `src/worktrees.js`'s `resolveTicketWorktreeRoot` now verifies the registered worktree's directory actually exists (`pathExists`) before returning it; `git worktree list --porcelain` keeps reporting a manually-removed-but-unpruned worktree, and handing that stale path back made `resolveExpectedStep` throw (ticket file not found), which `checkDispatchForTicket` turned into exit 2 (`ticket-not-found`) — the hook fail-opens for every agent instead of validating against the main checkout. On a missing directory the resolver now returns `null`, and `checkDispatchForTicket`'s existing `resolveRoot = worktreeRoot ?? root` fallback takes over unchanged, resolving against the invocation root.

**Tests added** (`test/active-steps.test.js`, all passing): a registered-but-missing-worktree-directory case (finding 3); gate-check-vs-live-action-stamp and specialty-run-vs-live-specialty-stamp no-clobber cases with warning assertions (finding 1); complete-step-preserves-a-newer-gate-stamp and abandoned-gate-stamp-cleared-by-move cases (finding 2); direct unit coverage for `clearActiveStepIf` and `stampActiveStepNoClobber`. `test/cli.test.js` and `test/tickets.test.js` updated for the new `kind: "action"` field on `beginStep`'s ledger record (two pre-existing deep-equality assertions enumerated the record's exact key set / full shape).

`npm run check` clean. `npm test`: 488/492 pass; the 4 non-passing are the 2 tracked `install.test.js` PATH tests, 1 skipped smoke test (pre-existing, unrelated), and the pre-existing `estimate-prompt` assertion documented above (confirmed still present, unrelated to this ticket's files). `node ./bin/local-board.js validate` passes.

## Review Findings

verdict: changes_requested; target: implementation

(codex-task:read-only, gpt-5.6-terra @ reasoning-effort high, 236s — reviewed commit 8fd5831. First attempt aborted by a model-capacity error and was retried.)

1. High — src/cli.js:1155, :1296: consultation stamps unconditionally replace the ticket's single ledger record. Valid sequence: begin-step stamps the designer; a non-empty gate-check overwrites it; the still-legitimate designer dispatch is now denied. specialty-run can likewise replace another in-flight specialty. Fix: stamp only when the entry is empty or an idempotent match; reject/clear conflicting live work explicitly rather than replacing it.

2. High — src/tickets.js:660, :1402, src/active-steps.js:139: no abandonment cleanup and no identity on stamps. An abandoned gate stamp (gate-check run, dispatch never made, ticket moved through questions/blocked onward) persists and later authorizes a gatecheck dispatch for a different stage; the unconditional clears in completeStep/approveInline/recordGateConsultation can erase a NEWER stamp created between ticket write and ledger clear. Fix: stamp identity/generation + conditional clear-by-identity; clear abandoned consultation stamps on status changes/loop-backs while preserving newer entries.

3. Medium — src/worktrees.js:183: a manually removed but unpruned worktree still appears in git worktree list --porcelain; findRegisteredWorktree returns the missing path, resolveExpectedStep reports ticket-not-found (exit 2), and the hook fail-opens for every local-board agent instead of validating against the main checkout. Fix: verify the directory exists before returning it, or retry resolution against the invocation root on failure.

Reviewer-verified clean: ESM cycle load-safe (deferred-function references only; both entry points import successfully); wrong-agent-with-live-stamp still denied; no-stamp fallback intact; tests cover happy-path stamps, wrong-agent denial, gate-complete cleanup, specialty authorization, normal worktree fallback. Coverage gaps named for each finding.

Disposition: all three findings accepted; fixed in cbf3527; re-reviewed.

Fourth review (terra@medium, 30s, of 3a5e716): verdict: pass. Gate-only clear predicate verified with the specialty-survives-gate-complete regression (check-dispatch still authorizes afterwards); same-status re-save preserves stamps while a real move sweeps (control test); scope confined to the two changes. Review loop closed after four passes: 3 findings -> 2 -> 1 -> 0.

Third review (terra@medium, 55s, of identity pass 02e3dac): verdict: changes_requested — ONE residual: recordGateConsultation clears any gate OR specialty record with the same stage (no kind/action identity), so a stale gate-complete --stage design can erase a newer specialty stamp in design. Verified fixed: full idempotent-match identity with both collision tests (would fail pre-fix); action-identity clears with the stale-different-stage test; scope clean. Judgment recorded: moveTicket's broad consultation cleanup is CORRECT for real moves (a move abandons the pending dispatch); same-status re-saves clearing stamps is a minor edge to decide in the fix.

Second re-review (terra@medium, 42s, of cbf3527): verdict: changes_requested — identity semantics incomplete. (a) stampActiveStepNoClobber's idempotent match compares only kind/route/model, ignoring action and stage: two specialties sharing a route/model, or gates for different stages, wrongly overwrite each other. (b) Same-kind clears remain too broad: a stale completion can erase a NEWER record of the same kind; predicates must compare the full stamped identity (action/stage/route/model or a unique id) under the lock. Verified fixed: worktree existence check + fallback (with test); lock discipline of the new primitives; scope. Second fix pass dispatched for (a) and (b).

## Test Evidence

verdict: pass

Environment: Windows 11, node v24.14.0. Tester: claude-subagent:local-board-tester (sonnet). Tree clean pre/post; no external AI CLI invoked.

Commands and results:

- npm run check — pass.
- npm test — 493/497 at the exact declared branch baseline (estimate-prompt assertion + 2 PATH tests, all three already fixed on mainline post-branch), 1 skip.
- test/active-steps.test.js isolated — 43/43, including both newest regressions.
- validate — Ticket validation OK.
- LIVE ACCEPTANCE (fresh temp board, git-init + local-board init, cleaned up): begin-step stamped the designer; complete-step cleared it; gate-check --stage design (non-empty catalog) stamped {kind:gate, route:claude-subagent:local-board-gatecheck, model:haiku, stage:design}; check-dispatch --agent local-board-gatecheck --model haiku returned ok:true reason:match exit 0; check-dispatch --agent local-board-tester returned ok:false agent-mismatch exit 1. The documented flow passes hook validation end to end and misroutes are still denied — the P1's acceptance criterion, proven live.
- Facet 2 (stale-main-root fallback via registered worktree): covered by the named unit test + no-worktree control (isolated run green); live second-worktree probe out of scope per constraints.

Acceptance criteria: all five PASS (zero-denial documented flow; misroute denied; no-stamp denied; specialty-route allowed; check/suite at baseline).

Anomalies: the real globally-installed evidence-gate hook fired during the probe and correctly denied a manual complete-step lacking a Task-dispatch ledger entry — expected enforcement, worked around with approve-inline for the unrelated setup step. Not a bug.

## Documentation Updates

## Questions

## Run Log

- 2026-07-10T12:42:29Z: Second facet observed: when no ledger entry exists, checkDispatchForTicket resolves expected route from the ticket file under the HOOK'S cwd (main checkout), not the ticket's registered worktree - so a worktree-local status advance (ready_for_design -> ready_for_implementation) is invisible and the fallback denies a correctly-routed dispatch against stale status. Fix should resolve the ticket via its registered worktree root (worktrees registry) or treat main-root staleness as unverifiable (fail open).

- 2026-07-10T13:11:07Z: Ensured git branch local-board/B20260710T1225Z-check-dispatch-denies-legitimate-gate-check-consultation-dispatches-when-hooks-are-enabled (already-current).

- 2026-07-10T13:18:46Z: Completed design via claude-subagent:local-board-designer@opus: Technical Design: consultation stamping (gate-check non-skip + specialty-run stamp scoped ledger entries with kind/route/model; check-dispatch consumes; gate-complete/complete-step clear; single-record invariant), worktree-aware fallback via new resolveTicketWorktreeRoot, fail-open preserved, 5-case test plan, import-cycle caveat flagged. Estimate 4 (basis B20260708T0459Z, designer-recorded).

- 2026-07-10T13:19:54Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: none - internal ledger coordination that tightens enforcement; no auth/UI/UX surface

- 2026-07-10T13:19:55Z: Ensured git branch local-board/B20260710T1225Z-check-dispatch-denies-legitimate-gate-check-consultation-dispatches-when-hooks-are-enabled (already-current).

- 2026-07-10T13:34:14Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Commit 8fd5831: gate/specialty consultation stamping (claude-subagent routes), recordGateConsultation clears entries, worktree-aware check-dispatch fallback via new resolveTicketWorktreeRoot, docs correction, 5-case test plan + 2 extended CLI tests (31/31 active-steps). 481 pass + branch baseline (3rd = estimate-prompt assertion fixed on mainline post-branch). Import cycle verified safe.

- 2026-07-10T13:36:20Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: none - dispatch-coordination machinery; adds valid expectations without changing authorization rules

- 2026-07-10T13:44:38Z: Invalidated downstream evidence on loop-back to ready_for_implementation: removed completedSteps [implement:claude-subagent:local-board-implementer@sonnet, gate:implement:claude-subagent:local-board-gatecheck@haiku].

- 2026-07-10T13:44:38Z: Ensured git branch local-board/B20260710T1225Z-check-dispatch-denies-legitimate-gate-check-consultation-dispatches-when-hooks-are-enabled (already-current).

- 2026-07-10T13:57:44Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Original 8fd5831 + review-fix cbf3527: clearActiveStepIf + stampActiveStepNoClobber, kind:action stamps in beginStep, kind-conditional clears in completeStep/approveInline/recordGateConsultation, moveTicket clears abandoned consultation stamps, worktree directory-existence check. Suite green vs branch baseline; check + validate pass.

- 2026-07-10T13:58:46Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: none - ledger lifecycle tightening; no auth/UI surface

- 2026-07-10T14:00:01Z: Invalidated downstream evidence on loop-back to ready_for_implementation: removed completedSteps [implement:claude-subagent:local-board-implementer@sonnet, gate:implement:claude-subagent:local-board-gatecheck@haiku].

- 2026-07-10T14:00:02Z: Ensured git branch local-board/B20260710T1225Z-check-dispatch-denies-legitimate-gate-check-consultation-dispatches-when-hooks-are-enabled (already-current).

- 2026-07-10T14:10:07Z: Completed implement via claude-subagent:local-board-implementer@sonnet: 8fd5831 + cbf3527 + identity pass 02e3dac: isIdempotentStampMatch compares action+stage+kind+route+model; clears take identity args (action/stage) so stale completions cannot erase newer stamps; moveTicket abandonment sweep intentionally kind-only; 3 collision tests. 41/41 ledger tests; suite at declared branch baseline.

- 2026-07-10T14:10:49Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: none - ledger identity semantics completion

- 2026-07-10T14:15:46Z: Invalidated downstream evidence on loop-back to ready_for_implementation: removed completedSteps [implement:claude-subagent:local-board-implementer@sonnet, gate:implement:claude-subagent:local-board-gatecheck@haiku].

- 2026-07-10T14:15:46Z: Ensured git branch local-board/B20260710T1225Z-check-dispatch-denies-legitimate-gate-check-consultation-dispatches-when-hooks-are-enabled (already-current).

- 2026-07-10T14:24:20Z: Completed implement via claude-subagent:local-board-implementer@sonnet: 8fd5831 + cbf3527 + 02e3dac + final pass 3a5e716: recordGateConsultation clears via gate-only predicate; moveTicket skips abandonment sweep on same-status re-save (real changes still sweep); 2 regressions. 43/43 ledger tests; suite at declared branch baseline.

- 2026-07-10T14:25:24Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: none - ledger lifecycle mechanics

- 2026-07-10T14:26:37Z: Completed review via codex-task:read-only@gpt-5.6-terra: Four-pass review loop closed (3 -> 2 -> 1 -> 0 findings): stamping lifecycle, identity semantics, gate-only clears, re-save exemption all verified. verdict: pass.

- 2026-07-10T14:26:37Z: Ensured git branch local-board/B20260710T1225Z-check-dispatch-denies-legitimate-gate-check-consultation-dispatches-when-hooks-are-enabled (already-current).

- 2026-07-10T14:34:13Z: Completed test via claude-subagent:local-board-tester@sonnet: verdict: pass. Live temp-board acceptance: documented flow ok:true/exit 0, misroute denied exit 1; 43/43 ledger tests; suite at declared branch baseline; evidence-gate hook observed enforcing correctly mid-test.
