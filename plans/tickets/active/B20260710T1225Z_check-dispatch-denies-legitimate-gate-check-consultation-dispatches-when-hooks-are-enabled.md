---
id: B20260710T1225Z
type: bug
status: implementing
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
updated: 2026-07-10T13:32:44Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
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

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-10T12:42:29Z: Second facet observed: when no ledger entry exists, checkDispatchForTicket resolves expected route from the ticket file under the HOOK'S cwd (main checkout), not the ticket's registered worktree - so a worktree-local status advance (ready_for_design -> ready_for_implementation) is invisible and the fallback denies a correctly-routed dispatch against stale status. Fix should resolve the ticket via its registered worktree root (worktrees registry) or treat main-root staleness as unverifiable (fail open).

- 2026-07-10T13:11:07Z: Ensured git branch local-board/B20260710T1225Z-check-dispatch-denies-legitimate-gate-check-consultation-dispatches-when-hooks-are-enabled (already-current).

- 2026-07-10T13:18:46Z: Completed design via claude-subagent:local-board-designer@opus: Technical Design: consultation stamping (gate-check non-skip + specialty-run stamp scoped ledger entries with kind/route/model; check-dispatch consumes; gate-complete/complete-step clear; single-record invariant), worktree-aware fallback via new resolveTicketWorktreeRoot, fail-open preserved, 5-case test plan, import-cycle caveat flagged. Estimate 4 (basis B20260708T0459Z, designer-recorded).

- 2026-07-10T13:19:54Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: none - internal ledger coordination that tightens enforcement; no auth/UI/UX surface

- 2026-07-10T13:19:55Z: Ensured git branch local-board/B20260710T1225Z-check-dispatch-denies-legitimate-gate-check-consultation-dispatches-when-hooks-are-enabled (already-current).
