---
id: B20260710T2050Z
type: bug
status: implementing
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/B20260710T2050Z-design-review-fallback-free-claude-subagent-dispatch-is-rejected-by-the-routing-validator-hook-d7-carve-out
estimate: 2
estimateBasis: B20260710T1533Z
workStartedAt: 2026-07-11T20:04:07Z
workCompletedAt: null
created: 2026-07-10T20:50:02Z
updated: 2026-07-11T20:04:07Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "design-review:codex-task:read-only@gpt-5.6-sol"]
routingApprovals: []
---
# design-review: fallback-free claude-subagent dispatch is rejected by the routing-validator hook (D7 carve-out)

## Requirement

Carved out of T20260710T1532Z (design decision D7, 2026-07-10). A board may validly route agents["design-review"] to a claude-subagent (e.g. claude-subagent:local-board-reviewer). Today commandDesignReviewCheck stamps an active-steps ledger record ONLY when the resolved profile carries a non-empty fallbackModels list (the D6 conditionality rule). For a fallback-FREE claude-subagent design-review profile, no record is stamped, so the routing-validator hook's check-dispatch falls back to the ticket's status action and rejects the reviewer dispatch as an agent mismatch. The default codex-task route is unaffected (Bash dispatches are not hook-gated).

### Scope

1. Stamp the design-review action record in commandDesignReviewCheck for claude-subagent routes unconditionally (drop the fallback-configured condition for the stamp itself), reusing the existing stampActiveStepNoClobber identity semantics and recordDesignReview's identity-scoped clear. The fallbackModels FIELD on the record stays conditional per D6.
2. Byte-identical back-compat carve: codex-task design-review routes still stamp nothing; boards whose design-review profile is codex-task (the scaffold default) are unchanged.
3. Tests: claude-subagent design-review profile without fallbacks -> design-review-check stamps -> check-dispatch accepts the pinned model and rejects others; codex-task route stamps nothing (legacy-shape deep-equal); recordDesignReview still clears the stamp.

### Acceptance criteria

- A board with agents["design-review"] = { route claude-subagent:local-board-reviewer, model opus } passes check-dispatch for that reviewer after design-review-check, with hooks installed.
- Scaffold-default (codex-task) boards byte-identical.
- npm run check and node --test pass.

### Non-goals

- No change to the D6 conditionality of fallback FIELDS; no new CLI commands.

## Acceptance Criteria

## Related Tickets

## Technical Design

### Root cause

`commandDesignReviewCheck` (`src/cli.js`, ~L1377-1397) gates the design-review
ledger stamp on TWO conditions: the route is `claude-subagent:` AND
`designReviewFallbackModels` is a non-empty list. The second clause is the D7
bug. A fallback-free claude-subagent design-review profile writes no stamp, so
`checkDispatchForTicket` (`src/active-steps.js` L225-285) finds no record for the
ticket and takes the no-ledger branch: it resolves the ticket's *status* action
via `resolveExpectedStep` (the ticket's status action is `design`, routed to the
scaffold default), and the reviewer dispatch is rejected `agent-mismatch`.

The fix is a one-line loosening of the stamp guard plus a shape adjustment so the
`fallbackModels` FIELD stays D6-conditional. This mirrors the already-correct
pattern in `beginStep` (`src/tickets.js` L1426-1437), which stamps an
`action` record unconditionally and spreads `fallbackModels` only when non-empty.

### Approach

In `commandDesignReviewCheck`, change the stamp guard from

```js
if (
  typeof profile.route === "string"
  && profile.route.startsWith("claude-subagent:")
  && designReviewFallbackModels
) {
```

to drop the trailing `&& designReviewFallbackModels` clause:

```js
if (typeof profile.route === "string" && profile.route.startsWith("claude-subagent:")) {
```

and change the record's `fallbackModels: designReviewFallbackModels,` line to the
same D6-conditional spread `beginStep` already uses:

```js
...(designReviewFallbackModels ? { fallbackModels: designReviewFallbackModels } : {}),
```

Everything else in the stamp block is unchanged: it keeps using
`stampActiveStepNoClobber` (no-clobber identity semantics) and the non-fatal
`describeLedgerStampConflict` warning on conflict. The `designReviewFallbackModels`
local (L1377-1378) and the separate `designReviewFallbackBundle` payload logic
(L1418-1430) are untouched -- the fallback BUNDLE in the JSON payload stays
D5/D6-conditional, and only the ledger stamp is now unconditional for
claude-subagent routes.

codex-task routes: `profile.route.startsWith("claude-subagent:")` is false, so
the block is skipped and nothing is stamped -- byte-identical to today.

### Record shape (fallback-free claude-subagent case)

The stamp carries exactly these keys, with no `fallbackModels` key present:

```json
{
  "ticket": "<ticket-id>",
  "kind": "action",
  "action": "design-review",
  "route": "claude-subagent:local-board-reviewer",
  "model": "sonnet",
  "root": "<abs worktree root>",
  "ts": "<iso-seconds>"
}
```

This key set is byte-identical to a fallback-free `beginStep` action stamp
(same seven keys; only the `action` value differs), satisfying the legacy-shape
deep-equal discipline: no new key is added with a null/undefined value. When
`profile.model` is undefined the `model` key is `null` (existing `?? null`),
matching `beginStep`. The fallback-configured case is unchanged: it additionally
carries `fallbackModels: [...]` exactly as today.

### Downstream correctness (no other code changes)

- `checkDispatchForTicket`: with the fallback-free stamp present,
  `record.fallbackModels ?? null` -> `null`, so `modelAccepted` degenerates to
  `modelSatisfies`. The pinned `model` is accepted, a wrong model is rejected
  `model-mismatch`, and a different local-board agent is rejected `agent-mismatch`
  (expected.agent = `bareRoute(route)` = `local-board-reviewer`). No edit needed.
- `stampActiveStepNoClobber` / `isIdempotentStampMatch`: compares
  kind/action/stage/route/model. On the fallback-free record `stage` is
  `undefined` on both existing and next (`undefined === undefined`), so a re-run
  is an idempotent match and self-heals -- no spurious conflict.
- `recordDesignReview` (`src/tickets.js` L1690): the identity-scoped clear uses
  `isActionLedgerEntry(record, "design-review")` = `(record.kind ?? "action") ===
  "action" && record.action === "design-review"`. The fallback-free record has
  `kind: "action"`, `action: "design-review"`, so it is cleared unchanged.

### Affected files

- `src/cli.js` -- `commandDesignReviewCheck` stamp guard + record shape (the only
  production edit).
- `test/cli.test.js` -- update the existing D6/D7 "known limitation" test and add
  a new stamp-shape assertion (below).
- `test/active-steps.test.js` -- add the check-dispatch accept/reject cases
  against a fallback-free design-review stamp.

No production edits to `src/active-steps.js` or `src/tickets.js`.

### Test plan

1. `test/cli.test.js` -- REVISE the existing test at ~L1800 ("D6/D7 ... a
   claude-subagent route without fallbackModels ... known limitation"). Its
   ticketId2 branch currently asserts
   `Object.hasOwn(await readActiveSteps(root), ticketId2) === false`. Flip it: the
   fallback-free claude-subagent route now DOES stamp. Assert the stamped record
   deep-equals the fallback-free shape above -- specifically
   `assert.equal(Object.hasOwn(steps[ticketId2], "fallbackModels"), false)` plus
   kind=`action`, action=`design-review`, route=`claude-subagent:local-board-reviewer`,
   model=`sonnet`. Retitle to reflect D7 fixed. The JSON PAYLOAD assertion
   (`out2` deep-equal) stays unchanged -- the payload is still fallback-free and
   byte-identical; only the ledger side effect changed.
2. `test/cli.test.js` -- the codex-task test ("performs no dispatch and stamps
   nothing", ~L1774) and the fallback-free-default `out1` branch stay green
   unchanged, proving codex-task routes still stamp nothing (deep-equal ledger
   unchanged). Optionally strengthen the codex-task case with an explicit
   `assert.deepEqual(after, before)` on the full ledger.
3. `test/cli.test.js` -- the fallback-configured test (~L1884) stays green
   unchanged, proving existing fallback behavior is untouched.
4. `test/active-steps.test.js` -- add a case: hand-write a fallback-free
   design-review ledger record (via `stampActiveStep` or the CLI) for a ticket,
   then `checkDispatch({ agent: "local-board-reviewer", model: <pinned>, ticketId })`
   returns `{ ok: true, reason: "match" }`; a wrong model returns
   `model-mismatch`; a different local-board agent returns `agent-mismatch`; and
   `model` undefined returns `model-unverifiable`.
5. `test/cli.test.js` -- (recordDesignReview clear) a full-pipeline-style case:
   after design-review-check stamps the fallback-free record, run
   `design-review-complete`; assert the ledger entry for the ticket is gone
   (`Object.hasOwn(after, ticketId) === false`). May extend the existing pipeline
   test (~L1623) once its board is reconfigured to a fallback-free claude-subagent
   design-review profile.

### Risks and edge cases

- The primary regression surface is the existing "known limitation" test, which
  encodes the OLD (buggy) no-stamp behavior; it MUST be revised, not left as-is,
  or `node --test` fails. This is expected churn, not a break.
- Scaffold/back-compat: codex-task routes never enter the stamp block, so
  `local-board init` default boards produce a byte-identical ledger (empty for
  this ticket) -- covered by keeping tests 1(out1) and 2 green.
- Concurrency/no-clobber semantics are inherited unchanged from
  `stampActiveStepNoClobber`; the fallback-free `stage: undefined` idempotency is
  the same shape `beginStep`/gate stamps already rely on.
- Content-assertion suites: no `plans/prompts/**` or `agents/**` text changes, so
  `npm run sync-resources` is not required. Still run the FULL `node --test` and
  `npm run check` per acceptance.

### Documentation impact

No user-facing behavior change beyond fixing a rejected dispatch. The D7
"known limitation" note in the `commandDesignReviewCheck` comment block
(`src/cli.js` L1366-1376) MUST be rewritten to state the stamp is now
unconditional for claude-subagent routes (fallback FIELD still D6-conditional).
No Memory Bank or `docs/` change is required; if `memory-bank/systemPatterns.md`
references the D7 carve-out limitation, update it to "resolved".

### Open questions

None blocking. Estimation is enabled for this board (`estimation.enabled: true`);
an estimate must be recorded before `complete-step design` -- the orchestrator
owns that transition (this brief forbids front-matter edits, so no estimate is
written here).

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-11T19:59:19Z: Completed design via claude-subagent:local-board-designer@opus: Drop third guard clause in commandDesignReviewCheck so claude-subagent design-review routes stamp unconditionally; fallbackModels field stays D6-conditional via spread; codex routes stamp nothing; fallback-free record = 7-key beginStep shape; tests flip old known-limitation case + checkDispatch accept/reject + recordDesignReview clear.

- 2026-07-11T20:00:19Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: none (internal CLI ledger fix; no UI/auth/attack surface)

- 2026-07-11T20:03:59Z: Design review r1 (codex-task:read-only@gpt-5.6-sol, xhigh): CONCERNS. 1) [Med] byte-identical scaffold claim needs absent-ledger-stays-absent + sentinel-bytes assertions (readActiveSteps maps ENOENT and empty to {}). 2) [Med] one-slot-per-ticket ledger: existing different-action record is neither coexisted-with nor clobbered - command warns, old record stays, dispatch still rejected; document + test premature design-review-check after begin-step design, and post-complete-step path. 3) [Low] second identical design-review-check rewrites record with new ts (not a pure no-op); state accurately + consecutive-call regression test. 4) [Low] update stale 'performs no write of its own' comment for claude-subagent routes. Verdict proceedable; findings folded into implement brief.

- 2026-07-11T20:03:59Z: Recorded design review via codex-task:read-only@gpt-5.6-sol: CONCERNS: 2 Medium (test-plan: absent-ledger assertion, one-slot-per-ticket conflict semantics) + 2 Low (idempotence wording, stale comment); proceed to implementation with findings carried

- 2026-07-11T20:04:07Z: Ensured git branch local-board/B20260710T2050Z-design-review-fallback-free-claude-subagent-dispatch-is-rejected-by-the-routing-validator-hook-d7-carve-out (already-current).
