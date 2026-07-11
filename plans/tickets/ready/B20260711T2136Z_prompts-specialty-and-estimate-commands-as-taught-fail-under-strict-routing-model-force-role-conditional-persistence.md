---
id: B20260711T2136Z
type: bug
status: ready_for_docs
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/B20260711T2136Z-prompts-specialty-and-estimate-commands-as-taught-fail-under-strict-routing-model-force-role-conditional-persistence
estimate: 2
estimateBasis: B20260710T2051Z
workStartedAt: 2026-07-11T23:23:49Z
workCompletedAt: null
created: 2026-07-11T21:36:09Z
updated: 2026-07-11T23:38:59Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "design-review:codex-task:read-only@gpt-5.6-sol", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", "review:codex-task:read-only@gpt-5.6-terra", "test:claude-subagent:local-board-tester@sonnet", gate:test:skipped-empty-catalog, document:codex-task:workspace-write]
routingApprovals: []
---
# prompts: specialty and estimate commands as taught fail under strict routing (--model, --force, role-conditional persistence)

## Requirement

From the prompt-library review of 2026-07-11 (items 1, 4, 5): three places where a prompt teaches a command that fails as written.

1. All five optional-step specialty prompts (optional-steps/design/security_threat_model.md L50, design/ui_component_review.md L48, design/ux_interaction_review.md L48, impl/security_audit.md L49, impl/ui_visual_review.md L49) show a Recording command without --model: `complete-step <id> <step> --executor <executor> --evidence "..."`. security_threat_model and security_audit pin gpt-5.6-sol, so strict routing rejects the exact command taught. (Observed workaround this run: security_audit resolved to inline so the gap did not bite, but any model-pinned specialty route hits it.)
2. steps/estimate.md step 6 never mentions --force: the estimate field survives design loop-backs, so every re-design's estimate call fails as written. Add: re-run with --force and update --basis when an estimate already exists.
3. steps/estimate.md has no role-conditional persistence branch: when design routes to a return-only executor (codex-task:read-only), "Run local-board estimate" contradicts the return-only contract. Add the branch decompose.md already models: return points + basis + rationale for the orchestrator to record on return-only routes; run the command yourself on writable routes.

### Scope

1. Fix the Recording line in all five specialty prompts: `--executor <executor> --model <model> --evidence "<VERDICT>: <short summary>"` plus "(omit --model when specialty-run returned a null model)".
2. Add the --force re-estimation sentence and the role-conditional persistence note to steps/estimate.md. PRESERVE the pinned content-assertion substrings in test/cli.test.js: `local-board calibration suggest` and `local-board estimate` (additive edits only).
3. npm run sync-resources (all six files live under plans/prompts). Full node --test per AGENTS.md.
4. Optional (design decides): new content assertions pinning the corrected --model form.

### Acceptance criteria

- Every taught specialty Recording command passes strict routing verbatim for a model-pinned specialty profile.
- estimate.md covers the loop-back re-estimate and the return-only route; existing pinned substrings intact.
- npm run check and node --test pass; resources mirror synced.

### Non-goals

- No CLI behavior changes; no changes to specialty verdict JSON contracts.

## Acceptance Criteria

## Related Tickets

## Technical Design

Prompt-only fix. Three defect classes across six files under `plans/prompts` (all mirrored to `resources/prompts`). No CLI, no verdict-JSON contract changes. All edits are additive text edits to prompt Markdown plus one optional test assertion.

### Defect class 1: specialty Recording lines omit `--model`

All five optional-step specialty prompts carry an identical Recording sentence that omits `--model`, so strict routing rejects the exact command taught whenever the specialty profile resolves a non-null model. Premise attribution: on THIS board the five specialty profiles resolve to inline with a null model (no pins in `plans/local-board.config.jsonc`), so the gap does not bite here today. The `gpt-5.6-sol/xhigh` pins for `security_threat_model` and `security_audit` live in the init scaffold defaults in `src/config.js` (the two `agent` blocks around lines 1161-1164 and 1179-1182, plus the design-review pin near line 1039), so ANY board initialized from that scaffold hits the failure. The generic routing analysis is unchanged: the taught command must carry `--model` whenever the resolved model is non-null. `SKILL.md` (Delegation section, lines 270/273) is the source of truth for how `complete-step` composes the evidence token: it passes `--model` and composes `<step-name>:<agent>@<model>` server-side, "omit when `model` is null". The taught form must match that.

Affected files and current Recording line (line numbers):

- `plans/prompts/optional-steps/design/security_threat_model.md` L50 (step token `security_threat_model`)
- `plans/prompts/optional-steps/design/ui_component_review.md` L48 (`ui_component_review`)
- `plans/prompts/optional-steps/design/ux_interaction_review.md` L48 (`ux_interaction_review`)
- `plans/prompts/optional-steps/impl/security_audit.md` L49 (`security_audit`)
- `plans/prompts/optional-steps/impl/ui_visual_review.md` L49 (`ui_visual_review`)

Each file's current first sentence of the `Recording` section is (only the step token differs per file):

```
The orchestrator records evidence via `local-board complete-step <id> <step-name> --executor <executor> --evidence "<VERDICT>: <short summary>"`. When a finding deserves a longer note in the ticket, the orchestrator may also call `local-board comment <id> "<text>" --section "Review Findings"`.
```

Canonical replacement (single form; keep each file's existing literal step token in the `<step-name>` slot, keep the second sentence unchanged):

```
The orchestrator records evidence via `local-board complete-step <id> <step-name> --executor <executor> --model <model> --evidence "<VERDICT>: <short summary>"` (omit `--model` when `specialty-run` returned a null model). When a finding deserves a longer note in the ticket, the orchestrator may also call `local-board comment <id> "<text>" --section "Review Findings"`.
```

So for `security_threat_model.md` the taught command becomes `local-board complete-step <id> security_threat_model --executor <executor> --model <model> --evidence "<VERDICT>: <short summary>"`, and analogously for the other four with their own step tokens. This matches the server-side composition in `SKILL.md` L273 verbatim and passes strict routing for a model-pinned specialty profile. The `--model <model>` insertion goes between `--executor <executor>` and `--evidence`; nothing else on the line moves.

### Defect class 2: `steps/estimate.md` never teaches `--force`

`estimate.md` step 6 teaches `local-board --root <worktreePath> estimate <ticket-id> <points> --basis <basis-id-or-bootstrap>`. The `estimate` command refuses to overwrite an existing estimate without `--force` (pinned CLI behaviour: `test/cli.test.js` line ~810-812, "pass --force to overwrite"). Because the `estimate` front-matter field survives design loop-backs, every re-design's estimate call fails as written. Fix: append a sentence to step 6 that teaches the overwrite path. Proposed step-6 body (additive; the existing first sentence with its `local-board estimate` phrase and command stays intact):

```
6. Run `local-board estimate` to record both the estimate and the basis: `local-board --root <worktreePath> estimate <ticket-id> <points> --basis <basis-id-or-bootstrap>`. If the ticket already carries an estimate (for example on a design loop-back, where the `estimate` field survives), the command refuses to overwrite it; re-run with `--force` and update `--basis`: `local-board --root <worktreePath> estimate <ticket-id> <points> --basis <basis-id-or-bootstrap> --force`.
```

### Defect class 3: `steps/estimate.md` has no role-conditional persistence branch

Step 6 unconditionally tells the executor to run `local-board estimate`, which mutates front matter and therefore contradicts the return-only contract when design routes to a read-only executor. The branch must key on CAPABILITY (can this route write?), not on delegation, because the writable `local-board-designer` subagent is itself a delegated route: both `agents/claude/local-board-designer.md` (has `Write`/`Edit`; steps 48-49 instruct it to run `calibration suggest` + `estimate` itself) and `agents/codex/local-board-designer.md` (line 7/28: records the section "and any required estimate", runs `calibration suggest` plus `estimate`) are delegated yet writable and MUST record the estimate themselves. Classifying by delegation would sweep the designer into the return-only branch, leave the estimate unrecorded, and block design completion. Mirror the structure of `steps/decompose.md`'s `## Persistence` section (a return-only branch that mutates nothing and a writable branch that runs the commands), but split on write capability. Add an analogous section to `estimate.md` after the split-threshold paragraph. Proposed new section (verbatim text to add; steps 2-5 stay as read-only analysis, only the step-6 write is deferred on return-only routes):

```
## Persistence

Persistence is capability-conditional — decide whether your route can write before running the write command in step 6:

- Return-only route (any `codex-task:read-only` route, or any executor without a Write tool): do not run `local-board estimate`. The read-only analysis (steps 1-5, including `local-board calibration suggest`, which mutates nothing) still applies; return the chosen point value, the basis id (or `bootstrap`), and a one-sentence rationale for the orchestrator to record. Do not mutate local-board state or write files.
- Writable route (the `local-board-designer` subagent — claude or codex, which is instructed to record its own estimate — the orchestrator, or an inline run): run `local-board estimate` yourself as described in step 6 (with `--force` when re-estimating).
```

Note the deliberate re-use of the literal phrases `local-board calibration suggest` and `local-board estimate` in this section — additive, and it keeps both pinned substrings present even if step wording is later reworded.

### Pinned-substring preservation (hard constraint)

`test/cli.test.js` (test "…estimate step prompt…", lines 3356-3363) asserts `stepText.includes("local-board calibration suggest")` (line 3361) and `stepText.includes("local-board estimate")` (line 3362) against `plans/prompts/steps/estimate.md`. Both edits above are purely additive:

- `local-board calibration suggest` remains in step 2 ("Run `local-board calibration suggest` …") untouched.
- `local-board estimate` remains in step 6's first sentence ("Run `local-board estimate` …") untouched.

Neither phrase is deleted or altered, so both assertions continue to pass. The `--root <worktreePath> estimate` command form does not contain the literal substring `local-board estimate`; the assertion is satisfied by the prose "Run `local-board estimate`", which is preserved. Do not collapse or reword those two sentences.

### Test assertion decision (design decides): ADD a lightweight content assertion

No existing test pins the specialty prompts' Recording-line text (grep of `test/` for the file names, for `records evidence via`, `--executor <executor> --model`, and `Recording` found only catalog-name references in `active-steps.test.js` / `codex-detect.test.js` / `cli.test.js`, none asserting the Recording sentence). Since the whole defect is a taught command that drifted from strict-routing reality, add a regression guard so the corrected form cannot silently regress. This matches existing precedent (estimate.md substrings are pinned in `cli.test.js`; SKILL.md forms are tested).

Specify: a new test in `test/cli.test.js`, placed next to the existing estimate-prompt content test (around line 3363), that reads all five optional-step prompt files and asserts each teaches the strict-routing form. Exact assertion strings per file:

```
assert.ok(text.includes("--executor <executor> --model <model> --evidence"),
  `<file> teaches --model in the Recording command`);
assert.ok(text.includes("omit `--model`"),
  `<file> documents the omit-when-null parenthetical`);
```

Iterate over the five relative paths (`optional-steps/design/security_threat_model.md`, `optional-steps/design/ui_component_review.md`, `optional-steps/design/ux_interaction_review.md`, `optional-steps/impl/security_audit.md`, `optional-steps/impl/ui_visual_review.md`) under `plans/prompts`. This asserts the load-bearing token order (`--executor <executor> --model <model> --evidence`) and the omit parenthetical without pinning the full sentence, so it stays robust against the sibling ticket's separate paragraph addition.

### Resources sync and full-suite requirement

All six edited files live under `plans/prompts` and are mirrored byte-for-byte into `resources/prompts` (verified: `resources/prompts/optional-steps/design/*` and `.../impl/*` exist; `test/resources-sync.test.js` enforces the mirror). After editing the prompts, run `npm run sync-resources` to refresh the mirror, or the drift check fails. Per AGENTS.md, editing any `plans/prompts` file requires the FULL suite (`node --test`), not just guard suites, plus `npm run check`. Sequence: edit prompts + test → `npm run sync-resources` → `npm run check` → `node --test`.

### Affected files

- `plans/prompts/optional-steps/design/security_threat_model.md` (Recording line)
- `plans/prompts/optional-steps/design/ui_component_review.md` (Recording line)
- `plans/prompts/optional-steps/design/ux_interaction_review.md` (Recording line)
- `plans/prompts/optional-steps/impl/security_audit.md` (Recording line)
- `plans/prompts/optional-steps/impl/ui_visual_review.md` (Recording line)
- `plans/prompts/steps/estimate.md` (step 6 `--force` sentence + new `## Persistence` section)
- `resources/prompts/**` (regenerated via `npm run sync-resources`, all six mirrors)
- `test/cli.test.js` (new specialty-Recording content assertion)

### Sibling-ticket constraint (no conflict)

`T20260711T2137Z` separately adds a return-only clause to the same five specialty prompts. That addition lives in a different paragraph (a delegation / return-only note), not the single Recording sentence this ticket edits. This design touches only the one Recording sentence per file and the added test asserts token substrings rather than whole-paragraph equality, so it neither depends on nor conflicts with the sibling edit regardless of merge order. Implementer note: if both tickets are in flight, expect an adjacent-line merge in each specialty file — the hunks are in distinct paragraphs and should auto-merge; re-run `npm run sync-resources` and `node --test` after any merge.

### Risks and edge cases

- Merge adjacency with `T20260711T2137Z` in the five specialty files (mitigated above; distinct paragraphs).
- Forgetting `npm run sync-resources` fails `resources-sync.test.js` — called out as a required step.
- The omit-parenthetical wording must stay consistent across all five files so the new test's `omit \`--model\`` substring check passes uniformly; use the single canonical replacement verbatim.
- No CLI/behaviour change, so no runtime risk; the only failure surface is the test suite (content assertions and the mirror check).

### Test strategy

- New content assertion in `test/cli.test.js` guards the corrected `--model` Recording form across all five specialty prompts.
- Existing `test/cli.test.js` estimate-prompt substring assertions (lines 3361-3362) must remain green (additive edits guarantee this).
- `test/resources-sync.test.js` green after `npm run sync-resources`.
- Full `node --test` + `npm run check` per AGENTS.md (prompt-library edits).

### Open questions

None blocking.

## Implementation Notes

Implemented the r2-approved design exactly:

1. Fixed the Recording line in all five specialty prompts (`security_threat_model.md`, `ui_component_review.md`, `ux_interaction_review.md`, `security_audit.md`, `ui_visual_review.md`) to the canonical form `--executor <executor> --model <model> --evidence "..."` plus the `(omit \`--model\` when \`specialty-run\` returned a null model)` parenthetical, matching `SKILL.md` L273's server-side composition. Only the Recording sentence changed; step tokens preserved per file.
2. `plans/prompts/steps/estimate.md`: appended the `--force` re-estimation sentence to step 6, and added a new capability-based `## Persistence` section (return-only routes return points/basis/rationale; writable routes — designer subagent, orchestrator, inline — run `local-board estimate` themselves). Verified both pinned substrings (`local-board calibration suggest`, `local-board estimate`) survive verbatim via grep post-edit.
3. Added a new content-assertion test in `test/cli.test.js` ("specialty optional-step prompts teach the strict-routing Recording command") asserting the `--executor <executor> --model <model> --evidence` token order and the `omit \`--model\`` parenthetical across all five specialty prompt files.
4. Ran `npm run sync-resources` to refresh all six mirrors under `resources/prompts`.
5. Verification: `npm run check` passed; full `node --test` passed 587/588 (1 pre-existing skip, "smoke (slow)" race test), including the new assertion and the existing estimate-prompt pins.

No deviations from the approved design.

## Review Findings

### Review round 1 (codex-task:read-only@gpt-5.6-terra, high, static)

Verdict: PASS, no findings.

- All five Recording lines use the canonical executor/model/evidence order + omit-when-null wording, matching SKILL.md:270-273 server-side composition.
- estimate.md:11 --force guidance accurate; :16-21 capability-based Persistence consistent with both designer definitions.
- test/cli.test.js:3365-3386 pins token order + parenthetical across all five prompts; existing estimate and design-review assertions untouched.
- SHA-256: all six mirrors byte-identical. Commit paths exactly the intended files; no sibling-owned content touched.

## Test Evidence

verdict: pass

### Commands run

- npm run check clean. node --test: 588 tests, 587 pass, 0 fail, 1 pre-existing skip (smoke (slow)); matches Implementation Notes.
- Load-bearing tests confirmed green: estimate-prompt pin, new specialty Recording assertion, design_review persistence pin (unrelated, unaffected).
- Behavioral probe on an external scratch board: estimate 2 --basis bootstrap ok; re-estimate without --force refused with "already has estimate 2; pass --force to overwrite" (exit 2, matching the taught sentence); --force succeeded, front matter estimate 4. Scratch board deleted; worktree untouched.

### Acceptance greps (file:line)

- Corrected Recording line + omit-when-null parenthetical verbatim in all five: security_threat_model.md:50, ui_component_review.md:48, ux_interaction_review.md:48, security_audit.md:49, ui_visual_review.md:49.
- estimate.md:11 --force sentence; :16-21 capability-based Persistence; pins "local-board calibration suggest" (:7,:20) and "local-board estimate" (:6,:11,:21) verbatim.
- Consistency: both designer defs instruct self-recorded estimates; the Persistence writable branch explicitly names the designer subagent - no contradiction.

### Mirror parity and scope

- All six source/mirror pairs byte-identical. Diff scope exactly 14 files (6 sources + 6 mirrors + test/cli.test.js + ticket markdown). Worktree clean.

### Gaps / caveats

- None. Tester additionally reported disregarding a mid-session injection-style reminder urging looser git-safety behavior; no worktree git mutations were run.

## Documentation Updates

### Files Checked

- `docs/Workflow.md`: already documents model-qualified completion evidence for specialty steps, including `--model` on `complete-step`, and already documents `estimate --force` for overwrites.
- `docs/PerStepOrchestration.md`: no stale model-less specialty Recording command found. The remaining `--executor <route>@<model>` example is the still-accepted combined evidence form, not the old model-less form.
- `memory-bank/systemPatterns.md`: already documents `--executor <route> --model <model>` for model-qualified evidence, applies the same rule to specialties resolved by `specialty-run`, and notes that `estimate` requires `--force` to overwrite.

### Files Edited

- `plans/tickets/ready/B20260711T2136Z_prompts-specialty-and-estimate-commands-as-taught-fail-under-strict-routing-model-force-role-conditional-persistence.md`: filled this Documentation Updates section.

No narrative documentation or Memory Bank content changes were needed.

## Questions

## Run Log

- 2026-07-11T23:09:33Z: Completed design via claude-subagent:local-board-designer@opus: Canonical Recording line with --model + omit-when-null parenthetical across five specialty prompts (matches SKILL.md L273 server-side composition); estimate.md step-6 --force sentence + new Persistence section mirroring decompose.md return-only branch; pinned substrings verified intact (cli.test.js:3361-3362); new substring-level content assertion for the five prompts; sync-resources for all six mirrored files; paragraph-disjoint from T2137Z.

- 2026-07-11T23:10:34Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: none (prompt edits + content-assertion test)

- 2026-07-11T23:18:57Z: Design review r1 (codex-task:read-only@gpt-5.6-sol, xhigh): FAIL. 1) [High] proposed estimate.md Persistence section misclassifies routes: 'delegated or return-only executor' would sweep in the WRITABLE claude-subagent:local-board-designer (which is explicitly instructed to run calibration suggest + estimate itself); following it the designer would return points instead of recording, blocking design completion. Classify by capability: return-only routes return points/basis/rationale; writable routes (designer subagent, orchestrator, inline) run the command. 2) [Med] strict-routing premise misattributed: THIS board's five specialty profiles resolve inline@null (no pins); the gpt-5.6-sol pins for security_threat_model/security_audit live in the src/config.js init scaffold - attribute the premise there. Verified correct: Recording command + null parenthetical, --force guidance, pin survival, assertion conventions, sync coverage, T2137Z paragraph-disjointness. Looping design rework.

- 2026-07-11T23:21:19Z: Completed design via claude-subagent:local-board-designer@opus: Rework r2: Persistence section reclassified by capability (return-only codex-task:read-only returns points/basis/rationale; writable routes incl. designer subagent, orchestrator, inline run estimate themselves, matching both designer agent defs); routing premise reattributed to src/config.js init scaffold pins (~L1161-1182) with board-local inline/null noted; reviewer-approved items untouched.

- 2026-07-11T23:23:47Z: Design review r2 (codex-task:read-only@gpt-5.6-sol, xhigh): PASS. Capability-based Persistence classification verified against both designer defs; scaffold attribution verified at src/config.js:1161-1182 with board-local inline/null confirmed via resolveOptionalStepAgent; unchanged sections coherent.

- 2026-07-11T23:23:48Z: Recorded design review via codex-task:read-only@gpt-5.6-sol: r1 FAIL (persistence route misclassification High + attribution Med) reworked; r2 PASS both fixes verified, no new inconsistencies

- 2026-07-11T23:23:49Z: Ensured git branch local-board/B20260711T2136Z-prompts-specialty-and-estimate-commands-as-taught-fail-under-strict-routing-model-force-role-conditional-persistence (already-current).

- 2026-07-11T23:28:33Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Five specialty Recording lines corrected to --executor/--model/--evidence + omit-when-null parenthetical; estimate.md step-6 --force sentence + capability-based Persistence section; pins verified verbatim (calibration suggest + estimate); new cli.test.js assertion pinning the corrected form across all five prompts; sync-resources (6 mirrors). npm run check clean; node --test 587/588 pass 1 pre-existing skip. Commits 198bee9 + 0602092.

- 2026-07-11T23:29:17Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: none (prompt prose + content-assertion test)

- 2026-07-11T23:29:18Z: Ensured git branch local-board/B20260711T2136Z-prompts-specialty-and-estimate-commands-as-taught-fail-under-strict-routing-model-force-role-conditional-persistence (already-current).

- 2026-07-11T23:31:27Z: Completed review via codex-task:read-only@gpt-5.6-terra: r1 PASS no findings: canonical Recording lines match SKILL composition, estimate.md edits accurate and capability-consistent, new assertion clean, mirrors SHA-identical, scope exact.

- 2026-07-11T23:31:28Z: Ensured git branch local-board/B20260711T2136Z-prompts-specialty-and-estimate-commands-as-taught-fail-under-strict-routing-model-force-role-conditional-persistence (already-current).

- 2026-07-11T23:36:47Z: Completed test via claude-subagent:local-board-tester@sonnet: verdict: pass. 587/588 pass 0 fail 1 pre-existing skip; all five Recording lines + estimate.md edits cited; live --force probe on scratch board matches taught flow exactly; pins verbatim; designer-def consistency confirmed; mirrors identical; scope exactly 14 files.

- 2026-07-11T23:36:48Z: Ensured git branch local-board/B20260711T2136Z-prompts-specialty-and-estimate-commands-as-taught-fail-under-strict-routing-model-force-role-conditional-persistence (already-current).

- 2026-07-11T23:38:59Z: Completed document via codex-task:workspace-write: Doc audit: Workflow.md, PerStepOrchestration.md, systemPatterns.md already model-qualified and --force-aware; no narrative changes; Documentation Updates section records the audit.
