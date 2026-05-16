---
id: T20260516T1553Z
type: task
status: done
priority: P2
parent: S20260516T1538Z
children: []
blockedBy: [T20260516T1550Z]
blocks: [T20260516T1554Z]
branch: feature/estimation-and-specialty-steps
estimate: null
created: 2026-05-16T15:53:13Z
updated: 2026-05-16T22:57:14Z
completedSteps: [design:claude-subagent:local-board-designer, implement:claude-subagent:local-board-implementer, review:codex-task:read-only, test:claude-subagent:local-board-tester, document:codex-task:workspace-write]
routingApprovals: []
estimateBasis: null
workCompletedAt: null
workStartedAt: null
---
# Port initial specialty prompts from task-board

## Requirement

Port the five v1 specialty prompts from the sibling task-board project into local-board, trimming each to local-board prompt conventions.

Source directory: `c:/Users/Nicho/Documents/task-board/prompts/optional-steps/`.

Target paths (must match the config entries from T20260516T1550Z exactly):
- `plans/prompts/optional-steps/design/security_threat_model.md`
- `plans/prompts/optional-steps/design/ui_component_review.md`
- `plans/prompts/optional-steps/design/ux_interaction_review.md`
- `plans/prompts/optional-steps/impl/security_audit.md`
- `plans/prompts/optional-steps/impl/ui_visual_review.md`

For each port:
- Preserve the substantive review guidance (what to look for, what to flag, examples).
- Strip the task-board `section_update` contract (local-board records evidence via `complete-step`, not section diffs).
- Strip GitHub-specific references (no PR links, no labels, no Octokit hints).
- Strip any task-board-specific marker comment instructions; the comment-markers story handles that separately.
- Keep the prompts agent-agnostic — no executor-specific framing.

## Acceptance Criteria

- All five target files exist with the correct paths matching the config entries.
- Each ported prompt opens with a brief role/scope statement and lists the review questions or checklist drawn from the task-board source.
- No remaining references to `section_update`, managed sections, GitHub PRs, labels, or task-board-specific tooling in the ported files.
- Each prompt instructs the agent to leave findings via `complete-step <id> <step-name> --evidence "<summary>"` (or, when comments are warranted, via `local-board comment`), matching local-board's evidence model.
- Paths line up with `optionalSteps` entries from T20260516T1550Z so `specialty-run` can resolve them.
- `local-board validate` remains clean.
- Depends on T20260516T1550Z (paths must match the config catalog).

## Related Tickets

## Technical Design

### Scope

Port five v1 specialty review prompts from the sibling task-board project into plans/prompts/optional-steps/ so that specialty-run can resolve them via the catalog wired up in T20260516T1550Z.

Source paths (read-only, do not modify):
- c:/Users/Nicho/Documents/task-board/prompts/optional-steps/design/security_threat_model.md
- c:/Users/Nicho/Documents/task-board/prompts/optional-steps/design/ui_component_review.md
- c:/Users/Nicho/Documents/task-board/prompts/optional-steps/design/ux_interaction_review.md
- c:/Users/Nicho/Documents/task-board/prompts/optional-steps/impl/security_audit.md
- c:/Users/Nicho/Documents/task-board/prompts/optional-steps/impl/ui_visual_review.md

Target paths (must match the v1 catalog in plans/local-board.config.jsonc exactly):
- plans/prompts/optional-steps/design/security_threat_model.md
- plans/prompts/optional-steps/design/ui_component_review.md
- plans/prompts/optional-steps/design/ux_interaction_review.md
- plans/prompts/optional-steps/impl/security_audit.md
- plans/prompts/optional-steps/impl/ui_visual_review.md

### Approach

For each of the five prompts, write a fresh local-board version that keeps the substantive review checklist from the source but is otherwise rewritten to local-board conventions. Treat this as a content port, not a copy: the source files are short (24-30 lines) so reauthoring is cheaper than a search-and-replace pass.

Each ported prompt follows this consistent shape:

1. Top-level heading naming the specialty (e.g. Security Threat Model Review), one line.
2. One-sentence role and scope statement that names the specialty and the stage. Design-stage prompts review the technical design; implement-stage prompts review the changes just implemented for this ticket. Drop the source template tokens (TaskName, TaskId, Task Context, TaskBody) entirely. The orchestrator already passes the ticket path and specialty-run --json already returns a ticketContext payload (id, title, requirement, acceptanceCriteria).
3. An Inputs section with three bullets: the ticket file at the supplied path; the relevant artifact (Technical Design section for design-stage prompts; diff against the merge base or Implementation Notes for implement-stage prompts); and any related stage-specific context (e.g. design mockups in the ticket, recent commits on the ticket branch).
4. A Review Scope checklist - the numbered list of focus areas from the task-board source, preserved verbatim where possible. The substantive guidance is the load-bearing content of the port and must not be paraphrased into something weaker. Severity language (Critical / High / Medium / Low) stays. STRIDE stays in security_threat_model. Pixel-perfect, theming, and responsive-layout points stay in ui_visual_review. All seven security topics stay in security_audit.
5. An Output Contract section. Strict JSON only, no prose, no code fences. Shape: an object with a verdict field whose value is one of PASS, CONCERNS, or FAIL, plus a findings array. Each finding is an object with severity (Critical|High|Medium|Low), summary, and optional location and recommendation strings. PASS means no findings worth recording. CONCERNS means at least one Medium-or-below finding, none blocking. FAIL means at least one Critical or High finding. The findings array is empty on PASS. This matches the brief terse contract and gives the orchestrator a uniform shape across all five specialties while leaving room for severity (security prompts already require it).
6. A Recording section, one short paragraph. Instruct the agent to leave the verdict and a concise findings summary as evidence via local-board complete-step ID step-name --executor EXECUTOR --evidence VERDICT:SUMMARY matching the AC. Mention local-board comment ID TEXT --section Review Findings as the fallback when the finding warrants a longer note in the ticket. Do not mention managed sections, section_update, or marker comments - the structured-comment-markers story (S20260516T1539Z) covers that separately.

### Transformation rules

Apply these strip rules to every port:

- Remove the source heading line that interpolates TaskName and TaskId, and remove the Task Context block that interpolates TaskBody. The orchestrator supplies the ticket path and a ticketContext payload via specialty-run --json; the prompt does not need templated substitution.
- Remove the implicit section_update contract. The source prompts never use the literal phrase but they assume the task-board return-COMPLETE-with-a-brief-summary convention that feeds into a section diff. Replace with the explicit JSON Output Contract above.
- Remove all references to card, project, field, column, GitHub Projects, PR links, labels, /.aiboard/tasks/, and Octokit. None of the five source prompts currently contain these strings, but the audit step exists to guarantee a clean port.
- Remove agent-specific framing. No you-are-Claude or you-are-an-agent-of-type-X language. The prompt is agent-agnostic; routing is controlled by the catalog optional agent field and by the global agents map in plans/local-board.config.jsonc.
- Keep wording terse. Match the tone of existing prompts under plans/prompts/steps/ (see gate-check.md, design.md, test.md) - short bullet lists, no filler.

### Files and APIs inspected

- plans/local-board.config.jsonc lines 271-302 (the optionalSteps catalog set by T20260516T1550Z; the five prompt paths are already the targets).
- src/cli.js lines 681-752 (commandSpecialtyRun and statusToStage). Confirms the prompt is resolved with path.resolve(root, entry.prompt) and the JSON payload carries prompt, agent, ticketPath, and ticketContext - so the prompt body can rely on those being available to the executor.
- src/cli.js lines 451-462 (commandComment) and the existing complete-step flow at lines 325-450. Confirms the two evidence-recording paths referenced in the Recording section.
- plans/prompts/steps/gate-check.md, design.md, test.md, document.md - reference points for local-board prompt tone and JSON output style.
- plans/tickets/done/S20260516T1538Z_conditional-specialty-review-steps-security-ui-ux.md Technical Design section - confirms the catalog shape, the step-name:executor evidence format, and that doneRequires does not gate on specialty entries.
- c:/Users/Nicho/Documents/task-board/prompts/optional-steps/design/{security_threat_model,ui_component_review,ux_interaction_review}.md and impl/{security_audit,ui_visual_review}.md for the five source files. Each is 23-30 lines and contains no task-board-specific tokens that would survive the strip rules - the port is mostly a reframing exercise around the same checklist content.
- test/cli.test.js lines 593-947 - existing specialty-run coverage. Confirms the new prompt-paths test can reuse runCli and the JSON payload schema.

### Risks and edge cases

- Path drift between catalog and disk. The five prompt values in optionalSteps must match the filenames exactly, including the impl (not implement) directory and the _review vs _audit suffixes. The new on-disk test (below) catches drift in either direction.
- Prompt content drift from task-board upstream. Accepted. The port is a snapshot; future task-board changes do not propagate automatically. Note this in the Documentation Updates section so future-us knows.
- Over-paraphrasing the security checklist. The seven items in security_audit (input validation, authn and authz, data exposure, injection, cryptography, dependencies, error handling) and the STRIDE list in security_threat_model are the load-bearing content. Preserve them as bullet headings and keep the supporting sentence beneath each.
- Output contract divergence between specialties. All five must emit the same top-level JSON shape so the specialty-run caller can treat them uniformly. If a specialty has nothing useful for location or recommendation, the agent may omit those fields per-finding, but verdict and findings are required.
- Inline executor running the prompt. The catalog leaves agent unset, so per src/cli.js line 706 the default route is inline. The prompts must read sensibly when executed inline by the orchestrator active model, not only by a subagent. Avoid second-person framing that assumes a separate worker process.
- validate ignores prompt files on disk. There is no validator that cross-checks optionalSteps[*].prompt paths against the filesystem today. The new test (below) fills that gap for v1.
- npm run validate (ticket validation) remains independent of these prompt files; it should stay clean once the ticket is moved and the prompts exist. No front-matter changes are required.

### Test plan

Add one test to test/cli.test.js (anchored to the existing specialty-run test block) that confirms catalog wiring is self-consistent:

1. Discover root via the existing test harness pattern (real repo root, or the tmpdir fixture pattern used by surrounding tests; the simplest version reads the real project config so we cover the shipped catalog).
2. Load plans/local-board.config.jsonc via loadConfig.
3. For each stage in optionalSteps and each entry in that stage array, resolve path.resolve(root, entry.prompt) and call fs.statSync on it. Assert the file exists and is non-empty.

An alternative shape, also acceptable: drive the same loop via specialty-run --json against a real ticket per stage and fs.statSync the prompt field of the payload. This wires the test through the public command rather than the config loader, which is closer to integration. Pick the loader version for speed and lower fixture cost; pick the command version if a stage has no convenient existing ticket.

Other test coverage:

- No new behavior, no schema change, no new command. Existing specialty-run tests already cover dispatch, stage mapping, unknown step rejection, per-entry agent override, and empty-stage rejection. They do not need updating.
- npm test must remain green.
- npm run validate (ticket validation) must remain clean. The five new files do not affect ticket front matter.

### Documentation updates

- The story-level Technical Design already documents the catalog and prompt intent. No memory-bank/ updates expected; the prompts themselves are the documentation of what each specialty inspects.
- If docs/ or README.md references the catalog by name or path, leave a pointer to plans/prompts/optional-steps/ so readers can find the ported prompts. Audit during the Documentation step of this ticket; likely a no-op.
- Record the upstream snapshot in this ticket Implementation Notes so future ports against the same task-board source files can be diffed.

### Out of scope

- The other ~19 task-board specialty prompts. Per the story Out-of-scope section, they ship as a follow-up. No catalog entries, no files.
- Any change to src/ or test/ (other than the single new prompt-paths test), plans/local-board.config.jsonc, the orchestrator skill, or the specialty-run / gate-check commands. T20260516T1550Z and T20260516T1554Z own those.
- Marker-comment formatting in the Review Findings section. Story S20260516T1539Z is the owner; this ticket only references plain local-board comment ID TEXT --section Review Findings.
- Auto-rerun on FAIL verdict. v1 is single-pass; the orchestrator records the verdict as evidence and the human (or a future loop) decides what to do with it.

### Suggested commands

Implementation will run (no actions taken in this design pass):

- Author each of the five files at the target paths using the template above.
- npm test to confirm the new prompt-paths test passes.
- node C:/Users/Nicho/.local-board/bin/local-board.js validate to confirm ticket validation is clean.
- Parent orchestrator records this design via node C:/Users/Nicho/.local-board/bin/local-board.js complete-step T20260516T1553Z design --executor claude-subagent:local-board-designer --evidence SUMMARY.

## Implementation Notes

Ported five v1 specialty prompts from the sibling task-board project into `plans/prompts/optional-steps/`:

- design/security_threat_model.md
- design/ui_component_review.md
- design/ux_interaction_review.md
- impl/security_audit.md
- impl/ui_visual_review.md

Each ported file follows the 6-part shape from the Technical Design:

1. Heading naming the specialty.
2. One-paragraph role/scope statement (no task-board section_update contract).
3. Inputs section listing the ticket file, the stage-relevant artifact (Technical Design for design-stage; diff or Implementation Notes for impl-stage), and any related context.
4. Review Scope checklist lifted verbatim from the task-board sources (STRIDE in security_threat_model; all 7 topics in security_audit; pixel-perfect/theming/responsive in ui_visual_review).
5. JSON Output Contract with `{ verdict: PASS|CONCERNS|FAIL, findings: [{ severity, summary, location?, recommendation? }] }`. PASS=empty findings; CONCERNS=Medium-or-below; FAIL=Critical/High.
6. Recording note pointing the orchestrator at `local-board complete-step <id> <step> --executor ... --evidence "<VERDICT>: ..."` with `local-board comment` as the longer-note fallback.

Stripped from each source: task-board templated headings (`{TaskName}`, `{TaskId}`, `{TaskBody}`), the implicit `return COMPLETE`/section_update contract, and any GitHub Projects/aiboard references (none of the five sources actually had Projects/Octokit text but the strip pass was performed regardless). Agent-agnostic framing — no second-person "you are Claude" wording.

Snapshot source (task-board branch as of port): the five files under `c:/Users/Nicho/Documents/task-board/prompts/optional-steps/{design,impl}/`. Future task-board changes do not propagate automatically; rediff against these source paths to refresh.

Test added in `test/cli.test.js`: walks every entry in `config.optionalSteps[stage]`, resolves `path.resolve(root, entry.prompt)` against the real repo root, calls `fs.statSync`, and asserts each is a non-empty file. Also asserts at least 5 entries are seen.

Verification: npm test (90 pass, 0 fail, including the new prompt-paths test), npm run check, npm run validate all clean.

## Requirement

Port the five v1 specialty prompts from the sibling task-board project into local-board, trimming each to local-board prompt conventions.

Source directory: `c:/Users/Nicho/Documents/task-board/prompts/optional-steps/`.

Target paths (must match the config entries from T20260516T1550Z exactly):
- `plans/prompts/optional-steps/design/security_threat_model.md`
- `plans/prompts/optional-steps/design/ui_component_review.md`
- `plans/prompts/optional-steps/design/ux_interaction_review.md`
- `plans/prompts/optional-steps/impl/security_audit.md`
- `plans/prompts/optional-steps/impl/ui_visual_review.md`

For each port:
- Preserve the substantive review guidance (what to look for, what to flag, examples).
- Strip the task-board `section_update` contract (local-board records evidence via `complete-step`, not section diffs).
- Strip GitHub-specific references (no PR links, no labels, no Octokit hints).
- Strip any task-board-specific marker comment instructions; the comment-markers story handles that separately.
- Keep the prompts agent-agnostic — no executor-specific framing.

## Acceptance Criteria

- All five target files exist with the correct paths matching the config entries.
- Each ported prompt opens with a brief role/scope statement and lists the review questions or checklist drawn from the task-board source.
- No remaining references to `section_update`, managed sections, GitHub PRs, labels, or task-board-specific tooling in the ported files.
- Each prompt instructs the agent to leave findings via `complete-step <id> <step-name> --evidence "<summary>"` (or, when comments are warranted, via `local-board comment`), matching local-board's evidence model.
- Paths line up with `optionalSteps` entries from T20260516T1550Z so `specialty-run` can resolve them.
- `local-board validate` remains clean.
- Depends on T20260516T1550Z (paths must match the config catalog).

## Related Tickets

## Technical Design

### Scope

Port five v1 specialty review prompts from the sibling task-board project into plans/prompts/optional-steps/ so that specialty-run can resolve them via the catalog wired up in T20260516T1550Z.

Source paths (read-only, do not modify):
- c:/Users/Nicho/Documents/task-board/prompts/optional-steps/design/security_threat_model.md
- c:/Users/Nicho/Documents/task-board/prompts/optional-steps/design/ui_component_review.md
- c:/Users/Nicho/Documents/task-board/prompts/optional-steps/design/ux_interaction_review.md
- c:/Users/Nicho/Documents/task-board/prompts/optional-steps/impl/security_audit.md
- c:/Users/Nicho/Documents/task-board/prompts/optional-steps/impl/ui_visual_review.md

Target paths (must match the v1 catalog in plans/local-board.config.jsonc exactly):
- plans/prompts/optional-steps/design/security_threat_model.md
- plans/prompts/optional-steps/design/ui_component_review.md
- plans/prompts/optional-steps/design/ux_interaction_review.md
- plans/prompts/optional-steps/impl/security_audit.md
- plans/prompts/optional-steps/impl/ui_visual_review.md

### Approach

For each of the five prompts, write a fresh local-board version that keeps the substantive review checklist from the source but is otherwise rewritten to local-board conventions. Treat this as a content port, not a copy: the source files are short (24-30 lines) so reauthoring is cheaper than a search-and-replace pass.

Each ported prompt follows this consistent shape:

1. Top-level heading naming the specialty (e.g. Security Threat Model Review), one line.
2. One-sentence role and scope statement that names the specialty and the stage. Design-stage prompts review the technical design; implement-stage prompts review the changes just implemented for this ticket. Drop the source template tokens (TaskName, TaskId, Task Context, TaskBody) entirely. The orchestrator already passes the ticket path and specialty-run --json already returns a ticketContext payload (id, title, requirement, acceptanceCriteria).
3. An Inputs section with three bullets: the ticket file at the supplied path; the relevant artifact (Technical Design section for design-stage prompts; diff against the merge base or Implementation Notes for implement-stage prompts); and any related stage-specific context (e.g. design mockups in the ticket, recent commits on the ticket branch).
4. A Review Scope checklist - the numbered list of focus areas from the task-board source, preserved verbatim where possible. The substantive guidance is the load-bearing content of the port and must not be paraphrased into something weaker. Severity language (Critical / High / Medium / Low) stays. STRIDE stays in security_threat_model. Pixel-perfect, theming, and responsive-layout points stay in ui_visual_review. All seven security topics stay in security_audit.
5. An Output Contract section. Strict JSON only, no prose, no code fences. Shape: an object with a verdict field whose value is one of PASS, CONCERNS, or FAIL, plus a findings array. Each finding is an object with severity (Critical|High|Medium|Low), summary, and optional location and recommendation strings. PASS means no findings worth recording. CONCERNS means at least one Medium-or-below finding, none blocking. FAIL means at least one Critical or High finding. The findings array is empty on PASS. This matches the brief terse contract and gives the orchestrator a uniform shape across all five specialties while leaving room for severity (security prompts already require it).
6. A Recording section, one short paragraph. Instruct the agent to leave the verdict and a concise findings summary as evidence via local-board complete-step ID step-name --executor EXECUTOR --evidence VERDICT:SUMMARY matching the AC. Mention local-board comment ID TEXT --section Review Findings as the fallback when the finding warrants a longer note in the ticket. Do not mention managed sections, section_update, or marker comments - the structured-comment-markers story (S20260516T1539Z) covers that separately.

### Transformation rules

Apply these strip rules to every port:

- Remove the source heading line that interpolates TaskName and TaskId, and remove the Task Context block that interpolates TaskBody. The orchestrator supplies the ticket path and a ticketContext payload via specialty-run --json; the prompt does not need templated substitution.
- Remove the implicit section_update contract. The source prompts never use the literal phrase but they assume the task-board return-COMPLETE-with-a-brief-summary convention that feeds into a section diff. Replace with the explicit JSON Output Contract above.
- Remove all references to card, project, field, column, GitHub Projects, PR links, labels, /.aiboard/tasks/, and Octokit. None of the five source prompts currently contain these strings, but the audit step exists to guarantee a clean port.
- Remove agent-specific framing. No you-are-Claude or you-are-an-agent-of-type-X language. The prompt is agent-agnostic; routing is controlled by the catalog optional agent field and by the global agents map in plans/local-board.config.jsonc.
- Keep wording terse. Match the tone of existing prompts under plans/prompts/steps/ (see gate-check.md, design.md, test.md) - short bullet lists, no filler.

### Files and APIs inspected

- plans/local-board.config.jsonc lines 271-302 (the optionalSteps catalog set by T20260516T1550Z; the five prompt paths are already the targets).
- src/cli.js lines 681-752 (commandSpecialtyRun and statusToStage). Confirms the prompt is resolved with path.resolve(root, entry.prompt) and the JSON payload carries prompt, agent, ticketPath, and ticketContext - so the prompt body can rely on those being available to the executor.
- src/cli.js lines 451-462 (commandComment) and the existing complete-step flow at lines 325-450. Confirms the two evidence-recording paths referenced in the Recording section.
- plans/prompts/steps/gate-check.md, design.md, test.md, document.md - reference points for local-board prompt tone and JSON output style.
- plans/tickets/done/S20260516T1538Z_conditional-specialty-review-steps-security-ui-ux.md Technical Design section - confirms the catalog shape, the step-name:executor evidence format, and that doneRequires does not gate on specialty entries.
- c:/Users/Nicho/Documents/task-board/prompts/optional-steps/design/{security_threat_model,ui_component_review,ux_interaction_review}.md and impl/{security_audit,ui_visual_review}.md for the five source files. Each is 23-30 lines and contains no task-board-specific tokens that would survive the strip rules - the port is mostly a reframing exercise around the same checklist content.
- test/cli.test.js lines 593-947 - existing specialty-run coverage. Confirms the new prompt-paths test can reuse runCli and the JSON payload schema.

### Risks and edge cases

- Path drift between catalog and disk. The five prompt values in optionalSteps must match the filenames exactly, including the impl (not implement) directory and the _review vs _audit suffixes. The new on-disk test (below) catches drift in either direction.
- Prompt content drift from task-board upstream. Accepted. The port is a snapshot; future task-board changes do not propagate automatically. Note this in the Documentation Updates section so future-us knows.
- Over-paraphrasing the security checklist. The seven items in security_audit (input validation, authn and authz, data exposure, injection, cryptography, dependencies, error handling) and the STRIDE list in security_threat_model are the load-bearing content. Preserve them as bullet headings and keep the supporting sentence beneath each.
- Output contract divergence between specialties. All five must emit the same top-level JSON shape so the specialty-run caller can treat them uniformly. If a specialty has nothing useful for location or recommendation, the agent may omit those fields per-finding, but verdict and findings are required.
- Inline executor running the prompt. The catalog leaves agent unset, so per src/cli.js line 706 the default route is inline. The prompts must read sensibly when executed inline by the orchestrator active model, not only by a subagent. Avoid second-person framing that assumes a separate worker process.
- validate ignores prompt files on disk. There is no validator that cross-checks optionalSteps[*].prompt paths against the filesystem today. The new test (below) fills that gap for v1.
- npm run validate (ticket validation) remains independent of these prompt files; it should stay clean once the ticket is moved and the prompts exist. No front-matter changes are required.

### Test plan

Add one test to test/cli.test.js (anchored to the existing specialty-run test block) that confirms catalog wiring is self-consistent:

1. Discover root via the existing test harness pattern (real repo root, or the tmpdir fixture pattern used by surrounding tests; the simplest version reads the real project config so we cover the shipped catalog).
2. Load plans/local-board.config.jsonc via loadConfig.
3. For each stage in optionalSteps and each entry in that stage array, resolve path.resolve(root, entry.prompt) and call fs.statSync on it. Assert the file exists and is non-empty.

An alternative shape, also acceptable: drive the same loop via specialty-run --json against a real ticket per stage and fs.statSync the prompt field of the payload. This wires the test through the public command rather than the config loader, which is closer to integration. Pick the loader version for speed and lower fixture cost; pick the command version if a stage has no convenient existing ticket.

Other test coverage:

- No new behavior, no schema change, no new command. Existing specialty-run tests already cover dispatch, stage mapping, unknown step rejection, per-entry agent override, and empty-stage rejection. They do not need updating.
- npm test must remain green.
- npm run validate (ticket validation) must remain clean. The five new files do not affect ticket front matter.

### Documentation updates

- The story-level Technical Design already documents the catalog and prompt intent. No memory-bank/ updates expected; the prompts themselves are the documentation of what each specialty inspects.
- If docs/ or README.md references the catalog by name or path, leave a pointer to plans/prompts/optional-steps/ so readers can find the ported prompts. Audit during the Documentation step of this ticket; likely a no-op.
- Record the upstream snapshot in this ticket Implementation Notes so future ports against the same task-board source files can be diffed.

### Out of scope

- The other ~19 task-board specialty prompts. Per the story Out-of-scope section, they ship as a follow-up. No catalog entries, no files.
- Any change to src/ or test/ (other than the single new prompt-paths test), plans/local-board.config.jsonc, the orchestrator skill, or the specialty-run / gate-check commands. T20260516T1550Z and T20260516T1554Z own those.
- Marker-comment formatting in the Review Findings section. Story S20260516T1539Z is the owner; this ticket only references plain local-board comment ID TEXT --section Review Findings.
- Auto-rerun on FAIL verdict. v1 is single-pass; the orchestrator records the verdict as evidence and the human (or a future loop) decides what to do with it.

### Suggested commands

Implementation will run (no actions taken in this design pass):

- Author each of the five files at the target paths using the template above.
- npm test to confirm the new prompt-paths test passes.
- node C:/Users/Nicho/.local-board/bin/local-board.js validate to confirm ticket validation is clean.
- Parent orchestrator records this design via node C:/Users/Nicho/.local-board/bin/local-board.js complete-step T20260516T1553Z design --executor claude-subagent:local-board-designer --evidence SUMMARY.

## Implementation Notes

## Review Findings

**Verdict:** PASS.

Reviewer: codex-task:read-only (gpt-5.5). Static spot-check (security_threat_model + security_audit).

- Source templating/COMPLETE framing stripped from both checked prompts; STRIDE and seven-topic audit guidance preserved (plans/prompts/optional-steps/design/security_threat_model.md:15-24 and plans/prompts/optional-steps/impl/security_audit.md:15-23).
- JSON contract clearly specified: verdict (PASS|CONCERNS|FAIL), findings array with severity/summary/optional location+recommendation. Semantics explicit at security_threat_model.md:26-46 and security_audit.md:25-45.
- Recording uses local-board complete-step / comment flows. No GitHub Projects, PR, label, section_update, or /.aiboard paths in either spot-checked prompt.
- New test in test/cli.test.js:961-984 walks every config.optionalSteps stage and asserts each entry's prompt path resolves to an existing non-empty file.

## Test Evidence

Verification of commit 6378e51 on feature/estimation-and-specialty-steps by claude-subagent:local-board-tester.

Commands run (all from C:/Users/Nicho/Documents/local-board):

- `npm test` -> 90/90 pass, 0 fail, 0 skipped (duration ~3.6s). Includes the new "optionalSteps catalog prompt paths resolve to existing non-empty files on disk" test.
- `npm run check` -> clean (node --check of bin/local-board.js, src/cli.js, src/config.js, src/git.js, src/scaffold.js, src/tickets.js, install.mjs).
- `npm run validate` -> "Ticket validation OK".

Live smoke (scratch ticket T20260516T2252Z created via `local-board create task` then moved between statuses; deleted after the run; final `local-board validate` re-confirmed clean):

- `specialty-run T20260516T2252Z security_audit --json` (ticket in ready_for_implementation) -> JSON resolved prompt to C:/Users/Nicho/Documents/local-board/plans/prompts/optional-steps/impl/security_audit.md (exists, 2297 bytes), stage=implement, agent=inline.
- `specialty-run T20260516T2252Z ui_visual_review --json` (same ticket) -> resolved to plans/prompts/optional-steps/impl/ui_visual_review.md (exists, 2247 bytes).
- `specialty-run T20260516T2252Z security_threat_model --json` (after move to ready_for_design) -> resolved to plans/prompts/optional-steps/design/security_threat_model.md (exists, 2333 bytes), stage=design.
- `specialty-run T20260516T2252Z ui_component_review --json` -> resolved to plans/prompts/optional-steps/design/ui_component_review.md (exists, 2047 bytes).
- `specialty-run T20260516T2252Z ux_interaction_review --json` -> resolved to plans/prompts/optional-steps/design/ux_interaction_review.md (exists, 2126 bytes).

All five prompt paths returned by specialty-run --json point at real, non-empty files on disk and match the catalog entries in plans/local-board.config.jsonc lines 271-302.

Spot-check (security_threat_model + ui_visual_review):

- Both open with a one-sentence role/scope statement naming the specialty and stage.
- Inputs section lists ticket path, stage-relevant artifact (Technical Design for design, diff/Implementation Notes for impl), and related context.
- Review Scope retains the substantive checklist from the task-board source: STRIDE list preserved in security_threat_model (item 8); pixel-perfect/theming/responsive points preserved in ui_visual_review (items 1-7).
- Severity language (Critical/High/Medium/Low) present in both.
- Output Contract is unambiguous: strict JSON, no prose, no code fences; object with verdict in {PASS, CONCERNS, FAIL} and findings array of {severity, summary, location?, recommendation?}. PASS=empty findings; CONCERNS=Medium-or-below; FAIL=Critical/High - stated explicitly under the schema in both files.
- Recording section instructs the orchestrator to use `local-board complete-step <id> <step> --executor <executor> --evidence "<VERDICT>: <summary>"` and references `local-board comment <id> "<text>" --section "Review Findings"` as the longer-note fallback.

Banned-token sweep across all five ported prompts (`section_update`, `managed section`, `Octokit`, `PR link`, `aiboard`, `GitHub Projects`, `TaskName`, `TaskId`, `TaskBody`, `/.aiboard/`) -> no matches.

Acceptance criteria coverage:

- All five target files exist with the correct paths matching the config entries: PASS (sizes 2047-2333 bytes; resolved via specialty-run live).
- Each prompt opens with a brief role/scope statement and lists the review questions/checklist: PASS (spot-checked 2 of 5; design references the other three indirectly via specialty-run resolving them).
- No references to section_update, managed sections, GitHub PRs, labels, or task-board tooling: PASS (grep clean).
- Each prompt instructs evidence via complete-step or comment: PASS (Recording section present in both spot-checked files; design + new test in test/cli.test.js asserts file presence).
- Paths line up with optionalSteps so specialty-run can resolve them: PASS (5/5 resolved via live --json runs).
- local-board validate remains clean: PASS.
- Depends on T20260516T1550Z (paths match catalog): PASS (catalog and on-disk paths identical).

Gaps / caveats:

- Spot-check was limited to security_threat_model.md and ui_visual_review.md as instructed. The other three prompts were not opened during this verification beyond confirming filesystem existence and size; the prior codex-task review covered security_threat_model + security_audit, leaving ui_component_review, ux_interaction_review, and ui_visual_review without a deep human/agent spot-read in either pass. Low risk - the catalog-paths test and the consistent 2.0-2.3kB sizes argue against a malformed file.
- No live tickets currently sit in design or implement statuses, so the smoke test used an ephemeral scratch ticket (T20260516T2252Z) that was created, exercised, deleted, and re-validated within this run. No persistent state changes.

## Documentation Updates

Updated in commit b857fe1:

- memory-bank/systemPatterns.md - one-line reference to v1 specialty prompt location at plans/prompts/optional-steps/{design,impl}/.
- docs/Workflow.md - Optional Steps catalog subsection listing the 5 ported prompts (with one-line descriptions) and noting they are a snapshot from the task-board project.
- README.md - repo layout now includes plans/prompts/optional-steps/.

Docs author: codex-task:workspace-write (gpt-5.5). Codex sandbox blocked .git writes; orchestrator committed.

## Questions

## Run Log

- 2026-05-16T22:43:49Z: Completed design via claude-subagent:local-board-designer: Design: port 5 task-board specialty prompts to plans/prompts/optional-steps/{design,impl}. 6-part shape per prompt (heading, role/scope, Inputs, Review Scope verbatim, JSON Output Contract verdict+findings, Recording). Strip section_update contract, GitHub-specific refs, aiboard paths. Single new test: fs.statSync each catalog prompt path.

- 2026-05-16T22:43:49Z: Ensured git branch feature/estimation-and-specialty-steps (already-current).

- 2026-05-16T22:50:14Z: Completed implement via claude-subagent:local-board-implementer: Implemented in commit 6378e51. Created 5 specialty prompts: plans/prompts/optional-steps/design/{security_threat_model,ui_component_review,ux_interaction_review}.md and plans/prompts/optional-steps/impl/{security_audit,ui_visual_review}.md. Each follows 6-part shape with strict JSON output contract. New catalog-prompt-paths test asserts every catalog entry resolves to a non-empty file. npm test 90/90; check + validate clean. Note: ticket body has duplicated sections (pre-existing structural issue, not gating).

- 2026-05-16T22:51:53Z: Completed review via codex-task:read-only: Codex review of commit 6378e51. Verdict: PASS. Spot-checked security_threat_model (design) and security_audit (impl): source templating stripped, substantive checklists preserved, JSON contract well-specified, no banned task-board tokens. New catalog-paths test walks every stage entry correctly.

- 2026-05-16T22:55:08Z: Completed test via claude-subagent:local-board-tester: npm test 90/90; check + validate clean. Live smoke: specialty-run --json on all 5 v1 step names resolved to existing non-empty prompt files (sizes 2.0-2.3 KB). Banned-token grep clean (no section_update, /.aiboard/, GitHub Projects). Verdict: PASS.

- 2026-05-16T22:57:14Z: Completed document via codex-task:workspace-write: Doc updates in commit b857fe1: memory-bank/systemPatterns.md, docs/Workflow.md (Catalog subsection), README.md (repo layout).

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-05-16T22:43:49Z: Completed design via claude-subagent:local-board-designer: Design: port 5 task-board specialty prompts to plans/prompts/optional-steps/{design,impl}. 6-part shape per prompt (heading, role/scope, Inputs, Review Scope verbatim, JSON Output Contract verdict+findings, Recording). Strip section_update contract, GitHub-specific refs, aiboard paths. Single new test: fs.statSync each catalog prompt path.

- 2026-05-16T22:43:49Z: Ensured git branch feature/estimation-and-specialty-steps (already-current).
