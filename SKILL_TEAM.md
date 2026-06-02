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
5. Run `node <<SCRIPT_PATH>> team-config --json` to resolve `maxTeammates` (the maximum concurrent team size). It defaults to 6 and is overridden by the `LOCAL_BOARD_MAX_TEAMMATES` environment variable. Use this number as `<max>` everywhere below. Never spawn more than `<max>` live teammates at once.
6. Run `node <<SCRIPT_PATH>> list --ready --limit <max> --json` to get the initial candidate batch.
7. If the batch is empty: report "no ready tickets" and stop.
8. If the batch has exactly one ticket, decide whether parallelism can still emerge:
   - Run `node <<SCRIPT_PATH>> list --json` (the full board). If every other ticket is `done` or `archived`, there is no future parallelism — tell the user team mode is overkill for a single ticket and invoke the standard `local-board` skill instead.
   - If other open tickets exist (blocked, backlog, or dependent on the one ready ticket), engage team mode anyway. Spawn one teammate now; the relay loop will grow the team as the first ticket's completion unblocks its dependents. This is the intended path for a "one blocker, many dependents" graph.

## Spawn procedure

This procedure spawns one teammate bound to one ticket. The lead runs it once per ticket in the initial batch, and again whenever the relay loop decides to grow the team mid-run.

To spawn a teammate for a ticket:

- Name the teammate after that ticket ID (for example, `T20260522T1430Z`). This name persists across reassignments and is just a session identifier — it does not mean the teammate only works that ticket.
- Use the agent type `local-board-teammate`.
- Join it to the team (pass the team name when spawning) so the lead can reassign it later via `WORK`.
- Do not require plan approval — the teammate's own orchestrator loop handles design and approval gating.
- Send the spawn prompt below, with the ticket as its first assignment.

For the **initial batch**, spawn all teammates in parallel, not sequentially — one per ticket, capped at `<max>`. For **mid-run growth**, spawn only as many new teammates as the rebalance step calls for, never exceeding `<max>` live teammates total.

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

Maintain a per-teammate state map: `{ teammateName: "working" | "idle" | "shutdown" }`, a live-assignment map `{ teammateName: currentTicketId | null }`, and a running list of every ticket assigned during the session (for the final summary). Mark every teammate as `"working"` and record its assignment on spawn.

Loop until every teammate is `"shutdown"`:

- When a teammate message arrives, surface it to the user verbatim as `[{teammate-name}] {message}`. Do not synthesize or paraphrase.
- On `STARTED ...`, `STEP ...`, `BRANCH-READY ...`: no state change; just relay.
- On `DONE <ticket-id>` from teammate T: clear T's current assignment and mark it `"idle"`, then run the **Rebalance** routine below. A completed ticket may have unblocked several dependents at once, so rebalance both reassigns idle teammates and grows the team toward that new demand.
- On `QUESTION ...` or `ERROR ...` from teammate T: surface to user. Mark T as `"shutdown"` (the teammate is exiting after a final summary). Clear its assignment. Do not reassign. Then run **Rebalance** (a freed-up dependency may still let other teammates proceed).
- If two peers broadcast BRANCH-READY for branches the lead expects to conflict, surface a "potential conflict" note but let the teammates resolve.

Do not do ticket work yourself. If a teammate stalls (no message for an unusually long period after a STARTED or after receiving WORK), prompt it to continue or ask the user how to proceed.

### Rebalance (scale to demand)

The goal: after every completion, make the number of actively-working teammates equal `min(<max>, tickets that can be worked right now)`. Grow the team when newly-unblocked tickets exceed the idle pool; never exceed `<max>` live teammates.

1. Run `node <<SCRIPT_PATH>> fast-forward --json` in the lead checkout. If it refuses, surface the error and ask the user how to proceed before continuing.
2. Run `node <<SCRIPT_PATH>> list --ready --limit <max> --json`. Remove any ticket already in the live-assignment map (a ticket some non-shutdown teammate is currently working). Call the remainder the **ready queue**.
3. **Reuse idle teammates first** (free — no spawn cost): while the ready queue is non-empty and an `"idle"` teammate exists, send `WORK <ticket-id>` to that teammate, mark it `"working"`, record the assignment, and remove the ticket from the queue.
4. **Grow the team** only if work remains: while the ready queue is non-empty and the live teammate count (non-shutdown) is below `<max>`, run the **Spawn procedure** for the next queued ticket as that new teammate's first assignment. Mark it `"working"`, record the assignment, and remove the ticket from the queue.
5. If the ready queue still has tickets, every slot up to `<max>` is busy — leave them; the next `DONE` will pick them up.
6. If the ready queue is empty and a teammate is idle, leave it idle. Do not shut it down yet: a peer still working may produce new ready tickets (for example, `decompose` children) that this teammate can pick up next round.
7. **Shutdown check.** If, after the steps above, no teammate is `"working"` (all are `"idle"` or `"shutdown"`) and `list --ready --limit 1 --json` is empty, the queue is truly drained: send `SHUTDOWN` to every `"idle"` teammate and mark them `"shutdown"`. With no teammate working, no new tickets can appear, so this is safe.

Worked example — one blocker, six dependents: the initial batch has one ready ticket, so the lead spawns one teammate. When that teammate reports `DONE`, fast-forward + `list --ready` now returns six newly-unblocked tickets. Rebalance reassigns the now-idle teammate to the first, then spawns five more (total six, the cap), and all six proceed in parallel.

## Final summary

When every teammate has reached `"shutdown"`:

1. Run `node <<SCRIPT_PATH>> fast-forward --json` in the lead checkout one final time. If it refuses, surface the error before summarizing.
2. For every ticket that was assigned during the session (initial batch plus all reassignments — track this list as you go), run `node <<SCRIPT_PATH>> query-ticket <id> --json` to get the final state.
3. Produce a per-ticket summary table with columns: ticket ID, teammate that worked it, final status, branch, one-line evidence summary, questions or blockers if any.
4. Explicitly call out any tickets that ended in `questions` or `blocked` as "needs user follow-up".
5. Clean up the team per the agent-teams cleanup procedure.

## Hard limits

- Maximum team size: `<max>` teammates, resolved by `team-config` from `LOCAL_BOARD_MAX_TEAMMATES` (default 6). The agent-teams docs recommend 3-5; 6 is a sensible upper edge for this skill. The team grows on demand up to `<max>` and never beyond it — count non-shutdown teammates before every spawn.
- One team at a time per lead session (an agent-teams limitation).
- The lead is fixed for the team's lifetime (an agent-teams limitation).

## What the lead does NOT do

- Does not run `begin-step`, `complete-step`, `move`, or any other ticket-mutating CLI command. Teammates own ticket state.
- Does not commit, merge, or push. Teammates' `move ... done` (with `git.autoMerge`) handles their own merges and prunes the merged branch. The CLI's rebase-onto-default precondition prevents stale-merge races. The lead only runs `fast-forward` to update its default-branch checkout after teammates move the shared ref.
- Does not exceed `<max>` live teammates. The lead grows the team on demand (Rebalance) but always reuses idle teammates before spawning, and never spawns past `<max>`.
- Does not enforce the rebase precondition itself — that is the CLI's job. The lead trusts the CLI.
- Does not pick a ticket for reassignment that any other live teammate is currently working. Always check the live-assignment map before sending WORK.
