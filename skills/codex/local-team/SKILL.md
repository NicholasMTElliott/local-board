---
name: local-team
description: Work several local-board tickets in parallel from one top-level Codex orchestrator session. Use when the user asks Codex to work tickets in parallel, work the next N local-board tickets, or create a local-board team. The skill uses local-board worktrees, wave-barrier dispatch, Codex spawned agents, and CLI-owned ticket state transitions.
---

# local-team for Codex

Use the `local-board` command on PATH:

```sh
local-board
```

Installation metadata:

- Runtime directory: `<<INSTALL_PATH>>`
- Codex executor prompts: `<<INSTALL_PATH>>/agents/codex/`

Do not search the filesystem for local-board source or scripts. Use the `local-board` command on PATH.

You are the top-level orchestrator. Keep up to `maxInFlight` tickets active, dispatch each step to a Codex spawned agent when configured, and keep the ticket file plus per-ticket worktree as the durable baton. Executors do work; you own all ticket-state mutations.

## Preflight

1. Read project instructions: `AGENTS.md`, `CLAUDE.md`, and `memory-bank/` when present.
2. Run `local-board validate`. Stop on validation errors.
3. Run `local-board fast-forward --json`. Stop if it refuses.
4. Run `local-board team-config --json`. Treat `maxTeammates` as `maxInFlight`; prefer about 3 even if the cap is higher.
5. Run `local-board list --ready --limit <maxInFlight> --json`. If empty, report no ready tickets and stop.

## Wave-Barrier Scheduling

Use wave-barrier mode first:

1. For each ready ticket up to `maxInFlight`, run `worktree-add <ticket-id> --json` from the project root and store `worktreePath`.
2. For each in-flight ticket without an outstanding executor:
   - run `begin-step --root <worktreePath> --json`;
   - run `start-work --root <worktreePath> --json` before implement/review/test/document;
   - dispatch the step through the Codex route translation table from the `local-board` skill.
3. Await the wave of spawned agents.
4. Persist each result, record `complete-step`, run gate-check/specialty flow for design/implement/test, then `move`.
5. Refill open slots with newly ready tickets.
6. Repeat until no tickets are in flight and no ready tickets remain.

Do not use event-loop pipelining in v1. The barrier keeps scheduling, conflict checks, and context compaction tractable.

## Worktrees

Every in-flight ticket uses a separate worktree (location per `worktrees.location`;
see `docs/CodexSupport.md` "Worktrees and the sandbox" — set
`worktrees.location: "inside"` to avoid `workspace-write` sandbox escalations):

```sh
local-board worktree-add <ticket-id> --json
```

Pass `--root <worktreePath>` to every per-ticket command after creation. Give spawned agents the worktree path and require edits to happen there.

Remove the worktree after successful closeout:

```sh
local-board worktree-remove <ticket-id> --root <project-root>
```

## Route Translation

Use the same translation rules as the Codex `local-board` skill:

- `inline`: current Codex orchestrator performs the step.
- `codex-task:read-only`: spawn an `explorer`.
- `codex-task:workspace-write`: spawn a `worker`.
- known `claude-subagent:local-board-*`: translate to the matching Codex executor prompt in `<<INSTALL_PATH>>/agents/codex/`.
- unknown `claude-subagent:*`: ask before inline fallback; otherwise move to `questions`.

Preserve the configured logical route in `complete-step`, suffixed with `@codex-default` when a Claude route was physically handled by Codex and no valid Codex model id was used. Do not pass Claude model aliases (`opus`, `sonnet`, `haiku`) as Codex model overrides.

## Orchestrator-Owned State

You own:

- `worktree-add`, `worktree-remove`, and `fast-forward`;
- `begin-step`, `start-work`, `complete-step`, `approve-inline`, and `move`;
- return-only section persistence with `section --file`;
- gate-check and specialty dispatch;
- conflict decisions and closeout.

Executors do not change ticket status. Return-only executors do not edit files. Worker executors may edit their assigned worktree scope only and must not revert edits made by others.

## Conflict Gate

When a ticket reaches `ready_for_review`, record changed files from its branch. Before dispatching another `implement` step with overlapping scope, serialize it or instruct the worker to merge the peer branch first. The CLI's closeout/rebase checks remain the mandatory backstop.

## Closeout

On terminal work, run:

```sh
local-board move <ticket-id> done --root <worktreePath> --json
```

If it refuses because the branch lacks the latest default, commit planning-only ticket edits in the worktree, rebase the ticket branch onto default, and retry. If conflicts cannot be resolved safely, move the ticket to `questions`.

After each successful `done`, run `fast-forward --json` in the project root and then `worktree-remove`.

## Final Summary

Report a compact table: ticket id, final status, branch, route/model evidence, tests or checks, and blockers/questions.
