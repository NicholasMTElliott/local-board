---
id: T20260711T2136Z
type: task
status: implementing
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260711T2136Z-prompts-encode-the-unfenced-h2-section-payload-constraint-in-all-executor-output-contracts
estimate: 2
estimateBasis: T20260710T2050Z
workStartedAt: 2026-07-11T23:18:33Z
workCompletedAt: null
created: 2026-07-11T21:36:10Z
updated: 2026-07-11T23:23:00Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "design-review:codex-task:read-only@gpt-5.6-sol", "implement:claude-subagent:local-board-implementer@sonnet"]
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

Documentation-only change across twelve target files: 4 under `plans/prompts/`
(`roles/code_reviewer.md`, `steps/test.md`, `steps/decompose.md`, `steps/design.md`)
and 8 under `agents/` (the claude and codex reviewer, tester, decomposer, and
designer defs). Add a short warning to
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

- A column-zero line of the form two-hashes-space-then-content is rejected
  (leading, trailing, or embedded). The regex is line-anchored and requires at
  least one content character after the space, so two edge cases do NOT match and
  are accepted by the guard: a delimiter-only double-hash line (two hashes and a
  space with no following content) and an indented double-hash line (any leading
  whitespace before the hashes defeats the `^##` anchor).
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
inline backticks, which is legal in both the prompt file and any payload).

Deliberate scope note: the sentence's "an unfenced `## ` line is rejected"
phrasing is intentionally a simpler and slightly STRICTER authoring rule than the
exact runtime guard. The guard ignores the two edge cases above (delimiter-only and
indented double-hash lines), but authors should still never emit any column-zero
double-hash line; teaching the simpler rule avoids a false sense that "sometimes a
double-hash line is fine". This is a chosen over-approximation, not an error in the
description of the guard.

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
replacement clause does contain a mid-line double-hash token (`... fence any literal
## sample lines`), but that is persistable and prompt-legal because the guard's
regex is line-anchored: the token sits mid-line, not at column zero, so it never
matches `^## `. So the goal is not to avoid the token entirely but to keep every
double-hash token off the start of a line (here it is preceded by "fence any
literal "):

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

- No test pins the prose of any of the twelve target files. All hits for
  `local-board-reviewer`/`-tester`/`-designer`/`-decomposer` in `test/active-steps.test.js`
  and `test/cli.test.js` are route-name string pins (e.g.
  `claude-subagent:local-board-designer`), unaffected by added sentences.
- Prompt-content assertions exist but target non-target files: `test/cli.test.js:3356-3362`
  asserts `plans/prompts/steps/estimate.md` includes `local-board calibration
  suggest`/`local-board estimate`, and `test/cli.test.js:3365+` asserts
  `plans/prompts/steps/design_review.md` describes the real persistence flow. Neither
  file is edited here.
- `test/skill-usage-sync.test.js` targets `SKILL.md` / `SKILL_TEAM.md` and skill
  files, none of which are targets here.
- `test/resources-sync.test.js` byte-mirrors `plans/prompts` to `resources/prompts`.
  The four `plans/prompts/**` targets (`roles/code_reviewer.md`, `steps/test.md`,
  `steps/decompose.md`, `steps/design.md`) therefore REQUIRE
  `npm run sync-resources` after editing, or that test fails. The eight `agents/**`
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
- Spot-verify all four edited `plans/prompts` files (`roles/code_reviewer.md`,
  `steps/test.md`, `steps/decompose.md`, `steps/design.md`) equal their
  `resources/prompts` mirrors (implicitly covered by `resources-sync.test.js`).

### Documentation impact

None beyond the prompt/agent files themselves. No `docs/`, `README.md`, or
`memory-bank/` change: this documents an already-shipped guard (B20260710T1532Z) at
the point of use, and adds no new command or file to index.

### Open questions

None blocking. The exact insertion wording is specified above; implementer may
adjust punctuation to match each file's surrounding voice without changing meaning.

## Implementation Notes

Implemented the r1-patched design across 12 target files (4 `plans/prompts/**`, 8 `agents/**`), plus 4 synced `resources/prompts/**` mirrors.

### Group 1 (6 files) — reviewer/tester output contracts

Appended the canonical sentence `Use \`###\` or deeper for any internal headings and fence any literal \`## \` sample lines; a payload containing an unfenced \`## \` line is rejected at persistence.` to the Output/Persistence blocks of `plans/prompts/roles/code_reviewer.md`, `plans/prompts/steps/test.md`, `agents/claude/local-board-reviewer.md`, `agents/claude/local-board-tester.md`, `agents/codex/local-board-reviewer.md`, `agents/codex/local-board-tester.md`. Placed in the Output section per design, not on the claude Rules ban line (sibling T20260711T2137Z owns that line).

### Group 2 (3 files) — decomposer `requirementBody`

Extended the `requirementBody:` bullet in `agents/claude/local-board-decomposer.md` and `agents/codex/local-board-decomposer.md`, and the orchestrator Persistence branch in `plans/prompts/steps/decompose.md` (did not touch the L9 link rule, sibling-owned), with: `use \`###\` or deeper for internal headings (e.g. \`### Acceptance Criteria\`) and never include an unfenced \`## \` line; the persistence guard rejects it.`

### Group 3 (3 files) — designer heading ambiguity

Replaced `plans/prompts/steps/design.md`'s "Persist the complete `## Technical Design` section body" phrasing (Output and Persistence block; Include list untouched, sibling T20260711T2138Z owns it) and `agents/claude/local-board-designer.md` step 1 with: persist "the section body only - do not include the heading line itself (local-board manages the heading), and fence any literal ## sample lines." `agents/codex/local-board-designer.md`'s Persist rule already avoided the offending token, so the same clarification was appended rather than replacing anything.

### Verification

- `npm run sync-resources` mirrored the 4 `plans/prompts/**` sources to `resources/prompts/**`; the 8 `agents/**` files have no mirror.
- `npm run check`: pass.
- `node --test`: 587 tests, 586 pass, 1 pre-existing skip (smoke), 0 fail.
- Committed 16 files (12 sources + 4 mirrors) by explicit path on the ticket branch; no `plans/tickets/**` or wholesale `plans/**` staged.

No deviations from the r1-patched design.

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-11T23:09:19Z: Completed design via claude-subagent:local-board-designer@opus: Canonical H3+/fence warning sentence for reviewer/tester Output blocks (6 files), requirementBody tailoring (3 files), design.md L17-18 + designer defs body-only reword; guard semantics verified against src/tickets.js SECTION_HEADING_RE L1211/L1318 (H2-only, fence-aware); no prose pins on targets (sole prompt pin is estimate.md cli.test.js:3357); 4 plans/prompts files need sync, 5 agents/ files do not; disjoint anchors from T2137Z (ban lines, decompose L9) and T2138Z (Include list).

- 2026-07-11T23:10:34Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: none (prose-only prompt/agent edits)

- 2026-07-11T23:15:49Z: Design review r1 (codex-task:read-only@gpt-5.6-sol, xhigh): CONCERNS. 1) [Med] file counts wrong: Requirement names 12 targets (4 prompts + 8 agent defs); design says nine/five in places though the group lists cover all 12 - correct the counts. 2) [Med] warning sentence overstates the guard: /^## (.+?)\s*$/ rejects only column-zero H2 lines with content after the delimiter (delimiter-only and indented lines pass) - either match the guard precisely or frame the broader wording as an authoring rule, not runtime behavior. 3) [Low] group-3 self-compliance rationale says avoids the token entirely but the clause contains a mid-line two-hash token (persistable since regex is line-anchored) - fix the rationale wording. 4) [Low] assertion claim incomplete: cli.test.js:3365 also pins design_review.md content (conclusion unchanged - no target-prose pins). Anchors and sibling disjointness verified accurate. Designer patching; proceedable after patch without a new round.

- 2026-07-11T23:18:32Z: Completed design via claude-subagent:local-board-designer@opus: Rework: counts corrected to 12 targets (4 prompts + 8 agents) everywhere incl. test-strategy mirror check; guard precision added (column-zero two-hash-space-content only; canonical sentence explicitly framed as stricter authoring rule); group-3 rationale fixed (line-anchored regex, mid-line token fine); assertion inventory corrected (estimate + design_review pins, none on targets).

- 2026-07-11T23:18:32Z: Recorded design review via codex-task:read-only@gpt-5.6-sol: r1 CONCERNS (2 Med counts/guard-precision + 2 Low) all patched by designer; anchors and sibling disjointness verified; proceed

- 2026-07-11T23:18:33Z: Ensured git branch local-board/T20260711T2136Z-prompts-encode-the-unfenced-h2-section-payload-constraint-in-all-executor-output-contracts (already-current).

- 2026-07-11T23:23:00Z: Completed implement via claude-subagent:local-board-implementer@sonnet: All 12 targets + 4 mirrors landed (6 reviewer/tester Output blocks, 3 requirementBody bullets, 3 designer body-only rewords); sync-resources run; npm run check clean; node --test 586/587 pass 1 pre-existing skip. Commits 9dfbe0e (implementation, explicit paths) + 4e68f03 (Implementation Notes).
