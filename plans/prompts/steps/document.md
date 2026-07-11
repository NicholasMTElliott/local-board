# Document Step

Update project documentation required by the current ticket.

Rules:
- keep `memory-bank/` terse and current;
- update `README.md` when documentation entry points change;
- update `docs/` for human-facing narrative changes;
- record evidence in the ticket's `## Documentation Updates` section.

## Persisting Documentation Updates

Before returning, update the ticket's `## Documentation Updates` body and persist it with `local-board section <ticket-id> --file <temp-path> --section "Documentation Updates" --root <worktreePath>`, creating the temp file with the Write tool (outside the worktree), never shell redirection. Confirm the persistence in your returned summary. Do not alter ticket status or completedSteps.

## Commit scope

Before finishing, commit the intended documentation changes on the ticket branch. Inspect `git status` and the diff; stage only intended paths, and never use `git add .` or `git add -A`. Do not stage `plans/tickets/**` or other orchestrator-owned ticket state; ticket-scoped outputs elsewhere under `plans/**` may be staged by exact path. If the sandbox denies `git commit`, do not retry - list the exact intended paths in your returned summary and the orchestrator commits them on the ticket branch.

## Worktree git safety

Undo only the exact probe change you introduced; prefer an exact inverse edit, and use path-level `git restore <file>` or `git checkout -- <file>` only after confirming that path had no pre-existing edits. Never run tree-wide reverts, `git stash`, `git reset --hard`, `git clean`, merges, rebases, abort variants, or branch switches. If unrelated dirt cannot be separated safely, stop and report it.
