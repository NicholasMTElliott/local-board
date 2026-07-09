---
id: T20260709T1118Z
type: task
status: done
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260709T1118Z-prompts-git-safety-guardrails-for-executors-targeted-reverts-only
estimate: 1
estimateBasis: T20260708T2213Z
workStartedAt: 2026-07-09T11:21:29Z
workCompletedAt: 2026-07-09T11:59:04Z
created: 2026-07-09T11:17:38Z
updated: 2026-07-09T11:59:04Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", review:codex-task:read-only, "test:claude-subagent:local-board-tester@sonnet", gate:test:skipped-empty-catalog, document:codex-task:workspace-write]
routingApprovals: []
---
# prompts: git-safety guardrails for executors (targeted reverts only)

## Requirement

Same field report: a tester's `git checkout -- .` destroyed uncommitted ticket state in a worktree. Nothing in the executor prompt templates guards against this — return-only executors (reviewer, tester, gatecheck, decomposer) have unrestricted Bash, and the current templates (resources/prompts/steps/test.md and siblings, plus the skill texts) never mention git revert hygiene. The "revert your probe edits exactly, targeted paths only" rule exists only in ad-hoc orchestrator dispatch briefs.

Fix: add a git-safety rule to the executor-facing surfaces:
1. Step prompt templates (resources/prompts/steps/{test,review}.md and any other template that authorizes probe mutations): temporary probe edits must be reverted by TARGETED path (`git checkout -- <specific-file>` / `git restore <specific-file>` or exact fs operations); NEVER `git checkout -- .`, `git restore .`, `git stash`, `git reset --hard`, `git merge`/`git merge --abort`, or branch switches inside a ticket worktree — uncommitted orchestrator-owned ticket state may be present.
2. Skill texts (single-ticket + team, both harness variants where applicable): one sentence in the delegation section noting executors must follow the targeted-revert rule, and one sentence stating codex-task dispatches are serial-by-design and must never be backgrounded with shell `&` (concurrent CODEX_HOME use corrupts session state) — use the harness's background dispatch instead.
3. Run `npm run sync-resources` so the prompt mirror stays in lockstep (resources drift test).

Scope: prompt/skill text only; no CLI changes (T20260709T1117Z makes the state durable; this ticket reduces the chance the destructive op happens at all — defense in depth).

## Acceptance Criteria

- Both test and review step templates carry the targeted-revert rule; resources mirror synced; drift test green.
- Skill texts carry the executor git-safety sentence and the no-shell-& codex rule; skill-usage-sync test green (prose-only edits).
- Wording is executor-facing (imperative, concrete command names), not narrative.

## Acceptance Criteria

## Related Tickets

## Technical Design

Docs/prompts-only change (defense-in-depth companion to T20260709T1117Z, which makes the state durable). Add a concrete, imperative git-safety rule to the two routed executor prompts and to the four skill texts, plus a one-sentence codex serial-dispatch rule. No CLI/source changes.

### Source-of-truth and mirror direction (settled)

`test/resources-sync.test.js` asserts `resources/prompts` mirrors `plans/prompts` byte-for-byte (EOL-normalized), and `scripts/sync-resources.mjs` copies `plans/{prompts,templates}` -> `resources/{prompts,templates}` (deletes the target, re-copies LF-normalized). **`plans/` is the human-edited source of truth; `resources/` is generated.** So: edit the `plans/` copies only, then run `npm run sync-resources` to regenerate `resources/`. Never hand-edit `resources/`.

The skill texts (`SKILL.md`, `SKILL_TEAM.md`, `skills/codex/**/SKILL.md`) are **not** under `plans/prompts`, so they are not synced — edit each directly. `test/skill-usage-sync.test.js` only compares the fenced ```sh block under the `## CLI Commands` heading between `SKILL.md` and `skills/codex/local-board/SKILL.md`; every edit here is prose in other sections, so **no curated block changes and no byte-identity work are required** (confirmed against the test extractor).

### Routed-prompt correction (naming)

The ticket says "review step template", but there is no `steps/review.md`. `plans/local-board.config.jsonc` maps the `review` action to `plans/prompts/roles/code_reviewer.md`, so the review-surface edit lands there. The tester surface is `plans/prompts/steps/test.md`. These are the two prompts `begin-step` hands back as `configuredPrompt` for the test/review actions, so the rule reaches the executor via the routed prompt.

`gate-check.md` (pure JSON pattern-match, no tree access), `decompose.md` (CLI-only child creation), `document.md`, and every `plans/prompts/optional-steps/**` specialty prompt were reviewed and are read-mostly/advisory — none authorize probe edits or tree-wide git, so they are correctly out of scope.

### Rule text — step-prompt version (test.md and code_reviewer.md, verbatim)

Add this section to both files (identical body):

```markdown
## Worktree git safety

You may be running inside a ticket worktree that holds uncommitted, orchestrator-owned ticket state (the ticket Markdown file and its in-progress edits). Do not discard it.

- Revert any temporary probe edit by TARGETED path only: `git checkout -- <specific-file>`, `git restore <specific-file>`, or the exact inverse filesystem edit you made.
- Never run a tree-wide or history/branch-mutating git command inside the worktree: no `git checkout -- .`, `git restore .`, `git stash`, `git reset --hard`, `git merge`, `git merge --abort`, or branch switches (`git switch` / `git checkout <branch>`).
- These commands silently destroy uncommitted ticket state — this has already lost a ticket in the field. If the tree is dirty in a way you cannot cleanly reverse by targeted path, stop and report it rather than resetting.
```

Placement anchor: insert immediately after the `## Output and Persistence` section in each file (before `## Gate consultation before move` in `test.md`; at end of `code_reviewer.md`).

### Rule text — skill version (shorter, prose sentences)

Executor git-safety sentence (single sentence, drop into each skill's delegation/executor-ownership prose):

> Every dispatched executor works in a ticket worktree that may hold uncommitted, orchestrator-owned ticket state: instruct it to revert probe edits by targeted path only (`git checkout -- <file>` / `git restore <file>`) and to never run tree-wide or branch/history-mutating git inside the worktree — no `git checkout -- .`, `git restore .`, `git stash`, `git reset --hard`, `git merge`/`git merge --abort`, or branch switches.

Codex serial-dispatch sentence (single sentence, place where `codex-task` dispatch is described):

> `codex-task` dispatches are serial-by-design: never background one with a shell `&` (concurrent `CODEX_HOME` use corrupts session state) — use the harness's own background/spawn dispatch when you need concurrency.

### File list with placement anchors

Step prompts (edit in `plans/`, then sync):

1. `plans/prompts/steps/test.md` — add `## Worktree git safety` after `## Output and Persistence`.
2. `plans/prompts/roles/code_reviewer.md` — add `## Worktree git safety` after `## Output and Persistence`.
3. Run `npm run sync-resources` -> regenerates `resources/prompts/steps/test.md` and `resources/prompts/roles/code_reviewer.md` (do not edit these directly).

Skill texts (edit each directly; prose only):

4. `SKILL.md` — executor git-safety sentence in `### Persisting Delegated Output` (near the return-only/worktree-scope prose, ~line 305-309); codex serial sentence in `## Delegation` on the `codex-task:<mode>` bullet (~line 282).
5. `SKILL_TEAM.md` — executor git-safety sentence in `## What the orchestrator owns vs executors` under the **Executors** bullet (~line 184-188); codex serial sentence in `## Execution profiles` on the `codex-task:<mode>` bullet (~line 62-63, alongside the existing "Run it in the background" note that applies only to claude-subagent).
6. `skills/codex/local-board/SKILL.md` — executor git-safety sentence in `## Dispatch Rules` under the "Workers may edit their assigned worktree scope only..." paragraph (~line 101); codex serial sentence in `## Dispatch Rules` as well.
7. `skills/codex/local-team/SKILL.md` — executor git-safety sentence in `## Orchestrator-Owned State` next to "must not revert edits made by others" (~line 80); codex serial sentence in `## Route Translation` (Codex spawn dispatch) prose.

No changes to any `## CLI Commands` fenced block in any skill file.

### Test plan

1. `npm run sync-resources` after the two `plans/` prompt edits.
2. `npm test` (or targeted):
   - `node --test test/resources-sync.test.js` — resources/prompts mirror drift **green** (the two regenerated files match their `plans/` sources).
   - `node --test test/skill-usage-sync.test.js` — **green**; prose-only edits do not touch the CLI Commands block, so both the byte-identity and command-name-set assertions still hold.
3. Grep-based presence checks (each must match):
   - `git checkout -- .` present in `plans/prompts/steps/test.md`, `plans/prompts/roles/code_reviewer.md`, and their `resources/` mirrors.
   - `## Worktree git safety` heading present in both routed prompts (both trees).
   - `git checkout -- <file>` (targeted-revert phrasing) present in all four skill files.
   - `CODEX_HOME` (codex serial-dispatch sentence) present in all four skill files.
4. Manual read-back: confirm wording is imperative and names the banned commands (not narrative).

### Risks / edge cases

- **Scope judgment (accepted):** the most *direct* executor system prompts are `agents/claude/local-board-{tester,reviewer}.md` and their `agents/codex/` twins. The ticket deliberately targets the routed step/role prompts + skill delegation prose instead; because `begin-step` passes the routed prompt to the executor and the skills instruct the orchestrator, the rule reaches every executor without touching the agent wrappers. Hardening the `agents/**` wrappers too is a reasonable follow-up but is out of this ticket's stated scope — flagged, not done here.
- **`test.md` does not currently authorize probe edits**, and `agents/claude/local-board-tester.md` even forbids editing. The rule is still correct here: the field-report loss came from a tester running `git checkout -- .` to "clean up," not from an authorized edit. The rule's absolute ban on tree-wide git covers exactly that case.
- **Mirror drift is the main mechanical failure mode** — forgetting `npm run sync-resources` fails `resources-sync.test.js`. The test plan front-loads the sync step.
- **Do not touch the CLI Commands block** in either synced skill pair or `skill-usage-sync.test.js` byte-identity fails.

### Documentation impact

None beyond the skill/prompt text itself. No `docs/` narrative or README index change (no new file). Memory Bank unaffected.

## Implementation Notes

## Review Findings

Reviewed by codex-task:read-only (gpt-5.5). One finding: [P3] the banned-command examples omit git clean -fd/-fdx and git rebase/--abort — plausible executor cleanup/update commands that destroy uncommitted or untracked state; add to the lists in both routed prompts and all four skill texts, re-sync resources (plans/prompts/steps/test.md:21, plans/prompts/roles/code_reviewer.md:21, SKILL.md:311, SKILL_TEAM.md:190, skills/codex/local-board/SKILL.md:101, skills/codex/local-team/SKILL.md:80). Passing: targeted-revert examples + stop-and-report fallback present; routing confirms the two prompts cover the mutating executors; security_audit prompt read-only; plans/resources byte-identical; curated blocks untouched; no CodexSupport contradiction. Verdict: changes_requested

## Test Evidence

Verified by claude-subagent:local-board-tester (sonnet), in the ticket worktree.

| Command | Result |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS — 432 tests, 431 pass, 0 fail, 1 skipped |
| `npm run validate` | PASS — Ticket validation OK |
| `node --test test/resources-sync.test.js` | PASS — 4/4 |
| `node --test test/skill-usage-sync.test.js` | PASS — 4/4 |

### Content checks

- Both routed prompts (plans/ + resources/ mirrors) name every banned command — checkout -- . / restore . / stash / reset --hard / clean -fd / clean -fdx / rebase / rebase --abort / merge / merge --abort / branch switches — plus the targeted-revert allowed example and the stop-and-report fallback.
- plans/ vs resources/ byte-identical per git hash-object (test.md 4251f00a…, code_reviewer.md 7385b36e…).
- All four skill texts carry the summarized executor sentence; all four (broader than required) carry the no-shell-& codex rule with the CODEX_HOME rationale.
- Curated CLI Commands blocks untouched vs mainline (diff shows prose-only additions; skill-usage-sync green).
- Reach: config maps review→code_reviewer.md and test→test.md (the two mutating-executor prompts); decompose/document/gate-check/design/estimate prompts spot-checked read-only.
- Render sanity: headings well-formed; inline backtick counts even in both files; no fences introduced.

No gaps.

Result: pass

## Documentation Updates

Documented by codex-task:workspace-write (gpt-5.5). Deliverable (prompt sections + skill sentences) shipped at implement/rework. Closing audit: memory-bank/systemPatterns.md gained one terse Safety Pattern fact (targeted-revert-only executor rule + serial codex dispatch); README/docs verified needing nothing (executor-facing content).

## Questions

## Run Log

- 2026-07-09T11:21:29Z: Ensured git branch local-board/T20260709T1118Z-prompts-git-safety-guardrails-for-executors-targeted-reverts-only (already-current).

- 2026-07-09T11:28:45Z: Completed design via claude-subagent:local-board-designer@opus: Worktree git safety section in test.md + code_reviewer.md (plans/ authoritative, sync to resources); one-sentence rule + no-shell-& codex rule across four skill texts; agent-wrapper hardening flagged follow-up; estimate 1 basis T2213

- 2026-07-09T11:30:00Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (prompt/skill prose)

- 2026-07-09T11:30:01Z: Ensured git branch local-board/T20260709T1118Z-prompts-git-safety-guardrails-for-executors-targeted-reverts-only (already-current).

- 2026-07-09T11:39:47Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Worktree git safety section in test.md + code_reviewer.md (plans + synced resources); executor rule + codex serial rule in all four skill texts; 431 pass + 1 skip; both sync tests 4/4

- 2026-07-09T11:41:48Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (Markdown prose)

- 2026-07-09T11:49:47Z: Invalidated downstream evidence on loop-back to ready_for_implementation: removed completedSteps [implement:claude-subagent:local-board-implementer@sonnet, gate:implement:claude-subagent:local-board-gatecheck@haiku].

- 2026-07-09T11:49:47Z: Ensured git branch local-board/T20260709T1118Z-prompts-git-safety-guardrails-for-executors-targeted-reverts-only (already-current).

- 2026-07-09T11:52:41Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Rework: git clean -fd/-fdx + git rebase/--abort added to both prompt lists; skill sentences summarize (cleans, rebases); resources re-synced; 431 pass + 1 skip; both sync tests 4/4

- 2026-07-09T11:54:12Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (prose rework)

- 2026-07-09T11:54:12Z: Completed review via codex-task:read-only: changes_requested (P3: banned list missing git clean/rebase) on impl commit; addressed in rework; recorded post-move per evidence-invalidation ordering

- 2026-07-09T11:57:38Z: Completed test via claude-subagent:local-board-tester@sonnet: 431 pass + 1 skip; full banned-command grep matrix in both prompt copies; byte-identical mirrors; skill sentences + codex rule present; curated blocks untouched; reach + render sanity verified

- 2026-07-09T11:59:03Z: Completed document via codex-task:workspace-write: systemPatterns fact; user docs verified unaffected
