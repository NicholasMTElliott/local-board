---
id: T20260708T2015Z
type: task
status: ready_for_docs
priority: P3
parent: S20260516T1539Z
children: []
blockedBy: []
blocks: [T20260708T2016Z]
branch: local-board/T20260708T2015Z-add-marker-flags-marker-parser-render-and-validate-rules-to-comment
estimate: 4
estimateBasis: T20260707T1338Z
workStartedAt: 2026-07-08T20:16:33Z
workCompletedAt: null
created: 2026-07-08T20:15:33Z
updated: 2026-07-08T20:52:54Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", review:codex-task:read-only, "test:claude-subagent:local-board-tester@sonnet", gate:test:skipped-empty-catalog, document:codex-task:workspace-write]
routingApprovals: []
---
# Add --marker flags, marker parser, render, and validate rules to comment

## Requirement

Add structured markers to the comment write path.

Extend `commandComment` (src/cli.js ~L760) with a repeatable `--marker key=value` flag, accumulated into an ordered map; validate each key/value (values `[A-Za-z0-9_./-]+`, keys no whitespace) and reject malformed input with a clear CLI error. Extend `appendTicketComment` (src/tickets.js ~L830) to accept a markers option and render the bracketed block. Add an exported pure parser in src/tickets.js returning `{ timestamp, markers, body }` for a single comment line, with graceful fallback to whole-body when the bracket parse fails (backward compatibility). Add `validate` rules that surface malformed marker syntax. Create `docs/comment-markers.md` documenting the reserved vocabulary (`kind`, `step`, `outcome`, `executor`; other keys allowed but unvalidated) and index it in README.md.

Format decisions (corrections to the parent story, agreed at decomposition):
- Marked lines render `- <ts>: [step:x outcome:PASS kind:specialty] <body>` — the existing `- <ts>: <body>` colon form is preserved; the marker block is inserted between the `: ` separator and the body. Unmarked comments render byte-identical to today.
- CLI accepts `key=value`; the on-disk/rendered form is `key:value`. Document this mapping.
- Markers are run-log annotations / grep aids only. They are NOT routing or gate evidence: completedSteps and gate tokens remain the only evidence ledger, and `state-report` does not read markers. Say this explicitly in docs/comment-markers.md.

## Acceptance Criteria

- `local-board comment <ticket> <text> --marker step=x --marker outcome=PASS` accepts repeated flags; malformed markers produce a clear non-zero error.
- Marked comments render as `- <ts>: [step:x outcome:PASS kind:specialty] <body>`; unmarked comments render byte-identical to today.
- Exported parser round-trips (write-then-parse recovers markers and body); legacy unmarked comment parses to empty markers + full body; stray brackets fall back to body without throwing.
- `validate` flags a synthetically malformed marker line and passes clean on all existing tickets.
- `docs/comment-markers.md` documents the reserved keys and the not-evidence rule; README index updated.
- `npm test` adds: marker round-trip, malformed rejection, backward-compat parse.

## Acceptance Criteria

## Related Tickets

## Technical Design

Adds structured, greppable markers to the comment write path without touching the evidence ledger. Four surfaces change: the `comment` CLI (repeatable `--marker key=value`), `appendTicketComment` rendering, a new exported pure `parseCommentLine`, and a fence-aware `validate` rule. Follows existing arg-parsing, section-walking, and issue-string conventions.

### 1. Marker syntax grammar

CLI input is `--marker key=value`, repeatable. On disk / rendered, the pair is `key:value`; the `=`->`:` remap is the documented CLI-to-disk mapping.

Grammar (recommended, tightened from "keys no whitespace" so both the render and parse round-trips are unambiguous):

- key regex: `^[A-Za-z0-9_.-]+$` — rejects whitespace and the structural characters `= : [ ]`. This is a safe subset of the ticket's "no whitespace" rule; a key containing `:` would break the on-disk `key:value` split and a key containing `]`/space would break the block.
- value regex: `^[A-Za-z0-9_./-]+$` — exactly the ticket's charset.
- Separator on disk: single `:` between key and value; single ASCII space between pairs.
- Rendered block: `[k1:v1 k2:v2 ...]`, pairs in CLI-supplied order, wrapped in one pair of square brackets, followed by exactly one space, then the body. Full marked line: `- <ts>: [step:x outcome:PASS kind:specialty] <body>`.
- Duplicate keys: **reject** as malformed (an "ordered map" has unique keys; last-wins would silently drop input). Clear CLI error naming the repeated key.
- Empty markers: render byte-identical to today (no bracket block, no extra space).

**Quoting decision (v1): reject any value that would need quoting.** Because values are constrained to `[A-Za-z0-9_./-]+` they can never contain a space, `:`, `]`, or quote, so no quoting mechanism is introduced. A value that needs quotes is a malformed-input error today; a quoting/escaping grammar is deferred to a future ticket if demand appears. This keeps the block trivially splittable on spaces.

Reserved vocabulary (documented, validated only for syntax, not membership): `kind`, `step`, `outcome`, `executor`. Other keys are allowed and pass syntax validation but are not semantically checked.

### 2. Function signatures

**CLI arg accumulation (src/cli.js).** `takeOption` uses a single `indexOf`, so add a repeatable sibling next to it:

```
// Collect every occurrence of a repeatable option, in left-to-right order,
// splicing each name+value pair out of args. Mirrors takeOption's value guards.
function takeAllOptions(args, name)  // -> string[]  (raw "key=value" strings)
```

`commandComment` (~L760) then:

```
const markerFlags = takeAllOptions(args, "--marker");   // before positional shift
const section = takeOption(args, "--section") ?? "Run Log";
const ticketId = args.shift();
const text = args.join(" ").trim();
...
const markers = parseMarkerFlags(markerFlags);  // ordered [{key,value}], throws on malformed
await appendTicketComment(root, ticketId, section, text, { markers });
```

```
// Validate + remap CLI key=value flags into ordered on-disk pairs.
// Throws Error with a clear CLI message on: missing '=', empty key/value,
// key/value charset violation, or duplicate key.
function parseMarkerFlags(rawFlags)  // -> Array<{key, value}>
```

**Rendering (src/tickets.js).** `appendTicketComment` gains `options.markers` (default `[]`):

```
export async function appendTicketComment(root, ticketId, section, text, options = {})
// inside the locked RMW:
const prefix = renderMarkerBlock(options.markers);   // "" when empty, else "[k:v ...] "
const line = `- ${formatIsoSeconds(options.now ?? new Date())}: ${prefix}${text.trim()}`;
```

```
function renderMarkerBlock(markers)  // -> "" | "[k1:v1 k2:v2] "
```

Empty/absent markers yield `""`, preserving today's byte-identical output.

**Exported pure parser (src/tickets.js).**

```
export function parseCommentLine(line)  // -> { timestamp, markers, body }
```

- `timestamp`: the raw ISO string, or `null` when the line is not a timestamped comment.
- `markers`: ordered `Array<{key, value}>`; `[]` when none/failed.
- `body`: the remaining text.

Algorithm (never throws):
1. Match `^- (?<ts>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})): (?<rest>[\s\S]*)$`. The ISO timestamp itself contains colons, so anchor on the full timestamp shape rather than a greedy `\S+` before the first `: `. No match -> `{ timestamp: null, markers: [], body: line }`.
2. If `rest` starts with `[` and has a closing `]`: take the inner substring, split on single spaces. If **every** token matches `^<key>:<value>$` under the grammar, return those markers with `body` = text after `] ` (trim one leading space). Otherwise fall back.
3. Fallback (no `[`, unclosed `[`, or any token invalid): `{ timestamp, markers: [], body: rest }` — the whole body, brackets included.

**Validate rule (src/tickets.js).** New per-ticket pass invoked from `validate()` (add `issues.push(...validateCommentMarkers(ticket))` in the existing `for (const ticket of board.tickets)` loop at ~L595, alongside `validateTicketShape`). It walks the body with fence tracking (see section 3) and flags lines that *look like* a marker block but are malformed:

```
function validateCommentMarkers(ticket)  // -> string[]
```

Malformed-detection heuristic (stricter than the parser, to surface author mistakes without false-positiving on prose):
- Only consider non-fence lines matching the comment shape `^- <ISO-ts>: [`.
- Extract the bracket inner (to matching `]`, or to end-of-line if unclosed). Split on spaces.
- If **at least one** token looks like an intended marker (contains `:`) AND some token fails the strict grammar (or the bracket is unclosed) -> push an issue.
- If **no** token contains `:` (e.g. a prose comment that happens to start `[see notes]`) -> skip; it is not marker syntax.

Issue string matches the existing style, e.g.
`${ticket.path}: malformed marker block in Run Log comment "- <ts>: [step:x outcome:P@SS] ...": value "P@SS" violates [A-Za-z0-9_./-]`.

This passes clean on all existing tickets: none carry marker blocks, and the `- <ISO-ts>: [` gate plus the `:`-token requirement means ordinary prose bullets and Technical-Design brackets are ignored.

### 3. Fence-awareness (avoiding false positives inside code fences)

`locateSection` (L2105) already contains the canonical fence state machine (`fenceRe`, tracking `inFence`/`fenceChar`). Recommendation: extract that loop into a shared generator to avoid duplicating fence logic:

```
function* contentLines(body)  // yields { line, lineStart } for non-fence lines only
```

Refactor `locateSection` to consume it (behavior-preserving) or, to minimize risk to a load-bearing function, add `contentLines` as a new helper and have only `validateCommentMarkers` use it now. Either way, the validator and any parser-driven scan iterate **only** non-fence lines, so a comment-shaped example inside a triple-backtick block (cf. the existing fenced-heading tests at test/tickets.test.js:661/569) is never parsed as a marker line. `parseCommentLine` itself is a pure single-line function and takes no fence responsibility — callers feed it real comment lines only; the fence filter lives in the walker.

### 4. Documentation

**docs/comment-markers.md** (new) outline:
- Purpose: one paragraph — markers are run-log annotations / grep aids.
- **Not-evidence rule** (call-out): markers are NOT routing or gate evidence. `completedSteps` and gate tokens remain the only evidence ledger; `state-report` does not read markers. State this explicitly.
- Syntax: CLI `--marker key=value` (repeatable) -> rendered `- <ts>: [key:value ...] <body>`; key/value charsets; no quoting in v1.
- **CLI-to-disk mapping** table: `key=value` (CLI) <-> `key:value` (on disk/rendered).
- Reserved vocabulary table: `kind`, `step`, `outcome`, `executor` with a one-line meaning each; note other keys are allowed but unvalidated.
- Round-trip / backward-compat note: legacy unmarked comments parse to empty markers + full body; malformed brackets fall back to body.
- Example commands and resulting rendered lines.

**README.md** Documentation Index (~L128): add
`- [docs/comment-markers.md](docs/comment-markers.md) — structured run-log comment markers (--marker), the reserved vocabulary, the CLI key=value <-> on-disk key:value mapping, and the not-evidence rule.`

**USAGE_TEXT / printUsage (src/cli.js L1252):** update the `comment` line to
`comment <ticket-id> <text> [--marker key=value ...] [--section <section>] [--allow-main-root]`.
The skill-usage-sync test (test/skill-usage-sync.test.js) requires only that each SKILL.md CLI-block command name is a **subset** of usage names and that the two SKILL.md blocks are **byte-identical** to each other. The command name `comment` is unchanged, so adding the flag to USAGE_TEXT alone breaks nothing. Editing the SKILL.md `comment` line is **optional**; if done, it must be applied identically to **both** SKILL.md and skills/codex/local-board/SKILL.md to keep the byte-identical assertion green. Recommendation: leave both SKILL.md blocks unchanged in this ticket (the flag is documented in docs/comment-markers.md), avoiding lockstep churn.

### 5. Test plan (mapped to Acceptance Criteria)

- **Repeated flags accepted / malformed rejected** (bullet 1): CLI-level test (execFile, mirroring the smoke test at tickets.test.js:3190 or a direct `parseMarkerFlags` unit test) — `--marker step=x --marker outcome=PASS` succeeds; `--marker bad`, `--marker k=bad space`, `--marker k=P@SS`, duplicate `--marker k=a --marker k=b` each exit non-zero with a clear message.
- **Render correctness** (bullet 2): `appendTicketComment(..., { markers, now })` renders `- <ts>: [step:x outcome:PASS kind:specialty] <body>` in supplied order; a no-marker call renders byte-identical to the existing L520 assertion (assert exact equality against today's output).
- **Round-trip + backward-compat + stray brackets** (bullet 3): write-then-`parseCommentLine` recovers markers + body; a legacy line `- <ts>: plain body` -> `markers: []`, full body; `- <ts>: [unclosed body` and `- <ts>: [not markers here]` -> fall back to body, no throw.
- **Validate** (bullet 4): construct a fixture ticket with a synthetic malformed marker line in Run Log -> `validate` returns a matching issue; assert `validate` is clean across the repo's existing tickets (a discover+validate over `plans/tickets`); assert a comment-shaped line **inside a code fence** is not flagged.
- **Docs** (bullet 5): covered by manual review — README index entry present. (No automated doc test required by the criteria.)
- `npm test` gains: marker round-trip, malformed rejection, backward-compat parse (bullet 6).

### 6. Out of scope

- The `comments` reader subcommand and any read/query surface for markers — that is **T20260708T2016Z** (this ticket `blocks` it). `state-report` and routing/evidence logic are explicitly untouched.
- No quoting/escaping grammar for marker values (deferred).
- No change to the evidence ledger, gate tokens, or `completedSteps`.

### Key risks / limitations

- **Body-vs-marker ambiguity:** an unmarked comment whose body legitimately starts with a valid-looking `[key:value]` is indistinguishable from a marker block on parse. Rare in practice; documented as a v1 limitation. Mitigated for `validate` by the `:`-token heuristic (won't flag prose), but `parseCommentLine` would still interpret it as markers.
- **Timestamp regex breadth:** must accept `Z` and numeric offsets so real timestamps (which contain colons) parse; the anchored ISO shape above handles both. Non-ISO leading tokens correctly yield `timestamp: null`.
- **locateSection refactor risk:** if `contentLines` is extracted from the load-bearing `locateSection`, keep it behavior-preserving and covered by existing section tests; otherwise add the helper standalone.

## Implementation Notes

## Review Findings

Reviewed by codex-task:read-only (gpt-5.5) on the implement commit (worktree). A security_audit specialty pass ran separately (PASS).

- [P2] `src/tickets.js:872,906,912` — `parseCommentLine` strands a trailing `\r` when callers split CRLF text on `\n`: `COMMENT_LINE_RE` captures the CR into `rest`, so a marked no-body line parses with `body === "\r"` and legacy unmarked bodies gain a `\r` suffix. Normalize one terminal `\r` before returning; add CRLF tests for marked, unmarked, and marker-block-at-end lines.
- [P3] `docs/comment-markers.md:55` — the `executor` example value `claude-subagent:local-board-designer` contains `:`, which `MARKER_VALUE_RE` (src/cli.js:1236) and `MARKER_TOKEN_RE` (src/tickets.js:875) reject. Change the example to a legal value or document a legal encoding.

Passed: takeAllOptions mirrors takeOption semantics; unmarked render byte-identical; ordered marker rendering; per-ticket fence-aware validation; contentLines matches locateSection fence semantics (backtick/tilde, indented, unclosed).

Verdict: changes_requested

## Test Evidence

Verified by claude-subagent:local-board-tester (sonnet), in the ticket worktree.

### Repo-level checks

| Command | Result |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS — 398 tests, 397 pass, 0 fail, 1 skipped (pre-existing gated smoke) |
| `npm run validate` | PASS on this worktree's real board — fence-aware validator clean over all existing bracket-heavy tickets |

### Live CLI probes (throwaway scratchpad board, removed after)

- Two markers → exact `- <ts>: [step:x outcome:PASS] checked step` line, CLI order preserved. PASS.
- No markers → byte-identical pre-feature shape. PASS.
- Malformed (missing `=`, bad key charset, bad value charset with `:`, duplicate key) → each exit 2 with a named-offender message; ticket file SHA-256 identical before/after all four. PASS.
- Validate: clean board OK; hand-appended `[step:x` (unclosed) FAILS with actionable message; `[step:x bad]` FAILS naming the offending token and both grammars; same malformed line inside a ``` fence PASSES (fence-aware). A bare `[broken` with no key:value-shaped token is intentionally ignored per the looksIntended prose guard — correct, not a gap. PASS.
- `parseCommentLine` via node -e: marked round-trip correct; legacy line → empty markers + full body; CRLF line parses identically to LF with no `\r` in body; garbage and empty string return gracefully (never throws). PASS.

### Docs / README

All doc examples use legal charset values (no `:` in values); reserved-vocabulary table, not-evidence rule, and the CLI `=` ↔ disk `:` mapping present; README Documentation Index entry present.

### Caveats

None against acceptance. Malformed-line probe used node fs scripts on the disposable board only; worktree clean of tester changes.

Result: pass

## Documentation Updates

Documented by codex-task:workspace-write (gpt-5.5). docs/comment-markers.md + README index shipped at implement. Closing audit: docs/Workflow.md gained a one-sentence pointer to comment markers; memory-bank/systemPatterns.md fact tightened (repeatable --marker, strict charsets, [k:v] render, annotation-only, fence-aware validate); SKILL command blocks verified untouched and byte-identical.

## Questions

## Run Log

- 2026-07-08T20:16:33Z: Ensured git branch local-board/T20260708T2015Z-add-marker-flags-marker-parser-render-and-validate-rules-to-comment (already-current).

- 2026-07-08T20:23:13Z: Completed design via claude-subagent:local-board-designer@opus: Grammar: key=value CLI to key:value disk, strict charsets, no quoting v1, dup keys rejected; parseCommentLine + validateCommentMarkers fence-aware via contentLines walker; estimate 4 basis T1338

- 2026-07-08T20:24:36Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (internal CLI tooling design)

- 2026-07-08T20:24:37Z: Ensured git branch local-board/T20260708T2015Z-add-marker-flags-marker-parser-render-and-validate-rules-to-comment (already-current).

- 2026-07-08T20:36:45Z: Completed implement via claude-subagent:local-board-implementer@sonnet: takeAllOptions/parseMarkerFlags; renderMarkerBlock + parseCommentLine + fence-aware validateCommentMarkers; docs/comment-markers.md + README index; 10 tests; 394 pass + 1 skip; skill-sync green

- 2026-07-08T20:38:52Z: Completed security_audit via inline: PASS: strict anchored charsets on marker keys/values block Markdown/structure injection into ticket files; regexes linear (no ReDoS); no path/command construction from input; parser never throws; no data exposure

- 2026-07-08T20:38:53Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [security_audit] - completed inline with PASS

- 2026-07-08T20:41:43Z: Invalidated downstream evidence on loop-back to ready_for_implementation: removed completedSteps [implement:claude-subagent:local-board-implementer@sonnet, security_audit:inline, gate:implement:claude-subagent:local-board-gatecheck@haiku].

- 2026-07-08T20:41:43Z: Ensured git branch local-board/T20260708T2015Z-add-marker-flags-marker-parser-render-and-validate-rules-to-comment (already-current).

- 2026-07-08T20:44:26Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Rework: single-point trailing-CR normalization + 3 CRLF tests; executor doc example legalized with v1 colon-limitation note; 397 pass + 1 skip

- 2026-07-08T20:45:45Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (CRLF normalization rework; prior consultation ran security_audit inline PASS)

- 2026-07-08T20:45:46Z: Completed review via codex-task:read-only: changes_requested (P2 CRLF stranding, P3 illegal doc example) on impl commit; addressed in rework commit; recorded post-move per evidence-invalidation ordering

- 2026-07-08T20:50:59Z: Completed test via claude-subagent:local-board-tester@sonnet: 397 pass + 1 skip; live probes: render shapes, 4 malformed exit-2 no-write, validate catch/fence-pass, parseCommentLine CRLF clean; real-board validate green

- 2026-07-08T20:52:54Z: Completed document via codex-task:workspace-write: Workflow pointer + systemPatterns fact; SKILL blocks verified unchanged
