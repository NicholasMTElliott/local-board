# Team Mode

Team mode runs multiple local-board tickets in parallel using a Claude Code agent team. Each ready ticket gets its own teammate session, and every teammate is the orchestrator for exactly one ticket. The team lead coordinates spawn, relays teammate status to you, and synthesizes a final per-ticket summary.

Team mode is opt-in. It does not change how single-ticket runs work — the standard `local-board-orchestrator` skill remains the entry point for sequential operation.

## When to use it

Team mode is most useful when:

- You have several `ready_for_implementation` (or other ready-state) tickets that touch independent parts of the code.
- The work is bounded enough that you trust each teammate to finish without constant intervention.
- The auto-merge race avoidance matters to you — the CLI's rebase-onto-default precondition is what makes parallel auto-merge safe.

Team mode is not useful when:

- Only one ticket is ready. The standard orchestrator handles that with less overhead. Team mode will detect this case and recommend the standard skill instead.
- The ready tickets all touch the same files. Branch-level isolation is not enough; you will burn tokens on teammates that mostly resolve merge conflicts.
- You want to drive each step interactively.

## Prerequisites

| Requirement | Why | How to set |
|---|---|---|
| Claude Code v2.1.32 or later | Agent teams feature | `claude --version` |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` | Enables the agent-teams primitives | `~/.claude/settings.json` `env` block, or shell env |
| `git.autoMerge: true` in `plans/local-board.config.jsonc` | Teammates auto-merge their own branches | Project config |
| `git.commitPlanningChanges: true` in the same config | Closeout commits stay out of the way | Project config |

The CLI's `move ... done` rebase precondition is enabled automatically when `git.autoMerge` is true. There is no separate flag.

## How to invoke

Ask Claude to run team mode:

> Work my local-board tickets in parallel.

The lead session will:

1. Validate the project.
2. Run `local-board list --ready --limit 6 --json` to get the candidate batch.
3. Stop with "no ready tickets" if the batch is empty.
4. Fall back to the standard `local-board-orchestrator` skill if the batch has exactly one ticket.
5. Otherwise spawn one teammate per ticket (up to six) and run the relay loop.

The cap of six is hard-coded in the skill. The Anthropic agent-teams documentation recommends three to five teammates; six is the upper edge that still produces useful parallelism for this workflow.

## What you will see

During the run, the lead relays each teammate message verbatim:

```
[T20260522T1430Z] STARTED branch=task/T20260522T1430Z
[T20260522T1432Z] STARTED branch=task/T20260522T1432Z
[T20260522T1430Z] STEP design -> ready_for_implementation
[T20260522T1432Z] STEP design -> ready_for_implementation
[T20260522T1430Z] BRANCH-READY T20260522T1430Z branch=task/T20260522T1430Z
[T20260522T1430Z] DONE
[T20260522T1432Z] QUESTION conflicting refactor in src/cli.js
```

The lead does not interpret these messages — it surfaces them as a running log so you can intervene if needed.

When every teammate has shut down, the lead produces a final per-ticket summary table with columns for ticket ID, final status, branch, one-line evidence summary, and any questions or blockers.

## Conflict handling

Teammates broadcast `BRANCH-READY` on entry to `ready_for_review`. Before `complete-step implement`, each teammate pulls every peer's broadcast branch into its own and resolves conflicts.

If two teammates touch the same files, the second one to reach the merge-with-peer step will surface conflicts. Three resolutions are possible:

1. The conflict is mechanical and resolvable. The teammate fixes it and continues.
2. The conflict is semantic and requires a choice. The teammate moves its ticket to `questions` and asks the lead, which surfaces the question to you.
3. The two tickets were genuinely incompatible. You decide which to keep, move the other to `blocked`, and re-run team mode on the survivor.

The CLI's rebase-onto-default precondition handles the auto-merge race separately. When teammate A's `move ... done` auto-merges to the default branch, teammate B's `move ... done` will refuse until B's branch contains A's merge. B either rebases or moves to `questions`.

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
- Teammates cannot spawn their own teams.
- Permissions are set at spawn; per-teammate modes cannot be assigned at spawn time.

Team mode also adds its own constraints:

- Maximum six teammates per run.
- Each teammate is a separate Claude Code session with its own context window. Token cost scales linearly with batch size.
- Team-mode configuration (the spawn rules, the cap of six) lives in the skill file, not in `plans/local-board.config.jsonc`. The agent-teams docs explicitly do not recognize a project-level team config.
