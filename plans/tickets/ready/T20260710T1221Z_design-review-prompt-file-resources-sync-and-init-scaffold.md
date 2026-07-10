---
id: T20260710T1221Z
type: task
status: ready_for_docs
priority: P2
parent: S20260710T1206Z
children: []
blockedBy: []
blocks: [T20260710T1222Z]
branch: local-board/T20260710T1221Z-design-review-prompt-file-resources-sync-and-init-scaffold
estimate: 1
estimateBasis: T20260710T0037Z
workStartedAt: 2026-07-10T12:22:12Z
workCompletedAt: null
created: 2026-07-10T12:20:25Z
updated: 2026-07-10T12:51:13Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", "review:codex-task:read-only@gpt-5.6-terra", "test:claude-subagent:local-board-tester@sonnet", gate:test:skipped-empty-catalog]
routingApprovals: []
---
# design-review: prompt file, resources sync, and init scaffold

## Requirement

The design reviewer (parent S20260710T1206Z) dispatches through a prompt file, scaffolded into new boards and restored by init when missing. plans/prompts/ is the human-edited source of truth; resources/prompts/ is the packaged mirror produced by scripts/sync-resources.mjs and consumed by initProject (wholesale mirror — see test/prompt-scaffold.test.js).

## Scope

- Author plans/prompts/steps/design_review.md: a read-only review rubric for a codex reviewer inspecting the ## Technical Design against the ## Requirement / acceptance criteria. Cover: design flaws and internal contradictions; missing elements; acceptance-criteria coverage; testability; unstated assumptions. Specify a strict verdict output (PASS / CONCERNS / FAIL) plus findings, and state the reviewer is return-only (persists nothing itself).
- Run npm run sync-resources to regenerate resources/prompts/steps/design_review.md (LF-normalized) so the packaged tree matches.

## Acceptance criteria

- plans/prompts/steps/design_review.md exists, is non-empty, and states the PASS/CONCERNS/FAIL verdict contract and the five rubric dimensions above.
- resources/prompts/steps/design_review.md is a byte-for-byte (LF) mirror; the resources sync test passes.
- After local-board init, plans/prompts/steps/design_review.md is scaffolded; deleting it and re-running init restores it (add-missing-only behavior — no code change expected, but confirm the new file participates).
- npm run check and node --test pass.

## Non-goals

No CLI wiring or assertPromptExists call site (sibling CLI task). No rubric content beyond the review step.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Overview

Ship one new prompt file, `plans/prompts/steps/design_review.md`: a read-only
review rubric a codex reviewer (default pin `gpt-5.6-sol` @ `xhigh`) uses to
inspect a ticket's `## Technical Design` against its `## Requirement` /
acceptance criteria before the ticket may advance to implementation. Then run
`npm run sync-resources` so `resources/prompts/steps/design_review.md` is a
byte-for-byte (LF) mirror, which makes `initProject`'s wholesale mirror scaffold
and restore the file with **no code change**.

This ticket is prompt content + resource sync only. CLI wiring, config
`optionalSteps`/precondition entries, and any `assertPromptExists` call site are
the sibling CLI task (T20260710T1222Z) and are explicit non-goals here.

## Approach

### Prompt placement and format

- Location: `plans/prompts/steps/design_review.md` (a pipeline **step** prompt,
  alongside `design.md` / `gate-check.md` / `test.md`), per the ticket Scope —
  not `optional-steps/`, because design review is a stage-scoped required step in
  the parent story, not a gate-selected specialty.
- Output format: **text with a first-line verdict**, per the authoritative task
  brief (`PASS`/`CONCERNS`/`FAIL` on line one, then numbered findings with
  severity). This deliberately diverges from the strict-JSON contract the
  `optional-steps/design/*` reviewers use: the design-review reviewer runs on a
  `codex-task:read-only` route that returns prose, and a first-line verdict is the
  cheapest thing for the sibling CLI/orchestrator to parse. See Risks for the
  cross-ticket parsing contract this implies.
- The rubric covers the five required dimensions (design flaws/contradictions,
  missing elements, acceptance-criteria coverage, testability, unstated
  assumptions), the strict verdict contract, an explicit **return-only** clause
  (persists nothing; no file writes, no mutating CLI, no `section`/`complete-step`/
  `move`), and a **reachability guard** (do not file defects on inputs upstream
  validation already rejects — this exact miss caused a loop-back this week).
- Authored with LF endings and no triple-backtick fences inside (the verdict
  format uses 4-space indented blocks) so the packaged mirror stays clean on
  Windows checkouts.

### Drafted prompt content (ship this verbatim as `plans/prompts/steps/design_review.md`)

````markdown
# Design Review Step

Read-only review of a ticket's `## Technical Design` against its `## Requirement`
and acceptance criteria, before the ticket may advance to implementation. Routed
to a codex reviewer (default pin gpt-5.6-sol @ xhigh reasoning). The point is to
catch design-level defects now, while a re-design is cheap — not to loop back from
review or test after the work is built.

## Inputs

- The ticket file at the supplied path.
- The ticket's `## Requirement`, its acceptance criteria (whether under an
  `## Acceptance criteria` heading or embedded in the Requirement), and its
  `## Technical Design` section.
- Related context already in the ticket: `## Related Tickets`, stated non-goals,
  and any specs, prompts, config, or code paths the design points at.

You are reviewing the DESIGN, not the requirement and not an implementation. Do
not invent new scope or grade ambition. Judge one thing: whether the design, as
written, will correctly and completely satisfy the stated requirement and
acceptance criteria if it is implemented faithfully.

## Review dimensions

1. **Design flaws and internal contradictions** — logic that cannot work as
   described, steps that conflict with one another, or a chosen approach that
   defeats one of the design's own stated goals.
2. **Missing elements** — parts of the requirement or acceptance criteria the
   design does not account for: unhandled states, absent error/edge handling,
   config/schema/migration/scaffold gaps, or an undefined interface between two
   pieces the design introduces.
3. **Acceptance-criteria coverage** — walk each acceptance criterion in turn and
   confirm the design produces something that satisfies it. Name any criterion
   with no corresponding design element.
4. **Testability** — can the design's behavior be verified? Are the seams, hooks,
   and observable outcomes present, or is a proposed change unobservable or
   unfalsifiable as designed?
5. **Unstated assumptions** — reliance on unverified behavior, environment,
   ordering, or an upstream/downstream contract the design leans on without
   saying so. Surface the assumption; do not assume it holds.

## Reachability guard (read before you file anything)

Do NOT report a defect on an input or state that upstream validation, a schema
constraint, a type, or an earlier pipeline stage already rejects or makes
unreachable. Before filing a finding, trace whether the design — or the existing
code and config it builds on — can actually reach the condition you are worried
about. If a guard, precondition, schema check, or type already excludes the case,
it is not a finding. Reserve findings for defects that survive the system's
existing guarantees. (A recent review burned a loop-back doing exactly this:
flagging a case the schema had already excluded.)

## Verdict contract

Return TEXT, not JSON. The FIRST line is exactly one verdict token and nothing
else:

    PASS
    CONCERNS
    FAIL

Then, if there are findings, a numbered list, most severe first. Each finding is
one entry in this shape:

    <n>. [SEVERITY] <dimension>: <concrete observation>. Location: <ticket
       section or design heading>. Recommendation: <concrete fix>.

- SEVERITY is one of Critical / High / Medium / Low.
- **PASS** — no findings worth recording; the design satisfies the requirement
  and every acceptance criterion. The findings list is empty.
- **CONCERNS** — only Medium-or-below findings, none of them blocking. Worth
  recording; the ticket may still proceed at the orchestrator's judgment.
- **FAIL** — at least one Critical or High finding. The design must return to the
  design stage and resolve the findings before implementation.

Keep the verdict consistent with the findings: no Critical or High finding may
accompany PASS or CONCERNS, and a FAIL must list at least one Critical or High
finding.

## Return-only — you persist nothing

You run on a read-only route. You do NOT write files, edit the ticket, or run any
mutating local-board command (`section`, `comment`, `complete-step`, `move`,
`estimate`, `gate-complete`). Return the verdict and findings as your message
only. The orchestrator records the `## Design Review` section and the completion
evidence, and decides whether a FAIL loops the ticket back to design. Do not run
tree-wide or history/branch-mutating git commands inside the worktree.
````

### Resource sync and scaffold steps (implementation stage)

1. Create `plans/prompts/steps/design_review.md` with the content above (LF).
2. Run `npm run sync-resources` → regenerates `resources/prompts/steps/design_review.md`
   as an LF-normalized copy (see `scripts/sync-resources.mjs`: wholesale
   `rm` + recursive copy of `plans/prompts` → `resources/prompts`).
3. No scaffold/init code change. `initProject` copies the full packaged
   `resources/prompts` tree add-missing-only, so the new file is scaffolded into
   fresh boards and restored when deleted, automatically, once it exists in
   `resources/prompts`.

## Affected files / modules

- **New**: `plans/prompts/steps/design_review.md` (source of truth).
- **Generated**: `resources/prompts/steps/design_review.md` (via `npm run
  sync-resources`; committed).
- No changes to `src/scaffold.js`, `src/config.js`, `src/cli.js`, or
  `scripts/sync-resources.mjs` — the mirror + scaffold are content-driven.

## Risks and edge cases

- **CRLF/LF drift (Windows).** If the working copy checks out the new prompt as
  CRLF while `resources/` is LF, `test/resources-sync.test.js` still passes
  because it compares under `normalizeEol`, and `sync-resources.mjs` writes LF
  regardless. Low risk; author LF and rely on `.gitattributes eol=lf`.
- **Nested code fences.** The drafted prompt intentionally uses 4-space indented
  blocks (not triple-backtick fences) for the verdict examples, so the file has no
  internal fence that could break the packaged mirror or downstream rendering.
- **Cross-ticket parsing contract.** This prompt returns a first-line text verdict,
  not the JSON that `optional-steps/design/*` reviewers return. The sibling CLI
  task (T20260710T1222Z) that records design-review evidence must parse the
  first-line token (`PASS`/`CONCERNS`/`FAIL`), not `JSON.parse`. Flagged so the two
  tickets stay consistent; format is fixed here by the authoritative brief.
- **Reachability-guard calibration.** Wording must be concrete enough that codex
  neither suppresses real findings ("the code probably guards this") nor floods
  unreachable ones. The guard names the failure mode and requires an explicit
  trace before filing, which is the intended balance.
- **No config reference yet.** `test/prompt-scaffold.test.js`'s "every prompt the
  default config references" test does not cover this file (design review is not
  yet in `optionalSteps`), so adding the file cannot fail that test; the wholesale
  mirror test picks it up automatically.

## Test plan

- `npm run sync-resources`, then `node --test`:
  - `test/resources-sync.test.js` — "resources/prompts mirrors plans/prompts
    byte-for-byte" now includes `steps/design_review.md`; passes only if the
    mirror was regenerated.
  - `test/prompt-scaffold.test.js` — "initProject copies the full packaged
    resources/prompts … into a fresh board" now sees the new file in both the
    source and scaffolded sets (deepEqual holds) and asserts it is non-empty.
  - Add-missing/restore behavior is already exercised by the existing
    "add-missing-only" test against other prompts; the new file participates
    through the same wholesale copy path, no new assertion required.
- `npm run check` (lint/format) passes — markdown only.
- Manual confirmation (optional): `local-board init` into a temp dir, confirm
  `plans/prompts/steps/design_review.md` is scaffolded, delete it, re-run `init`,
  confirm it is restored.

## Open questions

None blocking. One coordination note (not a blocker): the sibling CLI ticket must
consume the first-line text verdict defined here rather than a JSON body — captured
under Risks.

## Implementation Notes

## Review Findings

verdict: pass

(codex-task:read-only, gpt-5.6-terra @ reasoning-effort high, 47s — reviewed commit 6f31997)

No findings.

- Prompt content covers all five required review dimensions, the reachability guard, and the return-only restriction (file writes and mutating commands enumerated).
- Verdict contract requires PASS/CONCERNS/FAIL as the literal first line and nothing else — crisp enough for the sibling CLI task's first-line token parsing.
- Fidelity to the Technical Design's embedded rubric is exact after documented LF normalization.
- Mirror integrity exact: source and packaged copies are byte-identical (4,398 bytes, SHA-256 385a776012b88d39769437f7b8ff03d0709b4f7f02746c9672a8569939b0ba4f), LF endings in both.

Residual risk: validates prompt content and artifact fidelity only; the sibling ticket T20260710T1222Z's parser is not exercised here.

## Test Evidence

verdict: pass

Environment: Windows 11, worktree @ commit 6f31997. Tester: claude-subagent:local-board-tester (sonnet).

Commands and results:

- npm run check — pass.
- npm test — 467 tests: 464 pass, 2 fail, 1 skip. Both failures are the declared baseline (test/install.test.js:887 and :902, real-PATH tests, B20260710T1232Z) — exact count and name match.
- Isolated resources-sync + prompt-scaffold suites — 14/14 pass (byte-for-byte mirror, wholesale init copy, add-missing-only restore).
- validate — Ticket validation OK.
- git hash-object: plans and resources copies identical (6d3ffa585b5c53d41f6d6f1ab0e7e896fd05f9df, 4398 bytes, 0 CR bytes).
- Content greps: PASS/CONCERNS/FAIL verdict tokens, all five rubric dimensions, and the return-only clause each present at verified line ranges.

Acceptance criteria: all four PASS (existence/content contract; byte-identical LF mirror; scaffold/restore via existing prompt-scaffold suite per no-file-creation constraint; check + suite green modulo declared baseline).

Anomalies: none. No external AI CLI or paid service invoked; no files created or modified.

## Documentation Updates

Documentation step executed by codex-task:workspace-write (gpt-5.6-luna @ reasoning-effort medium, 59s); edit committed by the orchestrator as 38f10fa on the ticket branch.

Changed:

- memory-bank/systemPatterns.md: design_review.md added to the scaffolded step-prompt enumeration.

Checked and deliberately left alone:

- memory-bank/techContext.md, docs/, README.md Documentation Index — no equivalent stale enumeration; no new doc file was added by this ticket.
- Feature-level design-review documentation (skill files, workflow narrative) — owned by sibling T20260710T1223Z, out of scope here.

Validation: git diff --check clean; prose-only change.

## Questions

## Run Log

- 2026-07-10T12:22:12Z: Ensured git branch local-board/T20260710T1221Z-design-review-prompt-file-resources-sync-and-init-scaffold (already-current).

- 2026-07-10T12:26:04Z: Completed design via claude-subagent:local-board-designer@opus: Technical Design with ship-ready embedded rubric (5 dimensions, first-line PASS/CONCERNS/FAIL, return-only clause, reachability guard); no code change needed for scaffold. Estimate 1 (basis T20260710T0037Z, designer-recorded).

- 2026-07-10T12:27:06Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: none - prompt content and resources sync only

- 2026-07-10T12:27:07Z: Ensured git branch local-board/T20260710T1221Z-design-review-prompt-file-resources-sync-and-init-scaffold (already-current).

- 2026-07-10T12:30:38Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Commit 6f31997: design_review.md prompt + byte-identical resources mirror (sync-resources). resources-sync and prompt-scaffold suites pass; 2 install.test.js failures flagged pre-existing/environment (PATH-detection), not caused by this change - to be verified at test stage.

- 2026-07-10T12:33:40Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: none - prompt markdown + mirror only

- 2026-07-10T12:33:40Z: Ensured git branch local-board/T20260710T1221Z-design-review-prompt-file-resources-sync-and-init-scaffold (already-current).

- 2026-07-10T12:43:40Z: Completed review via codex-task:read-only@gpt-5.6-terra: verdict: pass, no findings. Rubric contract complete, mirror byte-identical (SHA-256 verified), first-line verdict parseable.

- 2026-07-10T12:43:41Z: Ensured git branch local-board/T20260710T1221Z-design-review-prompt-file-resources-sync-and-init-scaffold (already-current).

- 2026-07-10T12:46:46Z: Completed test via claude-subagent:local-board-tester@sonnet: verdict: pass. 464/467 (2 = declared B1232Z baseline, exact match); mirror hash-identical; content contract greps verified; guardrail honored (no external calls).
