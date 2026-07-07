---
id: B20260707T1317Z
type: bug
status: implementing
priority: P1
parent: null
children: []
blockedBy: []
blocks: [B20260707T1318Z]
branch: local-board/B20260707T1317Z-ticket-writes-are-not-atomic-crash-mid-write-corrupts-canonical-board-file
estimate: 4
estimateBasis: bootstrap
workStartedAt: 2026-07-07T13:50:04Z
workCompletedAt: null
created: 2026-07-07T13:17:14Z
updated: 2026-07-07T13:55:34Z
completedSteps: ["design:claude-subagent:local-board-designer@opus"]
routingApprovals: []
---
# Ticket writes are not atomic; crash mid-write corrupts canonical board file

## Requirement

Every ticket mutation writes the full file directly with `writeFile(ticket.path, ...)` (`src/tickets.js:310, 367, 379, 387, 444, 490, 1400`). A process crash or disk-full during any mutation (for example `complete-step`) leaves a truncated ticket. Front matter is the canonical database, and `query-next`/`begin-step`/`validate` hard-fail on any ticket load error, so one corrupt file wedges the entire board until a human repairs it.

Fix: write to a temp file next to the target (`${path}.tmp-${pid}`) and `rename()` over the destination. `install.mjs:396-398` already uses this pattern for settings.json. Extract a shared `writeTicketFile` helper and route all ticket writes through it.

Acceptance: all ticket mutations are atomic (temp-write-then-rename); a test simulates a partial write and shows the original file survives.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Summary

Ticket mutations in `src/tickets.js` overwrite the canonical file in place with a
bare `writeFile(ticket.path, ...)`. A crash, disk-full, or killed process mid-write
truncates the file. Because front matter is the canonical database and
`discover`/`validate` hard-fail on any load or parse error, one truncated ticket
wedges the whole board — including unrelated parallel tickets.

Fix direction (per the ticket): write the full content to a sibling temp file, then
`rename()` it over the destination so readers only ever see a complete file. Extract
a single `writeTicketFile` helper and route every full-file ticket write through it.
`install.mjs:396-398` already uses this temp-write-then-rename pattern for
`settings.json`; this generalizes it.

## Implementation Approach

Add a private helper in `src/tickets.js`:

```js
async function writeTicketFile(targetPath, content) {
  const dir = path.dirname(targetPath);
  const tmpPath = path.join(dir, `.${path.basename(targetPath)}.tmp-${process.pid}-${nextTmpSeq()}`);
  try {
    await writeFile(tmpPath, content, "utf8");
    await renameWithRetry(tmpPath, targetPath);
  } catch (err) {
    // best-effort cleanup of the orphaned temp file
    await rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}
```

Key points:

- **Same-directory temp.** The temp file must live in the same directory as the
  target so `rename()` is a same-volume atomic metadata swap (a cross-volume rename
  degrades to copy+unlink and loses atomicity). Every current write target is the
  ticket's own folder, so `path.dirname(targetPath)` is correct.
- **Unique temp name that discovery ignores.** `process.pid` alone is not unique
  within a process: `linkParent`/`blockTicket` and any future concurrency can issue
  overlapping writes. Add a monotonic per-process counter (`nextTmpSeq()`) so two
  in-flight writes never collide on the same temp path. Critically, the temp name
  must **not end in `.md`**: discovery at `src/tickets.js:142` collects every file
  where `entry.name.endsWith(".md")`, so a `foo.tmp-123.md` name would be picked up
  and then fail `TICKET_FILE_RE` (line 103) or the loader — reintroducing the exact
  hard-fail this ticket prevents. Use a suffix *after* the extension:
  `${basename}.tmp-${pid}-${seq}` (e.g. `T....md.tmp-4821-3`), which does not end in
  `.md` and is therefore invisible to discovery. Confirmed against the current
  `readdir` filter.
- **Bounded rename retry (`renameWithRetry`).** On Windows, `fs.rename` replaces an
  existing destination file for files (unlike POSIX where it is atomic and unlike
  Windows *directory* renames), but it can throw `EPERM`/`EBUSY`/`EACCES` under
  transient antivirus, Search Indexer, or editor file-handle contention. Wrap the
  rename in a bounded retry: e.g. up to ~5 attempts with short backoff
  (10/20/40/80 ms) retrying only on `EPERM`/`EACCES`/`EBUSY`, rethrowing anything
  else and the final failure. On final failure the temp file is cleaned up and the
  original destination is left untouched and intact — which is the whole point.
- **Route all sites through it.** Replace the seven direct writes:
  - `moveTicket` — line 310 (`writeFile(ticket.path, content, ...)`)
  - `setTicketField` — line 367
  - `appendTicketComment` — line 379
  - `setTicketSection` — line 387
  - `approveInline` — line 444
  - `completeStep` — line 490
  - `writeTicketUpdate` helper — line 1400 (covers `linkParent`, `unlinkParent`,
    `blockTicket`, `unblockTicket` at lines 501-560)

  Simplest consolidation: have `writeTicketUpdate` call `writeTicketFile`, and
  change the six inline call sites to `await writeTicketFile(ticket.path, <content>)`.

- **moveTicket boundary.** This ticket makes only the *in-place full-file write*
  (line 310) atomic. `moveTicket` then does a separate cross-folder `rename`
  (lines 312-314) to relocate the file into the new status folder; the
  write-before-rename ordering hazard there is explicitly **out of scope** and owned
  by B20260707T1318Z. Do not change move ordering here — just swap the line-310
  write for the atomic helper.

## Affected Files / Modules

- `src/tickets.js` — add `writeTicketFile` + `renameWithRetry` (+ temp-seq counter);
  reroute the seven write sites. `rename` is already imported from
  `node:fs/promises`; add `rm` (and keep `writeFile`) to the import at line 1.
- `test/tickets.test.js` — new atomicity/failure tests.
- No production behavior change to rendered content, paths, or return values;
  callers and the CLI surface are untouched.

## Related Tickets and Conflicts

All three bugs touch the same write paths in `src/tickets.js`. Sequencing matters:

- **B20260707T1317Z (this ticket)** lands the shared `writeTicketFile` helper. It is
  the foundation; `blocks: [B20260707T1318Z]` and B1318 lists it in `blockedBy`.
- **B20260707T1318Z (moveTicket ordering)** builds on this helper. It fixes the
  write-new-status-then-rename ordering so a failed cross-folder move cannot strand
  a ticket at the wrong path/status. It should consume `writeTicketFile` for its
  in-place rewrites. Keep this ticket's change minimal at the move site to avoid a
  merge conflict — do not pre-empt B1318's ordering redesign.
- **B20260707T1322Z (concurrency locking)** is a superset concern: atomic single-file
  writes (this ticket) prevent *torn* files but not *lost updates* between two racing
  read-modify-write cycles, and do not make the two-file `linkParent`/`blockTicket`
  writes mutually atomic. Design the temp-name scheme (unique per write) so it does
  not obstruct a later per-ticket lockfile. Note explicitly in Implementation Notes
  that atomicity != mutual exclusion; B1322 remains open after this lands.

## Risks

- **Discovery picking up temp files.** Discovery (`src/tickets.js:142`) collects any
  file whose name ends in `.md`. An orphaned temp file that ends in `.md` would be
  parsed as a ticket and re-trigger the very hard-fail this ticket prevents.
  Mitigated by the `...md.tmp-<pid>-<seq>` naming above, which does not end in `.md`.
  This is the highest-risk detail and is now resolved by construction.
- **Windows rename contention (`EPERM`/`EBUSY`).** Handled by bounded retry; residual
  risk is a genuinely locked destination (editor holding the ticket open), where the
  write now fails cleanly instead of corrupting — an acceptable, strictly-better
  outcome. Ensure the retry does not busy-spin unbounded.
- **Orphaned temp files after a hard crash.** A crash *between* temp-write and rename
  leaves a `.tmp-*` file. It never overwrites the canonical file, so the board stays
  valid, but litter accumulates. Cleanup on the caught-error path is best-effort;
  crash-orphaned temps are only removable opportunistically (optional: sweep stale
  `.tmp-*` siblings during discovery — likely defer, note as follow-up).
- **Durability vs atomicity.** `rename` gives crash-*consistency* (reader sees old or
  new, never torn) but not `fsync` durability; after a power loss the rename may not
  be flushed. Full `fsync(file)` + `fsync(dir)` is heavier and cross-platform-fussy;
  recommend scoping to atomicity only (matches the install.mjs precedent and the
  ticket's acceptance) and noting the durability limitation.
- **Extra file op per write.** One additional create+rename per mutation. Negligible
  for interactive CLI volume.

## Test Strategy

Follow the existing `withBoard`/`mkdtemp` harness in `test/tickets.test.js`.

1. **Original survives a partial/failed write (core acceptance).** Create a ticket,
   capture its content, then drive a mutation whose write fails. Simplest injection:
   temporarily make the target directory/file such that `rename` fails (e.g. stub or
   monkeypatch the rename to throw, or point at a path that forces failure), assert
   the mutation rejects AND the on-disk canonical file is byte-identical to the
   original — proving no truncation. If direct injection is awkward, factor
   `writeTicketFile` to accept an injectable rename for the test, or assert via a
   temp file left behind that the real file is untouched.
2. **No torn read / temp isolation.** After a normal successful mutation, assert the
   folder contains exactly the expected `.md` file and no leftover `.tmp-*` file, and
   that `discover` returns zero `loadErrors`.
3. **Temp file does not become a phantom ticket.** Manually drop a `foo.md.tmp-123`
   sibling into a ticket folder and assert `discover`/`validate` ignore it (guards
   the discovery-glob risk).
4. **Round-trip integrity.** Existing mutation tests (moveTicket, setTicketSection,
   completeStep, linkParent) must still pass unchanged — content and return paths
   identical.
5. Optionally, a rename-retry unit test: force the first rename attempt to throw
   `EPERM` then succeed, assert the write completes.

Run: `node --test` (whole suite) and target `test/tickets.test.js`.

## Documentation Updates

- `memory-bank/systemPatterns.md` — record the atomic-write invariant: all canonical
  ticket writes go through `writeTicketFile` (temp-write + rename), never a bare
  `writeFile` to a live ticket path. Keep it terse.
- No `docs/` or README index change required (internal invariant, no new doc file).

## Open Questions

None blocking. The one detail that mattered — the discovery match pattern — is
resolved: `src/tickets.js:142` filters on `endsWith(".md")`, so the `.md.tmp-<pid>-<seq>`
temp naming is safe by construction. Everything else is a mechanical reroute of seven
write sites through the new helper.

## Implementation Notes

Added a shared `writeTicketFile` helper in `src/tickets.js` and routed all seven
full-file ticket write sites through it, per the approved design.

**`src/tickets.js`**
- Import: added `rm` to the `node:fs/promises` import (kept `writeFile`/`rename`).
- New: per-process monotonic `nextTmpSeq()` counter, `renameWithRetry()` (bounded
  retry: up to 5 attempts, 10/20/40/80ms backoff, retrying only
  `EPERM`/`EBUSY`/`EACCES`, rethrowing anything else and the final failure), and
  exported `writeTicketFile(targetPath, content, options)`. Temp path is
  `<dir>/.<basename>.tmp-<pid>-<seq>` — same directory as the target (so rename is
  a same-volume atomic metadata swap) and deliberately does not end in `.md`, so
  `discover()`'s `endsWith(".md")` filter never picks it up. On any failure
  (write or rename) the temp file is best-effort cleaned up (`rm(..., { force:
  true })`) and the original error is rethrown; the canonical file is never
  touched until the rename succeeds. `options.renameFn` is a test-only injection
  point (defaults to the real `rename`); no production call site passes it.
- Rerouted all seven direct `writeFile(ticket.path, ...)` calls to
  `writeTicketFile(ticket.path, ...)`: `moveTicket` (in-place rewrite only — the
  separate cross-folder `rename` at lines 312-314 is untouched, per the design's
  explicit boundary with B20260707T1318Z), `setTicketField`, `appendTicketComment`,
  `setTicketSection`, `approveInline`, `completeStep`, and the `writeTicketUpdate`
  helper (covers `linkParent`/`unlinkParent`/`blockTicket`/`unblockTicket`).
  `createTicket`'s exclusive (`wx`) new-file write is untouched — out of scope,
  it never overwrites an existing canonical file.

**`test/tickets.test.js`**
- Added `writeTicketFile` to the imports from `../src/tickets.js`, and `readdir`/
  `rename` to the `node:fs/promises` import.
- Four new tests:
  1. `writeTicketFile leaves the original file byte-identical when the rename
     fails` — injects a `renameFn` throwing `ENOSPC`; asserts the promise rejects,
     the target file is unchanged, and no temp file remains in the directory.
  2. `writeTicketFile retries the rename after a transient Windows error` —
     injects a `renameFn` that throws `EPERM` once then delegates to the real
     `rename`; asserts it took exactly 2 attempts and the content updated.
  3. `successful ticket mutations leave no temp files and discover reports zero
     load errors` — runs `setTicketSection`, `appendTicketComment`, and
     `completeStep` back to back, then asserts the ticket folder contains exactly
     the one `.md` file and `discover()` has zero `loadErrors`.
  4. `an orphaned non-.md temp sibling is invisible to discover and validate` —
     manually drops a `<ticket>.md.tmp-99999-1` file next to a real ticket and
     asserts `discover`/`validate` ignore it entirely.

**Memory bank**
- `memory-bank/systemPatterns.md`: added a terse "Atomic Writes" section recording
  the `writeTicketFile` invariant and explicitly noting it is crash-consistency,
  not mutual exclusion or fsync durability (B20260707T1318Z and B20260707T1322Z
  remain separately open).

**Deviations from design:** none. Scope held to atomicity only — no locking, no
change to `moveTicket`'s cross-folder rename ordering.

**Test results:**
- `npm run check`: pass (all `node --check` targets clean).
- `npm test`: 139/139 pass, 0 fail (135 pre-existing + 4 new).
- `npm run validate`: `Ticket validation OK`.

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-07T13:48:59Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus) wrote Technical Design: shared writeTicketFile temp-write-then-rename helper covering all seven write sites, non-.md temp naming to protect discovery, bounded Windows rename retry, failure-injection test strategy. Estimate 4 (bootstrap).

- 2026-07-07T13:50:04Z: Ensured git branch local-board/B20260707T1317Z-ticket-writes-are-not-atomic-crash-mid-write-corrupts-canonical-board-file (created).
