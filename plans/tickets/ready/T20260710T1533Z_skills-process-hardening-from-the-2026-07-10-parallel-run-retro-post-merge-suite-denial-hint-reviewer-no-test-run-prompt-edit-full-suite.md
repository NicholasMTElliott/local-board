---
id: T20260710T1533Z
type: task
status: ready_for_design
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
updated: 2026-07-10T16:10:51Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
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
Item 1 additionally amends the team-skill scheduling sequence (not just Closeout prose)
so the post-merge full suite provably gates slot refill.

## Related tickets and conflicts

- Incident sources are all from the 2026-07-10 parallel run (B20260710T1225Z merge break;
  two orchestrator agent-mismatch misses; codex review spawn-EPERM; an estimate-prompt
  assertion break from a prior reword). No open ticket touches these same anchors, so no
  merge conflict is expected. The edits are additive prose plus one control-loop reorder.

## Insertion-point survey (confirmed by reading each file)

- `SKILL_TEAM.md` has a numbered `## Control loop` (steps 1-8): 1 Seed, 2 Dispatch,
  3 Await, 4 On completion, 5 Conflict gate, **6 Refill** (lines 162-166), **7 Closeout**
  (lines 167-175), 8 Terminate. Closeout owns `move ... done`; Refill textually precedes it.
  Cross-references between steps are by NAME ("See Closeout", "see Dispatch"), never by
  number, so the steps can be reordered without dangling references. Dispatch guidance also
  lives in `## Execution profiles` (the `claude-subagent:<name>` bullet at line 61 introduces
  the dispatch-ledger/routing-validator hooks and the `Ticket: <id>` anchor).
- `skills/codex/local-team/SKILL.md` has a numbered `## Wave-Barrier Scheduling` (steps 1-6):
  step 4 does `complete-step`/`move`, **step 5 "Refill open slots"** (line 47) precedes the
  separate non-numbered `## Closeout` section (lines 92-102), which owns `move ... done`.
  Same latent ordering: refill is reached before the closeout merge/verify text.
- `SKILL.md` (single-ticket, Claude) has `## Delegation` (lines 310-365).
- `plans/prompts/roles/code_reviewer.md` is the reviewer role prompt (intro at lines 1-3;
  no `## Rules`/`## Constraints` block — first heading is `## Output and Persistence`).
- `agents/claude/local-board-reviewer.md` has a `## Rules` bullet list (lines 17-25).
- `agents/codex/local-board-reviewer.md` has a `## Rules` bullet list (lines 19-26).
- `AGENTS.md` is repo-local contributor/agent guidance (`## Documentation Split`,
  `## Plan Files`). `CLAUDE.md` `@AGENTS.md`, so anything added to AGENTS.md reaches Claude
  sessions automatically.

## Merge-mode behavior of `move ... done` (read from `src/cli.js` / `src/git.js`)

`moveAndMaybeMerge` (`src/cli.js:794`) gates all merge work on
`config.git.autoMerge === true`:

- **`git.autoMerge: true`** — `move ... done` runs `assertAutoMergeReady` (the
  rebase-onto-default precondition) and then `autoMergeTicketBranch` (`src/git.js:57`),
  which switches to the default branch, `git merge --no-ff <ticket-branch>`, and prunes.
  The CLI performs the merge into default.
- **`git.autoMerge: false`** — `move ... done` performs NO merge and NO rebase precondition;
  it only moves the ticket to `done` and commits planning changes. The ticket branch is left
  unmerged. **The orchestrator must merge into default manually** (commit planning edits,
  rebase the ticket branch onto default, switch to default, `git merge --no-ff <branch>`) —
  the same non-fast-forward merge the CLI would otherwise do.

This is the factual basis for Item 1's two branches: `autoMerge` decides WHO performs the
merge, not WHETHER the post-merge suite runs.

## Sync / test-guard machinery (read to bound the change)

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

## Item-by-item design

### Item 1 — post-merge full-suite closeout contract, gated ahead of refill (orchestrator audience)

Files: `SKILL_TEAM.md` `## Control loop` AND `skills/codex/local-team/SKILL.md`
(`## Wave-Barrier Scheduling` + `## Closeout`). Mirrors: these two team skills only.
Single-ticket `SKILL.md` closeout is intentionally out of scope (see Open questions).

The prior design appended the full-suite rule under Closeout only. That does NOT gate
refill, because in both skills the refill step is reached BEFORE the closeout merge/verify
text (SKILL_TEAM step 6 Refill precedes step 7 Closeout; codex step 5 Refill precedes the
`## Closeout` section). A textually-clean auto-merge can still break tests via a
removed-function call or other semantic conflict git cannot see (this masked 11 failures in
the B20260710T1225Z merge), so a freed slot could be refilled and new work dispatched on top
of a broken default. The fix must make the SEQUENCE guarantee: terminal Closeout performs the
applicable merge, runs the merged-default full suite, and completes any fix-forward BEFORE the
slot becomes refillable — which requires editing the step ordering/text, not just appending
prose.

**Unambiguous merge-mode branches (resolves the earlier self-contradiction).** The full test
suite on the merged default branch is **MANDATORY in BOTH modes**. `git.autoMerge` changes
only WHO performs the merge, never whether the suite runs:

- `git.autoMerge: true` — `move ... done` performs the merge into default (rebase precondition
  + `git merge --no-ff` + prune). The orchestrator then runs the full suite on the resulting
  default branch.
- `git.autoMerge: false` — `move ... done` does NOT merge; the orchestrator performs an
  explicit manual merge into the default branch (commit planning edits, rebase the ticket
  branch onto default, switch to default, `git merge --no-ff <branch>`) and then runs the full
  suite on the merged default branch.

In neither mode may a slot free or new work dispatch until that full suite is green (fix
forward first on failure). Delete the prior "boards may enable `git.autoMerge` so they need
not gate refill on a manual suite run" wording entirely — it is the source of the
contradiction and is now false.

**SKILL_TEAM.md edits (`## Control loop`):**

1. **Reorder steps 6 and 7 so Closeout precedes Refill.** Closeout becomes step 6; Refill
   becomes step 7. This is safe: every cross-reference to these steps is by name ("See
   Closeout", "see Dispatch"), never by number, and the Concurrency-mode prose already
   describes the logical order as "advance + conflict-check + refill" (line 184), consistent
   with closeout-before-refill. No other renumbering is needed.

2. **Rewrite the (now step 6) Closeout body** so the sequence is
   move -> merge (mode-branched) -> merged-default full suite -> fix-forward -> free slot.
   Replace the existing Closeout paragraph with wording of this shape (orchestrator audience):

   "**Closeout.** On a ticket's terminal step, run
   `move <ticket-id> done --root <worktreePath> --json`. Commit any planning-change edits in
   the worktree first — `move`/`complete-step` leave the ticket file dirty and `git rebase`
   refuses a dirty tree. With `git.autoMerge` on, `move ... done` runs the rebase-onto-default
   precondition and merges the branch into the default; if it refuses because the branch lacks
   the latest default, rebase onto default in the worktree and retry, and on an unresolvable
   conflict `move` the ticket to `questions`. With `git.autoMerge` off, `move ... done` does
   NOT merge — perform the merge manually: rebase the ticket branch onto default, switch to
   the default branch, and `git merge --no-ff` the ticket branch. In BOTH cases, once the
   branch is on the default, run the FULL test suite on the merged default branch — a
   textually clean merge can still break tests via a removed-function call or other semantic
   conflict git cannot see (this masked 11 failures in the B20260710T1225Z merge). On any
   unexpected failure, fix forward immediately and re-run the suite before proceeding. Only
   after the merged-default suite is green run `local-board fast-forward --json` to reconcile
   your checkout and `worktree-remove`. The slot is not refillable until this closeout
   completes."

3. **Amend the (now step 7) Refill opening** to state the precondition explicitly, e.g.:
   "When an in-flight ticket's Closeout has completed (merge + green merged-default full suite
   + any fix-forward) and the ready queue is non-empty and in-flight `< maxInFlight`, pull the
   next ready ticket ..." — so the refill text itself points back to the gating closeout.

**skills/codex/local-team/SKILL.md edits:**

1. **`## Wave-Barrier Scheduling` step 5 (Refill)** — change "Refill open slots with newly
   ready tickets." to gate on closeout: "Refill open slots with newly ready tickets — but a
   slot only frees after its ticket's Closeout (below) has merged the branch, run the full
   suite on the merged default branch, and completed any fix-forward." This makes the
   numbered sequence enforce closeout-before-refill even though `## Closeout` is a separate
   later section.

2. **`## Closeout` section** — extend it with the same mode-branched contract (identical
   substantive prose to SKILL_TEAM, kept in the codex file's terser style):
   "With `git.autoMerge` on, `move ... done` merges the branch into the default. With
   `git.autoMerge` off it does not — after committing planning edits and rebasing onto
   default, switch to the default branch and `git merge --no-ff` the ticket branch yourself.
   In both modes, once merged, run the FULL test suite on the merged default branch before
   `fast-forward`/`worktree-remove` and before refilling the slot — a clean merge can still
   break tests via a semantic conflict git cannot see (this masked 11 failures in the
   B20260710T1225Z merge). On failure, fix forward immediately, then re-run, before
   dispatching new work."

Audience note: both target skills are orchestrator skills; the substantive contract (mandatory
merged-default full suite in both merge modes, gating refill, with an explicit manual merge on
`autoMerge: false`) is identical across them.

### Item 2 — dispatch denial-recovery hint (orchestrator audience, Claude only)

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
- Proposed wording (orchestrator, both files, identical prose):
  "If the routing-validator hook denies a dispatch with an agent-mismatch reason, first
  confirm you ran `begin-step` for the ticket's CURRENT stage before dispatching — the active
  begin-step ledger stamp is the hook's primary evidence, and a stale or missing stamp (e.g.
  dispatching a stage you never began, or re-dispatching after a loop-back) is the usual
  cause. Re-run `begin-step` for the current action, then retry the dispatch."

### Item 3 — reviewer "no test-run" line (executor audience)

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
- Proposed wording (executor; role-prompt sentence form):
  "Do not attempt to run the test suite: the review sandbox denies child-process spawning
  (attempts fail with EPERM and only burn tokens). Perform static review only — execution
  verification belongs to the test stage."
  Agent-file bullet form (same content, bullet-shaped):
  "- Do not run the test suite. The review sandbox denies child-process spawning (spawn
  attempts fail with EPERM); do static review only and leave execution verification to the
  test stage."
- Audience note: all three are executor-facing reviewer definitions; text is content-identical
  across them (sentence vs bullet shape only).

### Item 4 — prompt/agents-are-production-artifacts maintenance note (contributor audience)

- Placement decision: `AGENTS.md` (NOT `SKILL.md`). Rationale: this is a maintenance rule for
  contributors/agents editing THIS repo. `SKILL.md` is packaged and installed into consumer
  projects, where a note about local-board's own content-assertion tests is meaningless and
  would also risk perturbing the `## CLI Commands` sync. `AGENTS.md` is repo-local dev
  guidance and, via `CLAUDE.md`'s `@AGENTS.md` include, reaches Claude sessions automatically.
- Mirrors: none. `AGENTS.md` is neither synced to `resources/` nor asserted by any test.
- Anchor: a short note under `## Plan Files` (or a new `## Prompt and Agent Files` subsection
  after it), since that section already governs `plans/` artifacts.
- Proposed wording (contributor audience):
  "Prompt files under `plans/prompts/` and agent definitions under `agents/` are production
  artifacts: content-assertion tests run against their text (e.g. `test/cli.test.js`'s
  estimate-prompt assertions, `test/resources-sync.test.js`). After editing any of them, run
  the FULL test suite (`node --test`), not just the guard suites, and remember that any
  `plans/prompts` edit also needs `npm run sync-resources` to refresh `resources/prompts`."

## Affected files (summary)

| File | Item | Sync/mirror action |
|---|---|---|
| `SKILL_TEAM.md` | 1, 2 | none (not synced); Item 1 reorders steps 6/7 + rewrites Closeout/Refill |
| `skills/codex/local-team/SKILL.md` | 1 | none; amend Wave-Barrier step 5 + `## Closeout` |
| `SKILL.md` | 2 | none (leave `## CLI Commands` untouched) |
| `plans/prompts/roles/code_reviewer.md` | 3 | `npm run sync-resources` -> `resources/prompts/roles/code_reviewer.md` |
| `agents/claude/local-board-reviewer.md` | 3 | none (agents ship directly) |
| `agents/codex/local-board-reviewer.md` | 3 | none |
| `AGENTS.md` | 4 | none |

## Risks

- Forgetting `npm run sync-resources` after the `code_reviewer.md` edit -> `resources-sync`
  suite red (content/file-set mismatch, not an EOL artifact). This is the single most likely
  miss; it is exactly the class of failure item 4 documents.
- Accidentally adding, removing, or reflowing a command line inside a `## CLI Commands` fenced
  block in `SKILL.md` while adding the item-2 Delegation paragraph -> `skill-usage-sync`
  content assertion red. (Pure CRLF/LF differences inside the fence are normalized away by the
  test's `normalizeEol`, so they will not fail it — but do not touch the command lines.) Keep
  edits strictly outside those fences.
- Item 1 reorder correctness: after swapping SKILL_TEAM steps 6/7, confirm no prose still
  implies Refill runs before Closeout, and that the Refill opening's new precondition matches
  the Closeout body. The two team-skill contracts must stay in parity (no test enforces
  cross-skill Item-1 parity — the reviewer must eyeball both).
- Over-scoping item 2 into the codex mirrors would be wrong (hook is Claude-only); avoid it.

## Test strategy / verification plan

1. Make the edits (four items; Item 1 includes the SKILL_TEAM step reorder + codex Refill/
   Closeout amendments).
2. `npm run sync-resources` (mandatory because `plans/prompts/roles/code_reviewer.md` changed).
3. `npm run check` (syntax gate; unaffected by md but part of the standard gate).
4. `node --test` — the FULL suite, not just guard suites (this ticket is itself the reason).
   Specifically expect green: `test/resources-sync.test.js` (mirror refreshed; content-equal
   modulo EOL), `test/skill-usage-sync.test.js` (CLI blocks untouched; content-equal modulo
   EOL), `test/prompt-scaffold.test.js`, `test/cli.test.js` estimate-prompt assertions
   (untouched prompts), `test/install.test.js` / `test/pack.test.js` / `test/tickets.test.js`
   (path/existence only).
5. Confirm no `## CLI Commands` fence command lines changed (git diff review of `SKILL.md`),
   and eyeball SKILL_TEAM/codex Item-1 parity plus the step reorder.

## Open questions

- Item 1 scope: single-ticket `SKILL.md` closeout also merges to the default branch and has
  the same semantic-conflict exposure, but the ticket explicitly limits item 1 to the two
  team skills. Design honors that scope; flagging in case the reviewer wants the single-ticket
  Closeout to carry the same full-suite contract. (Not blocking.)

## Related tickets and conflicts

- Incident sources are all from the 2026-07-10 parallel run (B20260710T1225Z merge break;
  two orchestrator agent-mismatch misses; codex review spawn-EPERM; an estimate-prompt
  assertion break from a prior reword). No open ticket touches these same anchors, so no
  merge conflict is expected. The edits are additive prose only.

## Insertion-point survey (confirmed by reading each file)

- `SKILL_TEAM.md` has an orchestrator-audience `## Closeout` (control-loop step 7, lines
  167-175) and dispatch guidance in `## Execution profiles` (the `claude-subagent:<name>`
  bullet at line 61 already introduces the dispatch-ledger/routing-validator hooks and the
  `Ticket: <id>` anchor) plus control-loop step 2 "Dispatch." (line 108).
- `skills/codex/local-team/SKILL.md` has a matching orchestrator `## Closeout` (lines 92-102).
- `SKILL.md` (single-ticket, Claude) has `## Delegation` (lines 310-365).
- `plans/prompts/roles/code_reviewer.md` is the reviewer role prompt (intro at lines 1-3;
  no `## Rules`/`## Constraints` block — first heading is `## Output and Persistence`).
- `agents/claude/local-board-reviewer.md` has a `## Rules` bullet list (lines 17-25).
- `agents/codex/local-board-reviewer.md` has a `## Rules` bullet list (lines 19-26).
- `AGENTS.md` is repo-local contributor/agent guidance (`## Documentation Split`,
  `## Plan Files`). `CLAUDE.md` `@AGENTS.md`, so anything added to AGENTS.md reaches Claude
  sessions automatically.

## Sync / test-guard machinery (read to bound the change)

- `scripts/sync-resources.mjs` mirrors ONLY `plans/prompts` -> `resources/prompts` and
  `plans/templates` -> `resources/templates` (LF-normalized). `agents/` is NOT synced; it
  ships directly via `package.json` `files`. So item 3's `code_reviewer.md` edit REQUIRES
  `npm run sync-resources`; the two reviewer agent-file edits do NOT.
- `test/resources-sync.test.js` asserts `resources/prompts` is byte-for-byte identical to
  `plans/prompts`. Editing `code_reviewer.md` without re-running sync-resources fails this.
- `test/skill-usage-sync.test.js` compares ONLY the fenced `sh` block under `## CLI Commands`
  in `SKILL.md` vs `skills/codex/local-board/SKILL.md` (byte-identical + shared command-name
  set + subset-of-usage + required design-review commands). None of the four edits touch a
  `## CLI Commands` block, so this suite stays green as long as those fences are left exactly
  as-is. It does not look at `SKILL_TEAM.md` or the codex `local-team` skill at all.
- `test/install.test.js` / `test/pack.test.js` assert the reviewer agent files and the two
  team skills are packaged/installed by PATH and existence, not by prose content.
- `test/tickets.test.js:757` asserts the reviewer step resolves the prompt PATH
  `plans/prompts/roles/code_reviewer.md` — a path, not content; body edits are safe.
- The routing-validator (`hooks/routing-validator.js`) is a Claude PreToolUse hook
  (matcher `Task|Agent`) that shells to `check-dispatch` and denies an agent mismatch. Codex
  orchestrators dispatch via `spawn_agent`, not the Task tool, so this denial is a
  Claude-harness-only phenomenon — decisive for item 2's mirror set (Claude skills only).

## Item-by-item design

### Item 1 — post-merge full-suite Closeout contract (orchestrator audience)

- Files: `SKILL_TEAM.md` `## Closeout` (step 7) AND `skills/codex/local-team/SKILL.md`
  `## Closeout`. Mirrors: these two team skills only. Single-ticket `SKILL.md` closeout is
  intentionally out of scope (see Open questions).
- Anchor: append to the Closeout step, after the existing `fast-forward` / `worktree-remove`
  sentence, so the sequence reads move -> merge -> full-suite verify -> refill.
- Proposed wording (orchestrator, both files, identical prose):
  "After each `move ... done` (auto-merge, or a manual merge when `git.autoMerge` is off),
  run the FULL test suite on the merged default branch before refilling a slot or dispatching
  new work — a textually clean auto-merge can still break tests via a removed-function call or
  other semantic conflict git cannot see (this masked 11 failures in the B20260710T1225Z
  merge). On an unexpected failure, fix forward immediately before starting new work. Boards
  that would rather not gate refill on a manual suite run may instead enable `git.autoMerge`
  so the CLI's rebase-onto-default precondition runs on every `move ... done`."
- Audience note: both target skills are orchestrator skills, so the prose is shared verbatim
  (Codex file keeps its terser surrounding style but the added sentence is identical).

### Item 2 — dispatch denial-recovery hint (orchestrator audience, Claude only)

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
- Proposed wording (orchestrator, both files, identical prose):
  "If the routing-validator hook denies a dispatch with an agent-mismatch reason, first
  confirm you ran `begin-step` for the ticket's CURRENT stage before dispatching — the active
  begin-step ledger stamp is the hook's primary evidence, and a stale or missing stamp (e.g.
  dispatching a stage you never began, or re-dispatching after a loop-back) is the usual
  cause. Re-run `begin-step` for the current action, then retry the dispatch."

### Item 3 — reviewer "no test-run" line (executor audience)

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
- Proposed wording (executor; role-prompt sentence form):
  "Do not attempt to run the test suite: the review sandbox denies child-process spawning
  (attempts fail with EPERM and only burn tokens). Perform static review only — execution
  verification belongs to the test stage."
  Agent-file bullet form (same content, bullet-shaped):
  "- Do not run the test suite. The review sandbox denies child-process spawning (spawn
  attempts fail with EPERM); do static review only and leave execution verification to the
  test stage."
- Audience note: all three are executor-facing reviewer definitions; text is content-identical
  across them (sentence vs bullet shape only).

### Item 4 — prompt/agents-are-production-artifacts maintenance note (contributor audience)

- Placement decision: `AGENTS.md` (NOT `SKILL.md`). Rationale: this is a maintenance rule for
  contributors/agents editing THIS repo. `SKILL.md` is packaged and installed into consumer
  projects, where a note about local-board's own content-assertion tests is meaningless and
  would also risk the byte-identical `## CLI Commands` sync. `AGENTS.md` is repo-local dev
  guidance and, via `CLAUDE.md`'s `@AGENTS.md` include, reaches Claude sessions automatically.
- Mirrors: none. `AGENTS.md` is neither synced to `resources/` nor asserted by any test.
- Anchor: a short note under `## Plan Files` (or a new `## Prompt and Agent Files` subsection
  after it), since that section already governs `plans/` artifacts.
- Proposed wording (contributor audience):
  "Prompt files under `plans/prompts/` and agent definitions under `agents/` are production
  artifacts: content-assertion tests run against their text (e.g. `test/cli.test.js`'s
  estimate-prompt assertions, `test/resources-sync.test.js`). After editing any of them, run
  the FULL test suite (`node --test`), not just the guard suites, and remember that any
  `plans/prompts` edit also needs `npm run sync-resources` to refresh `resources/prompts`."

## Affected files (summary)

| File | Item | Sync/mirror action |
|---|---|---|
| `SKILL_TEAM.md` | 1, 2 | none (not synced) |
| `skills/codex/local-team/SKILL.md` | 1 | none |
| `SKILL.md` | 2 | none (leave `## CLI Commands` untouched) |
| `plans/prompts/roles/code_reviewer.md` | 3 | `npm run sync-resources` -> `resources/prompts/roles/code_reviewer.md` |
| `agents/claude/local-board-reviewer.md` | 3 | none (agents ship directly) |
| `agents/codex/local-board-reviewer.md` | 3 | none |
| `AGENTS.md` | 4 | none |

## Risks

- Forgetting `npm run sync-resources` after the `code_reviewer.md` edit -> `resources-sync`
  suite red. This is the single most likely miss; it is exactly the class of failure item 4
  documents.
- Accidentally reflowing or re-indenting a `## CLI Commands` fenced block in `SKILL.md` while
  adding the item-2 Delegation paragraph -> `skill-usage-sync` byte-identical assertion red.
  Keep edits strictly outside those fences.
- Codex mirror drift: item 1 must land in BOTH team-skill Closeouts, or the two orchestrator
  skills give divergent contracts (no test enforces this parity — reviewer must eyeball it).
- Over-scoping item 2 into the codex mirrors would be wrong (hook is Claude-only); avoid it.

## Test strategy / verification plan

1. Make the four edits.
2. `npm run sync-resources` (mandatory because `plans/prompts/roles/code_reviewer.md` changed).
3. `npm run check` (syntax gate; unaffected by md but part of the standard gate).
4. `node --test` — the FULL suite, not just guard suites (this ticket is itself the reason).
   Specifically expect green: `test/resources-sync.test.js` (mirror refreshed),
   `test/skill-usage-sync.test.js` (CLI blocks untouched), `test/prompt-scaffold.test.js`,
   `test/cli.test.js` estimate-prompt assertions (untouched prompts),
   `test/install.test.js` / `test/pack.test.js` / `test/tickets.test.js` (path/existence only).
5. Confirm no `## CLI Commands` fence changed (git diff review of `SKILL.md`).

## Open questions

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
