---
id: T20260711T2138Z
type: task
status: ready_for_docs
priority: P4
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260711T2138Z-prompts-operational-reality-gaps-sandbox-commit-fallback-orchestrator-obligations-loop-back-re-design-guidance-routing-pin-drift
estimate: 2
estimateBasis: T20260710T2050Z
workStartedAt: 2026-07-11T23:12:17Z
workCompletedAt: null
created: 2026-07-11T21:36:10Z
updated: 2026-07-11T23:25:58Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "design-review:codex-task:read-only@gpt-5.6-sol", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", "review:codex-task:read-only@gpt-5.6-terra", "test:claude-subagent:local-board-tester@sonnet", gate:test:skipped-empty-catalog]
routingApprovals: []
---
# prompts: operational-reality gaps - sandbox commit fallback, orchestrator obligations, loop-back re-design guidance, routing-pin drift

## Requirement

From the prompt-library review of 2026-07-11 (items 3, 12, 13, 15): operational realities learned in the 2026-07-10/11 runs that the prompts do not yet encode.

1. [Item 3] plans/prompts/steps/document.md L17 (Commit scope), agents/codex/local-board-documenter.md L28, agents/codex/local-board-implementer.md L28: the commit instruction is unsatisfiable for codex workspace-write executors on Windows (sandbox denies git commit against the main repo .git; observed on every docs step across two runs — the orchestrator commits instead). Append to each Commit scope block: if the sandbox denies git commit, do not retry - list the exact intended paths in your returned summary and the orchestrator commits them on the ticket branch.
2. [Item 12] plans/prompts/roles/orchestrator.md encodes none of the run-learned orchestrator obligations. Add two bullets under Responsibilities: (a) persist return-only executor output yourself via Write + section --file; never ask a return-only executor to write files; (b) after a loop-back to a ready_* status, downstream evidence AND gate/design-review consultations are stripped - re-run the affected steps and gates before the next forward move.
3. [Item 13] plans/prompts/steps/design.md never tells the designer to address loop-back findings. Add under Include: on a re-design after a loop-back, read the Review Findings, Test Evidence, and Run Log design-review comments for the findings that caused it and address each explicitly. (Note: reference the Run Log design-review comments, NOT a "Design Review" section - B20260710T2051Z established that flow.)
4. [Item 15] plans/prompts/steps/design_review.md L4 hardcodes "default pin gpt-5.6-sol @ xhigh reasoning", which silently drifts from config. Reword to: routed per the design-review agent profile in plans/local-board.config.jsonc.

### Scope

- Edits per above; npm run sync-resources (document.md, orchestrator.md, design.md, design_review.md are all under plans/prompts); agents/ files need no sync. Verify the B20260710T2051Z content assertion on design_review.md still passes after the L4 reword. Full node --test per AGENTS.md.

### Acceptance criteria

- Codex documenter/implementer prompts describe the sandbox-commit fallback; orchestrator role prompt carries both obligations; design.md covers re-design after loop-back with the correct persistence references; design_review.md no longer pins a model in prose.
- npm run check and node --test pass; resources mirror synced.

### Non-goals

- No behavior/CLI changes; no changes to the design-review verdict contract or routing config.

## Acceptance Criteria

## Related Tickets

## Technical Design

Four independent prose edits across four prompt/agent files. No behavior, CLI, schema, or config changes. All edits are append/insert or single-sentence rewords with stable anchors.

### Group 1 — sandbox git-commit fallback (3 files)

One canonical fallback idea, tailored to each file's return-section vocabulary. All three targets already end their Commit-scope block with the identical sentence "...ticket-scoped outputs elsewhere under `plans/**` may be staged by exact path."

- `plans/prompts/steps/document.md` — Commit scope paragraph (currently L17). Anchor: append to the sentence ending "may be staged by exact path." Add: "If the sandbox denies `git commit`, do not retry — list the exact intended paths in your returned summary and the orchestrator commits them on the ticket branch." (uses "returned summary" to match this step's persistence wording).
- `agents/codex/local-board-documenter.md` — Commit scope bullet (L28). Anchor: same "may be staged by exact path." tail. Add: "If the sandbox denies `git commit`, do not retry; list the exact intended paths in your Output and the orchestrator commits them on the ticket branch." (uses "your Output" to match this agent's `## Output` section).
- `agents/codex/local-board-implementer.md` — Commit scope bullet (L28). Anchor: same tail (note this file's variant reads "...or intended hunks when a file also contains unrelated edits..."; the trailing "may be staged by exact path." is still unique). Add the same "...in your Output..." sentence as the documenter.

Rationale for the tailoring: the step prompt's return artifact is the "returned summary"; the two codex agent files each define a `## Output` block, so "your Output" is the faithful reference in those two.

### Group 2 — orchestrator obligations (`plans/prompts/roles/orchestrator.md`)

Anchor: the `Responsibilities:` list (L7-13), terminating at "- keep changes small and reviewable." Insert two new bullets appended to that list (before the "Do not hide state transitions in prose." line):

- "persist return-only executor output yourself with `Write` + `section --file`; never ask a return-only executor to write files;"
- "after a loop-back to a `ready_*` status, downstream evidence and gate/design-review consultations are stripped — re-run the affected steps and gates before the next forward move."

These encode the run-learned obligations verbatim from Requirement item 12. The loop-back bullet is consistent with the already-tested invalidation behavior (tickets.test.js "Invalidated downstream evidence on loop-back...").

### Group 3 — re-design loop-back guidance (`plans/prompts/steps/design.md`)

Anchor: the `Include:` bullet list (L5-11), which currently ends with "- open questions." Append one bullet:

- "on a re-design after a loop-back, read the `Review Findings`, `Test Evidence`, and Run Log design-review comments for the findings that caused it, and address each explicitly."

Deliberately references the Run Log design-review comments (NOT a `Design Review` section): B20260710T2051Z established that design-review outcomes land in the Run Log via `design-review-complete`, and the current `design_review.md` persistence paragraph confirms "there is no `Design Review` section and none is required." This wording stays consistent with that contract.

### Group 4 — de-hardcode the routing pin (`plans/prompts/steps/design_review.md`)

Anchor: the current L3-4 sentence "Routed to a codex reviewer (default pin gpt-5.6-sol @ xhigh reasoning)." Reword the parenthetical to profile-reference form:

"Routed to a codex reviewer per the design-review agent profile in `plans/local-board.config.jsonc`."

Verified `plans/local-board.config.jsonc` exists in the worktree. This removes the prose model/effort pin that silently drifts from config.

### Content-assertion exposure (all four groups)

Grepped `test/` for pins on the distinctive phrases of all four files:

- `design_review.md` — one content assertion, cli.test.js:3365 "design-review prompt describes the real persistence flow, not a phantom section". It asserts the text (a) includes "design-review-complete", (b) does NOT include "records the `` `## Design Review` `` section", and (c) normalized-includes "denies process spawning". The Group 4 reword touches only the L3-4 parenthetical; none of those three tokens live on that line, so the assertion still passes. Explicitly re-run after the edit to confirm.
- The `gpt-5.6-sol` / `xhigh` pins in cli.test.js (~L1558, L1571, L1850) come from `design-review-check` reading the routing config, NOT from prompt prose. The prose reword does not touch them.
- `document.md`, `orchestrator.md`, `design.md` — grep found only path-reference assertions (e.g. `configuredPrompt: "plans/prompts/steps/design.md"`) and loop-back behavior tests, no content pins on the Commit-scope / Responsibilities / Include prose being changed. Nothing breaks.

### Sync obligation

- `document.md`, `orchestrator.md`, `design.md`, `design_review.md` are all under `plans/prompts/`, which is mirrored byte-for-byte into `resources/prompts/` (asserted by resources-sync.test.js). After editing, run `npm run sync-resources` to refresh the mirror, or resources-sync.test.js fails.
- `agents/codex/local-board-documenter.md` and `agents/codex/local-board-implementer.md` are NOT under `resources/` (confirmed: `resources/` holds only `prompts/` and `templates/`), so they need no sync.

### Sibling-ticket coordination

Sibling T20260711T2136Z will also edit `design.md`, adding a heading-line warning near the "complete section body" wording in the Output and Persistence paragraph (L17-19). This Group 3 edit inserts under the `Include:` list (L5-11) only. The two edits touch disjoint line ranges, so they should merge cleanly; if both land on the same branch base, verify no overlap when integrating.

### Risks and edge cases

- Low risk overall: prose-only, additive edits with unique anchors.
- The implementer.md Commit-scope bullet has extra "intended hunks" text mid-sentence; anchor on the unique trailing "may be staged by exact path." to avoid mismatching the documenter variant.
- The two group-1 agent edits are unsynced; do not accidentally expect sync-resources to cover them.
- Ordering: run `npm run sync-resources` before `node --test`, since the mirror drift check runs in the suite.

### Test strategy

1. Apply all four groups.
2. `npm run sync-resources` (Group 1/2/3/4 prompt files).
3. `npm run check` and full `node --test` per AGENTS.md (prompt/agent files are production artifacts with content-assertion tests).
4. Confirm cli.test.js:3365 passes (design_review persistence-flow assertion) and resources-sync tests pass.

### Open questions

None. Requirement text specifies exact insertions; anchors verified against current file contents.

## Implementation Notes

Applied all four groups exactly as designed, all four unique anchors matched on the first read (no drift from the design's line references).

- Group 1: appended the sandbox-commit-fallback sentence to the Commit-scope block in `plans/prompts/steps/document.md` ("in your returned summary" wording), `agents/codex/local-board-documenter.md`, and `agents/codex/local-board-implementer.md` ("in your Output" wording for the latter two).
- Group 2: added the two run-learned obligation bullets to `plans/prompts/roles/orchestrator.md` Responsibilities, before "Do not hide state transitions in prose."
- Group 3: appended the loop-back re-design bullet to the Include list in `plans/prompts/steps/design.md`, referencing `Review Findings`, `Test Evidence`, and Run Log design-review comments (not a "Design Review" section).
- Group 4: reworded `plans/prompts/steps/design_review.md` L3-4 to reference the design-review agent profile in `plans/local-board.config.jsonc` instead of hardcoding `gpt-5.6-sol @ xhigh`.

Ran `npm run sync-resources` to mirror the four `plans/prompts/**` edits into `resources/prompts/**` (the two `agents/codex/*` files are not mirrored, per design). `npm run check` passed. Full `node --test`: 587 tests, 586 pass, 1 skipped (pre-existing racing-CLI smoke skip), 0 fail. Explicitly re-ran `test/cli.test.js` and confirmed "design-review prompt describes the real persistence flow, not a phantom section" (~L3365) still passes after the Group 4 reword.

No deviations from the approved design.

## Review Findings

### Review round 1 (codex-task:read-only@gpt-5.6-terra, high, static)

Verdict: CONCERNS.

- [Low] document.md:17 and orchestrator.md:15 used an em-dash delimiter where the approved design specified ASCII " - ". Fixed in 58c2c13 (sources + mirrors, targeted suites 77/77 green).
- Verified clean: all four groups match designed text/anchors; four resource mirrors SHA-256-identical to sources; commits dd3acd8/6019a19 touch only designed paths (+ ticket file in the planning auto-commit); design_review.md content-assertion strings present/absent as required; sibling anchor zones untouched.

## Test Evidence

verdict: pass

### Commands run

- npm run check pass. node --test full suite: 587 tests, 586 pass, 0 fail, 1 pre-existing skip (smoke (slow)).
- Targeted: cli.test.js incl. the design-review persistence assertion (L3365) pass; resources-sync 4/4 incl. byte-for-byte mirror check.
- git show/name-only on dd3acd8, 6019a19, 58c2c13; diffs of all four source/mirror pairs; clean tree before/after.

### Acceptance criteria coverage

1. Sandbox-commit-fallback sentence present and audience-worded: document.md:17 (returned summary), codex documenter def :28 and codex implementer def :28 (your Output).
2. Both orchestrator obligations at orchestrator.md:14-15 (return-only persistence via Write + section --file; loop-back strips evidence AND consultations, re-run both).
3. design.md:12 Include bullet references Review Findings, Test Evidence, Run Log design-review comments; no other "Design Review" match in the file (no phantom section reference).
4. design_review.md:4-6 routing line now cites the design-review agent profile in plans/local-board.config.jsonc; grep finds no model/effort names in prose.
5. Em-dash Low fixed: no U+2014 in either edited file; ASCII " - " confirmed.
6. Mirror parity: all four plans/prompts vs resources/prompts pairs identical.
7. Diff scope: 11 files = 6 designed sources + 4 mirrors (agents/codex correctly unmirrored) + ticket markdown; commits contain no strays.

### Gaps / caveats

None. No isolation fallback needed; no probe edits made.

## Documentation Updates

## Questions

## Run Log

- 2026-07-11T23:08:24Z: Completed design via claude-subagent:local-board-designer@opus: Four groups designed: canonical sandbox-commit-fallback sentence appended per Commit-scope block (document.md + 2 codex agent defs); two orchestrator Responsibilities bullets; design.md Include-list loop-back bullet referencing Review Findings/Test Evidence/Run Log DR comments; design_review.md L3-4 pin reworded to profile reference. cli.test.js:3365 assertion verified unaffected; 4 prompts need sync-resources, agent defs unmirrored; disjoint lines from T2136Z's design.md edit.

- 2026-07-11T23:09:04Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: none (prose-only prompt/agent edits)

- 2026-07-11T23:12:15Z: Design review r1 (codex-task:read-only@gpt-5.6-sol, xhigh): PASS, no findings. Anchors, wording, config reference, test-pin isolation, sync coverage, sibling-line separation, requirement coverage all verified.

- 2026-07-11T23:12:16Z: Recorded design review via codex-task:read-only@gpt-5.6-sol: r1 PASS no findings

- 2026-07-11T23:12:17Z: Ensured git branch local-board/T20260711T2138Z-prompts-operational-reality-gaps-sandbox-commit-fallback-orchestrator-obligations-loop-back-re-design-guidance-routing-pin-drift (already-current).

- 2026-07-11T23:17:17Z: Completed implement via claude-subagent:local-board-implementer@sonnet: All four groups landed at designed anchors (sandbox-commit fallback x3, orchestrator bullets x2, design.md loop-back bullet, design_review.md pin reworded to config profile reference); sync-resources run, 4 mirrors identical, agents/codex unmirrored; npm run check clean; node --test 586/587 pass 1 pre-existing skip; cli.test.js:3365 design_review assertion re-verified green. Commits dd3acd8 + 6019a19.

- 2026-07-11T23:18:01Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: none (prose edits + mirror sync)

- 2026-07-11T23:18:02Z: Ensured git branch local-board/T20260711T2138Z-prompts-operational-reality-gaps-sandbox-commit-fallback-orchestrator-obligations-loop-back-re-design-guidance-routing-pin-drift (already-current).

- 2026-07-11T23:22:47Z: Completed review via codex-task:read-only@gpt-5.6-terra: r1 CONCERNS (1 Low: em-dash vs designed ASCII delimiter in 2 files) fixed in 58c2c13 with mirrors re-synced; all groups/anchors/mirrors/assertions/sibling-zones verified clean.

- 2026-07-11T23:22:48Z: Ensured git branch local-board/T20260711T2138Z-prompts-operational-reality-gaps-sandbox-commit-fallback-orchestrator-obligations-loop-back-re-design-guidance-routing-pin-drift (already-current).

- 2026-07-11T23:25:56Z: Completed test via claude-subagent:local-board-tester@sonnet: verdict: pass. Full suite 586/587 pass 0 fail 1 pre-existing skip; all four groups cited by file:line; mirrors identical; em-dash fix verified; diff scope exactly 11 expected files.

- 2026-07-11T23:25:58Z: Ensured git branch local-board/T20260711T2138Z-prompts-operational-reality-gaps-sandbox-commit-fallback-orchestrator-obligations-loop-back-re-design-guidance-routing-pin-drift (already-current).
