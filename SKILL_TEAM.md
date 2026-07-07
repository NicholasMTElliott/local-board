---
name: local-team
description: Work several local-board tickets in parallel from one top-level orchestrator session. The orchestrator keeps up to a configurable number of tickets in flight, dispatching each pipeline step to an ephemeral, model-specialized executor (subagent or codex), with the ticket file and a per-ticket git worktree as the durable baton. Use when the user asks to "work my tickets in parallel", "work the next N tickets at once", or otherwise requests parallel local-board operation.
allowed-tools:
  - Bash(local-board *)
---

# local-board parallel orchestrator

You are the orchestrator. You run in the top-level session, so you can dispatch
subagents and pin a different model per step — that is the whole point of this
mode. You work several tickets concurrently by dispatching each step to an
ephemeral executor and routing each ticket through the pipeline. You own all
ticket-state mutations; executors only do the work and report back.

This replaces the older agent-teams "one teammate per ticket" design. There are
no teammate sessions and no `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` requirement.
Parallelism comes from dispatching multiple step executors at once from this one
session.

Use the `local-board` command on PATH:

```sh
local-board
```

Installation metadata:

- Runtime directory: `<<INSTALL_PATH>>`

Operate in the user's current project unless they specify another root. Pass
`--root <path>` for non-current projects and `--root <worktreePath>` for all
per-ticket calls (see Worktrees).

## When to use it

Best for a few tickets with deep pipelines where each step should run on its
optimal model (haiku gate-check, opus design, sonnet implement, codex review,
etc.). With a single ready ticket and nothing else open, prefer the standard
`local-board` skill — it is the N=1 case of this same loop with less overhead.

## Preflight

1. Read project instructions: `AGENTS.md`, `CLAUDE.md`, and `memory-bank/` when present.
2. `local-board validate`. Stop on validation errors.
3. `local-board fast-forward --json`. This confirms you are on the detected default branch with a clean tree before any worktree merges move the default ref. Stop if it refuses.
4. `local-board team-config --json` to resolve the concurrency cap. Treat the returned `maxTeammates` as **`maxInFlight`** — the maximum number of tickets you keep in flight at once. It defaults to 6 and is overridden by `LOCAL_BOARD_MAX_TEAMMATES`. The real limiter is your own context budget (every step result funnels into this one window) and how many tickets you can schedule accurately at once, not raw tokens. A validation run confirmed 2 concurrent tickets are trivially manageable; **prefer ≈3** unless a project raises the cap deliberately. Never exceed `maxInFlight`.
5. `local-board list --ready --limit <maxInFlight> --json` for the initial batch. If empty, report "no ready tickets" and stop.

## Execution profiles

For each step, `begin-step <ticket-id> --json` returns:

- `configuredAgent`: the route (`inline`, `claude-subagent:<name>`, `codex-task:<mode>`);
- `configuredModel`: the per-step model, or null;
- `configuredPrompt`: the step prompt path.

Dispatch the step accordingly:

- `inline`: do it yourself, on your own model. `inline` cannot carry a per-step model.
- `claude-subagent:<name>`: dispatch that subagent. When `configuredModel` is non-null, pin the subagent's model to it. Run it in the background so other tickets progress concurrently. **Every dispatch prompt must begin with a first line of the exact form `Ticket: <id>`** — the machine-readable anchor the optional dispatch-ledger/routing-validator hooks (`local-board install --hooks`) parse to verify the dispatch happened.
- `codex-task:<mode>`: shell out to codex in that mode (a Bash call, so it works without the Task tool).

Whole steps can be delegated to an external agent purely by routing the action to
`codex-task:*` in config — no special handling here.

## Worktrees

Each in-flight ticket gets its own git worktree in the sibling
`<repo-name>-worktrees/<ticket-id>/` directory. Do not call `git worktree`
directly. For each ticket, before its first step:

```sh
local-board worktree-add <ticket-id> --json
```

Capture `worktreePath`. Pass `--root <worktreePath>` on every later local-board
call for that ticket (`start-work`, `begin-step`, `complete-step`, `move`,
`section`, `comment`). Each step executor you dispatch must also operate against
that worktree (pass it the `worktreePath` and instruct it to use
`--root <worktreePath>` and to `cd` there for edits and git). Remove the worktree
right after the ticket reaches `done`:

```sh
local-board worktree-remove <ticket-id> --root <project-root>
```

## Control loop

Maintain small in-context state per in-flight ticket:
`{ ticketId -> { action, status, branch, worktreePath, executorId | null, profile } }`,
a `branchReady` map (`ticketId -> changed files` once a ticket reaches
`ready_for_review`), and an `assignedLog` of every ticket processed (for the
final summary). The ticket files are the source of truth; this state is just a
scheduling cache and is cheap to rebuild after a compaction.

1. **Seed.** For up to `maxInFlight` ready tickets: `worktree-add` (this creates
   and records the ticket branch). Add to the in-flight map. Do **not** run
   `start-work` yet — see the ordering note in Dispatch.
2. **Dispatch.** For each in-flight ticket with no outstanding executor and not
   gated on a peer-merge:
   - `begin-step --root <worktreePath> --json` **first**, to resolve the action +
     profile while the ticket is still in its `ready_*` status.
   - Then `start-work --root <worktreePath>` (records the branch in the run log
     and moves `ready_for_implementation → implementing`).
   - Then dispatch the step per its profile (background for concurrency) and
     record the executor.

   Ordering matters: `start-work` moves `ready_for_implementation` to
   `implementing`, and `implementing` has no `statusActions` entry, so a
   `begin-step` run *after* `start-work` fails with "no configured action".
   Resolve the step before `start-work`, or pass `begin-step --action <action>`.
3. **Await.** Process executor completions as they arrive. Surface each result to
   the user tagged with the ticket id.
4. **On completion** for a ticket:
   - Return-only result (reviewer, tester, gate-check, codex read-only) → write a
     temp file with the Write tool, `section --file --root <worktreePath>`, then
     `complete-step <action> --executor <route>[@<model>] --root <worktreePath> --evidence "..."`.
   - Self-writing result (designer, implementer, documenter) → the executor
     already wrote its section/files in the worktree; just record
     `complete-step <action> --executor <route>[@<model>] --root <worktreePath> --evidence "..."`.
   - Run gate-check + specialty-run for `design`/`implement`/`test` stages (same
     contract as single-ticket mode) before transitioning. When `gate-check`
     returns an empty `catalog`, skip the gate-agent dispatch entirely — there is
     nothing to classify.
   - Choose the next status from the returned `transitions` and `move`. If the
     ticket continues, dispatch its next step. If it hits `questions`/`blocked`,
     surface it and drop it from in-flight (keep in `assignedLog`).
5. **Conflict gate (two layers).**
   - *Layer 1, best-effort:* when a ticket enters `ready_for_review`, record its
     `git diff --name-only` in `branchReady`. Before dispatching an `implement`
     step whose scope overlaps a `branchReady` peer, instruct that implement
     executor to merge the peer branch(es) first and resolve conflicts.
   - *Layer 2, backstop:* the CLI's rebase-onto-default precondition on
     `move … done` is the guarantee. See Closeout.
   - Avoid dispatching two implement steps you already know overlap (from design
     scope) concurrently — serialize those.
6. **Refill.** When an in-flight ticket terminates and the ready queue is
   non-empty and in-flight `< maxInFlight`, pull the next ready ticket
   (`worktree-add`, then `begin-step` before `start-work` as in Dispatch) and
   begin dispatching it. Newly-unblocked dependents and `decompose` children
   appear on the next `list --ready`.
7. **Closeout.** On a ticket's terminal step, run `move <ticket-id> done --root <worktreePath> --json`
   (auto-merge + rebase-onto-default precondition + prune). If it refuses because
   the branch lacks the latest default, rebase that ticket's branch onto the
   default in its worktree, then retry. **Commit any planning-change edits in the
   worktree before rebasing** — `move`/`complete-step` leave the ticket file
   dirty, and `git rebase` refuses a dirty tree. On an unresolvable conflict,
   `move` it to `questions`. After each successful `move … done`, run
   `local-board fast-forward --json` to reconcile your own checkout, then
   `worktree-remove`.
8. **Terminate.** When the ready queue is empty and nothing is in flight, emit a
   final per-ticket summary table: ticket, model(s) used per step, final status,
   branch, one-line evidence, and any questions/blockers.

## Concurrency mode

- **Wave-barrier (use this first):** dispatch every in-flight ticket's next step
  as one parallel batch, await the whole batch, then advance + conflict-check +
  refill. Deterministic and easy to keep correct. The gaps between waves are
  natural, safe boundaries to run `/compact` when context grows.
- **Event loop (optimization):** dispatch a ticket's next step as soon as its
  previous step returns, without waiting for a barrier. Maximal pipelining; adopt
  once the wave-barrier flow is solid.

## Context budget

Every step result lands in this one window, so the limiter is cumulative tokens
across the session, not the number of concurrent tickets. Keep returns terse
(the designer self-writes its large section and returns a summary; pass step
prompts by reference where possible) and run `/compact` at wave boundaries on
long runs. Your scheduling state is rebuildable from the ticket files, so it
survives compaction cheaply.

## What the orchestrator owns vs executors

- **You (orchestrator):** worktree lifecycle, `start-work`, `begin-step`,
  `complete-step`, `move`, gate-check/specialty dispatch, conflict decisions,
  closeout, `fast-forward`, and the final summary. You never let an executor own
  a status transition.
- **Executors:** do the actual design/implement/review/test/docs work in the
  worktree and return a terse, structured result. The designer/implementer/
  documenter write their own sections/files; return-only executors return content
  for you to persist.

## What this mode does NOT do

- Does not use agent-teams, teammate sessions, or a fixed lead. One orchestrator
  session does it all.
- Does not exceed `maxInFlight` tickets in flight.
- Does not transition tickets by narrative text — only through CLI commands.
- Does not enforce the rebase precondition itself — that is the CLI's job; you
  react to its refusal.
