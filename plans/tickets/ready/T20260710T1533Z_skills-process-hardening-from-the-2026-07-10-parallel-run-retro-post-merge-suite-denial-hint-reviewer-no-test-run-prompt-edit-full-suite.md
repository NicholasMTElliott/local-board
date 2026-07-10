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
updated: 2026-07-10T15:46:10Z
completedSteps: []
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
