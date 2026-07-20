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
updated: 2026-07-20T22:06:37Z
completedSteps: ["design:claude-subagent:local-board-designer@opus"]
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

Add a first-class `promote` command that performs a sanctioned, audited
backlog -> `ready_*` transition. Today `move` structurally allows the
`backlog -> ready_*` jump (`isStructurallyAllowed`), but nothing computes the
correct entry status per ticket type, so an orchestrator has to reverse-engineer
the rule and can promote a story straight past decomposition/design. `promote`
centralizes that derivation, refuses off-policy targets, warns on open
dependencies, and routes the real transition through `moveTicket` so folder
relocation, `enforceTransitions`, planning auto-commit, and loop-back handling
stay unchanged.

The command is deliberately thin: one new pure derivation helper in
`src/tickets.js`, one new `commandPromote` in `src/cli.js`, one usage line, and
the two curated SKILL blocks. No change to `moveTicket` itself.

### Related tickets and conflicts

- T20260720T2118Z (this ticket `blocks` it): the policy ticket that declares
  promotion a user-authorized action. `promote` is the mechanism; the policy
  ticket documents the human sanction. No code conflict; keep the "(user-directed)"
  Run Log wording consistent with whatever that ticket lands on if it runs first.
- No other in-flight tickets touch `commandMove` / `moveTicket` / the SKILL CLI
  Commands blocks. The byte-identical SKILL mirror (enforced by
  `test/skill-usage-sync.test.js`) is the only cross-file coupling.

### Entry-status derivation (config-derived, not hard-coded)

Add an exported pure helper to `src/tickets.js`:

```text
deriveEntryStatus(config, type) -> { status } | throws
```

Rule (respects customized pipelines):

1. Take `config.routing.doneRequires[type]` (the ordered action list a type
   needs to reach done: e.g. task/bug = `[design, implement, review, test,
   document]`, epic/story = `[decompose]`).
2. Invert `config.workflow.statusActions` (action -> producing `ready_*` status)
   via the existing `invertStatusActions` pattern.
3. Map each required action to its producing status, dropping any action with no
   producing status (defensive: a custom `doneRequires` action absent from
   `statusActions`).
4. Choose the entry status as the one FURTHEST from done, i.e. the maximum
   `config.workflow.pipelineOrder` index among the mapped statuses
   (`pipelineOrder` is ordered closest-to-done first, so the largest index is the
   pipeline entry point). On the scaffold this yields `ready_for_design` for
   task/bug and `ready_for_decomposition` for epic/story.

Why max-pipelineRank rather than simply `doneRequires[type][0]`: the two agree on
the scaffold, but the pipeline-index approach also produces the correct entry on
a board whose `doneRequires` list is authored out of pipeline order, and it uses
all three config keys the requirement names (`pipelineOrder`, `statusActions`,
`doneRequires`). This reuses the same derivation shape already present in
`typeStatusAdvisory` (`conventionalAction`/`conventionalStatus`), so behavior is
consistent with the create-time advisory.

Failure modes (refuse with a clear, non-throwing CLI error):

- `doneRequires[type]` missing or empty -> cannot derive; refuse and name the
  type. (`--to` remains available as the manual escape.)
- No required action maps to any `statusActions` status -> refuse similarly.

Note on epics/stories with existing children: derivation is type-based, so an
epic that already has children still derives `ready_for_decomposition` (its only
required stage). That is acceptable — the decomposer confirms/no-ops — and the
`--to` override covers any board that wants a different landing. Called out as an
open question below rather than special-cased.

### `--to` override validation

- When `--to <status>` is supplied, skip derivation and use it as the target.
- The target MUST be a trigger status: reuse `TRIGGER_STATUSES.has(status)`
  (exported from `src/tickets.js`). If not, refuse before any fs mutation with a
  message naming the offending value and listing that promotion targets are the
  `ready_*` statuses. This is what makes `promote --to designing` refuse (an
  active status, not a trigger).
- No `--override`/`--reason` plumbing is needed on `promote`: backlog -> any
  trigger is already in the structural allow-set, so `moveTicket` never refuses
  it under `enforceTransitions`. (If a board somehow narrows this, that surfaces
  as a normal `moveTicket` refusal — acceptable.)

### Non-backlog source refusal

- After `findTicket`, if `ticket.status !== "backlog"`, refuse with a message
  naming the current status, e.g.:

```text
promote refused: T... is in ready_for_design, not backlog; promote only
promotes backlog tickets.
```

- This runs before any warning or move, so a refused promote has zero side
  effects. Covers the acceptance case "`promote` on a `ready_for_design` ticket
  refuses".

### Open-dependency warning (stderr, non-fatal)

- Resolve open blockers from the already-loaded board: for each id in
  `ticket.frontMatter.blockedBy`, the dependency is "open" when it is missing or
  its status is not closed. Reuse the exact closed-status semantics
  `isEligible`/`isClosedStatus` use (`CLOSED_STATUSES` = done/archived) so the
  warning and ready-queue eligibility can never disagree.
- If any are open, print a single `WARNING:`-prefixed line to stderr (matching
  the existing `codexTaskWarning`/`typeStatusAdvisory` convention) naming the
  open blocker ids and stating that the ticket will stay ineligible in
  `list --ready` until they close. The promotion still proceeds and returns 0.
- Expose a small helper for the blocker resolution rather than reaching into
  private internals; either add an exported `openBlockers(ticket, byId)` to
  `src/tickets.js` (preferred, testable in isolation) or compute inline in the
  CLI using `byTicketId(board)`. Preference: exported helper.

### Routing through `moveTicket` + Run Log line

- The transition itself is `moveTicket(root, ticketId, target)` — unchanged path,
  so folder relocation (backlog -> ready), `updated` stamping, `enforceTransitions`,
  loop-back invalidation (a no-op for a forward backlog move), and the
  consultation-stamp sweep all apply as-is. Do NOT add a param to `moveTicket`.
- Ordering: validate -> emit dependency warning -> `moveTicket` -> append Run Log
  line -> `maybeCommitPlanning`. Append the Run Log line AFTER a successful move
  (via `appendTicketComment(root, ticketId, "Run Log", <text>)`, which re-resolves
  the ticket by id in its new `ready/` folder) so the audit line is only written
  when the promotion actually happened. Two writes (move, then comment) mirror how
  other CLI commands pair a mutation with `maybeCommitPlanning`; acceptable.
- Run Log text records the from/to and the trigger, e.g.:

```text
Promoted backlog -> ready_for_design (user-directed)
```

  For an overridden target, keep the same shape with the chosen status. Consider
  appending `(--to override)` vs `(computed)` is optional; the `--json` output is
  the machine-readable source of truth, so keep the Run Log line simple and
  human-readable.
- Reuse `maybeCommitPlanning(root, { ticketId, command: "promote", detail: target })`
  exactly as `commandMove` does via `moveAndMaybeMerge`, so
  `git.commitPlanningOnTransition` behavior is identical.

### `--json` output shape

Emit (pretty-printed, like other commands):

```text
{
  "ticket": "T20260720T2117Z",
  "from": "backlog",
  "to": "ready_for_design",
  "targetSource": "computed",   // or "override" when --to was used
  "path": "<new ticket path>",
  "openBlockedBy": ["T...."]      // present (possibly empty) so callers can branch
}
```

- `targetSource` is the required "computed-vs-overridden" signal.
- `path` mirrors `move --json`'s ticket path for parity.
- `openBlockedBy` lets a JSON caller see the same thing the stderr warning
  conveys. Human (non-JSON) mode prints the new path (like `move`) plus the
  stderr warning line when applicable.

### Usage and skill-doc updates

- Add one line to `USAGE_TEXT` in `src/cli.js` (drives `usageCommandNames`, so
  the SKILL subset test passes automatically once the block matches):

```text
local-board [--root <path>] promote <ticket-id> [--to <status>] [--allow-main-root] [--json]
```

  Place it near `move` for discoverability. Include `--allow-main-root` because
  `promote` is a per-ticket mutation and must call `assertInvocationRootForTicket`
  like `move`/`set` (worktree wrong-root guard).
- Add `promote` to BOTH curated CLI Commands `sh` blocks
  (`SKILL.md` and `skills/codex/local-board/SKILL.md`) with byte-identical text,
  e.g.:

```text
local-board promote <ticket-id> [--to <status>] [--json]
```

  Insert at the same position in both files.
  `test/skill-usage-sync.test.js` enforces byte-identical blocks and subset-of-usage.
- No `npm run sync-resources` needed for SKILL.md (that command mirrors
  `plans/prompts` -> `resources/prompts`; SKILL files are not prompt resources).
  Confirm during implementation that no resources mirror covers SKILL.md.

### Command wiring

- Add the dispatch branch in `main`:
  `if (command === "promote") return await commandPromote(root, args, allowMainRoot);`
  near the `move` branch.
- `commandPromote(root, args, allowMainRoot)`:
  1. `const asJson = takeFlag(args, "--json");`
  2. `const to = takeOption(args, "--to");`
  3. `const ticketId = args.shift(); ensureNoArgs(args);`
  4. arg-count guard message: `promote requires: <ticket-id> [--to <status>] [--allow-main-root] [--json]`.
  5. `await assertInvocationRootForTicket(root, ticketId, { allowMainRoot });`
  6. `loadConfig` + `findTicket` (need the board for blocker resolution and the
     config for derivation).
  7. backlog-source refusal; `--to` trigger validation OR `deriveEntryStatus`.
  8. dependency warning; `moveTicket`; Run Log append; `maybeCommitPlanning`; output.

### Affected files

- `src/tickets.js`: new exported `deriveEntryStatus(config, type)` and (preferred)
  `openBlockers(ticket, byId)`; both pure. Possibly export `byTicketId` if not
  already exported and the CLI needs it.
- `src/cli.js`: dispatch branch, `commandPromote`, one `USAGE_TEXT` line.
- `SKILL.md` and `skills/codex/local-board/SKILL.md`: one command line each
  (byte-identical).
- `test/`: new coverage (see test plan). Likely `test/cli.test.js` (command
  behavior) and `test/tickets.test.js` (derivation helper), plus the existing
  `test/skill-usage-sync.test.js` re-passing.

### Risks and edge cases

- Byte-identical SKILL drift: the single highest-probability failure. Edit both
  blocks identically and run the FULL suite (`node --test`), not just the guard
  suite (per AGENTS.md prompt/skill rule).
- Custom-config derivation: guard the empty/unmappable `doneRequires` cases so a
  weird board gets a clear refusal, not a crash or a wrong status.
- `--to` to a trigger status that is not a valid entry for the type (e.g.
  promoting a task straight to `ready_for_implementation`, skipping design):
  `promote` intentionally permits this — `--to` is the sanctioned manual override.
  Eligibility/done-gating still protects correctness downstream. Document that
  `--to` is the escape hatch and is trigger-validated only.
- Ticket already out of backlog but physically in the wrong folder: `findTicket`
  reads front matter status (canonical), so the backlog check is on status, not
  folder — correct and consistent with the rest of the codebase.
- Two-write ordering (move then comment): if the comment write fails after a
  successful move, the ticket is promoted but missing its Run Log line. This is
  the same failure surface as any move+comment pairing already in the CLI;
  acceptable and no worse than `move`.

### Test plan

Derivation unit tests (`test/tickets.test.js`):
- `deriveEntryStatus(scaffoldConfig, "epic")` and `"story"` -> `ready_for_decomposition`.
- `deriveEntryStatus(scaffoldConfig, "task")` and `"bug"` -> `ready_for_design`.
- A customized config (e.g. `doneRequires.task` reordered / a renamed
  `statusActions` value / a trimmed pipeline) still yields the furthest-from-done
  entry.
- Empty/unmappable `doneRequires[type]` throws/refuses.
- `openBlockers` returns only non-closed (and missing) dependencies.

Command tests (`test/cli.test.js`), against a scaffold-config board:
- `promote <epic>` (no `--to`) lands `ready_for_decomposition`; `promote <task>`
  lands `ready_for_design`; front matter status AND folder both updated; Run Log
  line present.
- `promote --to designing` refuses (not a trigger); assert message + no fs change.
- `promote` on a `ready_for_design` ticket refuses (not backlog); assert message
  names the current status + no fs change.
- Open-dependency promote: ticket with an open `blockedBy` succeeds, prints the
  stderr warning, exits 0, and afterwards `list --ready` / query-ready still
  excludes it (stays ineligible).
- `--json` shape: assert `ticket`, `from`, `to`, `targetSource` (`computed` vs
  `override`), `path`, `openBlockedBy`.
- `--to <valid trigger>` sets `targetSource: "override"` and lands that status.
- `promote` honors `worktrees.guardWrongRoot` (wrong-root refusal unless
  `--allow-main-root`), mirroring `move`.

Suite-wide:
- `test/skill-usage-sync.test.js` passes with both blocks updated.
- Full `node --test` green (mandatory per AGENTS.md because SKILL/prompt-adjacent
  curated text changed).

### Documentation impact

- SKILL.md + codex mirror CLI Commands blocks (required, above).
- USAGE_TEXT (required).
- Consider a short mention in any human `docs/` workflow page that enumerates
  lifecycle commands (e.g. wherever `move`/backlog promotion is described); low
  priority, verify during implementation whether such a page exists and update
  the README Documentation Index only if a new doc file is added (none expected).

### Open questions

1. Epic/story WITH existing children: is `ready_for_decomposition` still the
   desired promote target, or should such a ticket be refused / routed elsewhere?
   Current design derives decomposition regardless (with `--to` as the escape).
   Confirm this is acceptable, or specify the alternate behavior.
2. Run Log wording: requirement gives `Promoted backlog -> <status>
   (user-directed)`. Confirm "(user-directed)" is the exact desired trigger
   phrase (vs "(user-authorized)" or aligning with T20260720T2118Z's policy
   language).

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-20T22:06:37Z: Completed design via claude-subagent:local-board-designer@opus: Technical Design written: deriveEntryStatus(config,type) inverts statusActions over doneRequires and picks furthest-from-done pipeline status; --to validated against TRIGGER_STATUSES; non-backlog refused; stderr open-dep warning; transition via moveTicket; Run Log line; JSON shape; SKILL blocks + usage updated
