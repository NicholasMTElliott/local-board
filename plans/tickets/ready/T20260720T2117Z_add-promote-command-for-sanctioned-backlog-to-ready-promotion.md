---
id: T20260720T2117Z
type: task
status: ready_for_design
priority: P1
parent: null
children: []
blockedBy: []
blocks: [T20260720T2118Z]
branch: local-board/T20260720T2117Z-add-promote-command-for-sanctioned-backlog-to-ready-promotion
estimate: 2
estimateBasis: T20260710T1222Z
workStartedAt: null
workCompletedAt: null
created: 2026-07-20T21:16:06Z
updated: 2026-07-20T22:23:53Z
completedSteps: []
routingApprovals: []
---
# Add promote command for sanctioned backlog-to-ready promotion

## Requirement

### Problem

Backlog -> `ready_*` promotion is structurally allowed by `move` (the `enforceTransitions` allow-set includes "backlog promote"), but nothing computes the CORRECT entry status for a ticket. In the 2026-07-20 `local-team` run the orchestrator had to reverse-engineer the entry-status-per-type rule from config before moving anything, and nothing prevents an orchestrator from promoting a story straight to `ready_for_implementation`, skipping decomposition/design. Promotion is a user-authorized action (see policy ticket T20260720T2118Z) and deserves a first-class, auditable command.

### Requirement

1. New command: `local-board promote <ticket-id> [--to <status>] [--json]`.
   - Default (no `--to`): compute the type-appropriate entry status — derived from config (`workflow.pipelineOrder` / `workflow.statusActions` / `routing.doneRequires`), not hard-coded: e.g. epics/stories with no children enter `ready_for_decomposition`; tasks/bugs enter the first status of their pipeline (`ready_for_design` on the scaffold). Design decides the exact derivation; it must respect boards with customized pipelines.
   - `--to <status>` overrides the target; it must be a trigger (`ready_*`) status, else refuse.
   - Refuse when the ticket is not in `backlog` (message names the current status).
   - Warn (stderr, non-fatal) when the ticket has open `blockedBy` dependencies — promotion is allowed (eligibility gating already keeps it out of the ready queue) but the operator should know.
2. Route the actual transition through the existing `moveTicket` path so folder relocation, `enforceTransitions`, planning auto-commit, and Run Log behavior all apply unchanged.
3. Append a Run Log line recording the promotion and its trigger, e.g. `Promoted backlog -> <status> (user-directed)`.
4. `--json` returns the ticket id, from/to statuses, and computed-vs-overridden target.
5. Add `promote` to the curated CLI command blocks in root `SKILL.md` and the codex mirror (byte-identical; `test/skill-usage-sync.test.js` enforces), and to CLI usage text.

### Acceptance Criteria

- `promote` on a scaffold-config board sends an epic to `ready_for_decomposition` and a task to `ready_for_design` without `--to`.
- `promote --to designing` refuses (not a trigger status); `promote` on a `ready_for_design` ticket refuses (not backlog).
- Open-dependency promotion succeeds with a stderr warning and the ticket stays ineligible in `list --ready`.
- Run Log line present after promotion; front matter status and folder both updated.
- `test/skill-usage-sync.test.js` passes with the updated command blocks; full suite (`node --test`) green.

## Acceptance Criteria

## Related Tickets

## Technical Design

### Summary

Add a first-class `promote` command for a sanctioned, audited backlog -> `ready_*`
transition. `move` already structurally allows the `backlog -> ready_*` jump
(`isStructurallyAllowed`) but computes no correct entry status per type, so an
orchestrator must reverse-engineer the rule and can skip decomposition/design.
`promote` centralizes the derivation, refuses off-policy targets, warns on open
dependencies, and performs the transition — including its audit line and its
source-state precondition — atomically inside `moveTicket`'s existing lock.

This revision reworks the four design-review findings (loop-back FAIL). The
mechanism now hinges on a small, additive options surface on `moveTicket`
(`expectFrom`, `auditComment`) so the source check and the Run Log line land
under the same lock and in the same single write/commit as the relocation, with
zero change to existing callers.

### What changed vs the previous design (loop-back deltas)

- Finding 1 (race): the backlog precondition is now enforced INSIDE
  `moveTicket`'s lock via a new `options.expectFrom`, not by a pre-lock CLI
  check alone. The reported `from` is sound because a successful move guarantees
  the locked read matched `expectFrom`.
- Finding 2 (lossy derivation): `deriveEntryStatus` no longer inverts
  `statusActions` (which loses entries when two statuses share an action).
  It enumerates every `(status, action)` pair, keeps only ranked trigger
  statuses, takes the max pipeline rank, and refuses on an empty candidate set.
- Finding 3 (atomic audit): the promotion Run Log line is appended within the
  locked move mutation via a new `options.auditComment`, so relocation + audit
  are one write and one planning commit. The CLI no longer makes a separate
  `appendTicketComment` call.
- Finding 4 (guard gap): `promote` is added to `REQUIRED_COMMANDS` in
  `test/skill-usage-sync.test.js` so an omission from either SKILL block fails CI.

Kept unchanged (reviewer-verified): the max-`pipelineOrder`-index rule and its
scaffold outcomes (`ready_for_decomposition` for epic/story, `ready_for_design`
for task/bug), the closed-dependency warning semantics matching `isEligible`,
the `--to`/`TRIGGER_STATUSES` validation, the non-backlog refusal messaging, and
the `--json` shape.

### Additive `moveTicket` options surface (minimal, callers unchanged)

Extend `moveTicket(root, ticketId, status, options)` with two optional keys.
Both default to absent, so every existing caller (`commandMove`,
`archiveDoneTickets`, `setTicketField` status path, tests) behaves byte-identically.

1. `options.expectFrom` (string | undefined): when set, evaluated inside the
   existing `withTicketLock` span, immediately after the locked `findTicket`
   read and BEFORE any gate (`enforceTransitions`, gate-consultation,
   design-review) and before any fs mutation. If `ticket.status !== expectFrom`,
   throw a clear error naming the actual locked status and the expected source,
   e.g.:

```text
promote refused: T... is in ready_for_design under lock, not backlog; the ticket
changed state before promotion could run.
```

   Because `moveTicket` performs no fs mutation until the later mkdir/rename
   block, a mismatch has zero side effects. On success the locked read is proven
   to equal `expectFrom`, so the CLI can report `from = expectFrom` soundly —
   this is the "derive the reported from from the locked read" requirement,
   satisfied without changing `moveTicket`'s string return type.

2. `options.auditComment` (string | undefined): when set, append
   `- <iso>: <auditComment>` to the ticket body's `Run Log` section within the
   same locked mutation, after the loop-back-invalidation append and before
   `renderMarkdownTicket`/write. Reuses the `appendToSection` +
   `formatIsoSeconds(now)` helpers already used by `moveTicket`'s override and
   invalidation branches. This makes the relocation and the audit line a single
   atomic write; the subsequent single `maybeCommitPlanning` therefore commits
   both together and leaves `plans/` clean.

`moveTicket`'s return value stays the target path string. No signature change for
existing callers; the two keys are the only new surface.

### Entry-status derivation (config-derived, non-lossy)

Add an exported pure helper to `src/tickets.js`:

```text
deriveEntryStatus(config, type) -> status | throws
```

Algorithm (no `statusActions` inversion):

1. `required = new Set(config.routing.doneRequires[type] ?? [])`. If empty,
   refuse (cannot derive; `--to` remains the manual path). Name the type.
2. Enumerate EVERY `(status, action)` pair in
   `Object.entries(config.workflow.statusActions)`; keep the `status` of any pair
   whose `action` is in `required`. Enumerating pairs (not inverting) means two
   statuses sharing one action both survive — no overwrite/loss.
3. Filter that candidate set to statuses that are BOTH trigger statuses
   (`TRIGGER_STATUSES.has(status)`) AND ranked in `config.workflow.pipelineOrder`
   (index !== -1). Unranked statuses are discarded here, not silently ranked -1.
4. If the filtered set is empty, refuse with a clear message (no required action
   maps to a ranked trigger status). This closes the all-unranked gap.
5. Return the status with the maximum `pipelineOrder` index. `pipelineOrder` is
   ordered closest-to-done first (verified for both repo config and scaffold), so
   the maximum index is the furthest-from-done pipeline entry point. On the
   scaffold: task/bug -> `ready_for_design`, epic/story -> `ready_for_decomposition`.

This uses all three config keys the requirement names (`doneRequires`,
`statusActions`, `pipelineOrder`) and is robust to duplicate action values,
reordered `doneRequires`, renamed actions, and trimmed pipelines.

### `--to` override validation (unchanged)

- When `--to <status>` is supplied, skip derivation and use it as the target.
- Require `TRIGGER_STATUSES.has(status)`; else refuse before any lock/mutation,
  naming the offending value and stating promotion targets the `ready_*`
  statuses. This makes `promote --to designing` refuse (active, not a trigger).
- No `--override`/`--reason` on `promote`: backlog -> any trigger is in the
  structural allow-set, so `moveTicket` never refuses it under
  `enforceTransitions`. `--to` intentionally permits an off-pipeline-entry
  trigger (e.g. task straight to `ready_for_implementation`); it is the
  sanctioned manual escape and is trigger-validated only. Downstream
  done-gating still protects correctness.

### Non-backlog source refusal (two layers)

- Fast pre-lock CLI check for a friendly message: after `findTicket`, if
  `ticket.status !== "backlog"`, refuse naming the current status:

```text
promote refused: T... is in ready_for_design, not backlog; promote only
promotes backlog tickets.
```

- Authoritative under-lock check: `moveTicket({ expectFrom: "backlog" })` re-checks
  the same condition against the locked read, closing the preflight->move race
  (finding 1). The status is read from front matter (canonical), not folder.

### Open-dependency warning (stderr, non-fatal) (unchanged semantics)

- From the already-loaded board, a dependency in `ticket.frontMatter.blockedBy`
  is "open" when it is missing or its status is not closed, reusing the exact
  `CLOSED_STATUSES`/`isClosedStatus` semantics `isEligible` uses, so the warning
  and ready-queue eligibility cannot disagree.
- If any are open, print one `WARNING:`-prefixed stderr line naming the open ids
  and stating the ticket stays ineligible in `list --ready` until they close.
  The promotion still proceeds and returns 0.
- Add an exported pure `openBlockers(ticket, byId)` to `src/tickets.js` (testable
  in isolation) rather than reaching into private internals.

### Run Log line (now atomic with the move)

- Passed as `auditComment` to `moveTicket`, recorded within the locked move
  mutation. Text records from/to and the trigger, e.g.:

```text
Promoted backlog -> ready_for_design (user-directed)
```

  Same shape for an overridden target (its chosen status). The machine-readable
  computed-vs-override signal lives in `--json` (`targetSource`), so the Run Log
  line stays simple prose.
- The CLI issues exactly one mutation (`moveTicket`) then one
  `maybeCommitPlanning(root, { ticketId, command: "promote", detail: target })`,
  mirroring `commandMove`. No second write, no separate comment call.

### `--json` output shape (unchanged)

```text
{
  "ticket": "T20260720T2117Z",
  "from": "backlog",
  "to": "ready_for_design",
  "targetSource": "computed",   // or "override" when --to was used
  "path": "<new ticket path>",
  "openBlockedBy": ["T...."]      // present (possibly empty)
}
```

- `from` is `"backlog"`, sound because `expectFrom` proved the locked source.
- `to` is the target; `targetSource` is the required computed-vs-overridden signal.
- `path` is `moveTicket`'s returned target path. `openBlockedBy` mirrors the
  stderr warning for JSON callers. Human mode prints the new path plus the stderr
  warning when applicable, and a non-JSON success line confirming from -> to
  (per the ux_interaction_review Low note).

### Command wiring

- Dispatch branch in `main`, near `move`:
  `if (command === "promote") return await commandPromote(root, args, allowMainRoot);`
- `commandPromote(root, args, allowMainRoot)`:
  1. `const asJson = takeFlag(args, "--json");`
  2. `const to = takeOption(args, "--to");`
  3. `const ticketId = args.shift(); ensureNoArgs(args);`
  4. arg guard: `promote requires: <ticket-id> [--to <status>] [--allow-main-root] [--json]`.
  5. `await assertInvocationRootForTicket(root, ticketId, { allowMainRoot });`
  6. `loadConfig` + `findTicket` (board needed for blocker resolution; config for derivation).
  7. pre-lock backlog refusal (friendly message).
  8. target = `--to` (validated against `TRIGGER_STATUSES`) else
     `deriveEntryStatus(config, ticket.type)`; `targetSource` set accordingly.
  9. compute `openBlockers`; emit stderr warning if non-empty.
  10. `path = await moveTicket(root, ticketId, target, { expectFrom: "backlog",
      auditComment: "Promoted backlog -> " + target + " (user-directed)" });`
  11. `await maybeCommitPlanning(...)`; print JSON or human output.

### Affected files

- `src/tickets.js`: `moveTicket` gains `expectFrom` + `auditComment` handling
  inside the lock; new exported pure `deriveEntryStatus(config, type)` and
  `openBlockers(ticket, byId)`. Export `byTicketId` if the CLI needs it and it
  is not already exported.
- `src/cli.js`: dispatch branch, `commandPromote`, one `USAGE_TEXT` line.
- `SKILL.md` and `skills/codex/local-board/SKILL.md`: one byte-identical command
  line each.
- `test/skill-usage-sync.test.js`: add `promote` to `REQUIRED_COMMANDS`
  (finding 4).
- `test/`: new coverage (see test plan).

### Usage and skill-doc updates

- Add to `USAGE_TEXT` near `move` (drives `usageCommandNames`, so the subset test
  passes once the block matches):

```text
local-board [--root <path>] promote <ticket-id> [--to <status>] [--allow-main-root] [--json]
```

- Add to BOTH curated CLI Commands `sh` blocks, byte-identical, at the same
  position:

```text
local-board promote <ticket-id> [--to <status>] [--json]
```

  `test/skill-usage-sync.test.js` enforces byte-identical blocks, subset-of-usage,
  and (now) required-presence of `promote`.
- No `npm run sync-resources`: that mirrors `plans/prompts` -> `resources/prompts`;
  SKILL files are not prompt resources. Confirm during implementation.

### Risks and edge cases

- `moveTicket` blast radius: `expectFrom`/`auditComment` are additive and
  default-absent, but `moveTicket` is load-bearing. Place the `expectFrom` check
  before all existing gates and the `auditComment` append alongside the existing
  Run Log appends; run the FULL suite, not just guard suites (AGENTS.md).
- Byte-identical SKILL drift remains the top presentation risk; edit both blocks
  identically.
- Custom-config derivation: empty `doneRequires` or all-unranked candidates
  refuse cleanly (finding 2), never crash or pick a wrong status.
- `--to` to a trigger that is not the type's entry point is permitted by design
  (sanctioned override); downstream gating protects correctness.
- `expectFrom` mismatch and `--to` validation both refuse with zero fs side
  effects (pre-mutation), so a refused promote never dirties the tree.

### Test plan

Derivation unit tests (`test/tickets.test.js`):
- Scaffold: `deriveEntryStatus` -> `ready_for_decomposition` (epic, story),
  `ready_for_design` (task, bug).
- Duplicate-action config: two statuses mapping to the same required action —
  assert the furthest-from-done one is chosen (no loss). (finding 2)
- All-unranked config: required actions map only to statuses absent from
  `pipelineOrder` — assert refusal, not a -1 pick. (finding 2)
- Empty/missing `doneRequires[type]` -> refuse.
- Reordered `doneRequires` / renamed `statusActions` still yields the max-rank entry.
- `openBlockers` returns only non-closed (and missing) dependencies.

`moveTicket` unit tests (`test/tickets.test.js`):
- `expectFrom` match (backlog) proceeds and relocates. (finding 1)
- `expectFrom` mismatch (ticket already `ready_for_design`) refuses, names the
  locked status, and leaves the file untouched at its original path. (finding 1)
- `auditComment` lands the Run Log line in the SAME written file as the
  relocation (single write; assert the moved file already contains the line).
  (finding 3)
- Existing callers with neither option behave byte-identically (regression).

Command tests (`test/cli.test.js`), scaffold-config board:
- `promote <epic>` -> `ready_for_decomposition`; `promote <task>` ->
  `ready_for_design`; front matter status AND folder updated; Run Log line present.
- `promote --to designing` refuses (not a trigger); message + no fs change.
- `promote` on a `ready_for_design` ticket refuses (not backlog); message names
  current status + no fs change.
- Open-dependency promote succeeds, prints stderr warning, exits 0, and
  query-ready / `list --ready` still excludes it.
- `--json` asserts `ticket`, `from`, `to`, `targetSource` (computed vs override),
  `path`, `openBlockedBy`.
- `--to <valid trigger>` sets `targetSource: "override"` and lands that status.
- Wrong-root guard honored (`worktrees.guardWrongRoot`) unless `--allow-main-root`.

Git integration test (finding 3, in the git/transition test file that already
exercises `commitPlanningOnTransition`):
- On a `commitPlanningOnTransition` board, `promote` produces ONE commit that
  contains both the ticket relocation (old path deleted, new `ready/` path added)
  and the Run Log promotion line, and leaves `plans/` clean afterward
  (`git status` porcelain empty for `plans/`).

Suite-wide:
- `test/skill-usage-sync.test.js` passes with both blocks updated and `promote`
  in `REQUIRED_COMMANDS`.
- Full `node --test` green (mandatory: curated SKILL text changed).

### Documentation impact

- SKILL.md + codex mirror CLI Commands blocks (required).
- `USAGE_TEXT` (required).
- If a human `docs/` lifecycle page enumerates `move`/backlog promotion, add a
  one-line mention; verify during implementation. Update the README Documentation
  Index only if a new doc file is added (none expected).

### Open questions

1. Epic/story WITH existing children: `promote` still derives
   `ready_for_decomposition` (its only required stage); `--to` is the escape.
   Confirm acceptable or specify alternate routing.
2. Run Log trigger phrase: requirement gives `(user-directed)`; confirm this
   exact wording vs aligning with policy ticket T20260720T2118Z.

## Implementation Notes

## Review Findings

Design review verdict (codex gpt-5.6-sol, xhigh): FAIL. Findings to resolve in the redesign, most severe first:

1. [High] Source-state race: the backlog precondition is checked before moveTicket acquires its ticket lock. A concurrent mutation can move the ticket between preflight and move; moveTicket re-resolves but does not require from === backlog, and a same-target move is structurally allowed, so promote could succeed and falsely log "backlog -> ready_for_design" for an already-ready ticket. Fix: add an expected-source precondition evaluated inside moveTicket's existing lock (e.g. an options.expectFrom), derive the reported "from" from that locked read, and add a race/precondition test.

2. [High] Lossy derivation: inverting workflow.statusActions is lossy — action values are not validated unique, so two statuses producing the same action overwrite each other and can select a status that is not furthest from done. Statuses absent from pipelineOrder get index -1 and the proposed failure handling does not reject an all-unranked candidate set. Fix: enumerate every (status, action) pair matching a required action, keep only ranked trigger statuses, pick the maximum rank, refuse when none remain. Add duplicate-action and all-unranked custom-pipeline tests.

3. [Medium] Non-atomic audit: move and Run Log append are separate locked writes; a comment failure leaves the ticket promoted with no audit line and skips maybeCommitPlanning (dirty planning tree on commitPlanningOnTransition boards). Fix: append the promotion audit entry within the locked move mutation (single commit), and add a git integration test asserting the promotion commit contains both the relocation and the Run Log line with plans/ clean afterward.

4. [Medium] Guard gap: test/skill-usage-sync.test.js REQUIRED_COMMANDS does not include promote — both SKILL blocks could omit it and still pass. Fix: add promote to REQUIRED_COMMANDS (or a direct presence assertion).

Verified as correct by the reviewer (keep as-is): pipelineOrder is closest-to-done-first in both repo config and scaffold, so max-index derivation yields ready_for_decomposition for epic/story and ready_for_design for task/bug; closed-dependency warning semantics match isEligible; acceptance-criteria command cases otherwise covered.

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-20T22:06:37Z: Completed design via claude-subagent:local-board-designer@opus: Technical Design written: deriveEntryStatus(config,type) inverts statusActions over doneRequires and picks furthest-from-done pipeline status; --to validated against TRIGGER_STATUSES; non-backlog refused; stderr open-dep warning; transition via moveTicket; Run Log line; JSON shape; SKILL blocks + usage updated

- 2026-07-20T22:07:52Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: ux_interaction_review (new CLI command flow); no security/UI triggers

- 2026-07-20T22:08:20Z: Completed ux_interaction_review via inline: CONCERNS: refusal/warning/json flows consistent with CLI conventions; Low: no batch promote form (per-ticket loop acceptable v1); Low: ensure non-json success output confirms from->to transition

- 2026-07-20T22:19:27Z: Recorded design review via codex-task:read-only@gpt-5.6-sol: FAIL: High - backlog precondition raced (checked pre-lock; moveTicket must enforce expected-source under its lock); High - statusActions inversion lossy on duplicate actions + unranked statuses not refused; Medium - Run Log append not atomic with move (comment failure leaves promoted ticket unaudited, planning dirty); Medium - skill-usage-sync REQUIRED_COMMANDS lacks promote

- 2026-07-20T22:19:49Z: Invalidated downstream evidence on loop-back to ready_for_design: removed completedSteps [design:claude-subagent:local-board-designer@opus, gate:design:claude-subagent:local-board-gatecheck@haiku, ux_interaction_review:inline, design-review:codex-task:read-only@gpt-5.6-sol].
