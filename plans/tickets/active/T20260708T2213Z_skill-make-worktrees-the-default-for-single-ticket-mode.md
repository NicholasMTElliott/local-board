---
id: T20260708T2213Z
type: task
status: implementing
priority: P4
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260708T2213Z-skill-make-worktrees-the-default-for-single-ticket-mode
estimate: 2
estimateBasis: T20260708T2016Z
workStartedAt: 2026-07-09T01:19:30Z
workCompletedAt: null
created: 2026-07-08T22:10:45Z
updated: 2026-07-09T01:39:29Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
routingApprovals: []
---
# skill: make worktrees the default for single-ticket mode

## Requirement

Single-ticket orchestration (the local-board skill) works on the main checkout and switches branches via `start-work`. In a 2026-07 production run this produced stacked branches: after a ticket's commits, `start-work` for the next ticket branched off the previous ticket's branch instead of the default branch, yielding divergent board state that required manual reconciliation merges (T20260707T1335Z/T20260707T1336Z). Parallel mode (local-team) never hit this because per-ticket worktrees structurally isolate each ticket from the orchestrator's checkout and from each other.

Fix: make worktrees the default working style for single-ticket mode too. Update the local-board skill text (SKILL.md, canonical root copy + the codex mirror per the lockstep rule, plus resources/ so installs inherit it): before implement/review/test/document, run `worktree-add <id>`, pass `--root <worktreePath>` on per-ticket calls, and `worktree-remove` after done — i.e. the same lifecycle local-team already documents, at N=1. Document the main-checkout flow as a fallback for environments where worktrees are unavailable, with an explicit warning about the branch-stacking hazard and the fast-forward check that mitigates it.

## Acceptance Criteria

- SKILL.md (root, codex mirror, resources copies) describe the worktree lifecycle as the default single-ticket flow; skill-usage-sync and resources drift tests stay green.
- The branch-stacking hazard and its symptom (start-work branching off a prior ticket branch) are documented in the fallback section.
- No CLI changes required (worktree-add/remove already exist); if any small gap blocks N=1 usage, note it as a follow-up rather than expanding scope.

## Acceptance Criteria

## Related Tickets

## Technical Design

Documentation-only change. Make per-ticket worktrees the documented default working
style for single-ticket orchestration, mirroring the local-team parallel skill's
lifecycle at N=1, and demote the main-checkout flow to a fallback with an explicit
branch-stacking hazard warning. No production/CLI code changes: `worktree-add`,
`worktree-remove`, and `fast-forward` already exist and work at N=1.

### Goal

Two skill files change: the canonical root `SKILL.md` and its codex mirror
`skills/codex/local-board/SKILL.md`. Reuse the wording model already proven in
`SKILL_TEAM.md` / `skills/codex/local-team/SKILL.md` (their "Worktrees" and closeout
sections). Do not edit the team skills.

### Correction to the ticket's scope assumption (resources/)

The ticket asks to also update `resources/` "so installs inherit it." That step does
not exist and must not be attempted. `SKILL.md` is **not** mirrored under `resources/`.
`resources/` holds only `prompts/` and `templates/` (verified). At install,
`src/install.js` copies `SKILL.md` and `SKILL_TEAM.md` straight from the repo root
(`copyFileSync(SCRIPT_DIR/SKILL.md ...)`, lines 161-164) and renders the codex skill dir
from `skills/codex/local-board` (`resolveSkillTemplate` -> `installRenderedSkillDir`).
Installs therefore inherit the edits automatically from the two edited files.
`test/resources-sync.test.js` only mirrors `plans/prompts` -> `resources/prompts` and
`plans/templates` -> `resources/templates`; it never touches `SKILL.md`, so the resources
drift test stays green trivially (this ticket edits no prompt/template). The acceptance
criterion about "resources copies" is satisfied by editing the two skill files; there is
no third copy to change.

### Edit 1 — root `SKILL.md`: new `## Worktrees` section (default flow)

Insert a new section **between `## Transition Guidance` (ends line 111) and
`## Branch Discipline` (line 113)**. Model the prose on `SKILL_TEAM.md` lines 67-91 and
147-155, collapsed to N=1. Section body:

- State the default: single-ticket work runs in a per-ticket git worktree by default —
  the same lifecycle local-team uses, at N=1 — because worktrees structurally isolate the
  ticket's branch from the orchestrator's checkout and prevent the branch-stacking hazard
  (see fallback). Do not call `git worktree` directly.
- Before the ticket's first step, create the worktree from the project root and capture
  `worktreePath`: `local-board worktree-add <ticket-id> --json`. Note `worktree-add` also
  creates and records the ticket branch (it commits the branch stamp), so a separate
  branch-creating `start-work` is not needed first.
- Pass `--root <worktreePath>` on **every** later per-ticket call: `begin-step`,
  `start-work`, `complete-step`, `gate-check`, `gate-complete`, `specialty-run`,
  `section`, `comment`, and `move`. Instruct any dispatched step executor to operate
  against that worktree (pass it `worktreePath`; tell it to `cd` there and use
  `--root <worktreePath>`).
- Recommended per-step ordering: `worktree-add` (once, up front) ->
  `begin-step --root <worktreePath>` -> `start-work --root <worktreePath>` (still moves
  `ready_for_implementation` -> `implementing`; inside the worktree it is already on the
  ticket branch and the tree is clean, so no `--allow-dirty` is needed) -> dispatch ->
  `complete-step --root <worktreePath>`.
- Closeout: run `move <ticket-id> done --root <worktreePath> --json` (auto-merge runs in
  the worktree, which is on the ticket branch). Then reconcile the main checkout with
  `local-board fast-forward --json` (run from the project root), then remove the worktree:
  `local-board worktree-remove <ticket-id> --json`. Note `worktree-remove` resolves the
  repo's main root itself, so it works from either the project root or `--root <worktreePath>`.
- One line on the rebase precondition: if `move ... done` refuses because the branch lacks
  the latest default, commit planning-only ticket edits in the worktree, rebase the ticket
  branch onto the default, then retry (same as the parallel skill's closeout). Add no new
  CLI behavior.

#### Fallback subsection (main checkout) with the hazard warning

Add a `### Fallback: main-checkout mode` subsection (still inside `## Worktrees`) for
environments where worktrees are unavailable:

- You may instead work on the main checkout, switching branches with `start-work`
  (see Branch Discipline) and passing no `--root` override.
- **Hazard (branch stacking):** on the main checkout, after a ticket's commits are on its
  branch, running `start-work` for the *next* ticket branches off the **previous ticket's
  branch** instead of the default branch. Symptom: divergent board state and stacked
  branches that require manual reconciliation merges (exactly what happened in the 2026-07
  run, T20260707T1335Z / T20260707T1336Z). Worktrees avoid this structurally.
- **Mitigation:** before `start-work` on each new ticket, return to the default branch with
  a clean tree and run `local-board fast-forward --json`, so the new branch forks from the
  up-to-date default rather than from the prior ticket's tip. This mitigates but does not
  eliminate the hazard; the worktree default is preferred.

### Edit 2 — root `SKILL.md`: Core Loop pointer

In `## Core Loop`, add one short pointer so the loop references the new default without
duplicating the lifecycle. Place it near the `start-work`/`begin-step` steps (steps 8-9):
for `implement`/`review`/`test`/`document` the default is to create a per-ticket worktree
first (`worktree-add`) and pass `--root <worktreePath>` on subsequent per-ticket calls —
see `## Worktrees`. Keep it to one sentence; the detailed lifecycle lives in the new
section. Phrase it as a parenthetical on the existing steps to avoid renumbering, or add a
new numbered step (renumbering is acceptable) — either is fine as long as the pointer exists.

### Edit 3 — root `SKILL.md`: reframe `## Branch Discipline`

Keep the section (start-work is used in **both** modes). Add a one-line lead noting that in
the default worktree mode `start-work` runs inside the worktree with `--root <worktreePath>`,
and that the main-checkout use of `start-work` is the fallback path described under
`## Worktrees`. No other wording in this section needs to change.

### Edit 4 — codex mirror `skills/codex/local-board/SKILL.md`

Apply the lockstep equivalents:

- Add a `## Worktrees` section (default flow + fallback hazard) mirroring Edit 1, inserted
  before the existing `## Branch Discipline` (line 102). Reuse the phrasing of
  `skills/codex/local-team/SKILL.md` lines 46-63 (Worktrees) and 86-96 (Closeout), reduced
  to N=1. Same lifecycle: `worktree-add <id> --json` up front, `--root <worktreePath>` on all
  per-ticket calls, `move done --root <worktreePath>`, `fast-forward --json` from the project
  root, `worktree-remove <id>`. Same fallback hazard/symptom/mitigation text as Edit 1.
- In `## Single-Ticket Loop`, add a pointer bullet before step 3 (`start-work`): default is
  `worktree-add` first, then pass `--root <worktreePath>` on per-ticket calls — see
  `## Worktrees`.
- In the codex `## Branch Discipline`, add the same one-line reframe as Edit 3.

### Edit 5 — curated `## CLI Commands` block (BOTH files, byte-identical)

Decision: **add** the three worktree/closeout commands to the curated block, because the
default single-ticket flow now uses all three — they are no longer "parallel-only." Insert
these lines **immediately after the `start-work` line** in both files, identically:

```
local-board worktree-add <ticket-id> [--json]
local-board worktree-remove <ticket-id> [--force] [--json]
local-board fast-forward [--json]
```

(Signatures verified against `local-board` usage output; the `--root` global is omitted in
the block, matching every other line.) All three names are present in `usageCommandNames()`
(verified: `worktree-add`, `worktree-remove`, `fast-forward` -> true), so the
"subset of authoritative usage surface" test passes.

`test/skill-usage-sync.test.js` compares only the fenced sh block under `## CLI Commands`
and requires it **byte-identical** between the two files. So these three lines must be added
at the same position with identical text in both `SKILL.md` and
`skills/codex/local-board/SKILL.md`. Nothing else in the fenced block changes.

Also update the **prose sentence immediately after** the fenced block in both files (this
sentence is outside the tested block, but keep the two files consistent): change
"Worktree, `fast-forward`, `team-config`, and `list` live in the parallel (`local-team`)
skill." to "`worktree-list`, `team-config`, and `list` live in the parallel (`local-team`)
skill." (worktree-list stays parallel-only; the three added commands drop off the
"parallel-only" list).

### N=1 CLI behavior review (no code changes; follow-ups only)

Reading `src/worktrees.js` confirms `worktree-add`/`worktree-remove` work cleanly at N=1:

- `addTicketWorktree`: when the ticket has no branch it runs `worktree add -b <branch>`,
  stamps `branch` into front matter, and commits the stamp (clean tree afterward). When the
  branch is already recorded it attaches `worktree add <path> <branch>`. Idempotent: an
  already-registered worktree on the right branch returns without error.
- `assertInvocationRootForTicket` (`worktrees.guardWrongRoot`) is a no-op until a worktree
  is registered for the ticket, so solo/main-checkout mode is unaffected; once a worktree
  exists it enforces `--root <worktreePath>`, reinforcing the "pass `--root` everywhere"
  instruction. `--allow-main-root` is the documented override.
- `removeTicketWorktree` resolves the main root itself, so it works from either root.

Follow-up notes (out of scope for this doc ticket; do not expand here):

1. This ticket itself already had `start-work` run on the main checkout before design
   (front matter has `branch` + `workStartedAt` set). At N=1, `worktree-add` simply attaches
   a worktree to that already-recorded branch — fine — but it illustrates why the
   orchestrator should prefer `worktree-add` *before* `start-work` on future tickets.
2. `move ... done` in a worktree relies on the same rebase-onto-default precondition the
   parallel skill documents; at N=1 with no peers the branch is normally already based on
   default, so it rarely triggers. If the main default advanced mid-ticket, the orchestrator
   must commit planning edits and rebase before retrying. Documented in one line (Edit 1);
   no CLI change. A future consistency pass could align single-ticket wording further.

### Risks and edge cases

- **Byte-identical drift** is the primary risk: the two curated blocks must stay identical.
  The implementer must copy the three inserted lines verbatim into both files at the same
  position. `test/skill-usage-sync.test.js` catches any divergence.
- **`<<VERSION>>` / render tokens** are unaffected — no changes near the version placeholders.
- **Codex sandbox:** the codex Worktrees prose may optionally point to `docs/CodexSupport.md`
  "Worktrees and the sandbox" (`worktrees.location: "inside"`); not required for this ticket.
- **Over-documentation:** keep each new section terse (AGENTS.md style). Do not restate the
  full parallel control loop; single-ticket is N=1.

### Test plan

- `node --test test/skill-usage-sync.test.js` — must stay green (byte-identical block +
  subset-of-usage + shared-name-set). Load-bearing check for the curated-block edit.
- `node --test test/resources-sync.test.js` — stays green unchanged (no prompt/template
  edits; SKILL.md is not covered).
- `node --test` (full suite) — nothing else should be affected; doc-only, no `src/` change.
- Manual read-through: confirm the default lifecycle reads top-to-bottom in both files and
  the fallback hazard + symptom (T20260707T1335Z / T20260707T1336Z) is present.

### Documentation impact

- No `docs/*.md` or README Documentation Index change required (no new doc file).
- Optional: a one-line note in `memory-bank/systemPatterns.md` that single-ticket mode now
  defaults to worktrees, at the document stage's discretion; not required by the acceptance
  criteria.

## Implementation Notes

## Review Findings

Reviewed by codex-task:read-only (gpt-5.5) on the implement commit (worktree).

- [P2] `skills/codex/local-board/SKILL.md:51-54` — the codex single-ticket loop runs `begin-step` (step 2) before the step that says to run `worktree-add` first (step 3), contradicting the new Worktrees section (:111-127) and the parallel codex lifecycle. Move the worktree-add/default-root instruction before begin-step and show `begin-step <ticket-id> --root <worktreePath> --harness codex --json`.
- [P2] Default-flow examples omit `--root <worktreePath>` after worktree creation: root `SKILL.md:37-41` (begin-step/complete-step/move) despite :36 saying to pass it; codex skill :54-59 (start-work/complete-step/move) and the inline-approval example at :75. Conflicts with the Worktrees sections and can fail under worktrees.guardWrongRoot. Add --root to the default-loop examples or mark no-root examples fallback-only.

Verified passing: curated blocks byte-identical; the three added command signatures match src/cli.js:459-518 + usage :1361-1364; branch-stacking warning technically accurate vs src/git.js:138-164; fallback framed as fallback; no orphaned step numbers.

Verdict: changes_requested

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-09T01:19:30Z: Ensured git branch local-board/T20260708T2213Z-skill-make-worktrees-the-default-for-single-ticket-mode (already-current).

- 2026-07-09T01:27:08Z: Completed design via claude-subagent:local-board-designer@opus: Worktrees section for both single-ticket skill files; 3 commands added to curated blocks byte-identically; no resources SKILL copy (verified); fallback + stacking hazard; estimate 2 basis T2016

- 2026-07-09T01:29:26Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (docs-only skill edits)

- 2026-07-09T01:29:26Z: Ensured git branch local-board/T20260708T2213Z-skill-make-worktrees-the-default-for-single-ticket-mode (already-current).

- 2026-07-09T01:34:54Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Worktrees section + fallback/stacking hazard in both skill files; 3 commands added to curated blocks byte-identically; 415 pass + 1 skip; skill-sync 4/4

- 2026-07-09T01:36:16Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (Markdown-only skill edits)

- 2026-07-09T01:39:29Z: Invalidated downstream evidence on loop-back to ready_for_implementation: removed completedSteps [implement:claude-subagent:local-board-implementer@sonnet, gate:implement:claude-subagent:local-board-gatecheck@haiku].

- 2026-07-09T01:39:29Z: Ensured git branch local-board/T20260708T2213Z-skill-make-worktrees-the-default-for-single-ticket-mode (already-current).
