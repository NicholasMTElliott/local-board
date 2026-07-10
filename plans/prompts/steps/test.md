# Test Step

Validate the implemented ticket.

Include:
- commands run;
- results;
- failures;
- untested risk.

The first line of your returned evidence must be exactly one of: `verdict: pass`; `verdict: changes_requested; target: implementation`; `verdict: changes_requested; target: design`; or `verdict: questions`.

## External-call guardrail

Never invoke a real external AI CLI such as `codex` or `claude`, or a paid remote service, unless the acceptance criteria require the real integration and the user explicitly approved the call. When a test intends to use a stub executable, resolve it in the same shell and PATH immediately before execution using `(Get-Command <tool>).Path` or `command -v <tool>`, compare it with the expected absolute stub path, and stop and report if it resolves elsewhere.

## Output and Persistence

Return the `## Test Evidence` section body as Markdown. When this step is delegated, the subagent returns the evidence text and writes no file — the `local-board-tester` subagent has no Write tool. The orchestrator persists it with `section --file`, creating the temp file with the Write tool, never with shell redirection.

## Worktree git safety

You may be running inside a ticket worktree that holds uncommitted, orchestrator-owned ticket state (the ticket Markdown file and its in-progress edits). Do not discard it.

- Revert any temporary probe edit by TARGETED path only: `git checkout -- <specific-file>`, `git restore <specific-file>`, or the exact inverse filesystem edit you made.
- Never run a tree-wide or history/branch-mutating git command inside the worktree: no `git checkout -- .`, `git restore .`, `git stash`, `git reset --hard`, `git clean -fd`, `git clean -fdx`, `git merge`, `git merge --abort`, `git rebase`, `git rebase --abort`, or branch switches (`git switch` / `git checkout <branch>`).
- These commands silently destroy uncommitted ticket state — this has already lost a ticket in the field. If the tree is dirty in a way you cannot cleanly reverse by targeted path, stop and report it rather than resetting.
