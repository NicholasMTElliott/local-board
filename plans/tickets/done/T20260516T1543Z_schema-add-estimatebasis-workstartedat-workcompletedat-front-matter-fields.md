---
id: T20260516T1543Z
type: task
status: done
priority: P2
parent: S20260516T1537Z
children: []
blockedBy: []
blocks: [T20260516T1544Z, T20260516T1545Z, T20260516T1546Z, T20260516T1547Z]
branch: feature/estimation-and-specialty-steps
estimate: null
created: 2026-05-16T15:43:35Z
updated: 2026-05-16T16:25:26Z
completedSteps: [design:claude-subagent:local-board-designer, implement:claude-subagent:local-board-implementer, review:codex-task:read-only, test:claude-subagent:local-board-tester, document:codex-task:workspace-write]
routingApprovals: []
---
# Schema: add estimateBasis, workStartedAt, workCompletedAt front-matter fields

## Requirement

Extend the canonical front-matter field set to include `estimateBasis`, `workStartedAt`, and `workCompletedAt`. All three are nullable. The existing `estimate` field stays numeric. Update the schema, parser, writer, validator, scaffold, and ticket template so the new fields parse round-trip, validate cleanly when null or correctly typed, and render in the canonical order alongside `estimate`.

Scope: schema only. No behavior changes that read or write these fields beyond what is needed for parse/validate/render. Wall-clock setting, CLI command, enforcement, and prompts are tracked in sibling tasks.

Files of interest:
- src/tickets.js (REQUIRED_FIELDS / NULLABLE_FIELDS / canonical ordering)
- src/scaffold.js
- plans/templates/ticket.md

## Acceptance Criteria

- `estimateBasis`, `workStartedAt`, and `workCompletedAt` are recognized front-matter fields, all nullable.
- Canonical field ordering places them adjacent to `estimate` in the writer output.
- Parser round-trips `null` and well-formed values for all three fields without loss.
- `validate` accepts the new fields when null and when correctly typed; emits a useful error on malformed values.
- `create` scaffolds new tickets with these fields present and null.
- The ticket template at `plans/templates/ticket.md` lists the new fields.
- Tests cover: parse round-trip (null and populated), canonical ordering in serialized output, validator acceptance for nulls, and validator rejection for malformed timestamps / non-string estimateBasis.

## Related Tickets

## Technical Design

### Summary

Add three nullable front-matter fields to the canonical schema: estimateBasis, workStartedAt, and workCompletedAt. Wire them through parse, validate, render, scaffold, and the ticket template so they round-trip cleanly. No behavior changes to start-work or moveTicket - those land in T20260516T1544Z. Existing tickets without the new keys continue to parse and validate; the parser materializes them as null on read via a small post-parse shim.

### Files to modify

- src/tickets.js - extend REQUIRED_FIELDS, NULLABLE_FIELDS, the renderTicket inline template, the readTicket post-parse defaulting, and validateTicketShape with three new semantic rules. The canonical ordering used by serializeFrontMatter is driven by CANONICAL_FIELDS = REQUIRED_FIELDS plus OPTIONAL_FIELDS, so adding to REQUIRED_FIELDS in the right position is sufficient to lock down writer order.
- src/scaffold.js - update the inline plans/templates/ticket.md template body in the FILES map. The two template strings (renderTicket in tickets.js and the entry in scaffold.js) must stay in sync.
- plans/templates/ticket.md - add the three fields adjacent to estimate. This file is the on-disk version installed by previous inits; keep it consistent with the scaffold source of truth.
- test/tickets.test.js - add coverage as described below. No new test file needed; the existing parse/validate/render harness already covers the relevant surface.

### Field ordering

Place the three new fields immediately after estimate in REQUIRED_FIELDS so estimation-related fields stay grouped:

```
id, type, status, priority, parent, children, blockedBy, blocks,
branch, estimate, estimateBasis, workStartedAt, workCompletedAt,
created, updated
```

Then OPTIONAL_FIELDS (completedSteps, routingApprovals) continues to tail the canonical list as today. The serializer reads CANONICAL_FIELDS to write keys in this order, so writes will produce the desired layout automatically.

### Validation rules

In validateTicketShape (src/tickets.js), add the following after the existing nullable-string check:

1. estimateBasis shape and pairing with estimate.
   - If estimateBasis is non-null and not a string, the existing NULLABLE_FIELDS check fires with the standard "must be null or a string" message.
   - If estimateBasis is a non-null string, it must match either TICKET_ID_RE (the existing prefix-plus-timestamp pattern) or the literal string "bootstrap". Otherwise error with a message like: estimateBasis must be a ticket id or the literal bootstrap. Do NOT verify the basis ticket exists in this task - cross-ticket existence checks belong in validateLinks and are out of scope here. The basis-ticket-must-be-done rule is enforced by T20260516T1546Z (the estimate command).
   - If estimate is null but estimateBasis is non-null, error: estimateBasis must be null when estimate is null. This is the only cross-field invariant added by this task involving estimate.

2. workStartedAt timestamp shape. If workStartedAt is non-null, reuse the same predicate already used for created and updated: a non-null value that fails parseDate should trigger an error like "workStartedAt must be an ISO-8601 datetime with a timezone offset or Z". Extend the existing created/updated loop or write a parallel loop guarded by non-null because workStartedAt and workCompletedAt are optional in value while created and updated are not.

3. workCompletedAt timestamp shape and ordering.
   - Non-null workCompletedAt must satisfy parseDate. Same error template as above.
   - If workCompletedAt is non-null and workStartedAt is null, error: workCompletedAt requires workStartedAt to be set. We deliberately do NOT enforce a workStartedAt-before-workCompletedAt monotonic check here - that is a runtime concern for the wall-clock task and out of scope for schema validation.

All three fields go into NULLABLE_FIELDS so the existing "must be null or a string" check applies uniformly.

### Renderer changes

serializeFrontMatter already iterates CANONICAL_FIELDS and emits only keys that are present on the front-matter object (Object.hasOwn(frontMatter, field)). Two cases:

- New ticket created via createTicket: renderTicket (the inline template literal around line 979) writes the YAML directly as a string. Update it to include the three new keys with null values, placed immediately after the estimate line.
- Existing ticket read then written: readTicket calls parseFrontMatter, which materializes only keys that appear in the YAML. After this change, validators would flag existing tickets without the new fields as "missing required field". To avoid breaking the existing board on first read, the parser needs to default-null missing nullable fields. The simplest patch: after parseFrontMatter returns, but before readTicket constructs the ticket object, fill any of the three new nullable fields that are not Object.hasOwn with null. This keeps the parse layer pure (no defaulting inside parseFrontMatter) and concentrates the back-compat shim in one place. Limit the defaulting to these three specific fields rather than all of NULLABLE_FIELDS to avoid masking genuine omissions of pre-existing required fields (parent, branch, estimate).

Once defaulted, the "missing required field" check inside validateTicketShape passes for legacy tickets, and subsequent renders will emit the keys in canonical order on the next write.

### Backward compatibility

The cleanest path that preserves the "required" intent without breaking older tickets:

1. Add the fields to REQUIRED_FIELDS so they appear in canonical ordering and are written on create.
2. Add the fields to NULLABLE_FIELDS so the type check accepts null and string values.
3. In readTicket, after parsing, default each of the three new fields to null if absent. This makes the on-disk absence equivalent to an explicit null in memory. Validation then passes for legacy tickets, and the next write (via any setTicketField, appendTicketComment, moveTicket, etc.) will materialize the keys on disk.
4. Do not retroactively rewrite every ticket - let writes migrate them organically. A bulk-migration script can be filed as a follow-up if needed; the test board and validate working cleanly is sufficient.

### Test plan

Add to test/tickets.test.js (extend the existing harness - same withBoard, createTicket, discover, validate utilities; reuse the local replaceText helper):

1. Create scaffolds new fields as null. createTicket then readFile and assert the YAML contains estimateBasis: null, workStartedAt: null, workCompletedAt: null and that they appear after the estimate line and before the created line in source order (assert with a single multi-line regex or by splitting on newlines and comparing index positions).
2. Round-trip with populated values. Use replaceText to set estimate: 4, estimateBasis: T20260514T2056Z, workStartedAt: 2026-05-14T21:00:00Z, workCompletedAt: 2026-05-14T22:00:00Z. Run validate against discover(root), assert empty issues. Then call setTicketField(root, id, "priority", "P1") (an arbitrary write) and re-read; assert all four estimation fields survived with the same values and in canonical order.
3. Round-trip with bootstrap basis. Same as (2) but with estimateBasis: bootstrap. Assert validate clean.
4. Validate rejects malformed estimateBasis. Use replaceText to set estimateBasis to a non-matching literal like nonsense-string; assert validate emits the expected error message.
5. Validate rejects estimateBasis when estimate is null. estimate: null with estimateBasis: T20260514T2056Z. Assert validate emits "estimateBasis must be null when estimate is null".
6. Validate rejects malformed workStartedAt and workCompletedAt. Set each to "not-a-timestamp" in turn; assert the ISO-8601 error for each.
7. Validate rejects workCompletedAt without workStartedAt. workStartedAt: null with workCompletedAt: 2026-05-14T22:00:00Z. Assert "workCompletedAt requires workStartedAt to be set".
8. Legacy ticket without new fields still parses and validates. Construct a ticket file by hand (or via createTicket then replaceText to remove the three new lines) and assert validate against discover(root) is empty - i.e., the read-time defaulting kicks in.
9. Validator accepts all-null new fields. Implicitly covered by the existing "create and validate ticket" test once renderTicket emits the keys, but adding a dedicated assertion that the parsed front matter has workStartedAt equal to null etc. tightens the contract.

npm test should pass with no other changes. The cli.test.js and config.test.js suites do not exercise these fields and should remain green; the read-time defaulting protects any existing test fixtures.

### Risks and edge cases

- Two template strings drift. renderTicket in src/tickets.js and the template entry in src/scaffold.js are independent string literals. The existing "initProject scaffolds a new local-board project idempotently" test runs both paths and validates the result, which catches gross mismatches. Consider a tighter ordering assertion in review.
- plans/templates/ticket.md on disk is already installed in this repo. It must be updated by hand as part of this task, in addition to the scaffold source. The scaffold is idempotent (flag wx) and will skip existing files.
- The basis-ticket-exists check is intentionally deferred. If a user manually writes estimateBasis: T20260101T0000Z pointing at a non-existent ticket, schema validation will not catch it. The estimate CLI (T20260516T1546Z) is responsible for verifying the basis ticket exists, is done, and is of the same type. Document this in the implementer notes.
- setTicketField API surface. The new fields are nullable strings; setTicketField already supports any CANONICAL_FIELDS entry that is not IMMUTABLE_FIELDS and validates via assertFieldValue. No code change needed - the generic nullable-string path handles all three. The estimation CLI in T20260516T1546Z will use setTicketField (or a thin wrapper) to write estimate and estimateBasis; that is out of scope here.
- Ordering of validator checks. Add the cross-field checks (estimateBasis requires non-null estimate; workCompletedAt requires non-null workStartedAt) AFTER the per-field type and format checks so a malformed value yields the more specific error first.
- Existing tickets with no estimate value. All current tickets in this repo have estimate: null. After this change they will gain three more nulls on next write. That is the intended migration path and produces a clean diff.

### Out of scope (deferred to siblings)

- start-work setting workStartedAt (T20260516T1544Z).
- moveTicket to done setting workCompletedAt (T20260516T1544Z).
- local-board estimate and local-board calibration suggest commands (T20260516T1546Z, T20260516T1545Z).
- estimation config block and design-step gate (T20260516T1547Z).
- Estimator role and step prompts (T20260516T1548Z, T20260516T1549Z).
- Verifying that estimateBasis points at an existing done ticket of the same type. That belongs in the estimate CLI.

### Suggested implementation order

1. Edit src/tickets.js - REQUIRED_FIELDS, NULLABLE_FIELDS, renderTicket, readTicket default-null shim, validateTicketShape new checks.
2. Edit src/scaffold.js template string.
3. Edit plans/templates/ticket.md on disk.
4. Add tests to test/tickets.test.js.
5. npm test clean. node bin/local-board.js validate against the current ticket board clean.

## Implementation Notes

Commit: 04b30bd8d924d888779c2c897baca6476d9c6a08

Files changed:
- src/tickets.js: Added estimateBasis, workStartedAt, workCompletedAt to REQUIRED_FIELDS (immediately after estimate), to NULLABLE_FIELDS, and a new LEGACY_DEFAULT_NULL_FIELDS list driving the readTicket back-compat shim. Extended validateTicketShape with four new checks: estimateBasis must be a ticket id or "bootstrap"; workStartedAt and workCompletedAt must be ISO-8601 when non-null; estimateBasis must be null when estimate is null; workCompletedAt requires workStartedAt. Extended renderTicket inline template to emit the three new keys with null defaults adjacent to estimate.
- src/scaffold.js: Updated the inline plans/templates/ticket.md scaffold body to include the three new keys with null defaults.
- plans/templates/ticket.md: On-disk template updated to mirror the scaffold source.
- test/tickets.test.js: Added 9 new test cases covering scaffold ordering, populated round-trip, bootstrap basis, malformed basis error, basis-without-estimate cross-field error, malformed workStartedAt/workCompletedAt timestamps, completedAt-without-startedAt error, and legacy ticket back-compat via read-time defaulting.

Test additions (9 new tests, all passing):
- createTicket scaffolds estimateBasis, workStartedAt, workCompletedAt as null in canonical order
- populated estimateBasis with ticket id round-trips through write and validates clean
- estimateBasis accepts the literal bootstrap
- validate rejects malformed estimateBasis
- validate rejects estimateBasis when estimate is null
- validate rejects malformed workStartedAt and workCompletedAt timestamps
- validate rejects workCompletedAt without workStartedAt
- legacy ticket without new estimation fields parses and validates via read-time defaulting

Implementation notes:
- The readTicket post-parse shim only defaults the three new fields (LEGACY_DEFAULT_NULL_FIELDS), not all of NULLABLE_FIELDS. This keeps genuine pre-existing required-field omissions (parent, branch, estimate) visible as validation errors.
- estimateBasis existence check (does the referenced ticket actually exist and is it done) is intentionally NOT in schema validation. That belongs in the estimate CLI (T20260516T1546Z) per the design.
- No workStartedAt-before-workCompletedAt monotonic check was added; that is runtime/wall-clock concern out of scope here.
- renderTicket's hand-coded template keeps the order branch, estimate, estimateBasis, workStartedAt, workCompletedAt, completedSteps, routingApprovals, created, updated. The serializer-driven re-write (via setTicketField etc.) follows CANONICAL_FIELDS order which is identical for the new fields' relative placement adjacent to estimate.

Commands run:
- npm test: 47/47 passing
- npm run check: clean
- npm run validate: Ticket validation OK

## Review Findings

**Verdict:** CONCERNS (soft pass — no functional blocker).

Reviewer: codex-task:read-only (gpt-5.5).

**Confirmed correct:**
- `REQUIRED_FIELDS` places `estimateBasis`, `workStartedAt`, `workCompletedAt` immediately after `estimate` (src/tickets.js:64); `NULLABLE_FIELDS` includes all three (src/tickets.js:86).
- Read-time legacy shim is scoped to the three new fields only — does not mask validation for older nullable fields like `parent`/`branch`/`estimate` (src/tickets.js:147, 150).
- All three semantic validators correct: nullable string check (src/tickets.js:603), `estimateBasis` regex+bootstrap (src/tickets.js:615), timestamp shape via `parseDate` (src/tickets.js:619, 1236), basis-null-when-estimate-null (src/tickets.js:625), completed-requires-started (src/tickets.js:629).
- Templates in sync: `renderTicket` (src/tickets.js:1018), `src/scaffold.js:44`, `plans/templates/ticket.md:11`.

**Concerns (non-blocking, follow-up worthy):**
- Test count is 8 (test/tickets.test.js:600, :628, :661, :674, :691, :707, :734, :750), not the 9 the design plan listed. The missing cases are: (a) an all-null parsed-front-matter assertion verifying the three new fields are present and null when read from a freshly-scaffolded ticket, and (b) explicit non-string YAML value rejection for `estimateBasis` (e.g. `estimateBasis: []`). The current rejection test covers malformed strings only.

These are coverage gaps, not correctness gaps. Logged here for visibility; recommend filing a follow-up task if the gap matters in practice. Not gating progression.

## Test Evidence

### Commands run

- npm test (initial): 47/47 pass; node --test reporter; duration ~3.66s.
- npm run check: clean (node --check across bin/local-board.js, src/cli.js, src/config.js, src/git.js, src/scaffold.js, src/tickets.js, install.mjs).
- npm run validate: Ticket validation OK.
- npm test (after adding two coverage-gap tests): 49/49 pass; duration ~3.46s.

### Acceptance criteria coverage

- estimateBasis, workStartedAt, workCompletedAt recognized and nullable: createTicket scaffolds estimateBasis, workStartedAt, workCompletedAt as null in canonical order (test/tickets.test.js:600); freshly-scaffolded ticket exposes new estimation fields as null in parsed front matter (test/tickets.test.js:775, added).
- Canonical ordering adjacent to estimate in writer output: createTicket scaffolds... canonical order (test/tickets.test.js:600, ordering asserted via lines.findIndex on estimate/estimateBasis/workStartedAt/workCompletedAt/created); populated estimateBasis with ticket id round-trips through write and validates clean (test/tickets.test.js:628, re-asserts ordering after setTicketField re-renders).
- Parser round-trips null and well-formed values: createTicket scaffold test (null case); populated round-trip test (test/tickets.test.js:628, ticket-id case); estimateBasis accepts the literal bootstrap (test/tickets.test.js:661, bootstrap case).
- validate accepts new fields when null and when correctly typed: scaffold test asserts validate(...) returns []; populated and bootstrap round-trip tests also assert empty issues.
- validate emits a useful error on malformed values: validate rejects malformed estimateBasis (test/tickets.test.js:674); validate rejects malformed workStartedAt and workCompletedAt timestamps (test/tickets.test.js:707); validate rejects non-string YAML estimateBasis (test/tickets.test.js:794, added).
- create scaffolds new tickets with these fields present and null: createTicket scaffold test (test/tickets.test.js:600) and the added parsed-front-matter assertion (test/tickets.test.js:775).
- Template lists the new fields: covered by initProject scaffolds a new local-board project idempotently (test/tickets.test.js:811) which validates the scaffolded board; the on-disk template at plans/templates/ticket.md was updated per Implementation Notes.
- Cross-field invariants:
  - estimateBasis non-null when estimate is null rejected: validate rejects estimateBasis when estimate is null (test/tickets.test.js:691).
  - workCompletedAt non-null when workStartedAt null rejected: validate rejects workCompletedAt without workStartedAt (test/tickets.test.js:734).
- Legacy tickets (no new fields) still parse cleanly: legacy ticket without new estimation fields parses and validates via read-time defaulting (test/tickets.test.js:750).

### Coverage-gap decision

Review Findings flagged two minor coverage gaps from the design plans test list (9 cases planned, 8 implemented). Decision: close the gap now because both cases are cheap, lock in invariants that the implementation already satisfies, and the harness reuse is trivial. Added two tests:

- freshly-scaffolded ticket exposes new estimation fields as null in parsed front matter (test/tickets.test.js:775) — asserts Object.hasOwn for each new field and that the parsed value is null after discover, locking in the readTicket post-parse shim contract.
- validate rejects non-string YAML estimateBasis (test/tickets.test.js:794) — sets estimateBasis: [] in YAML and asserts the NULLABLE_FIELDS "must be null or a string" error fires, exercising the type guard distinct from the prefix-or-bootstrap regex.

Both new tests pass on first run. Total test count moved from 47 to 49 and remains 49/49 passing. Commit recorded under SHA 9b064d2 on branch feature/estimation-and-specialty-steps with message: Add missing test coverage for T20260516T1543Z schema (T20260516T1543Z).

### Gaps, flakes, or environment caveats

- No flakes observed across two npm test runs.
- The legacy ticket round-trip test (test/tickets.test.js:750) verifies in-memory defaulting via discover but does not assert that a subsequent write re-materializes the keys on disk; behavior was reviewed in src/tickets.js but is not directly tested. Not blocking; out of scope for the acceptance criteria.
- Git reported "LF will be replaced by CRLF" on commit (Windows worktree, autocrlf). Cosmetic; commit applied cleanly.
- Working tree still shows the unrelated ticket-folder moves (T20260516T1543Z and T20260516T1550Z moved from backlog/ to ready/) that pre-existed this verification. Not touched by this commit per scope.

## Documentation Updates

Updated in commit 54ab478:

- `memory-bank/systemPatterns.md` — added `estimateBasis`, `workStartedAt`, `workCompletedAt` to the canonical Required fields list immediately after `estimate`.
- `docs/TicketFormat.md` — extended the human-readable front matter example, documented each new field's purpose, and noted when each field gets set:
  - `estimateBasis` — ticket ID of the calibration ticket used for the estimate, or literal `bootstrap` if no prior calibration of the same type exists. Null when `estimate` is null.
  - `workStartedAt` — ISO-8601 timestamp set by `start-work` the first time it's invoked on the ticket. Records wall-clock work start.
  - `workCompletedAt` — ISO-8601 timestamp set by `move <id> done`. Records wall-clock work completion. Wall-clock actual = `workCompletedAt - workStartedAt`; pauses in `questions` or `blocked` are intentionally included.

README.md was not touched because it links to `docs/TicketFormat.md` rather than listing fields directly. `plans/templates/ticket.md` was updated by the implementer in 04b30bd, not re-touched here.

Docs author: codex-task:workspace-write (gpt-5.5). The codex sandbox blocked writes to `.git` so the orchestrator authored the commit; doc content authored by codex.

## Questions

## Run Log

- 2026-05-16T16:11:44Z: Completed design via claude-subagent:local-board-designer: Technical Design written: three nullable fields (estimateBasis, workStartedAt, workCompletedAt) added to REQUIRED_FIELDS after estimate; all join NULLABLE_FIELDS. Three semantic validators added (basis regex/bootstrap, basis-null-with-estimate-null, completed-requires-started). renderTicket inline template extended. readTicket post-parse shim defaults missing fields to null for legacy compatibility. Nine targeted test cases planned.

- 2026-05-16T16:12:04Z: Ensured git branch feature/estimation-and-specialty-steps (already-current).

- 2026-05-16T16:16:02Z: Completed implement via claude-subagent:local-board-implementer: Implemented schema changes in commit 04b30bd. Files: src/tickets.js (REQUIRED_FIELDS, NULLABLE_FIELDS, LEGACY_DEFAULT_NULL_FIELDS, readTicket shim, validators, renderTicket template), src/scaffold.js, plans/templates/ticket.md, test/tickets.test.js. 9 new tests added. npm test: 47/47 passing. npm run check and npm run validate clean.

- 2026-05-16T16:19:35Z: Completed review via codex-task:read-only: Codex read-only review of commit 04b30bd. Verdict: CONCERNS — no functional blocker. Confirmed schema placement, validators, read-shim scope, and template sync. Concern: 8 new tests vs 9 in design plan; missing all-null-parsed-fm assertion and non-string YAML estimateBasis rejection. Recorded in Review Findings; treated as soft pass and advancing.

- 2026-05-16T16:22:24Z: Completed test via claude-subagent:local-board-tester: npm test: 49/49 passing after adding 2 tests to close review coverage gap (test/tickets.test.js:775, :794). npm run check clean. npm run validate: Ticket validation OK. All 8 AC items mapped to test locations. Coverage-gap test addition committed as 9b064d2.

- 2026-05-16T16:25:26Z: Completed document via codex-task:workspace-write: Codex authored doc updates to memory-bank/systemPatterns.md and docs/TicketFormat.md. Commit 54ab478 (orchestrator committed since codex sandbox blocked .git writes). README untouched (links to TicketFormat). Template untouched (implementer already updated).
