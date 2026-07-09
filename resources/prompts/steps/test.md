# Test Step

Validate the implemented ticket.

Include:
- commands run;
- results;
- failures;
- untested risk;
- recommendation: pass, changes_requested, or questions.

## Output and Persistence

Return the `## Test Evidence` section body as Markdown. When this step is delegated, the subagent returns the evidence text and writes no file — the `local-board-tester` subagent has no Write tool. The orchestrator persists it with `section --file`, creating the temp file with the Write tool, never with shell redirection.

## Worktree git safety

You may be running inside a ticket worktree that holds uncommitted, orchestrator-owned ticket state (the ticket Markdown file and its in-progress edits). Do not discard it.

- Revert any temporary probe edit by TARGETED path only: `git checkout -- <specific-file>`, `git restore <specific-file>`, or the exact inverse filesystem edit you made.
- Never run a tree-wide or history/branch-mutating git command inside the worktree: no `git checkout -- .`, `git restore .`, `git stash`, `git reset --hard`, `git merge`, `git merge --abort`, or branch switches (`git switch` / `git checkout <branch>`).
- These commands silently destroy uncommitted ticket state — this has already lost a ticket in the field. If the tree is dirty in a way you cannot cleanly reverse by targeted path, stop and report it rather than resetting.

## Gate consultation before move

Before moving this ticket out of `test`, the orchestrator must run `gate-check --stage test` and, if the catalog is non-empty, record the result with `gate-complete` (see SKILL.md). When `config.routing.requireGateConsultation` is true, `move` refuses the transition without a recorded consultation.