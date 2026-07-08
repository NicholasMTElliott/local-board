---
id: T20260708T2016Z
type: task
status: implementing
priority: P3
parent: S20260516T1539Z
children: []
blockedBy: [T20260708T2015Z]
blocks: []
branch: local-board/T20260708T2016Z-add-comments-subcommand-to-list-and-filter-ticket-comments-with-json
estimate: 2
estimateBasis: T20260707T1338Z
workStartedAt: 2026-07-08T20:53:57Z
workCompletedAt: null
created: 2026-07-08T20:15:34Z
updated: 2026-07-08T20:59:06Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
routingApprovals: []
---
# Add comments subcommand to list and filter ticket comments with --json

## Requirement

Add a read-only `local-board comments <ticket> [--section <name>] [--marker key=value ...] [--json]` command in src/cli.js (register alongside the existing `comment` dispatch and add its usage line to the help block; note the skill command-block lockstep rule — SKILL.md and skills/codex/local-board/SKILL.md must be updated together if the curated block gains this command, guarded by test/skill-usage-sync.test.js).

It reads the ticket, walks each section, and parses every bullet comment line via the parser exported by T20260708T2015Z. `--section` filters to one section; each `--marker` requires that key present and equal (AND semantics). Human output groups records by section as `<ts> [markers] <body>`; `--json` emits an array of `{ ticket, section, timestamp, markers, body }`. Read-only: no locks, no writes; `state-report` shape untouched.

## Acceptance Criteria

- `comments <ticket>` lists all parsed comments grouped by section; unmarked comments appear with no marker segment.
- `--section <name>` restricts to that section; unknown section yields empty result, exit 0.
- `--marker step=x --marker outcome=PASS` returns only comments matching all supplied markers (AND).
- `--json` returns records with exactly `{ ticket, section, timestamp, markers, body }`; values match what T20260708T2015Z wrote.
- `state-report --json` output unchanged (regression assertion or explicit test note).
- `npm test` adds filter-by-marker and section-filter tests.

## Acceptance Criteria

## Related Tickets

## Technical Design

Read-only `comments` subcommand that lists and filters the parsed Run Log-style
bullet comments on one ticket, reusing the T20260708T2015Z parser surface
(`parseCommentLine`, `contentLines`) verbatim. No new parsing grammar, no locks,
no writes.

### Command shape

Register alongside `comment` in `main()`'s dispatch chain (src/cli.js, near the
existing `if (command === "comment")` block):

```
local-board [--root <path>] comments <ticket-id> [--section <name>] [--marker key=value ...] [--json]
```

`commandComments(root, args)` parses flags in the established order (flags first,
positional last) so a multi-word `--section` value is not swallowed as the id:

- `const asJson = takeFlag(args, "--json");`
- `const markerFlags = takeAllOptions(args, "--marker");`
- `const section = takeOption(args, "--section") ?? null;`
- `const ticketId = args.shift(); ensureNoArgs(args);`
- Missing id -> `throw new Error("comments requires: <ticket-id> [--section <name>] [--marker key=value ...] [--json]")` (exit 2 via main's catch).
- `const markers = parseMarkerFlags(markerFlags);` — REUSE the existing
  src/cli.js `parseMarkerFlags` unchanged. This gives the CLI `key=value` grammar,
  charset validation, the `=`->`:` intent, and duplicate-key rejection for free,
  and guarantees the filter keys/values are drawn from the exact same charset the
  writer used. A malformed `--marker` therefore fails identically to `comment`
  (exit 2, same messages) before any board read.

No `assertInvocationRootForTicket` call: that guard is only for mutations. This
command is read-only, matching `query-ticket`/`state-report`.

### Reader mechanics (new exported pure helper in src/tickets.js)

`contentLines` and `STANDARD_SECTIONS` are module-private, so the reader must
live in src/tickets.js and be exported. Add:

```
export function collectComments(ticket, { section = null, markers = [] } = {})
```

Single fence-aware pass over `contentLines(ticket.body)` (the same fence walker
`validateCommentMarkers` uses, so fenced example lines are skipped and never
mistaken for real comments):

1. Track the current section: when a yielded line matches `^## (.+?)\s*$`, set
   `currentSection` to the captured heading and continue. This enumerates every
   `## ` heading actually present (standard and any custom section), rather than
   iterating a fixed list — one pass, and unknown/absent sections simply never
   appear.
2. For every other non-fenced line, call `parseCommentLine(line)`. Keep the line
   only when `parsed.timestamp !== null` (that is exactly the set of well-formed
   `- <ts>: ...` bullet lines; prose, blank lines, and section placeholders are
   dropped). A comment appearing before any heading (should not happen in a valid
   ticket) has `currentSection === null` and is skipped.
3. Build a record `{ ticket: ticket.id, section: currentSection, timestamp:
   parsed.timestamp, markers: parsed.markers, body: parsed.body }`. `markers` is
   `parseCommentLine`'s ordered `[{ key, value }]` (empty array for unmarked
   comments) — the same value T20260708T2015Z round-trips.

Filtering, applied to the collected records:

- `--section <name>`: keep records whose `section === name` (exact string match
  against the heading text, e.g. `Run Log`, `Technical Design`). An unknown
  section matches nothing -> empty array. No error, exit 0.
- `--marker` (AND, exact equality): keep a record only if, for every requested
  `{ key, value }`, the record has some marker with the same `key` AND the same
  `value`. Presence-of-key-with-equal-value; a key present with a different value
  fails. Requested markers are already `{key,value}` from `parseMarkerFlags`.
- No `--marker` flags -> the marker predicate is vacuously true, so all comments
  (marked and unmarked) pass, satisfying "unmarked comments appear with no marker
  segment".

`collectComments` is pure and never throws (it only reads an in-memory ticket and
delegates to the never-throwing `parseCommentLine`). The CLI obtains the ticket
via the existing `findTicket(root, ticketId)` (discover + read; throws
"ticket ... not found" -> exit 2, consistent with `query-ticket`). No lock is
taken and nothing is written.

### Output

Human (grouped by section, in document order; marker segment uses the on-disk
`:` form and is omitted entirely when the comment is unmarked):

```
<Section Name>
- <ts> [key:value key:value] <body>
- <ts> <body>

<Next Section Name>
- <ts> <body>
```

A blank line separates section groups; a section header prints only if it has at
least one matching record. When no records match (unknown section, or a marker
filter that excludes everything), print nothing and exit 0. The marker segment is
rendered by joining `markers.map(m => key:value)` with a space inside `[...]`.

`--json`: `console.log(JSON.stringify(records, null, 2))` where `records` is the
filtered array in document order, each element with EXACTLY the keys, in this
order:

```
{ "ticket": "<id>", "section": "<heading>", "timestamp": "<iso>", "markers": [ { "key": "...", "value": "..." } ], "body": "<text>" }
```

`markers` is `[]` for unmarked comments. Empty result -> `[]` (still exit 0).

### state-report untouched

`comments` shares no code with `stateReport`; it only adds `collectComments`
(new) and `commandComments` (new) and imports `collectComments` + reuses
`findTicket`/`parseMarkerFlags`. `stateReport`'s record shape is not edited.
Assert this with an explicit regression test: on a fixture that has marked and
unmarked comments, run `state-report --json` and assert the parsed object still
has exactly its existing keys (`total`, `eligible`, `ok`, `next`, ...) and no
comment/marker fields — i.e. capture the report and assert it does not gain any
key introduced by this feature. (A snapshot-equality assertion against a
pre-recorded report is acceptable as an alternative.)

### Test plan (mapped to acceptance bullets)

Add a `comments`-focused block to test/comment-markers.test.js (its `withBoard`
+ in-process `runCli` harness already exists) or a sibling test/comments.test.js
using the same helpers. Seed fixtures with `appendTicketComment` (the real
writer) so records match on-disk exactly.

- "lists all, grouped by section; unmarked have no marker segment": seed comments
  in two sections (some marked, some unmarked); `comments <id> --json` returns all
  records with correct `section`; the unmarked record has `markers: []`; human
  output shows no `[` segment for it. (bullet 1)
- "--section restricts; unknown section -> empty, exit 0": `--section "Run Log"`
  returns only Run Log records; `--section "Nope"` returns `[]` with exit code 0.
  (bullet 2)
- "--marker AND": seed one comment `[step:x outcome:PASS]`, another `[step:x
  outcome:FAIL]`, another `[step:y]`; `--marker step=x --marker outcome=PASS`
  returns only the first. A single `--marker step=x` returns both `step:x` rows.
  A key present with a mismatched value is excluded. (bullet 3)
- "--json exact shape / values match writer": round-trip — write a marked comment
  via `appendTicketComment`, read it back via `comments --json`, assert the record
  equals `{ ticket, section, timestamp, markers, body }` with the same marker
  order and body the writer produced; assert `Object.keys` is exactly those five.
  (bullet 4)
- "state-report --json unchanged": regression test described above. (bullet 5)
- Reuse of `parseMarkerFlags`: a malformed `--marker` (e.g. `k=P@SS`) exits 2 with
  the existing message and reads/prints nothing. (defends the "same grammar"
  requirement)
- Fence-awareness: a marker-shaped line inside a fenced code block in some section
  is not returned (mirrors the existing validate fence test). (bullet 6 coverage)

`npm test` gains the filter-by-marker and section-filter cases above.

### SKILL blocks decision

The subset test (test/skill-usage-sync.test.js) only requires each curated CLI
Commands block to be a SUBSET of `usageCommandNames()`. Adding a new `comments`
line to `USAGE_TEXT` (required by the ticket) therefore keeps the subset test
green regardless of whether the SKILL blocks mention `comments`.

Decision: ADD `comments` to BOTH curated SKILL blocks (SKILL.md and
skills/codex/local-board/SKILL.md), byte-identical, placed immediately after the
existing `comment` line:

```
local-board comments <ticket-id> [--section "<section>"] [--marker key=value ...] [--json]
```

Rationale: the read-only `comment` sibling is already curated, and `comments` is
the natural inspection counterpart an orchestrator uses to review Run Log
annotations, so it belongs in the runbook. Because the two blocks are guarded by
the same-names and byte-identical tests, the line MUST be added to both files
identically (treat SKILL.md as canonical and copy verbatim). Also add the
`comments` usage line to `USAGE_TEXT` in src/cli.js (this is what makes the
subset test pass and is the authoritative surface `usageCommandNames()` derives).

### Risks / edge cases

- Multi-word `--section`/heading names ("Run Log", "Technical Design") rely on the
  value arriving as a single arg; `takeOption` takes exactly one token, which is
  correct for a single shell-quoted argument. Documented in usage.
- A comment whose body legitimately starts with a `[...]`-looking block parses as
  unmarked (`markers: []`) per the documented v1 body/marker ambiguity — the
  reader inherits this, no new behavior.
- Records are emitted in document order within and across sections; no sorting, so
  output is deterministic and stable for snapshot tests.
- Read-only guarantee: no `withTicketLock`, no `writeTicketFile`; a failing read
  (missing ticket) is the only error path (exit 2).

### Documentation impact

Add a short "Reading and filtering markers" subsection to docs/comment-markers.md
describing `comments` (the `--marker key=value` filter uses the same `=`->`:`
mapping and AND semantics as the writer). No new doc file, so the README
Documentation Index needs no change.

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-08T20:53:57Z: Ensured git branch local-board/T20260708T2016Z-add-comments-subcommand-to-list-and-filter-ticket-comments-with-json (already-current).

- 2026-07-08T20:58:17Z: Completed design via claude-subagent:local-board-designer@opus: collectComments pure helper (fence-aware single pass, heading tracking, parseCommentLine reuse); CLI reuses parseMarkerFlags/findTicket, lock-free; SKILL blocks get comments added byte-identically; state-report regression test; estimate 2 basis T1338

- 2026-07-08T20:59:05Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (read-only reader, reuses validated parser)

- 2026-07-08T20:59:06Z: Ensured git branch local-board/T20260708T2016Z-add-comments-subcommand-to-list-and-filter-ticket-comments-with-json (already-current).
