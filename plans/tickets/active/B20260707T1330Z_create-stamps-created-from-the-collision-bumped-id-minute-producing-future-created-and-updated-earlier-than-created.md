---
id: B20260707T1330Z
type: bug
status: implementing
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/B20260707T1330Z-create-stamps-created-from-the-collision-bumped-id-minute-producing-future-created-and-updated-earlier-than-created
estimate: 2
estimateBasis: B20260707T1326Z
workStartedAt: 2026-07-08T02:30:59Z
workCompletedAt: null
created: 2026-07-07T13:30:06Z
updated: 2026-07-08T02:35:14Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
routingApprovals: []
---
# create stamps created from the collision-bumped ID minute, producing future created and updated earlier than created

## Requirement

When `create` bumps the ID minute to avoid a collision (sequential creates in the same minute), it stamps `created` from the bumped ID timestamp rather than the actual wall clock. A ticket minted at 13:17 real time can carry `created: 13:40`, and a `section`/`block` mutation moments later stamps `updated` with real time — producing `updated` earlier than `created` and `created` timestamps in the future. Observed on 22 of the 34 tickets created on 2026-07-07 (e.g. T20260707T1340Z: created 13:40:06, updated 13:23:42). Confuses chronology-based tooling like done-ticket retention (`retention.archiveDoneAfterDays` compares `updated`).

Fix: keep the bumped minute for the ID (uniqueness), but stamp `created`/`updated` from the actual clock. Alternatively clamp `updated` to be >= `created` on every mutation. Ensure test-mode `now` injection still produces deterministic values.

Acceptance: sequential same-minute creates yield unique IDs with truthful `created` timestamps; `updated` is never earlier than `created`; a regression test covers the collision-bump path.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Summary

`createTicket` mints the ID from a timestamp that is deliberately shifted into the future for uniqueness (worktree mint-offset plus same-minute collision bumping), then reuses that same shifted timestamp to stamp `created`/`updated`. The ID must carry the bumped minute; the timestamps must not. Fix: decouple minting from stamping — the ID keeps the bumped minute, but `created`/`updated` are stamped from the real wall clock (`now`).

## Root cause (current lines, `src/tickets.js`)

`createTicket` (from line 1774):

- 1778: `const now = options.now ?? new Date();` — the truthful wall clock.
- 1800: `const offsetMinutes = options.now === undefined ? await ticketWorktreeMintOffsetMinutes(root) : 0;` — per-worktree future shift (index in the registered-worktree list) to keep parallel worktrees from colliding on IDs. Zero whenever `now` is injected (tests).
- 1801: `const start = offsetMinutes > 0 ? new Date(now.getTime() + offsetMinutes * 60_000) : now;` — `start` is `now` pushed into the future by the offset.
- 1802: `const timestamp = nextAvailableTimestamp(board, ticketType, start);` — walks forward in 60s steps past any already-used ID minute (the collision bump). `timestamp >= start >= now`, and can be minutes in the future.
- 1803: `const ticketId = ...formatTicketTimestamp(timestamp)...` — correct use of the bumped minute; uniqueness lives here.
- **1807: `const created = formatIsoSeconds(timestamp);`** — the bug. `created` is stamped from the fabricated future minute instead of `now`.
- 1810–1811 / `renderTicket` line 1850–1851: `created:` and `updated:` are both emitted from that one `created` value, so the initial `updated` is future too.
- **1816: `await linkParent(root, ticketId, parent, { now: timestamp });`** — the same future `timestamp` is propagated as the `updated` stamp on both the child and the parent (linkParent stamps `updated: formatIsoSeconds(now)` on each side). Second locus of the same bug.

Consequence: a ticket minted at 13:17 real time under offset/collision can carry `created: 13:40`. A later `section`/`complete-step` mutation calls `withUpdated(frontMatter, new Date())` (line 2171) with the real clock, producing `updated: 13:23` — i.e. `updated < created` and a future `created`. Observed on 22 of 34 tickets minted 2026-07-07. `archiveDoneTickets` (line 784) compares `updated` against a cutoff, and selection ordering (`compareTicketsForSelection`/`compareTicketsForConfig`, lines 1747–1762) orders by `created`, so both are fed wrong chronology.

## Approach (primary fix: decouple ID from stamps)

In `createTicket`:

1. Line 1807 — stamp from the real clock: `const created = formatIsoSeconds(now);`. The ID (line 1803) is untouched and keeps the bumped minute, preserving uniqueness.
2. Line 1816 — propagate the real clock to the reciprocal link: `await linkParent(root, ticketId, parent, { now });`. This keeps the child's and parent's `updated` truthful and equal to the child's `created`.

That is the whole production change: two edits, both narrowing an over-broad reuse of `timestamp`. No signature, config, or schema change.

### Why `now` and not `start`

`start`/`timestamp` are artefacts of ID spacing (worktree index + collision walk), not creation events. The truthful creation instant is `now`. Under a worktree offset the ID minute is *supposed* to lead the wall clock; only the ID should carry that lead. `created`/`updated` therefore bind to `now`.

### Test-mode `now` injection stays deterministic

When `options.now` is supplied, `offsetMinutes` is forced to 0 (line 1800) and `start === now`. `nextAvailableTimestamp` can still bump the ID minute for a fixture same-minute collision, but after the fix `created`/`updated` bind to the injected `now` regardless of any bump. This is strictly *more* deterministic than today: injected-now creates always yield `created == updated == injectedNow`, with the ID being the only thing that advances. Existing tests assert only on filenames/IDs for the collision case (`test/tickets.test.js:84` "create advances timestamp to keep ticket ids unique" checks `first`→`...2056Z`, `second`→`...2057Z`), so none break.

## Consumers checked for an id-minute == created assumption

- Selection ordering `compareTicketsForSelection` / `compareTicketsForConfig` (1747–1762): order by `parseDate(frontMatter.created)`, tie-break `id.localeCompare`. Post-fix `created` is truthful; two same-minute creates may now share an identical `created`, but the id tie-break (which uses the bumped minute) keeps ordering total and deterministic. No regression.
- Retention `archiveDoneTickets` (765–796): reads `updated` only. Fixed at the source once `updated` is truthful.
- ID parsing: nothing parses a ticket ID back into a `Date`. `TICKET_ID_RE` (400) and `formatTicketTimestamp` (2263) are shape-only. Worktree mint offset (`ticketWorktreeMintOffsetMinutes`, `src/worktrees.js:267`) derives from registered-worktree order and `nextAvailableTimestamp` derives from used IDs — neither reads `created`. Decoupling is safe.
- `validate`/`validateTicketShape` (1255+, 1307–1311): only checks `created`/`updated` parse as ISO-8601; imposes no `updated >= created` relation today.

## Decision on the clamp alternative — rejected as masking

The ticket floats clamping `updated = max(now, created)` on every mutation as belt-and-braces. Rejected:

- The decouple fix removes the *source* of future `created`, so going forward `updated < created` cannot arise from this path; a clamp guards nothing real.
- It is actively harmful to the already-broken tickets: with a future `created` (e.g. 13:40) still on disk, a clamp would force every subsequent `updated` up to `>= 13:40`, pinning `updated` in the future and defeating retention (which needs `updated` to age past the cutoff). The current behaviour — real-clock `updated` — is what lets those tickets self-heal once the wall clock passes the fabricated minute.
- It changes the meaning of `updated` from "wall-clock time of last mutation" to "max(...)", eroding the field's usefulness for chronology tooling.

If a future guard is ever wanted, the right shape is a *validation warning* (`updated < created`), not a silent clamp — but see below for why we do not add that now either.

## Decision on existing artefacts and validation — leave history, add no new rule

- No migration. The 22 affected tickets keep their front matter. Per the standing rule, done tickets' history is never rewritten; the same restraint applies to the in-flight (review) tickets. The fabricated `created` minutes are only ~15–25 min ahead of real time, so once the wall clock passes them any natural mutation re-stamps `updated` correctly and the `updated < created` inversion disappears on its own; the slightly-future `created` remains as harmless history.
- Do **not** add an `updated >= created` invariant to `validateTicketShape`. `beginStep` (915) runs full-board `validate` and throws on any issue, so a new invariant would make the whole board un-actionable until the 22 legacy tickets were hand-edited — exactly the migration we are declining. Note this explicitly so a reviewer does not "helpfully" add the check.

## Affected files

- `src/tickets.js` — `createTicket`: line 1807 (`created` binds to `now`) and line 1816 (`linkParent({ now })`). Production change, ~2 lines.
- `test/tickets.test.js` — new regression test(s); no existing test edits expected.

## Test strategy

Add to `test/tickets.test.js` (all with injected `now` for determinism):

1. Collision-bump truthfulness: create two same-minute tickets with the same injected `now` (mirrors the existing line-84 test). Assert the second ID advances a minute **and** that the second ticket's `created` **and** `updated` both equal the injected `now` (not the bumped minute), and that `updated >= created`. This is the direct regression guard for the reported bug.
2. Parent link propagation: create a parent, then a child whose minute collides so its ID bumps, passing an injected `now`. Assert child `created == updated == now`, and the parent's `updated == now` (proves the line-1816 `{ now }` change), with `updated >= created` on both.
3. Keep/confirm the existing "create advances timestamp to keep ticket ids unique" test green (uniqueness unchanged).

Optionally assert `parseDate(updated) >= parseDate(created)` as an inline invariant in the new cases. Run the full `node --test` suite to confirm no ordering/retention test regressed.

## Risks

- Low blast radius (two lines), but the change touches the hot create path; the regression tests above pin both the ID-uniqueness and the timestamp-truthfulness halves so they cannot regress independently.
- Same-minute creates now share an identical `created`; verified the id tie-break keeps selection ordering total (no flakiness).
- Behavioural note for operators: under a worktree mint offset the ID minute intentionally leads `created`. That is now the *expected* invariant (ID minute >= created), not a bug — worth a one-line note in the mint-offset docs if any exist.

## Documentation impact

Minimal. If worktree mint-offset / ID-minting behaviour is described in `memory-bank/systemPatterns.md` or `docs/`, add one line: the ID timestamp may lead `created`; `created`/`updated` always track the real wall clock. No README index change (no new doc file).

## Open questions

None blocking. Proceeding on: primary decouple fix only; no clamp; no migration; no new validation invariant.

## Implementation Notes

Implemented the two-line decouple exactly per the Technical Design: no deviations.

- `src/tickets.js` `createTicket`: `created` now binds to `formatIsoSeconds(now)` instead of `formatIsoSeconds(timestamp)` (line ~1807). The ID (`ticketId`, built from `timestamp`) is untouched and keeps the worktree-offset/collision-bumped minute.
- `src/tickets.js` `createTicket`: `linkParent(root, ticketId, parent, { now: timestamp })` changed to `{ now }` (line ~1816), so the reciprocal parent `updated` stamp is also truthful wall-clock time, not the bumped minute.
- No clamp, no migration, no new validation invariant added, per the design's explicit rejection of those alternatives.

Tests added to `test/tickets.test.js` (after the existing "create advances timestamp to keep ticket ids unique" test):
- "collision-bumped id keeps a truthful created/updated stamp, not the bumped minute" — two same-`now` sequential creates; asserts the second id bumps a minute (`S...2057Z`) while `created`/`updated` both equal the injected `now` (`2026-05-14T20:56:00Z`), and `updated >= created`.
- "create with parent propagates truthful now through linkParent on collision-bumped ids" — parent and child both typed `story` (same id prefix) so the child's mint collides with the parent's minute and bumps; asserts child `created == updated == now`, parent `updated == now`, and `updated >= created` on both sides.

Existing test at test/tickets.test.js:84 ("create advances timestamp...") required no changes — it only asserted filenames/IDs, which are unaffected by this fix (uniqueness logic is untouched).

Verification:
- `npm run check`: clean (all `node --check` syntax checks pass).
- `npm test`: 365 tests, 364 pass, 0 fail, 1 skipped (pre-existing "smoke (slow)" skip, unrelated).
- `npm run validate`: "Ticket validation OK".
- Live check on a throwaway `--root` board (init, create twice in immediate succession): first ticket `S20260708T0234Z` with `created`/`updated` = `2026-07-08T02:34:40Z`; second ticket `S20260708T0235Z` (id minute bumped to `35`) with `created`/`updated` = `2026-07-08T02:34:41Z` — id minute (35) != created minute (34), and created is truthful wall-clock time, not a fabricated future minute. Throwaway board removed after the check.

Risks: none beyond what the design already flagged (hot path, two-line change, pinned by two new regression tests covering both the uniqueness half and the timestamp-truthfulness half independently).

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-08T02:30:10Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): two-line decouple — ID keeps the bumped/offset minute, created/updated bind to real now (linkParent threaded); clamp rejected as masking; no migration (legacy artifacts self-heal as the clock passes); injected-now determinism preserved. Estimate 2 (basis B20260707T1326Z).

- 2026-07-08T02:30:58Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (timestamp hygiene)

- 2026-07-08T02:30:59Z: Ensured git branch local-board/B20260707T1330Z-create-stamps-created-from-the-collision-bumped-id-minute-producing-future-created-and-updated-earlier-than-created (created).
