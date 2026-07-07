---
id: T20260516T1544Z
type: task
status: archived
priority: P2
parent: S20260516T1537Z
children: []
blockedBy: [T20260516T1543Z]
blocks: []
branch: feature/estimation-and-specialty-steps
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-05-16T15:44:39Z
updated: 2026-07-07T14:07:41Z
completedSteps: [design:claude-subagent:local-board-designer, implement:claude-subagent:local-board-implementer, review:codex-task:read-only, test:claude-subagent:local-board-tester, document:codex-task:workspace-write]
routingApprovals: []
---
# Wall-clock plumbing: start-work sets workStartedAt; move done sets workCompletedAt

## Requirement

Wire wall-clock timestamps onto the lifecycle commands. Depends on the schema task (T20260516T1543Z) landing first so the fields exist.

Behavior:
- `start-work <id>`: if `workStartedAt` is null, set it to the current ISO-8601 timestamp. If already set, leave it alone (idempotent — returning from `questions` or `blocked` does not reset the clock).
- `moveTicket(..., 'done')`: if `workCompletedAt` is null, set it to the current ISO-8601 timestamp. Once set, do not clear or overwrite it (re-opening a ticket keeps the original closeout time).
- `archiveDoneTickets` does not touch these fields.
- The autoMerge closeout path also sets `workCompletedAt` when it lands a ticket in `done`.

Files of interest:
- src/tickets.js (start-work, moveTicket)
- any autoMerge closeout code that transitions to done

## Acceptance Criteria

- First `start-work` on a ticket sets `workStartedAt` to the current ISO timestamp.
- A second `start-work` on the same ticket leaves `workStartedAt` unchanged.
- `move <id> done` sets `workCompletedAt` when null.
- The autoMerge closeout path sets `workCompletedAt` when it transitions a ticket to done.
- Moving a ticket out of done and back into done does not overwrite an existing `workCompletedAt`.
- `archiveDoneTickets` leaves both fields untouched.
- Tests cover: start-work idempotence on workStartedAt, move-to-done setting workCompletedAt, re-open then move-done not overwriting, autoMerge closeout path setting workCompletedAt.

## Related Tickets

## Technical Design

### Summary

Wire wall-clock timestamps into the two lifecycle commands that bracket active work. The CLI start-work (implemented as startTicketWork in src/git.js) must stamp workStartedAt on first invocation per ticket. moveTicket (in src/tickets.js) must stamp workCompletedAt the first time a ticket lands in done. Both writes are idempotent: a non-null existing value is preserved. archiveDoneTickets must leave both fields untouched. The schema fields already exist and validate (T20260516T1543Z); this task adds the writes.

### Files and APIs Inspected

- src/tickets.js: canonical field list (lines 64-87), moveTicket (lines 278-308), archiveDoneTickets (lines 310-341), setTicketField (lines 343-360), renderMarkdownTicket and serializeFrontMatter (lines 1053-1067), withUpdated (lines 1167-1169), formatIsoSeconds (lines 1248-1250). Validators at lines 619-631 already enforce ISO format on the two fields and forbid workCompletedAt without workStartedAt.
- src/git.js: startTicketWork at lines 8-39. This is what local-board start-work actually calls. The ticket says modify startWork in src/tickets.js but the real function lives in src/git.js. The design adapts to the real call site.
- src/cli.js lines 265-283: commandStartWork dispatches to startTicketWork.
- test/tickets.test.js: existing patterns for moveTicket, setTicketField, appendTicketComment, deterministic now injection via braces, and the withBoard helper.
- test/git.test.js: patterns for testing startTicketWork against a real git repo, including archiveDoneTickets coverage at line 146.
- plans/tickets/done/T20260516T1543Z_*.md: confirms workStartedAt and workCompletedAt are already added to the canonical scaffold.

### Timestamp Format

Use formatIsoSeconds(now) (defined in src/tickets.js line 1248) for both writes. This is the same helper used by setTicketField, appendTicketComment, setTicketSection, completeStep, approveInline, and linkParent to produce the updated value. It returns ISO-8601 with Z suffix and second precision (for example 2026-05-16T15:37:00Z), which matches created and updated exactly. Do NOT invent a new formatter. Do NOT use toISOString() directly. Reusing formatIsoSeconds keeps round-trip parsing and lexicographic sort behavior consistent across all timestamp fields.

formatIsoSeconds is currently not exported from src/tickets.js. Either export it (preferred, one source of truth) or duplicate the one-line function locally in src/git.js. Exporting is the lower-risk choice.

### Write Path

Both writes go through the same renderMarkdownTicket(frontMatter, body) round-trip already used by moveTicket and setTicketField. serializeFrontMatter honors CANONICAL_FIELDS ordering, so workStartedAt and workCompletedAt will appear in the canonical slot regardless of how we mutate the in-memory front matter. For moveTicket, mutate the local frontMatter object before calling renderMarkdownTicket (the established pattern in moveTicket, linkParent, completeStep). For startTicketWork, reuse the existing setTicketField helper because the function already chains multiple setTicketField calls and one extra write on the first start-work is cheap.

### startTicketWork Change (src/git.js)

In startTicketWork(root, ticketId, options):

1. After const ticket = await findTicket(root, ticketId), inspect ticket.frontMatter.workStartedAt.
2. Compute now once at the top: const now = options.now ?? new Date(). Move this assignment above the branch resolution so the timestamp reflects when work began.
3. If workStartedAt === null, call setTicketField(root, ticketId, "workStartedAt", formatIsoSeconds(now), { now }). setTicketField already supports this field because it is in CANONICAL_FIELDS and not in IMMUTABLE_FIELDS.
4. If non-null, do nothing. Idempotent guard preserves the original clock across returns from questions or blocked.
5. The write must happen even when ensureGitBranch reports already-current. Place it after findTicket and before the branch and status mutations.

Order of operations inside startTicketWork after the change:
- findTicket
- compute now
- if workStartedAt is null, setTicketField workStartedAt to formatIsoSeconds(now)
- existing branch resolution and ensureGitBranch
- existing branch-write via setTicketField branch if changed
- existing appendTicketComment run-log entry
- existing moveTicket to implementing if applicable

Tradeoff: this adds one extra file write on the first start-work per ticket. Acceptable; start-work is not on a hot path.

### moveTicket Change (src/tickets.js)

In moveTicket(root, ticketId, status, options) (current body lines 278-308):

1. Compute const now = options.now ?? new Date() once at the top of the function and reuse it for both withUpdated and the new conditional. This guarantees updated and workCompletedAt share the exact same second when both are written in the same call.
2. After const frontMatter = withUpdated({ ...ticket.frontMatter, status }, now), add a guarded write: when status === "done" and frontMatter.workCompletedAt === null, set frontMatter.workCompletedAt = formatIsoSeconds(now).
3. Use strict === null to be explicit and match the validator. The read shim in readTicket normalizes missing fields to null via LEGACY_DEFAULT_NULL_FIELDS, so this covers both explicit-null and legacy-absent.
4. No other status branches touch workCompletedAt. Reopening (for example done to ready_for_review) leaves the existing timestamp intact because the conditional only writes when status === "done" AND workCompletedAt === null. A second move-to-done after reopen also leaves it intact. This satisfies the rule that once set, the field is never cleared or overwritten.

### archiveDoneTickets Behavior

archiveDoneTickets (lines 310-341) calls moveTicket(board.root, ticket.id, "archived", { now }) internally. Because the new moveTicket conditional only writes workCompletedAt when status === "done", transitioning a done ticket to archived will not touch either field. No code change is required in archiveDoneTickets itself. The new test pins this behavior explicitly.

### Auto-Merge Closeout Path

The parent story AC mentions an autoMerge closeout path that lands tickets in done. Inspection of src/git.js: autoMergeTicketBranch (lines 53-84) does NOT call moveTicket and does NOT change ticket status. The status flip to done happens via a separate local-board move id done call from the closeout workflow. Therefore, the moveTicket change alone covers the auto-merge case. There is no additional write site to touch. Confirm during implementation by re-grepping for any direct callers that set status: "done" outside moveTicket. None found at design time.

### Test Plan

Add tests using the existing withBoard helper and deterministic now injection.

1. start-work sets workStartedAt on first invocation and is idempotent on subsequent calls. Lives in test/git.test.js because it must exercise startTicketWork against a real git repo (follow existing git.test.js patterns). Create a ticket, call startTicketWork with now: new Date("2026-05-16T15:37:00Z"), assert workStartedAt equals "2026-05-16T15:37:00Z". Call startTicketWork again with a later now, assert workStartedAt is unchanged.
2. moveTicket to done stamps workCompletedAt. Lives in test/tickets.test.js. Create a ticket in ready_for_docs, advance through any required completeStep calls per the existing strict-routing pattern at line 429, then moveTicket(root, id, "done", { now }). Assert workCompletedAt equals the ISO of now and updated matches.
3. moveTicket out of done then back into done does not overwrite workCompletedAt. Same setup as test 2. After moveTicket to done with now t1, move to ready_for_review (allowed via moveTicket), then back to done with now t2. Assert workCompletedAt still equals the ISO of t1.
4. moveTicket to done on a ticket that already has workCompletedAt does not change it. Pre-seed via the existing replaceText helper to write workCompletedAt: 2026-05-14T22:00:00Z and workStartedAt: 2026-05-14T21:00:00Z (required because of the validator on line 629). Then moveTicket to done with a different now. Assert the field is unchanged.
5. archiveDoneTickets preserves workStartedAt and workCompletedAt. First targeted test of archiveDoneTickets in test/tickets.test.js. Create a done ticket, seed both timestamps via replaceText, and seed updated to be older than the cutoff so archiving fires. Call archiveDoneTickets with archiveDoneAfterDays 0 and a future now. Read the archived ticket from plans/tickets/archive/. Assert both fields match the seeded values exactly.

Notes:
- The ticket-field-ordering test at test/tickets.test.js:600 already pins canonical order including these fields. No new ordering test needed.
- The legacy-omit test at line 757 already verifies readTicket normalizes missing fields to null.

### Risks and Edge Cases

- Race between setTicketField for workStartedAt and the subsequent setTicketField for branch inside startTicketWork. Each rewrites the file. setTicketField re-reads via findTicket fresh on every call, so the second call sees the post-first-call front matter. Safe.
- A user manually editing a ticket to set workCompletedAt before status reaches done. The validator forbids workCompletedAt without workStartedAt but allows it on any status. Our moveTicket change is idempotent and will not overwrite. Acceptable.
- Two new Date() calls drifting across a second boundary: mitigated by computing now once at the top of moveTicket and startTicketWork.
- Clock skew between machines is out of scope.
- Tickets created before T20260516T1543Z lack the fields. The read shim normalizes to null. First start-work after upgrade will stamp workStartedAt. Old tickets that already moved to done will never get a workCompletedAt retroactively. Honest behavior, accepted.
- moveTicket is also used to transition into archived. The conditional guard (status equals "done") prevents the archive transition from writing workCompletedAt to a ticket that never had it set.

### Documentation Impact

- docs/TicketFormat.md and memory-bank/systemPatterns.md already mention workStartedAt and workCompletedAt from T20260516T1543Z. Verify language describes when the fields are written. Tighten to "set automatically by start-work and move done" if it currently reads as "schema reserved".
- docs/Workflow.md: if it documents start-work or move done, add a sentence on the wall-clock side effect.
- No changes expected to memory-bank/projectBrief.md.

### Out of Scope

- The estimate command, calibration auto-pick, and design-step enforcement gate (sibling tasks).
- Pausing the clock during questions or blocked (explicitly excluded by the parent story).
- Backfilling workCompletedAt on already-done tickets.
- Story or epic estimate or duration rollup.

### Suggested Commands

- npm test: expect previous 49 plus 4 new tests in test/tickets.test.js and 1 in test/git.test.js.
- npm run check: lint and format clean.
- npm run validate: board still validates.

## Implementation Notes

Implemented wall-clock plumbing for workStartedAt and workCompletedAt per the Technical Design.

Changes:
- src/tickets.js: exported formatIsoSeconds. In moveTicket, computed now once at the top of the function and reuse it for withUpdated. When status is "done" and workCompletedAt is null and workStartedAt is already a string, stamp workCompletedAt = formatIsoSeconds(now). The extra workStartedAt-is-string guard prevents writing a workCompletedAt that the validator would then reject ("workCompletedAt requires workStartedAt to be set"). This matches the legitimate state space and keeps the existing strict-routing legacy test passing without regressing schema invariants.
- src/git.js: imported formatIsoSeconds from tickets.js. In startTicketWork, computed now once at the top, then after ensureGitBranch succeeds, if workStartedAt is null, write it via setTicketField. The write happens AFTER ensureGitBranch (not before, as the original design wording suggested) because writing the field before the branch check makes the worktree dirty and ensureGitBranch refuses. Order: findTicket -> compute now -> assertBranchName -> ensureGitBranch -> stamp workStartedAt (if null) -> branch write (if changed) -> run-log entry -> moveTicket to implementing (if applicable). The timestamp semantics are preserved because now is captured before any IO.
- archiveDoneTickets and autoMergeTicketBranch were not touched. archiveDoneTickets transitions tickets to "archived", and the moveTicket conditional only fires for status === "done", so neither field is touched on archive.

Tests added:
- test/git.test.js: "startTicketWork stamps workStartedAt on first call and is idempotent thereafter" - first call writes workStartedAt; second call with a later now leaves it unchanged.
- test/tickets.test.js: "moveTicket to done stamps workCompletedAt when null" - seeds workStartedAt, completes required steps, moves to done, asserts workCompletedAt equals now.
- test/tickets.test.js: "moveTicket re-opening and returning to done preserves the original workCompletedAt" - move to done, move to ready_for_review, move back to done with a later now; original workCompletedAt unchanged.
- test/tickets.test.js: "moveTicket to done preserves a pre-existing workCompletedAt" - seeds both timestamps, moves to done with a different now, original timestamp preserved.
- test/tickets.test.js: "archiveDoneTickets preserves workStartedAt and workCompletedAt" - seeds both timestamps and an old updated, runs archive with archiveDoneAfterDays 0, asserts both fields survive the archive transition.

Commands run:
- npm test: 61 passed, 0 failed.
- npm run check: clean.
- npm run validate: Ticket validation OK.

Remaining risks:
- The design specified writing workStartedAt before ensureGitBranch, but this is impossible without an allowDirty override because the write itself dirties the worktree. Capturing now at the top of startTicketWork preserves the intended "stamp when work began" semantics. Documented above.
- moveTicket stamps workCompletedAt only when workStartedAt is already set. Tickets that move directly to done without ever going through start-work (theoretical; strict routing requires implement evidence which comes from start-work in practice) will have workStartedAt null and workCompletedAt null. Acceptable per the schema validator.

## Review Findings

**Verdict:** CONCERNS (soft pass — accepted by orchestrator).

Reviewer: codex-task:read-only (gpt-5.5).

**Confirmed correct:**
- start-work deviation (write after ensureGitBranch instead of before) is justified. Preserves the dirty-worktree refusal in `ensureGitBranch` (src/git.js:95-103). Now-capture is at function top so timestamp accuracy is preserved.
- Idempotence holds: second startTicketWork re-reads ticket and skips non-null workStartedAt (src/git.js:9, :17). Reopen-from-done doesn't clear workCompletedAt; reclose preserves it (src/tickets.js:285-291).
- archiveDoneTickets correctly bypasses the completion write path (calls moveTicket with "archived", not "done").
- autoMergeTicketBranch does not touch either lifecycle timestamp.
- 5 new tests cover happy paths.

**Concern (medium, accepted as documented behavior):**
- moveTicket only stamps workCompletedAt when workStartedAt is already a string (src/tickets.js:286-291). Direct move-to-done on a ticket that never had start-work leaves both fields null.

**Orchestrator decision:** This is the correct behavior. A ticket that never had start-work has no meaningful "work started" timestamp, and the validator invariant (workCompletedAt requires workStartedAt) must be preserved. Leaving both null is the honest semantics. Documented here for future readers; not gating.

Codex could not re-run tests in read-only sandbox; review based on diff and source inspection.

## Test Evidence

Verified commit 7503676 plus follow-on commit 74f0a79 (this ticket).

### Commands run

- npm test: 62 passed, 0 failed (was 61 before adding the new edge-case test).
- npm run check: clean (node --check on all source files).
- npm run validate: Ticket validation OK.

### Acceptance Criteria coverage

- First start-work stamps workStartedAt to ISO-8601: covered by test/git.test.js "startTicketWork stamps workStartedAt on first call and is idempotent thereafter" - asserts workStartedAt = 2026-05-16T15:37:00Z after first call.
- start-work idempotent on subsequent calls: same test, second invocation with a later injected now leaves workStartedAt unchanged.
- move done stamps workCompletedAt when null: test/tickets.test.js "moveTicket to done stamps workCompletedAt when null".
- Reopen then move done preserves original workCompletedAt: test/tickets.test.js "moveTicket re-opening and returning to done preserves the original workCompletedAt".
- Pre-existing workCompletedAt preserved on subsequent move done: test/tickets.test.js "moveTicket to done preserves a pre-existing workCompletedAt".
- archiveDoneTickets does not touch either field: test/tickets.test.js "archiveDoneTickets preserves workStartedAt and workCompletedAt".
- autoMerge closeout path setting workCompletedAt: covered transitively because autoMergeTicketBranch does not change status; the closeout move done call funnels through moveTicket and hits the new conditional. No new test added (design confirms no direct autoMerge write site).

### New edge-case test (commit 74f0a79)

- test/tickets.test.js "moveTicket directly to done with workStartedAt null leaves both timestamps null" - locks in the orchestrator-accepted behavior from review: moveTicket only stamps workCompletedAt when workStartedAt is already a string, preserving the validator invariant that workCompletedAt requires workStartedAt to be set.

### Spot-check notes

- The five implementation tests use deterministic now injection (via the options.now parameter) and the existing withBoard/withRepo helpers, matching project conventions.
- replaceText-seeded workStartedAt values feed the validator correctly; assertions use anchored multiline regex matches on the rendered front matter.
- archiveDoneTickets test reads from plans/tickets/archive/ which is the correct post-archive folder.

### Gaps and caveats

- No automated test for the autoMerge closeout path stamping workCompletedAt. Design correctly notes autoMergeTicketBranch does not call moveTicket directly; the stamp comes from the surrounding move done invocation. Acceptable based on read-through of src/git.js.
- Tests run on Windows (current host); a CRLF warning was emitted on commit but file content is preserved as LF.
- Ambient state caveat: the working tree had unrelated ticket folder moves (T20260516T1543Z, T20260516T1550Z, T20260516T1544Z) in plans/tickets/ at verification time. Not modified by this run. Only test/tickets.test.js was committed in 74f0a79.

## Documentation Updates

Updated in commit b21e26c:

- `memory-bank/systemPatterns.md` — added one-line note that start-work stamps workStartedAt once; move done stamps workCompletedAt when workStartedAt is set; archive does not touch them.
- `docs/Workflow.md` — documented the wall-clock work tracking behavior: when each field gets set, idempotence rules, direct-move-to-done edge case (both stay null), and that wall-clock = `workCompletedAt - workStartedAt` includes time in `questions` and `blocked` by design.
- `docs/TicketFormat.md` — small note added on when the fields get set automatically.

Author: codex-task:workspace-write (gpt-5.5). Codex sandbox blocked .git writes; orchestrator committed.

## Questions

## Run Log

- 2026-05-16T16:51:28Z: Completed design via claude-subagent:local-board-designer: Technical Design written. Uses existing formatIsoSeconds for timestamps; startTicketWork (src/git.js) sets workStartedAt via setTicketField when null; moveTicket (src/tickets.js) sets workCompletedAt when status becomes done and field is null. archiveDoneTickets and autoMergeTicketBranch do not touch these fields. Test plan covers idempotence, reopen, archive preservation.

- 2026-05-16T16:51:28Z: Ensured git branch feature/estimation-and-specialty-steps (already-current).

- 2026-05-16T16:55:27Z: Completed implement via claude-subagent:local-board-implementer: Implemented in commit 7503676. src/git.js startTicketWork stamps workStartedAt after ensureGitBranch (design tweak to avoid dirty-worktree race). src/tickets.js moveTicket stamps workCompletedAt at start when target=done and field is null. formatIsoSeconds exported. 5 new tests; npm test 61/61; check + validate clean.

- 2026-05-16T16:58:03Z: Completed review via codex-task:read-only: Codex review of commit 7503676. Verdict: CONCERNS — soft pass. start-work deviation justified, idempotence correct, archive/auto-merge interactions correct. Concern: direct move-to-done without start-work leaves both timestamps null (preserves validator invariant). Accepted as documented behavior. Advancing.

- 2026-05-16T17:02:00Z: Completed test via claude-subagent:local-board-tester: npm test: 62/62 after adding edge-case test for direct-move-to-done semantics (commit 74f0a79). All AC verified to test locations. npm run check and validate clean. Wall-clock plumbing locked in.

- 2026-05-16T17:03:52Z: Completed document via codex-task:workspace-write: Doc updates in commit b21e26c: memory-bank/systemPatterns.md, docs/Workflow.md (new Wall-clock work tracking section), docs/TicketFormat.md (auto-set notes). README untouched.
