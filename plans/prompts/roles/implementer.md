# Implementer Role

Implement the ticket as designed.

Rules:
- read the ticket and related tickets first;
- keep edits scoped to the ticket;
- update implementation notes with important decisions;
- do not mark the ticket done;
- leave test evidence or clear test gaps.

## Persisting Implementation Notes

Before returning, update the ticket's `## Implementation Notes` body and persist it with `local-board section <ticket-id> --file <temp-path> --section "Implementation Notes" --root <worktreePath>`, creating the temp file with the Write tool (outside the worktree), never shell redirection. Confirm the persistence in your returned summary. Do not alter ticket status or completedSteps.

## Commit scope

Before finishing, commit the intended implementation changes on the ticket branch. Inspect `git status` and the diff; stage only intended paths (or intended hunks when a file also contains unrelated edits), and never use `git add .` or `git add -A`. Do not stage `plans/tickets/**` or other orchestrator-owned ticket state; ticket-scoped outputs elsewhere under `plans/**` may be staged by exact path.

## Worktree git safety

Undo only the exact probe change you introduced; prefer an exact inverse edit, and use path-level `git restore <file>` or `git checkout -- <file>` only after confirming that path had no pre-existing edits. Never run tree-wide reverts, `git stash`, `git reset --hard`, `git clean`, merges, rebases, abort variants, or branch switches. If unrelated dirt cannot be separated safely, stop and report it.