---
id: T20260707T1330Z
type: task
status: implementing
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260707T1330Z-skills-align-decomposer-contract-to-propose-only-across-claude-codex-and-memory-bank
estimate: 2
estimateBasis: T20260707T1328Z
workStartedAt: 2026-07-07T22:27:23Z
workCompletedAt: null
created: 2026-07-07T13:30:54Z
updated: 2026-07-07T22:35:48Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
routingApprovals: []
---
# skills: align decomposer contract to propose-only across Claude, Codex, and memory-bank

## Requirement

The decomposer's mutation contract contradicts itself across harnesses. `agents/claude/local-board-decomposer.md` says "Create child tickets ... through the local-board CLI commands"; `agents/codex/local-board-decomposer.md` says "Do not create child tickets yourself. Return a concrete proposal for the orchestrator to create." `memory-bank/systemPatterns.md` labels the decomposer both "Return-only" and "creates tickets via CLI" in the same table row, and `SKILL.md` never says who runs `create`. Decompose therefore behaves differently (and leaves different audit trails) depending on harness; a Claude run may create tickets the orchestrator also creates, or the orchestrator may wait for files that never appear.

Fix: pick propose-only (matches the "orchestrator owns mutations" principle and the return-only pattern) and align `agents/claude/local-board-decomposer.md`, `SKILL.md` (copy the codex skill's explicit sentence), and the memory-bank table. If create-directly is chosen instead, align the codex side and document the worktree ID-offset implications.

Acceptance: all decomposer references state one contract; SKILL.md says explicitly who runs `create`.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Decision

Adopt **propose-only** as the single decomposer contract across every harness. The
decomposer (Claude subagent or Codex explorer) **returns a structured child-ticket
proposal**; the **orchestrator runs every mutation** (`create`, `link-parent` /
`link-child`, `block`). This matches the two load-bearing invariants already
documented elsewhere:

- "The orchestrator remains responsible for canonical ticket state unless a
  delegated worker was explicitly assigned write scope" (SKILL.md Persisting
  Delegated Output).
- The return-only pattern the reviewer/tester/gatecheck already follow, which the
  memory-bank Delegation table and both skills already list the decomposer under.

The Codex side (`agents/codex/local-board-decomposer.md`,
`skills/codex/local-board/SKILL.md` line 98) is already propose-only and is treated
as the **canonical wording source**. This ticket brings the Claude agent, root
`SKILL.md`, the memory-bank table, and the two mirrored decompose step prompts into
line with it. The alternative (create-directly) is rejected: it forks audit trails
by harness and contradicts orchestrator-owns-mutations.

### Why keep Bash on the Claude decomposer

Do **not** drop `Bash` from the agent `tools` list. The decomposer still needs
read-only CLI queries (`schema --json`, `list`, `query-ticket`) to size children and
avoid duplicates. Instead, forbid *mutating* commands **by contract wording**, not by
tool removal (the coarse `Bash(local-board *)` grant cannot be scoped per-command
anyway — see systemPatterns "Subagent CLI Permission"). The orchestrator + strict
routing + `validate` remain the backstop against a stray mutation.

## Proposal format (align both agent files)

Define the concrete return shape so the orchestrator can create deterministically.
The decomposer returns, per child, an ordered list of:

- `type` (`story` for an epic parent, `task` for a story parent),
- `title`,
- `status` (the configured first status, e.g. `ready_for_design`),
- `priority` (inherit parent unless justified),
- `requirement` / acceptance-criteria summary,
- `blockedBy` (references to sibling proposals, by ordinal, when sequencing matters).

Plus an explicit dependency ordering. The orchestrator procedure per accepted child:
`create <type> "<title>" --status <status> --priority <priority> --parent <parent>`,
then `link-parent`/`link-child` if not covered by `--parent`, then `block` for each
dependency, then `section` for the child's requirement body.

## Affected files

Canonical contract sources (ticket acceptance targets):

1. `agents/claude/local-board-decomposer.md` — Scope line 14 "propose or create" →
   "propose"; Rule line 23 (the "Create child tickets ... through the local-board
   CLI commands" sentence) → propose-only + the read-only-Bash restriction; Output
   line 31 "created or proposed" → "proposed". Add the proposal-format bullets.
2. `SKILL.md` — Actions line 85 (`decompose: create child tickets...`): clarify the
   **orchestrator** creates from the decomposer's proposal. Persisting Delegated
   Output block (lines 219–225): the decomposer is already listed return-only; add
   the explicit sentence copied from `skills/codex/local-board/SKILL.md` line 98:
   "For decomposition, the decomposer returns a child-ticket proposal; the
   orchestrator runs `create`, `link-parent`, `link-child`, and dependency
   commands." This satisfies "SKILL.md says explicitly who runs `create`".
3. `memory-bank/systemPatterns.md` — Delegation table line 138
   `Return-only; creates tickets via CLI` → `Return-only; proposes child tickets,
   orchestrator creates them via CLI`. (Line 168's return-only paragraph already
   lists the decomposer correctly; optionally add the proposal clause.)

Mirrored step prompts (must stay byte-for-byte identical — `test/resources-sync.test.js`):

4. `plans/prompts/steps/decompose.md` — Persistence line 15: drop the "it runs those
   CLI commands or proposes" fork; state "the `local-board-decomposer` has no Write
   tool and does not mutate state — it returns a child-ticket proposal and the
   orchestrator runs `create`/`link-parent`/`link-child`/`block`."
5. `resources/prompts/steps/decompose.md` — apply the identical edit (or edit
   `plans/` then `npm run sync-resources`). The drift test fails otherwise.

Alignment (low-touch, same contract, keep edits minimal — T1336 will revisit):

6. `agents/codex/local-board-decomposer.md` — already propose-only; only align the
   Output line ("created or proposed" → "proposed") and add the same proposal-format
   bullets so both agent files share one shape.
7. `SKILL_TEAM.md` — the "On completion" return-only branch (lines 111–114) lists
   reviewer/tester/gate-check/codex-read-only but not the decomposer's proposal
   path; add decompose (proposal → orchestrator `create`). Low priority; include if
   cheap.

Explicitly **out of scope** (no contract contradiction, defer to avoid churn with
T1336): `docs/Workflow.md`, `docs/CodexSupport.md`, `docs/PerStepOrchestration.md`.
They reference the decomposer by name/model only and do not assert who creates.

## Worktree mint-offset machinery — assessment

systemPatterns line 181 (`create` derives a per-worktree minute offset when invoked
from inside a registered ticket worktree) was built so that concurrent *creators*
running in peer worktrees mint distinct child IDs (see also the memory note
"Parallel decompose IDs collide"). Under propose-only the **decomposer no longer
creates** — but the **orchestrator** in parallel mode still runs `create --root
<worktreePath>` against per-ticket worktrees, and Codex `workspace-write` workers can
too. So the offset machinery **stays relevant and correct**; it simply becomes
orchestrator/worker-triggered rather than decomposer-triggered.

One wording nit: the phrase "Peer worktree workers therefore mint distinct child IDs"
still reads fine (the orchestrator-driven create from a worktree is a "worktree
worker" case). **Recommend leaving the offset paragraph as-is** to keep this ticket
scoped; if edited, only generalize "workers" so it doesn't imply the decomposer
mints. No behavioral/code change to the offset is required.

## Risks and edge cases

- **Drift test breakage** — the two `decompose.md` copies must match byte-for-byte.
  Edit both (or run `npm run sync-resources`) and run `test/resources-sync.test.js`.
- **Contradiction elsewhere** — grep for residual "create child tickets"/"creates
  tickets via CLI" after edits to be sure no fourth source still asserts the old
  contract.
- **Over-restricting Bash** — do not remove the tool or the decomposer loses
  read-only sizing queries; restrict by contract prose only.
- **Overlap with T1336** (skill dedup) touches the same files later — keep edits
  surgical and confined to the decomposer contract lines.

## Test strategy

- Prose-only change; no production-code path. Primary gate: `npm test`, specifically
  `test/resources-sync.test.js` (the mirrored prompt pair) must stay green.
- Manual consistency check: `rg -n "creates tickets via CLI|create child tickets"`
  across `agents/`, `skills/`, `SKILL.md`, `SKILL_TEAM.md`, `memory-bank/` returns no
  stale assertion of the create-directly contract.
- A dedicated automated "single-contract" grep test is **overkill** for a handful of
  prose files and would be brittle; the manual grep in review suffices.

## Documentation impact

memory-bank `systemPatterns.md` table row is the only memory-bank edit. No
README Documentation Index change (no new `docs/*.md`). Docs narrative untouched by
design decision.

## Open questions

None blocking. Implementer's judgment call: whether to also patch `SKILL_TEAM.md`
(item 7) now or leave it to T1336 — both acceptable.

## Implementation Notes

Aligned the decomposer contract to propose-only across all sources, using the
Codex agent file's wording as canonical.

Files changed:

- `agents/claude/local-board-decomposer.md`: Scope "propose or create" → "propose";
  Rule now restricts Bash to read-only CLI queries (`schema --json`, `list`,
  `query-ticket`), explicitly forbids `create`/`link-parent`/`link-child`/`block`,
  and states the decomposer returns a proposal for the orchestrator to create;
  added a "Proposal format" section (type/title/status/priority/requirement/
  blockedBy) matching the Codex file; Output "created or proposed" → "proposed".
- `agents/codex/local-board-decomposer.md`: added the same "Proposal format"
  section; Output "created or proposed" → "proposed". Rules were already
  propose-only, unchanged.
- `SKILL.md`: Actions line for `decompose` now says the decomposer proposes and
  the orchestrator creates/links; added the explicit sentence to the Persisting
  Delegated Output block: "For decomposition, the decomposer returns a
  child-ticket proposal; the orchestrator runs `create`, `link-parent`,
  `link-child`, and dependency commands." (copied from the Codex skill).
- `SKILL_TEAM.md`: added a "Decompose result" bullet to the "On completion"
  branch (item 7, included since cheap) clarifying the decomposer never creates
  and the orchestrator runs `create`/`link-parent`/`link-child`/`block`.
- `memory-bank/systemPatterns.md`: Delegation table row for
  `local-board-decomposer` changed from "Return-only; creates tickets via CLI"
  to "Return-only; proposes child tickets, orchestrator creates them via CLI".
- `plans/prompts/steps/decompose.md`: Persistence paragraph dropped the "it runs
  those CLI commands or proposes" fork; now states the decomposer has no Write
  tool, does not mutate state, returns a proposal, and the orchestrator runs the
  CLI mutations.
- `resources/prompts/steps/decompose.md`: synced byte-for-byte via
  `npm run sync-resources` (plans/ is source of truth).

No production code changed (prose-only ticket); no changes to
`skills/codex/local-board/SKILL.md` (already canonical, used as the wording
source, not itself an affected file) or to the worktree mint-offset paragraph in
systemPatterns.md (design explicitly recommends leaving it as-is).

Tests:

- `npm run check` — all `node --check` passes, no errors.
- `npm test` — 314 tests, 313 pass, 1 skipped (unrelated smoke test), 0 fail.
- `node --test test/resources-sync.test.js` — 4/4 pass, including the
  byte-for-byte mirror check for `resources/prompts` vs `plans/prompts`.
- `npm run validate` — "Ticket validation OK".

Verification grep (`grep -rin "creates tickets via CLI|create child tickets"
agents/ SKILL.md SKILL_TEAM.md skills/ memory-bank/ plans/prompts
resources/prompts`) returns 4 lines, all consistent with propose-only:

- `agents/claude/local-board-decomposer.md:23` — forbids mutating commands,
  describes the CLI only as read-only-query surface, ends "Return a concrete
  proposal for the orchestrator to create."
- `agents/codex/local-board-decomposer.md:23` — "Do not create child tickets
  yourself. Return a concrete proposal for the orchestrator to create."
- `plans/prompts/steps/decompose.md:15` and the mirrored
  `resources/prompts/steps/decompose.md:15` — describes the CLI-only mutation
  path (used by the orchestrator) immediately followed by "the
  `local-board-decomposer` has no Write tool and does not mutate state — it
  returns a child-ticket proposal and the orchestrator runs
  `create`/`link-parent`/`link-child`/`block`."

No fourth source asserts the decomposer creates directly. Zero contradicting
residue.

Deviations from design: none. Included the low-priority `SKILL_TEAM.md` item 7
edit since it was cheap, per the ticket's open-questions note leaving it to
implementer judgment.

- 2026-07-07: Rework pass — rewrote the systemPatterns:173 Subagent CLI Permission
  clause to remove "the decomposer legitimately needs mutating commands" (now rests
  the coarse-grant risk on the orchestrator/other Bash-capable agents and notes the
  opt-in enforcement hooks as the tightening mechanism), and added the missing
  per-child `section --file` persistence step (Requirement + acceptance criteria)
  to `SKILL.md` (:85, :224) and the mirrored `plans/prompts/steps/decompose.md` /
  `resources/prompts/steps/decompose.md` pair; `npm run check`, `npm test`
  (313/314 pass, 1 skipped), and `npm run validate` all green; grep for
  "legitimately needs" across memory-bank returns no matches.

## Review Findings

- 2026-07-07T22:33:17Z: Review (codex): two prose gaps — systemPatterns:173 still says the decomposer needs mutating commands (contradicts the new contract), and decompose-time orchestrator instructions omit the per-child section step so proposed requirement bodies could be dropped. Looping back.

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-07T22:26:36Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): propose-only contract with codex wording as canonical source; structured proposal shape defined; Bash kept for read-only queries with mutations forbidden by contract; mirrored prompt pair kept drift-safe. Estimate 2 (basis T20260707T1328Z).

- 2026-07-07T22:27:22Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (prose-only contract alignment)

- 2026-07-07T22:27:23Z: Ensured git branch local-board/T20260707T1330Z-skills-align-decomposer-contract-to-propose-only-across-claude-codex-and-memory-bank (created).

- 2026-07-07T22:30:25Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Implementer (sonnet): propose-only wording aligned across 7 files with codex text as canonical; grep proves zero contradicting residue; 313+1 green, drift test green.

- 2026-07-07T22:31:07Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (prose-only contract alignment)

- 2026-07-07T22:33:17Z: Completed review via codex-task:read-only: Codex (gpt-5.5, read-only) changes_requested: one contradicting memory-bank sentence + missing per-child section step in orchestrator instructions; proposal shapes, mirror identity, and dispatch guards verified.

- 2026-07-07T22:33:17Z: Invalidated downstream evidence on loop-back to ready_for_implementation: removed completedSteps [implement:claude-subagent:local-board-implementer@sonnet, gate:implement:claude-subagent:local-board-gatecheck@haiku, review:codex-task:read-only].

- 2026-07-07T22:33:17Z: Ensured git branch local-board/T20260707T1330Z-skills-align-decomposer-contract-to-propose-only-across-claude-codex-and-memory-bank (already-current).
