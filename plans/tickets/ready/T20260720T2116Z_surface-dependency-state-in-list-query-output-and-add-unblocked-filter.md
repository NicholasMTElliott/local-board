---
id: T20260720T2116Z
type: task
status: ready_for_design
priority: P1
parent: null
children: []
blockedBy: []
blocks: [T20260720T2118Z]
branch: local-board/T20260720T2116Z-surface-dependency-state-in-list-query-output-and-add-unblocked-filter
estimate: 2
estimateBasis: T20260711T2137Z
workStartedAt: null
workCompletedAt: null
created: 2026-07-20T21:16:01Z
updated: 2026-07-20T22:12:53Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "design-review:codex-task:read-only@gpt-5.6-sol"]
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

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-20T22:06:14Z: Completed design via claude-subagent:local-board-designer@opus: Technical Design written: shared openBlockers helper reused by eligibility; additive blockedBy/blockedByOpen/parent/children/blocks on both record shapes; --unblocked composes with --status, rejected with --ready; test matrix incl. missing-dep and additivity guard

- 2026-07-20T22:06:59Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: none (no security/UI/UX triggers; additive CLI JSON fields)

- 2026-07-20T22:12:53Z: Recorded design review via codex-task:read-only@gpt-5.6-sol: CONCERNS: design sound; Medium - commandGateCheck/commandDesignReviewCheck/commandSpecialtyRun destructure only {ticket}, so board/byId not in scope as design claims; implementer must bind board+byTicketId or leave those legacy. Rest verified: openBlockers semantics, filter-before-limit, --ready rejection, additivity, test plan
