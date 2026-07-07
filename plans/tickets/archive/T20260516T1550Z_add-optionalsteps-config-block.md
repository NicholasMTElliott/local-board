---
id: T20260516T1550Z
type: task
status: archived
priority: P2
parent: S20260516T1538Z
children: []
blockedBy: []
blocks: [T20260516T1551Z, T20260516T1552Z, T20260516T1553Z]
branch: feature/estimation-and-specialty-steps
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-05-16T15:50:03Z
updated: 2026-07-07T14:07:41Z
completedSteps: [design:claude-subagent:local-board-designer, implement:claude-subagent:local-board-implementer, review:codex-task:read-only, test:claude-subagent:local-board-tester, document:codex-task:workspace-write]
routingApprovals: []
---
# Add optionalSteps config block

## Requirement

Extend `plans/local-board.config.jsonc` with a new top-level `optionalSteps` object keyed by stage name (`design`, `implement`, `test`). Each value is an array of catalog entries shaped `{ name, prompt, triggers, agent? }`. Seed the v1 catalog with the entries listed in the parent story's Technical Design: `security_threat_model`, `ui_component_review`, `ux_interaction_review` under `design`; `security_audit` and `ui_visual_review` under `implement`. The `test` array ships empty for now.

Update the config loader / schema validation so the new shape is parsed and exposed to consumers (gate-check and specialty-run will read it in later tasks). Loader must not break for configs that omit `optionalSteps` entirely — treat missing as `{}`. Per-entry `agent` field is optional; when absent, treat as inline.

## Acceptance Criteria

- `plans/local-board.config.jsonc` contains the `optionalSteps` block with the five v1 entries described in the parent story Technical Design, plus an empty `test` array.
- Each entry has `name`, `prompt`, `triggers`; `agent` is omitted (inline default) unless explicitly overridden.
- Config loader parses the new block and exposes it on the loaded config object.
- Loader accepts configs without the `optionalSteps` key (backward compatible) and returns an empty catalog in that case.
- `npm test` adds coverage for: (a) parsing the new shape, (b) missing `optionalSteps` returns empty catalog without error, (c) malformed entries surface a clear validation error.
- `local-board validate` remains clean against the updated config.

## Related Tickets

## Technical Design

### Goal

Land the config surface for optional specialty review steps without changing runtime behavior. Downstream tickets (T20260516T1551Z gate-check, T20260516T1552Z specialty-run) read the parsed catalog produced here.

### Config shape

Add a top-level optionalSteps block to plans/local-board.config.jsonc:

~~~jsonc
"optionalSteps": {
  "design": [
    {
      "name": "security_threat_model",
      "prompt": "plans/prompts/optional-steps/design/security_threat_model.md",
      "triggers": "Auth, authorization, cryptography, external API integrations, PII handling, new attack surface."
    },
    {
      "name": "ui_component_review",
      "prompt": "plans/prompts/optional-steps/design/ui_component_review.md",
      "triggers": "New or substantially modified user-facing UI components, layout changes, design-system additions."
    },
    {
      "name": "ux_interaction_review",
      "prompt": "plans/prompts/optional-steps/design/ux_interaction_review.md",
      "triggers": "New user-facing flows, interaction patterns, or significant changes to existing flows."
    }
  ],
  "implement": [
    {
      "name": "security_audit",
      "prompt": "plans/prompts/optional-steps/impl/security_audit.md",
      "triggers": "Changes to auth code, input validation, external API calls, credential handling."
    },
    {
      "name": "ui_visual_review",
      "prompt": "plans/prompts/optional-steps/impl/ui_visual_review.md",
      "triggers": "Visible UI changes - styles, layouts, components, accessibility-relevant markup."
    }
  ],
  "test": []
}
~~~

Per-entry fields:

- name (string, required): lowercase snake_case. Must be unique within its stage. May not collide with mandatory action names (decompose, design, implement, review, test, document).
- prompt (string, required): repo-relative path to the prompt file. Path is not stat-checked at load time; T20260516T1553Z creates the files. Path-shape validation only (non-empty string).
- triggers (string, required): human-readable guidance used by the gate-check prompt. Non-empty.
- agent (string, optional): overrides default routing for this specialty. When omitted, the specialty runs inline. Validated against the same allowed prefixes as agents.* values (inline, claude-subagent prefix, codex-task prefix).

Note: the v1 catalog file ships every entry without agent, so all specialty runs default to inline. The field exists for future per-step overrides.

### Loader changes (src/config.js)

1. Extend DEFAULT_CONFIG with optionalSteps mapped to design, implement, and test keys each holding empty arrays. This guarantees loadedConfig.optionalSteps.<stage> is always an array, eliminating undefined checks in downstream consumers.

2. After mergeConfig runs in loadConfig, call a new normalizeOptionalSteps(merged, configPath) helper that:
   - Returns early if merged.optionalSteps is missing or an empty object.
   - For each known stage key (design, implement, test):
     - If missing, set to empty array.
     - If not an array, throw with a message naming the stage.
     - For each entry, call validateOptionalStepEntry(entry, stage, seenNames).
   - For each unknown key (outside the three stage names), do not throw. Emit a console.warn that includes the config path plus a message that the unknown stage is being ignored, then drop the key from the returned object. This matches the spec: warn but do not fail.

3. validateOptionalStepEntry:
   - Reject non-object entries.
   - Require name (non-empty string), prompt (non-empty string), triggers (non-empty string).
   - Reject duplicate name within a stage; track via the seenNames set per stage.
   - Reject names that collide with mandatory action keys (decompose, design, implement, review, test, document) to keep evidence grep-friendliness unambiguous and to prevent a specialty named review from satisfying mandatory routing later.
   - If agent is present, validate it matches inline or one of the prefixed forms claude-subagent:<name> or codex-task:<mode>. Reject otherwise.
   - All rejections throw Error wrapped by the existing loadConfig catch as configPath then colon then message so users see file plus reason.

4. Because mergeConfig deep-merges objects but replaces arrays wholesale, a user-supplied optionalSteps.design with an empty array overrides the default empty array cleanly. No special merge handling needed.

### Files inspected

- c:/Users/Nicho/Documents/local-board/src/config.js: DEFAULT_CONFIG, loadConfig, mergeConfig, parseJsonc, defaultConfigJsonc.
- c:/Users/Nicho/Documents/local-board/src/tickets.js: schemaRecord shape returned by local-board schema.
- c:/Users/Nicho/Documents/local-board/src/cli.js: commandSchema and usage text.
- c:/Users/Nicho/Documents/local-board/test/config.test.js: existing loader test patterns.
- c:/Users/Nicho/Documents/local-board/plans/local-board.config.jsonc: the file getting the new block.
- Parent story S20260516T1538Z Technical Design / Config shape: authoritative v1 entries.

### Schema command exposure

Add optionalSteps: config.optionalSteps to the object returned by schemaRecord in src/tickets.js. It is one line, mirrors how workflow and agents are already exposed, and lets downstream tooling discover the catalog without re-parsing the config file. The non-JSON commandSchema text output is not extended; specialty catalog listing belongs in a future dedicated command if needed. The trivial addition is justified: future gate-check and specialty-run consumers may run schema queries before loading their own config copy.

### Default config text

defaultConfigJsonc() returns the literal string written by local-board init. Append a new commented section after the git block (or between agents and routing; placement is cosmetic) documenting the shape and the v1 entries. The text must be valid JSONC and round-trip through parseJsonc to the same object the runtime config emits. The existing test that asserts the commented default config loads will catch parser regressions automatically once we add an optionalSteps assertion to it.

### Risks and edge cases

- Array merge semantics: mergeConfig replaces arrays. A user who supplies a partial optionalSteps (only design) gets default implement and test arrays preserved because the top-level key is an object, but if they supply optionalSteps.design as an empty array they wipe the default design entries. That is the desired behavior for an explicit override; mention it in the JSONC comment.
- Comment-aware parser: parseJsonc already handles strings containing comment-like sequences; the new triggers strings include punctuation but no comment-like tokens. Existing parser tests cover the comment-in-string case.
- Backward compatibility: configs predating this change have no optionalSteps key. mergeConfig preserves the defaulted empty arrays from DEFAULT_CONFIG, and normalizeOptionalSteps early-returns. No migration step required.
- Unknown stage warning channel: console.warn is acceptable here. loadConfig already throws via console-free error paths, and other CLI surfaces (validate, schema) tolerate stderr noise. If a future ticket adds a structured warnings collector, route through that instead.
- Name collisions with mandatory actions: rejected at load time. This protects T20260516T1552Z from inadvertently inserting evidence that satisfies doneRequires.
- Agent value validation: keep the regex permissive after the colon to match existing conventions in agents values without adding a hard allow-list that would force config-loader changes whenever a new agent flavor lands.
- Mandatory-name collision example: a config that ships a specialty literally named review would produce ambiguous completedSteps entries. Reject at load time.

### Test plan

Extend test/config.test.js with the following cases. All run under the existing withRoot harness.

1. Happy-path parse: write a config containing the full v1 optionalSteps block; assert config.optionalSteps.design[0].name equals security_threat_model, config.optionalSteps.design.length is 3, config.optionalSteps.implement.length is 2, config.optionalSteps.test.length is 0. Verify per-entry name, prompt, triggers survive parsing.
2. Missing-block backward compat: write a config that omits optionalSteps entirely; assert config.optionalSteps.design, .implement, .test are all empty arrays and no error is thrown.
3. Optional agent field: write a single entry with agent set to claude-subagent:local-board-reviewer and assert the value round-trips on the parsed config.
4. Duplicate-name rejection: write two entries in design sharing the same name; assert loadConfig rejects with a message including duplicate and the offending name.
5. Malformed-entry rejection: each of the following throws a descriptive error from loadConfig:
   - missing name
   - missing prompt
   - missing triggers
   - entry is a string instead of an object
   - optionalSteps.design is an object instead of an array
   - name collides with mandatory action review
   - agent value fails prefix validation (for example a bare string)
6. Unknown-stage warning: write optionalSteps.docs as an array of entries; assert loadConfig resolves without throwing, the returned config has no docs key under optionalSteps, and a console.warn mock records the warning. Use test.mock.method(console, "warn") to capture.
7. Default-config round-trip: update the existing loadConfig reads the commented default config test to additionally assert config.optionalSteps.design[0].name equals security_threat_model and config.optionalSteps.test deep-equals an empty array. This guards defaultConfigJsonc() against drift.

local-board validate already loads the config and surfaces loader errors via the same path; no separate validate test is needed beyond confirming a manual validate run stays clean against the seeded file.

### Out of scope

- Creating plans/prompts/optional-steps/** prompt files: owned by T20260516T1553Z.
- Wiring gate-check or specialty-run consumers: T20260516T1551Z and T20260516T1552Z.
- Adding a CLI subcommand to list the catalog: revisit after consumers ship.
- Per-ticket overrides of the catalog: tracked as future work in the parent story.

### Documentation impact

- plans/local-board.config.jsonc gains the new block and a short JSONC comment describing it.
- defaultConfigJsonc() in src/config.js is the canonical default. No separate docs/ page is required for this task; the parent story documentation ticket (T20260516T1554Z) owns the narrative writeup.
- README documentation index unaffected.

## Implementation Notes

Implementation landed on feature/estimation-and-specialty-steps.

Files changed:

- plans/local-board.config.jsonc: added the optionalSteps block with the v1 catalog (3 design entries, 2 implement entries, empty test array) and a JSONC comment describing the shape and array-merge semantics.
- src/config.js: added OPTIONAL_STEP_STAGES and MANDATORY_ACTION_NAMES, extended DEFAULT_CONFIG with empty optionalSteps arrays, added normalizeOptionalSteps and validateOptionalStepEntry helpers, wired the normalize step into loadConfig after mergeConfig, and updated defaultConfigJsonc to include the populated catalog so the commented default round-trips.
- src/tickets.js: appended optionalSteps to the schemaRecord return object (one-line addition next to git).
- test/config.test.js: added 6 new tests (happy-path catalog parse, missing-block backward compat, agent round-trip, duplicate-name rejection, malformed-entry rejection with 7 sub-cases, unknown-stage-key warning capture).

Tests:

- npm test: 55 pass, 0 fail.
- npm run check: clean.
- npm run validate: Ticket validation OK.

Commit SHA: fbc3b000b49dd4a43cbfeb8a2a68cf034db36793

Deviations from design:

- None of substance. The agent-prefix regex mirrors the existing isValidAgentValue in src/tickets.js; I kept it local (isValidOptionalStepAgent) rather than exporting/sharing to avoid a cross-module import inside config.js, which currently has no dependency on tickets.js. If a future ticket consolidates agent-value validation into config.js, this helper can be the canonical home.
- The malformed-entry test bundles all seven sub-cases into a single test using a table-driven loop rather than seven separate `test(...)` declarations, to keep the harness tidy. Each case still asserts a distinct error message and runs inside its own withRoot.
- The "default-config round-trip" assertion was added to the new happy-path test rather than appended to the existing "loadConfig reads the commented default config" test, to keep that older test focused on its original concerns. Coverage of defaultConfigJsonc against drift is equivalent.

Out of scope (handled by sibling tickets): the prompt files under plans/prompts/optional-steps/** are intentionally not created here (paths are dangling per ticket guidance; T20260516T1553Z creates them). Gate-check and specialty-run consumers are T20260516T1551Z and T20260516T1552Z.

## Review Findings

**Verdict:** CONCERNS (soft pass — no functional blocker for v1).

Reviewer: codex-task:read-only (gpt-5.5).

**Confirmed correct:**
- v1 catalog in plans/local-board.config.jsonc:274-301 — 3 design entries, 2 implement entries, empty test array. Agent fields omitted in the seeded entries.
- Loader behavior in src/config.js:268, :282, :299, :303, :313, :317, :323, :333 — empty-array defaults, required string validation, duplicate rejection, mandatory-action-collision rejection, agent prefix validation, warn-and-drop on unknown stage keys.
- schemaRecord exposes optionalSteps at src/tickets.js:856.
- 6 new tests in test/config.test.js at :85, :115, :128, :150, :174, :259 cover all the stated AC items.

**Concerns (non-blocking, follow-up worthy):**
- The Technical Design specifies `name` values are `lowercase snake_case`. The implementation at src/config.js:303 validates non-empty string only — names like `Bad Name` or `not-snake` would load without complaint. The v1 seeded catalog is correct, so this is forward-looking risk, not a current bug.

Recommend filing a follow-up task to add a snake_case regex check on `name` in `validateOptionalStepEntry`. Not gating progression.

## Test Evidence

### Commands run

- `npm test` (pre-fix): 55/55 pass.
- `npm run check` (pre-fix): clean (node --check across bin/local-board.js, src/cli.js, src/config.js, src/git.js, src/scaffold.js, src/tickets.js, install.mjs).
- `npm run validate` (pre-fix): "Ticket validation OK".
- `node bin/local-board.js schema --json` (pre-fix): `optionalSteps` block present with 3 design entries (security_threat_model, ui_component_review, ux_interaction_review), 2 implement entries (security_audit, ui_visual_review), empty test array. None of the seeded entries carry an `agent` field. JSON round-trip clean.
- `npm test` (post-fix): 56/56 pass (added "loadConfig accepts valid lowercase snake_case names for optionalSteps entries"; two new sub-cases inside the existing table-driven malformed-entries test cover "Bad Name" and "not-snake").
- `npm run check` (post-fix): clean.
- `npm run validate` (post-fix): "Ticket validation OK".

### Acceptance criteria coverage

- AC1 (config carries v1 catalog): verified via `schema --json` and the "loadConfig parses the v1 optionalSteps catalog from the default config" test.
- AC2 (per-entry shape, agent omitted by default): verified by the same test and a dedicated assertion that `Object.hasOwn(entry, "agent") === false` for every seeded entry.
- AC3 (loader parses and exposes the new block): verified by the happy-path test plus `schemaRecord` exposure proven by the schema CLI output.
- AC4 (backward compat when block is omitted): verified by "loadConfig returns empty optionalSteps catalog when the block is omitted".
- AC5 (test coverage for parse / missing block / malformed entries): all three covered; malformed-entries case set now includes 9 sub-cases (missing name, missing prompt, missing triggers, entry-is-string, stage-is-object, mandatory-collision, invalid agent, non-snake_case spaces+capitals, hyphenated name).
- AC6 (`local-board validate` clean): confirmed twice (pre- and post-fix).

### Decision on the Review Findings gap

Added the snake_case regex check. `validateOptionalStepEntry` in `src/config.js` now rejects any `name` that does not match `/^[a-z][a-z0-9_]*$/`, immediately after the non-empty-string check and before the mandatory-action-collision check. The error message names the offending value and the regex so users can self-correct. Two new rejection sub-cases ("Bad Name" and "not-snake") and one new positive test ("valid_snake_case_name_v2") were added to `test/config.test.js`. The v1 seeded catalog names all match the new regex, so behavior is forward-compatible with existing configs.

### Commit

- a783cf422be7e7bdcbef3edb1d4caaee768489e8 "Add snake_case validation for optional step names (T20260516T1550Z)" on `feature/estimation-and-specialty-steps`.

### Gaps, flakes, environment caveats

- None observed. No flakes across two full `npm test` runs. No environment blockers.
- Git emitted CRLF/LF warnings on `src/config.js` and `test/config.test.js` during `git add`; this is the existing Windows checkout policy and is not a regression.
- The pre-existing ticket-folder moves (T20260516T1543Z and T20260516T1550Z relocations) in the working tree were left untouched per the parent instruction ("Do NOT move the ticket").

## Documentation Updates

Updated in commit d4e343f:

- `memory-bank/systemPatterns.md` — added `optionalSteps` bullet to the config block list (per-stage specialty review catalogs for design/implement/test).
- `docs/Workflow.md` — new "Optional Steps" subsection covering: config shape, field meanings (name, prompt, triggers, optional agent), prompt path convention, inline vs. agent routing, and forward references to T20260516T1551Z (gate-check) and T20260516T1552Z (specialty-run) which add the runtime.

README untouched (no config-block list section). plans/local-board.config.jsonc not re-touched (already in fbc3b00).

Docs author: codex-task:workspace-write (gpt-5.5). Codex sandbox blocked .git writes; orchestrator committed.

## Questions

## Run Log

- 2026-05-16T16:11:44Z: Completed design via claude-subagent:local-board-designer: Technical Design written: optionalSteps JSONC shape (design/implement/test arrays of {name, prompt, triggers, agent?}). src/config.js: DEFAULT_CONFIG gains empty arrays; loadConfig adds normalizeOptionalSteps + validateOptionalStepEntry (required fields, name uniqueness, mandatory-action-collision rejection, agent prefix check). Unknown stage keys warn. schemaRecord exposes optionalSteps. 7-case test plan.

- 2026-05-16T16:25:48Z: Ensured git branch feature/estimation-and-specialty-steps (already-current).

- 2026-05-16T16:29:45Z: Completed implement via claude-subagent:local-board-implementer: Implemented optionalSteps config in commit fbc3b00. Files: plans/local-board.config.jsonc, src/config.js, src/tickets.js, test/config.test.js. 6 new tests; npm test 55/55; check + validate clean.

- 2026-05-16T16:32:29Z: Completed review via codex-task:read-only: Codex read-only review of commit fbc3b00. Verdict: CONCERNS — no functional blocker. Confirmed catalog, loader behavior, schemaRecord, and test coverage of stated AC. Concern: snake_case name regex missing per design contract; v1 seeded names are correct so risk is forward-looking only. Advancing.

- 2026-05-16T16:35:25Z: Completed test via claude-subagent:local-board-tester: npm test: 56/56 after adding snake_case name validation to close review gap (commit a783cf4). schema --json confirms 5 v1 entries round-trip. AC coverage mapped to test locations. npm run check and validate clean.

- 2026-05-16T16:37:16Z: Completed document via codex-task:workspace-write: Codex authored doc updates in commit d4e343f: memory-bank/systemPatterns.md (config block list) and docs/Workflow.md (new Optional Steps subsection). README untouched. Config file already updated in fbc3b00.
