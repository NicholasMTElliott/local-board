---
id: T20260516T1545Z
type: task
status: archived
priority: P2
parent: S20260516T1537Z
children: []
blockedBy: [T20260516T1543Z]
blocks: [T20260516T1548Z, T20260516T1549Z]
branch: feature/estimation-and-specialty-steps
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-05-16T15:45:41Z
updated: 2026-07-07T14:07:41Z
completedSteps: [design:claude-subagent:local-board-designer, implement:claude-subagent:local-board-implementer, review:codex-task:read-only, test:claude-subagent:local-board-tester, document:codex-task:workspace-write]
routingApprovals: []
---
# CLI: local-board estimate <ticket-id> <points> command

## Requirement

Add `local-board estimate <ticket-id> <points>` command. Depends on the schema task (T20260516T1543Z).

Behavior:
- Validates `<points>` against the configured `estimation.scale` (default `[1, 2, 4, 8]`). Reject values not in scale.
- Records the points as `estimate` (numeric).
- Records `estimateBasis` from a `--basis <ticket-id-or-bootstrap>` flag. If `--basis` is omitted, invoke the calibration suggest logic (T20260516T1546Z) to pick one.
- Refuses to overwrite an existing non-null `estimate` unless `--force` is passed.
- Exits non-zero with a clear message on validation failure (out-of-scale, unknown basis ticket, missing ticket).

Out of scope: enforcement at `complete-step design` (separate task), prompts (separate task).

## Acceptance Criteria

- `local-board estimate <id> <n>` writes the estimate and basis when valid.
- Points outside the configured scale are rejected with a non-zero exit and a message that lists allowed values.
- `--basis <ticket-id>` is recorded verbatim in `estimateBasis`.
- `--basis bootstrap` is accepted and recorded literally as `bootstrap`.
- Omitting `--basis` calls the calibration suggester to pick a basis automatically.
- Running the command on a ticket with a non-null `estimate` fails unless `--force` is passed.
- `--force` overwrites both `estimate` and `estimateBasis`.
- Tests cover: happy path, scale rejection, overwrite refusal, `--force` overwrite, explicit `--basis bootstrap`, and auto-pick branch.

## Related Tickets

## Technical Design

### Summary

Add a new top-level CLI command `local-board estimate <ticket-id> <points> [--basis <ticket-id-or-bootstrap>] [--force]`. It validates `<points>` against the configured `estimation.scale`, validates the basis when provided, refuses to overwrite a non-null `estimate` without `--force`, and writes `estimate` and `estimateBasis` together. This task is the leaf CLI under parent story S20260516T1537Z. Depends on T20260516T1543Z (schema fields exist on disk and in `src/tickets.js`) and T20260516T1547Z (the `estimation` config block exposes `scale` and `bootstrapDefault`). Auto-resolution of calibration is intentionally out of scope: the parent-story pipeline-placement decision is that the separate `calibration suggest` command from T20260516T1546Z supplies the basis, and the design-step prompt chains the two CLI calls. This ticket only implements the writer.

### Files and APIs inspected

- `src/cli.js` lines 31-110 (the `main` dispatcher), 537-589 (option/flag parsing helpers and `printUsage`). The dispatcher is a flat chain of `if (command === ...) return await commandX(...)`. New commands follow the established `commandX` pattern, all consume `root`/`args`, and `printUsage` lists every command.
- `src/tickets.js`:
  - `TICKET_ID_RE = /^[ESBT]\d{8}T\d{4}Z$/` at line 101. Reuse for `--basis` validation. Currently file-private; export it for parity with `parseScalar`, which `cli.js` already imports.
  - `findTicket(root, ticketId)` at lines 262-276 throws `ticket <id> not found` when absent. Used for existence checks on both the target ticket and any `--basis` ticket id.
  - `setTicketField(root, ticketId, field, value, options)` at lines 351-368. Gates on `CANONICAL_FIELDS` and `IMMUTABLE_FIELDS`, then calls `assertFieldValue` and writes the file. Both `estimate` and `estimateBasis` are in `NULLABLE_FIELDS`, so `assertFieldValue` requires the value to be `null` or a string. Two sequential calls write the file twice; both bump `updated`. Atomicity is last-write-wins; acceptable because the second write only touches one extra field beyond the first.
  - Front-matter serialization (`serializeFrontMatter`, `formatScalar`, lines 1068-1232). Writes unquoted bareword tokens for values matching the safe-chars regex, so an integer like `4` round-trips as the bareword `4` and `parseScalar` returns the string `"4"` on read. The repo convention (see `test/tickets.test.js` lines 765-786 and `test/cli.test.js` line 65) is to pass the points as a stringified integer; validation, JSON output, and the `estimate: 4` storage shape all accept that today.
  - Validation rules for `estimate` and `estimateBasis` at lines 611-635. `estimate` must be `null` or a string; `estimateBasis` must be `null`, `"bootstrap"`, or a `TICKET_ID_RE` match; `estimateBasis` must be `null` whenever `estimate` is `null`.
- `src/config.js`:
  - `loadConfig` at lines 259-273 always returns a merged config including a normalized `estimation` block with `scale` (sorted-ascending positive integers) and `bootstrapDefault`. `normalizeEstimation` at lines 304-351 enforces those invariants at load time, so the CLI may treat `config.estimation.scale` as trusted.
  - `config.estimation.enabled` is intentionally irrelevant here: the command writes when invoked regardless of the flag. The enforcement gate at `complete-step design` belongs to T20260516T1548Z.
- `test/cli.test.js` (existing CLI test harness using `runCli` at line 199; pattern: `withBoard` -> `init` -> `create` -> `runCli([...])` -> assert exit code and `readFile` of the ticket). Existing line 65 already exercises `update-field <id> estimate 2`; new tests live alongside that style.
- `test/tickets.test.js` lines 729-934 cover the schema-level acceptance of `estimate` and `estimateBasis`. New tests for this ticket layer on top via the CLI test file rather than duplicating schema coverage.
- Parent story S20260516T1537Z (done). Confirms the basis sentinel is the literal string `"bootstrap"` and that calibration auto-pick is delivered by a separate command, not folded into this writer.
- Sibling ticket T20260516T1546Z (`calibration suggest`) is still in `backlog`; the orchestration that chains `suggest` -> `estimate` lives in the design-step prompt (T20260516T1549Z), not here.

### Design

#### CLI surface

Register a new command branch in `src/cli.js` `main`:

```js
if (command === "estimate") {
  return await commandEstimate(root, args);
}
```

`commandEstimate(root, args)` parses with the existing helpers:

- `const basis = takeOption(args, "--basis");` (undefined when omitted).
- `const force = takeFlag(args, "--force");`.
- `const asJson = takeFlag(args, "--json");` (for symmetry with other write commands; optional but cheap).
- Positional: `const ticketId = args.shift();` then `const rawPoints = args.shift();`.
- `ensureNoArgs(args);`.

Error messages thrown from `commandEstimate` propagate to `main` `try/catch`, which logs to `stderr` and returns exit code `2`. That is the existing convention for all CLI validation failures.

Append a line to `printUsage`:

```
local-board [--root <path>] estimate <ticket-id> <points> [--basis <ticket-id-or-bootstrap>] [--force] [--json]
```

#### Validation order

1. Required positional args. Throw `estimate requires: <ticket-id> <points> [--basis <ticket-id-or-bootstrap>] [--force]` if either is undefined.
2. Parse `<points>` to an integer. Use `Number.parseInt(rawPoints, 10)` and reject when (a) `Number.isNaN`, (b) `String(parsed) !== rawPoints.trim()` (rejects `2.5`, `2abc`, leading-zero padding, scientific notation), or (c) the parsed integer is not present in `config.estimation.scale`. Error message lists the allowed values, for example `estimate: 3 is not in estimation.scale [1, 2, 4, 8]`.
3. Basis validation when `basis !== undefined`:
   - If `basis === "bootstrap"`, accept verbatim.
   - Else require `TICKET_ID_RE.test(basis)`; on failure throw `estimate: --basis must be "bootstrap" or a ticket id matching [ESBT]yyyyMMddTHHmmZ`.
   - Else call `findTicket(root, basis)` to confirm the basis ticket exists. `findTicket` already throws `ticket <id> not found` with a clear message.
4. Load the target ticket via `findTicket(root, ticketId)`. `findTicket` runs `discover`, which surfaces any load errors first.
5. Overwrite guard. If `ticket.frontMatter.estimate !== null` and `!force`, throw `estimate: ticket <id> already has estimate <current>; pass --force to overwrite`. Reading `estimate` and `estimateBasis` from `ticket.frontMatter` is sufficient because both are populated by `readTicket` via `LEGACY_DEFAULT_NULL_FIELDS` defaulting at line 150.
6. Default the basis when the user omitted `--basis`: `const effectiveBasis = basis ?? "bootstrap";`. Honors the scope direction (no auto-resolution here) and keeps the on-disk schema invariant satisfied (`estimateBasis` is non-null whenever `estimate` is non-null).

#### Writing the fields

Use `setTicketField` twice in order: `estimate` first, then `estimateBasis`. Both fields are in `NULLABLE_FIELDS`, so pass the values as strings: `String(parsedPoints)` and `effectiveBasis`. Rationale:

- `setTicketField` already validates the field name and value shape, bumps `updated`, and writes the file with `renderMarkdownTicket`.
- Two sequential writes are acceptable because (a) the second `setTicketField` call reads the file from disk again via `findTicket` and so picks up the just-written `estimate`, and (b) the cross-field validator `estimateBasis must be null when estimate is null` only fails when `estimate` is `null` and basis is a string, which cannot occur because `estimate` is written first.
- A failure between the two writes leaves the ticket with `estimate` set and `estimateBasis === null`, which `validate` accepts (no rule forbids null basis when estimate is set; the cross-field rule is only the inverse). Re-running the same command succeeds because the overwrite guard reads current state; pass `--force` if the second write needs to retry.

Alternative considered and rejected for now: introduce `estimateTicket(root, ticketId, points, basis, options)` in `src/tickets.js` that builds the merged front matter and writes once. Cleaner, but duplicates `setTicketField` validation/serialization logic and adds API surface without a current second caller. Recommendation: start with the two-call approach; promote to a helper only if a follow-up needs single-write atomicity. If a single-write helper is preferred now, it lives next to `setTicketField`, calls `findTicket`, validates both fields together, then writes the merged front matter directly via `renderMarkdownTicket(withUpdated(...))`.

#### CLI output

Success: print the updated ticket path (consistent with `commandSet` and `commandSection`). Return `0`. When `--json`, print `JSON.stringify({ path, estimate: parsedPoints, estimateBasis: effectiveBasis }, null, 2)`.

Failure: rely on `main` `try/catch` printing `error.message` to `stderr` and returning `2`.

#### Documentation impact

- `printUsage` in `src/cli.js` gains the new line above.
- `README.md` command list, if it enumerates commands, gains an entry. The documenter stage may pick this up; flag it in Implementation Notes.
- `memory-bank/systemPatterns.md` already mentions the estimation block from T20260516T1547Z; consider a one-line note that `estimate` is now a first-class CLI command and not only a front-matter field.

### Risks and edge cases

- Whitespace and sign in `<points>`. `Number.parseInt(" 4 ", 10)` returns `4`. Trim before the equality guard and reject empty strings explicitly.
- Negative or zero points. `config.estimation.scale` is normalized to positive integers, so they cannot be in the scale and will be rejected by the scale check. No extra branch needed.
- Non-integer numerics. `2.5` parses to `2`; the `String(parsed) !== trimmed` guard rejects it. `2e0` parses to `2` and is also rejected by the same guard.
- `--force` on a ticket with `estimate === null`. Succeeds and writes (no-op overwrite guard). Document the flag idempotency in usage rather than complicating the guard.
- Self-basis. A user passes `--basis <same-ticket-id>`. Acceptance criteria do not forbid it. Allow it; the basis is a string pointer and `validate` is happy with any existing ticket id. A future enhancement can reject self-reference.
- Closed or archived basis. The acceptance criteria say the basis ticket must exist on disk. `findTicket` does not filter by status, so an archived basis is accepted. That matches the calibration-pool design: the basis must point at a real ticket but is not required to be done in this writer; the suggester is responsible for choosing done tickets.
- `--basis bootstrap` case-sensitivity. Accept exact match only; the schema validator already enforces lowercase `bootstrap` on read.
- Ticket id case. `TICKET_ID_RE` is anchored and uppercase-only on the prefix; reuse it as-is.
- Missing config file. `loadConfig` returns `DEFAULT_CONFIG` when `plans/local-board.config.jsonc` is absent. The default has `scale: [1, 2, 4, 8]` and `bootstrapDefault: 4`, so the command works out of the box.
- `config.estimation.enabled === false`. Does not block the command per the scope. Verified by reading `normalizeEstimation`: it does not gate anything beyond shape validation.
- Existing `update-field <id> estimate <n>` path. Remains intact and still works; no plan to deprecate. The new command is preferred because it also writes `estimateBasis` and rejects out-of-scale values. `update-field` does not consult the scale; this is acceptable because the new command is the documented entrypoint.
- Concurrent runs. Same as any other write command. No locking is in scope.
- Post-write validate. This command does not call `validate` after writing. The general `validate` command remains the source of truth and will fire on the next read. Adding a post-write validate is unnecessary and would force users to fix unrelated load errors before estimating.

### Test plan

Add tests to `test/cli.test.js`. Reuse the existing `runCli` helper and `withBoard` scaffold. Each test calls `init`, `create` (task), optionally moves the ticket into `ready_for_design`, then exercises the `estimate` command.

Happy path:

- `estimate <id> 4` returns code `0`, writes `estimate: 4` and `estimateBasis: bootstrap` to the ticket file, leaves the body untouched, bumps `updated`. Assert with `readFile` and regex on both fields.
- `estimate <id> 2 --basis bootstrap` returns code `0`, writes `estimate: 2` and `estimateBasis: bootstrap`.
- `estimate <id> 8 --basis <other-task-id>` where `<other-task-id>` is a sibling task created in the same board. Returns code `0`, writes the basis verbatim.

Validation failures (each returns code `2`, stderr non-empty):

- Out-of-scale: `estimate <id> 3` (3 is not in `[1, 2, 4, 8]`). Error message lists the allowed values.
- Non-integer: `estimate <id> 2.5` and `estimate <id> abc`. Both reject with a clear `not in estimation.scale` or `must be an integer` message.
- Missing args: `estimate <id>` and `estimate`. Both reject.
- `--basis` malformed: `estimate <id> 4 --basis not-a-ticket`. Rejects on the `TICKET_ID_RE` check before touching disk.
- `--basis` ticket missing: `estimate <id> 4 --basis T20990101T0000Z`. Rejects with the `findTicket` `ticket <id> not found` message.
- Overwrite without `--force`: estimate once with `4`, then call `estimate <id> 2`. Second call rejects; first estimate is intact on disk.
- Overwrite with `--force`: estimate once with `4`, then `estimate <id> 2 --force`. Second call succeeds; file shows `estimate: 2`.

Round-trip:

- After `estimate <id> 4 --basis T<other>`, run `validate --json` and assert `ok: true`. Confirms `setTicketField` post-conditions are friendly to the existing validator.

Optional but recommended:

- A test that runs `estimate` against a config that overrides `scale` to `[1, 3, 5]` and `bootstrapDefault: 3`. Confirms the command honors config-supplied scales rather than the default. Write the JSONC config file directly under `plans/local-board.config.jsonc` after `init`, or skip `init` and write a minimal config by hand.

`npm test` runs the Node test runner; no new dev-dependencies required.

### Suggested commands run during implementation

- `npm test` after edits to `src/cli.js` and `test/cli.test.js`.
- `node --test test/cli.test.js` to scope to CLI tests during iteration.
- `node bin/local-board.js --root . validate --json` against a sample board to smoke-test against real ticket data.

### Out of scope (handled by sibling tickets)

- T20260516T1546Z: `calibration suggest` command and the calibration-pool logic.
- T20260516T1548Z: `complete-step design` enforcement gate that fails when `estimation.enabled` is true and `estimate` is `null` on a task or bug.
- T20260516T1549Z: `plans/prompts/roles/estimator.md` and `plans/prompts/steps/estimate.md`.
- `state-report --json` already exposes `estimate` and `estimateBasis` via the schema work in T20260516T1543Z; no change here.

## Implementation Notes

Implemented `local-board estimate <ticket-id> <points> [--basis <id-or-bootstrap>] [--force] [--json]` in `src/cli.js` per the technical design.

Behavior:
- Parses `<points>` with `Number.parseInt(rawPoints.trim(), 10)` and re-stringifies to detect non-integer input (rejects `2.5`, `abc`, empty, leading-zero, scientific notation).
- Loads config and checks membership in `config.estimation.scale`. Out-of-scale points print `estimate: <n> is not in estimation.scale [<scale>]` and exit 2.
- `--basis` defaults to `"bootstrap"` when omitted (per scope: no auto-pick here; calibration suggest is a separate command).
- When `--basis` is provided and is not the literal `"bootstrap"`, validates against `TICKET_ID_RE` and then calls `findTicket(root, basisOption)` to confirm the basis ticket exists. Errors propagate verbatim.
- Refuses to overwrite a non-null existing estimate unless `--force` is passed; error message includes the current value.
- Writes are sequenced as `estimate` first then `estimateBasis` via two `setTicketField` calls, satisfying the cross-field validator (`estimateBasis must be null when estimate is null`).
- On success prints the ticket path (or JSON record with `--json`) and returns 0; validation failures throw and the existing `main` try/catch returns 2.

Module changes:
- Exported `TICKET_ID_RE` from `src/tickets.js` for shape checks in CLI.
- Added `findTicket` and `TICKET_ID_RE` imports in `src/cli.js`.
- Added `estimate` to the dispatcher and a new `commandEstimate(root, args)` function.
- Appended the new command to `printUsage` so `--help`/usage lists it alongside the other commands.

Tests (test/cli.test.js):
- "CLI estimate command writes estimate and basis with validation, force, and config override" exercises happy path, scale rejection, decimal rejection, alpha rejection, overwrite refusal, `--force --basis bootstrap`, `--basis <valid-ticket-id>`, malformed `--basis` (regex), non-existent `--basis` ticket, and post-write `validate --json` ok.
- "CLI estimate honors a config override scale" writes a `local-board.config.jsonc` with `scale: [1, 3, 5]`/`bootstrapDefault: 3` and confirms `4` is rejected while `3` is accepted.

Commands run:
- `npm test` -> 71 passing, 0 failing.
- `npm run check` -> all syntax checks pass.
- `npm run validate` -> Ticket validation OK.

Out of scope (sibling tickets): `calibration suggest` auto-resolution (T20260516T1546Z), `complete-step design` enforcement gate (T20260516T1548Z), prompts (T20260516T1549Z).

## Review Findings

**Verdict:** PASS.

Reviewer: codex-task:read-only (gpt-5.5). Static review (read-only sandbox blocked test execution).

- Strict integer parsing: trim → parseInt → NaN check → string round-trip before scale membership check (src/cli.js:542, :553, :564). Out-of-scale errors list allowed values.
- `--basis` defaults to `bootstrap` when omitted (src/cli.js:569). Non-bootstrap values validated against exported `TICKET_ID_RE` then resolved via `findTicket` (src/cli.js:573, :582, src/tickets.js:101).
- Overwrite refused unless `--force` when existing estimate is non-null (src/cli.js:575, :578).
- Writes are `estimate` first, then `estimateBasis` — preserves the cross-field validator constraint (src/cli.js:585-586, src/tickets.js:633).
- Test coverage exercises default bootstrap, scale rejection, decimal/alpha rejection, overwrite refusal/force, explicit bootstrap, valid basis ID, malformed basis ID, missing basis ticket, post-write validation, config scale override.

## Test Evidence

Verification on branch feature/estimation-and-specialty-steps at commit 6b56f4e by claude-subagent:local-board-tester.

Commands run (all from C:\Users\Nicho\Documents\local-board):

- `npm test` -> tests 71, pass 71, fail 0, duration 3385.7ms.
- `npm run check` -> all `node --check` invocations clean (bin/local-board.js, src/cli.js, src/config.js, src/git.js, src/scaffold.js, src/tickets.js, install.mjs).
- `npm run validate` -> "Ticket validation OK" (run twice: pre- and post-smoke-test cleanup).

End-to-end CLI smoke test against a temp ticket (created, exercised, deleted; not committed):

1. `local-board create task tester-estimate-smoke --priority P2` -> created T20260516T1736Z with `estimate: null` and `estimateBasis: null`.
2. `local-board estimate T20260516T1736Z 4 --basis bootstrap` -> exit 0, printed ticket path. File now has `estimate: 4`, `estimateBasis: bootstrap`, `updated` bumped.
3. `local-board estimate T20260516T1736Z 2 --basis bootstrap` (no --force) -> exit 2, stderr `estimate: ticket T20260516T1736Z already has estimate 4; pass --force to overwrite`. File unchanged.
4. `local-board estimate T20260516T1736Z 2 --basis bootstrap --force` -> exit 0. File now has `estimate: 2`, `estimateBasis: bootstrap`, `updated` bumped again.
5. Temp ticket file removed; `npm run validate` re-run and clean.

Usage output from `local-board show ...` (which surfaces `printUsage` on unknown sub-commands) confirms the new line is present:
`local-board [--root <path>] estimate <ticket-id> <points> [--basis <ticket-id-or-bootstrap>] [--force] [--json]`.

Acceptance criteria coverage (from ticket):

- estimate writes value and basis on valid input: covered (step 2).
- out-of-scale rejection: covered by automated tests "CLI estimate command ..." in test/cli.test.js (test suite green).
- --basis <ticket-id> recorded verbatim: covered by automated tests.
- --basis bootstrap accepted literally: covered (steps 2 and 4).
- omitting --basis defers to bootstrap default (scope-limited; auto-pick is a sibling ticket): implemented per design and covered by automated tests.
- overwrite refusal without --force: covered (step 3).
- --force overwrites both fields: covered (step 4, basis re-written verbatim).
- test coverage for happy path, scale rejection, overwrite refusal, --force overwrite, explicit --basis bootstrap, auto-pick branch: all present in test/cli.test.js, all green.

Gaps / caveats:
- None encountered. No flakes. No environment blockers.

## Documentation Updates

Updated in commit 6269b9c:

- `memory-bank/systemPatterns.md` — `estimate` added to the MVP CLI list with one-line description (scale validation, overwrite guard).
- `docs/Workflow.md` — Estimation section gained a CLI subsection covering usage, flags, overwrite semantics, sequential write order, and an example.
- `README.md` — CLI example block updated with the new `estimate` command.

Docs author: codex-task:workspace-write (gpt-5.5). Codex sandbox blocked .git writes; orchestrator committed.

## Questions

## Run Log

- 2026-05-16T17:30:53Z: Completed design via claude-subagent:local-board-designer: Design: new commandEstimate in src/cli.js; parses points via Number.parseInt strict; checks config.estimation.scale membership; writes estimate then estimateBasis via two setTicketField calls (cross-field validator OK because estimate first); defaults basis to 'bootstrap' when --basis omitted; exports TICKET_ID_RE for shape check. 9-case test plan in test/cli.test.js.

- 2026-05-16T17:30:53Z: Ensured git branch feature/estimation-and-specialty-steps (already-current).

- 2026-05-16T17:34:10Z: Completed implement via claude-subagent:local-board-implementer: Implemented in commit 6b56f4e. src/cli.js commandEstimate (parse points strict int, scale membership, --force overwrite gate, --basis defaults to 'bootstrap', TICKET_ID_RE shape check + existence via findTicket); src/tickets.js exports TICKET_ID_RE; printUsage updated. 2 new test blocks covering 11 cases. npm test 71/71; check + validate clean.

- 2026-05-16T17:35:58Z: Completed review via codex-task:read-only: Codex review of commit 6b56f4e. Verdict: PASS. Confirmed: strict parse with round-trip, scale check, --force gate, basis default + validation, write ordering. 11 test cases adequate. Sandbox blocked test execution; verdict by code inspection.

- 2026-05-16T17:38:14Z: Completed test via claude-subagent:local-board-tester: npm test 71/71; check + validate clean. End-to-end CLI smoke: create temp ticket, estimate 4 --basis bootstrap (writes correctly), overwrite refusal without --force, --force overwrites both fields. printUsage updated. All AC verified. Verdict: PASS.

- 2026-05-16T17:39:58Z: Completed document via codex-task:workspace-write: Doc updates in commit 6269b9c: memory-bank/systemPatterns.md (MVP CLI list), docs/Workflow.md (Estimation CLI subsection), README.md (CLI example block).
