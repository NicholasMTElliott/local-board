---
id: T20260720T2116Z
type: task
status: ready_for_test
priority: P1
parent: null
children: []
blockedBy: []
blocks: [T20260720T2118Z]
branch: local-board/T20260720T2116Z-surface-dependency-state-in-list-query-output-and-add-unblocked-filter
estimate: 2
estimateBasis: T20260711T2137Z
workStartedAt: 2026-07-20T22:13:03Z
workCompletedAt: null
created: 2026-07-20T21:16:01Z
updated: 2026-07-20T23:05:34Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "design-review:codex-task:read-only@gpt-5.6-sol", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", "review:codex-task:read-only@gpt-5.6-terra", "test:claude-subagent:local-board-tester@sonnet"]
routingApprovals: []
---
# Surface dependency state in list/query output and add --unblocked filter

## Requirement

### Problem

Eligibility is dependency-aware internally (`isEligibleForConfig` walks `blockedBy`), but no query output exposes dependency state. `actionRecord` (`query-next`, `query-ticket`, `list --ready`) and `ticketRecord` (plain `list`) omit `blockedBy`/`blocks`/`parent`/`children` entirely. A ticket shows `eligible: false` with no visible reason. In a 2026-07-20 `local-team` run against an all-backlog board, the orchestrator grepped 47 ticket files and hand-built the dependency graph to find unblocked work.

### Requirement

1. Add dependency fields to both record shapes (`actionRecord` and `ticketRecord`):
   - `blockedBy`: the ticket's declared dependency ids (as authored);
   - `blockedByOpen`: the subset whose dependency is missing or not in a closed status (`done`/`archived`) — the reason a ticket is ineligible;
   - `parent`, `children`, `blocks`: pass through from front matter.
2. Add an `--unblocked` flag to `list`, composable with the existing `--status <status>` option, so dependency analysis works for ANY status — e.g. `list --status backlog --unblocked --json` (promotion candidates), `list --status questions --unblocked --json`. `--unblocked` keeps tickets whose `blockedByOpen` is empty. Deliberately reuse `--status` rather than adding a hard-coded `--backlog` or new `--state` flag.
3. `--unblocked` combined with `--ready` is either redundant-but-accepted or rejected with a clear message — pick one and test it.
4. Update the `list` usage line and the local-team skill's CLI reference (`SKILL_TEAM.md` + codex mirror) where `list` is documented.

### Acceptance Criteria

- `list --status backlog --unblocked --json` returns exactly the backlog tickets whose every `blockedBy` entry is closed, each record carrying `blockedBy` and `blockedByOpen`.
- `query-ticket <id> --json` for a dependency-blocked ticket shows non-empty `blockedByOpen` explaining `eligible: false`.
- Existing consumers are not broken: added fields are additive; `list --ready` output retains all current fields.
- Tests cover: open vs closed dependencies, missing dependency id (counts as open), `--unblocked` with and without `--status`.
- Full suite (`node --test`) green.

## Acceptance Criteria

## Related Tickets

## Technical Design

Surface dependency state in `actionRecord` and `ticketRecord`, and add a `--unblocked`
filter to `list` that composes with `--status`. The work is additive and localized to
`src/tickets.js` (two record shapes + one shared helper) and `src/cli.js` (`commandList`,
`readyListJsonRecord`, usage text), plus doc touch-ups.

### Related tickets and conflicts

- `blocks: [T20260720T2118Z]` — this ticket blocks the "never self-promote / hard-stop with
  state-report" skill-policy ticket, which consumes the dependency visibility added here.
- Sibling `T20260720T2117Z` (add a `promote` command). No code conflict: the requirement
  deliberately reuses `--status` for promotion-candidate discovery rather than adding a
  `--backlog`/`--state` flag, so `list --status backlog --unblocked --json` is the promotion
  input and `promote` is a separate command. Keep them independent.
- No conflict with existing eligibility logic; this exposes it, it does not change it.

### Shared helper: open blockers (single source of truth)

Extract the exact dependency walk that `isEligible`/`isEligibleForConfig` already perform into
one pure helper in `src/tickets.js`, so `blockedByOpen` and `eligible` can never drift:

```js
// Returns the subset of a ticket's declared blockedBy ids whose dependency is
// missing from the board OR not in a closed status (done/archived) -- exactly
// the ids that make the ticket ineligible.
function openBlockers(ticket, byId) {
  return asList(ticket.frontMatter.blockedBy).filter((id) => {
    const dep = byId.get(id);
    return dep === undefined || !isClosedStatus(dep.status);
  });
}
```

Refactor `isEligibleForConfig` (and, for parity, `isEligible`) to reuse it: keep the existing
status-gate check, then `return openBlockers(ticket, byId).length === 0;`. This is behavior-
preserving (same predicate, same closed-set) and guarantees `blockedByOpen === []` iff the
dependency portion of eligibility passes.

### Record shape additions

Add the same five fields to both shapes. Values come straight from front matter via the
existing `asList` helper (already filters empties) and `?? null` for `parent`.

`actionRecord(root, ticket, config, byId)` (already receives `byId`) gains:

```js
parent: ticket.frontMatter.parent ?? null,
children: asList(ticket.frontMatter.children),
blocks: asList(ticket.frontMatter.blocks),
blockedBy: asList(ticket.frontMatter.blockedBy),
blockedByOpen: openBlockers(ticket, byId),
```

Because `query-next`/`query-ticket` print `actionRecord` directly, this satisfies acceptance
criterion 2 with no CLI change: a dependency-blocked ticket shows a non-empty `blockedByOpen`
alongside `eligible: false`.

`ticketRecord` currently has signature `(root, ticket)` and no board context. Change it to
`ticketRecord(root, ticket, byId = new Map())` and append the same five fields (using
`openBlockers(ticket, byId)`). Keeping `byId` defaulted avoids a hard breakage, but every
call site should pass a real map so `blockedByOpen` is correct:

- `commandList` plain branch: build `byId = byTicketId(board)` from the discovered board and
  pass it.
- The incidental callers at cli.js ~367 (`commandNext`) and ~1291/~1458/~1612 (gate-check /
  design-review context builders) only read `id/type/status/priority/path/title`, so the new
  fields are harmless there; still, pass the `byId` from the `board` already in scope at each
  site so the record is internally consistent (with an empty-map default as the safety net).

### `--unblocked` flag on `list`

In `commandList`, take the new flag: `const unblocked = takeFlag(args, "--unblocked");`.

Semantics decision (requirement item 3): reject `--unblocked` combined with `--ready`. Do it
first, before the `--ready` branch, with a clear message and non-zero exit:

```txt
--unblocked cannot be combined with --ready; --ready already returns only
eligible (unblocked) tickets. Use --unblocked with --status <status> to inspect
other states, e.g. list --status backlog --unblocked --json.
```

Rationale: for `--ready` tickets `blockedByOpen` is always empty, so `--unblocked` is a pure
no-op there; the flag's entire purpose is dependency analysis over NON-ready statuses
(backlog, questions). A crisp rejection is deterministically testable and prevents a
confused invocation from looking meaningful. (Redundant-but-accepted was the alternative;
rejected for the clearer contract.)

Plain (non-`--ready`) branch becomes:

```js
const board = await discover(root);
const byId = byTicketId(board);
let records = board.tickets
  .filter((ticket) => status === undefined || ticket.status === status)
  .map((ticket) => ticketRecord(root, ticket, byId));
if (unblocked) {
  records = records.filter((record) => record.blockedByOpen.length === 0);
}
records = records.slice(0, limit ?? undefined);
```

Ordering matches the `--ready` path: status filter, then unblocked filter, then `--limit`
slice. `--unblocked` composes with `--status` (`list --status backlog --unblocked --json`)
and works alone (`list --unblocked --json` across all statuses).

Text (non-JSON) output keeps its current column format unchanged (additive fields surface in
`--json` only), so no existing scriptable output shifts. Note the plain `list` path
intentionally still uses `discover` without `validate` (current behavior) — `--unblocked`
does not add board-wide validation.

### `readyListJsonRecord` (keep `list --ready` additive)

`readyListJsonRecord` curates a subset of `actionRecord`, so the new fields must be added
there too or `list --ready --json` would silently drop them. Append `parent`, `children`,
`blocks`, `blockedBy`, `blockedByOpen` to the returned object while retaining every existing
field (`id/type/status/priority/branch/title/path/action`). For ready tickets `blockedByOpen`
is always `[]`; it is included for shape consistency across query surfaces.

### Usage line and docs (item 4)

- `src/cli.js` `USAGE_TEXT`: update the `list` line to
  `list [--status <status>] [--ready] [--unblocked] [--limit <N>] [--json]`.
- `SKILL_TEAM.md` and `skills/codex/local-team/SKILL.md`: update where `list` is documented
  (the `list --ready --limit ... --json` references) to mention `list --status <status>
  --unblocked --json` for dependency/promotion-candidate discovery. These two local-team
  texts are not byte-sync-tested against each other, but edit both to stay parallel.
- `list` does not appear in the `SKILL.md` / `skills/codex/local-board` "CLI Commands"
  fenced blocks, so the byte-identical CLI-block sync test (`test/skill-usage-sync.test.js`)
  is unaffected. `scripts/sync-resources.mjs` only mirrors `plans/prompts` + `plans/templates`,
  and no prompt/template is touched here, so `npm run sync-resources` is not required for this
  ticket.

### Test strategy

Extend `test/cli.test.js` (CLI end-to-end via the existing runner) and add unit coverage for
the record shapes. Cases:

- `actionRecord`/`query-ticket --json` on a ticket with an OPEN dependency (dep in a non-
  closed status, e.g. `ready_for_design`): `blockedByOpen` contains that id and `eligible`
  is `false`.
- Same ticket after the dependency reaches `done`/`archived` (CLOSED): `blockedByOpen` is
  `[]`.
- MISSING dependency id (no such ticket on the board): counts as open — present in
  `blockedByOpen`.
- `list --status backlog --unblocked --json`: returns exactly the backlog tickets whose every
  `blockedBy` entry is closed; each record carries `blockedBy` and `blockedByOpen`.
- `list --unblocked --json` with no `--status`: filters across all statuses by empty
  `blockedByOpen`.
- `list --ready --unblocked`: exits non-zero with the rejection message.
- Additivity guard: `list --ready --json` still carries all previously-asserted fields plus
  the new ones (compare against the current `readyListJsonRecord` field set).
- `parent`/`children`/`blocks` pass-through from front matter on both shapes.

Then run the FULL suite: `node --test` (green is an acceptance criterion). Because prompt/
agent text is not edited, only the standard suite is needed; no `sync-resources` step.

### Risks and edge cases

- `ticketRecord` signature change is the main blast radius. Mitigated by the defaulted `byId`
  parameter plus updating all five call sites; the non-list callers ignore the new fields.
- Duplicate ids: `byTicketId` keeps the last occurrence; irrelevant here since a validated
  board has unique ids and the plain-list path already tolerates un-validated boards.
- `blocks` is authored pass-through only — no reciprocity/consistency check is added (out of
  scope; `blocks` is informational in the record).
- Empty/absent front-matter arrays render as `[]` via `asList`; `parent` absent renders
  `null`. No new nullability surprises.
- Keep the `--ready` path's own `--status` filtering intact; only ADD the `--unblocked`
  rejection guard ahead of it.

### Open questions

None blocking. One minor call: rejection vs redundant-accept for `--ready --unblocked` — this
design picks rejection per the rationale above; flip to accept-and-no-op if the orchestrator
prefers leniency (single-branch change, test flips accordingly).

- 2026-07-20T22:12:53Z: Design review (codex gpt-5.6-sol, CONCERNS): commandGateCheck, commandDesignReviewCheck, and commandSpecialtyRun currently destructure only { ticket } from findTicket, so board/byId are NOT in scope there. Implementer: either bind const { board, ticket } and pass byTicketId(board), or leave those three context builders on legacy fields and note the scope revision. All other design claims verified against source.

## Implementation Notes

- Implemented per Technical Design: shared `openBlockers(ticket, byId)` helper in `src/tickets.js` (private, not exported) is now the single source of truth reused by `isEligible`/`isEligibleForConfig` and by `actionRecord`/`ticketRecord`'s new `blockedByOpen` field, so eligibility and dependency-state exposure cannot drift.
- `actionRecord` and `ticketRecord` both gained `parent`, `children`, `blocks`, `blockedBy`, `blockedByOpen` (additive; existing fields unchanged). `ticketRecord(root, ticket, byId = new Map())` took a new optional `byId` parameter; the empty-map default means an un-passed `byId` renders every `blockedBy` id as open (safety net only -- all real call sites now pass a real map).
- `readyListJsonRecord` (curated `list --ready --json` subset) got the same five fields appended, preserving every previously-asserted field (verified in the updated `list --ready` CLI test's `Object.keys` assertion).
- `--unblocked` flag added to `commandList` (`src/cli.js`), composable with `--status`. Combined with `--ready` it is rejected up front with a clear, non-zero-exit message naming `list --status backlog --unblocked --json` as the intended usage (chosen over redundant-accept per the Technical Design's stated rationale). Plain-list ordering: status filter -> unblocked filter -> `--limit` slice, matching the `--ready` path. Text (non-JSON) output format is unchanged; new fields surface in `--json` only.
- Design-review finding resolved (commandGateCheck/commandDesignReviewCheck/commandSpecialtyRun destructuring only `{ ticket }` from `findTicket`, leaving `board`/`byId` out of scope): chose to bind `const { board, ticket } = await findTicket(...)` in all three and pass `byTicketId(board)` into their `ticketRecord(...)` calls, rather than leaving them on legacy (id/type/status/priority/path/title-only) fields. This keeps the record internally consistent everywhere `ticketRecord` is called, at the cost of a one-line destructuring change per site; none of the three consume the new dependency fields today (their `ticketContext` only reads `id/type/status/priority/path/title`), so this is a low-risk, forward-looking consistency fix rather than a behavior change. `commandNext` (an incidental caller, not explicitly named in scope but trivially fixable since `board` was already in scope) was updated the same way for the same reason.
- `src/cli.js` `USAGE_TEXT` `list` line updated to `list [--status <status>] [--ready] [--unblocked] [--limit <N>] [--json]`.
- `SKILL_TEAM.md` and `skills/codex/local-team/SKILL.md`: added a sentence after the existing `list --ready --limit ... --json` preflight step pointing at `list --status <status> --unblocked --json` for promotion-candidate / dependency discovery outside the ready statuses. Not byte-sync-tested against each other for this line; both were edited in parallel by hand.
- No `plans/prompts` or `plans/templates` file was touched, so `npm run sync-resources` was not required (confirmed by a clean full-suite run including `test/resources-sync.test.js` and `test/skill-usage-sync.test.js`).

Tests added (test/cli.test.js):
- Updated the existing `list --ready` test's `Object.keys` assertion to include the five new additive fields, plus an explicit check that a ready ticket's `blockedByOpen` is always `[]`.
- New: `query-ticket --json surfaces blockedByOpen for an open dependency and clears it once the dependency closes` -- same ticket, open (non-closed) dependency then archived, using reciprocal `blockedBy`/`blocks` front matter since `query-ticket` runs `validate()` first (which enforces link reciprocity and dependency existence).
- New: `list (plain, unvalidated) --json counts a missing dependency id as open, alongside a closed and a still-open dependency` -- deliberately uses plain `list` (not `--ready`/`query-ticket`) because only the plain list path skips `validate()`, so a dangling `blockedBy` reference is legal there (per the Technical Design's noted edge case) and is the only place a missing-dependency case can be exercised without also fabricating a matching ticket.
- New: `list --status backlog --unblocked --json returns exactly the backlog tickets whose every blockedBy entry is closed`.
- New: `list --unblocked --json with no --status filters unblocked tickets across every status`.
- New: `list --ready --unblocked is rejected with a clear, actionable, non-zero-exit message`.
- New: `list (plain) and query-ticket both pass through parent/children/blocks from front matter`.

Full suite: `node --test` -- 645 pass, 1 skipped (pre-existing `smoke (slow)` skip, unrelated), 0 fail.

No deviations from the Technical Design.

## Review Findings

Code review (codex gpt-5.6-terra, high effort): CONCERNS — implementation correct against acceptance criteria; one non-blocking finding.

1. [Low] test/cli.test.js:914 — the pass-through test verifies parent on the query-ticket/actionRecord shape but not non-empty children or blocks, despite the test-plan bullet requiring parent/children/blocks on both record shapes. Fix: also query the parent and blocker tickets and assert children: [childId] and blocks: [childId]. Resolution: addressed fix-forward in this stage; assertions added before the move to test.

Verification performed by reviewer:
- Read reviewer role, Memory Bank, ticket requirement/design/implementation notes, commit history, and the mainline...HEAD diff.
- Statically verified openBlockers preserves missing-id and done/archived closed-status semantics and is shared by both eligibility predicates and record shapes.
- Verified new JSON fields are appended without removing, renaming, or reordering existing fields.
- Verified --unblocked filters before limit, composes with --status, and rejects --ready with a non-zero error path.
- Searched all ticketRecord call sites: plain list, next, gate-check, design-review-check, and specialty-run each pass a real byTicketId(board) map; no production call uses the empty-map default.
- Reviewed added CLI tests and both local-team skill updates; skill text accurately describes the new flag.

## Test Evidence

verdict: pass

### Suite

`node --test` (run twice from `C:/Users/Nicho/Documents/local-board-worktrees/T20260720T2116Z`):

- Run 1: 646 tests, 644 pass, 1 fail, 1 skip. The failure was `worktree-add supports an explicit relative worktrees.location outside the repo` (test/worktrees.test.js:1154), erroring on `git -C C:\...\Temp\explicit-worktrees\T20260522T1506Z branch --show-current: fatal: not a git repository`. This is an unrelated worktree-fixture temp-dir test, not touched by this ticket's diff (tickets.js/cli.js record shapes and `--unblocked`).
- Re-ran `node --test test/worktrees.test.js` in isolation: 45/45 pass, including the flaky test.
- Re-ran full `node --test` again: 646 tests, 645 pass, 0 fail, 1 skip (the pre-existing `smoke (slow)` skip).

Conclusion: the failure was a transient flake (temp-directory/parallelism race in an unrelated worktree fixture), not a regression from this ticket. Confirmed green full-suite result: 645 pass / 0 fail / 1 skip, matching the Implementation Notes' reported counts.

### Acceptance criteria — CLI verification (real CLI, `node ./bin/local-board.js ...`)

1. `list --status backlog --unblocked --json`
   Result: `[]`, exit 0. This board has no tickets in `backlog` status, so the empty result is the expected empty-set behavior. Substituted the same scenario on `--status ready_for_design`:
   - `list --status ready_for_design --json` -> 2 tickets: T20260720T2118Z (blockedByOpen: [T20260720T2116Z, T20260720T2117Z]), T20260720T2117Z (blockedByOpen: []).
   - `list --status ready_for_design --unblocked --json` -> exactly [T20260720T2117Z].
   Confirms `--unblocked` keeps exactly the tickets whose `blockedByOpen` is empty, composed with `--status`, and each record carries `blockedBy`/`blockedByOpen`.

2. `query-ticket T20260720T2118Z --json`
   Result: `eligible: false`, `blockedBy: ["T20260720T2116Z","T20260720T2117Z"]`, `blockedByOpen: ["T20260720T2116Z","T20260720T2117Z"]` (both blockers open at test time). Non-empty `blockedByOpen` correctly explains `eligible: false`.

3. `list --ready --json` field retention
   2 ready tickets returned. `Object.keys` of a record: `id, type, status, priority, branch, title, path, action, parent, children, blocks, blockedBy, blockedByOpen` — all prior fields retained, plus the five new additive fields. `blockedByOpen` is `[]` for every ready record (ready tickets are eligible by definition).

4. `list --ready --unblocked` rejection
   Both with and without `--json`: exit code 2, stderr:
   `--unblocked cannot be combined with --ready; --ready already returns only eligible (unblocked) tickets. Use --unblocked with --status <status> to inspect other states, e.g. list --status backlog --unblocked --json.`
   Clear, non-zero-exit, matches the Technical Design's specified rejection text; behavior is `--json`-independent.

### Additional spot checks

- Usage line: `--help` shows `list [--status <status>] [--ready] [--unblocked] [--limit <N>] [--json]`.
- Pass-through: `query-ticket T20260720T2116Z --json` shows `parent: null`, `children: []`, `blocks: ["T20260720T2118Z"]`, `blockedBy: []` — front-matter pass-through on the actionRecord shape confirmed.
- Docs: `SKILL_TEAM.md:48` and `skills/codex/local-team/SKILL.md:28` both mention `list --status <status> --unblocked --json` for promotion/dependency-candidate discovery.

### Gaps / caveats

- Zero `backlog` tickets on this board, so the literal backlog acceptance command returns an empty array (correct); the filter's selection logic was demonstrated against `--status ready_for_design`, where it produced the expected exact subset.
- The one full-suite failure encountered was reproduced as a flake (unrelated worktree temp-dir test, passes in isolation and on rerun); not attributable to this ticket.
- No files were modified during testing; `git status --short` empty at end.

## Documentation Updates

## Questions

## Run Log

- 2026-07-20T22:06:14Z: Completed design via claude-subagent:local-board-designer@opus: Technical Design written: shared openBlockers helper reused by eligibility; additive blockedBy/blockedByOpen/parent/children/blocks on both record shapes; --unblocked composes with --status, rejected with --ready; test matrix incl. missing-dep and additivity guard

- 2026-07-20T22:06:59Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: none (no security/UI/UX triggers; additive CLI JSON fields)

- 2026-07-20T22:12:53Z: Recorded design review via codex-task:read-only@gpt-5.6-sol: CONCERNS: design sound; Medium - commandGateCheck/commandDesignReviewCheck/commandSpecialtyRun destructure only {ticket}, so board/byId not in scope as design claims; implementer must bind board+byTicketId or leave those legacy. Rest verified: openBlockers semantics, filter-before-limit, --ready rejection, additivity, test plan

- 2026-07-20T22:13:03Z: Ensured git branch local-board/T20260720T2116Z-surface-dependency-state-in-list-query-output-and-add-unblocked-filter (already-current).

- 2026-07-20T22:24:01Z: Completed implement via claude-subagent:local-board-implementer@sonnet: openBlockers helper + additive dependency fields on both record shapes; --unblocked flag with --ready rejection; board/byId bound at gate/design-review/specialty/next call sites (resolves review finding); 6 new tests; node --test 645 pass 0 fail; commit fcb6d7c

- 2026-07-20T22:24:53Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: none (no security/UI triggers; internal record fields + CLI flag)

- 2026-07-20T22:28:58Z: Completed review via codex-task:read-only@gpt-5.6-terra: CONCERNS: implementation correct vs acceptance criteria; 1 Low finding (children/blocks pass-through assertions missing) fixed forward in f899908, suite green 645/0; reviewer verified openBlockers semantics, additivity, --unblocked/--ready rejection, byId threading at all call sites

- 2026-07-20T23:05:34Z: Completed test via claude-subagent:local-board-tester@sonnet: PASS: full suite 645/0/1 (one unrelated worktree-fixture flake cleared on rerun+isolation); all 4 acceptance criteria verified end-to-end against real CLI incl. --unblocked exact-subset selection, blockedByOpen explaining eligible:false, additive --ready fields, --ready --unblocked exit-2 rejection
