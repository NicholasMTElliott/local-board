---
id: T20260709T1119Z
type: task
status: ready_for_test
priority: P3
parent: null
children: []
blockedBy: [T20260709T1117Z]
blocks: []
branch: local-board/T20260709T1119Z-skills-cli-mandate-committing-ticket-files-at-authoring-worktree-add-fails-early-on-untracked-tickets
estimate: 2
estimateBasis: T20260708T2213Z
workStartedAt: 2026-07-09T12:18:17Z
workCompletedAt: null
created: 2026-07-09T11:17:38Z
updated: 2026-07-09T12:42:39Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku"]
routingApprovals: []
---
# skills+cli: mandate committing ticket files at authoring; worktree-add fails early on untracked tickets

## Requirement

No skill text mandates committing ticket files after authoring (create / section Requirement / link / block / decompose child creation / backlog promotion), yet worktree mode structurally requires it: `worktree-add` branches from HEAD, so a ticket file that exists only as an uncommitted edit on the default branch does not exist inside the new worktree. The add then breaks midway — the worktree and branch are created, but the branch-stamp write into the worktree's copy of the ticket (src/worktrees.js:51 setTicketField at worktreePath) fails because the file is absent there. Current runs avoid this purely by orchestrator habit (committing after creation/decomposition/promotion).

Fix, two layers:
1. Skills (single-ticket + team, both harness variants): make it explicit that ticket authoring ends with a planning commit — after `create`+`section`+links, after decompose child creation, and after backlog promotions, commit plans/ before dispatching or running `worktree-add`. One imperative sentence per flow, placed where each flow is described. (If T20260709T1117Z's commit-on-transition flag ships and covers `create`/`section`, the skill sentence becomes "verify committed" rather than "commit manually" — coordinate wording, don't duplicate machinery.)
2. CLI fail-early: `worktree-add` checks whether the ticket file is tracked and unmodified in HEAD of the default branch before creating anything; if the file is untracked or has uncommitted changes, refuse with a clear message ("ticket file not committed; commit plans/ before worktree-add") instead of half-creating the worktree. A `--force`-style escape is unnecessary — there is no valid uncommitted-ticket worktree flow.

## Acceptance Criteria

- `worktree-add` on an uncommitted (untracked or dirty) ticket file exits non-zero with a message naming the fix, creating no worktree and no branch.
- `worktree-add` on a committed ticket behaves exactly as today (existing tests green).
- Both skill files (and codex mirrors) state the authoring-ends-with-a-commit rule in the create/decompose/promotion flows; skill-usage-sync + resources drift tests green.
- Tests: refusal case (untracked ticket), dirty-ticket case (committed then edited), and the happy path.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Technical Design

Two independent layers, both small: a CLI fail-early preflight in
`addTicketWorktree`, and one flag-aware authoring-ends-committed sentence in each
of the four skill files. T20260709T1117Z already shipped `commitPlanningOnTransition`
auto-commit for mutating commands (incl. `create`/`section`), so on flag-on boards
authoring is durably committed command-by-command; the skill rule becomes mostly a
"verify committed" posture there but stays a real manual step on flag-off boards.
The CLI guard is the structural backstop that makes either posture safe.

### Layer 1 — CLI fail-early in `src/worktrees.js`

**Failure shape today.** `addTicketWorktree` (src/worktrees.js:18) reads the
ticket from the *main root* FS via `findTicket(repoRoot, …)` at :20, so
`ticket.path` always resolves against `repoRoot` and the file physically exists
there even when uncommitted. `git worktree add` (:50/:54) then branches from
`repoRoot`'s current **HEAD** — which does *not* contain an untracked or dirty
ticket. In the new-branch path the worktree + branch are created, then
`setTicketField(worktreePath, …)` at :51 throws because the ticket file is absent
in the freshly checked-out worktree — leaving a half-created worktree and branch
behind. In the existing-recorded-branch path (:54) nothing throws, but the
worktree silently lacks the ticket file. Both are broken states we want to refuse
*before* any side effect.

**Placement.** Insert the preflight after the squat-path check (:41-43) and
immediately **before** `await mkdir(...)` at :45. This gates both creation
sub-branches (new-branch and existing-branch) while leaving untouched:
- the already-registered / repair path (:28-39, returns early — the ticket file
  already lives inside that worktree, so the HEAD check is irrelevant and would be
  wrong to apply);
- the squat-path error (:41-43).
Placing it before `mkdir`/`ensureWorktreeIgnore`/`gitRun` guarantees a refusal
creates **no worktree, no branch, no `.gitignore` edit, no parent dir** — the
"no debris" acceptance criterion.

**Exact git incantation.** Use one `git status --porcelain` call scoped to the
ticket's repo-relative path, run against `repoRoot` (the main root, whose HEAD the
worktree will branch from):

```js
const relPath = path.relative(repoRoot, ticket.path).split(path.sep).join("/");
const status = await gitRawOutput(repoRoot, ["status", "--porcelain", "--", relPath]);
const firstLine = status.split(/\r?\n/).find((line) => line !== "") ?? "";
if (firstLine !== "") {
  const untracked = firstLine.startsWith("??");
  throw new Error(untracked ? <untracked-msg> : <dirty-msg>);
}
```

Rationale for `status --porcelain` over `ls-files --error-unmatch`:
- It distinguishes all three states in **one** call: empty output = tracked,
  committed at HEAD, and unmodified in both index and worktree (safe → proceed);
  `??` prefix = untracked (→ untracked message); any other XY code (` M`, `M `,
  `A `, `AM`, `MM`, …) = tracked-but-dirty (→ dirty message).
- It is defined **relative to current HEAD**, which is exactly what `worktree add`
  branches from. `ls-files --error-unmatch` only proves index membership (a
  `git add`ed-but-uncommitted new file passes it yet is still absent from HEAD),
  and it does not detect dirtiness at all — so it cannot gate this correctly.
- **Non-default-branch edge falls out for free.** A ticket committed only on some
  other branch is, in `repoRoot`'s current working tree, a new untracked file
  (`??`) relative to the checked-out HEAD → refused. We deliberately check against
  *HEAD* (what the new worktree will actually contain), not "the default branch"
  abstractly, so this needs no special-casing.

Use `gitRawOutput` (not `gitOutput`, which trims) to keep the XY leading spaces
intact for the `??` / code inspection. `firstLine` guards a possible trailing blank
line. A single-file pathspec yields at most one entry, so `find(non-empty)` is
sufficient (no rename handling needed for a fresh ticket).

**Always-on, not flag-gated.** Unlike `guardWrongRoot`, this is a correctness
precondition with no valid uncommitted-ticket worktree flow, so it runs
unconditionally. `addTicketWorktree` already requires git (rev-parse at :19), so
git availability is guaranteed; if the `status` call itself throws, let it
propagate — a broken git means `worktree add` would fail anyway. No `--force`
escape hatch (per requirement).

**Two refusal messages.** Both name the ticket, the relative path, the reason,
*and* the fix, and distinguish the two cases:

- Untracked:
  `ticket <id> file <relPath> is not committed (untracked at HEAD); worktree-add branches from HEAD, so an uncommitted ticket file would be absent in the new worktree. Commit plans/ first — run any board command with git.commitPlanningOnTransition on, or ` + "`git add plans && git commit`" + ` — then retry.`
- Dirty:
  `ticket <id> file <relPath> has uncommitted changes (not yet in HEAD); worktree-add branches from HEAD, so those changes would be absent in the new worktree. Commit plans/ first — run any board command with git.commitPlanningOnTransition on, or ` + "`git add plans && git commit`" + ` — then retry.`

Keep both to the shape the existing guard messages use (single sentence, fix named
inline) so the CLI wraps them to exit code 2.

### Layer 2 — skills (four files, prose only)

One flag-aware sentence per authoring flow. Curated CLI-Commands fenced blocks are
**not** touched (see drift note below). Suggested wording (adapt per file's voice):

> Ticket authoring ends committed. With `git.commitPlanningOnTransition` on
> (scaffold default), `create`/`section`/`link`/`block` each auto-commit `plans/`,
> so just verify `git status` is clean before `worktree-add` or dispatch. On
> flag-off boards, run `git add plans && git commit` yourself first —
> `worktree-add` branches from HEAD and refuses an untracked or dirty ticket file.

**Placement anchors:**

- `SKILL.md` — the `worktree-add` paragraph at :129-130 ("`worktree-add` also
  creates and records the ticket branch…"). Add the sentence immediately before
  the `worktree-add` fence (:122-127) so it reads as a precondition. Also touch the
  decompose/child-creation description (:87 / :296-301, "the orchestrator creates
  them, links them…") with the same rule for child tickets.
- `skills/codex/local-board/SKILL.md` — mirror anchor at :120-121 (identical
  worktree-add paragraph). Apply the same insertion. This file's `## CLI Commands`
  fenced block must stay byte-identical to SKILL.md's (skill-usage-sync); the
  insertion is prose *outside* that block, so it is unaffected — keep it that way.
- `SKILL_TEAM.md` — the **Seed** step (:101-103, "For up to `maxInFlight` ready
  tickets: `worktree-add` …") gets the verify/commit precondition; and the
  decompose on-completion step (:119-121, "the orchestrator runs `create`,
  `link-parent`/`link-child`, and `block` for each accepted child") gets the
  child-authoring-ends-committed note before those children are seeded.
- `skills/codex/local-team/SKILL.md` — the seed line at :34 ("For each ready
  ticket up to `maxInFlight`, run `worktree-add …`") gets the same precondition;
  mirror the decompose note if that file describes child creation.

### Tests — `test/worktrees.test.js`

Follow the existing `withRepo` + `runCli(["--root", root, "worktree-add", …])`
pattern. `withRepo` scaffolds the flag-on default config; existing happy-path tests
already `git add plans && git commit` before `worktree-add`, so they stay green
(they exercise the clean branch). New cases:

1. **Untracked refusal.** `createTicket(...)` but do **not** commit. Run
   `worktree-add`; assert `code === 2`, `stderr` matches `/not committed \(untracked at HEAD\)/`
   and names the fix (`/commit plans\//`). Assert **no debris**: `worktree-list`
   returns `[]` (or the worktree path does not exist), `git branch --list <branch>`
   is empty, and the target worktree dir is absent.
2. **Dirty refusal.** `createTicket`, `git add plans && git commit`, then edit the
   committed ticket file (e.g. `setTicketField` / append a Run Log line) so it is
   tracked-but-modified. Run `worktree-add`; assert `code === 2`, `stderr` matches
   `/has uncommitted changes/`. Same no-debris assertions as (1). (This case proves
   the guard fires on the tracked-dirty state, not just untracked.)
3. **Clean happy path.** Committed ticket → `worktree-add` succeeds (`code === 0`),
   worktree + branch created, ticket file present in the worktree with the branch
   stamped. Effectively covered by the existing "creates a sibling worktree…" test
   (:52); optionally add an explicit assertion that a committed ticket is
   unaffected to pin the criterion.
4. (Optional) **Committed-on-non-default-branch** edge: commit the ticket on a side
   branch, `git switch` back to the base branch (where the file is untracked),
   `worktree-add` → refused as untracked. Confirms the guard checks HEAD, not an
   abstract default branch.

Use the file's existing `escapeRegExp`, `displayPath`, `currentBranch`, and
`git`/`gitOutput` helpers; gate on `{ skip: !GIT_AVAILABLE }` like every sibling
test. For no-debris, prefer asserting `worktree-list --json` is `[]` plus a
`git branch --list` check — this directly encodes "creating no worktree and no
branch."

### Drift / doc tests

- `skill-usage-sync.test.js` compares only the `## CLI Commands` fenced block
  between SKILL.md and the codex mirror. Layer-2 edits are prose outside that
  block, so the tests stay green — provided the CLI Commands blocks are not edited.
- `resources-sync.test.js` mirrors only `plans/prompts` and `plans/templates`;
  skills are out of scope. No impact.
- No new `docs/*.md`, so the README Documentation Index is untouched.

### Scope boundaries

- **In scope:** the preflight + two messages in `src/worktrees.js`; one flag-aware
  sentence in each of the four skill files; the new tests above.
- **Out of scope:** any `--force` escape hatch; changing `commitPlanningOnTransition`
  machinery (shipped in T20260709T1117Z); the repair/already-registered path;
  auto-committing the ticket on the user's behalf inside `worktree-add`; editing
  curated CLI-Commands blocks; `worktree-remove`/`fast-forward`.

### Risks / edge cases

- **Repair path must stay unguarded** — placing the check before `mkdir` (after the
  early return at :39) is essential; guarding the repair path would wrongly refuse a
  legitimate re-stamp whose ticket already lives in the worktree.
- **CRLF / path quoting:** we inspect only the leading XY code and the `??` prefix,
  and scope the pathspec to one file, so git's path-quoting of unusual names does
  not affect the decision. Windows path separators are normalized to `/` for the
  pathspec.
- **Message wording is asserted by tests** — keep the regex anchors (`untracked at
  HEAD`, `has uncommitted changes`, `commit plans/`) stable between message and test.

## Implementation Notes

## Review Findings

Reviewed by codex-task:read-only (gpt-5.5). One finding: [P3] skills/codex/local-board/SKILL.md:38,92 — the Creating Tickets and decomposition child-creation flows still omit the authoring-ends-committed rule; the sentence added at :113 is only a worktree precondition, so a create-only codex run on a flag-off board can end with uncommitted plans/. Add the flag-aware sentence to both flows (outside the curated block). Passing: preflight correctness (separator normalization :45, porcelain scope before mkdir/.gitignore :46, rename/quoted-path XY classification), placement (no side effects before refusal), refusal tests assert no-debris, repair path unaffected. Verdict: changes_requested

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-09T12:18:17Z: Ensured git branch local-board/T20260709T1119Z-skills-cli-mandate-committing-ticket-files-at-authoring-worktree-add-fails-early-on-untracked-tickets (already-current).

- 2026-07-09T12:24:49Z: Completed design via claude-subagent:local-board-designer@opus: Preflight git status --porcelain -- <ticket> after the repair-path return (untracked/dirty/clean in one call, HEAD-relative); two refusal messages naming the fix; flag-aware skill sentence x4; estimate 2 basis T2213

- 2026-07-09T12:25:55Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (git plumbing + docs)

- 2026-07-09T12:25:55Z: Ensured git branch local-board/T20260709T1119Z-skills-cli-mandate-committing-ticket-files-at-authoring-worktree-add-fails-early-on-untracked-tickets (already-current).

- 2026-07-09T12:33:38Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Preflight after repair-path return; untracked/dirty refusals naming the fix; flag-aware sentence in all four skills; 3 tests; 445 pass + 1 skip; skill-sync 4/4

- 2026-07-09T12:35:43Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (git plumbing + docs)

- 2026-07-09T12:37:55Z: Invalidated downstream evidence on loop-back to ready_for_implementation: removed completedSteps [implement:claude-subagent:local-board-implementer@sonnet, gate:implement:claude-subagent:local-board-gatecheck@haiku].

- 2026-07-09T12:37:55Z: Ensured git branch local-board/T20260709T1119Z-skills-cli-mandate-committing-ticket-files-at-authoring-worktree-add-fails-early-on-untracked-tickets (already-current).

- 2026-07-09T12:41:19Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Rework: flag-aware authoring-commit sentence added to codex Creating Tickets + decompose flows (outside curated block); 445 pass + 1 skip; skill-sync 4/4

- 2026-07-09T12:42:38Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (prose rework)
