---
id: T20260707T1332Z
type: task
status: ready_for_implementation
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: 2
estimateBasis: T20260707T1331Z
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T13:32:54Z
updated: 2026-07-08T00:00:27Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
routingApprovals: []
---
# cli: fix the begin-step before start-work ordering footgun

## Requirement

Two skills devote paragraphs to a CLI-created footgun: `start-work` moves `ready_for_implementation -> implementing`, and `implementing` has no `statusActions` entry, so a later `begin-step` fails with "no configured action". Skills must warn to run `begin-step` before `start-work` for the implement step (`SKILL.md:110-118`, `SKILL_TEAM.md:110-113`, codex skill equivalent).

Fix in the CLI so the prose warnings can be deleted: map active statuses to their stage action in `statusActions` resolution (`implementing -> implement`, and likewise `designing`/`reviewing`/`testing` if affected), or have `start-work` return the resolved step profile itself.

Acceptance: `begin-step` succeeds regardless of ordering around `start-work`; the ordering warnings are removed from all skill texts.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Root cause

`resolveStepFromBoard` (`src/tickets.js:741`) — the shared core of `begin-step`
(`beginStep`) and `check-dispatch` (`resolveExpectedStep`) — resolves the action as:

```js
const action = actionOverride ?? config.workflow.statusActions[ticket.status] ?? null;
```

`config.workflow.statusActions` only keys the six `ready_*` statuses. The four
active statuses (`designing`, `implementing`, `reviewing`, `testing`) have no
entry, so `action` is `null` and the function throws
`ticket <id> has no configured action for status <status>`.

`start-work` (`src/git.js:29-31`) moves `ready_for_implementation → implementing`,
so a `begin-step` run *after* `start-work` hits exactly this throw. Today three
skill files carry paragraphs telling the orchestrator to resolve before
`start-work` (or pass `--action`). This ticket removes the footgun in the CLI so
those paragraphs can be deleted.

## Approach

Add an active-status → ready-status fallback to the action resolution, derived
from the existing active/ready pairing already encoded in `GATE_FORWARD_TRANSITIONS`
(`src/tickets.js:80-84`), extended to include the review stage.

1. Add a module-level map next to `STAGE_TO_STATUS` (`src/tickets.js:126`):

   ```js
   // Active in-flight statuses have no statusActions entry of their own; they
   // resolve their action through the ready_* status they were promoted from,
   // so `begin-step` works before OR after `start-work` moves the ticket into
   // its active status. Kept structural (not config-derived) for the same
   // reason as STAGE_TO_STATUS: the active<->ready pairing is fixed regardless
   // of how a config renames its mandatory actions.
   const ACTIVE_STATUS_TO_READY = {
     designing: "ready_for_design",
     implementing: "ready_for_implementation",
     reviewing: "ready_for_review",
     testing: "ready_for_test",
   };
   ```

2. In `resolveStepFromBoard`, resolve through the fallback:

   ```js
   const readyStatus = ACTIVE_STATUS_TO_READY[ticket.status] ?? ticket.status;
   const action =
     actionOverride
     ?? config.workflow.statusActions[ticket.status]
     ?? config.workflow.statusActions[readyStatus]
     ?? null;
   ```

Resolution precedence stays: explicit `--action` override → an explicit
`statusActions` entry for the active status (back-compat, see below) → the paired
`ready_*` status's configured action → `null` (unchanged error for genuinely
action-less statuses such as `backlog`/`questions`/`blocked`/`done`).

Deriving the action via `config.workflow.statusActions[readyStatus]` (rather than
hardcoding `"implement"` etc.) means a config that renames a mandatory action is
respected automatically — the same principle the `invertStatusActions` /
`STAGE_TO_STATUS` split already follows.

### Why `resolveStepFromBoard` only (scope)

Placing the fallback in the shared core fixes both `begin-step` and
`check-dispatch` consistently, which is desirable: `check-dispatch` verifies a
Task dispatch against a ticket that is, by definition, already in its active
status. `actionRecord` (`src/tickets.js:1573`, backing `query-next` /
`query-ticket` / `list --ready`) is deliberately left unchanged — it still
returns `action: null` for active statuses. Active tickets are not eligible for
the ready queue, so `query-next`/`list --ready` never surface them; only a direct
`query-ticket <active-id>` would show `action: null`. Changing that output is a
skill-contract change beyond this ticket's acceptance and is called out as an
open question, not done here.

## Back-compat

The fallback is reached only when `config.workflow.statusActions[ticket.status]`
is `undefined`. A board that *explicitly* maps an active status to an action
still wins outright (the middle `??` clause). The change only ever converts a
current hard error into a successful resolution — no configuration that succeeds
today changes behavior. No `transitions`, eligibility, folder, or routing logic
is touched.

## Active-step ledger interaction (T20260707T1325Z)

`beginStep` unconditionally `stampActiveStep`s after resolving
(`src/tickets.js:800`). With this fix an `implementing`-status `begin-step` now
resolves instead of throwing, so it will also stamp the active-step ledger. This
is harmless and desirable: the stamp is idempotent (re-stamp overwrites with the
same `{ticket, action, route, model, root, ts}`), and it means a resolve-after-
`start-work` ordering now records the same in-flight step a resolve-before would
have.

## Affected files

- `src/tickets.js` — add `ACTIVE_STATUS_TO_READY`; extend the action resolution
  in `resolveStepFromBoard`. This is the only production change.
- `SKILL.md:122` — delete the "Run `begin-step` … **before** `start-work` …
  fails with 'no configured action'" paragraph; the surrounding Branch Discipline
  prose (`start-work` behavior) stays. Replace with one sentence, e.g.: "`begin-step`
  resolves the action whether the ticket is still `ready_for_implementation` or
  already `implementing`, so it may run before or after `start-work`."
- `SKILL_TEAM.md:113-116` — delete the "Ordering matters …" note in the Dispatch
  step; simplify the `begin-step`/`start-work` mention. Also relax the Refill line
  (`SKILL_TEAM.md:147`) that reiterates "`begin-step` before `start-work`".
- `skills/codex/local-board/SKILL.md:111` — delete "and `implementing` has no
  configured action"; step 2 (line 52) "before `start-work`" ordering can be
  softened to just "run `begin-step` to resolve the profile".
- `docs/PerStepOrchestration.md:348-354` — this is a retrospective narrative of a
  past run. Update refinement #1 to note the ordering footgun was since removed in
  the CLI (or strike it), so docs do not re-teach a resolved constraint.

Documentation index / memory-bank need no change (no new doc file; behavior is a
bug fix, not a new feature).

## Test strategy

Extend `test/tickets.test.js` (the home of `beginStep`/`resolveExpectedStep`
coverage):

1. `begin-step` on an `implementing`-status ticket resolves `action: "implement"`
   with the configured agent/model/prompt and does not throw (the core acceptance).
2. Same for `designing → design`, `reviewing → review`, `testing → test`.
3. `resolveExpectedStep` (check-dispatch path) resolves the same action for an
   active-status ticket.
4. Back-compat: a config that explicitly sets `statusActions.implementing` to a
   different action resolves to that explicit action, not the ready fallback.
5. Regression: `begin-step` on the six `ready_*` statuses is unchanged; a
   genuinely action-less status (e.g. `questions`/`blocked`) still throws
   "no configured action".
6. `--action` override still wins over the active-status fallback.
7. Ledger: an `implementing` `begin-step` stamps the active-step ledger (assert
   the stamped record shape) and is idempotent on re-run.

An end-to-end assertion (`start-work` then `begin-step` succeeds) closes the
acceptance loop directly.

## Risks

- Low. Additive fallback in one function; the only observable change is that a
  previously-throwing call now succeeds. No path that succeeds today changes.
- Minor consistency gap (intentional, out of scope): `query-ticket` on an active
  ticket still reports `action: null` while `begin-step`/`check-dispatch` resolve
  it. Flagged as an open question.

## Related tickets

- `T20260707T1325Z` — added the active-step ledger + `check-dispatch`; its
  `resolveExpectedStep`/`stampActiveStep` are the code this fix rides on.
- `T20260707T1327Z` — added `STAGE_TO_STATUS` and the gate `GATE_FORWARD_TRANSITIONS`
  active/ready pairing this design reuses as precedent.
- `T20260516T1544Z` — `start-work` wall-clock plumbing; the `ready_for_implementation
  → implementing` move that creates the footgun lives in `src/git.js`.

## Open questions

- Should `actionRecord` (`query-ticket`/`list --ready`) also resolve an action for
  active statuses for full surface consistency, or is `begin-step`/`check-dispatch`
  sufficient? Kept out of scope per the requirement; resolving it would be a
  follow-up ticket because it changes a documented query-output contract.

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-07T23:59:41Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): ACTIVE_STATUS_TO_READY fallback in resolveStepFromBoard (explicit config wins), shared by begin-step and check-dispatch; skill ordering warnings deleted; query-output contract change flagged out of scope. Estimate 2 (basis T20260707T1331Z).

- 2026-07-08T00:00:27Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (CLI ergonomics)
