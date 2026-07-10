---
id: T20260710T1223Z
type: task
status: ready_for_design
priority: P2
parent: S20260710T1206Z
children: []
blockedBy: [T20260710T1222Z]
blocks: []
branch: local-board/T20260710T1223Z-design-review-skill-and-docs-updates-for-both-flows
estimate: 2
estimateBasis: T20260710T1222Z
workStartedAt: 2026-07-10T14:16:04Z
workCompletedAt: null
created: 2026-07-10T12:20:26Z
updated: 2026-07-10T14:21:53Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
routingApprovals: []
---
# design-review: skill and docs updates for both flows

## Requirement

The single-ticket flow (SKILL.md, skills/codex/local-board/SKILL.md) and the local-team flow (SKILL_TEAM.md, skills/codex/local-team/SKILL.md) must document the design-review step, its verdict handling, and the FAIL loop-back. docs/ narrative and the README index must stay in sync. Parent: S20260710T1206Z.

## Scope

- Update the four skill files: insert the design-review step between design (complete-step design) and the move to ready_for_implementation. Document: resolve via design-review-check, dispatch the reviewer through the returned route pinning model and passing effort, parse the PASS/CONCERNS/FAIL verdict, record evidence via design-review-complete using the resolved agent/model verbatim, and on FAIL move back to ready_for_design (findings as input) — noting loop-back evidence stripping. State that this is skipped on boards with requireDesignReview off. Add both commands to each skill's command reference.
- Update docs/ narrative (the routing/workflow doc that covers gate consultation) and the README Documentation Index if a new doc file is added.
- Update memory-bank/ only if a current-state fact changes (e.g. systemPatterns routing flags list).

## Acceptance criteria

- All four skill files describe the design-review step, verdict handling, FAIL loop-back, and the two new commands, consistent with the shipped CLI; test/skill-usage-sync.test.js passes.
- docs/ reflects the new step; README index updated if a doc file was added.
- npm run check and node --test pass.

## Non-goals

No code or config changes. No prompt authoring (sibling prompt task).

## Acceptance Criteria

## Related Tickets

## Technical Design

## Overview

Prose-and-test-only ticket: document the shipped design-review step in all four
skill files, add the two new commands to the two curated CLI Commands blocks
(byte-identically), extend the skill-usage sync test to assert the intended
command surface, and add a design-review narrative to `docs/Workflow.md`. No
production source changes. All mechanism (the `requireDesignReview` flag +
`moveTicket` precondition + `recordDesignReview`, the `design_review.md` prompt,
and the `design-review-check` / `design-review-complete` CLI verbs) already
shipped in the three merged blockers; this task only describes it and locks the
command surface with a test.

## Related Tickets

- **T20260710T1220Z (done, merged base):** `routing.requireDesignReview` flag
  (scaffold `true`, back-compat `false`), the design→implementation `moveTicket`
  precondition, `recordDesignReview`, the `design-review` token producing-status
  = `ready_for_design` (so a loop-back to `ready_for_design` strips it), and the
  flag-off inertness. Source of the FAIL-loop-back stripping behavior this doc
  must describe.
- **T20260710T1221Z (done, merged base):** `plans/prompts/steps/design_review.md`
  (+ `resources/` mirror). Its reviewer returns a **first-line TEXT verdict**
  (`PASS` / `CONCERNS` / `FAIL`), not JSON — the doc must say "parse the first
  line", never `JSON.parse`.
- **T20260710T1222Z (done, merged base):** `design-review-check` (resolver, no
  dispatch, refuses flag-off) and `design-review-complete` (recorder passthrough)
  CLI verbs; already added `docs/Workflow.md` MVP command examples + one-liner and
  the `memory-bank/systemPatterns.md` CLI inventory. Its Run Log carries the
  deferred review finding that is this ticket's core scope (curated CLI Commands
  blocks + sync-test extension). Basis for the estimate.
- **Parent S20260710T1206Z:** design-review story.
- No conflicts: this ticket edits only `SKILL.md`, `skills/codex/local-board/SKILL.md`,
  `SKILL_TEAM.md`, `skills/codex/local-team/SKILL.md`, `test/skill-usage-sync.test.js`,
  and `docs/Workflow.md`. No overlap with any open ticket.

## The design-review step (canonical description to document)

On a board with `routing.requireDesignReview: true` (the `init` scaffold
default), the design stage gains one required step between the design gate-check
and the forward move to `ready_for_implementation`:

1. `complete-step design ...` records the design evidence (estimate gate first,
   as today).
2. Design-stage gate-check runs as today (`gate-check --stage design`,
   `gate-complete` when the catalog is non-empty).
3. Resolve the reviewer: `design-review-check <ticket-id> --root <worktree> --json`.
   It returns `agent` (route, default `codex-task:read-only`), `model`
   (`gpt-5.6-sol`), `effort` (`xhigh`), the resolved `prompt`
   (`plans/prompts/steps/design_review.md`), and a narrow `ticketContext`. It
   performs no dispatch and stamps nothing.
4. Dispatch the reviewer through the returned `agent` route, pinning `model` and
   passing `effort`: for a `codex-task:*` route pass `--model <model>` and
   `--reasoning-effort <effort>`; for a `claude-subagent:*` route pin the model at
   dispatch and pass effort as the subagent effort option. Hand it the resolved
   `prompt` and `ticketContext`. The reviewer is read-only and return-only.
5. Parse the **first line** of the reviewer's reply — exactly one verdict token,
   `PASS` / `CONCERNS` / `FAIL` — followed by any numbered findings. Do not
   `JSON.parse`; the verdict contract is first-line TEXT.
6. Record the verdict as evidence with the resolved executor/model verbatim:
   `design-review-complete <ticket-id> --executor <agent> --model <model>
   --evidence "<VERDICT>: <summary>" --root <worktree>`. This records the
   `design-review:<executor>@<model>` token and unblocks the forward move. Omit
   `--model` only when the resolver returned a null model.
7. Verdict handling:
   - **PASS / CONCERNS** → proceed: `move <ticket-id> ready_for_implementation`.
     CONCERNS are advisory; the orchestrator may proceed at its judgment.
   - **FAIL** → `move <ticket-id> ready_for_design` and re-run the design with the
     findings as input. The loop-back strips the `design-review` token (its
     producing status is `ready_for_design`), and — with
     `invalidateOnLoopBack: true` (scaffold default) — also strips the `design`
     evidence, so the redesigned ticket must re-record fresh `design` and
     `design-review` evidence before it can advance again. This is why FAIL is
     recorded then looped rather than skipped.
8. **Flag-off boards:** when `routing.requireDesignReview` is off,
   `design-review-check` refuses with a flag-naming message and the
   design→implementation move is not gated. Skip the entire step on such boards.

## Affected files and exact insertion points

### 1. `SKILL.md` (Claude single-ticket)

**(a) New narrative section.** Insert a new `## Design Review` section
immediately after the `## Specialty Steps` section (after the current last
paragraph ending "...then retry the move.") and before `## Delegation`. Body:
the 8-point step description above, condensed to skill voice, and modeled on the
existing gate-consultation paragraph. Must state: runs between the design
gate-check and the `ready_for_implementation` move; resolve via
`design-review-check`; dispatch through the returned route pinning `model` and
passing `effort` (`--reasoning-effort` for `codex-task`); parse the first-line
`PASS`/`CONCERNS`/`FAIL` verdict (not JSON); record via `design-review-complete`
using the resolved `agent`/`model` verbatim; on FAIL `move ... ready_for_design`
with findings as input, noting the loop-back strips both the design-review and
design tokens; skipped (and `design-review-check` refuses) when
`routing.requireDesignReview` is off.

**(b) CLI Commands block.** In the ` ```sh ` block under `## CLI Commands`,
insert two lines immediately after the `local-board specialty-run <ticket-id>
<step-name> [--json]` line:

```
local-board design-review-check <ticket-id> [--json]
local-board design-review-complete <ticket-id> --executor <executor> [--model <model>] --evidence "<evidence>" [--json]
```

(`--allow-main-root` is intentionally omitted to match the block's existing
convention — `gate-check`/`gate-complete`/`specialty-run` also omit it; the
subset test keys on command name only.) These two lines must be **byte-identical**
to the lines added to `skills/codex/local-board/SKILL.md` (test enforces it).

### 2. `skills/codex/local-board/SKILL.md`

**(a) New narrative section.** Insert a `## Design Review` section immediately
after `## Gate-Check and Specialty Steps` (after the `requireGateConsultation`
paragraph) and before `## Done and Auto-Merge`. Same content as SKILL.md's
section, in Codex voice (dispatch the `codex-task:read-only` reviewer with
`--model` / `--reasoning-effort`, or translate a `claude-subagent:` reviewer route
via `codexDispatch`). Same first-line-verdict, record-then-move / FAIL-loop-back,
and flag-off skip notes.

**(b) CLI Commands block.** Insert the **same two lines** (byte-identical to
SKILL.md) immediately after the `local-board specialty-run <ticket-id> <step-name>
[--json]` line in the ` ```sh ` block under `## CLI Commands`.

### 3. `SKILL_TEAM.md` (Claude parallel)

Add the design-review step to the per-ticket pipeline description. In the
`## Control loop` step **4 ("On completion")**, extend the bullet that reads
"Run gate-check + specialty-run for `design`/`implement`/`test` stages ... before
transitioning" (or add an adjacent bullet) so it states: for the `design` stage,
after gate-check and before moving to `ready_for_implementation`, when
`routing.requireDesignReview` is on, resolve `design-review-check`, dispatch the
returned reviewer route (pin model, pass effort), parse the first-line
`PASS`/`CONCERNS`/`FAIL` verdict, record via `design-review-complete` with the
resolved executor/model, and on FAIL `move ... ready_for_design` with findings as
input (loop-back strips design + design-review evidence). Skipped on flag-off
boards. No CLI Commands block exists in the team skill (commands live in the
single-ticket skill), so no command-block edit here.

### 4. `skills/codex/local-team/SKILL.md`

Same as SKILL_TEAM.md: in `## Wave-Barrier Scheduling` step **4** ("Persist each
result, record `complete-step`, run gate-check/specialty flow for
design/implement/test, then `move`"), add the design-review step for the design
stage with the same verdict/record/FAIL-loop-back/flag-off notes, in Codex voice.
No CLI Commands block here either.

### 5. `test/skill-usage-sync.test.js` (sync-test extension)

Add a new test asserting the **intended command surface** (the reviewer's
suggestion: require the surface, not only block identity — byte-identity alone
does not catch both files dropping a command in lockstep). Additive; reuses the
existing `extractSkillBlock` / `extractSkillBlockCommandNames` helpers:

```js
const REQUIRED_COMMANDS = ["design-review-check", "design-review-complete"];

test("each skill's CLI Commands block documents the required design-review command surface", async () => {
  for (const file of SKILL_FILES) {
    const source = await readFile(file, "utf8");
    const block = extractSkillBlock(source, file);
    const blockNames = new Set(extractSkillBlockCommandNames(block, file));
    for (const required of REQUIRED_COMMANDS) {
      assert.ok(
        blockNames.has(required),
        `${file} CLI Commands block is missing required command "${required}"; add it to the curated CLI Commands block`,
      );
    }
  }
});
```

Rationale for a small, design-review-scoped `REQUIRED_COMMANDS` rather than
asserting the full usage surface: the deferred finding is specifically about the
two design-review commands, and pinning the whole surface would couple the test
to every future usage-line addition (the existing subset test already guards the
other direction — no block command may be absent from usage). Keep the list
minimal and focused on the intended new surface.

### 6. `docs/Workflow.md` (narrative)

T1222Z already added the two MVP command examples (lines 127-128) and a one-line
description (line 146). What remains missing is a **design-review narrative
section paralleling the gate-consultation narrative**. Add a new `## Design
Review` section between `## Optional Steps` (ends at the `specialty-run` JSON
block) and `## Estimation`. It should cover, in `docs/` narrative voice:

- `routing.requireDesignReview` (scaffold default `true`, back-compat `false`)
  gates the `ready_for_design`/`designing` → `ready_for_implementation` forward
  move on a recorded `design-review:<executor>` token (parallel to the
  `requireGateConsultation` gate); backward/lateral/archive/done moves are never
  gated; flag-off boards are inert.
- The step order: after `complete-step design` and the design gate-check, resolve
  `design-review-check` (route/model/effort + `plans/prompts/steps/design_review.md`
  prompt + narrow ticketContext, no dispatch), dispatch the codex reviewer
  (default `codex-task:read-only` @ `gpt-5.6-sol` / `xhigh`) with the model +
  effort pins.
- The verdict contract: reviewer returns a first-line `PASS`/`CONCERNS`/`FAIL`
  token (reference `plans/prompts/steps/design_review.md`); record it via
  `design-review-complete`; PASS/CONCERNS proceed, FAIL loops back to
  `ready_for_design`.
- Loop-back interaction: a FAIL loop-back to `ready_for_design` strips the
  `design-review` token (producing status `ready_for_design`) and, with
  `invalidateOnLoopBack`, the `design` token too, so re-design must re-record both
  (cross-reference the existing "Loop-back evidence invalidation" subsection).

**README:** no new doc file is warranted — the narrative extends the existing
`docs/Workflow.md`, so the README Documentation Index needs no change.

**memory-bank:** no change. `systemPatterns.md` already lists
`routing.requireDesignReview` in the routing-flag facts (line 27), its
back-compat default (line 42), and the `design-review-check`/`design-review-complete`
CLI inventory entries (lines 250, 252). No current-state fact changes here.

## Risks and edge cases

- **Byte-identity break.** The two CLI Commands blocks must stay byte-identical;
  the two new lines must be inserted at the same position with identical text
  (including the `"<evidence>"` quoting and `[--json]`) in both files.
  `test/skill-usage-sync.test.js` "byte-identical" test is the backstop.
- **Subset-surface break.** Every command name in a block must exist in
  `usageCommandNames()`. `design-review-check` / `design-review-complete` are both
  in `USAGE_TEXT` (verified src/cli.js:1614-1615), so the existing subset test
  passes; the extraction regex `[a-z][a-z-]*` matches the hyphenated names.
- **Verdict mis-documentation.** Must document first-line TEXT parsing, never
  JSON — the design-review prompt (unlike gate-check/specialty) returns TEXT.
- **Over/under-scoping the FAIL note.** Must state that FAIL loop-back strips both
  design and design-review evidence (not just design-review), else a reader might
  expect the design token to survive.
- **Flag-off ambiguity.** Must say the step is skipped and `design-review-check`
  refuses when the flag is off, so an orchestrator on a legacy board does not loop
  on a refusal.
- **Team skills have no command block** — do not attempt to add a CLI Commands
  block there; only the two single-ticket skills carry (and sync) it.

## Test plan

- `node --test test/skill-usage-sync.test.js` — all four existing tests still
  pass (same command-name set in both blocks, byte-identical blocks, subset of
  usage, non-empty), plus the new required-surface test passes for both files.
- `node --test` (full suite) — green at the tracked `install.test.js`
  B20260710T1232Z baseline (2 pre-existing failures unrelated to this change).
- `npm run check` — clean (prose + one test file; lint/format only).
- `node ./bin/local-board.js validate --root <worktree>` — Ticket validation OK.
- Manual spot check: confirm the two inserted CLI Commands lines are identical
  across `SKILL.md` and `skills/codex/local-board/SKILL.md` (diff the blocks), and
  that each skill file's `## Design Review` narrative names `design-review-check`,
  `design-review-complete`, the first-line verdict, the FAIL loop-back, and the
  flag-off skip.

## Open questions

None blocking. One judgment call recorded above: the CLI Commands lines omit
`--allow-main-root` to match the existing `gate-check`/`gate-complete`/
`specialty-run` block convention (the subset/byte-identity tests are unaffected
either way); an implementer may include it if a later reviewer prefers full
surface parity.

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-10T13:53:38Z: Deferred review finding from T20260710T1222Z (terra@high): the curated CLI Commands blocks in SKILL.md and skills/codex/local-board/SKILL.md must gain design-review-check and design-review-complete (byte-identical), and consider the reviewer's suggestion to extend test/skill-usage-sync.test.js to require the intended command surface rather than only block identity.

- 2026-07-10T14:16:04Z: Ensured git branch local-board/T20260710T1223Z-design-review-skill-and-docs-updates-for-both-flows (already-current).

- 2026-07-10T14:21:09Z: Completed design via claude-subagent:local-board-designer@opus: Technical Design: prose+test-only; Design Review narrative in all four skill files with exact insertion points, byte-identical CLI Commands lines after specialty-run, REQUIRED_COMMANDS sync-test extension, docs/Workflow.md narrative; first-line TEXT verdict, FAIL loop-back semantics, flag-off skip documented. Estimate 2 (basis T20260710T1222Z, designer-recorded).

- 2026-07-10T14:21:53Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: none - skill prose, docs narrative, sync test
