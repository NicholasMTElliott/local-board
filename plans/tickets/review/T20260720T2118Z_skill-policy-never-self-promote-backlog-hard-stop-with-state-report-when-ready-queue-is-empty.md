---
id: T20260720T2118Z
type: task
status: ready_for_review
priority: P1
parent: null
children: []
blockedBy: [T20260720T2116Z, T20260720T2117Z]
blocks: []
branch: local-board/T20260720T2118Z-skill-policy-never-self-promote-backlog-hard-stop-with-state-report-when-ready-queue-is-empty
estimate: 2
estimateBasis: T20260710T2050Z
workStartedAt: 2026-07-20T23:45:36Z
workCompletedAt: null
created: 2026-07-20T21:16:06Z
updated: 2026-07-20T23:56:18Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "design-review:codex-task:read-only@gpt-5.6-sol", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku"]
routingApprovals: []
---
# Skill policy: never self-promote backlog; hard stop with state-report when ready queue is empty

## Requirement

### Problem

`SKILL_TEAM.md` preflight says only: "If empty, report 'no ready tickets' and stop." In a 2026-07-20 run against an all-backlog board (47 backlog, 0 ready), the orchestrator overrode that bare instruction, reverse-engineered the readiness model over ~6 turns, and planned to promote backlog tickets on its own. Other runs comply and stop. The one-line rule carries no rationale, so behavior is nondeterministic: the user's stated goal ("work my tickets in parallel") outweighs an unexplained stop.

### Requirement

Board semantics to encode: backlog vs `ready_*` is an approval boundary. `ready_*` means a human approved the ticket for work; `backlog` means it still needs review. Agents must never cross that boundary on their own initiative — but an explicit user instruction ("promote all backlog tickets", "promote everything for feature XYZ", "promote all unblocked tickets") authorizes promotion of the tickets it names.

1. In `SKILL_TEAM.md` (and codex mirror `skills/codex/local-team/SKILL.md`), replace the bare stop rule with a policy block that states:
   - the rationale above (approval boundary), so the instruction survives goal pressure;
   - on empty ready queue: run `state-report --json`, report `byStatus` counts plus how many backlog tickets are unblocked (`list --status backlog --unblocked --json`, from T20260720T2116Z), and stop — suggest the user review and promote;
   - never `move` a ticket out of `backlog` without an explicit user instruction in this session; when instructed, use `promote` (from T20260720T2117Z) for each ticket the instruction covers, then re-run `list --ready` and continue the normal loop;
   - a standing config or ticket-file note is NOT an instruction; only the user's message is.
2. Mirror the same policy in the single-ticket skill (root `SKILL.md` + `skills/codex/local-board/SKILL.md`): `query-next` returning null with a non-empty backlog gets the same state-report-and-stop treatment.
3. Keep wording terse (skill files are token-budgeted); one short policy block per skill, not a new section per flow.

### Acceptance Criteria

- All four skill files state: approval-boundary rationale, state-report-on-empty diagnostic, hard stop, and the explicit-instruction promotion path via `promote`.
- Codex mirrors stay byte-identical where `test/skill-usage-sync.test.js` requires; suite passes.
- No skill text instructs or permits autonomous backlog promotion in any branch.
- Full suite (`node --test`) green; `local-board install` refresh noted in Documentation Updates so installed skills pick up the change.

Blocked by T20260720T2116Z (`--unblocked` query) and T20260720T2117Z (`promote`) so the policy text references commands that exist.

## Acceptance Criteria

## Related Tickets

## Technical Design

Docs-only change to the four skill files. No production `src/` change. Encode a backlog-promotion approval-boundary policy so orchestrators diagnose an empty ready queue and hard-stop instead of self-promoting.

### Related tickets and dependencies

- Blocked-by (both merged, commands present in this worktree): `T20260720T2116Z` (`list --status <status> --unblocked --json`, filters on `blockedByOpen.length === 0`, `src/cli.js`) and `T20260720T2117Z` (`local-board promote <id> [--to <status>]`, sanctioned/audited backlog promotion, `src/cli.js`). Verified: `promote` is already in both single-ticket CLI Commands blocks and in `REQUIRED_COMMANDS` of `test/skill-usage-sync.test.js`; `list --unblocked` composes with `--status` and reports `blockedBy`/`blockedByOpen`.
- No ticket conflicts: this touches only skill Markdown, disjoint from any `src/` work.

### Scope: four target files

1. `SKILL.md` (root, single-ticket, canonical)
2. `skills/codex/local-board/SKILL.md` (codex single-ticket mirror)
3. `SKILL_TEAM.md` (native parallel)
4. `skills/codex/local-team/SKILL.md` (codex parallel mirror)

### Constraints verified against the tests

- `test/skill-usage-sync.test.js` byte-identity/subset assertions touch ONLY the fenced `sh` block under `## CLI Commands` in the two `local-board` files. The policy prose lands outside that block, so byte-identity is unaffected. `promote` and `state-report` are already present in both blocks; no CLI Commands edit is needed.
- `FALLBACK_WALK_SECTIONS` slices `## Delegation` / `## Execution profiles` / `### Fallback Model Walk` / `## Route Translation`. Place the new policy so it does NOT fall inside those sections (in particular, keep it out of `## Delegation` in `SKILL.md`, whose slice runs to the next top-level `##`).
- `test/cli.test.js` and `test/resources-sync.test.js` contain NO assertions against skill-file prose (confirmed by grep). Skill files are not under `plans/prompts/` and not under `resources/` (which holds only `prompts/` and `templates/`), so `npm run sync-resources` is NOT required for this change. Claim in the ticket brief is verified true.
- `list` is intentionally absent from the single-ticket CLI Commands blocks ("`worktree-list`, `team-config`, and `list` live in the parallel (`local-team`) skill"). The policy still names `list --status backlog --unblocked --json` in single-ticket prose as a read-only diagnostic; naming it in prose does not add it to the curated block and does not trip the subset test. See Open Questions for the alternative.
- `state-report --json` returns a `byStatus` count map (`src/tickets.js` `stateReport`); that is the field the policy tells the agent to report.

### Placement decisions per file

- `SKILL_TEAM.md` (parallel): Preflight step 5 already runs `list --ready` and already references `list --status <status> --unblocked --json`. Replace the bare clause `If empty, report "no ready tickets" and stop.` with the policy block, keeping it inside step 5 (the empty-ready-queue trigger lives there). The existing `--unblocked` sentence folds into the diagnostic.
- `skills/codex/local-team/SKILL.md` (codex parallel): identical treatment on its Preflight step 5 (`If empty, report no ready tickets and stop.` -> policy block), same audience-neutral wording.
- `SKILL.md` (root single-ticket): no empty-queue branch exists today. Add one short new subsection immediately AFTER `## Core Loop` (and before `## Process Contract`), titled `## Empty Queue and Backlog Promotion`, covering the `query-next` returns-null case. Placed well clear of `## Delegation`, so the fallback-walk slice is untouched.
- `skills/codex/local-board/SKILL.md` (codex single-ticket): add the same `## Empty Queue and Backlog Promotion` subsection immediately after `## Single-Ticket Loop` (before `## Route Translation Contract`). Clear of `### Fallback Model Walk` / `## Route Translation Contract`.

Keep the two parallel blocks near-identical and the two single-ticket blocks near-identical; use the same policy sentences across all four so a single regression test can assert them everywhere.

### Proposed wording

Parallel skills — replace the bare stop clause in Preflight step 5 with (adjust the surrounding sentence so the existing `list --ready`/`--unblocked` references read naturally):

```
If the ready queue is empty, do NOT self-promote. **Backlog is an approval
boundary:** `ready_*` means a human approved the ticket for work; `backlog`
still needs review. Never `move` a ticket out of `backlog` on your own
initiative, however strongly the user's goal ("work my tickets in parallel")
seems to imply it. Instead run `state-report --json`, report its `byStatus`
counts plus how many backlog tickets are unblocked
(`list --status backlog --unblocked --json`), suggest the user review and
promote, and STOP — do not reverse-engineer the readiness model or promote
anything. Only an explicit user instruction in this session ("promote all
backlog", "promote everything for feature XYZ", "promote all unblocked
tickets") authorizes promotion; when instructed, run `local-board promote <id>`
for each ticket the instruction covers, then re-run
`list --ready --limit <maxInFlight> --json` and continue the normal loop. A
standing config or ticket-file note is NOT such an instruction — only the
user's own session message counts.
```

Single-ticket skills — the new `## Empty Queue and Backlog Promotion` subsection:

```
`query-next` returning no ticket (null) is not a signal to promote. **Backlog
is an approval boundary:** `ready_*` means a human approved the ticket for
work; `backlog` still needs review. Never `move` a ticket out of `backlog` on
your own initiative. When `query-next` returns null, run `state-report --json`
and report its `byStatus` counts plus how many backlog tickets are unblocked
(`list --status backlog --unblocked --json`), suggest the user review and
promote, and STOP — do not reverse-engineer readiness or promote anything.
Only an explicit user instruction in this session ("promote all backlog",
"promote everything for feature XYZ", "promote all unblocked tickets")
authorizes promotion; when instructed, run `local-board promote <id>` for each
ticket the instruction covers, then re-run `query-next` and continue the normal
loop. A standing config or ticket-file note is NOT such an instruction — only
the user's own session message counts.
```

Both variants carry the five required elements: (1) approval-boundary rationale, (2) `state-report --json` + `byStatus` + unblocked-backlog diagnostic, (3) hard stop, (4) explicit-user-instruction carve-out executed via `promote`, (5) config/ticket text is not an instruction. Codex mirrors reuse the same sentences (audience-neutral; no Claude/codex dialect divergence is needed here, unlike the fallback-walk sections).

### Installed-copies / release note decision

No install/release mention is added inside the skill bodies. Rationale: the two single-ticket files already carry the version-skew advisory, and `install --status` recomputes a content hash over the installer payload (`src/install.js` lists `SKILL.md` and `SKILL_TEAM.md`; codex mirrors are copied from `skills/codex/*`). Editing any of these bumps that hash, so `install --status` will report `skewed` and the existing advisory already tells the user to re-run `local-board install`. The parallel/codex files have no version stamp by design, so no new stamp is warranted. The `local-board install` refresh reminder belongs in the ticket's `## Documentation Updates` section (per the acceptance criteria), NOT in the skill text.

### Risks

- Token budget: skill files are token-optimized. The block is ~110 words per file; acceptable, and it replaces an existing (shorter) line in the parallel files.
- Placement drift: inserting a new `## ` heading in the single-ticket files must stay outside `## Delegation` / `### Fallback Model Walk`, or `FALLBACK_WALK_SECTIONS` slicing changes. Mitigated by the placement above (after the loop section) and by running the full suite.
- Naming `list` in single-ticket prose is a mild inconsistency with the "list lives in the parallel skill" note. It does not break any test (prose is not parsed for command names). See Open Questions.
- Behavioral, not mechanical: the policy's force depends on the rationale surviving goal pressure. Wording leads with the approval-boundary rationale and an explicit STOP for that reason.

### Test plan

Existing guards (must stay green — run the FULL suite `node --test`, per AGENTS.md, because these are production skill artifacts):
- `test/skill-usage-sync.test.js`: CLI Commands byte-identity + subset + `REQUIRED_COMMANDS` (`promote`), and the four-file `FALLBACK_WALK_SECTIONS` choreography test (confirms my inserts did not disturb those sliced sections).
- Full suite catches any incidental breakage; no `src/` change means low blast radius.

New assertion (recommended, add to `test/skill-usage-sync.test.js`): a test iterating all four skill files asserting the policy text is present so it cannot silently regress.

CRITICAL — the policy prose is line-wrapped Markdown, so the asserted phrases contain hard newlines and variable inter-word spacing (e.g. the parallel variant wraps between "the" and "user's"; the single-ticket variant wraps between "only" and "the"). Every assertion MUST be whitespace-tolerant. Two equivalent techniques, apply ONE consistently to ALL phrases:
- normalize first — `const normalized = source.replace(/\s+/g, " ")` — then match/`includes` the phrase written with single spaces; or
- match with a regex whose inter-token gaps are `\s+` rather than a literal space.

Whitespace-tolerant matches per file (all six required elements). Written as `\s+` regexes so they survive the wrap regardless of where it lands:
- `/approval\s+boundary/i`
- `/never\b[\s\S]*?\bbacklog\b/i` (the never-self-promote rule; `[\s\S]` so it spans wrapped lines)
- `/state-report\s+--json/`
- `/list\s+--status\s+backlog\s+--unblocked\s+--json/`
- `/local-board\s+promote\s+<id>/`
- `/only\s+the\s+user'?s\s+own\s+session\s+message\s+counts/i` (the config-is-not-an-instruction rule — this is the exact phrase the parallel wrap splits)

Do NOT use literal-space `.includes(...)` on these phrases: a hard newline at the wrap point makes the substring absent and the test fails on correct content. Match against the whole file source (not a sliced section), since placement differs per file. Keep the phrase list identical across all four so the wording is forced to stay uniform.

Manual/doc verification: none required beyond the suite; `sync-resources` explicitly not needed (verified).

### Resolved question

- Single-ticket `list` reference (was open in round 1; design-review ruling: KEEP): the requirement names `list --status backlog --unblocked --json` as the unblocked-count diagnostic, but `list` is documented as parallel-only in the single-ticket CLI Commands note. Resolution: keep the reference in single-ticket prose. It is a read-only diagnostic and does not alter the curated CLI Commands block, and `state-report --json` alone cannot supply the unblocked subset (its `byStatus` gives only the backlog total, not the unblocked count the policy must report). `list` is available on the CLI regardless of which skill curates it in its command surface.

## Implementation Notes

Implemented the round-2 design verbatim: docs-only, five-file change.

Policy block placement:
- `SKILL_TEAM.md` Preflight step 5: replaced `If empty, report "no ready tickets" and stop.` with the full approval-boundary policy block (parallel wording).
- `skills/codex/local-team/SKILL.md` Preflight step 5: same replacement, identical wording (audience-neutral).
- `SKILL.md`: new `## Empty Queue and Backlog Promotion` subsection inserted immediately after the transition-guidance paragraph that closes `## Core Loop` and before `## Process Contract` (single-ticket wording).
- `skills/codex/local-board/SKILL.md`: same new `## Empty Queue and Backlog Promotion` subsection inserted immediately after the `## Core Loop` equivalent's closing paragraph and before `## Route Translation Contract`.

No edits to any fenced CLI Commands block, `plans/prompts/`, or `resources/`; `sync-resources` not run (per design, verified unnecessary).

Test: added `test/skill-usage-sync.test.js` test `"all four skill files encode the never-self-promote-backlog approval-boundary policy"`, iterating all four skill files against the six whitespace-tolerant regexes specified in the design (approval boundary, never...backlog, state-report --json, list --status backlog --unblocked --json, local-board promote <id>, only the user's own session message counts). No literal-space `.includes` used.

Full suite: `node --test` — 662 passed, 1 skipped, 0 failed (includes the new assertion).

No deviations from the design.

## Review Findings

Code review (codex gpt-5.6-terra, high effort): CONCERNS — policy wording and command references faithful; one Medium finding, fixed forward.

1. [Medium] test/skill-usage-sync.test.js — the six guard regexes scanned each entire file, so policy-block deletions could pass: `state-report --json` and `local-board promote <id>` also occur in the single-ticket CLI Commands blocks; `/never\b[\s\S]*?\bbacklog\b/i` could match unrelated wording; no assertion covered the hard-stop sentence. Resolution: fixed forward in commit 7211602 — assertions now bind to the policy sentences themselves (empty-queue trigger + state-report span, session-instruction + promote span, the exact own-initiative prohibition sentence, and the STOP sentence), whitespace-tolerant; a negative check confirmed each tightened assertion fails when its bound sentence is deleted; suite green 662/0/1.

Verification performed by reviewer:
- Reviewed requirement, round-2 design, implementation notes, and commit f1b36e8.
- Confirmed all four policy blocks contain the approval-boundary rationale, empty-queue diagnostic, unblocked-backlog query, explicit-session carve-out, promote path, and config/ticket-note exclusion.
- Confirmed state-report, list --status backlog --unblocked --json, and promote are implemented by the CLI; state-report returns byStatus.
- Confirmed the single-ticket CLI Commands blocks unchanged and mirrored; FALLBACK_WALK_SECTIONS and REQUIRED_COMMANDS untouched.
- Confirmed the diff is confined to the four designed skill regions and the new assertion.

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-20T23:35:31Z: Completed design via claude-subagent:local-board-designer@opus: Docs-only: identical approval-boundary policy block in all four skills (team preflight step-5 replacement; single-ticket new Empty Queue and Backlog Promotion section clear of FALLBACK_WALK_SECTIONS slicing); state-report + unblocked-count diagnostic, hard stop, promote-on-explicit-instruction, config-not-an-instruction; new 4-file content assertion in skill-usage-sync; sync-resources not needed (verified)

- 2026-07-20T23:36:27Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: none (docs-only policy text; no security/UI/UX triggers)

- 2026-07-20T23:40:57Z: Recorded design review via codex-task:read-only@gpt-5.6-sol: FAIL: High - proposed content-assertion regex is whitespace-sensitive and cannot match the line-wrapped policy text in either variant; use whitespace-tolerant matching. All else verified: insertion points clear of sliced sections, no fenced-block edits, wording unambiguous incl. goal-pressure case; open question ruled keep list --unblocked reference

- 2026-07-20T23:41:00Z: Invalidated downstream evidence on loop-back to ready_for_design: removed completedSteps [design:claude-subagent:local-board-designer@opus, gate:design:claude-subagent:local-board-gatecheck@haiku, design-review:codex-task:read-only@gpt-5.6-sol].

- 2026-07-20T23:42:03Z: Completed design via claude-subagent:local-board-designer@opus: Round 2: test plan now mandates whitespace-tolerant matching for all six policy phrases (\s+ patterns / normalize-first, explicit no-literal-space-includes warning); open question resolved KEEP list --unblocked ref per reviewer ruling; insertion points and wording unchanged

- 2026-07-20T23:42:51Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: none (round 2; docs-only, no triggers)

- 2026-07-20T23:45:35Z: Recorded design review via codex-task:read-only@gpt-5.6-sol: PASS (round 2): whitespace-tolerant test plan verified against both wrapped variants (all six regexes evaluated); wording/insertion points unchanged; no new defects

- 2026-07-20T23:45:36Z: Ensured git branch local-board/T20260720T2118Z-skill-policy-never-self-promote-backlog-hard-stop-with-state-report-when-ready-queue-is-empty (already-current).

- 2026-07-20T23:48:36Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Policy block transcribed verbatim at all four verified insertion points; new four-file whitespace-tolerant content assertion in skill-usage-sync; fenced blocks untouched; node --test 662/0/1; commit f1b36e8

- 2026-07-20T23:49:24Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: none (docs+test only)
