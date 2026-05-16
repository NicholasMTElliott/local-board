---
id: T20260516T1554Z
type: task
status: done
priority: P2
parent: S20260516T1538Z
children: []
blockedBy: [T20260516T1551Z, T20260516T1552Z, T20260516T1553Z]
blocks: []
branch: feature/estimation-and-specialty-steps
estimate: null
created: 2026-05-16T15:54:16Z
updated: 2026-05-16T23:48:10Z
completedSteps: [design:claude-subagent:local-board-designer, implement:claude-subagent:local-board-implementer, review:codex-task:read-only, test:claude-subagent:local-board-tester, document:codex-task:workspace-write]
routingApprovals: []
estimateBasis: null
workCompletedAt: null
workStartedAt: null
---
# Update orchestrator skill and add specialty-steps docs

## Requirement

Wire the new gate-check / specialty-run flow into the orchestrator skill and document it.

Skill changes:
- Update `SKILL.md` (and any orchestrator role prompt(s) under `plans/prompts/`) so that after a stage's mandatory review passes for `design`, `implement`, or `test`, the orchestrator runs `local-board gate-check <id> --stage <stage> --json`.
- For each name in the returned `requestedSteps`, the orchestrator runs `local-board specialty-run <id> <name>`, dispatches the resolved prompt via the resolved agent (or inline), then records evidence with `local-board complete-step <id> <name> --executor <executor> --evidence "..."`.
- Only after all specialty steps complete does the orchestrator advance the ticket to the next status.
- Gate-check is NOT run after `decompose` or `document` stages.

Docs:
- Add `docs/specialty-steps.md` describing the feature: what it is, when the gate runs, the v1 catalog, how to add a new specialty, how evidence is recorded, and how `doneRequires` interacts (specialty evidence is preserved but never required for closeout).
- Add a link to the new doc from the README Documentation Index.

## Acceptance Criteria

- `SKILL.md` describes the gate-check + specialty-run loop in the design, implement, and test stages, including the exact CLI invocations.
- Orchestrator role prompts under `plans/prompts/` reflect the new loop wherever stage transitions are documented.
- `docs/specialty-steps.md` exists and covers: overview, when gate-check runs, the v1 catalog (5 prompts across design + implement), authoring a new specialty entry, evidence recording via `complete-step`, and the `doneRequires` interaction.
- README Documentation Index has a link to `docs/specialty-steps.md`.
- No new specialty evidence is treated as mandatory: `local-board validate` and closeout checks still pass on tickets that ran no specialties.
- Depends on T20260516T1551Z (gate-check), T20260516T1552Z (specialty-run), and T20260516T1553Z (ported prompts).

## Related Tickets

## Technical Design

### Overview

Final wiring task for the conditional specialty review feature. No production code or schema changes. Three deliverables:

1. Skill update at SKILL.md (orchestrator runbook) describing the gate-check / specialty-run loop.
2. New human-readable narrative at docs/specialty-steps.md.
3. README documentation-index link.

Dependencies T1551 (gate-check CLI), T1552 (specialty-run CLI), and T1553 (five ported prompts) are merged. After this lands, the orchestrator can call gate-check + specialty-run as part of the natural pipeline without any further CLI work.

### Files to edit

- SKILL.md: insert a new "Specialty Steps" section and extend the CLI Commands block.
- docs/specialty-steps.md: new file (narrative documentation).
- README.md: extend the Documentation Index list to link docs/specialty-steps.md.

No source file under src/, bin/, agents/, or test/ is touched.

### Files inspected

- SKILL.md (current orchestrator runbook structure: Core Loop, Process Contract, Actions, Transition Guidance, Branch Discipline, Done and Auto-Merge, Delegation, CLI Commands).
- plans/local-board.config.jsonc (optionalSteps, agents, routing.doneRequires, estimation blocks).
- plans/prompts/steps/gate-check.md (output contract: strict JSON { requestedSteps: [...] }).
- plans/prompts/optional-steps/{design,impl}/*.md (five v1 specialty prompts; verdict contract PASS / CONCERNS / FAIL).
- src/cli.js confirming surface: gate-check, specialty-run, calibration suggest, estimate.
- docs/Workflow.md, docs/TicketFormat.md, docs/LocalBoardConcept.md for tone and section conventions.
- Parent story S20260516T1538Z for v1 catalog rationale and out-of-scope list.

### SKILL.md changes

Insert a new "Specialty Steps" section between "Done and Auto-Merge" (ends near line 140) and "Delegation" (starts near line 143). Cover, in order:

1. Trigger: after a stage mandatory action evidence is recorded (design, implement, or test) and before the orchestrator calls move <ticket-id> <next-status>, run gate-check.
2. Exact CLI: node <<SCRIPT_PATH>> gate-check <ticket-id> --stage <stage> --json. The brief contained a typo (specialty-run TICKET --stage); the correct command is gate-check TICKET --stage STAGE --json. Stages allowed: design, implement, test. Not after decompose or document.
3. Response shape: { requestedSteps: [...] }. Empty array is the normal case and means skip the specialty pass.
4. For each requested name: run node <<SCRIPT_PATH>> specialty-run <ticket-id> <step-name> --json to resolve prompt path and agent route, dispatch the prompt via that agent (inline default), then record evidence with node <<SCRIPT_PATH>> complete-step <ticket-id> <step-name> --executor <executor> --evidence "<VERDICT>: <short summary>".
5. Stage mapping is automatic. specialty-run derives the stage from ticket status; the orchestrator does not pass --stage to specialty-run.
6. After all requested specialties complete, the orchestrator advances the ticket through the normal transitions list.
7. Specialty evidence is never required to close done. doneRequires only lists mandatory actions; specialty entries in completedSteps are preserved as history.
8. Unknown specialty names are rejected by specialty-run. The orchestrator must use names from the gate-check return value verbatim and must not invent new names.

Extend the CLI Commands fenced block (currently lines 173-193) with four lines, kept contiguous for a clean diff:

- node <<SCRIPT_PATH>> gate-check <ticket-id> --stage <stage> [--json]
- node <<SCRIPT_PATH>> specialty-run <ticket-id> <step-name> [--json]
- node <<SCRIPT_PATH>> calibration suggest <ticket-id> [--json]
- node <<SCRIPT_PATH>> estimate <ticket-id> <points> [--basis <ticket-id-or-bootstrap>] [--force] [--json]

calibration suggest and estimate are missing from the current CLI Commands block even though their tickets (T1545, T1546) are done; folding them in here closes the gap surfaced by this wiring task without expanding scope.

Do NOT modify the orchestrator role prompt at plans/prompts/roles/orchestrator.md. That file is intentionally short and points at plans/ for the contract. The ticket AC mentions Orchestrator role prompts under plans/prompts/ reflect the new loop; the current role prompt is contract-thin and does not enumerate stage transitions, so no edit is required. Record the decision in the Run Log when implementing.

### docs/specialty-steps.md

Target length: 80-140 lines. Follow the heading style of docs/Workflow.md. Suggested outline:

1. # Specialty Steps: one-paragraph framing - optional, pattern-matched, advisory.
2. ## Problem: manual triage of "does this need security / a11y / UX review" is unreliable; reviewers either over-fire or get forgotten. A small classifier looks at the work and recommends from a known catalog.
3. ## Gate-check + specialty-run pattern: the two-CLI loop. Pseudo-flow: mandatory action -> gate-check -> for each requested -> specialty-run + complete-step -> next status.
4. ## When gate-check runs: after design, implement, test. Never after decompose or document. Empty requestedSteps is normal.
5. ## v1 Catalog: one row per shipped prompt. For each: stage, name, prompt path, trigger summary, what it produces.
   - design / security_threat_model / auth, crypto, PII, trust boundaries / STRIDE-style findings JSON.
   - design / ui_component_review / new or modified UI components / component-level design notes.
   - design / ux_interaction_review / new user flows or significant interaction changes / flow-level findings.
   - implement / security_audit / auth code, input validation, external calls, credential handling / code-level security findings.
   - implement / ui_visual_review / visible UI changes, styles, layouts, a11y markup / visual review findings.
6. ## Trigger guidance: concrete examples mapping work types to recommended specialties (auth changes -> security_audit; new modal -> ui_visual_review plus maybe ui_component_review at design; new wizard -> ux_interaction_review).
7. ## Authoring a new specialty: two-step recipe - add an entry under the right stage in optionalSteps (config), then create the prompt file at the configured path. Note the optional per-entry agent override.
8. ## Evidence recording: how complete-step writes <step-name>:<executor> into completedSteps. Show one example evidence line.
9. ## Interaction with doneRequires: explicit statement - specialty entries never gate closeout. validate and move ... done pass on tickets that ran zero specialties. Specialty history is preserved if it ran.
10. ## Out of scope (future): mirror the parent story out-of-scope list (remaining 19 task-board prompts, auto-rerun on failed review, per-ticket overrides) so readers do not file duplicate requests.

Cross-link from this doc to: SKILL.md (orchestrator runbook), plans/local-board.config.jsonc (catalog), plans/prompts/steps/gate-check.md (classifier prompt), plans/prompts/optional-steps/ (specialty prompts).

### README.md change

In the ## Documentation Index block (lines 76-80), add one bullet:

- [docs/specialty-steps.md](docs/specialty-steps.md): optional security, UI, and UX specialty review steps and how the gate-check classifier dispatches them.

Keep the existing three bullets unchanged.

### Risks and edge cases

- Brief typo: the brief states specialty-run TICKET --stage STAGE --json for the gate command. Use gate-check per the brief own correction note. Mis-copying this into SKILL.md would break every downstream orchestrator run.
- specialty-run does not accept --stage. The CLI derives stage from ticket status (src/cli.js around line 692). Documenting an explicit --stage flag on specialty-run would mislead orchestrators and produce CLI errors.
- Empty requestedSteps is the common case. The docs and SKILL must call this out so orchestrators do not treat an empty list as a gate-check failure.
- Unknown step names are rejected by specialty-run (src/cli.js around line 701). Orchestrators must use the exact names returned by gate-check, not paraphrased forms.
- Strict routing still applies to specialty steps. An agent-routed specialty without matching evidence (or an approve-inline) fails strict-routing checks. The doc should note specialties are exempt from doneRequires but not from routing strictness.
- optionalSteps.test ships empty in the current config. Mentioning the test stage in the SKILL gate-check list is fine; the docs should note the test catalog is intentionally empty in v1 so an empty requestedSteps after test is always expected.
- The orchestrator role prompt at plans/prompts/roles/orchestrator.md is intentionally minimal. Editing it risks scope creep. Record that decision in Implementation Notes.
- README Documentation Index ordering: the current list reads conceptual -> format -> workflow. Append the new bullet after Workflow as a feature-grouped addition rather than alphabetizing.
- The brief instructs adding a CLI Commands section for the new commands. SKILL.md already has one; the implementer should extend it in place rather than create a duplicate header.

### Test plan

No executable behavior changes; tests are limited to validation and link sanity.

- npm run validate: confirm the board is still clean (front matter, status/folder match, blockedBy graph).
- npm test: no expected impact, but run as a regression smoke test.
- Manual: open SKILL.md and confirm the new Specialty Steps section renders cleanly between Done and Auto-Merge and Delegation. Confirm the new CLI lines are in the CLI Commands fenced block.
- Manual: open docs/specialty-steps.md and confirm all relative links resolve (SKILL.md, the config file, the gate-check prompt, the five specialty prompts).
- Manual: open README.md and confirm the new bullet renders and the link target exists.
- Optional: run node ./bin/local-board.js gate-check <some-impl-ticket> --stage implement --json on a sample ticket to spot-check that the documented contract matches actual CLI output.

### Documentation impact

- docs/specialty-steps.md added.
- README.md Documentation Index updated.
- SKILL.md extended with a Specialty Steps section and four new CLI Commands lines.
- memory-bank/: review systemPatterns.md to see whether the specialty pattern deserves a one-line entry. Likely yes (orchestrator runbook now has a non-mandatory dispatch loop). Keep to a single line; do not duplicate the docs narrative.

### Suggested ticket section content

This Technical Design section is the primary deliverable for the design stage. Implementation Notes during implement should capture: which README index ordering was chosen, the orchestrator role-prompt decision, and any deviation from the outline above.

## Implementation Notes

- README Documentation Index ordering: appended docs/specialty-steps.md after Workflow.md per design's feature-grouped (not alphabetized) recommendation.
- Did not modify plans/prompts/roles/orchestrator.md. That role prompt is intentionally contract-thin and does not enumerate stage transitions, so the gate-check + specialty-run loop belongs in SKILL.md and docs/specialty-steps.md only.
- Extended the existing SKILL.md `## CLI Commands` fenced block in place rather than creating a duplicate header. Added four lines: gate-check, specialty-run, calibration suggest, estimate.
- Used `gate-check TICKET --stage STAGE --json` in the SKILL.md prose (the brief's correction note over its earlier typo) and clarified that specialty-run derives stage from ticket status (no `--stage` flag).
- Inserted the new SKILL.md `## Specialty Steps` section between `## Done and Auto-Merge` and `## Delegation` as designed.
- docs/specialty-steps.md follows the brief's 10-section outline with one consolidation: "Forward links" appears as a dedicated section near the end and "Out of scope (future)" follows it, mirroring the parent story's out-of-scope list.
- Verified all relative links in docs/specialty-steps.md resolve to existing files: SKILL.md, plans/local-board.config.jsonc, plans/prompts/steps/gate-check.md, the five specialty prompts under plans/prompts/optional-steps/{design,impl}/, and docs/Workflow.md.
- `npm run validate` passes after the doc-only changes.

## Review Findings

**Verdict:** CONCERNS (soft pass — minor doc polish).

Reviewer: codex-task:read-only (gpt-5.5). Static review.

**Confirmed correct:**
- SKILL.md placement: Specialty Steps section follows Done/Auto-Merge and precedes Delegation (SKILL.md:142, :180).
- gate-check + specialty-run loop documented with correct command invocations including the stage-from-status rule for specialty-run (SKILL.md:149, :165, :168).
- CLI Commands block extended with gate-check, specialty-run, calibration suggest, estimate (SKILL.md:222).
- docs/specialty-steps.md covers: overview, pattern, stages, v1 catalog (5 prompts), trigger guidance, adding specialty, output contract, evidence recording, doneRequires interaction (docs/specialty-steps.md:3, :9, :26, :38, :52, :64, :73, :93, :103).
- README Documentation Index links the new doc (README.md:80).
- Orchestrator role prompts intentionally not modified.

**Concern (non-blocking, doc polish):**
- docs/specialty-steps.md "Forward links" section (line 111) doesn't link the parent story S20260516T1538Z or related ticket IDs (T1551, T1552, T1553). Cross-references help future readers trace history. Tester can address by appending a Related stories subsection.

## Test Evidence

**Tester:** claude-subagent:local-board-tester. Static + doc verification of commit 60243a8 with follow-on doc polish commit 2fb9977.

**Commands run (all on branch `feature/estimation-and-specialty-steps`):**

- `npm test` -> 98/98 passed, 0 failed.
- `npm run check` -> all six source files parsed cleanly with `node --check`.
- `npm run validate` -> "Ticket validation OK".
- `npm run validate` (post-doc-edit) -> "Ticket validation OK".

**Acceptance criteria coverage:**

- SKILL.md describes gate-check + specialty-run loop for design, implement, test stages with exact CLI invocations - confirmed at SKILL.md lines 142-178 (Specialty Steps section between Done/Auto-Merge and Delegation).
- Orchestrator role prompts under `plans/prompts/` reflect the new loop wherever stage transitions are documented - confirmed: `plans/prompts/roles/orchestrator.md` is intentionally contract-thin and does not enumerate stage transitions, so no edit was required (decision recorded in Implementation Notes).
- `docs/specialty-steps.md` exists and covers overview, when gate-check runs, v1 catalog (5 prompts across design + implement), authoring a new specialty, evidence recording via `complete-step`, and doneRequires interaction - confirmed reading lines 1-125.
- README Documentation Index links the new doc - confirmed by reviewer (README.md:80).
- No new specialty evidence is treated as mandatory - confirmed: `npm run validate` is clean and tests covering doneRequires routing all pass.
- Blocking dependencies T1551/T1552/T1553 are all `done`.

**Review concern closed:**

- Codex review (CONCERNS verdict) flagged that `docs/specialty-steps.md` had no parent-story or sibling-ticket cross-references. Appended a new `## Related stories and tickets` section at the end of the doc with explicit links to parent story S20260516T1538Z, sibling story S20260516T1537Z, and sibling tasks T20260516T1550Z through T20260516T1553Z. Committed as 2fb9977 on branch `feature/estimation-and-specialty-steps`. `npm run validate` still clean after the edit.

**Gaps / flakes / caveats:**

- No executable behavior changes ship in this ticket, so the test suite is a smoke regression rather than targeted coverage; sufficient given the doc-only scope.
- Optional manual CLI spot-check (`gate-check <impl-ticket> --stage implement --json`) was not run; both CLIs are exercised by unit tests under `test/` and validated by `npm test`.
- Git CRLF warning appeared while staging the doc edit. Harmless; repository-wide convention.
- Ticket folder moves for sibling tickets T1543-T1553 (active/backlog -> done) appear in `git status` but were not part of this ticket's scope; left untouched.

**Verdict:** PASS. All AC met. Review concern closed via doc-only follow-up commit. Ticket left in `ready_for_test` per brief instructions (no status move).

## Documentation Updates

This ticket was itself the documentation work. The substantive updates landed in commits:
- 60243a8 (T20260516T1554Z implement) — SKILL.md Specialty Steps section + CLI list additions; new docs/specialty-steps.md (10 sections); README Documentation Index entry.
- 2fb9977 (T20260516T1554Z test) — Related stories cross-references appended to docs/specialty-steps.md.
- 2cd71ed (T20260516T1554Z document) — One-line note in memory-bank/systemPatterns.md about the orchestrator gate-check + specialty-run loop.

SKILL.md and docs/specialty-steps.md are the canonical references for the specialty-steps pipeline.

## Questions

## Run Log

- 2026-05-16T23:38:36Z: Completed design via claude-subagent:local-board-designer: Design: 3 deliverables. New Specialty Steps section in SKILL.md (between Done/Auto-Merge and Delegation). New docs/specialty-steps.md (10-section narrative). README Documentation Index bullet. Risks: clarify gate-check vs specialty-run CLI distinction; specialty-run derives stage from status (no --stage flag); specialties not in doneRequires but still under strict routing.

- 2026-05-16T23:38:37Z: Ensured git branch feature/estimation-and-specialty-steps (already-current).

- 2026-05-16T23:41:49Z: Completed implement via claude-subagent:local-board-implementer: Implemented in commit 60243a8. SKILL.md gained Specialty Steps section between Done/Auto-Merge and Delegation; CLI Commands list extended with gate-check, specialty-run, calibration suggest, estimate. New docs/specialty-steps.md (10-section narrative). README Documentation Index updated. Orchestrator role prompt intentionally untouched. npm run validate clean.

- 2026-05-16T23:44:01Z: Completed review via codex-task:read-only: Codex review of commit 60243a8. Verdict: CONCERNS — doc polish only. SKILL.md placement and loop description correct. CLI block extended. docs/specialty-steps.md covers all required sections. README link present. Orchestrator role prompt intentionally untouched. Concern: docs/specialty-steps.md missing parent-story+sibling-ticket cross-references — tester will close.

- 2026-05-16T23:47:01Z: Completed test via claude-subagent:local-board-tester: npm test 98/98; check + validate clean. SKILL.md Specialty Steps section reads naturally with surrounding sections. docs/specialty-steps.md is a useful narrative doc. Closed review concern: appended Related stories subsection with links to parent story S20260516T1538Z, sibling S20260516T1537Z, and sibling tasks (commit 2fb9977). Verdict: PASS.

- 2026-05-16T23:48:10Z: Completed document via codex-task:workspace-write: Doc updates in commit 2cd71ed (one-line memory-bank entry for the orchestrator specialty-steps loop). SKILL.md and docs/specialty-steps.md are the canonical references (landed in 60243a8 and 2fb9977).
