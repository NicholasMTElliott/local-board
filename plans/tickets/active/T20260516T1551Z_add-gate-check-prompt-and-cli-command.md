---
id: T20260516T1551Z
type: task
status: implementing
priority: P2
parent: S20260516T1538Z
children: []
blockedBy: [T20260516T1550Z]
blocks: [T20260516T1554Z]
branch: feature/estimation-and-specialty-steps
estimate: null
created: 2026-05-16T15:51:06Z
updated: 2026-05-16T18:50:15Z
completedSteps: [design:claude-subagent:local-board-designer]
routingApprovals: []
---
# Add gate-check prompt and CLI command

## Requirement

Add `plans/prompts/steps/gate-check.md`. The prompt instructs the agent to read the current ticket file plus the recent diff (or, for design-stage gates, the design draft sections) and emit a strict-JSON object `{ "requestedSteps": ["<step-name>", ...] }`. Empty list is the common case. Steps must be drawn from the catalog for the current stage; the prompt enumerates the available names and their `triggers` text so the agent can pattern-match without quality-judging.

Add a new CLI command `local-board gate-check <ticket-id> --stage <stage> [--json]`. It:
1. Loads the ticket and the catalog from config (depends on task T20260516T1550Z).
2. Validates `--stage` is one of `design`, `implement`, `test`.
3. Prints a JSON payload containing the resolved prompt path, the ticket context (id, title, status, requirement, acceptance criteria, current stage), and the available catalog entries for that stage. The orchestrator skill consumes this and dispatches the gate-check agent.

Wire help text and usage line.

## Acceptance Criteria

- `plans/prompts/steps/gate-check.md` exists and documents the `{ requestedSteps: [...] }` JSON contract, empty-list semantics, and the per-stage catalog lookup rule.
- `local-board gate-check <ticket-id> --stage <stage>` is registered in the CLI help/usage output.
- The command rejects unknown stages with a clear error.
- The command rejects unknown ticket IDs with a clear error.
- With `--json`, the command emits a JSON object containing the prompt path, ticket context, and the catalog entries for the requested stage.
- Without `--json`, a human-readable summary is printed (path + catalog names).
- `npm test` covers: command exits non-zero on invalid stage; JSON payload contains the expected keys and the correct catalog entries for `design` and `implement`; ticket without `optionalSteps` configured returns an empty catalog and the command still succeeds.
- Depends on `optionalSteps` config (T20260516T1550Z).

## Related Tickets

## Technical Design

This design adds the gate-check prompt file and a thin CLI command that hands the orchestrator everything it needs to dispatch a gate-check pass. The CLI is intentionally a read-only catalog/context resolver; it does not call any agent. The orchestrator skill (out of scope here; lives in T20260516T1554Z) takes this output, dispatches the configured agent against the prompt, parses the returned JSON, and then calls specialty-run per requested step (T20260516T1552Z).

### Scope and non-goals

In scope:
- New prompt file plans/prompts/steps/gate-check.md.
- New CLI subcommand: local-board [--root PATH] gate-check TICKET_ID --stage STAGE [--json].
- Help text and usage line wired into printUsage in src/cli.js.
- Unit tests in test/cli.test.js.

Out of scope:
- Orchestrator wiring (T20260516T1554Z).
- The specialty-run dispatcher (T20260516T1552Z).
- The specialty prompt files themselves (T20260516T1553Z).
- Status-to-stage mapping policy used by the orchestrator. The CLI takes --stage as a parameter; it does not infer stage from ticket status.

### Prompt: plans/prompts/steps/gate-check.md

Hand-rolled, kept under 40 lines to match the existing prompt style (plans/prompts/steps/design.md, decompose.md). Required content:

1. Role line. Gate-check role; pattern match the work just done against the stage specialty catalog. Do not evaluate quality.
2. Inputs the agent reads:
   - The current ticket file. The path is supplied in the orchestrator invocation context.
   - For design-stage gates: the Technical Design section of the ticket plus any draft notes.
   - For implement-stage and test-stage gates: the recent diff against the merge base. When no diff is available, fall back to the Implementation Notes / Test Evidence sections.
3. The catalog for the current stage. The orchestrator inlines the names and triggers strings from the CLI output into the agent context; the prompt itself just names the contract.
4. Output contract:
   - Strict JSON only. No prose, no fences, no trailing comments.
   - Shape: an object with a requestedSteps array of step names.
   - Empty array is the common case and means no specialty review warranted.
   - Names MUST be drawn from the supplied catalog. Names not in the catalog must be omitted.
5. Decision rules:
   - Only include a step whose triggers text clearly matches the work touched.
   - When uncertain, omit. False positives waste downstream agent time; false negatives are recoverable by humans.
   - This is pattern matching against trigger criteria, not a quality bar.

### CLI command: local-board gate-check

Surface:

- Usage line: local-board [--root PATH] gate-check TICKET_ID --stage STAGE [--json], where STAGE is one of design, implement, test.
- Routed in main() next to the other read-mostly query commands (query-ticket, state-report).
- Implementation lives entirely in src/cli.js as commandGateCheck(root, args). No new module needed; this is glue.

Argument parsing follows the existing pattern (takeOption, takeFlag, ensureNoArgs):

- Required positional: TICKET_ID.
- Required option: --stage STAGE.
- Optional flag: --json.

Validation order (fail fast; return code 2 with a clear error message for each):

1. Missing ticket id. Throw: gate-check requires TICKET_ID --stage STAGE.
2. Missing --stage. Same usage error.
3. Unknown stage. Throw: gate-check --stage must be one of design, implement, test. Use OPTIONAL_STEP_STAGES from src/config.js rather than a local literal.
4. Unknown ticket id. Reuse findTicket(root, ticketId), which already throws ticket ID not found.

Resolution flow inside commandGateCheck:

1. Call loadConfig(root). It already normalizes and validates optionalSteps.
2. Call findTicket(root, ticketId).
3. Pull catalog = config.optionalSteps[stage]. Guaranteed array (possibly empty) by normalizeOptionalSteps.
4. Resolve the prompt path as an absolute path: path.resolve(root, plans/prompts/steps/gate-check.md). We do NOT verify the file exists at this stage; the orchestrator handles missing prompt errors, mirroring how actionPrompts paths are treated elsewhere. Tests do not need to create the prompt file to exercise the CLI resolution logic.
5. Build the ticket context block. Reuse ticketRecord(root, ticket) for the base record, then enrich with section text and the canonical action for the current status.
   - requirement: text of the Requirement section. Use the existing section walker, factored out from appendToSection/replaceSection. See Refactor below.
   - acceptanceCriteria: text of the Acceptance Criteria section.
   - currentAction: config.workflow.statusActions[ticket.status] or null, so the orchestrator can sanity-check the requested stage against the ticket pipeline position.

JSON output shape (when --json is set) contains these top-level keys:

- ticket: TICKET_ID string.
- stage: STAGE string.
- prompt: absolute path to plans/prompts/steps/gate-check.md.
- ticketPath: absolute path to the ticket .md file.
- ticketContext: object containing id, type, status, priority, path (relative), title, currentAction (one of design, implement, test, or null), requirement (string), acceptanceCriteria (string).
- catalog: array of objects with name, prompt (relative path from config), triggers, and an optional agent field.

The agent field is present on a catalog entry only when the source config entry had one. This preserves the shape produced by validateOptionalStepEntry.

Plain output (no --json):

- Line 1: short summary of the form: gate-check TICKET_ID stage=STAGE catalog=N.
- Line 2: the absolute prompt path.
- If the catalog is non-empty, one line per entry: - NAME: TRIGGERS. No truncation needed in v1.

Exit codes: 0 on success (including the empty-catalog case). 2 on argument errors and unknown ticket. This matches the existing CLI convention enforced by main() catch block.

### Refactor: section-text reader

src/tickets.js currently exposes appendToSection and replaceSection but no read-only get this section text helper. Two options:

1. Add a getSectionText(body, section) helper alongside the existing two and export it. The CLI command calls it for Requirement and Acceptance Criteria. Missing section returns null (do not throw; the ticket may be partial mid-flow).
2. Inline a small regex-based extractor in src/cli.js. Avoid this; duplicates the section-walking logic and risks drift.

Recommendation: option 1. A few new lines of exported function; reuses the existing heading regex contract. Returns the body text between the heading and the next ## heading (or end-of-file), trimmed.

### Test plan: test/cli.test.js

Add a new top-level test block. Reuse the existing withBoard and runCli helpers.

Cases:

1. Happy path, design stage, default config.
   - init, then create task in ready_for_design.
   - Run gate-check TICKET_ID --stage design --json.
   - Assert exit 0.
   - Parse stdout; assert ticket equals id, stage equals design, prompt ends with plans/prompts/steps/gate-check.md, ticketContext.id equals id, ticketContext.status equals ready_for_design, ticketContext.currentAction equals design.
   - Assert catalog.length equals 3 and names equal [security_threat_model, ui_component_review, ux_interaction_review].

2. Happy path, implement stage.
   - Same ticket. Run gate-check TICKET_ID --stage implement --json.
   - Assert catalog has the two implement entries by name; design entries are NOT present.

3. Empty-catalog stage returns success.
   - Same ticket. Run gate-check TICKET_ID --stage test --json.
   - Assert exit 0, catalog deep-equals empty array, prompt still resolved.

4. Empty optionalSteps (block omitted from config).
   - Write a minimal config containing only the version key, overwriting the default, following the pattern used in the estimate config-override-scale test.
   - Run gate-check TICKET_ID --stage design --json.
   - Assert exit 0, catalog deep-equals empty array.

5. Invalid stage rejected.
   - Run gate-check TICKET_ID --stage docs.
   - Assert exit 2; stderr matches the regex for --stage must be one of design, implement, test.

6. Unknown ticket id rejected.
   - Run gate-check T20990101T0000Z --stage design.
   - Assert exit 2; stderr matches the regex for ticket T20990101T0000Z not found.

7. Plain (non-JSON) output smoke test.
   - Run gate-check TICKET_ID --stage design.
   - Assert stdout first line matches the regex /^gate-check .* stage=design catalog=3$/ and a subsequent line is the absolute prompt path.

8. Missing --stage rejected.
   - Run gate-check TICKET_ID.
   - Assert exit 2; stderr matches the usage error.

The acceptance criteria call out tests covering invalid stage, JSON keys for design and implement, and a ticket without optionalSteps configured returning empty catalog. All three are covered by cases 1, 2, 4, and 5.

### Risks and edge cases

- Catalog field agent is optional. The JSON shape MUST omit agent when absent (do not coerce to null) so the downstream dispatcher no-agent-means-inline logic stays clean. Tests pin this by asserting Object.hasOwn(entry, agent) is false for the default entries.
- A ticket whose status is not in statusActions (for example questions, blocked, done) still resolves currentAction to null rather than throwing. The orchestrator may decline to call gate-check on such tickets, but the CLI itself remains a neutral resolver.
- The --stage parameter is independent of the ticket status. The CLI does not enforce that --stage implement was only called on a ticket in ready_for_implementation, implementing, or ready_for_review. The orchestrator owns that policy; documenting it in the CLI help would over-constrain the tool.
- Section text may contain markdown hostile to JSON only via standard escaping; JSON.stringify handles it. Do not pre-process.
- The gate-check prompt file is created in this same ticket. Tests must not depend on the prompt file being present in fixtures generated by init; the CLI is asserted purely on path resolution. Prompt-file existence is asserted by a separate test that reads the file from the repo and matches required phrases (for example requestedSteps and pattern matching). Keep that test cheap.
- path.resolve(root, ...) on Windows returns backslash paths. Tests should compare with path.join or path.sep-aware matchers, not hardcoded forward slashes. Existing tests follow this pattern.
- Empty optionalSteps is allowed by the config schema (T20260516T1550Z already shipped this). No new config validation needed here.

### Files inspected

- plans/tickets/ready/T20260516T1551Z_add-gate-check-prompt-and-cli-command.md
- plans/tickets/done/S20260516T1538Z_conditional-specialty-review-steps-security-ui-ux.md
- src/cli.js
- src/config.js (OPTIONAL_STEP_STAGES, normalizeOptionalSteps, validateOptionalStepEntry)
- src/tickets.js (findTicket, ticketRecord, appendToSection, replaceSection)
- test/cli.test.js (runCli, withBoard patterns)
- test/config.test.js (existing optionalSteps assertions)
- plans/prompts/steps/design.md and decompose.md (prompt style precedent)

### Documentation impact

- README and docs do not list every subcommand exhaustively; the printUsage help line is the canonical command surface. Add the gate-check line there.
- memory-bank/systemPatterns.md lists the CLI command set at a high level. Add a one-line entry under the read-mostly commands; do not duplicate the spec.
- docs/Workflow.md mentions the gate-check concept in the parent story design. A short note pointing to this command can be added when the orchestrator wiring lands (T20260516T1554Z), not now.

### Suggested closeout sequence

1. Implement commandGateCheck and wire into main() and printUsage.
2. Export getSectionText from src/tickets.js.
3. Author plans/prompts/steps/gate-check.md.
4. Add tests in test/cli.test.js.
5. Run npm test.
6. Update memory-bank/systemPatterns.md CLI surface line.

## Implementation Notes

- Added `plans/prompts/steps/gate-check.md` describing the pattern-match role, inputs by stage, decision rules, and the strict `{ "requestedSteps": [...] }` JSON output contract. Empty list is the documented common case.
- Added `getSectionText(body, section)` in `src/tickets.js` next to `appendToSection`/`replaceSection`. Read-only, returns trimmed section text between the heading and the next `## ` heading, or `null` when missing.
- Added `commandGateCheck` in `src/cli.js` and wired it into `main()` and `printUsage`. Imports `OPTIONAL_STEP_STAGES` from `src/config.js` rather than a local literal, and `getSectionText` from `src/tickets.js`.
- JSON shape: `{ ticket, stage, prompt, ticketPath, ticketContext, catalog }`. `prompt` is the absolute path to `plans/prompts/steps/gate-check.md` resolved against the project root. `ticketContext` contains `id, type, status, priority, path, title, currentAction, requirement, acceptanceCriteria`. `catalog` entries copy `name`, `prompt`, `triggers` and only include `agent` when the source config entry had one (uses `Object.hasOwn` on the normalized config entry rather than coercing to null).
- Plain output: line 1 is `gate-check TICKET_ID stage=STAGE catalog=N`; line 2 is the absolute prompt path; then one `- name: triggers` line per catalog entry.
- Validation order: missing TICKET_ID or `--stage` -> usage error; unknown stage -> error referencing `OPTIONAL_STEP_STAGES`; unknown ticket -> reused `findTicket` "ticket X not found" error. All errors go through the existing `main()` catch and exit code 2.
- Empty catalog stage (e.g. `test` in the shipped default config) returns success with `catalog: []`.

Tests added to `test/cli.test.js`:
1. `CLI gate-check resolves catalog, prompt path, and ticket context per stage`: covers design and implement happy paths (catalog names, length, currentAction, prompt path suffix, `Object.hasOwn(entry, "agent") === false` for default entries), empty-catalog `test` stage, and plain (non-JSON) output smoke (`/^gate-check .* stage=design catalog=3$/`).
2. `CLI gate-check returns empty catalog when optionalSteps is omitted from config`: overwrites the seeded config with `{ "version": 1 }`, confirms catalog is `[]` and exit 0.
3. `CLI gate-check rejects invalid stage, missing stage, and unknown ticket`: each path exits 2 with the expected stderr regex.

Commands run (all clean):
- `npm run check` -> ok.
- `npm test` -> 85/85 pass.
- `npm run validate` -> "Ticket validation OK".

Files changed:
- `plans/prompts/steps/gate-check.md` (new)
- `src/cli.js`
- `src/tickets.js`
- `test/cli.test.js`

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-05-16T18:47:27Z: Completed design via claude-subagent:local-board-designer: Design: new plans/prompts/steps/gate-check.md (pattern-matching gate, returns requestedSteps array). New CLI gate-check ticket --stage [--json] in src/cli.js. JSON: ticket, stage, prompt, catalog, ticketPath. Stage validated against design/implement/test. Empty catalog returns success. 8-test plan. Risk: omit agent field when absent so downstream inline default stays clean.

- 2026-05-16T18:47:27Z: Ensured git branch feature/estimation-and-specialty-steps (already-current).
