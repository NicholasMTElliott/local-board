---
id: T20260516T1546Z
type: task
status: implementing
priority: P2
parent: S20260516T1537Z
children: []
blockedBy: [T20260516T1543Z]
blocks: [T20260516T1549Z]
branch: feature/estimation-and-specialty-steps
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-05-16T15:46:42Z
updated: 2026-05-16T17:55:37Z
completedSteps: [design:claude-subagent:local-board-designer]
routingApprovals: []
---
# CLI: local-board calibration suggest <ticket-id> command

## Requirement

Add `local-board calibration suggest <ticket-id> [--json]` command. Depends on the schema task (T20260516T1543Z).

Algorithm:
- Pool = done tickets where `type` matches the target ticket's type, `estimate` is non-null, and both `workStartedAt` and `workCompletedAt` are set.
- Pick the ticket whose `estimate` is closest to the median estimate in the pool. Tie-break by most-recent `workCompletedAt`.
- Empty pool returns the sentinel string `bootstrap`.

Output: prints the chosen ticket ID (or `bootstrap`) to stdout. `--json` returns `{ "basis": "<id-or-bootstrap>" }`.

## Acceptance Criteria

- Command prints a calibration ticket ID or the literal `bootstrap`.
- Type filtering is enforced: a `bug` target never returns a `task` (and vice versa).
- Pool requires `estimate`, `workStartedAt`, and `workCompletedAt` all non-null; tickets missing any are excluded.
- Selection picks the estimate closest to the pool's median; ties broken by most-recent `workCompletedAt`.
- Empty pool returns `bootstrap`.
- `--json` emits `{ "basis": "..." }`.
- Unknown ticket ID exits non-zero with a clear message.
- Tests cover: empty pool returns bootstrap, populated pool picks median-anchored, tie-break by workCompletedAt, type separation (bug-vs-task), exclusion of tickets missing required fields.

## Related Tickets

## Technical Design

This task adds a `local-board calibration suggest <ticket-id> [--json]` subcommand that returns the recommended calibration ticket ID for sizing the target ticket, or the sentinel `bootstrap` when no prior calibrated work of the same type exists. The parent story already added the schema fields (`estimate`, `estimateBasis`, `workStartedAt`, `workCompletedAt`) via T20260516T1543Z, so this task is pure read-side: scan the board, filter, pick, print.

### Module layout

- New exported function `suggestCalibration(root, ticketId)` in `src/tickets.js`. Returns a record `{ ticket, calibration, poolSize, median, reason }` for the CLI to format. Keeping the logic in `tickets.js` matches the placement of every other board-reading helper (`queryNext`, `queryTicket`, `stateReport`, `schemaRecord`); `discover`, `byTicketId`, and `findTicket` already live there with the canonical front-matter accessors.
- New CLI dispatch in `src/cli.js`. Two-word command `calibration suggest <ticket-id>`. Add a branch in `main` that consumes a `calibration` head, then dispatches based on the next arg. This mirrors the existing `state-report` / `report` aliasing without inventing a generic subcommand registry. Import `suggestCalibration` alongside the other tickets imports in `cli.js`.
- Update `printUsage` to document the new command.

### Algorithm (in `suggestCalibration`)

1. `const { board, ticket: target } = await findTicket(root, ticketId);` reuses the existing helper so an unknown ticket throws `ticket <id> not found` (the CLI dispatcher already maps thrown errors to exit code 2 with the message on stderr, satisfying the acceptance criterion that an unknown ticket ID exits non-zero with a clear message). The returned `board` is the same data the caller would otherwise have to build, so no second filesystem pass.
2. Build the candidate pool by filtering `board.tickets`:
   - `ticket.id !== target.id` (do not suggest the target itself, even in the unlikely case it is already done with an estimate)
   - `ticket.status === "done"`
   - `ticket.type === target.type`
   - `ticket.frontMatter.estimate !== null && ticket.frontMatter.estimate !== undefined`
   - `typeof ticket.frontMatter.workStartedAt === "string"`
   - `typeof ticket.frontMatter.workCompletedAt === "string"`

   Note: `estimate` is serialized as a bare number in front matter but `parseScalar` returns the string token (e.g. `"4"`). Every numeric comparison and the median calculation must coerce via `Number(ticket.frontMatter.estimate)`. Defensive: skip any candidate whose coerced estimate is `NaN`, in case a hand-edited ticket slipped past `validate`.

3. If the pool is empty, return `{ ticket: target.id, calibration: "bootstrap", poolSize: 0, median: null, reason: "no prior calibrated tickets of type " + target.type }`.

4. Compute the lower-median of the pool numeric estimates:
   - `const sorted = pool.map(t => Number(t.frontMatter.estimate)).sort((a, b) => a - b);`
   - `const median = sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2] : sorted[sorted.length / 2 - 1];`
   - Even-count case takes the lower of the two middle values per the ticket spec (more conservative). Example: pool estimates `[1, 2, 4, 8]` -> sorted middle pair is `(2, 4)` -> median = 2.

5. Pick the closest ticket:
   - For each pool entry compute `Math.abs(Number(t.frontMatter.estimate) - median)`.
   - Sort by `(absDiff ASC, workCompletedAt DESC)`. ISO-8601 second-precision strings with the `Z` suffix sort correctly lexicographically, so `b.frontMatter.workCompletedAt.localeCompare(a.frontMatter.workCompletedAt)` yields most-recent-first as the tie-break.
   - Take `pool[0]` after sort.

6. Return `{ ticket: target.id, calibration: pick.id, poolSize: pool.length, median, reason: "closest to median estimate " + median + " among " + pool.length + " candidate" + (pool.length === 1 ? "" : "s") }`.

### CLI dispatch shape

Add to `main` before the catch-all (after the existing `if (command === "estimate")` branch is a natural spot):

```
if (command === "calibration") {
  const sub = args.shift();
  if (sub === "suggest") {
    return await commandCalibrationSuggest(root, args);
  }
  throw new Error("unknown calibration subcommand: " + (sub ?? "(missing)"));
}
```

`commandCalibrationSuggest`:
- `const asJson = takeFlag(args, "--json");`
- `const ticketId = args.shift();`
- `ensureNoArgs(args);`
- If `ticketId === undefined`, throw `"calibration suggest requires: <ticket-id> [--json]"`.
- `const result = await suggestCalibration(root, ticketId);`
- Non-JSON: `console.log(result.calibration);` exactly one line, just the ID or the literal `bootstrap`. No prefix, no path, no extra fields. This matches the single-line stdout contract and the parent story note that the estimator step prompt will consume this output directly.
- JSON: `console.log(JSON.stringify(result, null, 2));`
- `return 0;`

Errors propagate to the existing `main` `catch`, which prints to stderr and returns `2`.

### Files inspected

- `src/tickets.js` - confirmed `findTicket`, `discover`, `byTicketId`, and the front-matter shape (estimate as string, ISO timestamps as strings, `null` otherwise).
- `src/cli.js` - confirmed `takeFlag` / `takeOption` / `ensureNoArgs` helpers and the `try` / `catch` error contract that maps thrown errors to exit code 2.
- `src/config.js` - `estimation` config exists but is not needed by `suggest`; calibration auto-pick is independent of the configured scale.
- `plans/tickets/done/S20260516T1537Z_relative-sized-estimation-with-calibration-and-actuals.md` - parent story Calibration auto-pick subsection.
- `test/cli.test.js` - existing `runCli` harness pattern.
- `test/tickets.test.js` - existing `withBoard` and `replaceText` pattern for stamping estimation fields onto created tickets in tests.

### Risks and edge cases

- Estimate stored as string. Front-matter scalars round-trip as strings. Every comparison and the median calculation must coerce with `Number(...)`. The existing `estimate` CLI test already relies on this round-trip, so the data path is stable.
- Target ticket has no estimate yet. Explicitly supported - the whole point of this command is to suggest calibration BEFORE estimating. Do not require `target.estimate !== null`. Only the pool entries do.
- Target ticket is itself done with an estimate. Spec requires excluding `target.id` from its own pool. Test will cover this.
- Target type is `story` or `epic`. The CLI does not refuse; it computes the pool over same-type done stories or epics. In practice the parent story enforcement gate only fires for task and bug, but `suggest` itself stays type-agnostic and the empty-pool path simply returns `bootstrap`. Worth a one-line code comment; no separate guard.
- Even-count median. Lower-median is the contract. Document inline so future maintainers do not change it to a mean-of-middle-two.
- Tie-break collisions. Two pool entries with identical absolute difference AND identical `workCompletedAt`. Extremely unlikely (second precision plus auto-advancing ticket-id timestamps), but if it happens, after sort by `(absDiff, workCompletedAt DESC)` the relative order is whatever Node stable sort yields based on prior order. The pool is built from `board.tickets` which is path-sorted, so the result is deterministic. Not worth a tertiary tie-break.
- Missing `workCompletedAt` on a pool member after filter. Cannot happen because the filter requires it; the sort comparator therefore can call `.localeCompare` without a null guard.
- `board.loadErrors` non-empty. `findTicket` already throws joining the errors, so the dispatcher exits 2. No silent partial-pool behaviour.
- Discovery cost. A full board re-read on every `calibration suggest` invocation is consistent with how every other query command works (`queryNext`, `stateReport`). No caching needed at this scope.
- No call to `validate`. Intentional - `suggest` is read-only and should still work when the board has unrelated validation issues (e.g. another ticket missing a section). The dispatcher only fails when the target ticket cannot be located or there are load errors. This diverges from `queryNext` / `queryTicket` which call `validate`; the difference is acceptable because `suggest` does not assert system-wide invariants, only the calibration hint.

### Test plan

Tests for `suggestCalibration` in `test/tickets.test.js`, plus CLI smoke tests in `test/cli.test.js`. Reuse the existing `withBoard` harness and the `replaceText` helper to stamp estimation fields onto fixtures (the same pattern used by the existing `moveTicket` / archive tests).

1. Empty pool returns bootstrap. Create one target task with no done siblings. Expect `{ calibration: "bootstrap", poolSize: 0, median: null, reason: /no prior calibrated tickets of type task/ }`.
2. Populated pool, odd count, picks median. Create five done tasks with estimates `[1, 2, 4, 4, 8]`, all with `workStartedAt` / `workCompletedAt` set. Median = 4. Pick = one of the `estimate: 4` tickets (most-recent `workCompletedAt`).
3. Populated pool, even count, lower-median. Estimates `[1, 2, 4, 8]`. Lower median = 2. Pick = the `estimate: 2` ticket.
4. Tie-break by most-recent `workCompletedAt`. Two done tasks both with `estimate: 4` (so absDiff is identical), different `workCompletedAt`. Assert pick is the later-completed one. Then swap the timestamps and assert pick flips.
5. Type separation: bug target excludes task pool. Create three done tasks (estimates 1/2/4) and one done bug (estimate 8). Target is a new bug. The bug pool is just the single done bug, so pick = that bug ID. The task target with the same fixture should not see the bug, and vice versa.
6. Excludes tickets missing required fields. Create three done tasks: one missing `estimate`, one missing `workStartedAt`, one fully populated. Pool size = 1 and pick = the fully populated one.
7. Excludes non-done statuses. A ticket with `status: ready_for_implementation` but estimate or timestamps stamped (impossible via the normal flow, but defensible against hand-edited fixtures) must not enter the pool.
8. Target ticket excluded from its own pool. Set the target to `status: done` with a stamped estimate and timestamps; create one other done task. Pool must be `[other-task]`, not `[target, other-task]`. Pick = other task.
9. Unknown ticket id throws. `suggestCalibration(root, "T20990101T0000Z")` rejects with `/ticket .* not found/`.
10. CLI plain-text output is just the ID. `runCli(["--root", root, "calibration", "suggest", targetId])` then `assert.equal(stdout.trim(), pickId)` (or `"bootstrap"`). No path, no spaces.
11. CLI `--json` output shape. Call with `--json`. Parse stdout, assert keys `ticket`, `calibration`, `poolSize`, `median`, `reason`.
12. CLI unknown ticket id exits 2 with stderr message. `runCli(["--root", root, "calibration", "suggest", "T20990101T0000Z"])` -> `code === 2`, stderr matches `/not found/`.
13. CLI missing ticket id arg exits 2. `runCli(["--root", root, "calibration", "suggest"])` -> `code === 2`, stderr matches `/requires.*<ticket-id>/`.

Acceptance-criterion coverage map: empty pool -> (1); type separation -> (5); pool field requirements -> (6), (7); median selection -> (2), (3); tie-break -> (4); exclusion of target -> (8); unknown id -> (9), (12); JSON shape -> (11); single-line plaintext -> (10).

### Documentation impact

- `printUsage` in `cli.js` gains the line `local-board [--root <path>] calibration suggest <ticket-id> [--json]`.
- No `docs/` change required: this command is internal plumbing the estimator role will call. The parent story is closed and `memory-bank/` does not enumerate every CLI verb. If a follow-up touches a user-facing usage doc the verb can be added there.
- The estimator step prompt (T20260516T1549Z, downstream ticket that this one `blocks`) will invoke this command; this design does not need to land that prompt.

### Suggested ticket sections

- Implementation Notes: to be filled by the implementer with the exact `suggestCalibration` and `commandCalibrationSuggest` code paths added, plus any deviations from this design.
- Test Evidence: `npm test` output filtered to the new tests once they land.
- Documentation Updates: `printUsage` line added; no other docs touched.
- Run Log: standard step entries.

## Implementation Notes

- Added `suggestCalibration(root, ticketId)` in `src/tickets.js`. Uses `findTicket` for target resolution (propagates `ticket <id> not found`) and `discover` for a single board read; rejects when `board.loadErrors` is non-empty. Pool filter excludes the target, requires `status === "done"`, `type === target.type`, non-null `estimate`, string `workStartedAt`, string `workCompletedAt`, and a finite `Number(estimate)`. Computes a lower-median over the sorted numeric estimates via `Math.floor((n-1)/2)` so both odd and even pools return the lower middle when there is a true tie. Selection sorts a pool copy by `(absDiff ASC, workCompletedAt DESC)` using `localeCompare` for the recency tie-break.
- Empty-pool return: `{ ticket, calibration: "bootstrap", poolSize: 0, median: null, reason: "No prior calibrated tickets of type <type>" }`. Populated-pool reason: `"Closest to median estimate <median> among <n> calibrated <type>(s); selected by recency on tie."` Pluralization of the type noun matches design.
- Added `calibration` dispatch and `commandCalibrationSuggest` in `src/cli.js`. Two-word command `calibration suggest <ticket-id> [--json]`; shifts the subcommand off `args` before reading the ticket id. Plain output is a single line containing exactly the calibration ID or the literal `bootstrap`; `--json` prints the full record via `JSON.stringify(result, null, 2)`. Missing `<ticket-id>` throws `calibration suggest requires: <ticket-id> [--json]`; unknown subcommands throw `unknown calibration subcommand: ...`. Errors propagate to the existing `main` `catch`, which writes to stderr and returns exit code 2. `printUsage` now lists the new command.
- Tests in `test/tickets.test.js` cover the unit-level scenarios (empty pool, odd/even median, recency tie-break, type filtering, missing fields, non-done status, target self-exclusion, unknown ticket id). Added a small `stampCalibrated` helper to keep the fixtures terse. The unknown-id test seeds one ticket so `findTicket` reaches the not-found branch rather than the empty-directory `loadErrors` path. Tests in `test/cli.test.js` exercise the plain-vs-JSON output contract for both bootstrap and populated pools, plus the exit-2 paths for unknown ticket id and missing argument.
- Files: `src/tickets.js`, `src/cli.js`, `test/tickets.test.js`, `test/cli.test.js`.
- Validation: `npm run check` clean, `npm test` 82/82 passing, `npm run validate` reports `Ticket validation OK`.

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-05-16T17:51:54Z: Completed design via claude-subagent:local-board-designer: Design: new suggestCalibration in src/tickets.js, commandCalibrationSuggest in src/cli.js (two-word dispatch). Filters same-type done with non-null estimate+workStartedAt+workCompletedAt; excludes target; lower-median for even counts; absolute-diff selection with most-recent workCompletedAt tie-break. Empty pool returns bootstrap. JSON output: {ticket, calibration, poolSize, median, reason}. 13-case test plan.

- 2026-05-16T17:51:55Z: Ensured git branch feature/estimation-and-specialty-steps (already-current).
