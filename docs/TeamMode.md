# Team Mode

> **Superseded.** The agent-teams "one teammate per ticket" design described
> below has been replaced by a single top-level **per-step orchestrator**: one
> session works several tickets concurrently and dispatches each step to a
> model-specialized executor, so every step can run on its own model. See
> [PerStepOrchestration.md](PerStepOrchestration.md) for the design and
> `SKILL_TEAM.md` for the operational contract. The parallelism, worktree
> isolation, and `move … done` rebase-precondition safety described here still
> apply; the teammate/lead mechanics and the `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`
> requirement do not. This page is retained for historical context.

Team mode runs multiple local-board tickets in parallel using a Claude Code agent team. The lead spawns teammate sessions on demand — one per ticket that can be worked right now — each the orchestrator for one ticket at a time. The team starts as small as the available work allows and grows after each completion as dependencies clear, up to a configurable maximum (default six). As teammates finish, the lead reassigns idle ones to additional ready tickets — including ones produced mid-run by a teammate's own `decompose` step — and spawns new teammates when newly-unblocked work exceeds the idle pool, until the queue is exhausted. Each teammate runs `/compact` between tickets to keep its context window manageable.

Team mode is opt-in. It does not change how single-ticket runs work — the standard `local-board` skill remains the entry point for sequential operation.

## When to use it

Team mode is most useful when:

- You have several `ready_for_implementation` (or other ready-state) tickets that touch independent parts of the code.
- The work is bounded enough that you trust each teammate to finish without constant intervention.
- The auto-merge race avoidance matters to you — the CLI's rebase-onto-default precondition is what makes parallel auto-merge safe.
- You want each teammate isolated in its own git worktree instead of sharing one checkout.

Team mode is not useful when:

- Only one ticket is ready. The standard orchestrator handles that with less overhead. Team mode will detect this case and recommend the standard skill instead.
- The ready tickets all touch the same files. Branch-level isolation is not enough; you will burn tokens on teammates that mostly resolve merge conflicts.
- You want to drive each step interactively.

## Prerequisites

| Requirement | Why | How to set |
|---|---|---|
| Claude Code v2.1.32 or later | Agent teams feature | `claude --version` |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` | Enables the agent-teams primitives | `~/.claude/settings.json` `env` block, or shell env |
| `LOCAL_BOARD_MAX_TEAMMATES` (optional) | Caps the maximum concurrent team size; defaults to 6 | `~/.claude/settings.json` `env` block, or shell env. Inspect with `local-board team-config --json` |
| Lead checkout on default branch with a clean tree | Teammates may move the default-branch ref while they merge | `local-board fast-forward --json` |
| `git.autoMerge: true` in `plans/local-board.config.jsonc` | Teammates auto-merge their own branches | Project config |
| `git.commitPlanningChanges: true` in the same config | Closeout commits stay out of the way | Project config |

The CLI's `move ... done` rebase precondition is enabled automatically when `git.autoMerge` is true. There is no separate flag.

## How to invoke

Ask Claude to run team mode:

> Work my local-board tickets in parallel.

The lead session will:

1. Validate the project.
2. Run `local-board fast-forward --json` to confirm the lead is on the default branch with a clean checkout.
3. Run `local-board team-config --json` to resolve the maximum team size (`maxTeammates`, default 6, overridable by `LOCAL_BOARD_MAX_TEAMMATES`).
4. Run `local-board list --ready --limit <max> --json` to get the initial candidate batch.
5. Stop with "no ready tickets" if the batch is empty.
6. If the batch has exactly one ready ticket and the rest of the board is already `done`/`archived`, fall back to the standard `local-board` skill. If other open tickets exist (blocked or dependent on that one), engage team mode with a single teammate — the team will grow as the first ticket unblocks its dependents.
7. Otherwise spawn one teammate per initial ready ticket (up to `<max>`) and run the relay loop.
8. After each teammate's `DONE`, run `fast-forward`, then **rebalance**: reassign idle teammates to newly-ready tickets, and spawn additional teammates (up to `<max>`) when the newly-unblocked work exceeds the idle pool. When no ready ticket exists, the teammate idles; when no teammate is working and the queue is empty, the lead sends `SHUTDOWN` to each idle teammate and produces the final summary.

The maximum team size defaults to six and is configurable via `LOCAL_BOARD_MAX_TEAMMATES`. The Anthropic agent-teams documentation recommends three to five teammates; six is a sensible upper edge that still produces useful parallelism for this workflow. The lead grows the team on demand up to this maximum rather than spawning the full team upfront — a graph where one ticket gates many starts with a single teammate and scales out the moment that ticket completes.

## Worktree model

Each teammate gets a git worktree in a sibling directory of the project root. If the project root is:

```text
C:\work\local-board
```

then ticket worktrees are created as:

```text
C:\work\
  local-board\
  local-board-worktrees\
    T20260522T1430Z\
    T20260522T1432Z\
```

Teammates do not call `git worktree` directly. Their first command is:

```sh
local-board worktree-add <ticket-id> --json
```

The command returns the branch and `worktreePath`. Every later local-board command from that teammate passes `--root <worktreePath>`, including `start-work`, `begin-step`, `complete-step`, `move`, `section`, and `comment`. The teammate may `cd` into the worktree for editing and normal git commands, but `--root` is authoritative for local-board state.

When a ticket has no recorded branch, `worktree-add` creates the branch using the same naming helper as `start-work` and stamps the branch field inside the worktree ticket file. It does not change status, `workStartedAt`, or the run log. `start-work` still owns those mutations.

When `move ... done` auto-merges a teammate branch, the default-branch ref can move while the lead's default checkout still has the old files on disk. After each `DONE` message, and again before the final summary, the lead runs:

```sh
local-board fast-forward --json
```

This command refuses unless the lead is on the detected default branch and the checkout is clean. On success it runs a hard reset to the current default-branch ref, so the lead sees the merged files.

Between a teammate's `DONE` and the lead's next `fast-forward`, `git status` in the lead checkout will show transient "modifications" or "deletions" against ticket files that the teammate's merge brought into the default branch. These are not real edits — they are the diff between the lead's stale working tree and the newly-advanced HEAD. Do not commit them or revert them manually; the next `fast-forward` reconciles the working tree by hard-resetting to HEAD.

## What you will see

During the run, the lead relays each teammate message verbatim. Status messages from teammates include the current ticket ID because each teammate may work several tickets across reassignments:

```
[T20260522T1430Z] STARTED T20260522T1430Z branch=local-board/T20260522T1430Z-auth-fix
[T20260522T1432Z] STARTED T20260522T1432Z branch=local-board/T20260522T1432Z-cache-rewrite
[T20260522T1430Z] STEP T20260522T1430Z design -> ready_for_implementation
[T20260522T1430Z] DONE T20260522T1430Z
[T20260522T1430Z] STARTED T20260522T1500Z branch=local-board/T20260522T1500Z-followup
[T20260522T1432Z] QUESTION T20260522T1432Z conflicting refactor in src/cli.js
```

Note the teammate name (`T20260522T1430Z`) is just a session identifier — once reassigned, the same teammate can be working a different ticket (`T20260522T1500Z` above). The lead does not interpret these messages; it surfaces them as a running log so you can intervene if needed.

When every teammate has shut down, the lead produces a final per-ticket summary table covering *every* ticket processed during the session, with columns for ticket ID, the teammate that worked it, final status, branch, one-line evidence summary, and any questions or blockers.

## Conflict handling

Teammates broadcast `BRANCH-READY` on entry to `ready_for_review`. Before `complete-step implement`, each teammate pulls every peer's broadcast branch into its own and resolves conflicts.

If two teammates touch the same files, the second one to reach the merge-with-peer step will surface conflicts. Three resolutions are possible:

1. The conflict is mechanical and resolvable. The teammate fixes it and continues.
2. The conflict is semantic and requires a choice. The teammate moves its ticket to `questions` and asks the lead, which surfaces the question to you.
3. The two tickets were genuinely incompatible. You decide which to keep, move the other to `blocked`, and re-run team mode on the survivor.

The CLI's rebase-onto-default precondition handles the auto-merge race separately. When teammate A's `move ... done` auto-merges to the default branch, teammate B's `move ... done` will refuse until B's branch contains A's merge. B either rebases, merges the default branch into its ticket branch, or moves to `questions`.

## Recovering from a stuck teammate

The agent-teams docs note teammates may stop on errors without recovering. If you see a teammate go silent for an unexpectedly long time:

- Use `Shift+Down` (in-process display mode) to cycle to that teammate's session and read its output.
- If recoverable: send the teammate additional instructions directly.
- If not: tell the lead to mark that ticket's status manually (`questions` or `blocked`) via the local-board CLI, then have the lead clean up the team.

Do not try to promote a teammate to lead or transfer ownership mid-run. The agent-teams architecture fixes the lead for the team's lifetime.

## Limitations

Team mode inherits the agent-teams limitations:

- No session resumption with in-process teammates (`/resume` and `/rewind` do not restore them).
- One team at a time per lead session.
- The lead is fixed for the team's lifetime.
- Teammates cannot spawn their own teams or teammates. Only the lead grows the team — teammates are themselves subagents, and the harness forbids a subagent from spawning further agents.
- Teammates cannot dispatch `claude-subagent:*` routes. A teammate is itself a subagent, and the harness forbids a subagent from spawning further subagents (the `Task` tool is not granted at runtime). Team mode runs those steps inline automatically — the teammate does the design/review/test work itself and records `approve-inline`. `codex-task:*` routes still work because they shell out via Bash, not `Task`. This restriction does not apply to single-ticket mode, where the top-level orchestrator session can dispatch subagents normally.
- Permissions are set at spawn; per-teammate modes cannot be assigned at spawn time.

Team mode also adds its own constraints:

- Maximum team size defaults to six per run, configurable via `LOCAL_BOARD_MAX_TEAMMATES`. The lead grows the team on demand up to this maximum and reuses idle teammates before spawning new ones.
- Each teammate is a separate Claude Code session with its own context window. Teammates run `/compact` between tickets to keep context manageable across many reassignments, but token cost still scales with the number of tickets processed.
- Worktrees live outside the repo in the sibling `<repo-name>-worktrees/` directory. Remove stale worktrees with `local-board worktree-remove <ticket-id>` or inspect them with `local-board worktree-list`.
- `fast-forward` has no opt-out in team mode. Keep the lead checkout clean while teammates are running.
- Team-mode behavior (spawn rules, rebalance logic) lives in the skill file, not in `plans/local-board.config.jsonc`; the agent-teams docs do not recognize a project-level team config. The one tunable that survives across runs is the `LOCAL_BOARD_MAX_TEAMMATES` environment variable, resolved by `local-board team-config`.
