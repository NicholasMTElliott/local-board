---
id: B20260707T1326Z
type: bug
status: implementing
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/B20260707T1326Z-section-boundary-detection-mis-fires-on-heading-like-lines-inside-fenced-code-blocks
estimate: 2
estimateBasis: B20260707T1325Z
workStartedAt: 2026-07-08T01:22:15Z
workCompletedAt: null
created: 2026-07-07T13:26:08Z
updated: 2026-07-08T01:28:26Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
routingApprovals: []
---
# Section boundary detection mis-fires on heading-like lines inside fenced code blocks

## Requirement

`getSectionText`/`appendToSection`/`replaceSection` (`src/tickets.js:1330-1372`) each re-derive the same section-boundary search and treat any line starting with `## ` as a section heading — including lines inside fenced code blocks. Review Findings or Test Evidence containing a fenced code sample with `## ` truncates or misplaces section content.

Fix: extract a shared `locateSection` helper that tracks fence state (``` and ~~~) and ignores heading-like lines inside fences; use it from all three call sites.

Acceptance: section commands round-trip content containing fenced code blocks with heading-like lines; a regression test covers this.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Problem

`src/tickets.js` locates `## ` section boundaries with a naive scan repeated in
four places. Each treats *any* line beginning with `## ` (via literal `\n## `
search or an `m`-flag regex) as a section heading, with no awareness of fenced
code blocks. A Review Findings / Test Evidence body that embeds a fenced markdown
sample containing a heading-like line (e.g. a fence showing a ticket template)
will be split at that fake heading — truncating the section on read and
misplacing appended content on write.

### Current call sites (verified line numbers)

- `appendToSection(body, section, line)` — `src/tickets.js:1930`. Uses
  `body.slice(sectionStart).search(/\n## /)` (line 1938) to find the section end,
  then inserts before it. Backs `appendTicketComment` (`:705`, e.g. Run Log
  comments) and any set that appends.
- `getSectionText(body, section)` — `src/tickets.js:1945` (exported). Same
  `/\n## /` search (line 1953). Consumed by `cli.js:976` and `cli.js:1074` to
  build `ticketContext.requirement` / `acceptanceCriteria` for gate-check /
  dispatch payloads.
- `replaceSection(body, section, text)` — `src/tickets.js:1958`. Same `/\n## /`
  search (line 1966). Backs `setTicketSection` (`:733`) — the exact path this
  designer uses to persist sections, and the path the executor uses for evidence.

All three first find the heading with `new RegExp(`^## ${escapeRegExp(section)}\\s*$`, "m")`
then slice forward to the next `\n## `. Both halves are fence-blind: a fenced
`## Fake` after the target heading ends the section early, and a fenced heading
matching the *target* name before the real one could anchor to the wrong spot.

### Adjacent scanner (lower priority, in scope to note)

- Validation `validateTicketBody` loop — `src/tickets.js:1210-1215`. Uses
  `sectionRe.test(ticket.body)` (existence only, `m` flag). A fenced
  `## Requirement` would falsely satisfy the "section present" check. Existence
  testing is far less fragile than boundary slicing, so I will route it through
  the shared helper *only if* it is cheap; otherwise leave it and note the
  residual edge case. Not part of Acceptance.
- `extractTitle` (`:1781`) scans for `# ` (H1, front-matter title) — unaffected;
  out of scope. Front-matter parsing (`:441`, `parseFrontMatter`) is unaffected.

### Are existing tickets already mis-parsed?

Checked. A fence-state-tracking scan of every `plans/tickets/**/*.md` found
**zero** lines starting with `## ` inside a fence (` ``` ` or `~~~`). Many done
tickets carry fenced samples (front-matter, JSON, config), but none currently
embed a bare column-0 `## ` heading inside a fence. We have been silently lucky,
not correct — the board is one evidence paste away from corruption, which is why
this ticket exists.

## Approach

Add one shared, fence-aware `locateSection(body, section)` helper and route all
three boundary functions through it. Keep it pure and offset-returning so the
existing slice/insert logic is reused unchanged.

### The helper

```
function locateSection(body, section)
  -> null if the section heading is not found (outside fences), else
  -> { headingStart, headingEnd, contentStart, contentEnd }
     (character offsets into `body`)
```

Algorithm — single line-by-line pass tracking fence state:

1. Split on `/\r?\n/` but keep a running character offset so we can return exact
   indices (or iterate with a regex over line starts). Preserve CRLF: compute
   offsets against the original `body`, do not reserialize.
2. Maintain `inFence` boolean and the opening `fenceMarker` char (`` ` `` or `~`).
   A line whose trimmed-left content starts with three or more of the *same*
   fence char toggles: when closed, `inFence=false` on any `>=`-length run of the
   opener's char; when open, record marker. Pragmatic per decision 1 — we do not
   enforce that the closing run be `>=` the opener length; any 3+ run of the
   active marker closes. Info strings after an opener are ignored.
3. While `!inFence`, a line matching `^## <section>\s*$` (escaped) is the heading:
   record `headingStart`/`headingEnd`; `contentStart` = offset after that line's
   newline.
4. After the heading, the first subsequent line (again `!inFence`) matching
   `^## ` marks `contentEnd` (its start); if none, `contentEnd = body.length`.
5. Return offsets. Callers keep their current trimming/insertion arithmetic
   verbatim, just sourced from these offsets instead of `search(/\n## /)`.

### Rewire the three functions

- `getSectionText`: `const loc = locateSection(body, section); if (!loc) return null;`
  then `body.slice(loc.contentStart, loc.contentEnd).trim()`.
- `appendToSection`: derive `insertAt = loc.contentEnd`; keep the existing
  `before`/`after` splice.
- `replaceSection`: `sectionStart = loc.contentStart`, `insertAt = loc.contentEnd`;
  keep the before/after reflow (`:1968-1971`) unchanged.

Error/`null` semantics stay identical (getSectionText returns null; the other two
throw `section "…" not found`).

### Write-side is the same helper (decision 3)

`setTicketSection --file` writes fenced content, then the *next* read
(`getSectionText`) and the next `append`/`replace` must compute extents
fence-aware. Because all four operations share `locateSection`, inserting a body
with a fenced `## Fake` no longer poisons subsequent reads or appends — the
round-trip is closed by construction. No separate write-path change needed.

## Affected files

- `src/tickets.js` — add `locateSection`; rewire `appendToSection` (:1930),
  `getSectionText` (:1945), `replaceSection` (:1958). Optionally route the
  validation existence check (:1210).
- `test/tickets.test.js` — new regression tests (below).
- No `cli.js` change: it consumes `getSectionText`, which is fixed underneath it.
- No production doc change expected; if `memory-bank/systemPatterns.md` documents
  section handling, add a one-line note that section scanning is fence-aware.

## Risks / blast radius

- **Behavior change on read for already-stored tickets.** Any ticket whose stored
  body *does* contain a fenced `## ` would start parsing differently (correctly)
  after this change — content previously truncated becomes visible. Blast radius
  is currently **nil**: the repo scan found no such ticket. So this is a latent
  correctness improvement with no observable regression on existing data; nothing
  needs migration.
- **Fence grammar is intentionally pragmatic (decision 1).** Not handled:
  4-space-indented code blocks (never toggle fences, so a `## ` in one is still
  mis-read — pre-existing behavior, explicitly out of scope), nested fences, and
  fences opened inside blockquotes/lists with indentation beyond the trim we do.
  Acknowledged; note in the helper's comment.
- **Unbalanced fences.** A body with an odd number of fence lines leaves
  `inFence=true` to EOF, hiding real trailing `## ` headings. Mitigation: this
  only affects malformed input; the failure mode (section runs to EOF) is no
  worse than today for that pathological body, and validation still flags missing
  sections. Low risk.
- **CRLF / offset drift.** Must compute offsets against original `body`, not a
  normalized copy, or `writeTicketFile` round-trip could shift bytes. Covered by
  an explicit CRLF round-trip assertion if the suite has CRLF fixtures; otherwise
  keep offset math on the raw string.
- **Performance.** Line scan is O(n) vs. the old single `indexOf`; negligible for
  ticket-sized bodies.

## Test strategy

Add to `test/tickets.test.js` (mirrors existing `setTicketSection` /
`appendTicketComment` tests at :451, :470):

1. **Round-trip with fenced fake heading (core acceptance).**
   `setTicketSection(root, id, "Review Findings", <body with a fenced block whose
   body line is "## Fake Heading">)`, then `getSectionText` returns the *entire*
   body including the fence, untruncated. Assert the fenced `## Fake Heading` line
   survives and no sibling section absorbed it.
2. **Append into a later section past a fence.** Seed Test Evidence with a fenced
   `## ` sample, then `appendTicketComment(root, id, "Run Log", …)`. Assert the
   comment lands under Run Log (the true last section), not mid-Test-Evidence.
3. **Both fence markers.** Parameterize case 1 over ` ``` ` and `~~~` openers,
   and one case with an info string (` ```md `).
4. **Idempotent double round-trip.** Set the section, read, set again with the
   read value; assert stable output (guards offset/reflow arithmetic).
5. **Validation stays green.** Run the board validation over a ticket carrying a
   fenced heading-like line; assert no spurious missing/extra-section issues.
6. **Negative guard.** A genuine, non-fenced `## ` still boundaries correctly
   (regression protection for the common path).

## Open questions

- Should the validation existence check (:1210) also become fence-aware, or is
  guarding the three boundary functions sufficient for this ticket? Proposed:
  fix the three (Acceptance), route validation through the helper only if trivial,
  else defer with a noted edge case.
- Do we care about 4-space-indented code blocks now, or explicitly defer? Proposed:
  defer (documented out of scope), since no ticket uses them for headings and
  CommonMark indented-code detection adds real complexity.

## Implementation Notes

Added a shared, fence-aware `locateSection(body, section)` helper in `src/tickets.js` (line-by-line scan tracking ``` / ~~~ fence state per the design's pragmatic grammar: any 3+ run of the active fence char closes regardless of opener length; info strings ignored; 4-space-indented code blocks explicitly out of scope). Returns `{ headingStart, headingEnd, contentStart, contentEnd }` offsets into the original `body` (CRLF-safe — offsets computed against the raw string, no reserialization), or `null` if the heading isn't found outside a fence.

Rewired all three call sites to use it: `appendToSection`, `getSectionText` (exported), `replaceSection` — replacing the fence-blind `/\n## /` searches. Slice/insert arithmetic in each function is unchanged, just sourced from the helper's offsets.

Also routed the validation existence check (`validateTicketBody`, was `sectionRe.test(ticket.body)` with the `m` flag) through `locateSection(ticket.body, section) === null`, per the design's proposal that this was trivial to fix alongside the three boundary functions. Same fix eliminates the false-positive "section present" case where a fenced heading-like line could satisfy the existence check.

Tests added to `test/tickets.test.js` (6 new test cases, covering the design's test strategy items 1-6):
- Round-trip a fenced fake heading, parameterized over ` ``` `, ` ```md ` (info string), and `~~~` (3 tests via a loop).
- Append a Run Log comment past a fenced heading-like line seeded in Test Evidence; asserts the comment lands in Run Log, not swallowed into Test Evidence.
- Idempotent double round-trip through a fenced heading (set, read, set again with the read value, assert stable).
- Regression guard: genuine non-fenced headings still boundary correctly across two adjacent sections.
- Validation-stays-green is asserted inline (`validate(...) === []`) in every new test, including one case where the fenced fake heading text is literally `## Documentation Updates` (a real STANDARD_SECTIONS name) to exercise the validation-existence-check fix specifically.

Verification:
- `npm run check`: pass (syntax check across all listed files).
- `npm test`: 348 tests, 347 pass, 1 skipped (pre-existing slow smoke test gated behind `LOCAL_BOARD_SLOW_TESTS`), 0 fail.
- `npm run validate`: `Ticket validation OK`.
- Live-data spot check (no CLI surface exists to dump an arbitrary section of an arbitrary ticket, so checked via a small script importing `getSectionText` directly): read `Approach` off the done ticket `T20260707T1332Z` (contains 3 fenced JS code samples inline). Returned content spans all three fences fully intact (2617 chars, contains both the first and last fenced-code fragments) and stops cleanly before the next real `## Back-compat` heading — no truncation, no bleed. `Technical Design` on the same ticket correctly returns empty (0 chars), since that document's real content lives in sibling `## ` sections between `Technical Design` and `Implementation Notes` — expected, unchanged from prior behavior.

Deviations from design: none. Implemented exactly as specified, including the optional validation-existence-check fix (design left this as "route through the helper only if trivial" — it was).

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-08T01:21:30Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): fence-aware locateSection helper replacing the three fence-blind scanners (append/get/replace); repo-wide fence scan found zero affected real tickets (latent fix, nil blast radius); indented code blocks out of scope. Estimate 2 (basis B20260707T1325Z).

- 2026-07-08T01:22:15Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (parser hygiene)

- 2026-07-08T01:22:15Z: Ensured git branch local-board/B20260707T1326Z-section-boundary-detection-mis-fires-on-heading-like-lines-inside-fenced-code-blocks (created).
