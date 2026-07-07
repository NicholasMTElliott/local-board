---
id: T20260516T1548Z
type: task
status: archived
priority: P2
parent: S20260516T1537Z
children: []
blockedBy: [T20260516T1545Z, T20260516T1547Z]
blocks: []
branch: feature/estimation-and-specialty-steps
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-05-16T15:48:45Z
updated: 2026-07-07T14:07:41Z
completedSteps: [design:claude-subagent:local-board-designer, implement:claude-subagent:local-board-implementer, review:codex-task:read-only, test:claude-subagent:local-board-tester, document:codex-task:workspace-write]
routingApprovals: []
---
# Enforcement: complete-step design requires non-null estimate for tasks/bugs

## Requirement

Add an enforcement gate to `complete-step design`. Depends on the estimate CLI (T20260516T1545Z) and the config block (T20260516T1547Z).

Behavior:
- When `estimation.enabled` is true and the ticket type is `task` or `bug`, `complete-step design` refuses to complete if `estimate` is null. Exit non-zero with a message that says the design step must record an estimate first and references `local-board estimate <id> <points>`.
- Stories and epics are exempt regardless of `estimation.enabled`.
- When `estimation.enabled` is false, the gate is a no-op.

## Acceptance Criteria

- `complete-step design` on a task or bug with null `estimate` exits non-zero with a message referencing `local-board estimate`.
- `complete-step design` on a task or bug with a non-null `estimate` proceeds normally.
- `complete-step design` on a story or epic proceeds regardless of `estimate`.
- When `estimation.enabled` is false, the gate is bypassed for all ticket types.
- Tests cover: task with null estimate is blocked, task with estimate proceeds, bug with null estimate is blocked, story with null estimate proceeds, epic with null estimate proceeds, enabled=false bypass.

## Related Tickets

## Technical Design

### Goal

Gate complete-step design on tasks and bugs when relative-sized estimation is enabled and the ticket carries no estimate. Stories and epics are always exempt because their estimates come from child rollup. When estimation.enabled is false the gate is a no-op, preserving prior behavior.

### Files touched

- src/tickets.js: extend completeStep (around line 445) with a new pre-write check that fires after assertAction and executor validation and after findTicket, but before evidence is written. Group it next to the existing validateStepRouting block (line 458) so all refuse-to-record checks live together.
- test/tickets.test.js: add focused coverage near the other completeStep tests (around line 404).

No CLI surface change is required. commandCompleteStep already wraps completeStep in the top-level try/catch in cli.js (line 127), which prints error.message to stderr and returns exit code 2. The thrown Error from the new gate flows through that path unchanged.

### Behavior matrix

| ticket.type | estimation.enabled | estimate | action     | result |
| ----------- | ------------------ | -------- | ---------- | ------ |
| task or bug | true               | null     | design     | refuse |
| task or bug | true               | integer  | design     | accept |
| task or bug | false              | null     | design     | accept |
| story/epic  | true               | null     | design     | accept |
| task or bug | true               | null     | non-design | accept |

### Implementation sketch

In completeStep, after the existing routing-validation block and before computing now:

1. Check action === "design".
2. Check ticket.type === "task" or ticket.type === "bug".
3. Check config.estimation?.enabled === true. Optional chaining is defensive; normalizeEstimation in src/config.js already guarantees a boolean enabled, but the chain keeps the new code resilient if a future caller passes a partial config.
4. Check ticket.frontMatter.estimate === null or ticket.frontMatter.estimate === undefined. Both are valid null states because estimate appears in NULLABLE_FIELDS (line 86) and legacy tickets may parse without the field defined.
5. If all four are true, throw an Error with the message specified by the brief.

The gate runs before await writeFile, so a refusal leaves the ticket file untouched. No new await is required because both ticket and config are already in scope.

### Why this placement

- After loadConfig and findTicket: we need both the estimation config and the ticket type and estimate.
- After assertAction and isValidAgentValue: keep argument-shape errors prior to semantic gates; matches the existing layering.
- After validateStepRouting: routing errors ask whether this step can be recorded by this executor; the estimate gate asks whether the design step should be considered complete. Grouping the two refusal paths keeps the function readable.
- Before withUpdated and writeFile: never partially mutate the ticket on refusal.

### Config access

Use config.estimation.enabled directly. normalizeEstimation in src/config.js (line 304) is called by loadConfig and throws if estimation is missing or malformed, so by the time completeStep reads config.estimation the shape is guaranteed. No new helper or import is needed.

### Error wording

Exactly as the brief specifies:

complete-step design refused: ticket has no estimate. Run local-board estimate TICKET_ID POINTS [--basis ID] before completing design (config.estimation.enabled is true).

Single line. The parenthetical "config.estimation.enabled is true" tells the operator why the gate fired so they know whether to estimate the ticket or flip the config flag.

### Risks and edge cases

- estimate: 0 - zero is not a valid scale value (the default scale is [1, 2, 4, 8] and normalizeEstimation requires positive integers), but the gate must treat 0 as a real estimate, not as null. The strict === null or === undefined check (not falsy) covers this.
- Legacy tickets missing the field entirely - old tickets that pre-date the schema may parse with estimate undefined. The === undefined branch handles them. validateTicketShape already requires estimate per REQUIRED_FIELDS, so undefined should not appear on validated boards, but the gate stays robust if a malformed ticket slips through.
- Action-name drift - the gate keys on the literal "design". assertAction confirms the action is in the configured set, but the gate behavior is keyed on the action meaning. If a future config renames the design action, the gate silently stops firing. Acceptable for this ticket; a follow-up could key on config.workflow.statusActions["ready_for_design"] if rename support becomes important.
- Type drift - keying on the literals "task" and "bug" mirrors how the parent story phrases the contract. No new constant is introduced.
- Stories and epics with estimates - the gate does not fire for them at all, so an estimate set on a story has no effect on this code path. Story rollup is out of scope.
- complete-step design after an estimate is already set - the gate passes and the normal path runs. The estimate CLI in cli.js (line 595) prevents accidental overwrites by requiring --force, which is the right place for that concern.
- No effect on approveInline - inline approval records an approval token, not a completion, so the estimate gate intentionally does not run there. An operator can still approve a design deviation without an estimate; the gate fires only when they try to complete the step.

### Test plan

In test/tickets.test.js add six adjacent test(...) calls in the file flat style:

1. Task, enabled=true, estimate=null, action=design - refused. Use withBoard, write a config file enabling estimation, createTicket("task", ..., { status: "ready_for_design" }), then assert.rejects(completeStep(..., "design", ...), /complete-step design refused: ticket has no estimate/). Assert the ticket file on disk gains no completedSteps entry.
2. Bug, enabled=true, estimate=null, action=design - refused. Same shape with createTicket("bug", ...).
3. Story, enabled=true, estimate=null, action=design - accepted. Story is exempt by type. Use createTicket("story", ...) and assert completeStep resolves and the run log gains an entry.
4. Task, enabled=true, estimate=4, action=design - accepted. Set the estimate via setTicketField(root, ticketId, "estimate", 4) before calling completeStep.
5. Task, enabled=false, estimate=null, action=design - accepted. Skip writing a custom config; the default enabled: false covers this. Alternatively explicitly write a config with enabled: false to make the assertion explicit.
6. Task, enabled=true, estimate=null, action=implement - accepted. Confirms the gate is design-only. Create the task at ready_for_implementation, run completeStep(..., "implement", ...), assert success.

For each accepted case, also assert validate(await discover(root), await loadConfig(root)) returns [] so the gate does not leak validation issues.

Config-file pattern matches test/cli.test.js line 334: write plans/local-board.config.jsonc with JSON.stringify({ estimation: { enabled: true, scale: [1, 2, 4, 8], bootstrapDefault: 4, splitThreshold: 16 } }), or run initProject first and then overwrite the file.

Existing completeStep tests (lines 404, 431, 454, and so on) use the default config where estimation.enabled is false, so they are not affected by this gate. Verify by running the full test/tickets.test.js suite after the change.

### CLI exit code

Throwing Error from completeStep reaches the top-level catch in cli.js (line 127) which logs to stderr and returns 2. This matches the brief requirement of exit 2 on refusal. No CLI-layer code changes are needed. A CLI-level test in test/cli.test.js is optional but recommended for one refusal path to lock the exit code in place.

### Documentation impact

- memory-bank/systemPatterns.md: mention the estimate gate alongside the strict-routing gate if that file enumerates completeStep gates. Otherwise no entry is required; the parent story already documents the contract.
- docs/: no new doc file. The estimate command and config block were documented by dependency tickets T20260516T1545Z and T20260516T1547Z.
- README.md: no Documentation Index change.
- plans/prompts/: no prompt changes in this ticket; the parent story already updated estimator and design prompts.

### Out of scope

- Story and epic estimate rollup from children.
- Gating any action other than design.
- Surfacing the estimate prerequisite during begin-step; begin-step is read-only and should not refuse, so the agent learns about the gate only when it tries to complete.
- Reporting estimate-vs-actual variance.

### Reference signatures

Relevant code shapes already in tree:

- src/tickets.js line 445: export async function completeStep(root, ticketId, action, executor, evidence, options = {}). The new gate slots between the existing routingIssues throw and the now timestamp.
- src/tickets.js line 741: validateStepRouting(ticket, config, action, executor) - same arguments are already in scope where the new gate runs, so the gate can borrow the same parameter set without restructuring.
- src/tickets.js line 86: NULLABLE_FIELDS lists estimate and estimateBasis. This is the authoritative answer to "what counts as a null estimate".
- src/config.js line 251 default config: estimation { enabled: false, scale: [1,2,4,8], bootstrapDefault: 4, splitThreshold: 16 }. Tests can rely on this default for the enabled=false case.
- src/cli.js line 127 catch (error): console.error(error.message); return 2; this is the exit code path the brief expects.

### Suggested code shape

Pseudocode only - the implementer writes the real form:

  if (action === "design"
      and (ticket.type === "task" or ticket.type === "bug")
      and config.estimation?.enabled === true
      and (ticket.frontMatter.estimate === null or ticket.frontMatter.estimate === undefined)) {
    throw new Error("complete-step design refused: ticket has no estimate. ...");
  }

Place this immediately after the routingIssues throw and before const now = options.now ?? new Date().

### Open questions

- None. The brief and parent story converge on the same contract: only design, only task or bug, only when enabled, only when estimate is null.

## Implementation Notes

- Added an estimate gate to `completeStep` in `src/tickets.js` after the existing `validateStepRouting` block and before the now/writeFile path. The gate throws an `Error` (with the exact brief wording, substituting the real ticket id) when all of: `action === "design"`, ticket type is `task` or `bug`, `config.estimation.enabled === true`, and `ticket.frontMatter.estimate` is `null` or `undefined`.
- Refusal occurs strictly before any mutation, so the ticket file remains untouched on rejection. Stories, epics, other actions, and `estimation.enabled === false` all bypass the gate.
- Exit code semantics are unchanged: the thrown error flows through `commandCompleteStep` and the top-level catch in `src/cli.js`, which logs to stderr and returns exit code 2.
- Added six adjacent tests in `test/tickets.test.js` covering: task null-estimate refused, bug null-estimate refused, story null-estimate accepted, task with `estimate=4` accepted, task with `enabled=false` accepted, and task `implement` action accepted (design-only scope). Accepted cases also assert `validate(...)` returns `[]`.
- Helper `writeEstimationConfig(root, enabled)` writes a minimal `plans/local-board.config.jsonc` matching the pattern at `test/cli.test.js:334`.
- `npm test`: 96/96 passing (90 prior + 6 new). `npm run check`: clean. `npm run validate`: `Ticket validation OK` (existing done tickets without estimates remain valid because the gate fires only on `complete-step`, not `validate`).

## Review Findings

**Verdict:** CONCERNS (soft pass — coverage gap on epic exemption).

Reviewer: codex-task:read-only (gpt-5.5). Static review.

**Confirmed correct:**
- Placement: validateStepRouting runs first (src/tickets.js:458), then estimate gate (:464), then evidence mutation (:478, :482) and writeFile (:487). Routing errors aren't preempted; refused completions don't write evidence.
- Four predicates combined with && (src/tickets.js:464-467): action === 'design', type ∈ {task,bug}, config.estimation?.enabled === true, estimate is null/undefined. Stories/epics exempt in-code (type predicate); enabled=false bypasses; only design action gated.
- Refusal message preserves ticket id and references the estimate CLI (src/tickets.js:470).
- Test for implement action acceptance confirms scope (test/tickets.test.js:1344, :1353).

**Concern (non-blocking, test coverage gap):**
- 6 new tests cover task/bug refusal, story acceptance, task-with-estimate, enabled=false, and implement. Missing: explicit epic exemption (epic + null estimate + enabled=true + design = should accept). Implementation already covers this via the type predicate, but no test pins it.

Recommend tester adds one epic-exemption case to round out the matrix.

## Test Evidence

Commands run:
- npm test (pre-change): 96/96 passing
- npm run check (pre-change): clean
- npm run validate (pre-change): Ticket validation OK
- npm test (post-change): 97/97 passing, including new epic exemption test
- npm run check (post-change): clean
- npm run validate (post-change): Ticket validation OK

Added test (test/tickets.test.js):
- completeStep design accepts an epic with null estimate when estimation is enabled
  - Creates epic at ready_for_design with estimation.enabled=true and estimate=null.
  - Calls completeStep(..., "design", "claude-subagent:local-board-designer", ...).
  - Asserts completedSteps records the design step and validate() returns [].

Acceptance criteria coverage:
- Task with null estimate refused: covered (existing test, passing).
- Task with non-null estimate proceeds: covered (existing, passing).
- Bug with null estimate refused: covered (existing, passing).
- Story with null estimate proceeds: covered (existing, passing).
- Epic with null estimate proceeds: NEWLY covered by this commit (24bf0a0), closing the reviewer concern.
- estimation.enabled=false bypasses gate: covered (existing, passing).
- Implement action not gated: covered (existing, passing).

Commit: 24bf0a0 "Add epic exemption test for design estimate gate (T20260516T1548Z)".

No flakes observed. No environment caveats. The pre-existing untracked/moved ticket files in plans/tickets are unrelated to this ticket and were not touched.

## Documentation Updates

Updated in commit 3537f1b:

- memory-bank/systemPatterns.md - Safety Pattern updated with one-line note: complete-step design refuses task/bug tickets without an estimate when estimation.enabled is true.
- docs/Workflow.md - new "Design-step enforcement" subsection under Estimation covering the four required conditions, story/epic exemption, enabled=false bypass, non-design action behavior, and refusal flow pointing users to local-board estimate.
- README untouched (already references the estimate CLI).

Docs author: codex-task:workspace-write (gpt-5.5). Codex sandbox blocked .git writes; orchestrator committed.

## Questions

## Run Log

- 2026-05-16T23:03:53Z: Completed design via claude-subagent:local-board-designer: Design: estimate gate inside completeStep (src/tickets.js after validateStepRouting). Gate fires when action=design AND type in {task,bug} AND config.estimation.enabled AND estimate is null/undefined. Stories/epics exempt. Other actions unaffected. Refusal message names the estimate CLI command. Exit 2 via existing CLI catch. 6-test plan.

- 2026-05-16T23:03:53Z: Ensured git branch feature/estimation-and-specialty-steps (already-current).

- 2026-05-16T23:11:05Z: Completed implement via claude-subagent:local-board-implementer: Implemented in commit 4a2458f. Estimate gate added in completeStep after validateStepRouting; throws clear refusal when action=design AND type in {task,bug} AND config.estimation.enabled AND estimate is null. Stories/epics exempt; enabled=false bypasses; other actions unaffected. 6 new tests; npm test 96/96; check + validate clean. Existing done tickets without estimates remain valid (gate runs only on complete-step, not validate).

- 2026-05-16T23:13:01Z: Completed review via codex-task:read-only: Codex review of commit 4a2458f. Verdict: CONCERNS — coverage gap only. Placement, predicates, message, exemptions all correct. Concern: 6 tests miss explicit epic exemption case. Tester will close.

- 2026-05-16T23:17:02Z: Completed test via claude-subagent:local-board-tester: npm test 97/97 after adding epic exemption test (commit 24bf0a0) to close review coverage gap. All 7 AC matrix entries covered. check + validate clean. Verdict: PASS.

- 2026-05-16T23:18:31Z: Completed document via codex-task:workspace-write: Doc updates in commit 3537f1b: memory-bank/systemPatterns.md (Safety Pattern), docs/Workflow.md (Design-step enforcement subsection).
