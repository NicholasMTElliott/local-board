---
name: local-board-team
description: Run multiple local-board tickets in parallel using a Claude Code agent team. The lead session fans out ready tickets to teammate sessions, each running the local-board-orchestrator skill scoped to one ticket. Use when the user asks to "work my tickets in parallel", "work the next N tickets at once", or otherwise requests team-mode local-board operation. Requires CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 and Claude Code v2.1.32+.
allowed-tools:
  - Bash(node <<SCRIPT_PATH>> *)
---

# local-board team mode

You are the team lead. Your job is to fan out ready tickets to teammate sessions and relay their progress. You do not work tickets yourself.

Use the installed CLI:

```sh
node <<SCRIPT_PATH>>
```

Installation metadata:

- Runtime directory: `<<INSTALL_PATH>>`
- CLI entrypoint: `<<SCRIPT_PATH>>`

Operate in the user's current project unless they specify another root. Pass `--root <path>` for non-current projects.

## Preflight

1. Verify `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set and Claude Code is v2.1.32 or later. If either is missing, stop and tell the user how to enable agent teams.
2. Read project instructions: `AGENTS.md`, `CLAUDE.md`, and `memory-bank/` when present.
3. Run `node <<SCRIPT_PATH>> validate`. Stop on validation errors.
4. Run `node <<SCRIPT_PATH>> fast-forward --json`. Stop if it refuses. This validates that the lead is on the detected default branch with a clean working tree before teammates can move the default-branch ref.
5. Run `node <<SCRIPT_PATH>> list --ready --limit 6 --json` to get the candidate ticket batch. The cap of 6 is intentional — beyond that, coordination overhead outweighs parallelism.
6. If the result is empty: report "no ready tickets" and stop.
7. If the result has exactly one ticket: do not spawn a team. Tell the user team mode is overkill for a single ticket and invoke the standard `local-board-orchestrator` skill instead.

## Spawn

For each ticket in the candidate batch:

- Name the teammate after the ticket ID (for example, `T20260522T1430Z`).
- Use the agent type `local-board-teammate`.
- Do not require plan approval — the teammate's own orchestrator loop handles design and approval gating.
- Send the spawn prompt below.

Spawn all teammates in parallel, not sequentially.

### Spawn prompt template

```
You are the local-board orchestrator scoped to ticket {ticket-id}.

Work this ticket and only this ticket. Use the local-board-orchestrator skill for the per-step workflow.

You are one of {N} teammates in a parallel agent team. Your peers:
{peer-list as "ticket-id => teammate-name" lines}

Expected worktree path: {expected-worktree-path}
Original project root: {project-root}

Your first action must be:

node <<SCRIPT_PATH>> worktree-add {ticket-id} --json

Capture `worktreePath` from that JSON. For every later local-board CLI call, pass `--root <worktreePath>`. Run `start-work` from that worktree root before ticket work. When removing the worktree at shutdown, call `worktree-remove` with `--root {project-root}`, not with the worktree root.

Your coordination contract is in your subagent definition. Follow it.

When your ticket reaches done, questions, or an unrecoverable error, send your final summary and shut down.
```

The lead substitutes `{ticket-id}`, `{N}`, `{peer-list}`, `{expected-worktree-path}`, and `{project-root}` for each teammate. The expected path uses the sibling convention `<parent-of-project-root>/<repo-dir-name>-worktrees/<ticket-id>/`. The rest is verbatim.

## Relay loop

Until every teammate has reported DONE, QUESTION, or ERROR:

- When a teammate message arrives, surface it to the user verbatim as `[{teammate-name}] {message}`. Do not synthesize or paraphrase.
- After a teammate sends `DONE`, run `node <<SCRIPT_PATH>> fast-forward --json` in the lead checkout before continuing the relay loop. If it refuses, surface the error and ask the user how to proceed.
- Do not do ticket work yourself. If a teammate stalls, prompt it to continue or ask the user how to proceed.
- If two peers broadcast BRANCH-READY for branches the lead expects to conflict, surface a "potential conflict" note but let the teammates resolve.

## Final summary

When every teammate has shut down:

1. Run `node <<SCRIPT_PATH>> fast-forward --json` in the lead checkout one final time. If it refuses, surface the error before summarizing.
2. For each ticket in the original batch, run `node <<SCRIPT_PATH>> query-ticket <id> --json` to get the final state.
3. Produce a per-ticket summary table with columns: ticket ID, final status, branch, one-line evidence summary, questions or blockers if any.
4. Explicitly call out any tickets that ended in `questions` or `blocked` as "needs user follow-up".
5. Clean up the team per the agent-teams cleanup procedure.

## Hard limits

- Maximum batch size: 6 teammates. Hard-coded — the agent-teams docs recommend 3-5; 6 is the upper edge for this skill.
- One team at a time per lead session (an agent-teams limitation).
- The lead is fixed for the team's lifetime (an agent-teams limitation).

## What the lead does NOT do

- Does not run `begin-step`, `complete-step`, `move`, or any other ticket-mutating CLI command. Teammates own ticket state.
- Does not commit, merge, or push. Teammates' `move ... done` (with `git.autoMerge`) handles their own merges. The CLI's rebase-onto-default precondition prevents stale-merge races. The lead only runs `fast-forward` to update its default-branch checkout after teammates move the shared ref.
- Does not spawn additional teammates mid-run. Team size is fixed at spawn.
- Does not enforce the rebase precondition itself — that is the CLI's job. The lead trusts the CLI.
