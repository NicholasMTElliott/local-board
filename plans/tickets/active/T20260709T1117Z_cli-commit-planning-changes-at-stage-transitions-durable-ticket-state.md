---
id: T20260709T1117Z
type: task
status: implementing
priority: P2
parent: null
children: []
blockedBy: []
blocks: [T20260709T1119Z]
branch: local-board/T20260709T1117Z-cli-commit-planning-changes-at-stage-transitions-durable-ticket-state
estimate: 4
estimateBasis: T20260708T2213Z
workStartedAt: 2026-07-09T11:21:29Z
workCompletedAt: null
created: 2026-07-09T11:17:37Z
updated: 2026-07-09T11:30:01Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
routingApprovals: []
---
# cli: commit planning changes at stage transitions (durable ticket state)

## Requirement

Field report from a project on an older local-board version: two incidents destroyed uncommitted worktree ticket state — an aborted merge, then a tester's `git checkout -- .` probe — and both had to be recovered from subagent transcripts. The current version has the same exposure: the only planning commit the CLI ever makes is inside the auto-merge path at `move done` (src/git.js:72, `git.commitPlanningChanges`), so between stages all evidence (complete-step tokens, gate stamps, section bodies, status moves) sits as uncommitted edits in the worktree while executors with full Bash access run against it. Observed in current production runs: testers repeatedly report the ticket's uncommitted status move in `git status` while they work.

Fix: make planning state durable at stage transitions. Add `git.commitPlanningOnTransition` (suggest fallback false / scaffold true, matching the routing-flag pattern): when enabled and the root is a git checkout, `move`, `complete-step`, `gate-complete`, and `section` commit planning-only changes (plans/tickets/** and any planning paths the auto-merge classifier already recognizes — reuse its planning/non-planning split from src/git.js) after a successful mutation, with a terse generated message (e.g. "<ticket-id>: <command> <action|status>"). Batch-friendly: committing only when the working tree's planning paths are dirty makes back-to-back CLI calls cheap. Non-git roots and disabled flag: current behavior. The adopting project's practice ("planning commit at every stage transition") becomes the scaffold default.

Design questions to settle: commit scope strictly planning paths (never src/docs — those belong to the implementer's commits); interaction with worktree-add's existing branch-stamp commit; whether `create`/`estimate`/`comment` also commit (recommend: any mutating command under the flag) — designer decides and justifies.

## Acceptance Criteria

- With the flag on, each mutating CLI command leaves planning files committed; `git status` shows no dirty plans/tickets/** after any single command.
- Planning-only classification reused from the auto-merge path (one source of truth); non-planning files are never swept into these commits.
- Flag off (DEFAULT_CONFIG): byte-for-byte current behavior; config guard test updated per the established divergence pattern.
- An aborted merge or `git checkout -- .` in a worktree after any CLI mutation loses nothing (regression test simulating the destructive op).
- Docs: Workflow.md + memory-bank fact; scaffold comment explains the motivation (executor Bash access + destructive git ops).

## Acceptance Criteria

## Related Tickets

## Technical Design

## Technical Design

### Goal

Make planning ticket state durable *at each stage transition*, not just at
`move done` auto-merge. Today the only CLI-authored planning commit is inside
`autoMergeTicketBranch` (src/git.js:72). Between stages, every complete-step
token, gate stamp, section body, and status move sits as uncommitted worktree
edits while executors with full Bash access run against the checkout — two field
incidents (an aborted merge; a tester's `git checkout -- .`) destroyed exactly
this state. Fix: under a new opt-in flag, each mutating CLI command commits the
*planning-only* subset of the working tree immediately after a successful
mutation, reusing the auto-merge classifier so there is one definition of
"planning path."

### 1. Config flag

Add `git.commitPlanningOnTransition` following the established
fallback-false / scaffold-true divergence pattern (identical shape to
`worktrees.guardWrongRoot`, `routing.enforceTransitions`, etc.).

- `src/config.js` `DEFAULT_CONFIG.git`: add `commitPlanningOnTransition: false`.
  This is the ENOENT fallback and deep-merge base — a pre-existing board that
  omits the key keeps today's behavior (no per-command commits).
- `src/config.js` `defaultConfigJsonc()` `"git"` block: add
  `"commitPlanningOnTransition": true`, with a comment explaining the motivation
  (executors have Bash access and run destructive git ops like `git checkout -- .`
  against uncommitted worktree ticket state; committing at each transition makes
  that state recoverable). New repos adopt the field-reported practice by default.
- No new type/normalizer needed: `git` is a plain deep-merged block. The existing
  loader passes it through. (A boolean-guard normalizer is optional and out of
  scope — the other `git.*` booleans have none either.)

Config guard test (`test/config.test.js`, "defaultConfigJsonc matches
DEFAULT_CONFIG except for documented differences", ~L232 and the `collapsed`
allowlist ~L280): add `git.commitPlanningOnTransition` as the eighth allowed
divergence — set `expected.git.commitPlanningOnTransition = true` before the
`deepEqual`, and add `"git.commitPlanningOnTransition"` to the sorted `collapsed`
allowlist. Extend the two explanatory comment blocks to name it.

### 2. Shared commit helper — one source of truth for planning scope

Add one exported function to `src/git.js`, reusing the classifier that already
backs `assertNoNonPlanningChanges` and `commitPlanningChanges`:

```
export async function commitPlanningTransition(root, { ticketId, command, detail })
```

Behavior, in order:

1. **Non-git guard.** `gitOk(root, ["rev-parse", "--is-inside-work-tree"])`
   (or reuse the existing `gitOutput(... "--show-toplevel")` wrapped in a
   try/catch). If it fails, return `{ committed: false, reason: "non-git" }`
   silently — a non-git board is a legitimate config, not an error.
2. **Dirty-check-first.** `workingTreeEntries(root)`; if no entry has a path
   satisfying `isPlanningPath`, return `{ committed: false, reason: "clean" }`
   without touching git. This is what makes clean runs true no-ops and
   back-to-back CLI calls cheap.
3. **Stage planning scope only.** `gitRun(root, ["add", "plans"])` — identical
   scope to `commitBranchStamp` (worktrees.js:100) and `commitPlanningChanges`
   (git.js:257). `plans/` is the single planning root; `isPlanningPath` already
   defines "planning" as `startsWith("plans/")`. Because we add only `plans`,
   non-planning edits (src/, docs/) are never staged and never swept into the
   commit — satisfying the AC that non-planning files are never committed.
4. **Guard against an empty stage.** `gitOk(root, ["diff", "--cached", "--quiet"])`
   — if the staged tree is clean (e.g. the only planning change was itself
   already staged/committed by a concurrent process, or is ignored), return
   `{ committed: false, reason: "clean" }`. Mirrors `commitPlanningChanges`'s
   `stagedIsClean` guard exactly.
5. **Commit.** `gitRun(root, ["commit", "-m", message])` where
   `message = `${ticketId}: ${command} ${detail}``. Return
   `{ committed: true }`.

**One source of truth:** `isPlanningPath` (currently private, git.js:290) becomes
the shared classifier. Export it (or a thin `partitionPlanningPaths` wrapper) so
`assertNoNonPlanningChanges`, `commitPlanningChanges`, and the new
`commitPlanningTransition` all resolve "planning vs non-planning" identically.
No behavior drift: the function body is unchanged, only its visibility. The
`git add plans` scope and `isPlanningPath`'s `plans/` prefix are kept in lockstep
(a single-line invariant worth a code comment).

**Message format** is `<ticket-id>: <command> <detail>` per the ticket, e.g.
`T20260709T1117Z: move ready_for_review`. This is distinct from the auto-merge
`Complete <ticketId>` and worktree-add `local-board: stamp branch ...` messages,
so a `git log` reads as a per-transition audit trail.

### 3. Warning-not-failure semantics (recommended)

`commitPlanningTransition` must **never** throw out to the CLI mutation. The
mutation (ticket file write) has already completed and returned before the helper
runs; the ticket file on disk is the source of truth. Wrap steps 3–5 in
try/catch: on any git failure (mid-merge `index.lock`, a rejecting pre-commit
hook, a detached/odd state), print
`console.error("warning: planning commit skipped: <message>")` to **stderr** and
return `{ committed: false, reason: "error", error }`. Exit code stays 0; stdout
(the ticket path the orchestrator parses) is unchanged.

Justification: the whole point is durability of state we already wrote. Rolling
back the ticket mutation on a commit failure would *destroy* the very state we
are trying to protect and would newly break workflows that succeed today (the
status quo is "edits left uncommitted" — a failed commit is strictly no worse
than today, never worse). Best-effort commit, loud-but-nonfatal warning, is the
correct trade. Non-git and clean are silent (not warnings): they are normal, not
degraded.

### 4. Which commands commit — recommend all mutating per-ticket commands

The ticket mandates `move`, `complete-step`, `gate-complete`, `section` and
leaves `create`/`comment`/`estimate` to the designer. Recommendation: **every
per-ticket mutating command calls the helper**, because the uniform rule "any
command that writes a planning file commits it" is the simplest to reason about,
the cheapest to test (dirty-check-first makes non-writing paths free), and closes
the exposure completely rather than leaving stray uncommitted edits behind
whichever commands were excluded. Concretely, add a call immediately before
`return 0` in these `src/cli.js` handlers, each supplying its own `detail`:

| Command | detail | Notes |
|---|---|---|
| `move` / `set <id> status` | target status | via `moveAndMaybeMerge`, **guarded `!shouldAutoMerge`** (see 5) |
| `set` (non-status field) | field name | |
| `complete-step` | action | |
| `approve-inline` | action | |
| `gate-complete` | stage | |
| `gate-check` | stage | only commits on the empty-catalog auto-stamp branch (`recordGateSkippedEmptyCatalog`); dirty-check no-ops the read-only path |
| `section` | section name | |
| `comment` | section | |
| `create` | ticket type | makes new backlog tickets durable at birth |
| `estimate` | points | |
| `begin-step` | action | writes a Run Log stamp via `beginStep` |
| `link-parent` / `link-child` / `unlink-parent` / `block` / `unblock` | the other ticket id | two-ticket writes; one commit sweeps both edited ticket files (both live under `plans/`) — pass the primary `ticketId` |

**`start-work`** is included but noted as the one nuanced case: it already does
git plumbing (`ensureGitBranch`) and refuses to switch branches while the tree is
dirty (git.js:149) unless `--allow-dirty`. It sets `workStartedAt`/`branch`,
appends a Run Log line, and may move to `implementing` — all left uncommitted
today. The helper runs *after* those writes on the now-current ticket branch, so
committing them is consistent and desirable (`detail` = resulting status). No
interaction problem: `ensureGitBranch` runs and returns before any ticket field
write, so the commit never races the branch switch.

**Implementation shape (least duplication).** One helper in `git.js`, one thin
CLI-side wrapper `maybeCommitPlanning(root, { ticketId, command, detail })` in
`cli.js` that (a) `loadConfig(root)`, (b) returns early unless
`config.git.commitPlanningOnTransition === true`, (c) delegates to
`commitPlanningTransition`. Each handler makes one call. A central dispatch-level
hook in `main()` was considered and rejected: `ticketId` and the per-command
`detail` are parsed *inside* each handler, and several handlers have bespoke
control flow (auto-merge, empty-catalog gate, two-ticket links), so a generic
wrapper cannot supply an accurate message. Per-handler calls keep the message
honest with negligible duplication (one line each).

### 5. Interaction with the existing auto-merge planning commit

`moveAndMaybeMerge` (cli.js:737) already commits planning inside
`autoMergeTicketBranch` → `commitPlanningChanges` on `move done` when
`git.autoMerge` is on, then switches branch and merges. To avoid a redundant
commit and any perturbation of the delicate merge/switch sequence, gate the new
hook on `!shouldAutoMerge`: when auto-merge will run, the existing path remains
the sole committer (unchanged); otherwise (every non-done move, and `move done`
with auto-merge off) the transition hook commits. The two paths are mutually
exclusive and both use the same `plans/` scope, so no double commit and no
classifier divergence.

Interaction with **worktree-add's `commitBranchStamp`** (worktrees.js:99): same
plumbing (`git add plans` → `diff --cached --quiet` → `commit`), different
message namespace. worktree-add stamps the branch field at creation; the new hook
commits subsequent transitions. No overlap, no change to worktree-add.

### 6. Locking / ordering

No deadlock risk. The ticket RMW lock (`withTicketLock`, a mkdir sentinel under
`.local-board/locks/`) is acquired and released *inside* the ticket mutation
functions (`moveTicket`, `setTicketField`, etc.); the CLI handler calls the
commit helper **after** the mutation returns, i.e. with no lock held. The git
`index.lock` is a separate mechanism the helper does not contend with the ticket
lock over. Cross-process: two CLI invocations committing in the *same* worktree
could race git's `index.lock`; git serializes and fails one — which, under the
warning-not-failure semantics, degrades to a stderr warning, not a broken
mutation. In the parallel orchestrator each ticket runs in its own worktree
(separate index), so this race is not hit in practice.

### 7. Non-git and flag-off behavior (unchanged)

- **Flag off** (DEFAULT_CONFIG fallback / config omitting the key): the CLI-side
  `maybeCommitPlanning` returns before any git call — byte-for-byte identical to
  today. This is the property the "flag-off byte-identical" test pins.
- **Non-git root** (an `init`-ed board with no git checkout): the helper's
  `rev-parse` guard returns silently. `loadConfig`/mutations stay fully
  functional; no warning is emitted (non-git is normal, not a failure).

### Test plan

1. **Flag-on, commit-per-command.** New integration test on a temp git repo with
   `commitPlanningOnTransition: true`: run each mutating command
   (`create`, `move`, `set`, `complete-step`, `approve-inline`, `gate-complete`,
   `gate-check` empty-catalog, `section`, `comment`, `estimate`, `begin-step`,
   link/block); after *each*, assert `git status --porcelain plans/` is empty and
   the new `HEAD` message equals `<ticket-id>: <command> <detail>`.
2. **Flag-off byte-identical.** Same command sequence with the flag off (and with
   no config file at all): assert `plans/**` stays *dirty* (uncommitted) exactly
   as today and no new commits are created — proving zero behavior change.
3. **Destructive-op regression (the core AC).** Flag on: run a mutation, then
   simulate the field incident with `git checkout -- .` (and a second variant:
   `git merge --abort` mid-state) in the worktree; re-read the ticket and assert
   the mutation's evidence survives (was committed), i.e. nothing is lost.
4. **Config guard allowlist.** Update
   `test/config.test.js` "defaultConfigJsonc matches DEFAULT_CONFIG except for
   documented differences" to expect and allowlist
   `git.commitPlanningOnTransition` (eighth divergence). Add a small loader test:
   omitted key → `false`; explicit `true`/`false` preserved; scaffold parses to
   `true`.
5. **Non-git root.** Flag on, board `init`-ed in a non-git temp dir: run a
   mutation; assert it succeeds, exit 0, no crash, no warning on stderr.
6. **Warning-not-failure.** Force a commit failure (e.g. pre-create a
   `.git/index.lock`, or a failing `pre-commit` hook); assert the mutation still
   exits 0, the ticket write persisted, and a `warning: planning commit skipped`
   line is on stderr.
7. **Auto-merge non-regression.** `move done` with `autoMerge: true` still
   produces the single `Complete <ticketId>` commit and merges (the transition
   hook is skipped) — existing auto-merge tests must stay green.
8. **Clean-run no-op.** A mutating command that writes nothing new (e.g. a
   re-save producing an identical file) creates no commit (dirty-check-first).

### Files touched

- `src/config.js` — `DEFAULT_CONFIG.git.commitPlanningOnTransition: false`;
  `defaultConfigJsonc()` git block `true` + motivation comment.
- `src/git.js` — export `commitPlanningTransition`; export/expose `isPlanningPath`
  as the shared classifier (visibility-only change to existing logic).
- `src/cli.js` — `maybeCommitPlanning` wrapper + one call in each mutating
  handler; `!shouldAutoMerge` guard in `moveAndMaybeMerge`.
- `test/config.test.js` — guard-test allowlist + loader cases.
- New/extended CLI integration test(s) for items 1–3, 5–8 above.
- `docs/Workflow.md` — document `git.commitPlanningOnTransition` alongside the
  existing `git.commitPlanningChanges`/`autoMerge` notes (~L540).
- `memory-bank/` (systemPatterns.md or techContext.md) — one terse fact:
  mutating CLI commands commit planning-only changes per transition under the
  flag; motivation = executor Bash access + destructive git ops.

### Risks / open questions

- **Commit noise.** One commit per command yields a granular history on the
  ticket branch. This is intended (audit trail) and is squashed/subsumed by the
  `--no-ff` merge at `move done`; acceptable. Non-issue given the field motivation.
- **Concurrent same-worktree commits** race git's `index.lock`; mitigated by
  warning-not-failure and per-worktree isolation in the orchestrator (section 6).
- **`git add plans` breadth.** If a board ever tracks non-ticket content under
  `plans/` (prompts, templates, config) that an executor legitimately edits, the
  transition commit would sweep those too — but they *are* planning paths by the
  existing classifier's own definition, so this is consistent with the one-source
  rule, not a leak of src/docs. Flagged for awareness, not a blocker.

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-09T11:21:29Z: Ensured git branch local-board/T20260709T1117Z-cli-commit-planning-changes-at-stage-transitions-durable-ticket-state (already-current).

- 2026-07-09T11:28:45Z: Completed design via claude-subagent:local-board-designer@opus: Shared commitPlanningTransition helper reusing auto-merge classifier; all mutating commands, dirty-check-first, warning-not-failure; git.commitPlanningOnTransition fallback-false/scaffold-true; autoMerge path untouched; estimate 4 basis T2213

- 2026-07-09T11:30:00Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (internal git durability)

- 2026-07-09T11:30:01Z: Ensured git branch local-board/T20260709T1117Z-cli-commit-planning-changes-at-stage-transitions-durable-ticket-state (already-current).
