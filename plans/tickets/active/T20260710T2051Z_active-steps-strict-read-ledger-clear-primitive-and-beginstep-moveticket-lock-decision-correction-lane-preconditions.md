---
id: T20260710T2051Z
type: task
status: implementing
priority: P4
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260710T2051Z-active-steps-strict-read-ledger-clear-primitive-and-beginstep-moveticket-lock-decision-correction-lane-preconditions
estimate: 4
estimateBasis: T20260710T1532Z
workStartedAt: 2026-07-11T20:57:06Z
workCompletedAt: null
created: 2026-07-10T20:50:03Z
updated: 2026-07-11T21:01:06Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "design-review:codex-task:read-only@gpt-5.6-sol", "implement:claude-subagent:local-board-implementer@sonnet"]
routingApprovals: []
---
# active-steps: strict-read ledger clear primitive and beginStep/moveTicket lock decision (correction-lane preconditions)

## Requirement

Recorded precondition from T20260710T1535Z (2026-07-10), whose authoring-correction lane was rejected after three design-review rounds each found a ledger-atomicity edge: (1) a stale kind:action record keeps the old stage's agent authorized after a lateral correction; (2) clearing after publish is non-atomic; (3) clearActiveStepIf reads through readLedgerSelfHeal, which converts corrupt or transiently unreadable ledgers to {} and silently no-ops instead of failing - so a fail-closed clear cannot be built on it. This ticket builds the primitives; it does NOT revive the lane.

### Scope

1. Add a strict-read variant of the active-steps ledger read (throws on unreadable/corrupt instead of self-healing to {}), and a clearActiveStepStrict(root, ticketId, predicate) built on it: genuinely-missing entry is a no-op success; read/parse/IO failure throws.
2. Evaluate (design decides) sharing the ticket lock between beginStep and moveTicket so status transitions and dispatch stamps serialize; if adopted, specify lock ordering to avoid deadlock with the ledger file lock; if rejected, document why (the current advisory/fail-open hook rationale) in systemPatterns.
3. Tests: strict clear on a healthy ledger (clears), on a missing entry (no-op success), on a corrupt ledger (throws, ledger untouched); self-healing read path unchanged for all existing callers (legacy-shape assertions).
4. Docs: memory-bank/systemPatterns.md ledger-semantics note.

### Acceptance criteria

- clearActiveStepStrict exists with the throw/no-op contract above; all existing callers keep self-healing semantics byte-identically.
- The beginStep/moveTicket lock decision is recorded with rationale either way.
- npm run check and node --test pass.

### Non-goals

- Does not implement the authoring-correction lane (a future ticket may, using these primitives).

## Acceptance Criteria

## Related Tickets

## Technical Design

### Summary

Two additive primitives in `src/active-steps.js`, no behavior change for any existing caller:

1. A fail-closed clear, `clearActiveStepStrict(root, ticketId, predicate, options)`, built on the module-private strict read `readLedgerStrict` (which already exists) instead of the swallowing `readLedgerSelfHeal`. Genuinely-missing entry (and a genuinely-missing ledger file) = no-op success; a corrupt or otherwise unreadable ledger throws, leaving the ledger bytes untouched.
2. A recorded DECISION on the `beginStep`/`moveTicket` ticket lock: **rejected for this ticket** (keep `beginStep` lock-free), with the honest residual that the future correction lane REMAINS BLOCKED on either `beginStep` ticket-lock sharing or a composable ledger-transaction primitive -- the strict clear is a necessary but NOT sufficient precondition -- plus the ticket-before-ledger ordering a future adopter must follow.

The strict-read variant the Requirement asks for is already present: `readLedgerStrict(filePath)` throws on corrupt JSON / non-object top level and rethrows non-ENOENT IO errors; `readLedgerSelfHeal` wraps it in a `try/catch -> {}`. So the only new code is the strict clear, plus tests and a systemPatterns note. This ticket wires no caller of the strict clear (the correction lane is an explicit non-goal).

### Related tickets and conflicts

- Provenance: T20260710T1535Z (rejected authoring-correction lane) recorded these preconditions; T20260710T1532Z is the estimate basis.
- Just-merged B20260710T2050Z touched `src/cli.js` (design-review-check unconditional stamp) and added scan-mode `check-dispatch` tests in `test/active-steps.test.js`. This work is strictly additive to `active-steps.js` and does not touch those paths, so those tests stay green.
- No file conflicts: the new function is appended in `active-steps.js`; new tests are appended in `test/active-steps.test.js`; the doc note is one paragraph in `memory-bank/systemPatterns.md`.

### Strict-read error contract (`readLedgerStrict`, already implemented)

Reused as-is; documented here because the strict clear inherits it verbatim.

- `ENOENT` (file absent) -> returns `{}` (an absent ledger is the legitimate initial state, not a failure).
- Other `readFile` error (`EACCES`, `EISDIR`, `EPERM`, ...) -> the raw fs error is rethrown (carries `error.code`).
- `JSON.parse` failure -> `throw new Error("active-steps ledger at <path> is corrupt (invalid JSON): <msg>")`.
- Parsed value is `null`, an array, or a non-object -> `throw new Error("active-steps ledger at <path> is corrupt: expected a JSON object at the top level")`.

No export change is needed: `clearActiveStepStrict` lives in the same module and calls the private `readLedgerStrict` directly (`readActiveSteps` remains the public strict reader).

### `clearActiveStepStrict` API and semantics

Signature mirrors `clearActiveStepIf`: `clearActiveStepStrict(root, ticketId, predicate, options = {})`, returns a `cleared` boolean, honors `options.lock` and the test-only `options.__afterRead` hook. The read-modify-write runs under the existing ledger file lock (`withFileLock(`${filePath}.lock`, ...)`) exactly like `clearActiveStepIf`; the sole difference is the read function: `readLedgerStrict` instead of `readLedgerSelfHeal`. Because a corrupt/unreadable ledger throws during the read (before any write), the lock is released by `withFileLock`'s `finally` and the file is never rewritten.

Semantics table:

| Ledger state | Entry for ticket | predicate | Result |
| --- | --- | --- | --- |
| Healthy JSON object | present | true | delete entry, atomic rewrite, return `true` |
| Healthy JSON object | present | false | no-op, return `false` |
| Healthy JSON object | absent | (not evaluated) | no-op success, return `false` |
| Missing file (`ENOENT`) | none (empty ledger) | (not evaluated) | no-op success, return `false`; no file created |
| Corrupt JSON / non-object top level | n/a | n/a | THROW; ledger bytes untouched |
| Other IO error (`EACCES`, ...) | n/a | n/a | THROW (raw fs error); ledger bytes untouched |

**Missing-FILE decision (explicit): treat a missing ledger file as no-op success, NOT a throw.** Justification: an absent `active-steps.json` is the ordinary state of a board on which no `begin-step` has ever stamped; the Requirement makes a genuinely-missing *entry* a no-op success, and a missing file is the strongest form of a missing entry (there are no entries at all). ENOENT is cleanly distinguishable from corruption/IO failure at the fs layer (`error.code === "ENOENT"`), so "strict" narrows precisely to *corrupt-or-unreadable* (parse failure, wrong top-level shape, real IO errors), which is exactly what a future fail-closed correction lane needs to refuse to proceed on. `predicate` is required (positional, no default), matching `clearActiveStepIf`; identity-scoping is the whole point of the primitive.

### Implementation approach

Factor the shared clear body into a private helper parameterized by the read function, so `clearActiveStepIf` stays byte-identical while `clearActiveStepStrict` reuses the same locked RMW:

```
async function clearActiveStepWith(readLedger, root, ticketId, predicate, options) { ... }
export clearActiveStepIf     = (root, id, pred, opts = {}) => clearActiveStepWith(readLedgerSelfHeal, root, id, pred, opts)
export clearActiveStepStrict = (root, id, pred, opts = {}) => clearActiveStepWith(readLedgerStrict,   root, id, pred, opts)
```

`readLedgerSelfHeal` and `readLedgerStrict` both take `filePath`, so the helper injects one of them after computing `filePath = await ledgerPath(root)`. A straight copy of the function body (leaving `clearActiveStepIf` untouched) is an acceptable alternative if the reviewer prefers a smaller diff; either way `clearActiveStepIf`'s observable behavior must be byte-identical.

### Callers: none change (byte-identical self-heal path)

Ledger readers, all keep `readLedgerSelfHeal` / strict as today:

- `readActiveSteps` -> `readLedgerStrict` (already strict; used by both `check-dispatch` paths). Unchanged.
- `stampActiveStep`, `clearActiveStep`, `clearActiveStepIf`, `stampActiveStepNoClobber` -> `readLedgerSelfHeal`. Unchanged (with the helper refactor, `clearActiveStepIf` still passes `readLedgerSelfHeal`).

Ledger clear/stamp call sites in `src/tickets.js`, all continue through the self-healing primitives:

- `beginStep` -> `stampActiveStep` (self-heal).
- `approveInline` -> `clearActiveStepIf(isActionLedgerEntry)`.
- `completeStep` -> `clearActiveStepIf(isActionLedgerEntry || isSpecialtyLedgerEntry)`.
- `recordDesignReview` -> `clearActiveStepIf(isActionLedgerEntry("design-review"))`.
- `recordGateConsultation` -> `clearActiveStepIf(isGateLedgerEntry(stage))`.
- `moveTicket` -> `clearActiveStepIf(isAnyConsultationLedgerEntry)` (inside the ticket lock).

`src/cli.js`: `gate-check`/`specialty-run` -> `stampActiveStepNoClobber`; `check-dispatch` -> `checkDispatch`. Unchanged. `clearActiveStepStrict` has no caller after this ticket, so the change is purely additive.

### Lock decision: beginStep/moveTicket ticket lock

Today's acquisition order:

- `beginStep` takes **no ticket lock**: it runs `discover`+`loadConfig`+resolve, then `stampActiveStep`, which acquires only the **ledger** file lock.
- `moveTicket` takes the **ticket** lock (`withTicketLock`) for the whole findTicket->rename/write span, and inside it calls `clearActiveStepIf`, which acquires the **ledger** lock while still holding the ticket lock -> a nested `ticket -> ledger` acquisition.
- `completeStep`/`approveInline`/`recordDesignReview`/`recordGateConsultation` take the ticket lock for the write, **release it**, then clear the ledger with the ledger lock alone (no nesting).

So the only existing nested site is `moveTicket` (`ticket -> ledger`), and no path ever acquires `ledger -> ticket`. The global order is already `ticket`-before-`ledger`, hence acyclic and deadlock-free.

**Decision: REJECT sharing the ticket lock with `beginStep` in THIS ticket; keep `beginStep` lock-free. The correction lane it is meant to unblock REMAINS BLOCKED pending one of the two changes enumerated below -- `clearActiveStepStrict` is a necessary but NOT sufficient precondition.** Rationale, argued against the correction lane's concurrency model (not merely today's code):

The lane (future) must, while holding the ticket lock, clear the stale `kind:"action"` stamp AND publish the corrected status atomically with respect to `beginStep`, so that no concurrent `beginStep` stamps the OLD action around the corrected publication. The dangerous interleave: `beginStep` resolves the old status (it takes no ticket lock), the lane then clears the ledger and publishes the corrected status, and `beginStep` -- still holding its now-stale resolution -- stamps the old action afterward. `clearActiveStepStrict` acquires and RELEASES the ledger lock internally, so it is a fail-closed clear but NOT a composable transaction: it cannot by itself make clear+publish atomic against `beginStep`. Closing the window requires serializing `beginStep` against the lane, achievable only by one of:

- (i) **`beginStep`/`moveTicket` ticket-lock sharing** -- wrap `beginStep`'s resolve+stamp in `withTicketLock`, acquiring ticket-before-ledger (the ordering specified below). Then `beginStep` runs wholly before the lane (its old-action stamp is then removed by the lane's strict clear) or wholly after (it resolves the corrected status and stamps the corrected action). Cost: a ticket lock plus a stale-break surface on the hot `begin-step` path.
- (ii) **a composable ledger-level primitive** -- a clear-under-held-lock / callback-under-ledger-lock variant, so the lane can clear the stale action and stamp the corrected action within ONE held ledger lock, closing the window against `beginStep`'s ledger stamp (which also runs under that lock) without altering `beginStep`'s ticket-lock discipline.

This ticket ships neither: both are out of scope (the correction lane is an explicit non-goal, and adding hot-path contention now is unjustified for a lane not being built here). So the rejection is scope-bounded -- `beginStep` stays lock-free in THIS ticket -- and the residual is explicit: the correction lane cannot be built on `clearActiveStepStrict` alone; it also needs (i) OR (ii). This corrects an earlier draft's overstatement that the strict primitive by itself enables the lane's atomic clear+publish; a prior draft also wrongly claimed lock-sharing gives "little" benefit by arguing only against today's action-stamp-preserving `moveTicket` -- the real consumer is the lane, and against the lane's model the benefit is exactly closing the interleave above.

What the strict clear DOES provide (a genuine precondition, just not the whole fix): a fail-closed clear that refuses to silently no-op on a corrupt or unreadable ledger. The `readLedgerSelfHeal` path would convert corruption to `{}` and report a false "nothing to clear", so a lane built on it could believe it had cleared a stale authorization it had not. `clearActiveStepStrict` lets the lane trust that a reported clear reflects real ledger state (or throws), which is prerequisite to any correct clear+publish -- but the serialization in (i)/(ii) is still required on top.

**Accurate mechanics (correcting r1 finding 2):** `check-dispatch` is NOT fail-open on a missing stamp -- with no ledger record `checkDispatchForTicket` falls back to the ticket's configured status action and returns code 1 (deny) on an agent/model mismatch; only the routing HOOK fails open on ambiguous errors / code 2. Self-healing is likewise not universal: a stale entry is overwritten by the next `begin-step`'s `stampActiveStep`, but `specialty-run`'s `stampActiveStepNoClobber` does NOT overwrite a stale non-identical entry -- it reports a `conflict` and leaves the entry in place. These mechanics are precisely why the lane needs an explicit fail-closed clear plus serialization, not passive self-healing.

**Deadlock argument for the adopt case, option (i) (recorded for a future lane):** if a later ticket wraps `begin-step`'s resolve+stamp (or a correction lane's transition+clear+restamp) in the ticket lock, it must acquire the **ticket lock first and the ledger lock second**, never the reverse -- matching `moveTicket`'s existing `ticket -> ledger` nesting. Since every ledger primitive (`stamp*`/`clear*`) already never acquires a ticket lock, this preserves a single global order and no cycle can form. Acquiring the ledger lock and then a ticket lock is the one pattern that would introduce a deadlock and must be prohibited.

### Test strategy

All in `test/active-steps.test.js`, as siblings of the existing "ledger corruption is tolerated on write (self-heals) but surfaced on read" test (line ~119) and the RMW-locking block. Proposed cases:

- `clearActiveStepStrict` on a healthy ledger, predicate true -> target entry deleted, other tickets' entries intact, returns `true`.
- `clearActiveStepStrict` on a healthy ledger, predicate false for a present entry -> no-op, entry intact, returns `false`.
- `clearActiveStepStrict` on a genuinely-missing entry (ledger present with other tickets, target absent) -> no-op success, returns `false`, ledger bytes unchanged.
- `clearActiveStepStrict` on a missing ledger FILE (ENOENT) -> no-op success, returns `false`, and no ledger file is created. Qualify: the no-op-success guarantee holds AFTER lock acquisition; `acquireLock` can still throw on lock contention / a failed stale-break, exactly like every other ledger op -- ENOENT-as-success is about the file the RMW reads, not about lock availability.
- `clearActiveStepStrict` on a corrupt ledger (invalid JSON) -> `assert.rejects(..., /is corrupt/)`, and assert the raw ledger bytes are byte-identical before/after the throw (read file text pre/post).
- `clearActiveStepStrict` on a non-object top-level ledger (e.g. `"[]"` or `"42"`) -> rejects with `/expected a JSON object/`, bytes untouched.
- `clearActiveStepStrict` with a predicate that THROWS on a healthy present entry -> the predicate error propagates, NO write occurs (raw ledger bytes byte-identical), and the ledger lock is RELEASED: a subsequent `clearActiveStepStrict`/`stampActiveStep` on the same ledger acquires the lock and succeeds, proving `withFileLock`'s `finally` released it rather than leaking the lock on a throw from inside `fn`.
- Locking parity: `clearActiveStepStrict` serializes a concurrent stamp via the ledger lock using the `__afterRead` retry-window pattern (mirror the existing "clearActiveStep and stampActiveStep contend on the same ledger lock" test) -> neither update lost.
- Legacy-shape / self-heal regression (contrast, strengthened per r1 finding 3): assert `clearActiveStepIf` on a corrupt ledger does **not** throw, returns `false` (cleared boolean), AND leaves the raw corrupt bytes byte-identical (it self-heals the in-memory read to `{}`, finds no entry, and writes nothing) -- not merely no-throw. Also assert `stampActiveStep` on a corrupt ledger overwrites to valid JSON. The existing line ~119 test already covers `readActiveSteps` rejecting + `stampActiveStep` self-healing; this pins the strict/self-heal split on the CLEAR path. The existing begin-step/complete-step/approve-inline/check-dispatch tests already assert the caller-path shapes are unchanged.

Real non-ENOENT IO errors (EACCES) are not simulated portably on Windows; the non-object-top-level and invalid-JSON cases exercise the throw path, and the rethrow of raw fs errors is covered by inspection (readLedgerStrict rethrows any non-ENOENT `readFile` error).

### Documentation impact

`memory-bank/systemPatterns.md`: one terse note near the active-steps ledger paragraph (~line 185) recording (a) the two read modes -- strict (`readLedgerStrict`/`readActiveSteps`: ENOENT -> `{}`, corrupt/IO -> throw) vs self-heal (swallows to `{}`); (b) the two clear modes -- best-effort self-healing (`clearActiveStep`/`clearActiveStepIf`) vs fail-closed `clearActiveStepStrict` (missing entry or missing file = no-op success, corrupt/unreadable = throw, ledger untouched), a primitive for a future fail-closed correction lane, currently unwired; (c) the lock decision -- `begin-step` stays lock-free in this ticket; the correction lane remains blocked pending EITHER `beginStep` ticket-lock sharing OR a composable clear-under-held-lock primitive (the strict clear alone is insufficient for atomic clear+publish against `beginStep`); if ever serialized, the order is ticket-lock-before-ledger-lock (never the reverse), matching `moveTicket`'s nesting.

### Risks

- Refactoring `clearActiveStepIf` to a shared helper risks a subtle behavior drift; mitigate by keeping the helper body a literal move and relying on the existing caller tests plus the new "does-not-throw on corrupt" assertion. A straight copy is the fallback.
- `clearActiveStepStrict` is unwired; the risk is future misuse (calling it on a hot path where self-heal is the intended tolerance). The systemPatterns note and the "correction-lane only, currently unwired" framing mitigate this.
- The lock decision is a judgment call; it is recorded with the two unblocking options (i)/(ii), the explicit residual that the correction lane is still blocked (the strict clear is necessary-but-insufficient), and the deadlock ordering rule -- so a future correction-lane adopter is neither blocked nor misled into building on the strict clear alone.

### Open questions

None blocking. (If the reviewer wants `clearActiveStepStrict` exported from `active-steps.js` now for a follow-up ticket rather than kept internal until its first caller lands, that is a trivial one-line addition -- defaulting to exported, mirroring `clearActiveStepIf`.)

## Implementation Notes

### Implementation

Added `clearActiveStepStrict(root, ticketId, predicate, options)` to `src/active-steps.js`, factored via a new private `clearActiveStepWith(readLedger, root, ticketId, predicate, options)` helper. `clearActiveStepIf` was rewritten as a one-line delegate to the helper with `readLedgerSelfHeal`; the helper body is a literal copy of the prior `clearActiveStepIf` body, so `clearActiveStepIf`'s behavior is byte-identical (confirmed by the full existing test suite passing unchanged, plus the new self-heal regression test). `clearActiveStepStrict` delegates to the same helper with `readLedgerStrict`. No caller wired (non-goal upheld): the new export has zero call sites outside its own tests.

Added 9 tests in `test/active-steps.test.js` (healthy match/no-match, missing entry, missing file/ENOENT, corrupt JSON throw + bytes untouched, non-object top-level throw + bytes untouched, `clearActiveStepIf` corrupt-ledger legacy regression (no throw, returns false, bytes untouched), predicate-throws (no write, lock released, proven via a follow-on clear succeeding), and lock-concurrency parity using the existing `__afterRead` idiom).

Added a systemPatterns.md note (in the existing active-steps ledger paragraph's vicinity) covering the two read modes, two clear modes, and the lock decision (beginStep stays lock-free; correction lane blocked pending ticket-lock sharing or a composable clear-under-held-lock primitive; ticket-before-ledger ordering if ever adopted).

### Verification

- `npm run check`: pass.
- `node --test`: 585 pass, 1 pre-existing skip, 0 fail.

### Deviations

None from the approved r2 design.

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-11T20:41:50Z: Completed design via claude-subagent:local-board-designer@opus: clearActiveStepStrict(root,ticketId,predicate,options) locked RMW reusing existing private readLedgerStrict; shared clearActiveStepWith helper keeps clearActiveStepIf byte-identical; missing FILE = no-op success (ENOENT = legitimate initial state), strict throws only on corrupt/unreadable; lock decision REJECT sharing ticket lock with beginStep (fail-open rationale + ticket-before-ledger ordering rule recorded for future adopters); 8 test cases incl. corrupt-throws-bytes-untouched and self-heal regression; systemPatterns note.

- 2026-07-11T20:42:52Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: none (internal ledger primitive + lock decision; no UI/auth/external surface)

- 2026-07-11T20:47:33Z: Design review r1 (codex-task:read-only@gpt-5.6-sol, xhigh): FAIL. 1) [High] Lock-rejection rationale evaluated only against today's moveTicket; for the future correction lane (strict clear under ticket lock) beginStep must share the ticket lock across resolution+stamping or it can stamp the old action around a lateral correction; strict clear releases the ledger lock on return so it cannot provide atomic clear+publication - either adopt ticket-lock sharing (ticket-before-ledger ordering) or explicitly record that the correction lane stays blocked pending a composable transaction primitive; the claim that strict clear alone enables the real fix is incorrect. 2) [Med] Overstated fail-open: checkDispatch returns code 1 on mismatch (only the hook fails open on ambiguity/code 2); specialty-run stampActiveStepNoClobber reports conflicts, does not overwrite. 3) [Low] Strengthen corrupt-ledger regression (clearActiveStepIf returns false + raw bytes unchanged), add predicate-throws case (no write, lock released), qualify missing-file success as post-lock-acquisition. Verified clean: readLedgerStrict exists w/ stated semantics incl. Windows ENOENT, helper factoring sound, caller enumeration complete, no reentrancy cycle, non-goal upheld. Looping design rework.

- 2026-07-11T20:51:23Z: Completed design via claude-subagent:local-board-designer@opus: Rework r2: lock rejection kept but re-argued against correction-lane concurrency (strict clear is fail-closed but not composable; lane REMAINS BLOCKED pending ticket-lock sharing or clear-under-held-lock primitive; overstatements retracted); accurate-mechanics note (check-dispatch denies code 1 on mismatch, hook-only fail-open on code 2; no-clobber reports conflicts); tests strengthened (corrupt returns false + bytes unchanged, predicate-throws, post-lock qualification); systemPatterns note synced.

- 2026-07-11T20:57:05Z: Design review r2 (codex-task:read-only@gpt-5.6-sol, xhigh): PASS. Rejection properly scoped with correction-lane race, non-composable strict clear, two future serialization options, and blocked residual explicit; mechanics accurate; strengthened tests confirmed; unchanged sections coherent.

- 2026-07-11T20:57:05Z: Recorded design review via codex-task:read-only@gpt-5.6-sol: r1 FAIL (lock rationale) reworked to option (b) honest residual; r2 PASS all findings resolved, no new inconsistencies

- 2026-07-11T20:57:06Z: Ensured git branch local-board/T20260710T2051Z-active-steps-strict-read-ledger-clear-primitive-and-beginstep-moveticket-lock-decision-correction-lane-preconditions (already-current).

- 2026-07-11T21:01:06Z: Completed implement via claude-subagent:local-board-implementer@sonnet: clearActiveStepWith helper factored via literal body move (clearActiveStepIf byte-identical, self-heal regression proves it); clearActiveStepStrict reuses helper with readLedgerStrict; nothing wired (non-goal upheld); 9 new tests incl. corrupt-throws-bytes-untouched, legacy corrupt regression, predicate-throw+lock-release, concurrency parity; systemPatterns note. Full suite 585/586 pass 1 pre-existing skip. Commit d02c2ab.
