---
id: T20260711T2137Z
type: task
status: designing
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260711T2137Z-prompts-agents-return-only-and-mutation-ban-hardening-across-specialty-prompts-and-claude-reviewer-tester
estimate: 2
estimateBasis: T20260711T2136Z
workStartedAt: null
workCompletedAt: null
created: 2026-07-11T21:36:10Z
updated: 2026-07-11T23:39:32Z
completedSteps: []
routingApprovals: []
---
# prompts/agents: return-only and mutation-ban hardening across specialty prompts and claude reviewer/tester

## Requirement

From the prompt-library review of 2026-07-11 (items 2, 9, 10, 11): return-only and mutation-ban drift across prompts and agent definitions, including one real exposure.

1. [Item 9, the exposure] agents/claude/local-board-reviewer.md L23 and agents/claude/local-board-tester.md L22 ban only the `section` command, while the codex variants ban all local-board mutations. With a session-wide Bash(local-board *) allow rule, a prompt-injected ticket could steer these return-only agents into complete-step/move/comment. Replace with: do not run any mutating local-board command (section, comment, complete-step, move, estimate, gate-complete); read-only queries (query-ticket, list) are fine.
2. [Item 2] The five optional-step specialty prompts have no return-only clause; they run on codex-task:read-only or inline routes. Add under each Output Contract: you are read-only and return-only - return the JSON verdict as your message; do not write files or run any local-board command; the Recording section describes what the orchestrator does afterward.
3. [Item 10] plans/prompts/steps/decompose.md L9 states "link parent and children in front matter" unconditionally, contradicting its own Persistence section which forbids return-only executors from running link commands. Reword: parent/child links are recorded in front matter (by whoever the Persistence section below assigns).
4. [Item 11] agents/codex/local-board-gatecheck.md L30-37 shows a fenced json example directly under an output rule saying "No prose, no code fences". Replace the fenced block with the inline shape the claude variant uses.

### Scope

- Edits per above; npm run sync-resources for the plans/prompts files (specialty prompts + decompose.md); agents/ files need no sync. Full node --test per AGENTS.md.

### Acceptance criteria

- Claude and codex reviewer/tester mutation bans are equivalent in coverage.
- All five specialty prompts carry the return-only clause; decompose.md no longer self-contradicts; codex gatecheck example obeys its own no-fence rule.
- npm run check and node --test pass; resources mirror synced.

### Non-goals

- No permission-rule (settings) changes; no new CLI enforcement — this is prompt/agent-text hardening only.

## Acceptance Criteria

## Related Tickets

## Technical Design

Prompt/agent-text hardening only. Four independent edits across two agent
definitions and three prompt files (five specialty prompts + decompose.md), plus
one resources mirror sync. No production code, config, or permission-rule changes.
All edits are line-disjoint from the in-flight sibling B20260711T2136Z, which
touches only the specialty prompts' Recording lines and estimate.md.

### Item 1 - Claude reviewer/tester mutation ban (the exposure)

Both claude return-only agents currently ban only the `section` CLI, while the
codex variants already ban all local-board mutations generically ("Do not run
local-board mutation commands" + a section/complete-step/move example). Broaden
the claude Rules line to match, enumerating the full mutating set and explicitly
allowing read-only queries.

`agents/claude/local-board-reviewer.md`, Rules bullet (currently L23). Replace the
substring:

- from: `Do not edit files, do not create files, and do not run the local-board section CLI.` (the word `section` is inline-code in the file)
- to: `Do not edit files, do not create files, and do not run any mutating local-board command (section, comment, complete-step, move, estimate, gate-complete); read-only queries (query-ticket, list) are fine.` (each command name inline-code, as the file already styles `section`)

`agents/claude/local-board-tester.md`, Rules bullet (currently L22). Replace the
substring:

- from: `Do not edit or create files, and do not run the local-board section CLI.`
- to: `Do not edit or create files, and do not run any mutating local-board command (section, comment, complete-step, move, estimate, gate-complete); read-only queries (query-ticket, list) are fine.`

In both files, preserve the rest of the bullet verbatim: the leading "You have
only Read, Glob, Grep, and Bash - no Write or Edit tool" clause, the trailing
Bash-write warning ("Do not write file content through Bash..."), and the
tester's "If a code fix is needed, report it..." tail. Keep the existing
inline-code backticks on each command name to match the file's current style for
`section`. Do NOT touch the Output section's headings/fence warning sentence that
T20260711T2136Z added (reviewer L39, tester L37) - that is a different section.

After this edit both claude and codex reviewer/tester ban the full mutation set,
satisfying the "equivalent in coverage" acceptance. The codex variants already
cover all mutations via their generic "mutation commands" wording, so no codex
edit is required; the claude enumeration is a superset of the codex example list
and does not contradict it.

### Item 2 - Return-only clause in the five specialty prompts

Files (all under `plans/prompts/optional-steps/`):
- `design/security_threat_model.md`
- `design/ui_component_review.md`
- `design/ux_interaction_review.md`
- `impl/security_audit.md`
- `impl/ui_visual_review.md`

Each has an Output Contract section (a "Strict JSON only..." line, a fenced JSON
schema, and three PASS/CONCERNS/FAIL bullets) followed by a Recording section.
Add one canonical clause as a new final paragraph of the Output Contract section,
immediately after the "FAIL: at least one Critical or High finding." bullet and
before the Recording heading. Exact text (identical in all five):

`You are read-only and return-only - return the JSON verdict as your message; do not write files or run any local-board command; the Recording section describes what the orchestrator does afterward.`

Placement rationale: this paragraph sits inside Output Contract and is separated
from the Recording line by the intervening Recording heading, so it is strictly
line- and paragraph-disjoint from the "complete-step ... --executor ... --model"
Recording line that B20260711T2136Z rewrites. The two siblings edit different
regions of the same five files, so the later rebase auto-merges cleanly. The
clause text also avoids B2136Z's pinned substrings (it contains "local-board
command" but not the "--executor <executor> --model <model> --evidence" Recording
form, nor "calibration suggest"/"estimate").

### Item 3 - decompose.md self-contradiction

`plans/prompts/steps/decompose.md`, Rules list (currently L9). Replace:

- from: `- link parent and children in front matter;`
- to: `- parent/child links are recorded in front matter (by whoever the Persistence section below assigns);`

This removes the unconditional imperative that contradicts the Persistence
section (which forbids return-only executors from running link commands and
assigns creation/linking to the orchestrator/inline role). Do NOT touch the
Persistence bullet at L18 or its requirementBody guidance that T20260711T2136Z
added; the L9 edit is disjoint from it.

### Item 4 - codex gatecheck fenced-json-under-no-fences example

`agents/codex/local-board-gatecheck.md`, Output section (currently L30-38).
The rule "Return strict JSON only. No prose, no code fences, no trailing
comments." is immediately followed by a fenced example that violates it: a
"Shape:" line, then a ```json fenced block containing
`{ "requestedSteps": ["<step-name>"] }`, then "The array may be empty."

Replace the "Shape:" line and the fenced block with the inline-backtick form the
claude sibling `agents/claude/local-board-gatecheck.md` already uses (its L46):

- to: a single line `Shape: {backtick}{ "requestedSteps": ["<step-name>", ...] }{backtick}` where {backtick} is a literal backtick, i.e. the JSON object rendered as inline code, matching the claude variant exactly including the `, ...` ellipsis.

Keep the trailing "The array may be empty." line. Result obeys the section's own
no-code-fences rule and matches the claude variant's shape. This is the only
fenced-block removal; the JSON stays as inline code.

### Affected files

- `agents/claude/local-board-reviewer.md` (item 1) - no sync
- `agents/claude/local-board-tester.md` (item 1) - no sync
- `agents/codex/local-board-gatecheck.md` (item 4) - no sync
- `plans/prompts/optional-steps/design/security_threat_model.md` (item 2) - sync
- `plans/prompts/optional-steps/design/ui_component_review.md` (item 2) - sync
- `plans/prompts/optional-steps/design/ux_interaction_review.md` (item 2) - sync
- `plans/prompts/optional-steps/impl/security_audit.md` (item 2) - sync
- `plans/prompts/optional-steps/impl/ui_visual_review.md` (item 2) - sync
- `plans/prompts/steps/decompose.md` (item 3) - sync

### Sync and test strategy

- After the six `plans/prompts/*` edits (items 2 and 3), run `npm run
  sync-resources`. `scripts/sync-resources.mjs` mirrors `plans/prompts` and
  `plans/templates` into `resources/` byte-for-byte, and
  `test/resources-sync.test.js` fails otherwise. The three `agents/*` files
  (items 1 and 4) are NOT under `plans/prompts` or `plans/templates`, so they
  need no sync.
- Run the FULL suite `node --test` plus `npm run check` per AGENTS.md (prompt and
  agent text is under content-assertion tests).

### Pin / test-assertion findings

- No test content-asserts the claude reviewer/tester ban sentences (grep of
  `test/` found only unrelated "mutating" usages and check-dispatch
  `--agent local-board-reviewer` value references, not file-text assertions).
  Item 1 is safe.
- No test content-asserts the specialty prompts' Output Contract or Recording
  prose in this worktree; `test/cli.test.js` references these files only by PATH
  (e.g. `plans/prompts/optional-steps/impl/security_audit.md`) via specialty-run
  and catalog fixtures. Item 2's added paragraph does not change any path.
- The only prompt content assertions in `test/cli.test.js` pin the estimate
  prompt substrings `local-board calibration suggest` and `local-board estimate`;
  none of the four items touch `estimate.md`, so they are unaffected.
- `test/resources-sync.test.js` is the binding check for items 2 and 3 - it goes
  green iff `npm run sync-resources` is run after the edits.

### B20260711T2136Z disjointness (explicit)

This worktree branched after T2136Z and T2138Z merged but before B2136Z. B2136Z
edits (a) the five specialty prompts' Recording line (adds `--model` and an
omit-when-null parenthetical) and (b) `estimate.md`. This ticket's item-2 edits
add a paragraph to the same five files' Output Contract sections - a different,
non-adjacent region separated by the Recording heading - and touches neither the
Recording line nor `estimate.md`. Both siblings therefore modify disjoint line
ranges; the post-merge rebase auto-merges without conflict. Sequencing is not
required in either direction.

### Risks and edge cases

- Rebase-order risk is the main one; mitigated by the disjoint-region design
  above. If a future edit moved the Recording heading adjacent to the new
  paragraph, re-verify disjointness before merge.
- Claude vs codex wording asymmetry: the claude ban enumerates six mutating
  commands while codex lists three as examples under a generic "mutation
  commands" ban. Coverage is equivalent (both ban all mutations); the enumerated
  claude list is intentionally the more explicit form and is not a contradiction.
  If reviewers prefer strict symmetry, a follow-up could align the codex example
  list, but that is out of this ticket's scope (Non-goals: text hardening only).
- Formatting guard: all five specialty prompts and decompose.md must keep their
  existing structure; the added clause and reworded bullet introduce no new
  headings. The gatecheck edit removes a fenced block rather than adding one.

### Test plan / acceptance mapping

1. Claude and codex reviewer/tester bans equivalent -> item 1 broadens claude to
   the full mutation set; verify by reading both variants' Rules sections.
2. All five specialty prompts carry the return-only clause -> item 2; grep the
   five files for the canonical sentence.
3. decompose.md no longer self-contradicts -> item 3; L9 now defers to the
   Persistence section.
4. Codex gatecheck example obeys its own no-fence rule -> item 4; no fenced block
   remains under the "No prose, no code fences" rule.
5. `npm run check` and `node --test` pass; `resources/` mirror synced -> run
   `npm run sync-resources` then the full suite.

### Open questions

None. Requirement wording is explicit for all four items.

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
