---
id: T20260516T1552Z
type: task
status: archived
priority: P2
parent: S20260516T1538Z
children: []
blockedBy: [T20260516T1550Z]
blocks: [T20260516T1554Z]
branch: feature/estimation-and-specialty-steps
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-05-16T15:52:10Z
updated: 2026-07-07T14:07:41Z
completedSteps: [design:claude-subagent:local-board-designer, implement:claude-subagent:local-board-implementer, review:codex-task:read-only, test:claude-subagent:local-board-tester, document:codex-task:workspace-write]
routingApprovals: []
---
# Add specialty-run dispatcher CLI

## Requirement

Add a CLI command `local-board specialty-run <ticket-id> <step-name> [--json]`. It is a thin dispatcher analogous to `begin-step`:
1. Resolve the ticket's current stage from its status (e.g. `designing`/`ready_for_design` -> `design`; `implementing`/`ready_for_implementation` -> `implement`; `testing`/`ready_for_test` -> `test`).
2. Look up `<step-name>` in the `optionalSteps` catalog for that stage (loaded via task T20260516T1550Z's config loader).
3. Reject with a non-zero exit and a clear message if the step is not in the stage's catalog.
4. Resolve the agent route from the entry's `agent` field, defaulting to inline if absent.
5. Print a JSON payload with the resolved prompt path, agent route, step name, and ticket context. The orchestrator skill consumes this and dispatches the agent. Completion is recorded later via the existing `complete-step <id> <step-name> ...` command — no new schema or state writes here.

Wire help text and usage line.

## Acceptance Criteria

- `local-board specialty-run <ticket-id> <step-name>` appears in CLI help/usage.
- Unknown ticket IDs produce a clear error and non-zero exit.
- Unknown step names (not present in the current stage's catalog) produce a clear error and non-zero exit.
- Known step name produces a JSON payload (with `--json`) containing: `name`, `prompt` (absolute or repo-relative path), `agent` (resolved route or `inline`), `stage`, and ticket context (id, title, status).
- Stage resolution maps statuses correctly: design statuses -> `design` catalog; implement statuses -> `implement` catalog; test statuses -> `test` catalog.
- The command does NOT mutate the ticket. Evidence recording remains the responsibility of the existing `complete-step` command.
- `npm test` covers: successful dispatch for a known step in each stage; rejection of unknown step; rejection when the ticket's current status has no associated stage in the catalog.
- Depends on `optionalSteps` config (T20260516T1550Z).

## Related Tickets

## Technical Design

This design adds a thin dispatcher CLI `local-board specialty-run <ticket-id> <step-name> [--json]`. It is read-only with respect to the ticket: it resolves the ticket stage from status, looks up the specialty step in the per-stage `optionalSteps` catalog, resolves the prompt path and agent route, and emits a JSON payload the orchestrator skill (T20260516T1554Z) consumes to dispatch an agent. Evidence is recorded later via the existing `complete-step` command; no schema changes here.

### Scope and non-goals

In scope:
- New CLI subcommand `local-board [--root PATH] specialty-run TICKET_ID STEP_NAME [--json]`.
- Status-to-stage mapping inside the command.
- Per-entry agent override resolution; default to `inline` when absent.
- Help text and usage line wired into `printUsage` in `src/cli.js`.
- Unit tests in `test/cli.test.js`.

Out of scope:
- Orchestrator wiring (T20260516T1554Z).
- The specialty prompt files at `plans/prompts/optional-steps/` (T20260516T1553Z creates them).
- Recording evidence; the orchestrator uses `complete-step STEP_NAME --executor ... --evidence ...` separately. The CLI does not invoke the agent and does not mutate the ticket.
- Re-validating the `optionalSteps` entry shape; `loadConfig` already validated and normalized entries via `validateOptionalStepEntry` in `src/config.js`.

### Behavior

CLI surface and parsing follow the same patterns used by `commandGateCheck` and `commandBeginStep`:

- Positional: `TICKET_ID`, `STEP_NAME`. Both required.
- Optional flag: `--json`.
- Use `takeFlag`, `takeOption`, `ensureNoArgs` to parse. Missing positionals throw `specialty-run requires: <ticket-id> <step-name> [--json]`. The phrase `specialty-run requires` is the regex anchor tests assert.

Resolution flow inside `commandSpecialtyRun(root, args)`:

1. Parse `TICKET_ID`, `STEP_NAME`, `--json`. Reject extras with the standard `unexpected argument: X` from `ensureNoArgs`.
2. Call `loadConfig(root)`. Reuses `optionalSteps` normalization.
3. Call `findTicket(root, ticketId)`. Unknown ticket throws the existing `ticket TICKET_ID not found` message (consistent with other commands; tests pin this).
4. Map ticket status to stage with a local helper. If the status does not map, throw `specialty-run: status STATUS has no specialty stage (expected designing, ready_for_design, implementing, ready_for_implementation, testing, or ready_for_test)`.
5. Pull the catalog from `config.optionalSteps[stage]` (already guaranteed an array by `normalizeOptionalSteps`). Look up the entry whose `name === STEP_NAME`. If absent, throw `specialty-run: step STEP_NAME not found in optionalSteps.STAGE (available: name1, name2, ...)`. If the catalog is empty, the error reads `(available: none)`.
6. Resolve the prompt path with `path.resolve(root, entry.prompt)` to an absolute path. Do NOT verify the file exists; the orchestrator handles missing-prompt errors, mirroring `gate-check` and `actionPrompts`. This keeps tests independent of T20260516T1553Z landing.
7. Resolve the agent route: `entry.agent` when present (already validated by `validateOptionalStepEntry`), otherwise the literal string `inline`.
8. Build `ticketContext` using the same narrow shape as `gate-check`: id, type, status, priority, path (relative), title, currentAction (from `config.workflow.statusActions[ticket.status]` or null), requirement (from `getSectionText(ticket.body, "Requirement")` or empty string), acceptanceCriteria (from `getSectionText(ticket.body, "Acceptance Criteria")` or empty string).

### Status-to-stage mapping

A small local helper inside `src/cli.js`:

- `designing` and `ready_for_design` map to `design`.
- `implementing` and `ready_for_implementation` map to `implement`.
- `testing` and `ready_for_test` map to `test`.
- Any other status (`backlog`, `ready_for_decomposition`, `ready_for_review`, `reviewing`, `ready_for_docs`, `done`, `archived`, `questions`, `blocked`) returns null and the command rejects.

Recommendation: keep the mapping inline as a local function `statusToStage(status)` private to `commandSpecialtyRun`. Extraction to `src/config.js` is not worth the indirection for one consumer. If T20260516T1554Z orchestrator needs the same mapping it will live in the skill prompt, not shared JS. Revisit if a third consumer appears.

This intentionally excludes review and docs stages. The parent story specifies specialty steps run after design, implement, and test only. `ready_for_review`, `reviewing`, and `ready_for_docs` map to no stage. The orchestrator must call `specialty-run` while the ticket is still in `implementing` or `ready_for_implementation`, before moving to `ready_for_review`; the CLI enforces this with the rejection above.

### JSON output shape (with --json)

Top-level keys:

- `ticket`: TICKET_ID string.
- `stage`: one of `design`, `implement`, `test`.
- `step`: STEP_NAME string, exactly as it appears in the catalog (the config schema constrains names to `^[a-z][a-z0-9_]*$`).
- `prompt`: absolute path to the specialty prompt resolved against `root`. The string is what `path.resolve(root, entry.prompt)` returns on the current platform (backslashes on Windows). Tests use `path.join` or `path.sep`-aware matchers.
- `agent`: `inline` or the per-entry override string (validated as one of `inline`, `claude-subagent:<name>`, `codex-task:<mode>` by the config loader).
- `ticketPath`: absolute path to the ticket `.md` file (`ticket.path`).
- `ticketContext`: same shape as `gate-check`: id, type, status, priority, path, title, currentAction, requirement, acceptanceCriteria.

The output omits the `catalog` field that `gate-check` returns; `specialty-run` resolves to a single step, not the whole catalog. The orchestrator already saw the catalog via `gate-check`.

### Plain output (without --json)

Two lines, mirroring the `gate-check` plain output convention:

- Line 1: `specialty-run TICKET_ID step=STEP_NAME stage=STAGE agent=AGENT`.
- Line 2: the absolute prompt path.

Both go to stdout. Exit 0 on success.

### Exit codes

- 0 on success.
- 2 on argument errors, unknown ticket, unmapped status, and unknown step name. This matches the existing CLI convention enforced by `main()` catch block (all thrown errors return 2 with the message on stderr).

### Wiring

- Add the `specialty-run` branch in `main()` immediately after the `gate-check` branch, dispatching to `commandSpecialtyRun(root, args)`.
- Add a usage line to `printUsage`: `local-board [--root <path>] specialty-run <ticket-id> <step-name> [--json]`. Place it next to the `gate-check` line.
- No new imports required. Reuse the existing imports of `findTicket`, `getSectionText`, `ticketRecord`, `loadConfig`, and the `path` module.

### Test plan

Add a new top-level test block in `test/cli.test.js` following the `gate-check` precedent. Reuse `withBoard` and `runCli` helpers.

1. Happy path, `implementing` status, known step.
   - `init`, then `create task` and move to `implementing` via `set TICKET status implementing` (or create directly via `--status implementing`).
   - Run `specialty-run TICKET security_audit --json`.
   - Assert exit 0; `out.ticket = TICKET`, `out.stage = implement`, `out.step = security_audit`, `out.agent = inline` (default catalog has no agent override).
   - Assert `out.prompt` ends with `path.join("plans", "prompts", "optional-steps", "impl", "security_audit.md")`.
   - Assert `out.ticketContext` keys are id, type, status, priority, path, title, currentAction, requirement, acceptanceCriteria. `currentAction` is null for `implementing` (not in `statusActions`); this matches `gate-check` behavior.

2. Happy path, `ready_for_design` status, design-stage step.
   - Create task in `ready_for_design`. Run `specialty-run TICKET ui_component_review --json`.
   - Assert `out.stage = design`, `out.step = ui_component_review`, `out.agent = inline`, `out.ticketContext.currentAction = design`.

3. Per-entry agent override returns the `agent` field correctly.
   - Write a minimal config that adds a single design-stage entry with an `agent` override (follow the precedent from the `gate-check` empty-optionalSteps test which overwrites the seeded config with a minimal JSON file).
   - Create task in `ready_for_design`. Run `specialty-run TICKET custom_review --json`.
   - Assert `out.agent = codex-task:read-only`.

4. Default agent is `inline` when entry lacks `agent`.
   - Covered explicitly in case 1; assert the resolved `agent` is the literal string `inline`, not undefined or null.

5. Unknown step rejected.
   - Create task in `ready_for_design`. Run `specialty-run TICKET nope_step`.
   - Assert exit 2; stderr matches `step nope_step not found in optionalSteps.design` and includes the three default names (`security_threat_model`, `ui_component_review`, `ux_interaction_review`).

6. Unmapped status rejected.
   - Create task and move to `ready_for_review`. Run `specialty-run TICKET security_audit`.
   - Assert exit 2; stderr matches `status ready_for_review has no specialty stage`.
   - Repeat for `done`, `backlog`, and `questions` to pin the policy. Three cheap extra assertions.

7. Unknown ticket rejected.
   - Run `specialty-run T20990101T0000Z security_audit`.
   - Assert exit 2; stderr matches `ticket T20990101T0000Z not found`.

8. Empty catalog stage rejected with helpful list.
   - Default config has an empty `test` catalog. Create task in `ready_for_test`. Run `specialty-run TICKET anything`.
   - Assert exit 2; stderr matches `optionalSteps.test (available: none)`.

9. Plain (non-JSON) output smoke test.
   - Re-run case 1 without `--json`.
   - Assert exit 0; first stdout line matches `/^specialty-run .* step=security_audit stage=implement agent=inline$/`; second line is the absolute prompt path.

10. JSON shape stable across runs.
    - Re-run case 1 twice and `assert.deepEqual` the parsed outputs to pin field shape stability. Guards against drift when the orchestrator wiring lands.

11. Missing positional arguments rejected.
    - Run `specialty-run` and `specialty-run TICKET` (no step). Both exit 2 with `specialty-run requires` in stderr.

The acceptance criteria call out tests covering successful dispatch for a known step in each stage, rejection of unknown step, and rejection when the ticket current status has no associated stage. Cases 1, 2, 5, and 6 cover these. The brief also requires coverage of the agent override path (case 3) and JSON shape stability (case 10).

### Risks and edge cases

- A status not in `workflow.statusActions` (e.g. `implementing`, `designing`, `testing`) still maps to a stage. `currentAction` in the emitted `ticketContext` will be null for these statuses; that mirrors `gate-check` and is acceptable. The orchestrator does not depend on `currentAction` for `specialty-run` dispatch since the resolved `stage` is already explicit in the payload.
- The `--stage` flag from `gate-check` is intentionally absent. Stage is derived from status, not a CLI argument. Pin this with test case 6 (unmapped status rejection) rather than introducing a redundant override.
- The CLI does not validate that the ticket has completed its mandatory action for the stage. A ticket in `ready_for_design` could be sent to `specialty-run` before its design is drafted. The orchestrator (T20260516T1554Z) is responsible for sequencing: `complete-step <mandatory>` then `gate-check` then `specialty-run` per requested step. Documenting this in CLI help over-constrains the tool.
- Per-entry agent override values are already validated by `validateOptionalStepEntry` in `src/config.js` to match `inline`, `claude-subagent:<name>`, or `codex-task:<mode>`. The CLI passes through whatever survived normalization. No re-validation needed.
- Windows path resolution returns backslashes from `path.resolve`. Tests compare with `path.join` or `path.sep`-aware matchers, never hardcoded forward slashes.
- The default agent is the literal string `inline`, not null or undefined. This is a contract with the orchestrator: the JSON consumer can dispatch unconditionally on `out.agent` without nil checks.
- STEP_NAME casing: the config requires `^[a-z][a-z0-9_]*$`. Lookup is strict equality. Mixed-case input from the orchestrator would be a bug; the CLI returns the standard step-not-found error rather than silently lowercasing. The error lists available names, which makes the mismatch obvious.
- Empty catalog: case 8 above. Common when a stage `optionalSteps` array is empty (default `test` catalog). The error message must explicitly say `(available: none)` so the orchestrator can distinguish no specialties for this stage from wrong step name.
- The unmapped-status rejection message should be terse: list the six supported statuses, not all 15.
- The prompt file referenced by an entry may not exist on disk until T20260516T1553Z lands. The CLI deliberately does not stat the file; the orchestrator surfaces missing-prompt errors. Tests do not depend on prompt files existing.

### Files inspected

- c:/Users/Nicho/Documents/local-board/plans/tickets/ready/T20260516T1552Z_add-specialty-run-dispatcher-cli.md
- c:/Users/Nicho/Documents/local-board/plans/tickets/done/S20260516T1538Z_conditional-specialty-review-steps-security-ui-ux.md
- c:/Users/Nicho/Documents/local-board/plans/tickets/done/T20260516T1551Z_add-gate-check-prompt-and-cli-command.md (sibling gate-check pattern)
- c:/Users/Nicho/Documents/local-board/src/cli.js (commandGateCheck, commandBeginStep, takeOption, takeFlag, ensureNoArgs, printUsage, main router)
- c:/Users/Nicho/Documents/local-board/src/config.js (OPTIONAL_STEP_STAGES, normalizeOptionalSteps, validateOptionalStepEntry, isValidOptionalStepAgent)
- c:/Users/Nicho/Documents/local-board/src/tickets.js (findTicket, ticketRecord, getSectionText, STATUSES)
- c:/Users/Nicho/Documents/local-board/test/cli.test.js (runCli, withBoard, gate-check tests as precedent)

### Documentation impact

- `printUsage` help in `src/cli.js` is the canonical command surface; add the `specialty-run` line next to `gate-check`.
- `memory-bank/systemPatterns.md` lists the MVP CLI command set. Add a one-line entry under read-mostly commands; `specialty-run` does not mutate state.
- `docs/Workflow.md` mentions gate-check under Optional Steps. A short follow-on subsection (Specialty-run dispatcher) can land here, or be deferred to T20260516T1554Z when the orchestrator wiring closes the loop.
- `README.md` lists CLI commands; add `specialty-run` to the list.

### Suggested closeout sequence

1. Implement `commandSpecialtyRun` and the local `statusToStage` helper in `src/cli.js`.
2. Wire into `main()` router and `printUsage`.
3. Add the 11-case test block in `test/cli.test.js`.
4. Run `npm test`, `npm run check`, `npm run validate`.
5. Update `memory-bank/systemPatterns.md` and `README.md` CLI lists; defer `docs/Workflow.md` to the document step if time-bound.

## Implementation Notes

Implemented `commandSpecialtyRun` and local `statusToStage` helper in `src/cli.js`, wired into `main()` router next to `gate-check`, and added the `specialty-run` line to `printUsage`. JSON payload mirrors the design: `ticket`, `stage`, `step`, `prompt` (absolute path via `path.resolve(root, entry.prompt)`), `agent` (entry override or literal `inline`), `ticketPath`, and a `ticketContext` matching the gate-check shape. Status-to-stage covers `designing`/`ready_for_design` -> `design`, `implementing`/`ready_for_implementation` -> `implement`, `testing`/`ready_for_test` -> `test`; any other status throws with the list of six supported statuses. Catalog lookup returns the standard `step NAME not found in optionalSteps.STAGE (available: ...)` error, using `(available: none)` for empty stages. Plain output is two lines: `specialty-run TICKET step=NAME stage=STAGE agent=AGENT` followed by the absolute prompt path. Added 3 new test blocks in `test/cli.test.js` covering the 11 cases per design (happy paths for implementing and ready_for_design, JSON shape stability via deep-equal, plain output smoke, unknown step rejection with available-name assertions, four unmapped-status rejections including `ready_for_review`, `done`, `backlog`, and `questions`, unknown ticket, missing positional args, empty-catalog rejection, per-entry agent override). All 88 tests pass; `npm run check` and `npm run validate` clean. Commit acfcc72.

## Review Findings

**Verdict:** CONCERNS (soft pass — coverage gap, not behavior gap).

Reviewer: codex-task:read-only (gpt-5.5). Static review.

**Confirmed correct:**
- specialty-run routed and listed in usage (src/cli.js:114, :827). statusToStage maps designing/ready_for_design, implementing/ready_for_implementation, testing/ready_for_test; returns null otherwise (src/cli.js:741). Null stages rejected (src/cli.js:689).
- Catalog lookup uses config.optionalSteps[stage]; unknown steps report available names; empty catalogs report "available: none" (src/cli.js:696).
- agent fallback via Object.hasOwn else 'inline' (src/cli.js:706). JSON payload has ticket, stage, step, prompt, agent, ticketPath, ticketContext (src/cli.js:722). ticketContext mirrors gate-check (src/cli.js:643, :710).

**Concern (non-blocking, coverage gap):**
- Test coverage hits implementing, ready_for_design, empty ready_for_test, and four unmapped statuses (ready_for_review, done, backlog, questions). Missing: designing, ready_for_implementation, active testing with non-empty catalog, blocked, archived. Implementation is correct; tests just don't pin every status flavor. Recommend tester adds table-driven coverage.

## Test Evidence

**Tester:** claude-subagent:local-board-tester (claude-opus-4-7[1m]).

**Commands run (working dir c:/Users/Nicho/Documents/local-board, branch feature/estimation-and-specialty-steps):**

- `npm test` (before) — 88/88 pass.
- `npm run check` — clean.
- `npm run validate` — `Ticket validation OK`.
- `npm test` (after coverage close) — 89/89 pass; new test `CLI specialty-run status-to-stage mapping covers every status` reported `(161.9693ms)`.
- `npm run check` (after) — clean.
- `npm run validate` (after) — `Ticket validation OK`.

**Coverage gap closure:**

Added one table-driven test block at `test/cli.test.js:819`. The test walks every status and asserts `statusToStage` behavior via the `specialty-run` CLI per the review-findings list:

- Success path with non-empty per-stage catalogs (config swapped to a minimal three-entry catalog): `designing` and `ready_for_design` → `design` step `security_threat_model`; `implementing` and `ready_for_implementation` → `implement` step `security_audit`; `testing` and `ready_for_test` → `test` step `perf_smoke`. Asserts exit 0, JSON `ticket`, `stage`, `step`, `agent === "inline"`, and `ticketContext.status` round-trip.
- Reject-unmapped statuses (no swap needed): `ready_for_review`, `reviewing`, `ready_for_docs`, `backlog`, `questions`, `blocked`, `done`, `archived` all exit 2 with `status <STATUS> has no specialty stage` in stderr.
- Empty-catalog branch against the default seed: config swap removed, `testing` and `ready_for_test` exit 2 with `optionalSteps.test (available: none)` in stderr. This pins the brief's explicit expectation that the seeded `test: []` catalog rejects.

Together with the pre-existing test block ("CLI specialty-run dispatches ..."), every status in `STATUSES` is now exercised:

- 6 success statuses asserted (designing/ready_for_design/implementing/ready_for_implementation/testing/ready_for_test).
- 8 reject-unmapped statuses asserted (ready_for_review/reviewing/ready_for_docs/backlog/questions/blocked/done/archived).
- `ready_for_decomposition` is the one remaining `STATUSES` member and falls through `statusToStage` to `null`; covered by the same unmapped branch as the other eight, but not asserted by name. Considered a non-issue: the rejection branch is exercised eight times and the code path has no per-status fork.

**Acceptance criteria coverage:**

All eight acceptance criteria from the ticket remain green via the pre-existing test cases. The reviewer's CONCERNS verdict was a coverage gap on the status enumeration; this commit pins every status that maps to a stage and every unmapped status that should reject.

**Gaps / caveats:**

- The new test mutates `plans/local-board.config.jsonc` inside the temp `withBoard` root, then `rm`s it to fall back to the default seed for the empty-catalog assertion. The cleanup is bounded to the temp dir so no cross-test pollution.
- No new flakes observed across two consecutive `npm test` runs.
- Working tree contains pre-existing untracked ticket-folder moves under `plans/tickets/{done,active,backlog}/...` that are unrelated to this work; staged only `test/cli.test.js` for the commit.

**Commit:** `605d941` on `feature/estimation-and-specialty-steps` — "Close specialty-run status mapping coverage gap (T20260516T1552Z)".

## Documentation Updates

Updated in commit 78a6085:

- memory-bank/systemPatterns.md - specialty-run added to MVP CLI list (resolves an optional step without invoking an agent).
- docs/Workflow.md - new Specialty-run subsection under Optional Steps covering command usage, status-to-stage mapping, JSON output fields, inline default agent behavior, orchestrator handoff pattern. Forward-ref to T20260516T1554Z.
- README.md - specialty-run added to CLI list.

Docs author: codex-task:workspace-write (gpt-5.5). Codex sandbox blocked .git writes; orchestrator committed.

## Questions

## Run Log

- 2026-05-16T22:20:21Z: Completed design via claude-subagent:local-board-designer: Design: new commandSpecialtyRun in src/cli.js. Status-to-stage mapping (design/implement/test); catalog lookup with available-names error; prompt path resolved absolute; agent override falls back to inline. ticketContext shape matches gate-check. JSON: {ticket, stage, step, prompt, agent, ticketPath, ticketContext}. 11-case test plan.

- 2026-05-16T22:20:21Z: Ensured git branch feature/estimation-and-specialty-steps (already-current).

- 2026-05-16T22:24:12Z: Completed implement via claude-subagent:local-board-implementer: Implemented in commit acfcc72. commandSpecialtyRun in src/cli.js with statusToStage helper. Returns JSON {ticket, stage, step, prompt, agent, ticketPath, ticketContext}. Agent route via Object.hasOwn else 'inline'. 3 new test blocks covering 11 cases. npm test 88/88; check + validate clean.

- 2026-05-16T22:26:34Z: Completed review via codex-task:read-only: Codex review of commit acfcc72. Verdict: CONCERNS — coverage gap only. Behavior correct: status mapping, catalog lookup, available-names error, empty-catalog handling, agent fallback, JSON shape. Concern: tests miss designing, ready_for_implementation, active testing with non-empty catalog, blocked, archived. Tester will close.

- 2026-05-16T22:32:56Z: Completed test via claude-subagent:local-board-tester: npm test 89/89 after closing status mapping coverage gap (commit 605d941). Table-driven test pins every status branch of statusToStage (success: 6 mapped statuses; reject: 8 unmapped; empty-catalog: testing+ready_for_test with default seed). check + validate clean. Verdict: PASS.

- 2026-05-16T22:35:07Z: Completed document via codex-task:workspace-write: Doc updates in commit 78a6085: memory-bank/systemPatterns.md, docs/Workflow.md (Specialty-run subsection), README.md.
