---
id: T20260710T1222Z
type: task
status: ready_for_docs
priority: P2
parent: S20260710T1206Z
children: []
blockedBy: [T20260710T1220Z, T20260710T1221Z]
blocks: [T20260710T1223Z]
branch: local-board/T20260710T1222Z-design-review-cli-check-and-complete-commands
estimate: 2
estimateBasis: T20260710T1220Z
workStartedAt: 2026-07-10T13:25:24Z
workCompletedAt: null
created: 2026-07-10T12:20:25Z
updated: 2026-07-10T14:06:04Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", "review:codex-task:read-only@gpt-5.6-terra", "test:claude-subagent:local-board-tester@sonnet", gate:test:skipped-empty-catalog]
routingApprovals: []
---
# design-review: CLI check and complete commands

## Requirement

The orchestrator needs a command to resolve the design-review route/model/effort + prompt + ticket context (analogous to gate-check), and a command to record the reviewer's verdict as evidence (analogous to gate-complete/complete-step). Core recorder and route resolution land in the sibling core task (T20260710T1220Z); this task exposes them on the CLI. Parent: S20260710T1206Z.

## Scope

- src/cli.js: add a resolution command design-review-check <ticket-id> [--json] [--allow-main-root] that returns the resolved agent (route), model, effort, the resolved prompt path (plans/prompts/steps/design_review.md, via promptForAction/actionPrompts with assertPromptExists), and a narrow ticketContext (id/type/status/priority/path/title/requirement/acceptanceCriteria/currentAction) — modeled on commandGateCheck/commandSpecialtyRun. It performs no dispatch.
- Add a completion command design-review-complete <ticket-id> --executor <executor> [--model <model>] --evidence <text> [--allow-main-root] [--json] that calls composeExecutor then the core recorder, and runs maybeCommitPlanning.
- Wire both into main() dispatch and the usage/help text; enforce assertInvocationRootForTicket on the mutating command as the gate commands do.

## Acceptance criteria

- On a requireDesignReview: true board, the resolution command returns agent codex-task:read-only, model gpt-5.6-sol, effort xhigh, and the scaffolded prompt path; a missing prompt yields an actionable error naming local-board init (parallel to the gate-check missing-prompt test).
- The completion command records the design-review:<executor>@<model> token, enforces the model pin, appends a Run Log line, and unblocks the subsequent move <id> ready_for_implementation; a wrong-root invocation is refused before any write.
- End-to-end CLI test in test/cli.test.js: design -> design-review-check -> design-review-complete -> move to implementation succeeds; skipping design-review-complete is refused.
- npm run check and node --test pass.

## Non-goals

No core-logic changes (they land in T20260710T1220Z). No skill/docs prose (sibling docs task).

## Acceptance Criteria

## Related Tickets

## Technical Design

## Overview

Expose the two design-review CLI verbs the orchestrator needs, both thin wrappers
over machinery that already shipped in the blockers:

- `design-review-check <ticket-id> [--json] [--allow-main-root]` — a pure
  resolver (no dispatch, no ticket write) that returns the resolved reviewer
  route/model/effort, the resolved prompt path (validated with
  `assertPromptExists`), and a narrow `ticketContext`. Modeled on
  `commandGateCheck` (src/cli.js:1101) and `commandSpecialtyRun` (:1230).
- `design-review-complete <ticket-id> --executor <executor> [--model <model>] --evidence <text> [--allow-main-root] [--json]`
  — records the reviewer's verdict as design-review evidence via the shipped
  `recordDesignReview` recorder, then commits the planning transition. Modeled on
  `commandGateComplete` (:1199) / `commandCompleteStep` (:631).

No core-logic changes: route recognition, the `requireDesignReview` precondition
on the design->implementation move, and `recordDesignReview` all landed in
T20260710T1220Z; the `design_review.md` prompt landed in T20260710T1221Z. This
task is CLI wiring plus an end-to-end test only.

## Related Tickets

- **T20260710T1220Z (done, blocker, merged into base):** shipped
  `recordDesignReview(root, ticketId, executor, evidence, options)`
  (src/tickets.js:1395), flag-gated action recognition
  (`isKnownAction`/`profileForAction` gate on `routing.requireDesignReview === true`),
  the `agents["design-review"]` default profile (`codex-task:read-only`,
  `gpt-5.6-sol`, `xhigh`) in both `DEFAULT_CONFIG` and `defaultConfigJsonc()`, and
  the `moveTicket` precondition that refuses ready_for_design/designing ->
  ready_for_implementation without a `design-review:<executor>` token. This task
  calls that recorder and relies on that precondition.
- **T20260710T1221Z (done, blocker, merged):** shipped
  `plans/prompts/steps/design_review.md` (and its `resources/` mirror), whose
  reviewer returns a **first-line TEXT verdict** (PASS/CONCERNS/FAIL), not JSON.
- **T20260710T1223Z (blocked by this):** skill/docs prose for both flows — a
  non-goal here.
- **B20260710T1225Z (concurrent, same file):** consultation-stamping fix in
  src/active-steps.js + src/cli.js. See Peer coordination.

## Design decisions

### 1. Both commands refuse when `routing.requireDesignReview` is off

`design-review-check` refuses early — before resolving anything — when
`config.routing?.requireDesignReview !== true`, with the same message shape the
recorder already uses (naming the flag). Justification:

- **Consistency with the recorder.** `recordDesignReview` already refuses on
  flag-off boards (src/tickets.js:1404), so `design-review-complete` inherits the
  refusal for free; making `design-review-check` refuse too keeps the pair
  coherent — you cannot resolve a review you are forbidden to record.
- **Resolution is meaningless off-flag.** T1220Z deliberately made
  `profileForAction`/`isKnownAction` treat `design-review` as an *unknown* action
  while the flag is off, and made `codexTaskRoutedActions` skip the profile, so
  the whole feature is inert. Emitting a codex-task reviewer route from a board
  that will not gate the move (and would warn on `validate`) is misleading.
- **Cheap, well-known error.** The refusal is a hard error naming
  `routing.requireDesignReview`, parallel to the recorder's message, so the
  orchestrator gets one actionable diagnostic on a misconfigured board.

### 2. `design-review-check` performs no dispatch and stamps nothing

Like `specialty-run`, it is a pure resolver. It does **not** stamp a consultation
ledger entry (see Peer coordination for the justification tied to B1225Z).

### 3. Prompt-path resolution: fixed path + `assertPromptExists`

`promptForAction(config, "design-review")` returns `null` today: the
`agents["design-review"]` profile carries no `prompt` field, and there is no
`workflow.actionPrompts["design-review"]` entry (src/config.js:74-81). Adding one
would be a config change owned by T1220Z (a non-goal here). So `design-review-check`
resolves the fixed path exactly as `commandGateCheck` resolves `gate-check.md`:

```js
const promptPath = path.resolve(root, "plans", "prompts", "steps", "design_review.md");
await assertPromptExists(promptPath, "design-review");
```

`assertPromptExists` (src/cli.js:1088) already produces the required actionable
error naming `local-board init` on ENOENT, satisfying the missing-prompt AC with
no new code. (Forward-compatible note: if a future ticket adds a prompt entry,
switch to `promptForAction(config, "design-review") ?? <fixed path>`.)

### 4. Route/model/effort resolution: read the profile directly

Mirror `commandGateCheck`'s `config.agents?.["gate-check"]` read:

```js
const profile = config.agents?.["design-review"];
if (profile === undefined || profile.route === undefined) {
  throw new Error(
    "design-review-check: routing.requireDesignReview is true but no agents[\"design-review\"] profile is configured. Run \"local-board init\" or restore the default profile (codex-task:read-only, gpt-5.6-sol, xhigh).",
  );
}
```

Both shipped defaults (`DEFAULT_CONFIG` and the scaffold) always contain the
profile, so on a normally-configured on-flag board this yields
`route=codex-task:read-only`, `model=gpt-5.6-sol`, `effort=xhigh`. Reading the
profile directly (rather than exporting `profileForAction`/`agentForAction` from
tickets.js) keeps tickets.js untouched, honoring the no-core-changes non-goal. A
missing profile while the flag is on is a misconfiguration and errors clearly
rather than falling back to `inline` (which would be wrong for a reviewer).

## Affected files / modules

- **src/cli.js** (only production file touched):
  - Import `recordDesignReview` from `./tickets.js` (add to the existing import
    block; `composeExecutor`, `getSectionText`, `assertInvocationRootForTicket`,
    `assertPromptExists`, `ticketRecord`, `loadConfig` are already imported/available).
  - Add `commandDesignReviewCheck(root, args, allowMainRoot)` and
    `commandDesignReviewComplete(root, args, allowMainRoot)`, placed adjacent to
    `commandSpecialtyRun`/`commandGateComplete`.
  - Add two dispatch branches in `main()` in the gate-check/gate-complete/
    specialty-run cluster (src/cli.js:165-173).
  - Add two lines to `printUsage()` beside the gate-check/gate-complete/
    specialty-run usage lines (src/cli.js:1466-1468).
- **test/cli.test.js**: new end-to-end coverage (see Test plan).
- No changes to src/tickets.js, src/config.js, src/active-steps.js, or any prompt/
  resource file.

## Command shapes

### `commandDesignReviewCheck(root, args, allowMainRoot)`

```
asJson       = takeFlag(args, "--json")
ticketId     = args.shift(); ensureNoArgs(args)
if ticketId undefined -> throw "design-review-check requires: <ticket-id> [--allow-main-root] [--json]"

await assertInvocationRootForTicket(root, ticketId, { allowMainRoot })  // parity + honors the flag in the requested signature
config = await loadConfig(root)
if config.routing?.requireDesignReview !== true ->
  throw "design-review-check: design review is disabled: set routing.requireDesignReview to true in the board config"
profile = config.agents?.["design-review"]  (guard as in decision 4)
{ ticket } = await findTicket(root, ticketId)

promptPath = path.resolve(root, "plans","prompts","steps","design_review.md")
await assertPromptExists(promptPath, "design-review")

baseRecord    = ticketRecord(root, ticket)
currentAction = config.workflow?.statusActions?.[ticket.status] ?? null
ticketContext = { id, type, status, priority, path, title, currentAction,
                  requirement: getSectionText(ticket.body,"Requirement") ?? "",
                  acceptanceCriteria: getSectionText(ticket.body,"Acceptance Criteria") ?? "" }

payload = { ticket: ticket.id, prompt: promptPath,
            agent: profile.route, model: profile.model ?? null, effort: profile.effort ?? null,
            ticketPath: ticket.path, ticketContext }
--json -> JSON.stringify(payload,2); else two-line human form
          ("design-review-check <id> agent=<route>@<model> effort=<effort>" + promptPath)
return 0
```

Notes:
- No dispatch, no write. `assertInvocationRootForTicket` is called for parity with
  `commandGateCheck` and because the requested signature includes `--allow-main-root`;
  since the command stamps nothing, root enforcement here is defensive/consistency,
  not a correctness requirement. Its presence lets the orchestrator relax it with
  `--allow-main-root` exactly as for gate-check.
- Status-agnostic: it resolves regardless of the ticket's status (like gate-check,
  which never cross-checks status against stage). Premature recording is caught
  later by the recorder's `guardPrematureEvidence`, not here.

### `commandDesignReviewComplete(root, args, allowMainRoot)`

```
asJson   = takeFlag(args, "--json")
executor = takeOption(args, "--executor")
model    = takeOption(args, "--model")
evidence = takeOption(args, "--evidence")
ticketId = args.shift(); ensureNoArgs(args)
if ticketId|executor|evidence undefined ->
  throw "design-review-complete requires: <ticket-id> --executor <executor> [--model <model>] --evidence <text> [--allow-main-root]"

await assertInvocationRootForTicket(root, ticketId, { allowMainRoot })   // BEFORE any write
composed = composeExecutor(executor, model)
result   = await recordDesignReview(root, ticketId, composed, evidence)  // recorder enforces flag/empty-evidence/model-pin/premature guard
await maybeCommitPlanning(root, { ticketId: result.ticket, command: "design-review-complete", detail: "design-review" })
--json -> JSON.stringify(result,2); else `${result.ticket} design-review ${result.executor} ${result.path}`
return 0
```

Notes:
- All validation lives in the recorder (empty evidence, flag-off refusal, executor
  validity, model-pin via `validateStepRouting({enforceModel:true})`, premature-evidence
  guard). The command only composes the executor and wires the commit — mirroring
  `commandGateComplete`/`commandCompleteStep`.
- `assertInvocationRootForTicket` runs first, so a wrong-root invocation throws
  before `recordDesignReview` acquires the lock or writes — satisfying the
  "refused before any write" AC (the recorder's `withTicketLock`/`writeTicketFile`
  is never reached).
- **Verdict-agnostic.** The reviewer's first-line PASS/CONCERNS/FAIL token is parsed
  by the *orchestrator*, not by this command. `design-review-complete` records
  whatever `--evidence` string it is given (the orchestrator passes the verdict +
  summary). The orchestrator only calls this on PASS/CONCERNS; on FAIL it instead
  `move`s the ticket back to ready_for_design, which strips the token (T1220Z
  loop-back). This command never inspects or branches on the verdict, so it must
  not `JSON.parse` anything.
- `--model` is optional; the orchestrator should pass `--model gpt-5.6-sol` (or the
  model that actually ran) so the recorded token pins the model. Omitting it records
  a route-only executor, subject to the recorder's existing model-enforcement
  semantics (codex-default wildcard accepted).
- `--override`/`--reason` are intentionally **not** exposed (outside the required
  signature). The recorder supports them; a follow-up can surface them if a
  premature-recording override is ever needed. Design review is recorded at
  ready_for_design/designing, where the premature guard does not fire, so the
  override is not needed for the normal flow.

## main() dispatch + usage

Dispatch (additive, in the gate cluster near src/cli.js:171):
```js
if (command === "design-review-check") {
  return await commandDesignReviewCheck(root, args, allowMainRoot);
}
if (command === "design-review-complete") {
  return await commandDesignReviewComplete(root, args, allowMainRoot);
}
```
Usage (beside src/cli.js:1466-1468):
```
local-board [--root <path>] design-review-check <ticket-id> [--allow-main-root] [--json]
local-board [--root <path>] design-review-complete <ticket-id> --executor <executor> [--model <model>] --evidence <text> [--allow-main-root] [--json]
```

## Peer coordination (B20260710T1225Z)

B1225Z fixes the routing-validator hook denying legitimate gate-check/specialty
dispatches by having `gate-check`/`specialty-run` stamp a scoped consultation
entry in the active-steps ledger that `check-dispatch` consumes. It edits
src/active-steps.js and src/cli.js — the same file this task edits.

**Decision: `design-review-check` does NOT stamp a consultation entry, and this
task has no sequencing dependency on B1225Z.** Justification, verified in code:
`checkDispatch` (src/active-steps.js:121-124) short-circuits to
`{ ok: true, reason: "not-local-board-agent" }` for any agent whose name does not
start with `local-board-`. The design reviewer routes to `codex-task:read-only`,
which is not a `local-board-*` claude-subagent, so the routing-validator hook
never evaluates — and never denies — a design-review dispatch. B1225Z's bug is
structurally specific to `claude-subagent:local-board-*` routes (gate-check,
specialty); the codex reviewer route is out of the hook's scope by construction.
Adding a consultation stamp here would be dead weight (nothing consumes it) and
would needlessly couple this task to B1225Z's ledger-entry shape.

**Merge mechanics:** both tasks add code to src/cli.js. This task adds two *new*
command functions and two *new* `main()` dispatch branches; B1225Z modifies the
existing `commandGateCheck`/`commandSpecialtyRun` bodies (to stamp) and imports
from active-steps.js. The only likely textual overlap is the `main()` dispatch
cluster and the import block — additive in both cases, resolved by keeping both
sets of lines. No behavioral dependency either way.

## Risks and edge cases

- **Flag-off boards:** both commands refuse with a flag-naming error; no move,
  evidence, or resolution path is exercised. Byte-identical behavior to today for
  boards without the feature.
- **Missing prompt file:** `assertPromptExists` throws the `local-board init`
  message; covered by an explicit test paralleling the gate-check missing-prompt
  test.
- **Missing profile while flag on:** custom config that removed
  `agents["design-review"]` errors clearly (decision 4) rather than emitting an
  `inline` reviewer route.
- **Wrong root on complete:** `assertInvocationRootForTicket` throws before the
  recorder writes; asserted by re-reading the ticket and confirming no
  `design-review` token was added.
- **Skipping complete:** the T1220Z `moveTicket` precondition refuses
  ready_for_design/designing -> ready_for_implementation; this task does not
  re-implement that guard, it depends on it. Covered by an E2E "skip is refused"
  assertion.
- **Model pin:** enforced entirely inside the recorder; a mismatched `--model`
  is refused with the existing "completed on model X ... configured model is
  gpt-5.6-sol" shape. No duplicate enforcement in the CLI.
- **Double-JSON confusion:** `design-review-complete` must not attempt to parse
  `--evidence` as a verdict; it is opaque text. Documented above.

## Test plan (test/cli.test.js, requireDesignReview: true board)

End-to-end happy path and refusals, all through the CLI entrypoint on a scaffolded
board (or a fixture with `routing.requireDesignReview: true` and the default
`agents["design-review"]`):

1. **AC: resolution shape.** `design-review-check <id> --json` on a
   ready_for_design ticket returns `agent === "codex-task:read-only"`,
   `model === "gpt-5.6-sol"`, `effort === "xhigh"`, `prompt` ending
   `plans/prompts/steps/design_review.md`, and a `ticketContext` with the narrow
   field set (id/type/status/priority/path/title/currentAction/requirement/
   acceptanceCriteria).
2. **AC: missing prompt.** Delete `plans/prompts/steps/design_review.md`, run
   `design-review-check`, assert the error names `local-board init` (parallel to
   the gate-check missing-prompt test).
3. **AC: full pipeline.** design (record design evidence) ->
   `design-review-check` -> `design-review-complete <id> --executor
   codex-task:read-only --model gpt-5.6-sol --evidence "PASS ..."` -> `move <id>
   ready_for_implementation` succeeds and the ticket lands
   `status: ready_for_implementation`; the recorded token is
   `design-review:codex-task:read-only@gpt-5.6-sol` and a Run Log line is present.
4. **AC: skip refused.** Same pipeline but omit `design-review-complete`; the
   `move ... ready_for_implementation` is refused with the "no recorded design
   review" error.
5. **AC: wrong root refused before write.** Invoke `design-review-complete`
   against a root that is not the ticket's registered worktree (no
   `--allow-main-root`); assert it throws the invocation-root error and that the
   ticket file gained no `design-review` token (re-read `completedSteps`).
6. **Model pin.** `design-review-complete ... --model wrong-model` is refused with
   the model-mismatch message; `--model gpt-5.6-sol` and `codex-default` succeed.
7. **Flag off.** On a board with `requireDesignReview` omitted/false, both
   `design-review-check` and `design-review-complete` refuse with a
   flag-naming error.
8. **Green.** `npm run check` and `node --test` pass (modulo the tracked
   B20260710T1232Z install.test.js baseline).

## Open questions

None blocking. One resolved design choice worth flagging for the reviewer: the
prompt path is resolved as a fixed `plans/prompts/steps/design_review.md`
(mirroring gate-check) rather than through `promptForAction`, because no
`actionPrompts["design-review"]` entry exists and adding one is a T1220Z-scoped
config change (a non-goal here).

## Implementation Notes

## Implementation Notes

Implemented exactly per Technical Design, no core-logic changes.

- **src/cli.js**: imported `recordDesignReview` from `./tickets.js`. Added
  `commandDesignReviewCheck(root, args, allowMainRoot)` and
  `commandDesignReviewComplete(root, args, allowMainRoot)`, placed between
  `commandGateComplete` and `commandSpecialtyRun`. Both mirror the design's
  pseudocode verbatim (flag-off refusal, missing-profile guard, fixed
  `plans/prompts/steps/design_review.md` path + `assertPromptExists`,
  `assertInvocationRootForTicket` before any write on `-complete`). Wired two
  new `main()` dispatch branches and two `printUsage()` lines beside the
  gate-check/gate-complete/specialty-run cluster.
- One deviation worth flagging: the design's pseudocode for the
  `ticketContext` field list omitted `type`, but `ticketRecord()` (the
  existing helper reused, unmodified) always includes `type` alongside
  `id/status/priority/path/title` — `commandGateCheck` includes it too. Kept
  `type` in the narrow context for consistency with gate-check rather than
  hand-stripping it; adjusted the test's expected key list accordingly.

**Review-fix pass (findings 1, 3, 4; finding 2 deferred to T20260710T1223Z)**

1. **src/tickets.js:~772** (Medium, ACCEPTED): the missing-design-review move
   refusal named a nonexistent `design-review` command. Rewrote it to name the
   two real recovery commands and their required arguments: `design-review-check
   <ticket-id>` then `design-review-complete <ticket-id> --executor <executor>
   --model <model> --evidence <text>`. Strengthened the E2E "skip is refused"
   test in test/cli.test.js and the two `tickets.test.js` unit tests (forward-move
   refusal, malformed-token refusal) to assert the corrected remediation text
   (both command names present, in order), not just the "no recorded design
   review" prefix.
2. **src/cli.js:~1338** (Low, ACCEPTED): added `[--json]` to
   `design-review-complete`'s thrown missing-argument usage string (the handler
   already accepted `--json` and `USAGE_TEXT` already advertised it). Asserted
   `/\[--json\]/` in the existing argument-validation test.
3. **Test coverage** (Low, ACCEPTED): added four focused tests:
   - `test/cli.test.js`: "design-review-check performs no dispatch and stamps
     nothing in the active-steps ledger" — reads `readActiveSteps` before/after
     a `design-review-check` call and asserts no entry for the ticket (deep-equal
     ledger snapshot).
   - `test/worktrees.test.js`: "design-review-check refuses from the main root
     ... --allow-main-root overrides" — wrong-root refusal on the resolver plus
     override success, parity with the existing gate-check wrong-root pair.
   - `test/worktrees.test.js`: "design-review-complete --allow-main-root
     overrides the wrong-root guard from the main root" — the override path for
     the mutating command (previously only the plain refusal + correct-root
     success were covered).
   - `test/cli.test.js`: "design-review-complete accepts a combined route@model
     --executor with no --model flag" — `--executor
     codex-task:read-only@codex-default` with no `--model`, asserting the
     recorded executor is the combined string unchanged (`composeExecutor`
     passthrough when `model` is omitted).

**Test Evidence**

Full suite: `npm test` → 512 tests, 509 pass, 2 fail (tracked install.test.js
PATH tests, pre-existing/unrelated), 1 skipped — 4 more passing tests than the
prior implementation pass (505/508), all net-new review-fix coverage.
`npm run check` clean. `node ./bin/local-board.js validate --root
<worktree>` → "Ticket validation OK".

Disposition: findings 1, 3, 4 fixed in this pass; finding 2 (SKILL.md command
reference updates) remains deferred to T20260710T1223Z untouched.

## Review Findings

verdict: changes_requested; target: implementation

(codex-task:read-only, gpt-5.6-terra @ reasoning-effort high, 135s — reviewed commit 7b2dd91; peer merge excluded)

1. Medium — src/tickets.js:773 [ACCEPTED]: the missing-design-review move refusal instructs users to run "design-review", a command that does not exist; the valid recovery is design-review-check then design-review-complete. Fix the diagnostic to name the two real commands and their required arguments; strengthen the E2E assertion beyond the refusal prefix.

2. Medium — SKILL.md:338 + skills/codex/local-board/SKILL.md:253 [ACCEPTED, DEFERRED to T20260710T1223Z]: the curated CLI Commands blocks omit the two new commands. This is explicitly the sibling docs ticket's scope ("Add both commands to each skill's command reference") per the story decomposition; recorded here so T1223Z's designer also considers the reviewer's suggestion to extend the sync test to require the intended command surface.

3. Low — src/cli.js:1338 [ACCEPTED]: missing-argument usage for design-review-complete omits [--json] though the handler accepts it and USAGE_TEXT advertises it. Add to the thrown usage string; assert in the argument-validation test.

4. Low — test coverage [ACCEPTED]: add focused CLI tests for the no-ledger-stamp property of design-review-check, check's wrong-root/--allow-main-root behavior, complete's --allow-main-root override, and the combined-executor path (--executor codex-task:read-only@codex-default, no --model).

Reviewer-verified clean: flag-off refusal exit codes; assertInvocationRootForTicket ordering before lock/commit; no ledger write in check (and no hook-dispatch reason for one — checkDispatch short-circuits non-local-board agents; the merged B1225Z stamping is claude-subagent-scoped); JSON/plain parity; ticketContext parity with gate-check. Reviewer sandbox could not run the suite; verification stays with the test stage.

Disposition: findings 1, 3, 4 fixed in e535c63; finding 2 deferred to T20260710T1223Z.

Re-review: verdict: pass (terra@medium, 36s). Refusal text gives the real two-command recovery with arguments and the E2E asserts both clauses; regex updates strengthen coverage; [--json] usage asserted; all four coverage paths genuinely tested; scope clean, SKILL files untouched.

## Test Evidence

verdict: pass

Environment: worktree commits 7b2dd91 + e535c63 (peer merge 452d20a). Tester: claude-subagent:local-board-tester (sonnet). Tree clean pre/post; no external AI CLI invoked.

Commands and results:

- npm run check — pass.
- npm test — 512 tests: 509 pass, 2 fail (exact B20260710T1232Z baseline by name and count), 1 skip.
- validate — Ticket validation OK.
- Filtered design-review pattern rerun across three test files — 18/18 pass.
- Live probe on a throwaway OS-temp board: init, create task, design-review-check --json returned agent codex-task:read-only, model gpt-5.6-sol, effort xhigh, prompt ending design_review.md, and the full narrow ticketContext. Temp dir removed.

Acceptance criteria: all ten rows PASS — resolution shape, missing-prompt naming local-board init, full pipeline, skip-refused with the corrected two-command remediation, model pin + codex-default wildcard, flag-off refusal (both commands), wrong-root-before-write + --allow-main-root (both commands), no-ledger-stamp, combined route@model executor, suite green at declared baseline.

Anomalies: none beyond the tracked baseline.

## Documentation Updates

## Questions

## Run Log

- 2026-07-10T12:26:04Z: Contract note from T20260710T1221Z design: the design-review prompt returns a FIRST-LINE TEXT verdict (PASS/CONCERNS/FAIL + numbered findings), NOT JSON like the optional-steps reviewers. design-review-complete / orchestrator parsing must read the first-line token, not JSON.parse.

- 2026-07-10T13:25:24Z: Ensured git branch local-board/T20260710T1222Z-design-review-cli-check-and-complete-commands (already-current).

- 2026-07-10T13:32:36Z: Completed design via claude-subagent:local-board-designer@opus: Technical Design: two thin cli.js wrappers (check resolver + complete recorder passthrough), flag-off refusal on both (mirrors recorder), no consultation stamp needed (hook short-circuits non-local-board routes, verified), verdict-agnostic evidence, wrong-root before any write, 8-case E2E plan. Estimate 2 (basis T20260710T1220Z, designer-recorded).

- 2026-07-10T13:33:32Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: none - thin CLI wrappers over existing recorder/resolver

- 2026-07-10T13:34:55Z: Ensured git branch local-board/T20260710T1222Z-design-review-cli-check-and-complete-commands (already-current).

- 2026-07-10T13:49:04Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Commits 452d20a (B1225Z peer merge, clean) + 7b2dd91: design-review-check resolver + design-review-complete recorder passthrough, main() + usage wiring, 7 new tests (pipeline, skip-refused, model pin, flag-off, wrong-root in worktrees.test.js). 505 pass + 2 baseline. Two documented micro-deviations (ticketContext.type parity; wrong-root test placement).

- 2026-07-10T13:49:51Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: none - CLI wrappers over existing recorder/resolver

- 2026-07-10T13:53:38Z: Invalidated downstream evidence on loop-back to ready_for_implementation: removed completedSteps [implement:claude-subagent:local-board-implementer@sonnet, gate:implement:claude-subagent:local-board-gatecheck@haiku].

- 2026-07-10T13:53:38Z: Ensured git branch local-board/T20260710T1222Z-design-review-cli-check-and-complete-commands (already-current).

- 2026-07-10T14:00:02Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Original 7b2dd91 + review-fix e535c63: refusal names real recovery commands, [--json] usage fix, 4 targeted tests (no-ledger-write, wrong-root/--allow-main-root both commands, combined executor). 509 pass + 2 baseline.

- 2026-07-10T14:01:37Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: none - CLI diagnostics/usage/tests

- 2026-07-10T14:03:10Z: Completed review via codex-task:read-only@gpt-5.6-terra: Initial changes_requested (4 findings; #2 deferred to T1223Z) fixed in e535c63; re-review verdict: pass (terra@medium). No open findings on this ticket.

- 2026-07-10T14:03:10Z: Ensured git branch local-board/T20260710T1222Z-design-review-cli-check-and-complete-commands (already-current).

- 2026-07-10T14:06:03Z: Completed test via claude-subagent:local-board-tester@sonnet: verdict: pass. 509/512 at declared baseline; 18/18 design-review tests; live throwaway-board probe returned sol@xhigh resolution shape; guardrail honored.
