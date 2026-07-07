---
id: B20260707T1322Z
type: bug
status: implementing
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/B20260707T1322Z-no-locking-for-concurrent-ticket-mutations-link-and-block-write-two-files-non-atomically
estimate: 4
estimateBasis: B20260707T1321Z
workStartedAt: 2026-07-07T20:49:23Z
workCompletedAt: null
created: 2026-07-07T13:22:54Z
updated: 2026-07-07T21:03:07Z
completedSteps: ["design:claude-subagent:local-board-designer@opus"]
routingApprovals: []
---
# No locking for concurrent ticket mutations; link and block write two files non-atomically

## Requirement

All ticket mutations are read-modify-write with no locking. `linkParent`/`blockTicket` (`src/tickets.js:494-567`) write two files non-atomically. Under concurrent CLI invocations against the same checkout (parallel orchestrator appending a Run Log comment while a `complete-step` for the same ticket is in flight), the later write clobbers the earlier one — a `completedSteps` token can silently disappear, and strict routing later refuses `move ... done`. The worktree-per-ticket design bounds exposure, but the mainline board and the two-file link/block writes remain exposed.

Fix: per-ticket lockfile (mkdir or `wx`-sentinel next to the ticket) held across read-modify-write; or at minimum document that only one process may mutate a given checkout's `plans/` at a time.

Acceptance: concurrent mutations of the same ticket cannot lose updates (test with two racing processes), or the single-writer constraint is documented and surfaced.

## Acceptance Criteria

## Related Tickets

## Technical Design

Closes the concurrency gap that B1317 (atomic single-file writes) and B1318
(moveTicket rename-first ordering) explicitly left open, and the shared-ledger
read-modify-write (RMW) race T1325 deferred here. Atomicity gives crash-consistency,
not mutual exclusion; two concurrent processes mutating the same checkout still
lose updates. This ticket adds a small, dependency-free file-lock primitive and
applies it to the two genuinely-concurrent hot spots, plus documents the residual.

## Scope reality check (what actually races today)

The worktree-per-ticket + single-orchestrator design already serializes most
same-ticket writes: one orchestrator awaits each CLI call, and each in-flight
ticket lives in its own worktree. The real residual exposures are:

- **(a) The shared `active-steps.json` ledger** — many tickets, one file, anchored
  at the main checkout's git-common-dir so every worktree shares it
  (`src/active-steps.js` `ledgerPath`). `stampActiveStep` (line 82) and
  `clearActiveStep` (line 91) each do read (`readLedgerSelfHeal`) → mutate →
  `writeLedgerAtomic` (line 73). Two `begin-step`/`complete-step` processes for
  *different* tickets running concurrently (parallel mode firing begin-steps via
  background bash, or a hook overlapping a mutation) is a classic lost-update: the
  atomic rename in `writeLedgerAtomic` makes each write torn-free but the two RMW
  windows interleave and one ticket's entry vanishes. This is the deferred T1325
  race and the most defensible "will race under parallel mode" target.
- **(b) Same-ticket file RMW** — the cited acceptance scenario: a Run Log `comment`
  (`appendTicketComment`, line 437) landing while a `complete-step` for the same
  ticket is in flight (`completeStep`, line 561). Both do `findTicket` (read) then
  `writeTicketFile` (write); the later rename clobbers the earlier, so a
  `completedSteps` token silently disappears and strict routing later refuses
  `move ... done` (`validateRouting`, line 861). Bounded by worktree isolation but
  live on the mainline board.
- **(c) Two-file link/block writes** — `linkParent` (608), `unlinkParent` (629),
  `blockTicket` (647), `unblockTicket` (665) each call `writeTicketUpdate` (1556)
  twice, on two different ticket files, with no atomicity across the pair. A crash
  between the two writes leaves a half-link; a concurrent writer to either file
  loses one side.

## Design decision: proportionate machinery

Rejected: a blanket per-ticket lockfile wrapping every `writeTicketFile` call.
It is over-built for an MVP CLI, does not cover the shared ledger (which needs a
lock keyed on the ledger, not a ticket), and a per-*write* lock is useless — the
lost update happens across the read→write window, so the lock must span the whole
RMW, not the rename.

**Recommended (primary): one small `withFileLock` primitive applied to the two
true hot spots, spanning read→write, plus idempotent-healable link/block and
documented residual.**

1. **New `src/lock.js`: `withFileLock(lockPath, fn, opts)`** — `mkdir`-sentinel
   mutual exclusion. `fs.mkdir(lockDir)` is atomic on both Windows and POSIX and
   fails `EEXIST` when held (no `wx` open-file-descriptor to leak, no Windows
   `EPERM`-on-open quirk). On acquire, write a `meta` file (pid, ISO ts, hostname)
   inside the dir for diagnostics and age-based stale detection. `fn` runs inside;
   release is best-effort `rm(lockDir, { recursive: true, force: true })` with the
   same bounded backoff `renameWithRetry` already uses (Windows can throw transient
   `EPERM`/`EBUSY` on the removal). ~40 lines, zero dependencies.
2. **Lock the shared-ledger RMW.** Wrap the read→write body of `stampActiveStep`
   and `clearActiveStep` in `withFileLock(<ledgerPath>.lock, ...)`. Closes (a).
3. **Lock same-ticket RMW.** Add `withTicketLock(root, ticketId, fn)` that resolves
   a lock under `<mainRoot>/.local-board/locks/<ticketId>.lock` (same main-root
   anchor as the ledger via the existing `resolveMainRoot`, so mainline and every
   worktree of the same ticket share one lock namespace). Wrap the read→write body
   of the single-file mutations — `setTicketField`/`setTicketSection`/
   `appendTicketComment` (from `findTicket` through `writeTicketFile`),
   `completeStep`, `approveInline`, and `moveTicket`. Directly satisfies the
   racing-process acceptance test for (b).
4. **Link/block: ordered dual-lock + keep idempotent-healable.** Acquire both
   ticket locks in sorted-id order (deadlock-free) around each pair. This prevents
   the concurrent-clobber but **not** two-file crash atomicity — a power-loss
   between the two renames still leaves a half-link. That residual is acceptable
   because the operations are already idempotent (`addUnique`, and `linkParent`'s
   `parent !== null` guard tolerates re-run) and self-healing: `validateLinks`
   (798) flags either half (e.g. "parent X does not list ticket as child"), and
   re-running the same `link-parent`/`block` command completes the missing side.
   Keep the current write order and document the recoverable-half-link contract.

**Fallback (if simplicity wins for MVP): ledger-lock only + document the
single-writer-per-checkout constraint** for ticket files and surface it in the
skill/CLI. The acceptance criterion explicitly permits the documented-constraint
path. Recommend the primary; note the per-ticket lock spanning read→write is the
larger part of the change surface (touches ~6 entry points).

## Lock mechanics

- **`mkdir` over `wx` lockfile:** both are atomic; `mkdir` avoids fd lifetime
  management and Windows open-handle leaks on crash. Stale handling is identical
  for both (age-based), so `mkdir` is strictly simpler.
- **Bounded retry:** on `EEXIST`, back off (10/20/40/80/160ms …) up to a total
  budget (~2s). On exhaustion, read the lock's `meta` ts: if age > `staleMs`
  (generous, e.g. 30s), break the lock (`rm` the dir) and re-acquire once; else
  throw a clear, path-carrying "lock held by pid/ts" error. Age-based only —
  cross-worktree/cross-host pid-liveness checks are unreliable. Accept the small
  risk of breaking a legitimately slow holder; mitigate with a generous `staleMs`.
- **Windows:** `mkdir`/`rm` do not hit the rename `EPERM`/`EBUSY` path, but reuse
  the existing backoff on the `rm` release for transient AV/indexer locks.
- **Placement:** all locks live under `.local-board/` (already gitignored) so they
  never dirty `git status` or the autoMerge closeout dirty-check in `src/git.js`.

## Test strategy

Racing real processes is inherently flaky, so make the guarantee deterministic and
keep the process race as a secondary smoke test.

- **Deterministic seam (primary).** Add a test-only injection (mirroring the
  existing `options.renameFn` seam) — e.g. `options.__afterRead` async hook invoked
  between the RMW read and the write. Control test: run two overlapping mutations
  in-process (`Promise.all`) on the same ticket with `__afterRead` forcing the
  interleave; **without** the lock, assert a token is lost (proves the seam
  reproduces the bug); **with** the lock, assert both tokens survive (the second
  RMW blocks until the first releases, then reads the first's write). Same pattern
  for the ledger: two concurrent `stampActiveStep` for different ticket ids both
  survive.
- **Stale-break test.** Pre-create a lock dir with an old `meta` ts; assert a new
  mutation breaks it and proceeds.
- **Contention/timeout test.** Hold a lock, short `staleMs`, assert a second
  acquire retries then breaks (or throws) deterministically.
- **Probabilistic smoke test (secondary backstop).** Spawn two real
  `node ./bin/local-board.js` processes in a modest loop (~20 iters) doing
  `comment` + `complete-step` on the same ticket; assert the `completedSteps` token
  is never lost. Gate behind `GIT_AVAILABLE`/a slow flag; it is a backstop, not the
  primary guarantee.

## Risks

- **Change surface / over-engineering.** Wrapping ~6 entry points spanning read→
  write is the bulk of the diff. Mitigate: centralize as `withTicketLock(root, id,
  fn)` so each site is ~1 line; do not touch read-only query paths.
- **Deadlock in link/block dual-lock.** Always acquire in sorted-id order.
- **Stale-break of a live slow holder.** Generous `staleMs`; residual accepted.
- **Not power-loss durable.** Locks give mutual exclusion, not fsync durability;
  the two-file link/block crash window remains — documented, idempotent-healable.
- **Cross-worktree correctness.** Ticket locks must anchor at `resolveMainRoot`
  (like the ledger), or two worktrees of the same id would not serialize. Same-
  ticket lives in one worktree by design, but anchoring keeps mainline + worktree
  consistent and matches the ledger's namespace.
- **Merge/sequencing.** Builds on B1317's `writeTicketFile` and B1318's `moveTicket`
  rename-first seam (both landed); no conflict expected. B1318 flagged that B1322
  re-touches `moveTicket` — confirmed it lands after.

## Related Tickets

- **B20260707T1317Z (atomic single-file writes) — landed.** Its Related-Tickets note
  calls B1322 a "superset concern": atomicity != mutual exclusion, per-ticket
  lockfile deferred here. Foundation for all write sites.
- **B20260707T1318Z (moveTicket rename-first ordering) — landed.** Deferred
  concurrency/locking for `moveTicket` here and kept the diff small (rename-first +
  `renameFn` passthrough) to minimize this ticket's merge surface.
- **T20260707T1325Z (active-steps ledger / check-dispatch) — landed.** Explicitly
  deferred the shared-ledger RMW lock to B1322 ("should sit behind the per-ticket/
  lock primitive from B20260707T1322Z; a shared-file lock, not per-ticket, is what
  this actually needs"). Blast radius of a lost ledger entry is fail-open (weakens a
  hook check, never corrupts a ticket).

## Open questions

1. Scope for MVP: primary (ledger lock + per-ticket lock spanning read→write) vs
   fallback (ledger lock only + documented single-writer-per-checkout)?
2. Do read-only paths (`check-dispatch`, `query-*`, `validate`) stay lock-free?
   (Reads already tolerate atomic-rename writes; recommend yes, lock-free.)
3. Confirm `.local-board/locks/` anchored at main-root (shared across worktrees),
   matching the ledger anchor.
4. On stale-break: silent vs warn-to-stderr, and the `staleMs` value (default 30s?).

## Implementation Notes

Implemented the primary design: a dependency-free `withFileLock` mkdir-sentinel
primitive, applied to all three identified hot spots. Read-only paths
(`check-dispatch`, `query-*`, `validate`, `discover`) are untouched.

**New `src/lock.js`:**
- `withFileLock(lockPath, fn, options)` -- `mkdir(lockPath)` (non-recursive,
  atomic EEXIST-on-held) acquire; writes a `meta` file (pid, ISO ts, hostname)
  for diagnostics/stale-detection; retries EEXIST with doubling backoff
  (10/20/40/80... ) up to `options.retryBudgetMs` (default 2000ms); on
  exhaustion, breaks the lock if `meta` age > `options.staleMs` (default
  30000ms, generous per the design) and re-acquires once, else throws a clear
  error naming the lock path and holder (pid/host/ts). Release is best-effort
  `rm(lockPath, { recursive: true, force: true })`. `options.onStaleBreak` is
  a test/diagnostic hook; the default logs a warning to stderr.
- `resolveMainRoot(root)` -- moved here from `active-steps.js` (was
  duplicated logic); both the ledger lock and per-ticket locks anchor at the
  main worktree root via git-common-dir, falling back to `root` outside git.
- `ticketLockPath` / `withTicketLock(root, ticketId, fn, options)` -- resolves
  `<mainRoot>/.local-board/locks/<ticketId>.lock`.
- `withOrderedTicketLocks(root, idA, idB, fn, options)` -- sorts the two ids
  and acquires in that order (dedupes to a single lock if idA === idB),
  making concurrent dual-lock callers deadlock-free regardless of argument
  order.

**`src/active-steps.js`:** `stampActiveStep`/`clearActiveStep` now take an
`options` param (`{ __afterRead, lock }`) and wrap their read
(`readLedgerSelfHeal`) -> mutate -> write (`writeLedgerAtomic`) body in
`withFileLock(<ledgerPath>.lock, ...)`. `__afterRead` is a test-only hook
(mirrors the existing `renameFn` seam) invoked between the read and the write
to force a deterministic overlap in tests. All existing call sites (`0`/`1`/
`2`/`3`-arg forms) are unaffected -- `options` defaults to `{}`.

**`src/tickets.js`:** added `withTicketLock`/`withOrderedTicketLocks` import.
Wrapped the read (`findTicket`) -> write (`writeTicketFile`) span, with the
same `__afterRead` test seam, in: `setTicketField` (non-`status` branch only;
the `status` branch still delegates to `moveTicket`, which takes its own
lock -- no double-lock/self-deadlock), `setTicketSection`,
`appendTicketComment`, `completeStep`, `approveInline`, and `moveTicket`
(spans the rename + rewrite). `completeStep`/`approveInline` call
`clearActiveStep` for their own ticket id *after* releasing the ticket lock
(no lock-ordering hazard: the ledger lock and per-ticket lock are different
resources acquired sequentially, never nested).

`linkParent`/`unlinkParent`/`blockTicket`/`unblockTicket` each wrap their
find-pair + two-`writeTicketUpdate` body in
`withOrderedTicketLocks(root, idA, idB, ...)`. This prevents a concurrent
writer to either file in the pair from clobbering the other side, but (per
design, explicitly accepted) does **not** give two-file crash atomicity -- a
power-loss between the two renames still leaves a half-link. That residual
is unchanged from before this ticket and is self-healing:
`validateLinks`/`validate` flags either half, and re-running the same
`link-parent`/`block` command completes the missing side (both halves are
idempotent -- `addUnique`, and `linkParent`'s `parent !== null` guard
tolerates a re-run).

All lock paths live under `.local-board/` (already gitignored), so they
never dirty `git status` or the auto-merge closeout check.

**`package.json`:** added `src/lock.js` to the `check` script's `node
--check` file list.

## Tests added

- `test/lock.test.js` (new, 10 tests): `resolveMainRoot`/`ticketLockPath`
  resolution; `withFileLock` mutual exclusion (two overlapping critical
  sections never interleave), lock release on `fn` throw, stale-lock
  break-and-proceed (with `onStaleBreak` firing), contention timeout
  (clear path-carrying "held by" error on a live, non-stale lock);
  `withTicketLock` serialization; `withOrderedTicketLocks` reversed-argument
  concurrent calls (proves the dual-lock ordering is deadlock-free) and the
  same-id self-pair case; lock-directory cleanup after release.
- `test/active-steps.test.js` (+4 tests): a **control** test using a
  hand-rolled unlocked read+delay+write against the raw ledger file, proving
  the naive RMW pattern loses an update under a forced interleave (sanity-
  checks that the seam reproduces the real bug); `stampActiveStep` for two
  different ticket ids racing via `__afterRead` -- both entries survive;
  `clearActiveStep` racing a concurrent `stampActiveStep` -- neither is lost;
  a stale-ledger-lock break-and-proceed test via the public API.
- `test/tickets.test.js` (+4 tests, +1 slow/gated): a **control** test using
  hand-rolled unlocked `findTicket`+delay+`writeTicketFile`, proving the
  naive per-ticket RMW pattern loses a concurrent field update (same
  bug-reproduction rationale); `appendTicketComment` racing `completeStep` on
  the same ticket via `__afterRead` -- this is the ticket's literal
  acceptance scenario, and both the Run Log comment and the `completedSteps`
  token survive; `linkParent`/`unlinkParent` with reversed argument order run
  concurrently -- proves no deadlock and the board stays internally
  consistent; a probabilistic smoke test spawning two real
  `node ./bin/local-board.js comment` processes racing 20 iterations each on
  the same ticket, asserting no Run Log line is lost -- gated behind
  `LOCAL_BOARD_SLOW_TESTS=1` (skipped by default; verified manually, passes
  in ~2.3s).

## Verification

- `npm run check` -- green (added `src/lock.js` to the file list).
- `npm test` -- 284 passed, 1 skipped (the gated slow smoke test), 0 failed.
- `LOCAL_BOARD_SLOW_TESTS=1 node --test --test-name-pattern="smoke" test/tickets.test.js`
  -- the gated smoke test passes on its own (~2.3s).
- `node ./bin/local-board.js validate` -- "Ticket validation OK" (live board
  unaffected; no stray lock directories left in `.local-board/`).

## Deviations from the design

None. Implemented the primary option (not the ledger-lock-only fallback):
`withFileLock` primitive, ledger lock, per-ticket lock spanning read->write
on all six listed entry points, and ordered dual-locks for
link/block/unlink/unblock. Open questions resolved as the design
recommended: read-only paths stay lock-free; locks anchor at
`resolveMainRoot` (shared with the ledger); stale-break defaults to 30s and
warns to stderr (via the default `onStaleBreak`, overridable).

## Residual risks (unchanged from the design's own risk list)

- Two-file link/block writes are still not crash-atomic across the pair
  (locking prevents concurrent-writer clobber, not a mid-pair crash);
  documented as self-healing via `validateLinks`/re-run, same as before.
- Stale-break trades a small risk of breaking a legitimately slow holder for
  not hanging forever on a crashed one; mitigated by the generous default
  `staleMs` (30s).
- Locks are process-local mutual exclusion, not fsync durability.

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-07T20:48:25Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): withFileLock mkdir-sentinel primitive (bounded retry, age-based stale break) on the ledger RMW and per-ticket mutation spans, ordered dual-locks for link/block, deterministic + probabilistic race tests; read paths stay lock-free. Estimate 4 (basis B20260707T1321Z).

- 2026-07-07T20:49:23Z: Ensured git branch local-board/B20260707T1322Z-no-locking-for-concurrent-ticket-mutations-link-and-block-write-two-files-non-atomically (created).
