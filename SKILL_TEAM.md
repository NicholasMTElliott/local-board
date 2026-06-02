---
name: local-team
description: Run multiple local-board tickets in parallel using a Claude Code agent team. The lead session fans out ready tickets to teammate sessions, then reassigns each teammate to additional ready tickets as it finishes, until the queue is exhausted. Each teammate runs the local-board skill scoped to one ticket at a time. Use when the user asks to "work my tickets in parallel", "work the next N tickets at once", or otherwise requests team-mode local-board operation. Requires CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 and Claude Code v2.1.32+.
allowed-tools:
  - Bash(node <<SCRIPT_PATH>> *)
---

# local-board team mode

You are the team lead. Your job is to fan out ready tickets to teammate sessions, relay their progress, and reassign each teammate to additional ready tickets as it finishes. You do not work tickets yourself.

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
5. Run `node <<SCRIPT_PATH>> list --ready --limit 6 --json` to get the initial candidate batch. The cap of 6 is intentional — beyond that, coordination overhead outweighs parallelism. Endless mode reuses these six slots as tickets complete; it does not grow the team mid-run.
6. If the result is empty: report "no ready tickets" and stop.
7. If the result has exactly one ticket: do not spawn a team. Tell the user team mode is overkill for a single ticket and invoke the standard `local-board` skill instead.

## Spawn

For each ticket in the initial batch:

- Name the teammate after its initial ticket ID (for example, `T20260522T1430Z`). This name persists across reassignments and is just a session identifier — it does not mean the teammate only works that ticket.
- Use the agent type `local-board-teammate`.
- Do not require plan approval — the teammate's own orchestrator loop handles design and approval gating.
- Send the spawn prompt below.

Spawn all teammates in parallel, not sequentially.

### Spawn prompt template

```
You are the local-board orchestrator scoped to ticket {ticket-id} as your first assignment.

Work this ticket through the local-board pipeline using the local-board skill. When you finish (DONE) and remove the worktree, idle and wait for the lead to send WORK <new-ticket-id> or SHUTDOWN. The lead may reassign you to additional ready tickets, one at a time, until the queue is exhausted.

You are one of {N} teammates in a parallel agent team. Your peers' current first tickets:
{peer-list as "ticket-id => teammate-name" lines}

Expected worktree path for {ticket-id}: {expected-worktree-path}
Original project root: {project-root}

Your first action must be:

node <<SCRIPT_PATH>> worktree-add {ticket-id} --json

Capture `worktreePath` from that JSON. For every later local-board CLI call on this ticket, pass `--root <worktreePath>`. Run `start-work` from that worktree root before ticket work. When removing the worktree (immediately after DONE), call `worktree-remove` with `--root {project-root}`, not with the worktree root.

When reassigned via WORK <new-ticket-id>, run /compact, then re-enter the contract from the top for the new ticket — including a fresh worktree-add.

You cannot spawn subagents (the Task tool is not available to a teammate). For any step the project config routes to a `claude-subagent:*` agent, run it inline yourself and record `approve-inline` before `complete-step --executor inline`. `codex-task:*` routes still work normally.

Your coordination contract is in your subagent definition. Follow it.
```

The lead substitutes `{ticket-id}`, `{N}`, `{peer-list}`, `{expected-worktree-path}`, and `{project-root}` for each teammate. The expected path uses the sibling convention `<parent-of-project-root>/<repo-dir-name>-worktrees/<ticket-id>/`. The rest is verbatim.

## Relay loop

Maintain a per-teammate state map: `{ teammateName: "working" | "idle" | "shutdown" }`. Mark every teammate as `"working"` on spawn.

Loop until every teammate is `"shutdown"`:

- When a teammate message arrives, surface it to the user verbatim as `[{teammate-name}] {message}`. Do not synthesize or paraphrase.
- On `STARTED ...`, `STEP ...`, `BRANCH-READY ...`: no state change; just relay.
- On `DONE <ticket-id>` from teammate T:
  1. Run `node <<SCRIPT_PATH>> fast-forward --json` in the lead checkout. If it refuses, surface the error and ask the user how to proceed.
  2. Run `node <<SCRIPT_PATH>> list --ready --limit 1 --json` to find the next ready ticket. Skip any ticket that another live teammate is already working (track currently-assigned ticket IDs alongside teammate state).
  3. If a ticket is returned: send `WORK <new-ticket-id>` to teammate T. Keep T in `"working"` and update its currently-assigned ticket.
  4. If no ticket is returned: mark T as `"idle"`. Do not send SHUTDOWN yet — a peer's DONE may produce new ready tickets (for example, decompose results) that T can pick up next round.
- On `QUESTION ...` or `ERROR ...` from teammate T: surface to user. Mark T as `"shutdown"` (the teammate is exiting after a final summary). Do not reassign.
- After processing a DONE: if every teammate is `"idle"` or `"shutdown"` and the next `list --ready --limit 1` is empty, send `SHUTDOWN` to every `"idle"` teammate and mark them `"shutdown"`.
- If two peers broadcast BRANCH-READY for branches the lead expects to conflict, surface a "potential conflict" note but let the teammates resolve.

Do not do ticket work yourself. If a teammate stalls (no message for an unusually long period after a STARTED or after receiving WORK), prompt it to continue or ask the user how to proceed.

## Final summary

When every teammate has reached `"shutdown"`:

1. Run `node <<SCRIPT_PATH>> fast-forward --json` in the lead checkout one final time. If it refuses, surface the error before summarizing.
2. For every ticket that was assigned during the session (initial batch plus all reassignments — track this list as you go), run `node <<SCRIPT_PATH>> query-ticket <id> --json` to get the final state.
3. Produce a per-ticket summary table with columns: ticket ID, teammate that worked it, final status, branch, one-line evidence summary, questions or blockers if any.
4. Explicitly call out any tickets that ended in `questions` or `blocked` as "needs user follow-up".
5. Clean up the team per the agent-teams cleanup procedure.

## Hard limits

- Maximum team size: 6 teammates. Hard-coded — the agent-teams docs recommend 3-5; 6 is the upper edge for this skill. Team size is fixed at spawn; endless mode reuses slots rather than growing the team.
- One team at a time per lead session (an agent-teams limitation).
- The lead is fixed for the team's lifetime (an agent-teams limitation).

## What the lead does NOT do

- Does not run `begin-step`, `complete-step`, `move`, or any other ticket-mutating CLI command. Teammates own ticket state.
- Does not commit, merge, or push. Teammates' `move ... done` (with `git.autoMerge`) handles their own merges and prunes the merged branch. The CLI's rebase-onto-default precondition prevents stale-merge races. The lead only runs `fast-forward` to update its default-branch checkout after teammates move the shared ref.
- Does not spawn additional teammates mid-run. Team size is fixed at spawn; reassignment is the mechanism for keeping the team busy.
- Does not enforce the rebase precondition itself — that is the CLI's job. The lead trusts the CLI.
- Does not pick a ticket for reassignment that any other live teammate is currently working. Always check the live-assignment map before sending WORK.
