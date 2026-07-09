---
id: T20260708T2210Z
type: task
status: done
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260708T2210Z-cli-warn-or-refuse-complete-step-review-recorded-before-ready-for-review
estimate: 2
estimateBasis: T20260708T2016Z
workStartedAt: 2026-07-09T00:44:52Z
workCompletedAt: 2026-07-09T01:42:33Z
created: 2026-07-08T22:10:44Z
updated: 2026-07-09T01:42:33Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", review:codex-task:read-only, "test:claude-subagent:local-board-tester@sonnet", gate:test:skipped-empty-catalog, document:codex-task:workspace-write]
routingApprovals: []
---
# cli: warn or refuse complete-step review recorded before ready_for_review

## Requirement

Recording `complete-step <id> review` while the ticket sits at a pre-review status (typically `ready_for_implementation` after a changes_requested loop-back) silently arms a trap: `routing.invalidateOnLoopBack` strips the review token on the later forward move into `ready_for_review`, and the failure only surfaces much later as `move done` refusing with "done ticket is missing completedSteps entry for review". This bit the orchestrator twice in production runs (T20260707T1333Z, T20260707T1335Z); the workaround (record the review disposition only after moving to `ready_for_test`) is convention, not enforcement.

Fix: in `completeStep` (src/tickets.js), when the action is `review` (or any action whose evidence the very next forward transition would invalidate) and the ticket's current status is upstream of that action's stage, either refuse with a message naming the correct ordering, or warn and record a Run Log note. Prefer refuse-with-clear-message for consistency with the other strict-routing guards; allow `--override --reason` as the escape hatch like `enforceTransitions`.

## Acceptance Criteria

- `complete-step <id> review` at `ready_for_implementation`/`implementing` (post loop-back) exits non-zero with a message naming the ordering rule and the earliest status where the evidence will survive.
- `--override --reason "..."` records anyway and appends the reason to the Run Log.
- The guard generalizes from the transitions/invalidation config rather than hardcoding `review` (test evidence recorded before `ready_for_test` gets the same treatment).
- Existing legal orderings (review recorded at `ready_for_review`/`reviewing`/`ready_for_test` or later) are unaffected; full suite stays green.
- Tests cover: refusal, override path, and the legal-ordering no-op.

## Acceptance Criteria

## Related Tickets

## Technical Design

Guard `complete-step` at write time so evidence that a still-pending forward
move would strip is refused (with an `--override --reason` escape hatch),
instead of surfacing much later as a `move done` failure. The guard is derived
from the *same* invalidation relation the loop-back stripper uses, so the two
cannot drift.

### Root cause (why the trap exists)

`moveTicket` runs `invalidateDownstreamEvidence` on every move whose target is a
`TRIGGER_STATUSES` (`ready_*`) status, not just backward moves. A move into
target `S` strips any completedSteps/routingApprovals token whose *producing
status* ranks at-or-downstream of `S`:
`pipelineRank(producing) <= pipelineRank(target)` (see
`invalidateDownstreamEvidence` / `producingStatusForToken` in `src/tickets.js`;
lower `pipelineOrder` rank = closer to done).

For the `review` token, producing status is `ready_for_review` (rank 2 in the
default `pipelineOrder`). Recording `complete-step review` while the ticket sits
upstream (e.g. `ready_for_implementation`/`implementing`, rank 3, after a
`changes_requested` loop-back) arms the trap: the *forward* move into
`ready_for_review` has target rank 2, and `2 <= 2` strips the review token. The
loss only surfaces at `move done`, which refuses with "missing completedSteps
entry for review". This bit the orchestrator in T20260707T1333Z / T20260707T1335Z.

### Guard predicate (derived, not hardcoded)

Add one exported helper in `src/tickets.js`, adjacent to
`invalidateDownstreamEvidence`, reusing its exact building blocks
(`producingStatusForToken`, `invertStatusActions`, `pipelineRankOfStatus`,
`ACTIVE_STATUS_TO_READY`):

```js
// True when recording `token` at the ticket's current status would be stripped
// by a forward move the ticket still has to make. Reuses the SAME relation
// invalidateDownstreamEvidence uses (producing status + pipeline rank) so the
// guard and the stripper cannot drift. The concrete threat is the forward move
// INTO the token's own producing status: the stripper removes any token whose
// producing rank <= target rank, and a move into producingStatus has
// target rank == producing rank, so it always strips. That move is still
// pending exactly when the ticket's current pipeline position is STRICTLY
// upstream of the producing status (higher rank = further from done).
export function evidenceStrippedByPendingForwardMove(ticket, config, token) {
  const producingStatus = producingStatusForToken(token, config, invertStatusActions(config));
  if (producingStatus === null) return { stripped: false };
  const producingRank = pipelineRankOfStatus(producingStatus, config);
  if (producingRank === null) return { stripped: false };
  const currentReady = ACTIVE_STATUS_TO_READY[ticket.status] ?? ticket.status;
  const currentRank = pipelineRankOfStatus(currentReady, config);
  if (currentRank === null) return { stripped: false }; // backlog/questions/blocked/done/archived: no pipeline rank
  return { stripped: currentRank > producingRank, producingStatus };
}
```

Why this is faithful to the stripper (not a parallel re-derivation):

- Producing status is resolved by the *same* `producingStatusForToken` the
  stripper filters on, so mandatory actions, optional specialty steps, and any
  future token grammar map identically in both places.
- `currentReady` uses `ACTIVE_STATUS_TO_READY` so a token recorded while in an
  active status (`implementing`, `reviewing`) is judged by the `ready_*` rank it
  will move forward from — the same normalization `resolveStepFromBoard` uses.
- The `null`-rank early-outs mirror the stripper's own defensive "never act on a
  token/status we cannot place" posture: a token recorded at `backlog`,
  `questions`, `blocked`, `done`, or `archived` is never guarded (those never
  loop forward through a `ready_*` trigger under normal flow).

Predicate truth table against the Acceptance Criteria (default config):

| Recorded action | Current status | producing rank | current rank | strictly upstream? | verdict |
| --- | --- | --- | --- | --- | --- |
| review | ready_for_implementation | 2 | 3 | yes | refuse (bug case) |
| review | implementing | 2 | 3 (via ready_for_implementation) | yes | refuse (post loop-back) |
| review | ready_for_review | 2 | 2 | no | allow |
| review | reviewing | 2 | 2 (via ready_for_review) | no | allow |
| review | ready_for_test | 2 | 1 | no | allow |
| test | ready_for_review | 1 | 2 | yes | refuse (generalizes) |
| implement | ready_for_implementation | 3 | 3 | no | allow |

The `allow` rows are safe because the ticket never re-enters the producing
`ready_*` status on its remaining forward path to `done`, so the stripper never
fires on that token.

### Scope: which evidence is guarded

Guard exactly what `completeStep` itself records: **mandatory-action tokens and
optional specialty-step tokens**. Both flow through `stepToken(action, executor)`
and both are placed by `producingStatusForToken` (mandatory via
`invertStatusActions`, specialty via `optionalStepEntry` -> `STAGE_TO_STATUS`),
so the single predicate covers both with no extra code and the specialty case
gets the same protection for free.

**Gate-consultation tokens (`gate:<stage>:<executor>`) are out of scope.**
Justification: (1) they are recorded by a *different* command path
(`gate-complete` -> `recordGateConsultation`/`stampGateToken`), not
`completeStep`, so guarding here does not touch them; (2) gate consultation is
normally recorded as part of the stage's own work, at that stage's status, so
the premature-recording failure mode has not been observed for gate tokens; and
(3) the forward move that *consumes* a gate token is already independently
protected by `routing.requireGateConsultation` (`gateStageForForwardMove`),
which refuses the move when the token is absent rather than silently arming a
late failure. Extending the guard to `gate-complete` is a mechanical follow-up
if that failure mode ever appears; keeping this change surgical avoids touching
the gate path.

### Refusal message

Names the action, the current status, the stripping mechanism, and the earliest
safe status (the producing status), and advertises the escape hatch — matching
the tone of the `enforceTransitions` and `requireGateConsultation` refusals:

```
complete-step <action> refused: recording it now at status <ticket.status> would
be stripped by the forward move into <producingStatus> (routing.invalidateOnLoopBack).
Record <action> evidence at <producingStatus> or later (the earliest status where
it survives). Re-run with --override --reason <text> to record anyway (the reason
is appended to the Run Log), or set routing.guardPrematureEvidence to false to
disable this guard.
```

### `--override --reason` path

Mirror the `enforceTransitions` override machinery, but require a non-empty
reason (as `approve-inline` does — an override with no rationale is not worth
recording):

- `completeStep(root, ticketId, action, executor, evidence, options)` gains
  `options.override` (bool) and `options.overrideReason` (string).
- When `options.override === true`, the guard predicate is not evaluated; the
  token is recorded exactly as today, and a **second** Run Log line is appended
  in the same locked write, after the normal `Completed <action> via ...` line:

  ```
  - <ts>: Premature-evidence override: recorded <action> at <ticket.status>
    ahead of its producing status <producingStatus>: <reason>
  ```

  (`producingStatus` re-resolved via the same helper so the note is accurate; if
  the token cannot be placed, fall back to omitting the "ahead of ..." clause.)
- CLI (`commandCompleteStep`): parse `const override = takeFlag(args, "--override");`
  and `const reason = takeOption(args, "--reason");`. If `override` and
  `reason` is empty/undefined, throw
  `complete-step --override requires --reason <text>`. Pass
  `{ override, overrideReason: reason }` through to `completeStep`. Update the
  usage error string and `printUsage`.

### Config surface

New routing flag `routing.guardPrematureEvidence`, following the established
fallback-false / scaffold-true pattern of `invalidateOnLoopBack`,
`requireGateConsultation`, and `enforceTransitions`:

- `DEFAULT_CONFIG.routing.guardPrematureEvidence = false` (the ENOENT fallback /
  deep-merge base), so a pre-existing board that omits the key keeps today's
  behavior. Read as `config.routing?.guardPrematureEvidence === true`, exactly
  like the sibling flags (no separate normalizer needed — routing booleans are
  not type-validated today, so this stays consistent).
- `defaultConfigJsonc()` scaffold: add `"guardPrematureEvidence": true` with a
  doc comment in the `routing` block, so new boards get the guard on.
- `DEFAULT_CONFIG` header comment: add the bullet documenting the intentional
  false-vs-true divergence, matching the existing bullets.
- `test/config.test.js` guard test
  ("defaultConfigJsonc matches DEFAULT_CONFIG except for documented
  differences"): add `expected.routing.guardPrematureEvidence = true;` and add
  `"routing.guardPrematureEvidence"` to the collapsed `leafDiffPaths` allowlist,
  plus the comment bullet. Without both edits that test fails by design.

Always-on was rejected: it changes the refusal behavior of existing boards on
upgrade, which the entire routing-flag convention exists to prevent.

### Guard placement in `completeStep`

Insert the guard block inside the existing locked read->write span, after the
`validateStepRouting` check and the estimation gate, before `frontMatter` is
built (so a refusal has zero side effects — nothing written, active step not
cleared):

```js
if (config.routing?.guardPrematureEvidence === true && options.override !== true) {
  const check = evidenceStrippedByPendingForwardMove(ticket, config, token);
  if (check.stripped) {
    throw new Error(/* refusal message above */);
  }
}
```

When `guardPrematureEvidence` is false the block is skipped entirely and
`completeStep` is byte-for-byte unchanged (config-off fallback).

### Test plan

`test/tickets.test.js` (completeStep suite), config `guardPrematureEvidence: true`:

1. **Refusal** — ticket at `ready_for_implementation` (and a second case at
   `implementing`); `completeStep(..., "review", ...)` rejects; message names
   `ready_for_review` as the earliest safe status; front matter unchanged, no
   Run Log line, active step not cleared.
2. **Generalization** — same refusal for `test` recorded at `ready_for_review`
   (proves the predicate is config-derived, not hardcoded to `review`); and an
   optional specialty step recorded upstream of its stage is refused too.
3. **Override** — same starting point with `{ override: true, overrideReason }`
   records the token and appends both the `Completed ...` and the
   `Premature-evidence override: ...` Run Log lines.
4. **Legal-ordering no-op** — `review` at `ready_for_review`, `reviewing`, and
   `ready_for_test` all record normally (byte-identical to pre-change output);
   `implement` at `ready_for_implementation` records normally.
5. **Config-off fallback** — with `guardPrematureEvidence` absent/false, the
   refusal case from (1) records normally (no behavior change for existing
   boards).

`test/config.test.js`:

6. Extend the documented-differences guard test (allowlist + collapsed diff).
7. New backward-compat test: `loadConfig` defaults
   `routing.guardPrematureEvidence` to `false` when omitted, and preserves an
   explicit `true`/`false` (mirroring the existing `invalidateOnLoopBack` test).

`test/cli.test.js`:

8. `complete-step --override --reason` plumbs through and records; and
   `--override` without `--reason` errors with the usage message.

Full suite must stay green.

### Files touched

- `src/tickets.js` — new exported `evidenceStrippedByPendingForwardMove`
  helper; guard block + override Run Log line in `completeStep`; new
  `options.override` / `options.overrideReason`.
- `src/cli.js` — `commandCompleteStep` parses `--override`/`--reason`, validates
  the pairing, passes them through; usage error string + `printUsage` updated.
- `src/config.js` — `DEFAULT_CONFIG.routing.guardPrematureEvidence = false`;
  scaffold `"guardPrematureEvidence": true` with doc comment; header-comment
  bullet.
- `test/config.test.js` — allowlist + collapsed-diff update; new
  backward-compat default test.
- `test/tickets.test.js`, `test/cli.test.js` — scenarios above.

### Documentation impact

- `memory-bank/systemPatterns.md` — add `routing.guardPrematureEvidence` to the
  routing-flags list alongside `invalidateOnLoopBack` /
  `requireGateConsultation` / `enforceTransitions`, noting it guards
  `complete-step` at write time using the same invalidation relation.
- `docs/` routing/config reference (wherever the sibling flags are documented)
  — document the flag, the refusal, and the `--override --reason` escape hatch.
  Update the README Documentation Index only if a new doc file is added
  (none expected).

### Risks / edge cases

- **Drift is the primary risk and is designed out**: the guard imports the
  stripper's own `producingStatusForToken` + `pipelineRankOfStatus`, so a future
  change to the invalidation relation moves both together. A regression test
  asserting refusal for the exact stripper-stripped case is the backstop.
- Active-status recording (`implementing`/`reviewing`) is normalized via
  `ACTIVE_STATUS_TO_READY`; confirmed by the two-case refusal test.
- Non-pipeline current statuses (`backlog`/`questions`/`blocked`) yield a null
  rank -> no guard, matching the stripper's no-op on those targets.
- Override with an unplaceable token: the override note omits the "ahead of ..."
  clause rather than throwing.

## Implementation Notes

## Review Findings

Reviewed by codex-task:read-only (gpt-5.5) on the implement commit (worktree).

- [P2] `src/tickets.js:361-363` — `evidenceStrippedByPendingForwardMove` returns `{ stripped: false }` when the current status has no pipeline rank, but `moveTicket` runs `invalidateDownstreamEvidence` for any `ready_*` target (`src/tickets.js:724-725`) and structural transitions allow `backlog`/`questions`/`blocked` → ready statuses. So `review` recorded at `questions`/`blocked`/`backlog` slips past the guard and is stripped by the later forward move — the exact trap the guard exists to close. Treat rankless non-terminal statuses as upstream-of-everything (or derive the answer from the same relation moveTicket uses).
- [P3] `src/tickets.js:1272-1306` — the exported `completeStep` accepts `{ override: true }` without a reason, producing a Run Log override line with an empty reason; the CLI enforces `--override` + `--reason` but the mutation layer should hold the same invariant (throw when override is set and the reason is empty).
- [P3] `src/config.js:876-877` — scaffold comment still says forward moves are never affected by invalidation, contradicting this feature's motivating case. Reword to distinguish ordinary forward moves (no downstream evidence) from premature evidence that a forward move strips.

Checked and passing: active statuses handled via ACTIVE_STATUS_TO_READY; ranked ready statuses line up; config plumbing matches the requireGateConsultation pattern; tests cover the production trap for ranked statuses.

Verdict: changes_requested

## Test Evidence

Verified by claude-subagent:local-board-tester (sonnet), in the ticket worktree.

### Automated checks

| Command | Result |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS — 427 tests, 426 pass, 0 fail, 1 skipped; all 12 new guard tests present |
| `npm run validate` | PASS — Ticket validation OK |

### Live probes (throwaway scaffolded board in scratchpad; generated config confirmed `guardPrematureEvidence: true`)

- (a) Production trap: `complete-step review` at ready_for_implementation → refused exit 2 with a message naming the stripping move, the earliest safe status (ready_for_review), the override, and the config switch. `--override --reason "test"` → recorded + Run Log override line naming action, status, producing status, and reason. PASS.
- (b) Current-stage evidence (`complete-step implement` at ready_for_implementation) → no refusal. PASS.
- (c) Rankless: review at `questions` → refused. PASS.
- (d) Config-off: exercised the DEFAULT_CONFIG fallback (guardPrematureEvidence false) → same premature recording proceeds silently. PASS.
- (e) `--override` without `--reason` → exit 2, clear message. PASS.

### Guard vs stripper shared logic

`evidenceStrippedByPendingForwardMove` (tickets.js:356) and `invalidateDownstreamEvidence` (:299) both resolve through the same `producingStatusForToken` (:272) + `pipelineRankOfStatus` (:250) helpers — no parallel relation logic. One intentional, commented asymmetry: the guard treats rankless non-terminal statuses as always-upstream (refuses) while the stripper no-ops on moves INTO rankless statuses; consistent with tests on both sides.

### Docs

docs/Workflow.md "Premature-evidence guard" (370-378) matches live message formats byte-for-byte; memory-bank/systemPatterns.md correctly states the DEFAULT_CONFIG(false)/scaffold(true) split.

### Caveats

Probe (d) used the config ENOENT-fallback path rather than hand-editing JSONC (tester has no Write tool); same code path and value. Throwaway board deleted; worktree clean of tester changes.

Result: pass

## Documentation Updates

Documented by codex-task:workspace-write (gpt-5.5). Primary docs (Workflow.md guard subsection, systemPatterns facts) shipped at implement. Closing audit: Workflow.md stale evidence-ordering language tightened (silent stripping described as the pre-guard failure mode); README complete-step line gained [--override --reason <text>] matching existing granularity; systemPatterns guard fact verified terse.

## Questions

## Run Log

- 2026-07-09T00:44:52Z: Ensured git branch local-board/T20260708T2210Z-cli-warn-or-refuse-complete-step-review-recorded-before-ready-for-review (already-current).

- 2026-07-09T00:51:22Z: Completed design via claude-subagent:local-board-designer@opus: Guard reuses producingStatusForToken + pipelineRankOfStatus (no drift); mandatory+specialty tokens; routing.guardPrematureEvidence fallback-false/scaffold-true; override path; estimate 2 basis T2016

- 2026-07-09T00:53:30Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (internal workflow guard)

- 2026-07-09T00:53:31Z: Ensured git branch local-board/T20260708T2210Z-cli-warn-or-refuse-complete-step-review-recorded-before-ready-for-review (already-current).

- 2026-07-09T01:06:18Z: Completed implement via claude-subagent:local-board-implementer@sonnet: evidenceStrippedByPendingForwardMove helper reusing stripper internals; guard + override/reason + Run Log note; config flag fallback-false/scaffold-true; 8 tests; 423 pass + 1 skip

- 2026-07-09T01:08:25Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (internal workflow machinery)

- 2026-07-09T01:12:44Z: Invalidated downstream evidence on loop-back to ready_for_implementation: removed completedSteps [implement:claude-subagent:local-board-implementer@sonnet, gate:implement:claude-subagent:local-board-gatecheck@haiku].

- 2026-07-09T01:12:44Z: Ensured git branch local-board/T20260708T2210Z-cli-warn-or-refuse-complete-step-review-recorded-before-ready-for-review (already-current).

- 2026-07-09T01:19:12Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Rework: backlog/questions/blocked treated upstream-of-everything via CLOSED_STATUSES distinction; completeStep throws on override without reason; scaffold comment reworded; 4 new tests; 426 pass + 1 skip

- 2026-07-09T01:20:54Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (internal machinery rework)

- 2026-07-09T01:20:55Z: Completed review via codex-task:read-only: changes_requested (3 findings: rankless false-negative, API reason invariant, scaffold comment) on impl commit; addressed in rework; recorded post-move per evidence-invalidation ordering

- 2026-07-09T01:29:26Z: Completed test via claude-subagent:local-board-tester@sonnet: 426 pass + 1 skip; 5 live probes (trap refusal+override, current-stage legal, rankless refusal, config-off legacy, CLI reason error) all pass; guard/stripper share helpers

- 2026-07-09T01:42:32Z: Completed document via codex-task:workspace-write: Workflow tightened, README flag added, systemPatterns fact verified
