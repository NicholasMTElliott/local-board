---
id: B20260710T2051Z
type: bug
status: ready_for_test
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/B20260710T2051Z-prompts-design-review-md-instructs-recording-a-design-review-section-the-section-command-cannot-create
estimate: 2
estimateBasis: B20260710T2050Z
workStartedAt: 2026-07-11T20:44:50Z
workCompletedAt: null
created: 2026-07-10T20:50:03Z
updated: 2026-07-11T20:58:52Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "design-review:codex-task:read-only@gpt-5.6-sol", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", "review:codex-task:read-only@gpt-5.6-terra"]
routingApprovals: []
---
# prompts: design_review.md instructs recording a Design Review section the section command cannot create

## Requirement

Observed 2026-07-10 during the parallel run. plans/prompts/steps/design_review.md tells the executor "The orchestrator records the ## Design Review section", but the section command writes only STANDARD_SECTIONS (Requirement, Acceptance Criteria, Related Tickets, Technical Design, Implementation Notes, Review Findings, Test Evidence, Documentation Updates, Questions, Run Log) and refuses unknown section names - there is no Design Review section and no CLI way to create one. In practice the orchestrator recorded verdicts via comment (Run Log) plus design-review-complete evidence, which worked but contradicts the prompt.

### Scope

1. Decide the contract (design decides): (a) amend the prompt (and its resources/prompts mirror via npm run sync-resources) to say the orchestrator records the verdict via comment and design-review-complete evidence - the minimal fix; or (b) add "Design Review" to STANDARD_SECTIONS and the ticket template so the section command can persist full findings - the richer fix; weigh template churn on existing boards and validate implications (missing-section checks).
2. Implement the chosen contract; keep the verdict-first TEXT contract (PASS/CONCERNS/FAIL first line) unchanged.
3. Tests: prompt content assertion updated if (a); template/section/validate coverage if (b). Sync suites green.

### Acceptance criteria

- The design_review prompt and the CLI agree on where the review is persisted; a fresh scaffold plus the documented flow produces no dead-end instruction.
- npm run check and node --test pass.

### Non-goals

- No change to the design-review token, preconditions, or routing.

## Acceptance Criteria

## Related Tickets

## Technical Design

### Decision

Adopt **option (a)**: correct the `design_review.md` prompt to describe the real
persistence flow (verdict recorded by `design-review-complete`, which stamps the
completion token and appends the verdict to the Run Log), and mirror the change into
`resources/prompts`. Reject option (b) (adding a `Design Review` standard section).
Fold in the adjacent spawn-denial warning flagged by the 2026-07-11 prompt-library
review, since it lives in the same file and the same review-contract paragraph.

### Why the current instruction is a dead end

`plans/prompts/steps/design_review.md` (the "Return-only — you persist nothing"
paragraph, lines 80-87) tells the executor the orchestrator "records the
`Design Review` section and the completion evidence." Two facts make that
impossible / misleading:

- `STANDARD_SECTIONS` in `src/tickets.js:594-605` has no `Design Review` entry. The
  scaffold ships exactly these ten headings and nothing else (`buildTicketBody`
  template at `src/tickets.js:2549-2569`, mirrored in `plans/templates/ticket.md`
  and `resources/templates/ticket.md`).
- The `section` command is positional, not name-additive. `commandSection`
  (`src/cli.js:933-955`) calls `setTicketSection` -> `replaceSection`
  (`src/tickets.js:2943-2947`), which throws `section "Design Review" not found`
  whenever the heading does not already exist in the body. There is no CLI path
  that creates a new heading, so `section ... --section "Design Review"` can never
  succeed on a scaffolded ticket.

What actually persists the verdict today is `design-review-complete`
(`recordDesignReview`, `src/tickets.js:1608-1694`): it adds the design-review token
to `completedSteps` and appends a Run Log line
`- <ts>: Recorded design review via <executor>: <evidence>` (lines 1662-1683). So
the durable record is Run Log + `completedSteps` token, exactly what orchestrators
have been doing (five rounds this run persisted cleanly this way). The prompt is
the only thing out of step with the code.

### Why not option (b)

Adding `"Design Review"` to `STANDARD_SECTIONS` is a migration cliff, not a tidy
enrichment:

- `validateTicketShape` (`src/tickets.js:1992-1996`) iterates `STANDARD_SECTIONS`
  and emits `missing ## <name> section` for any ticket lacking the heading. That
  loop runs for **every** status. Unlike the duplicate-heading pass just below it
  (`src/tickets.js:2014`, carved out for closed statuses), the missing-section loop
  has no closed-status exemption. Adding the section would therefore make every
  existing ticket lacking the heading, including current done/archived tickets,
  fail `validate`, `preflight`, and closeout until each is edited to add an empty
  heading.
- Template churn in three synchronized places (`buildTicketBody` in `src/tickets.js`,
  `plans/templates/ticket.md`, `resources/templates/ticket.md`) plus a
  `sync-resources` run, and new `validate`/section-count test coverage.
- It is redundant. The verdict is already durably recorded by
  `design-review-complete` in the Run Log and `completedSteps`. A dedicated section
  would duplicate that record and invite drift between the two.

The verdict-first TEXT contract (PASS/CONCERNS/FAIL) and the return-only reviewer
role are unchanged either way; option (a) needs no code change at all.

### Change 1 — rewrite the persistence paragraph

In `plans/prompts/steps/design_review.md`, replace the final paragraph under the
`Return-only — you persist nothing` heading. Current text:

```text
You run on a read-only route. You do NOT write files, edit the ticket, or run any
mutating local-board command (`section`, `comment`, `complete-step`, `move`,
`estimate`, `gate-complete`). Return the verdict and findings as your message
only. The orchestrator records the `## Design Review` section and the completion
evidence, and decides whether a FAIL loops the ticket back to design. Do not run
tree-wide or history/branch-mutating git commands inside the worktree.
```

Replacement text (verbatim target):

```text
You run on a read-only route. You do NOT write files, edit the ticket, or run any
mutating local-board command (`section`, `comment`, `complete-step`, `move`,
`estimate`, `gate-complete`). Your route may even be a sandbox that denies process
spawning entirely, so do not attempt to run any command beyond reading the files
named above; if the sandbox denies a read you need, still emit a verdict-first
response (the first line is PASS, CONCERNS, or FAIL) and list the inputs you could
not read as findings-context, rather than trying to work around the denial. Return
the verdict and findings as your message only. The orchestrator persists the
outcome by running `design-review-complete`, which stamps the design-review
completion token and appends your verdict to the ticket's Run Log — there is no
`Design Review` section and none is required. The orchestrator decides whether a
FAIL loops the ticket back to design. Do not run tree-wide or
history/branch-mutating git commands inside the worktree.
```

Notes on the wording:
- Drops the phantom `Design Review` section claim; names the real command
  (`design-review-complete`) and the real sink (Run Log + completion token).
- The spawn-denial sentence is folded into the same paragraph (in scope: same file,
  same review-contract paragraph, flagged independently on 2026-07-11). It
  reinforces the existing "do NOT run any mutating command" line by covering the
  stricter codex read-only sandbox where even benign spawns are denied.
- The denial branch stays inside the verdict-first contract: an access failure is
  never a fourth verdict token. The reviewer always emits PASS/CONCERNS/FAIL on the
  first line and records any input it could not read as findings-context, so the
  output shape the orchestrator parses is preserved even under a hostile sandbox.
- Keeps `section`/`comment`/etc. in the do-not-run list so the reviewer still never
  mutates; only the *description of what the orchestrator does afterward* is fixed.

### Change 2 — sync the resources mirror

`resources/prompts/steps/design_review.md` must match byte-for-byte. Run
`npm run sync-resources` after editing `plans/prompts/steps/design_review.md`.
`resources-sync.test.js` (`resources/prompts mirrors plans/prompts byte-for-byte`,
lines 58-60) fails otherwise. No template mirror is touched.

### Change 3 — pin the corrected instruction with a content assertion

No content-assertion pin currently guards `design_review.md`; existing test
references are path/behavior assertions only (`test/cli.test.js` around lines
1560-1894 assert the resolved prompt *path*, not its text). Add one prompt-content
test modeled on the estimate-prompt test at `test/cli.test.js:3347-3363`:

- Read `plans/prompts/steps/design_review.md`.
- Assert it `includes("design-review-complete")` (the real recorder).
- Assert it does **not** include the phantom instruction, e.g.
  `assert.ok(!stepText.includes("records the `## Design Review` section"))`, or more
  robustly assert the absence of the substring `## Design Review` outside a fenced
  sample. Prefer pinning the positive signal (`design-review-complete` present) plus
  a negative guard on the exact old phrase `records the` + `Design Review section`.
- Optionally assert it mentions the spawn-denial guard (e.g. `includes("denies
  process spawning")`) so that fold-in cannot silently regress.

Because the assertion reads `plans/` (the source of truth), it also indirectly
guards the mirror via the separate `resources-sync` byte check.

### Cross-reference audit

Grep of the repo for other artifacts describing where a design review is persisted,
to confirm this change leaves no contradictory instruction behind (verified
2026-07-11):

- `SKILL.md`, `SKILL_TEAM.md`, `skills/codex/local-board/SKILL.md`, and
  `skills/codex/local-team/SKILL.md` already describe persistence via
  `design-review-complete`. They are consistent with the corrected prompt and need
  no edit.
- Hits inside optional-step prompt files are section *titles* only (they name the
  design-review step, they do not instruct writing a `Design Review` section), so
  they are out of scope.
- `agents/` has no hit for a `Design Review` section or a
  `records the ## Design Review section` instruction — nothing to correct there.

Scope: none of these files change under this ticket. The only phantom-section
instruction lives in `design_review.md`, which Change 1 fixes.

### Affected files

- `plans/prompts/steps/design_review.md` — reword the persistence paragraph
  (Change 1). Production prompt artifact.
- `resources/prompts/steps/design_review.md` — regenerated by `npm run
  sync-resources` (Change 2). Do not hand-edit.
- `test/cli.test.js` — add the prompt-content assertion (Change 3).
- No change to `src/tickets.js`, `src/cli.js`, templates, config, or any `SKILL*.md`
  / `agents/` file (see Cross-reference audit).

### Test plan

- `npm run sync-resources` then confirm no drift.
- `node --test` full suite (CLAUDE.md requires the full suite after any
  `plans/prompts` edit, not just guard suites). Expect green, including
  `resources-sync.test.js` and the new content assertion.
- `npm run check` (lint + tests per the acceptance criteria).
- Manual acceptance walk: scaffold a fresh ticket (`local-board new ...`), confirm
  its body has no `Design Review` heading, then confirm the documented flow
  (`design-review-check` -> reviewer returns verdict -> `design-review-complete
  ... --evidence <verdict>`) records the verdict in the Run Log and completion
  token with no dead-end `section` call. This satisfies "prompt and CLI agree; a
  fresh scaffold plus the documented flow produces no dead-end instruction."

### Risks and edge cases

- Low blast radius: a prompt wording change plus one test; no runtime code path
  changes, so routing, the design-review token, and preconditions are untouched
  (non-goal respected).
- Mirror drift is the main failure mode; forgetting `sync-resources` fails
  `resources-sync.test.js`. The new content test reads `plans/`, so both must agree.
- Backtick fragility: the replacement paragraph contains inline backticks
  (`` `design-review-complete` ``, `` `Design Review` ``). The prompt file is edited
  with the Edit tool (not shell redirection), and the temp file for any `section`
  write is produced with the Write tool, avoiding the heredoc/backtick hazard noted
  in project memory.
- Content assertion brittleness: pin on the stable substring `design-review-complete`
  and a negative guard on the removed phrase rather than on an entire sentence, so
  future harmless copy edits do not break it.

### Documentation impact

None required. The prompt is the user-facing description of the flow; no `docs/` or
`memory-bank/` file documents a `Design Review` section (there was never one). The
`SKILL*.md` files already describe the `design-review-complete` flow (see
Cross-reference audit), so they stay authoritative and unchanged.

### Open questions

None blocking. The spawn-denial sentence is included as an in-scope adjacent fix per
the brief; if the orchestrator wants it excluded, drop that one sentence from Change
1 and the optional third assertion in Change 3 — the rest of the design stands
unchanged.

## Implementation Notes

Implemented option (a) as designed (r1-patched), verbatim replacement text applied to
`plans/prompts/steps/design_review.md`'s "Return-only — you persist nothing" paragraph:
dropped the phantom `## Design Review` section claim, named the real recorder
(`design-review-complete`, which stamps the completion token and appends the verdict to
the Run Log), and folded in the spawn-denial guidance with the verdict-first-compatible
fallback (unreadable inputs listed as findings-context, never a fourth verdict token).

Ran `npm run sync-resources`; `resources/prompts/steps/design_review.md` now matches
`plans/prompts/steps/design_review.md` byte-for-byte (git diff of both files identical).

Added a new content-assertion test in `test/cli.test.js` ("design-review prompt describes
the real persistence flow, not a phantom section"), modeled on the existing
estimate-prompt assertion: positive check for `design-review-complete`, negative check for
the removed phrase `records the \`## Design Review\` section`, and a normalized-whitespace
check for the folded-in spawn-denial guidance (`denies process spawning`).

No changes to `agents/`, `src/`, templates, config, or `SKILL*.md` — none needed per the
design's cross-reference audit.

Verification: `npm run check` (syntax checks) clean; full `node --test` suite: 577 tests,
576 pass, 1 pre-existing skip (the racing-CLI smoke test), 0 fail.

Commit `8e2b08c` on branch
`local-board/B20260710T2051Z-prompts-design-review-md-instructs-recording-a-design-review-section-the-section-command-cannot-create`,
staged by explicit path (`plans/prompts/steps/design_review.md`,
`resources/prompts/steps/design_review.md`, `test/cli.test.js`).

## Review Findings

### Review round 1 (codex-task:read-only@gpt-5.6-terra, high, static)

Verdict: PASS, no findings.

- plans/prompts/steps/design_review.md:83 - replacement matches the r1-patched design: names design-review-complete, Run Log, completion token; retains return-only; explicitly states no Design Review section exists; denied reads stay within a PASS/CONCERNS/FAIL-first response as findings-context. Verdict-contract wording unchanged; no residual phantom-section instruction anywhere in the prompt.
- resources/prompts/steps/design_review.md:83 byte-identical to plans copy. test/cli.test.js:3365 assertions focused (recorder presence, phantom-phrase absence, spawn-denial guidance) per the estimate-prompt idiom, no full-prose pinning. Commit 8e2b08c contains exactly the three expected files.

## Test Evidence

verdict: pass

### Commands run

- npm run check clean. node --test full suite: 577 tests, 576 pass, 0 fail, 1 pre-existing skip (smoke (slow)).
- Targeted rerun (design-review prompt / resources mirror / estimate-prompt patterns): 19/19 pass.
- diff plans vs resources design_review.md: identical.
- grep "Design Review" in the prompt: only the step title (L1) and the explicit negation "there is no Design Review section and none is required" (L92) - no recording instruction remains.
- git show 8e2b08c -- test/cli.test.js: one new test block (L3365-3385), estimate-prompt test (L3347-3363) byte-unchanged. Worktree clean before/after.

### Acceptance criteria coverage

- Prompt/CLI agreement: prompt L80-94 names design-review-complete (Run Log + token) as the recorder; STANDARD_SECTIONS (src/tickets.js:594-605) confirmed still lacks Design Review; section remains only in the reviewer's forbidden-mutations list (L83). Dead end closed.
- Verdict-first contract preserved: L55-60 unchanged; spawn-denial fallback (L84-88) keeps failures inside PASS/CONCERNS/FAIL as findings-context, no fourth token.
- npm run check and node --test pass (above).

### Test-quality check

New assertion pins contract-level substrings only (positive design-review-complete, negative exact removed phrase, whitespace-normalized spawn-denial check). No full-sentence pinning; existing assertions untouched.

### Gaps / caveats

None. No spawn fallback needed. Fresh-scaffold walk not separately re-run (prompt-text-only change; static grep + STANDARD_SECTIONS check sufficient).

## Documentation Updates

## Questions

## Run Log

- 2026-07-11T20:36:25Z: Completed design via claude-subagent:local-board-designer@opus: Option (a) chosen: reword design_review.md persistence paragraph to the real comment + design-review-complete flow; option (b) rejected because validateTicketShape's missing-section check has no closed-status exemption (would fail ~40 legacy tickets). Files: prompt + resources mirror via sync-resources + new cli.test.js content pin (design-review-complete present, phantom section phrase absent). Spawn-denial warning folded into same paragraph. No src/template change.

- 2026-07-11T20:37:07Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: none (prompt reword + content-assertion test)

- 2026-07-11T20:41:45Z: Design review r1 (codex-task:read-only@gpt-5.6-sol, xhigh): CONCERNS. 1) [Med] Change 1's 'if a needed read is itself denied, report that and stop' branch is incompatible with the verdict-first contract (environmental failure is not PASS/CONCERNS/FAIL) - keep static-review guidance, drop the branch or define a contract-compatible blocker response. 2) [Low] cross-reference grep audit not documented in the design - record that the four skills already describe design-review-complete persistence, optional-prompt hits are titles only, agents/ clean; scope out explicitly. 3) [Low] soften 'every existing ticket on every board' to 'every existing ticket lacking the heading, incl. current done/archived'. Option (a), assertion design, and sync-resources requirement all confirmed correct. Designer patching; proceedable after patch without a new review round.

- 2026-07-11T20:44:49Z: Completed design via claude-subagent:local-board-designer@opus: Option (a) design, r1-patched: denial branch now verdict-first-compatible (unreadable inputs listed as findings-context); cross-reference audit recorded (four skills consistent via design-review-complete, prompt hits titles-only, agents/ clean); option-(b) rejection phrasing softened. Files: design_review.md + resources mirror + cli.test.js content pin.

- 2026-07-11T20:44:49Z: Recorded design review via codex-task:read-only@gpt-5.6-sol: r1 CONCERNS (1 Med contract-compat branch + 2 Low wording) all patched by designer; option (a), assertion design, sync-resources requirement confirmed correct; proceed

- 2026-07-11T20:44:50Z: Ensured git branch local-board/B20260710T2051Z-prompts-design-review-md-instructs-recording-a-design-review-section-the-section-command-cannot-create (already-current).

- 2026-07-11T20:48:23Z: Completed implement via claude-subagent:local-board-implementer@sonnet: design_review.md phantom-section instruction replaced with real flow (design-review-complete records Run Log + token) + verdict-first-compatible spawn-denial guidance; sync-resources run, mirror byte-identical; new cli.test.js content pin (positive design-review-complete, negative phantom phrase, spawn-denial presence). npm run check clean; node --test 576/577 pass 1 pre-existing skip. Commit 8e2b08c.

- 2026-07-11T20:49:01Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: none (prompt reword + mirror sync + content-assertion test; no executable code)

- 2026-07-11T20:49:02Z: Ensured git branch local-board/B20260710T2051Z-prompts-design-review-md-instructs-recording-a-design-review-section-the-section-command-cannot-create (already-current).

- 2026-07-11T20:56:24Z: Completed review via codex-task:read-only@gpt-5.6-terra: r1 PASS no findings: replacement wording matches patched design, mirror byte-identical, focused content assertions, commit scope exact.

- 2026-07-11T20:56:25Z: Ensured git branch local-board/B20260710T2051Z-prompts-design-review-md-instructs-recording-a-design-review-section-the-section-command-cannot-create (already-current).
