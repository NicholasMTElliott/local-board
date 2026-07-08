---
id: B20260707T1325Z
type: bug
status: done
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/B20260707T1325Z-front-matter-list-serialization-does-not-round-trip-values-containing-commas-or-quotes
estimate: 2
estimateBasis: B20260707T2245Z
workStartedAt: 2026-07-08T01:04:05Z
workCompletedAt: 2026-07-08T01:17:44Z
created: 2026-07-07T13:25:08Z
updated: 2026-07-08T01:17:44Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", review:codex-task:read-only, "test:claude-subagent:local-board-tester@sonnet", gate:test:skipped-empty-catalog, document:codex-task:workspace-write]
routingApprovals: []
---
# Front matter list serialization does not round-trip values containing commas or quotes

## Requirement

`parseScalar` (`src/tickets.js:214-236`) splits front-matter list interiors on bare commas, while `formatString` (line 1425) quotes values containing commas via `JSON.stringify`. A list item like `"a, b"` re-parses as two corrupt items (`"a` and `b"`), and quoted strings are stripped without unescaping (line 221). This is currently safe only because list fields hold ticket IDs and step tokens whose charset excludes commas and quotes — the invariant is accidental, not enforced.

Fix: reject commas and quotes in list items at write time so the round-trip invariant is enforced. Alternatively implement proper quoted-scalar parsing.

Acceptance: writing a list item containing a comma or quote either round-trips correctly or is rejected with a clear error; a round-trip property test covers list serialization.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Technical Design

### Problem restated (verified against current `src/tickets.js`)

The front-matter list machinery has drifted since the ticket was filed; current line numbers:

- `parseScalar` (`src/tickets.js:458`): for a `[...]` value it takes the interior and does `inner.split(",").map((item) => parseListItem(item.trim()))`. The split is on **bare** commas with no quote awareness.
- `parseListItem` (`:478`) -> `parseScalar` (`:472`): a quoted item is unwrapped with `value.slice(1, -1)` — outer quotes stripped, **no unescaping** (no `JSON.parse`).
- `formatScalar` (`:2011`) array branch -> `formatListItem` (`:2021`) -> `formatString` (`:2025`): bare-safe items (matching `/^[A-Za-z0-9_./:+-]+$/`) are emitted raw; everything else is emitted via `JSON.stringify`.

Two concrete round-trip failures follow, both currently unreachable only by accident:

1. **Comma inside an item.** `["a, b"]` serializes to `[a, b]`... actually `formatString("a, b")` -> `"a, b"`, so the line is `["a, b"]`. On read, `inner.split(",")` yields `"a` and ` b"`; neither is a balanced quoted token, so `parseScalar` returns them verbatim -> two corrupt items `"a` and `b"`.
2. **Any character `JSON.stringify` escapes** (`"`, `\`, control chars). `["a\"b"]` on read hits the balanced-quote branch and `slice(1,-1)` yields `a\"b` (backslash-escape not decoded) instead of `a"b`.

### Why it is safe today, and the `@`-token detail

Every value that reaches a list field flows from a controlled grammar whose charset excludes `,`, `"`, `\`:

- `children` / `blockedBy` / `blocks`: ticket ids matching `TICKET_ID_RE` (`[ESBT]\d{8}T\d{4}Z`).
- `completedSteps` / `routingApprovals`: step/gate tokens — mandatory `action:executor`, optional `name:executor`, and `gate:<stage>:<executor>`. Executors are agent values (`inline`, `claude-subagent:<name>`, `codex-task:<mode>`) optionally suffixed `@<model>`.

The `@` in a token like `design:claude-subagent:local-board-designer@opus` is **not** in `formatString`'s bare charset `[A-Za-z0-9_./:+-]`, so that item is emitted via `JSON.stringify` -> `"design:claude-subagent:local-board-designer@opus"`. This quoted form round-trips **correctly** today: it contains no comma (single split token) and `JSON.stringify` introduces no escape sequences (no `"`/`\`/control chars), so `slice(1,-1)` reproduces the original exactly. The quoting mechanism itself is fine; only comma-splitting and non-decoded escapes are broken. The fix must preserve `@`-token quoting untouched.

### Approach — enforce the invariant at the single serialize chokepoint

Adopt the ticket's preferred option: **reject unserializable list items at write time** rather than build a CSV-style tokenizer. Rationale: proper quoted-scalar parsing means a real tokenizer in the hand-rolled parser (the comma split happens *before* quote detection, so quoted-comma support is not a small patch); no current or foreseen list field needs commas or quotes; rejection is a few lines and matches the MVP philosophy. Enforcement lives in `formatListItem` (`:2021`), the one function every list write passes through: `renderMarkdownTicket` -> `serializeFrontMatter` -> `formatScalar` array branch -> `formatListItem`. All writers (`moveTicket`, `setTicketField`, `appendTicketComment`, `setTicketSection`, `completeStep`, `approveInline`, `stampGateToken`, `linkParent`/`blockTicket` et al.) inherit the guard for free.

Proposed `formatListItem`:

```js
function formatListItem(value) {
  const str = String(value);
  // Bare tokens always round-trip: their charset excludes , " \.
  if (/^[A-Za-z0-9_./:+-]+$/.test(str)) {
    return str;
  }
  // Otherwise the item is emitted quoted. parseScalar unwraps a quoted list
  // item with slice(1,-1) (no unescape) after splitting the interior on bare
  // commas, so a quoted item round-trips ONLY when it contains no comma and
  // JSON.stringify adds no escape sequences (no " \ or control chars).
  if (str.includes(",") || JSON.stringify(str) !== `"${str}"`) {
    throw new Error(
      `front-matter list item cannot be serialized without corrupting the round trip ` +
        `(contains a comma, quote, backslash, or control character): ${JSON.stringify(str)}`,
    );
  }
  return JSON.stringify(str);
}
```

Key properties:

- The guard rejects **exactly** the values that break round-trip, no more. It is derived from the parser's actual behaviour (`split(",")` + `slice(1,-1)`), not a hand-picked blocklist.
- `@`-tokens, `gate:` tokens, `codex-task:` tokens, and ticket ids all still pass and serialize identically to today (verified: bare charset fails on `@`/`:` combos only where `@` is present -> quoted branch -> no comma, no escaping -> passes).
- Single quotes inside a value are **not** over-rejected: `JSON.stringify("a'b") === '"a\'b"'`? No — JSON does not escape `'`, so it equals `"a'b"` and passes, matching current de-facto behaviour.
- The error surfaces through the normal CLI error path (write throws -> command fails with the message), satisfying "rejected with a clear error."

Scope note: the guard targets comma/quote/escape **inside values**; it does not disable or change the JSON-quoting mechanism. The read path (`parseScalar`/`parseListItem`) is left unchanged — pre-existing on-disk quoted `@`-tokens keep parsing correctly, and since the write guard now prevents commas/escapes from ever being written, the `slice(1,-1)` unwrap stays sufficient.

### Alternatives considered (and rejected)

- **Full quoted-scalar parser** (CSV tokenizer + `JSON.parse` on quoted items in `parseScalar`): correctly supports commas/quotes but is materially more code in the parser and buys capability no field needs. Deferred; the write-time guard leaves the door open to add it later without a data migration (rejected values were never persisted).
- **Guard in `formatScalar` array branch instead of `formatListItem`**: same coverage but less cohesive; per-item validation belongs with per-item formatting.
- **Validate in `validate()`/`validateTicketShape`**: catches on read after a bad write already landed; the invariant is a write-time property, so enforce it at write.

### Affected files

- `src/tickets.js` — modify `formatListItem` (`:2021`) only. No production behaviour change for any legal current value; the sole observable change is a thrown error on illegal input.
- `test/tickets.test.js` — add the round-trip property test and explicit rejection cases (see below). `parseScalar`, `parseFrontMatter`, `serializeFrontMatter`, and `renderMarkdownTicket` are already exported; the property test drives `serializeFrontMatter` -> `parseFrontMatter` (or `parseScalar`) directly. `formatListItem` is internal and is exercised through `serializeFrontMatter`.

No docs/`memory-bank` change required (internal serialization invariant, no user-facing surface). Optional one-line note in `memory-bank/systemPatterns.md` if the round-trip invariant is deemed worth recording; not required for acceptance.

### Test strategy

Add to `test/tickets.test.js` (uses `node:test` + `node:assert/strict`; no external fuzz lib available, so the property test is a deterministic hand-rolled generator):

1. **Round-trip property test.** Deterministic PRNG (seeded LCG, no `Math.random`, for reproducibility). Generate N (~1000) random lists of 0-4 items over the **legal** list charset (`A-Za-z0-9`, `:`, `-`, `@`, `.`, `/`, `_`, `+`). For each, build a front matter object, `serializeFrontMatter` it, feed the emitted `field: value` line(s) through `parseFrontMatter`, and assert deep-equality of the list. This covers bare items, quoted `@`-items, empty lists, and item ordering in one property.
2. **Explicit rejection cases.** Assert `serializeFrontMatter({ children: ["a, b"] })` (comma), `["a\"b"]` (double quote), and `["a\\b"]` (backslash) each throw, and that the message names the offending value. Use `assert.throws` with a message regex.
3. **Regression: real tokens round-trip.** Explicit cases for `completedSteps: ["design:claude-subagent:local-board-designer@opus"]`, `["gate:design:skipped-empty-catalog"]`, and a `codex-task:*@codex-default` token — serialize then parse, assert unchanged. Guards against the fix accidentally rejecting a legitimate `@`-token.
4. **Empty / single / multi** boundary cases for lists (`[]`, one item, several) to lock the interior formatting.

### Risks and edge cases

- **Existing boards with quoted `@`-tokens (primary risk).** Explicitly covered: those items pass the guard (no comma, no escaping) and serialize byte-identically to today; regression test #3 pins this. No migration needed.
- **A latent already-corrupt value on disk.** If some board already contains a comma-bearing list item (only reachable by hand-editing, since no code writes one), the *read* path still mis-splits it — unchanged by this fix, which is write-side. Acceptable: the guard prevents new occurrences; a reader-side repair is out of scope and would require the deferred tokenizer.
- **New write path throwing mid-operation.** The guard can now throw inside a locked read->write span (e.g. `completeStep`). Because it throws *before* `writeTicketFile`, no partial file is written; the atomic-rename writer is never reached. No new rollback logic needed. The throw is only reachable with illegal input that no current caller produces, so no existing flow regresses.
- **Model suffixes / future executors.** Any future executor value containing `,`/`"`/`\` would now be rejected at write; that is the intended contract. If a future field genuinely needs commas, that is the trigger to implement the deferred tokenizer.

### Open questions

None blocking. One judgement call for the implementer: whether to also record the round-trip invariant as a one-line note in `memory-bank/systemPatterns.md` (nice-to-have, not required by acceptance).

## Implementation Notes

Implemented exactly per the Technical Design: added a round-trip guard to `formatListItem` in `src/tickets.js` (was a one-line passthrough to `formatString`). Bare-charset items (`/^[A-Za-z0-9_./:+-]+$/`) still pass through unquoted. Non-bare items are rejected with a thrown `Error` naming the offending value (via `JSON.stringify`) when they contain a comma or when `JSON.stringify` would introduce an escape sequence the parser's `slice(1,-1)` unwrap can't reverse (quote, backslash, control char); otherwise they're quoted as before. No other production code changed — `parseScalar`/`parseListItem` (read path) untouched, per design.

Files changed:
- `src/tickets.js` — `formatListItem` (was line 2021) now guards before quoting.
- `test/tickets.test.js` — added `parseFrontMatter`/`serializeFrontMatter` to imports (both already exported); added 4 new tests plus small helpers (`roundTripList`, `makeLcg`, `randomLegalItem`, `LEGAL_LIST_CHARSET`) at end of file:
  1. Seeded-LCG property test, 1000 trials, random 0-4 item lists over the legal charset — asserts round-trip equality.
  2. Explicit rejection cases: comma, double quote, backslash — `assert.throws` with message regex naming the value.
  3. Regression test: real `@`-tokens (`design:...@opus`, `gate:design:skipped-empty-catalog`, `...@codex-default`) — asserts the exact serialized string (byte-identical to pre-fix output) and round-trip.
  4. Boundary cases: empty list, single item, multi-item list — exact serialized string plus round-trip.

Verification (all green):
- `npm run check` — no output, exit 0.
- `npm test` — 342 tests, 341 pass, 1 skipped (pre-existing `smoke (slow)` test, unrelated), 0 fail.
- `npm run validate` — "Ticket validation OK" against this repo's own board, which has quoted `@`-tokens in `completedSteps` throughout (proves no regression on real data).

No deviations from the design. No memory-bank update made (design left it as optional/non-required).

## Review Findings

Reviewed by codex-task:read-only (gpt-5.5) against commit e39055d.

No blocking findings.

- Guard matches the parser's actual corrupting cases: rejects commas and any value whose JSON.stringify would introduce escapes; benign quoted values (leading/trailing whitespace, single quotes) still round-trip and pass. Double-quote-wrapped values correctly rejected (escape corruption).
- Chokepoint verified: renderMarkdownTicket/serializeFrontMatter covers all rewrites (dependency lists, completedSteps, routingApprovals); createTicket's template bypass writes no list items, and post-create linkage routes through the guarded path.
- Property test uses the current token grammar (narrower than full parser tolerance — acceptable for the domain), paired with the byte-identical @-token regression; control characters guarded but not directly asserted (non-blocking gap).
- Error names the offending value via JSON.stringify; field-name threading judged not worth the churn.

Verdict: pass

## Test Evidence

Tested by claude-subagent:local-board-tester (sonnet) on branch local-board/B20260707T1325Z-..., commit e39055d.

**Suite:** `npm run check` pass; `npm test` 341 pass / 1 gated-skip of 342 (all four new tests green); `npm run validate` OK on this real board full of quoted @-tokens.

**Live probes (throwaway board):**
- complete-step --executor with comma/quote/tab is intercepted UPSTREAM by the executor-format regex (pre-existing) — the guard is defense-in-depth on that path, as the design noted.
- The genuinely reachable path: `set <id> blockedBy` with comma/quote/backslash/tab items — all rejected by the NEW guard with the value-naming error, exit 2, file verified unchanged each time (throws before writeTicketFile). The tab case closes the reviewer's control-char assertion gap live.
- Positive: @-suffixed executor records byte-identically (`["design:...@opus"]`), file stays parseable, board validates.

**Gaps / caveats:** the --executor probe path never reaches the guard (upstream validator) — flagged so the two layers aren't confused; mixed legal/illegal multi-item ordering untested (low risk, not in acceptance).

Result: pass

## Documentation Updates

Documented by codex-task:workspace-write (gpt-5.5).

- `memory-bank/systemPatterns.md` — Canonical State now states the front-matter list-item charset invariant is write-enforced (non-round-tripping items rejected at serialization).

## Questions

## Run Log

- 2026-07-08T01:03:15Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): round-trip guard at the formatListItem chokepoint (reject commas / non-round-tripping quotes), preserving existing quoted @-token behavior byte-identically; CSV tokenizer deferred. Estimate 2 (basis B20260707T2245Z).

- 2026-07-08T01:04:05Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (parser hygiene)

- 2026-07-08T01:04:05Z: Ensured git branch local-board/B20260707T1325Z-front-matter-list-serialization-does-not-round-trip-values-containing-commas-or-quotes (created).

- 2026-07-08T01:08:01Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Implementer (sonnet): round-trip guard at formatListItem, 4 new tests incl. seeded property test and byte-identical @-token regression; 341 pass + 1 gated-skip; live board validates.

- 2026-07-08T01:08:52Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (parser hygiene)

- 2026-07-08T01:11:33Z: Completed review via codex-task:read-only: Codex (gpt-5.5, read-only) verdict pass: guard matches the parser's real failure modes, chokepoint verified, benign quoting preserved; one non-blocking control-char assertion gap.

- 2026-07-08T01:16:01Z: Completed test via claude-subagent:local-board-tester@sonnet: Tester (sonnet): 341+1 gated; guard live-verified on the reachable set-field path incl. control chars with files unchanged on every rejection; @-token byte-identity confirmed on real data. Result: pass.

- 2026-07-08T01:17:44Z: Completed document via codex-task:workspace-write: Codex (workspace-write): Canonical State invariant sentence added.
