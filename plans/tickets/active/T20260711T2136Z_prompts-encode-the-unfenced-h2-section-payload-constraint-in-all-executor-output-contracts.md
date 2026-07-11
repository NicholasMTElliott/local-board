---
id: T20260711T2136Z
type: task
status: designing
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260711T2136Z-prompts-encode-the-unfenced-h2-section-payload-constraint-in-all-executor-output-contracts
estimate: 2
estimateBasis: T20260710T2050Z
workStartedAt: null
workCompletedAt: null
created: 2026-07-11T21:36:10Z
updated: 2026-07-11T23:10:34Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
routingApprovals: []
---
# prompts: encode the unfenced-H2 section-payload constraint in all executor output contracts

## Requirement

From the prompt-library review of 2026-07-11 (items 6, 7, 8): the CLI now rejects section payloads containing unfenced lines starting with "## " (setTicketSection guard, shipped by B20260710T1532Z), but no prompt or agent definition warns the executors who author those payloads. This exact corruption occurred twice in the 2026-07-10 run (designer H2 payloads) and reappears every time a fresh executor invents H2 headings.

### Scope

1. Reviewer/tester output contracts — plans/prompts/roles/code_reviewer.md (Output and Persistence), plans/prompts/steps/test.md (Output and Persistence), agents/claude/local-board-reviewer.md, agents/claude/local-board-tester.md, agents/codex/local-board-reviewer.md, agents/codex/local-board-tester.md: add one sentence — use ### or deeper for internal headings and fence any literal "## " example lines; a payload containing an unfenced "## " line is rejected at persistence.
2. Decomposer requirementBody — agents/claude/local-board-decomposer.md, agents/codex/local-board-decomposer.md (Proposal format bullet), plans/prompts/steps/decompose.md (orchestrator branch): extend the requirementBody bullet — use ### or deeper for internal headings (e.g. ### Acceptance Criteria); never include an unfenced "## " line.
3. Designer heading ambiguity — plans/prompts/steps/design.md (L17-19), agents/claude/local-board-designer.md (step 1), agents/codex/local-board-designer.md (Persist rule): replace "the complete ## Technical Design section body" phrasing with "the section body only - do not include the heading line itself (local-board manages the heading), and fence any literal ## sample lines".
4. npm run sync-resources for the plans/prompts files; agents/ files need no sync. Full node --test per AGENTS.md.

### Acceptance criteria

- Every executor role that authors section payloads or requirementBody content carries the H3+ / fence warning in its output contract.
- No content-assertion test regressions; resources mirror synced; npm run check and node --test pass.

### Non-goals

- No change to the setTicketSection guard itself; no restructuring of the prompts beyond the added sentences.

## Acceptance Criteria

## Related Tickets

## Technical Design

### Summary

Documentation-only change across nine prompt/agent files. Add a short warning to
every executor output contract that authors a section payload or `requirementBody`,
telling authors to use `###`+ for internal headings and to fence any literal
double-hash sample lines, because the CLI persistence guard rejects an unfenced
double-hash line. No production code changes; the guard itself is out of scope.

### What the guard actually enforces (verified against `src/tickets.js`)

`setTicketSection` (L1328) trims the payload then calls
`assertPayloadHasNoSectionHeading` (L1318) before writing. That function walks the
payload with the fence-aware `contentLines` helper and throws if any content line
matches `SECTION_HEADING_RE = /^## (.+?)\s*$/` (L1211). Precise consequences, which
the warning must state correctly:

- A line beginning with exactly two hashes plus a space is rejected (leading,
  trailing, or embedded).
- Three-or-more-hash headings are legal: the regex anchor requires a space as the
  third character, and an H3 line has a hash there, so it never matches.
- A double-hash line inside a triple-backtick / tilde fence is legal: `contentLines`
  tracks fence state and skips fenced lines (same walker `locateSection` uses at
  L2856). Inline-code mentions (double-hash inside backticks mid-line) are also fine
  because the line does not start with the pattern.
- The thrown message is the authoritative user-facing text: `section payload must
  not contain a Markdown "## " heading line; pass only the section body (local-board
  manages the heading). Fence any literal "## " sample lines.` The new warnings
  should echo this phrasing so prompt and runtime error agree.

### Canonical warning sentence

One canonical sentence, reused verbatim for group 1 and lightly re-tailored for
group 2 (audience: `requirementBody` authors). Written so it contains no
line-leading double-hash and fences nothing (the double-hash tokens sit inside
inline backticks, which is legal in both the prompt file and any payload):

Group 1 (reviewer/tester payloads):
`Use `###` or deeper for any internal headings and fence any literal `## ` sample
lines; a payload containing an unfenced `## ` line is rejected at persistence.`

Group 2 (decomposer `requirementBody`), same rule, tailored noun:
`In `requirementBody`, use `###` or deeper for internal headings (e.g.
`### Acceptance Criteria`) and never include an unfenced `## ` line; the
persistence guard rejects it.`

### Group 1 — reviewer/tester output contracts (6 files)

Append the canonical group-1 sentence at the end of each file's output/persistence
block. Anchors:

- `plans/prompts/roles/code_reviewer.md` — `### Output and Persistence` (currently
  `## Output and Persistence`, L19-21); append after the existing persistence
  sentence (L21).
- `plans/prompts/steps/test.md` — `Output and Persistence` block, after L19.
- `agents/claude/local-board-reviewer.md` — `Output` section; append after the
  final line L37 (`The orchestrator persists this content; do not write it
  yourself.`). Deliberately placed in Output, NOT in the Rules ban line L23 — see
  sibling coordination below.
- `agents/claude/local-board-tester.md` — `Output` section; append after L35.
- `agents/codex/local-board-reviewer.md` — `Output` section; append after L36.
- `agents/codex/local-board-tester.md` — `Output` section; append after L34.

### Group 2 — decomposer `requirementBody` (3 files)

Extend the `requirementBody` proposal bullet (or, for the step file, the
orchestrator persistence branch) with the group-2 sentence. Anchors:

- `agents/claude/local-board-decomposer.md` — `Proposal format`, the
  `requirementBody:` bullet at L35; append the group-2 sentence to that bullet.
- `agents/codex/local-board-decomposer.md` — same bullet at L36.
- `plans/prompts/steps/decompose.md` — `Persistence` section, orchestrator branch
  bullet at L18 (the branch that persists the Requirement body via
  `section <child-id> --file`); append the group-2 sentence there. The return-only
  executor that actually authors the body receives the same rule through the two
  decomposer agent-def bullets above.

### Group 3 — designer heading ambiguity (3 files)

Replace the phrasing that tells the author to persist a "complete double-hash
Technical Design section body" (which reads as "include the heading line"). The
replacement must not carry an unfenced double-hash token; the chosen wording avoids
the token entirely rather than fencing it:

Replacement clause: `the section body only - do not include the heading line itself
(local-board manages the heading), and fence any literal ## sample lines.`

Anchors:

- `plans/prompts/steps/design.md` — `Output and Persistence`, L17-18. Reword the
  sentence `Persist the complete `## Technical Design` section body as Markdown with
  section --file...` to persist the section body only, per the replacement clause.
  This is in the persistence block; it does NOT touch the `Include:` list (L5-11) —
  see sibling coordination.
- `agents/claude/local-board-designer.md` — self-write step 1, L39: `Compose the
  complete `## Technical Design` section body as Markdown.` becomes compose the
  section body only, per the replacement clause.
- `agents/codex/local-board-designer.md` — `Persist` rule, L26. This line already
  avoids the offending token (it uses `--section "Technical Design"`), so there is
  no phrase to replace; instead append the body-only + fence clarification so the
  Codex designer carries the same guidance as its Claude sibling.

### Sibling-ticket coordination (avoid line collisions)

- `T20260711T2137Z` edits `agents/claude/local-board-reviewer.md` and
  `local-board-tester.md` (the section-command ban line — reviewer L23, tester L22)
  and `steps/decompose.md` (the link rule at Rules L9). This ticket's group-1
  insertions live in the `Output` section (reviewer after L37, tester after L35),
  and its group-2 decompose insertion lives in the `Persistence` orchestrator branch
  (L18). Different lines/paragraphs; no textual overlap. If both land in the same
  branch the two changes are independent hunks.
- `T20260711T2138Z` edits `steps/design.md` adding loop-back guidance under the
  `Include:` list. This ticket's group-3 design edit is in `Output and Persistence`
  (L17-18). Different section; no collision.

### Content-assertion and sync exposure (verified against `test/`)

- No test pins the prose of any of the nine target files. All hits for
  `local-board-reviewer`/`-tester`/`-designer`/`-decomposer` in `test/active-steps.test.js`
  and `test/cli.test.js` are route-name string pins (e.g.
  `claude-subagent:local-board-designer`), unaffected by added sentences.
- The only prompt-content assertion is on a non-target file:
  `test/cli.test.js:3357-3361` asserts `plans/prompts/steps/estimate.md` includes
  `local-board calibration suggest`. Not touched here.
- `test/skill-usage-sync.test.js` targets `SKILL.md` / `SKILL_TEAM.md` and skill
  files, none of which are targets here.
- `test/resources-sync.test.js` byte-mirrors `plans/prompts` to `resources/prompts`.
  The four `plans/prompts/**` targets (`roles/code_reviewer.md`, `steps/test.md`,
  `steps/decompose.md`, `steps/design.md`) therefore REQUIRE
  `npm run sync-resources` after editing, or that test fails. The five `agents/**`
  targets have no mirror and need no sync.

### Risks and edge cases

- Guard-vs-warning drift: if a future edit weakens the guard (e.g. to also reject
  H3), the warnings would be wrong. Low risk; guard is explicitly out of scope and
  the warning quotes the guard's own semantics.
- Fence self-reference: the warning text itself mentions the double-hash pattern.
  Kept inside inline backticks so the sentence is legal even if it were ever fed
  through the guard, and so the prompt renders cleanly.
- Missed sync is the most likely failure mode; `test/resources-sync.test.js` catches
  it deterministically, so it cannot ship silently.
- Wording that reads as "include a heading" must not creep back in; group 3 removes
  every "section body"-with-heading phrasing.

### Test strategy

- `npm run sync-resources` after the `plans/prompts/**` edits.
- Full `node --test` per AGENTS.md (prompt/agent text is asserted by content tests),
  not just guard suites.
- `npm run check`.
- Spot-verify the two edited `plans/prompts` files equal their `resources/prompts`
  mirrors (implicitly covered by `resources-sync.test.js`).

### Documentation impact

None beyond the prompt/agent files themselves. No `docs/`, `README.md`, or
`memory-bank/` change: this documents an already-shipped guard (B20260710T1532Z) at
the point of use, and adds no new command or file to index.

### Open questions

None blocking. The exact insertion wording is specified above; implementer may
adjust punctuation to match each file's surrounding voice without changing meaning.

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-11T23:09:19Z: Completed design via claude-subagent:local-board-designer@opus: Canonical H3+/fence warning sentence for reviewer/tester Output blocks (6 files), requirementBody tailoring (3 files), design.md L17-18 + designer defs body-only reword; guard semantics verified against src/tickets.js SECTION_HEADING_RE L1211/L1318 (H2-only, fence-aware); no prose pins on targets (sole prompt pin is estimate.md cli.test.js:3357); 4 plans/prompts files need sync, 5 agents/ files do not; disjoint anchors from T2137Z (ban lines, decompose L9) and T2138Z (Include list).

- 2026-07-11T23:10:34Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: none (prose-only prompt/agent edits)
