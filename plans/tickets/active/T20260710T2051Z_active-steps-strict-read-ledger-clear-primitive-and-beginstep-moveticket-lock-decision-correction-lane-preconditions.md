---
id: T20260710T2051Z
type: task
status: designing
priority: P4
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260710T2051Z-active-steps-strict-read-ledger-clear-primitive-and-beginstep-moveticket-lock-decision-correction-lane-preconditions
estimate: 4
estimateBasis: T20260710T1532Z
workStartedAt: null
workCompletedAt: null
created: 2026-07-10T20:50:03Z
updated: 2026-07-11T20:41:50Z
completedSteps: ["design:claude-subagent:local-board-designer@opus"]
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
2. A recorded DECISION on the `beginStep`/`moveTicket` ticket lock: **rejected** (keep `beginStep` lock-free/advisory-fail-open), with the ordering rule a future adopter must follow.

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

**Decision: REJECT sharing the ticket lock with `beginStep`; keep `beginStep` lock-free / advisory-fail-open.** Rationale:

1. `beginStep` performs **no ticket-file write**, so there is no front-matter lost-update to serialize; the only shared mutable state it touches is the ledger, already serialized by the ledger file lock.
2. The stamp is idempotent and self-healing (the next `begin-step`/`specialty-run` overwrites a stale entry), and `check-dispatch` **fails open**: no stamp -> fall back to the ticket's configured status action; stamp present -> authorize it. The hook is a guardrail, not a transaction boundary.
3. Lock-sharing does not actually close the motivating edge (a stale `kind:"action"` stamp authorizing the old stage's agent after a lateral/loop-back move): `moveTicket` deliberately does **not** clear action-kind stamps, so a stale action stamp lingers after the move whether or not `begin-step` held the ticket lock. The real fix for that edge is an atomic clear-and-restamp in a future correction lane, which is exactly what the fail-closed `clearActiveStepStrict` primitive enables, not coarser locking.
4. The correction lane is an explicit non-goal; adding contention and a new stale-break surface to the hot `begin-step` path now buys little.

**Deadlock argument for the adopt case (recorded for a future lane):** if a later ticket wraps `begin-step`'s resolve+stamp (or a correction lane's transition+clear+restamp) in the ticket lock, it must acquire the **ticket lock first and the ledger lock second**, never the reverse -- matching `moveTicket`'s existing `ticket -> ledger` nesting. Since every ledger primitive (`stamp*`/`clear*`) already never acquires a ticket lock, this preserves a single global order and no cycle can form. Acquiring the ledger lock and then a ticket lock is the one pattern that would introduce a deadlock and must be prohibited.

### Test strategy

All in `test/active-steps.test.js`, as siblings of the existing "ledger corruption is tolerated on write (self-heals) but surfaced on read" test (line ~119) and the RMW-locking block. Proposed cases:

- `clearActiveStepStrict` on a healthy ledger, predicate true -> target entry deleted, other tickets' entries intact, returns `true`.
- `clearActiveStepStrict` on a healthy ledger, predicate false for a present entry -> no-op, entry intact, returns `false`.
- `clearActiveStepStrict` on a genuinely-missing entry (ledger present with other tickets, target absent) -> no-op success, returns `false`, ledger bytes unchanged.
- `clearActiveStepStrict` on a missing ledger FILE (ENOENT) -> no-op success, returns `false`, and no ledger file is created.
- `clearActiveStepStrict` on a corrupt ledger (invalid JSON) -> `assert.rejects(..., /is corrupt/)`, and assert the raw ledger bytes are byte-identical before/after the throw (read file text pre/post).
- `clearActiveStepStrict` on a non-object top-level ledger (e.g. `"[]"` or `"42"`) -> rejects with `/expected a JSON object/`, bytes untouched.
- Locking parity: `clearActiveStepStrict` serializes a concurrent stamp via the ledger lock using the `__afterRead` retry-window pattern (mirror the existing "clearActiveStep and stampActiveStep contend on the same ledger lock" test) -> neither update lost.
- Legacy-shape / self-heal regression (contrast): assert `clearActiveStepIf` on a corrupt ledger does **not** throw and no-ops (self-heals to `{}`), and `stampActiveStep` on a corrupt ledger overwrites to valid JSON. The existing line ~119 test already covers `readActiveSteps` rejecting + `stampActiveStep` self-healing; add the explicit `clearActiveStepIf`-does-not-throw assertion so the strict/self-heal split is pinned. The existing begin-step/complete-step/approve-inline/check-dispatch tests already assert the caller-path shapes are unchanged.

Real non-ENOENT IO errors (EACCES) are not simulated portably on Windows; the non-object-top-level and invalid-JSON cases exercise the throw path, and the rethrow of raw fs errors is covered by inspection (readLedgerStrict rethrows any non-ENOENT `readFile` error).

### Documentation impact

`memory-bank/systemPatterns.md`: one terse note near the active-steps ledger paragraph (~line 185) recording (a) the two read modes -- strict (`readLedgerStrict`/`readActiveSteps`: ENOENT -> `{}`, corrupt/IO -> throw) vs self-heal (swallows to `{}`); (b) the two clear modes -- best-effort self-healing (`clearActiveStep`/`clearActiveStepIf`) vs fail-closed `clearActiveStepStrict` (missing entry or missing file = no-op success, corrupt/unreadable = throw, ledger untouched), a primitive for a future fail-closed correction lane, currently unwired; (c) the lock decision -- `begin-step` stays lock-free/advisory-fail-open; if ever serialized, the order is ticket-lock-before-ledger-lock (never the reverse), matching `moveTicket`'s nesting.

### Risks

- Refactoring `clearActiveStepIf` to a shared helper risks a subtle behavior drift; mitigate by keeping the helper body a literal move and relying on the existing caller tests plus the new "does-not-throw on corrupt" assertion. A straight copy is the fallback.
- `clearActiveStepStrict` is unwired; the risk is future misuse (calling it on a hot path where self-heal is the intended tolerance). The systemPatterns note and the "correction-lane only, currently unwired" framing mitigate this.
- The lock decision is a judgment call; it is recorded with the deadlock ordering rule so a future adopter is not blocked.

### Open questions

None blocking. (If the reviewer wants `clearActiveStepStrict` exported from `active-steps.js` now for a follow-up ticket rather than kept internal until its first caller lands, that is a trivial one-line addition -- defaulting to exported, mirroring `clearActiveStepIf`.)

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-11T20:41:50Z: Completed design via claude-subagent:local-board-designer@opus: clearActiveStepStrict(root,ticketId,predicate,options) locked RMW reusing existing private readLedgerStrict; shared clearActiveStepWith helper keeps clearActiveStepIf byte-identical; missing FILE = no-op success (ENOENT = legitimate initial state), strict throws only on corrupt/unreadable; lock decision REJECT sharing ticket lock with beginStep (fail-open rationale + ticket-before-ledger ordering rule recorded for future adopters); 8 test cases incl. corrupt-throws-bytes-untouched and self-heal regression; systemPatterns note.
