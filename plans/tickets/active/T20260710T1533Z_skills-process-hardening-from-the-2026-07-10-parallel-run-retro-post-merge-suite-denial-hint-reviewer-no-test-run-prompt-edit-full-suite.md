---
id: T20260710T1533Z
type: task
status: implementing
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260710T1533Z-skills-process-hardening-from-the-2026-07-10-parallel-run-retro-post-merge-suite-denial-hint-reviewer-no-test-run-prompt-edit-full-suite
estimate: 2
estimateBasis: T20260710T1223Z
workStartedAt: 2026-07-10T15:40:30Z
workCompletedAt: null
created: 2026-07-10T15:32:23Z
updated: 2026-07-10T17:17:35Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "design-review:codex-task:read-only@gpt-5.6-sol"]
routingApprovals: []
---
# skills: process hardening from the 2026-07-10 parallel-run retro (post-merge suite, denial hint, reviewer no-test-run, prompt-edit full suite)

## Requirement

Consolidated process-hardening items from the 2026-07-10 parallel-run retrospective. Four skill/prompt text edits, each tied to an observed incident; no production code.

## Scope

1. SKILL_TEAM.md (and skills/codex/local-team/SKILL.md) Closeout: make post-merge verification a contract step — after each move ... done + manual merge (autoMerge off), run the full test suite on the merged default branch before proceeding to refill; on unexpected failures, fix forward immediately before dispatching new work. Incident: the B20260710T1225Z merge auto-merged textually but broke 11 tests via a removed-function call (semantic conflict invisible to git); caught only by ad-hoc discipline. Note the alternative with teeth in the text: boards may instead enable git.autoMerge for the CLI's rebase-onto-default precondition.
2. SKILL_TEAM.md Dispatch (and the single-ticket SKILL.md Delegation section): add the denial-recovery hint — if the routing-validator hook denies a dispatch with agent-mismatch, first verify begin-step was run for the ticket's CURRENT stage (the ledger stamp is the hook's primary evidence). Incident: two orchestrator misses in one session, both exactly this.
3. plans/prompts/roles/code_reviewer.md (and both reviewer agent definitions): add one line — do not attempt to run the test suite; review sandboxes deny child-process spawning; static review only, execution verification belongs to the test stage. Incident: every codex review in the session burned tokens on spawn EPERM attempts and reported it as a caveat.
4. AGENTS.md or SKILL.md maintenance note (design decides placement): prompt files under plans/prompts/ and agents/ are production artifacts — after editing them, run the FULL test suite, not just the guard suites (content-assertion tests exist against prompt text). Incident: a prompt reword broke test/cli.test.js's estimate-prompt assertion; only guard suites were run pre-commit.

Remember the resources mirror: any plans/prompts edit requires npm run sync-resources.

## Acceptance criteria

- All four texts updated at the described locations; CLI Commands fenced blocks untouched and byte-identical; skill-usage-sync suite green.
- Each addition is one to three sentences, executor/orchestrator-audience-correct per the audience-separation convention.
- npm run check and node --test pass.

## Non-goals

- No CLI behavior changes; no new tests beyond keeping existing suites green.

## Acceptance Criteria

## Related Tickets

## Technical Design

Four independent documentation/prompt text additions from the 2026-07-10 parallel-run
retrospective. No production code, no CLI behavior change. Each item is a bounded
insertion into existing skill/prompt/agent Markdown, plus one resources mirror refresh.
Item 1 additionally amends BOTH team skills' scheduling sequences (not just Closeout
prose) so the post-merge full suite provably gates slot refill in each, and narrows each
skill's step 4 to non-terminal transitions so the terminal `move … done` fires exactly
once (in Closeout).

### Related tickets and conflicts

- Incident sources are all from the 2026-07-10 parallel run (B20260710T1225Z merge break;
  two orchestrator agent-mismatch misses; codex review spawn-EPERM; an estimate-prompt
  assertion break from a prior reword). No open ticket touches these same anchors, so no
  merge conflict is expected. The edits are additive prose plus two control-loop reorders
  (one per team skill), each with a step-4 non-terminal narrowing.

### Insertion-point survey (confirmed by reading each file)

- `SKILL_TEAM.md` has a numbered `## Control loop` (steps 1-8): 1 Seed, 2 Dispatch,
  3 Await, 4 On completion, 5 Conflict gate, **6 Refill** (lines 162-166), **7 Closeout**
  (lines 167-175), 8 Terminate. Step 4's move is worded GENERICALLY ("Choose the next
  status from the returned `transitions` and `move`", line 150), so a terminal
  `move … done` could textually fire in step 4 AND again in Closeout — a double-move
  exposure that mirrors the codex file's, since with `git.autoMerge` on the first call
  merges and prunes the branch and the second fails before the fast-forward/suite. It must
  be narrowed to non-terminal transitions (terminal move reserved to Closeout), exactly as
  the codex step 4 is narrowed. Step 4 also DROPS `questions`/`blocked` tickets from
  in-flight WITHOUT any Closeout (line 151-152), so slot refill cannot be gated on Closeout
  for those exits — only a terminal `done` exit carries a Closeout. Beyond that it also has
  an ordering problem (Refill textually precedes Closeout). Cross-references between steps
  are by NAME ("See Closeout", "see Dispatch"), never by number, so the steps can be
  reordered without dangling references. Closeout already carries the stale-default recovery
  (rebase-onto-default-then-retry) and the commit-before-rebase note (move/complete-step
  leave the ticket file dirty; rebase refuses a dirty tree). The `## Worktrees` section
  (lines 67-90) currently says to "Remove the worktree right after the ticket reaches
  `done`" — pre-suite removal that must be re-gated behind a green Closeout. The Closeout
  step opening (line 167-168) presents `(auto-merge + rebase-onto-default precondition +
  prune)` as unconditional, which is only true for `git.autoMerge: true` (and the prune
  only when `git.pruneMergedBranches` is not disabled and the `branch -d` succeeds).
  Dispatch guidance also lives in `## Execution profiles` (the `claude-subagent:<name>`
  bullet at line 61 introduces the dispatch-ledger/routing-validator hooks and the
  `Ticket: <id>` anchor).
- `skills/codex/local-team/SKILL.md` has a numbered `## Wave-Barrier Scheduling`
  (steps 1-6): step 4 runs the GENERIC `complete-step`/gate/`move` for every transition
  INCLUDING the terminal `move … done` and also drops `questions`/`blocked` tickets from
  in-flight without a Closeout, **step 5 "Refill open slots"** (line 47) precedes
  the separate non-numbered `## Closeout` section (lines 92-102), which ALSO owns
  `move … done` plus a stale-default recovery and a terminal
  fast-forward-then-worktree-remove sentence. This file therefore has BOTH problems: a
  faithful implementation could (a) move the terminal ticket twice (step 4 and Closeout)
  and (b) refill before — even remove the worktree before — the merge/suite sequence.
- `SKILL.md` (single-ticket, Claude) has `## Delegation` (lines 310-365).
- `plans/prompts/roles/code_reviewer.md` is the reviewer role prompt (intro at lines 1-3;
  no `## Rules`/`## Constraints` block — first heading is `## Output and Persistence`).
- `agents/claude/local-board-reviewer.md` has a `## Rules` bullet list (lines 17-25).
- `agents/codex/local-board-reviewer.md` has a `## Rules` bullet list (lines 19-26).
- `AGENTS.md` is repo-local contributor/agent guidance (`## Documentation Split`,
  `## Plan Files`). `CLAUDE.md` `@AGENTS.md`, so anything added to AGENTS.md reaches Claude
  sessions automatically.

### Merge-mode behavior of `move … done` (read from `src/cli.js` / `src/git.js`)

`moveAndMaybeMerge` (`src/cli.js:794`) gates all merge work on
`config.git.autoMerge === true`. `autoMergeTicketBranch` (`src/git.js:57`) has TWO
internal branches selected by whether the default is checked out in another worktree
(`branchCheckedOutElsewhere`), and its precondition (`assertAutoMergeReady`:
merge-branch check, no-non-planning-changes, ticket-branch-up-to-date) runs first:

- **`git.autoMerge: true`, normal worktree path** (the orchestrated case: `move` runs
  with `--root <worktreePath>` while the default is checked out at the project root).
  After the precondition and a planning-changes commit, `mergeBranchIntoDefaultRef`
  (`src/git.js:189`) builds the merge commit with `git commit-tree`
  (parents = old default + ticket branch) and advances the ref with
  `git update-ref refs/heads/<default>`. The project-root **checkout is never touched**,
  so it stays on the pre-merge tree until `local-board fast-forward` reconciles it —
  which is exactly why the suite must wait for fast-forward. The merged branch is pruned
  with `branch -d` only when `pruneMergedBranches` is not disabled and the delete is safe
  (`maybePruneMergedTicketBranch`, `src/git.js:110`, otherwise returns "skipped").
- **`git.autoMerge: true`, main-checkout path** (default is NOT checked out elsewhere —
  e.g. running from the project root itself). After the same precondition, the CLI
  `git switch <default>` then `git merge --no-ff <branch> -m "Merge <id>"`, then prunes
  (subject to the same `pruneMergedBranches`/safety gate). This `switch` + `merge --no-ff`
  description applies ONLY to this branch.
- **`git.autoMerge: false`** — `move … done` performs NO merge and NO rebase precondition;
  it only moves the ticket to `done` and commits planning changes (when
  `git.commitPlanningOnTransition` is on). The ticket branch is left unmerged; the
  orchestrator merges into default manually (see Item 1).
- **Planning commit already done when `git.commitPlanningOnTransition: true`** (the
  scaffold default and this board, `src/config.js:1094`; `src/cli.js:449` gates the auto
  commit on the flag). Every mutating command (`move`, `complete-step`) commits the
  planning edit as part of the transition, so after `move … done` the tree may already be
  clean — an unconditional follow-up commit would fail with "nothing to commit". Item 1's
  manual-merge wording therefore makes the commit conditional (commit only what the
  transition hook left uncommitted) before rebasing.

This is the factual basis for Item 1's branches: `autoMerge` decides WHO performs the
merge (and by which git mechanism), not WHETHER the post-merge suite runs. In the
`autoMerge: true` worktree path the default ref advances while the checkout stays on the
old tree, so the full suite MUST run only AFTER `local-board fast-forward` — otherwise it
tests pre-merge code (the finding-2 correction from an earlier round).

### Sync / test-guard machinery (read to bound the change)

- `scripts/sync-resources.mjs` mirrors ONLY `plans/prompts` -> `resources/prompts` and
  `plans/templates` -> `resources/templates` (LF-normalized). `agents/` is NOT synced; it
  ships directly via `package.json` `files`. So item 3's `code_reviewer.md` edit REQUIRES
  `npm run sync-resources`; the two reviewer agent-file edits do NOT.
- `test/resources-sync.test.js` asserts `resources/prompts` mirrors `plans/prompts`
  **content-identical modulo CRLF/LF normalization**, not byte-for-byte: it applies
  `normalizeEol` (`\r\n` -> `\n`) to both sides before `assert.equal` (see `normalizeEol`
  at line 34, used in `assertMirrored` lines 50-54). It also asserts the file SET matches.
  Editing `code_reviewer.md` without re-running sync-resources fails the content or file-set
  check; a pure CRLF-vs-LF working-tree difference does not.
- `test/skill-usage-sync.test.js` compares ONLY the fenced `sh` block under `## CLI Commands`
  in `SKILL.md` vs `skills/codex/local-board/SKILL.md`. Its text comparison is likewise
  **content-identical modulo CRLF/LF normalization** — it wraps both blocks in the same
  `normalizeEol` (line 20) before `assert.equal` (lines 85-89) — plus a shared command-name
  set, subset-of-usage, and required design-review commands. None of the four edits touch a
  `## CLI Commands` block, so this suite stays green as long as those fences are left
  otherwise intact (whitespace/EOL noise inside the fence is normalized away, but do not add,
  remove, or reflow command lines). It does not look at `SKILL_TEAM.md` or the codex
  `local-team` skill at all.
- `test/install.test.js` / `test/pack.test.js` assert the reviewer agent files and the two
  team skills are packaged/installed by PATH and existence, not by prose content.
- `test/tickets.test.js:757` asserts the reviewer step resolves the prompt PATH
  `plans/prompts/roles/code_reviewer.md` — a path, not content; body edits are safe.
- The routing-validator (`hooks/routing-validator.js`) is a Claude PreToolUse hook
  (matcher `Task|Agent`) that shells to `check-dispatch` and denies an agent mismatch. Codex
  orchestrators dispatch via `spawn_agent`, not the Task tool, so this denial is a
  Claude-harness-only phenomenon — decisive for item 2's mirror set (Claude skills only).

### Item-by-item design

#### Item 1 — post-merge full-suite closeout contract, gated ahead of refill (orchestrator audience)

Files: `SKILL_TEAM.md` (`## Control loop` + `## Worktrees`) AND
`skills/codex/local-team/SKILL.md` (`## Wave-Barrier Scheduling` + `## Closeout`).
Mirrors: these two team skills only. Single-ticket `SKILL.md` closeout is intentionally out
of scope (see Open questions).

The prior design appended the full-suite rule under Closeout only. That does NOT gate
refill, because in both skills the refill step is reached BEFORE the closeout merge/verify
text (SKILL_TEAM step 6 Refill precedes step 7 Closeout; codex step 5 Refill precedes the
separate `## Closeout` section). A textually-clean auto-merge can still break tests via a
removed-function call or other semantic conflict git cannot see (this masked 11 failures in
the B20260710T1225Z merge), so a freed slot could be refilled and new work dispatched on top
of a broken default. The fix must make the SEQUENCE guarantee, in each skill's own numbered
flow, that terminal Closeout performs the applicable merge, reconciles the checkout with
`fast-forward` FIRST, runs the merged-default full suite, and completes any fix-forward
BEFORE a `done` slot becomes refillable — which requires editing step ordering/text, not
just appending prose. Additionally, each skill's step 4 must be narrowed so the terminal
`move … done` is issued exactly once (in Closeout), never in step 4; otherwise, with
auto-merge on, step 4 merges and prunes the branch and the Closeout call fails before the
fast-forward/suite. Both recoveries already present (stale-default rebase-retry;
commit-before-rebase) must be PRESERVED, not discarded.

**Refill gate applies only to `done` exits.** The Closeout gate governs slots freed by a
terminal `done`; step 4 in BOTH skills also removes `questions`/`blocked` tickets from
in-flight WITHOUT any Closeout (a non-terminal exit has no merge/suite to run), so those
slots must free IMMEDIATELY. A refill trigger worded as "only after Closeout completes" would
therefore strand every slot vacated by a `questions`/`blocked` exit and stall ready work
(the round-5 defect). Each skill's Refill wording must state both rules explicitly: a
`questions`/`blocked` exit frees its slot at once; a `done` exit frees its slot only after
Closeout (applicable merge + fast-forward + green merged-default full suite + any fix-forward).

**Merge-mode branches (mandatory in BOTH modes).** The full test suite on the merged
default is MANDATORY whether `git.autoMerge` is on or off; the flag changes only WHO merges
and by which git mechanism, never whether the suite runs, and in either mode the suite runs
only AFTER `local-board fast-forward --json` has advanced the project-root checkout onto the
merged default:

- `git.autoMerge: true` — `move … done` performs the merge into default itself (worktree
  path: `commit-tree` + `update-ref`, checkout untouched; main-checkout path: `switch` +
  `git merge --no-ff`) and prunes the branch when `pruneMergedBranches` is not disabled and
  the delete is safe. The orchestrator then runs `fast-forward` in the project root and runs
  the full suite there.
- `git.autoMerge: false` — `move … done` does NOT merge; it only moves and (when
  `git.commitPlanningOnTransition` is on) commits the planning edit. The orchestrator then
  commits any post-`move` planning change the transition hook left uncommitted (because
  `git rebase` refuses a dirty tree), rebases the ticket branch onto the default in its
  worktree, then FROM THE PROJECT ROOT switches to the default and `git merge --no-ff
  <branch>`, then runs `fast-forward` and the full suite.

In neither mode may a `done` slot free or new work dispatch until that full suite is green
(fix forward first on failure, then re-run). Delete any prior "boards may enable
`git.autoMerge` so they need not gate refill on a manual suite run" wording — it is false and
was the source of an earlier self-contradiction.

**SKILL_TEAM.md edits (`## Control loop` + `## Worktrees`):**

1. **Narrow Control-loop step 4 to non-terminal transitions** (structural qualification of
   an existing numbered step, exempt from the sentence cap). The generic "Choose the next
   status from the returned `transitions` and `move`" must state that this covers
   NON-terminal transitions only; the terminal `move … done` is issued exclusively by
   Closeout (step 6 after the reorder). This mirrors the codex step-4 narrowing and removes
   the double-move exposure (step 4 then Closeout), which with auto-merge on would merge and
   prune the branch in step 4 and fail the Closeout call before the fast-forward/suite. Leave
   the existing step-4 sentence that drops `questions`/`blocked` tickets from in-flight AS IS
   (those are non-terminal exits with no Closeout; their slots free immediately per Refill).

2. **Reorder steps 6 and 7 so Closeout precedes Refill** (structural step-reorder, exempt
   from the sentence cap). Closeout becomes step 6; Refill becomes step 7. Safe: every
   cross-reference to these steps is by name ("See Closeout", "see Dispatch"), never by
   number, and the Concurrency-mode prose already describes the logical order as
   "advance + conflict-check + refill" (line 184), consistent with closeout-before-refill.
   No other renumbering is needed.

3. **Qualify the Closeout opening parenthetical by merge mode** (structural qualification,
   cap-exempt). The current `(auto-merge + rebase-onto-default precondition + prune)` after
   the `move … done` command is unconditional; restate it so those behaviors apply only when
   `git.autoMerge` is on — and the prune specifically only when `git.pruneMergedBranches` is
   not disabled and the `branch -d` succeeds — and in manual mode (`autoMerge: false`)
   `move … done` merely moves the ticket and the orchestrator performs the merge (as detailed
   in the final passage below).

4. **Keep the existing Closeout recovery sentences** (the stale-default
   rebase-onto-default-then-retry sentence, the "commit any planning-change edits before
   rebasing — move/complete-step leave the ticket file dirty and rebase refuses" sentence,
   and the "on an unresolvable conflict move to questions" sentence). Do NOT delete these —
   they carry recoveries the prior revision dropped.

5. **Replace ONLY the final Closeout sentence** (the current
   "After each successful `move … done`, run `fast-forward` … then `worktree-remove`.")
   with this passage (<=3 sentences, orchestrator audience):

   "After `move … done` succeeds: with `git.autoMerge` on the CLI already merged the branch
   into the default, and with it off you merge manually — commit any post-`move` planning
   edit the transition hook left uncommitted (with `git.commitPlanningOnTransition` on it is
   already committed; `git rebase` refuses a dirty tree), rebase the ticket branch onto the
   default in its worktree, then from the project root switch to the default and `git merge
   --no-ff <branch>`. Then run `local-board fast-forward --json` in the project root FIRST to
   advance your checkout onto the merged default, and only then run the FULL test suite
   there — a textually clean merge can still break tests via a semantic conflict git cannot
   see (this masked 11 failures in the B20260710T1225Z merge). On any failure fix forward and
   re-run the suite before `worktree-remove`; the `done` slot is not refillable until this
   green suite completes."

6. **Amend the (now step 7) Refill opening to distinguish exit types** (<=2 sentences,
   within the 1-3 cap). It must free `questions`/`blocked` slots immediately and gate only
   `done` slots on Closeout, e.g.:

   "A slot vacated by a step-4 `questions`/`blocked` exit frees immediately (those tickets
   leave in-flight without a Closeout), while a `done` ticket frees its slot only after its
   Closeout completes — the applicable merge, `local-board fast-forward`, a green
   merged-default full suite, and any fix-forward. When a slot is free by either rule and the
   ready queue is non-empty and in-flight `< maxInFlight`, pull the next ready ticket
   (`worktree-add`, then `begin-step`/`start-work` as in Dispatch) and begin dispatching it."

   (Keep the existing trailing "Newly-unblocked dependents and `decompose` children appear on
   the next `list --ready`." sentence.)

7. **Amend the `## Worktrees` section removal sentence** (structural qualification,
   cap-exempt). The sentence "Remove the worktree right after the ticket reaches `done`:"
   invites pre-suite removal; restate it to require a completed green Closeout (merge +
   fast-forward + merged-default full suite passed, plus any fix-forward) before
   `worktree-remove`, consistent with the Closeout contract above.

**skills/codex/local-team/SKILL.md edits (structural reorder + `## Closeout` replacement):**

The codex file needs BOTH a numbered-flow restructure (so the terminal move is not
duplicated and Closeout precedes Refill) AND a replacement of the stale terminal sentence in
its `## Closeout` section:

1. **`## Wave-Barrier Scheduling` step 4** — narrow the generic `move` to NON-terminal
   transitions (<=1 sentence added/qualified): "… run gate-check/specialty flow for
   design/implement/test, then `move` for non-terminal transitions only; terminal
   `move … done` is handled by Closeout (step 5) so the merged-default suite can gate the
   slot." Leave the existing step-4 handling that drops `questions`/`blocked` tickets from
   in-flight AS IS (a non-terminal exit, no Closeout; their slots free immediately). This
   removes the duplicate-move exposure.

2. **Insert a new numbered step 5 "Closeout" BEFORE Refill** (structural insertion; keep the
   step body <=3 sentences), pushing Refill to step 6 and Repeat to step 7:
   "5. **Closeout (terminal tickets only, before refill).** When a ticket reaches its
   terminal step, run the `## Closeout` sequence below — the terminal `move … done`
   (mode-branched merge), then `local-board fast-forward --json` FIRST, then the FULL suite
   on the merged default, then any fix-forward — and remove the worktree only after that
   suite is green. A `done` slot frees for refill only after this green suite completes."

3. **Renumber Refill to step 6 and Repeat to step 7, and mirror the exit-type distinction in
   the Refill reminder** (<=1 sentence). The steps carry no by-number cross-references, so
   renumbering is safe; the reminder must distinguish non-terminal exits from `done`, e.g.:

   "A `questions`/`blocked` exit frees its slot immediately, but a `done` exit frees its slot
   only after its Closeout suite is green (applicable merge + `fast-forward` + merged-default
   full suite + any fix-forward)."

4. **`## Closeout` section** — KEEP its first sentence (the `move … done` command) and KEEP
   its stale-default recovery sentences ("If it refuses because the branch lacks the latest
   default, commit planning-only ticket edits in the worktree, rebase the ticket branch onto
   default, and retry." and "If conflicts cannot be resolved safely, move the ticket to
   questions."). **REPLACE ONLY the final terminal sentence** ("After each successful `done`,
   run `fast-forward --json` in the project root and then `worktree-remove`.") with this
   passage (<=3 sentences), so the move is issued exactly once and the worktree is removed
   only after the suite passes:

   "With `git.autoMerge` on, `move … done` already merged the branch into the default (via
   `commit-tree` + `update-ref` when the default is checked out at the project root, leaving
   that checkout on the old tree) and pruned it when `git.pruneMergedBranches` is not disabled
   and the `branch -d` is safe (otherwise the branch remains); with it off, merge manually —
   commit any post-`move` planning edit the transition hook left uncommitted (with
   `git.commitPlanningOnTransition` on it is already committed), rebase the ticket branch
   onto the default in its worktree, then from the project root switch to the default and
   `git merge --no-ff <branch>`. Then run `local-board fast-forward --json` in the project
   root FIRST to advance your checkout onto the merged default, and only then run the FULL
   test suite there — a clean merge can still break tests via a semantic conflict git cannot
   see (this masked 11 failures in the B20260710T1225Z merge). On failure fix forward and
   re-run before `worktree-remove`; do not free or refill the `done` slot until that suite is
   green."

Audience note: both target skills are orchestrator skills; the substantive contract
(step 4 narrowed to non-terminal moves; terminal move issued once in Closeout; mandatory
merged-default full suite in both merge modes, run only after `fast-forward`, gating refill
and worktree-remove for `done` exits while `questions`/`blocked` exits free immediately;
explicit manual merge on `autoMerge: false` with a conditional planning commit; prune only
when configured and safe; both existing recoveries preserved) is identical across them. The
codex file additionally needs the numbered-flow restructure because its step 4 previously
issued the terminal move and its Refill preceded the separate `## Closeout` section.

#### Item 2 — dispatch denial-recovery hint (orchestrator audience, Claude only)

- Files: `SKILL_TEAM.md` (dispatch) AND single-ticket `SKILL.md` `## Delegation`.
- Mirrors: Claude skills ONLY. NO codex-mirror edit: the routing-validator is a Claude
  PreToolUse `Task|Agent` hook; Codex `spawn_agent` dispatches never trigger it, so the
  agent-mismatch denial cannot occur in the codex skills' world. This matches the ticket's
  own scope (item 2 names only the two Claude files).
- Anchors:
  - `SKILL_TEAM.md`: `## Execution profiles`, immediately after the `claude-subagent:<name>`
    bullet (line 61) that already describes the dispatch-ledger/routing-validator hooks and
    the `Ticket: <id>` anchor — the machinery the hint is about.
  - `SKILL.md`: `## Delegation`, as a short paragraph near the `claude-subagent:<agent-name>`
    handling (after line 317), the audience-correct home the ticket names.
- Proposed wording (orchestrator, both files, identical prose, 2 sentences):
  "If the routing-validator hook denies a dispatch with an agent-mismatch reason, first
  confirm you ran `begin-step` for the ticket's CURRENT stage before dispatching — the active
  begin-step ledger stamp is the hook's primary evidence, and a stale or missing stamp (e.g.
  dispatching a stage you never began, or re-dispatching after a loop-back) is the usual
  cause. Re-run `begin-step` for the current action, then retry the dispatch."

#### Item 3 — reviewer "no test-run" line (executor audience)

- Files: `plans/prompts/roles/code_reviewer.md`, `agents/claude/local-board-reviewer.md`,
  `agents/codex/local-board-reviewer.md`.
- Mirrors: the three reviewer files get the same sentence; `resources/prompts/roles/
  code_reviewer.md` is refreshed by `npm run sync-resources` (automatic, do not hand-edit).
- Anchors:
  - `code_reviewer.md`: add a sentence to the role body, right after the intro line "Review
    the implementation for correctness, maintainability, tests, and regressions." (line 2).
  - `agents/claude/local-board-reviewer.md`: add a new bullet under `## Rules` (alongside the
    existing "You have only Read, Glob, Grep, and Bash" bullet, line 23).
  - `agents/codex/local-board-reviewer.md`: add a new bullet under `## Rules` (line 22 area,
    near "Do not edit files...").
- Proposed wording (executor; role-prompt sentence form, 2 sentences):
  "Do not attempt to run the test suite: the review sandbox denies child-process spawning
  (attempts fail with EPERM and only burn tokens). Perform static review only — execution
  verification belongs to the test stage."
  Agent-file bullet form (same content, bullet-shaped, 2 sentences):
  "- Do not run the test suite. The review sandbox denies child-process spawning (spawn
  attempts fail with EPERM); do static review only and leave execution verification to the
  test stage."
- Audience note: all three are executor-facing reviewer definitions; text is content-identical
  across them (sentence vs bullet shape only).

#### Item 4 — prompt/agents-are-production-artifacts maintenance note (contributor audience)

- Placement decision: `AGENTS.md` (NOT `SKILL.md`). Rationale: this is a maintenance rule for
  contributors/agents editing THIS repo. `SKILL.md` is packaged and installed into consumer
  projects, where a note about local-board's own content-assertion tests is meaningless and
  would also risk perturbing the `## CLI Commands` sync. `AGENTS.md` is repo-local dev
  guidance and, via `CLAUDE.md`'s `@AGENTS.md` include, reaches Claude sessions automatically.
- Mirrors: none. `AGENTS.md` is neither synced to `resources/` nor asserted by any test.
- Anchor: a short note under `## Plan Files` (or a new `## Prompt and Agent Files` subsection
  after it), since that section already governs `plans/` artifacts.
- Proposed wording (contributor audience, 2 sentences):
  "Prompt files under `plans/prompts/` and agent definitions under `agents/` are production
  artifacts: content-assertion tests run against their text (e.g. `test/cli.test.js`'s
  estimate-prompt assertions, `test/resources-sync.test.js`). After editing any of them, run
  the FULL test suite (`node --test`), not just the guard suites, and remember that any
  `plans/prompts` edit also needs `npm run sync-resources` to refresh `resources/prompts`."

### Affected files (summary)

| File | Item | Sync/mirror action |
|---|---|---|
| `SKILL_TEAM.md` | 1, 2 | none (not synced); Item 1 narrows step 4 to non-terminal moves, reorders steps 6/7, qualifies the Closeout opening by merge mode (prune only when configured/safe), keeps Closeout recoveries + replaces its final sentence, amends Refill so `questions`/`blocked` exits free immediately and only `done` exits gate on Closeout, and re-gates the `## Worktrees` removal sentence behind a green Closeout |
| `skills/codex/local-team/SKILL.md` | 1 | none; Item 1 narrows step 4 to non-terminal moves, inserts a numbered Closeout step 5 before Refill (Refill->6, Repeat->7) with the `questions`/`blocked`-vs-`done` refill distinction, keeps Closeout recoveries + replaces the terminal fast-forward/worktree-remove sentence (conditional planning commit; prune only when configured/safe) |
| `SKILL.md` | 2 | none (leave `## CLI Commands` untouched) |
| `plans/prompts/roles/code_reviewer.md` | 3 | `npm run sync-resources` -> `resources/prompts/roles/code_reviewer.md` |
| `agents/claude/local-board-reviewer.md` | 3 | none (agents ship directly) |
| `agents/codex/local-board-reviewer.md` | 3 | none |
| `AGENTS.md` | 4 | none |

### Risks

- Refill-exit stranding: gating ALL slot refills on a completed Closeout would strand slots
  freed by step-4 `questions`/`blocked` exits (which carry no Closeout) and stall ready work.
  Both team skills' Refill wording must free non-terminal exits immediately and gate only
  `done` exits on the merge/fast-forward/green-suite/fix-forward sequence.
- Forgetting `npm run sync-resources` after the `code_reviewer.md` edit -> `resources-sync`
  suite red (content/file-set mismatch, not an EOL artifact). This is the single most likely
  miss; it is exactly the class of failure item 4 documents.
- Accidentally adding, removing, or reflowing a command line inside a `## CLI Commands` fenced
  block in `SKILL.md` while adding the item-2 Delegation paragraph -> `skill-usage-sync`
  content assertion red. (Pure CRLF/LF differences inside the fence are normalized away by the
  test's `normalizeEol`, so they will not fail it — but do not touch the command lines.) Keep
  edits strictly outside those fences.
- Double-move regression: in EITHER team skill a terminal `move … done` must fire exactly
  once (in Closeout), never in step 4. After narrowing both step 4s, confirm no numbered step
  before Closeout issues `move … done`; with auto-merge on, a duplicate call merges/prunes on
  the first pass and the second fails its precondition before the fast-forward/suite.
- Codex restructure correctness: after narrowing step 4 to non-terminal moves and inserting
  the numbered Closeout step 5, confirm the terminal `move … done` is issued EXACTLY ONCE
  (only via the `## Closeout` section, referenced by step 5), that no prose still implies
  Refill runs before Closeout, that the `questions`/`blocked`-vs-`done` refill distinction is
  present, and that the worktree is removed only after the green suite.
- Prune over-assertion: `maybePruneMergedTicketBranch` (`src/git.js:110`) skips the
  `branch -d` when `pruneMergedBranches` is disabled, the branch is checked out elsewhere, or
  the delete is unsafe, so both Closeout passages must qualify pruning as "only when
  configured and successful", not as an unconditional consequence of auto-merge.
- Conditional-commit regression: with `git.commitPlanningOnTransition: true` (scaffold and
  this board) the transition already commits the planning edit, so the manual-merge wording
  must commit only what the hook left uncommitted — an unconditional commit fails on a clean
  tree. Both team skills' passages must carry the conditional phrasing.
- Dropped-recovery regression: the replacement must preserve BOTH team skills' existing
  recoveries — the stale-default rebase-onto-default-then-retry AND the
  commit-before-rebase note (manual-mode `move` may leave planning state dirty; rebase refuses
  a dirty tree). Only the final terminal fast-forward/worktree-remove sentence is replaced.
- Stale worktree-removal prose: after re-gating `SKILL_TEAM.md`'s `## Worktrees` removal
  sentence and both Closeout sequences behind a green suite, confirm no remaining sentence
  still says to remove the worktree "right after `done`" ahead of the suite.
- Ordering regression: if the full suite is run before `local-board fast-forward`, the
  `autoMerge: true` worktree path tests the pre-merge tree (ref advanced, checkout not) and
  the semantic-conflict guard is void. Fast-forward MUST precede the suite in both modes.
- Cross-skill Item-1 parity: no test enforces it; the reviewer must eyeball both team skills'
  contracts for identical substance.
- Over-scoping item 2 into the codex mirrors would be wrong (hook is Claude-only); avoid it.

### Test strategy / verification plan

1. Make the edits (four items; Item 1 = SKILL_TEAM step-4 non-terminal narrowing + step 6/7
   reorder + Closeout-opening merge-mode qualification + Closeout final-sentence replacement
   + Refill exit-type amendment + `## Worktrees` removal re-gating, AND codex step-4 narrowing
   + inserted Closeout step 5 + Refill/Repeat renumber with exit-type reminder + codex
   `## Closeout` terminal-sentence replacement).
2. `npm run sync-resources` (mandatory because `plans/prompts/roles/code_reviewer.md` changed).
3. `npm run check` (syntax gate; unaffected by md but part of the standard gate).
4. `node --test` — the FULL suite, not just guard suites (this ticket is itself the reason).
   Specifically expect green: `test/resources-sync.test.js` (mirror refreshed; content-equal
   modulo EOL), `test/skill-usage-sync.test.js` (CLI blocks untouched; content-equal modulo
   EOL), `test/prompt-scaffold.test.js`, `test/cli.test.js` estimate-prompt assertions
   (untouched prompts), `test/install.test.js` / `test/pack.test.js` / `test/tickets.test.js`
   (path/existence only).
5. Confirm no `## CLI Commands` fence command lines changed (git diff review of `SKILL.md`),
   eyeball SKILL_TEAM/codex Item-1 parity, confirm both step 4s are narrowed to non-terminal
   moves, the SKILL_TEAM reorder and Worktrees re-gating, the codex step-4-narrow + inserted
   step 5 + renumber, verify the terminal move fires exactly once in each skill, both existing
   recoveries survive in both skills, the conditional planning commit phrasing is present, the
   `questions`/`blocked`-vs-`done` refill distinction is present in both skills, pruning is
   qualified as configured-and-successful in both Closeout passages, and the
   fast-forward-before-suite ordering holds in every branch.

### Open questions

- Item 1 scope: single-ticket `SKILL.md` closeout also merges to the default branch and has
  the same semantic-conflict exposure, but the ticket explicitly limits item 1 to the two
  team skills. Design honors that scope; flagging in case the reviewer wants the single-ticket
  Closeout to carry the same full-suite contract. (Not blocking.)

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-10T15:40:30Z: Ensured git branch local-board/T20260710T1533Z-skills-process-hardening-from-the-2026-07-10-parallel-run-retro-post-merge-suite-denial-hint-reviewer-no-test-run-prompt-edit-full-suite (already-current).

- 2026-07-10T15:46:50Z: Completed design via claude-subagent:local-board-designer@opus: Four additive prose insertions designed with exact anchors: post-merge full-suite Closeout contract (both team skills), denial-recovery hint (Claude skills only; codex spawn_agent never triggers hook), reviewer no-test-run line (3 reviewer files + sync-resources), production-artifacts note in AGENTS.md. Estimate 2pts basis T20260710T1223Z.

- 2026-07-10T15:50:38Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: none requested (prose-only skill/prompt edits; no security/UI/UX triggers)

- 2026-07-10T15:59:23Z: Design review (codex-task:read-only gpt-5.6-sol@xhigh): FAIL. [High] Item 1 in Closeout does not gate refill: SKILL_TEAM control-loop step 6 refills before step 7 Closeout (same for codex wave-barrier step 5); closeout also lacks explicit manual-merge op for autoMerge:false. [Medium] Item 1 wording contradiction: full-suite-after-merge mandatory vs autoMerge alternative avoiding it. [Low] sync tests compare content modulo CRLF/LF normalization, not byte-identical. Disposition: design returns for revision; token intentionally not recorded until re-review passes.

- 2026-07-10T16:10:51Z: Design re-review (sol@xhigh): FAIL. [High] Revision payload used H2 headings - terminated Technical Design section, obsolete prior design stranded below (the very defect class B20260710T1532Z fixes). [High] Both Closeout sequences run the suite before fast-forward - tests pre-merge tree; fast-forward must precede the full suite. [High] Item 1 wording exceeds the 1-3 sentence acceptance criterion (7 and 4 sentences). Disposition: designer repairs ticket body (H3-only internal headings, remove stranded blocks) and condenses; third review round to follow.

- 2026-07-10T16:25:09Z: Design review #3 (sol@xhigh): FAIL. [High] Codex team flow not structurally reordered - wave-barrier step 4 still moves, step 5 still refills, old Closeout fast-forward/worktree-remove sentence would duplicate move and remove worktree pre-suite; put Closeout in the numbered flow before Refill and replace the old terminal sentence. [High] SKILL_TEAM Closeout replacement drops stale-default rebase-retry recovery and leaves post-move planning dirt uncommitted in manual mode (rebase would refuse). [Low] autoMergeTicketBranch worktree path uses commit-tree + update-ref, not switch+merge; describe both branches. Disposition: revision #3.

- 2026-07-10T16:45:03Z: Design review #4 (sol@xhigh): FAIL. [High] SKILL_TEAM step 4 move left generic while codex step 4 was narrowed - terminal move..done could fire in step 4 then again in Closeout (double-move; auto-merge prunes branch, second call fails pre-suite); qualify step 4 non-terminal, reserve terminal move for Closeout. [Medium] Worktrees section still says remove worktree immediately at done, Closeout opening still says move..done always auto-merges/rebases/prunes - contradict suite-before-removal and manual mode; amend both. [Medium] Manual-mode passage assumes move leaves dirty planning edit; with commitPlanningOnTransition:true it is already committed - make the commit conditional. Disposition: revision #4 (mechanical); round-5 FAIL on new findings escalates to questions.

- 2026-07-10T17:00:19Z: Design review #5 (sol@xhigh): FAIL. [High] New: proposed Refill condition requires completed Closeout, but step-4 questions/blocked exits drop tickets from in-flight without Closeout - those slots could never refill; distinguish: questions/blocked exits free slots immediately, done exits free after merge+ff+green suite+fix-forward. [Low] Qualify branch pruning as only-when-configured-and-successful (pruneMergedBranches). Disposition: final revision #5 (one-sentence fix); round 6 is hard stop - non-PASS/CONCERNS goes to questions.

- 2026-07-10T17:17:34Z: Design review #6 (sol@xhigh): CONCERNS - 1 Medium: SKILL_TEAM edits 4-5 preserve the absolute 'move/complete-step leave the ticket dirty' claim while the manual-mode passage is conditional; implementer must conditionalize the preserved sentence (commit only what the transition hook left uncommitted). Orchestrator disposition: proceed to implementation with the conditionalization folded into the implementer brief. Six review rounds total; verdicts FAIL x5 then CONCERNS.

- 2026-07-10T17:17:34Z: Recorded design review via codex-task:read-only@gpt-5.6-sol: CONCERNS after 6 rounds: 1 Medium (conditionalize preserved dirty-ticket claim), folded into implementation; all High findings from rounds 1-5 resolved in design

- 2026-07-10T17:17:35Z: Ensured git branch local-board/T20260710T1533Z-skills-process-hardening-from-the-2026-07-10-parallel-run-retro-post-merge-suite-denial-hint-reviewer-no-test-run-prompt-edit-full-suite (already-current).
