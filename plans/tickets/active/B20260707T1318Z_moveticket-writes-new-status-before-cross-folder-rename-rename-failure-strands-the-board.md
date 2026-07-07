---
id: B20260707T1318Z
type: bug
status: implementing
priority: P1
parent: null
children: []
blockedBy: [B20260707T1317Z]
blocks: []
branch: local-board/B20260707T1318Z-moveticket-writes-new-status-before-cross-folder-rename-rename-failure-strands-the-board
estimate: 2
estimateBasis: B20260707T1317Z
workStartedAt: 2026-07-07T14:30:44Z
workCompletedAt: null
created: 2026-07-07T13:18:54Z
updated: 2026-07-07T14:35:59Z
completedSteps: ["design:claude-subagent:local-board-designer@opus"]
routingApprovals: []
---
# moveTicket writes new status before cross-folder rename; rename failure strands the board

## Requirement

`moveTicket` (`src/tickets.js:310-315`) writes the content containing the new `status` to the old path, then `rename()`s the file into the new status folder. On Windows, `EPERM`/`EBUSY` from antivirus or an editor holding the file is common. If the rename throws after the write, the ticket claims (for example) `status: done` while sitting in `plans/tickets/active/`. `validateStatusFolder` flags the mismatch, and because board queries throw on any validation issue, the entire board becomes unusable — including for unrelated parallel tickets.

Fix: create the file at the target path first (open with flag `wx`, which also closes the exists() TOCTOU race at line 306), then delete the old path. Alternatively rename first, then rewrite front matter in place. Combine with the atomic-write helper from B20260707T1317Z.

Acceptance: a failed cross-folder move leaves the ticket fully consistent at exactly one path; a test covers rename failure.

## Acceptance Criteria

## Related Tickets

## Technical Design

Reorder `moveTicket`'s cross-folder move so the file's on-disk location and its
`status` front matter can only ever disagree in a single, retry-healable state,
and never in the state the reported bug produces (new status written to the old
folder). Rename first, then rewrite content in place; roll back the rename if the
in-place rewrite fails.

### Root cause (current code)

`moveTicket` (`src/tickets.js:333-371`) does, for a cross-folder transition:

1. `src/tickets.js:355` renders `content` with the **new** status.
2. `src/tickets.js:364` `await writeTicketFile(ticket.path, content)` — writes the
   new-status content to the **old** path (atomic in-place, from B20260707T1317Z).
3. `src/tickets.js:366-368` `await rename(ticket.path, targetPath)` — a plain
   `rename` (not even `renameWithRetry`) into the new status folder.

If step 3 throws (`EPERM`/`EBUSY`/`EACCES` on Windows from AV, Search Indexer, or
an editor handle), the file is left with `status: <new>` while physically in the
old folder. `validateStatusFolder` (`src/tickets.js:723-736`) flags the mismatch,
and every board query aggregates that into `validate` (`src/tickets.js:292-315`)
and throws: `queryNext`/`queryReady`/`queryTicket` (`src/tickets.js:848-897`),
`beginStep` (`src/tickets.js:445-450`), `stateReport`. One strand's failed move
wedges the whole board, including unrelated parallel tickets. Secondary defect:
step 3 bypasses the `renameWithRetry` helper, so it does not even absorb the
transient Windows errors that motivated that helper.

### Why the reported failure is the worst intermediate state

A cross-folder move must change two things that live in different places: the file
**location** and the `status` **field**. No single filesystem op changes both, so
any crash/throw between the two steps leaves one of three intermediate states:

- **Reported (current) state** — new status, old folder. Single file, but the
  content op happened before the risky move op, so the *most likely* failure point
  (the cross-folder rename) lands here. Mismatch wedges the board.
- **Duplicate-id state** (write-to-target-then-delete-old, requirement option a) —
  two files, each individually folder-consistent, same id. Wedges the board via
  duplicate-id detection (`src/tickets.js:300-302`), and worse, is **not
  retryable**: `findTicket` (`src/tickets.js:317-331`) throws `duplicated`, so
  `moveTicket` cannot even re-run to finish the move. Requires manual cleanup.
- **Stale-status-in-new-folder state** (rename-first, requirement option b) — one
  file, old status, new folder. Mismatch wedges the board *only if it persists*,
  but it is **self-healing on retry**: re-running `moveTicket(id, newStatus)` finds
  the single file, computes `targetPath` equal to its current path (already in the
  new folder), skips the cross-folder branch, and rewrites the status in place.

### Chosen ordering: rename first, then rewrite in place (option b), with rollback

For the actual reported failure mode — a throw, not a power cut — option (b) makes
the risky operation happen **first, before any content change**, so its failure is
harmless:

```
// cross-folder branch
if (path.resolve(ticket.path) !== path.resolve(targetPath)) {
  await renameWithRetry(ticket.path, targetPath, options.renameFn);
  try {
    await writeTicketFile(targetPath, content, { renameFn: options.renameFn });
  } catch (error) {
    // Roll the file back to its old path so status(old)+folder(old) stay consistent.
    await renameWithRetry(targetPath, ticket.path, options.renameFn).catch(() => {});
    throw error;
  }
} else {
  await writeTicketFile(targetPath, content, { renameFn: options.renameFn });
}
```

Failure analysis of the reordered flow:

- **Cross-folder `renameWithRetry` throws (the reported EPERM/EBUSY case):** the
  file is untouched at the old path with old (folder-consistent) status. Board is
  **fully consistent, single file, not wedged**; the caller sees the throw and can
  retry. This is the exact acceptance criterion.
- **In-place `writeTicketFile` throws (step 2):** this is the same same-directory
  temp-write-then-rename that already works reliably for in-place moves (it renames
  within the target folder, not across folders). On failure we roll the file back
  to its old path, restoring the fully-consistent old state, then re-throw. If the
  rollback rename *also* throws (double failure, very rare), we are left in the
  single-file, retry-healable stale-status state — never a duplicate.

Net: the only path to a persisting mismatch is a hard process/power crash between
the two ops, which no ordering can eliminate and which is out of scope for a
throw-handling fix. Every in-process throw now resolves to a single, consistent
file.

Also fixes the secondary defect: the cross-folder rename now goes through
`renameWithRetry`, so transient Windows locks are absorbed by the existing backoff
(`src/tickets.js:123-135`) instead of failing on first contact.

### Test injection point

`moveTicket` currently has no `renameFn` seam; the cross-folder rename at
`src/tickets.js:367` calls the real `rename` directly. Add `options.renameFn`
passthrough and thread it to both `renameWithRetry` (the cross-folder move) and
`writeTicketFile({ renameFn })` (the in-place rewrite). This mirrors the existing
injection contract that `writeTicketFile` documents (`src/tickets.js:142-145`) and
that the tests already exercise (`test/tickets.test.js:1428-1468`). Production call
sites pass no `renameFn` and keep the real `rename` default.

### TOCTOU note (line 360)

The requirement suggested `wx` exclusive-create to also close the `exists()` race
at `src/tickets.js:360`. That is incompatible with rename-first ordering (a rename
cannot exclusive-create). The residual race is near-zero risk here: `targetPath`'s
basename embeds the globally-unique ticket id, so a pre-existing target means a
genuine duplicate-id file, which is exactly the error the `exists()` precheck
should surface. Keep the precheck as-is. True atomic collision-safety belongs with
concurrency/locking (B20260707T1322Z), not this ticket.

## Related Tickets and Conflicts

- **B20260707T1317Z (landed, mainline):** introduced `writeTicketFile`,
  `renameWithRetry`, and the `renameFn` test-injection seam this design builds on.
  It is the estimate calibration basis. No conflict — this ticket consumes its
  helpers. `blockedBy: [B20260707T1317Z]` in front matter is already satisfied
  (that ticket is merged).
- **B20260707T1322Z (pending) — same function:** concurrency/locking for
  `moveTicket`. **Out of scope here.** This ticket must not add locking; it only
  reorders the single-writer failure sequence. Expect a later edit to the same
  `moveTicket` body — keep this change small and self-contained (ordering + rollback
  + `renameFn` passthrough) to minimize the merge surface for B1322.

## Recovery-behavior decision

Do **not** relax the global hard-fail in `validate`/`validateStatusFolder` in this
ticket. Rationale:

- With option (b) + rollback, every *in-process throw* (the reported failure mode)
  now leaves the board fully consistent, so no wedge occurs and there is nothing to
  auto-heal for the case this ticket owns.
- The only residual mismatch is a true power-loss crash between the two ops. Making
  discovery/validate auto-heal or downgrade a folder/status mismatch (so one bad
  strand does not throw every query) is a broader resilience-policy change: it
  touches every query path, interacts with duplicate-id semantics, and needs its
  own acceptance criteria. Flag it as a follow-up, do not fold it in here.

Current hard-fail behavior is documented above (Root cause) so the follow-up has a
precise starting point.

## Risks

- **Rollback rename also fails (double fault):** leaves the single-file,
  stale-status-in-new-folder state. Mitigation: it is retry-healable (re-running the
  same move rewrites status in place) and strictly better than today's silent plain
  `rename`. Accept.
- **Merge contention with B1322:** both edit `moveTicket`. Mitigation: keep the diff
  minimal and localized to the cross-folder branch.
- **POSIX rename-overwrite:** if `targetPath` somehow pre-exists, POSIX `rename`
  clobbers it silently. Mitigated by the retained `exists()` precheck at line 360;
  residual race deferred to B1322.
- **Behavior parity for same-folder moves:** the `else` branch must remain a plain
  in-place `writeTicketFile` so status-only transitions within one folder are
  unchanged. Covered by existing move tests.

## Test Strategy

Follow the established `renameFn`-injection failure pattern
(`test/tickets.test.js:1420-1470`). Add `options.renameFn` to `moveTicket` first so
tests can target the cross-folder rename.

1. **Cross-folder rename failure leaves the ticket consistent at exactly one path**
   (the acceptance test): create a ticket in a ready/active folder, call
   `moveTicket` to a status in a different folder with a `renameFn` that throws a
   non-retryable code (e.g. `ENOSPC`, matching the existing byte-identical test).
   Assert: (a) the call rejects; (b) exactly one file exists, at the **old** path;
   (c) its content still has the **old** status; (d)
   `validate(await discover(root), config)` returns `[]` (board not wedged).
2. **Cross-folder rename retries a transient Windows error and succeeds:**
   `renameFn` throws `EPERM` on the first cross-folder call then delegates to real
   `rename`. Assert the move completes, file is at the new path with new status,
   no temp/duplicate files remain.
3. **In-place rewrite failure after a successful rename rolls back:** `renameFn`
   succeeds for the first (cross-folder) rename but the injected `writeTicketFile`
   rename throws; assert the file is rolled back to the old path with old status and
   `validate` is clean. (If threading a single `renameFn` to both makes this
   awkward, use a stateful fn that fails only on the second rename call.)
4. **Same-folder (status-only) move is unaffected:** regression assertion that a
   transition staying within one folder still rewrites status in place with no
   rename attempted.
5. Reuse the existing "no orphaned temp files / zero load errors" assertions
   (`test/tickets.test.js:1472+`) for the success path.

## Documentation Updates

None required. Behavior contract is internal; `memory-bank/systemPatterns.md`
already frames atomic writes at the B1317 level. If a one-line note on the
move-ordering invariant is wanted, add it there, but it is not load-bearing for
this fix.

## Open Questions

- Should the power-loss (non-throw) folder/status mismatch be auto-healed or
  downgraded to a non-fatal warning so one bad strand cannot wedge unrelated
  queries? Recommended as a **separate follow-up ticket**, not this one.
- B1322 will re-touch `moveTicket` for locking — confirm sequencing so this
  ordering fix lands first (it should, since B1322 builds on a correct single-writer
  sequence).

## Implementation Notes

Implemented the rename-first, rewrite-in-place-with-rollback ordering in `moveTicket`
(`src/tickets.js`) exactly per the Technical Design.

Cross-folder branch now:
1. `renameWithRetry(ticket.path, targetPath, options.renameFn)` — the risky op runs
   first, before any content change. If it throws, the file is untouched at the old
   path with the old (folder-consistent) status; nothing to roll back.
2. On success, `writeTicketFile(targetPath, content, { renameFn: options.renameFn })`
   rewrites the new-status content in place at the new path. If this throws, the code
   rolls back via `renameWithRetry(targetPath, ticket.path, options.renameFn).catch(() => {})`
   (best-effort) and rethrows the original error, restoring the single-file
   old-path/old-status state.

Same-folder branch is unchanged in behavior: a single `writeTicketFile(targetPath,
content, { renameFn: options.renameFn })`, now also threading `options.renameFn` for
test injection parity.

Added `options.renameFn` passthrough to `moveTicket` (previously only
`writeTicketFile` had this seam); production call sites pass no `renameFn` and keep
the real `rename` default. The formerly-unguarded plain `rename()` call at the old
line 367 is gone — the cross-folder move now goes through `renameWithRetry`, so it
also absorbs transient Windows `EPERM`/`EBUSY`/`EACCES` the same way in-place writes
already do.

No locking added (out of scope, deferred to B20260707T1322Z). No change to
validation/hard-fail behavior (deferred per the ticket's Recovery-behavior decision).
The `exists()` TOCTOU precheck at the old line 360 is unchanged, per the design's
TOCTOU note.

Tests added in `test/tickets.test.js` (all passing), following the established
`renameFn`-injection pattern:
- "moveTicket cross-folder rename failure leaves the ticket consistent at exactly
  one path" — non-retryable `ENOSPC` on the cross-folder rename; asserts single file
  at old path, old status, target folder empty, `validate` clean.
- "moveTicket cross-folder rename retries a transient Windows error and succeeds" —
  `EPERM` on first attempt then real rename; asserts move completes, no leftovers.
- "moveTicket rolls back the rename when the in-place rewrite fails" — stateful
  `renameFn` succeeds the cross-folder rename (call 1) then throws `ENOSPC` on the
  in-place rewrite's temp-rename (call 2); asserts rollback to old path with
  byte-identical original content, target folder empty, `validate` clean.
- "moveTicket within the same status folder rewrites in place without a
  cross-folder rename" — regression test using `ready_for_review` -> `reviewing`
  (both map to the `review` folder); a tracking `renameFn` confirms every recorded
  rename call has matching source/destination directories (no cross-folder rename
  attempted).

Verification:
- `npm run check` — pass.
- `npm test` — 146 tests, 144 pass, 2 fail. Both failures are pre-existing and
  unrelated (`resources-sync.test.js`: CRLF vs LF drift between `resources/` and
  `plans/` mirrors on this Windows checkout); confirmed pre-existing by stashing
  this change and re-running (same 2 failures, same test names). `test/tickets.test.js`
  alone: 68/68 pass, including all 4 new tests.
- `npm run validate` — "Ticket validation OK".

No deviations from the Technical Design. Scope held to `moveTicket`'s cross-folder
ordering and its `renameFn` seam; no locking, no validation-behavior change.

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-07T14:30:44Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): rename-first then rewrite-in-place with rollback; failure states stay folder-consistent; also upgrades the plain rename at :367 to renameWithRetry; hard-fail relaxation deferred. Estimate 2 (basis B20260707T1317Z, calibrated).

- 2026-07-07T14:30:44Z: Ensured git branch local-board/B20260707T1318Z-moveticket-writes-new-status-before-cross-folder-rename-rename-failure-strands-the-board (created).
