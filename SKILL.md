---
name: local-board-orchestrator
description: Operate a repo-native local-board planning system where tickets are Markdown files under plans/tickets. Use when the user asks to run local-board, work the next ticket, work a specific ticket, decompose an epic/story, initialize local-board in a repo, or continue a file-backed planning workflow. The skill validates tickets, queries deterministic workflow state through the local-board CLI, loads project prompts/config, delegates bounded steps when configured, and updates canonical ticket state through CLI commands.
allowed-tools:
  - Bash(node <<SCRIPT_PATH>> *)
---

# local-board orchestrator

Use the installed CLI:

```sh
node <<SCRIPT_PATH>>
```

Installation metadata:

- Runtime directory: `<<INSTALL_PATH>>`
- CLI entrypoint: `<<SCRIPT_PATH>>`

Do not search the filesystem for local-board source or scripts. Use the CLI entrypoint above.

Operate in the user's current project unless they specify another root. Pass `--root <path>` for non-current projects.

## Core Loop

1. Read project instructions: `AGENTS.md`, `CLAUDE.md`, and `memory-bank/` when present.
2. If `plans/` is absent and the user asked to initialize, run `node <<SCRIPT_PATH>> init`.
3. Run `node <<SCRIPT_PATH>> schema --json` when you need accepted statuses, priorities, actions, or agent values.
4. Run `node <<SCRIPT_PATH>> validate`.
5. For whole-project work, run `node <<SCRIPT_PATH>> query-next --json`.
6. For a specific ticket, run `node <<SCRIPT_PATH>> query-ticket <id> --json`.
7. Read the returned ticket `path`, returned `prompt`, `branch`, and relevant project context.
8. Run `node <<SCRIPT_PATH>> begin-step <ticket-id> --json`.
9. Execute the returned `action` through the configured route.
10. Run `node <<SCRIPT_PATH>> complete-step <ticket-id> <action> --executor <executor> --evidence "<evidence>"`.
11. Mutate ticket state only through CLI commands.
12. Run `validate` again before reporting completion.

Do not infer the workflow state when `query-next` or `query-ticket` can answer it.
Do not inspect local-board source files to discover statuses or command contracts. Use `schema --json`.
Do not bypass configured routing. Strict routing is policy, not preference.

## Process Contract

Ticket types: `epic`, `story`, `task`, `bug`.

Statuses:

- `backlog`
- `ready_for_decomposition`
- `ready_for_design`
- `designing`
- `questions`
- `ready_for_implementation`
- `implementing`
- `ready_for_review`
- `reviewing`
- `ready_for_test`
- `testing`
- `ready_for_docs`
- `done`
- `blocked`
- `archived`

Eligible trigger statuses:

- `ready_for_decomposition`
- `ready_for_design`
- `ready_for_implementation`
- `ready_for_review`
- `ready_for_test`
- `ready_for_docs`

Priorities: `P0`, `P1`, `P2`, `P3`, `P4`.

## Actions

- `decompose`: create child tickets, then link them with `link-parent` or `link-child`.
- `design`: write or update `## Technical Design`; move to the next configured status only when the design is complete.
- `implement`: make scoped code changes, test them, and record notes/evidence.
- `review`: inspect changes and write `## Review Findings`.
- `test`: run appropriate tests and write `## Test Evidence`.
- `document`: update docs and write `## Documentation Updates`.

Project-local prompts in `plans/prompts/` are authoritative. If a returned prompt is missing, use fallback prompts from `<<INSTALL_PATH>>/prompts/`.

## Branch Discipline

Before `implement`, `review`, `test`, or `document`, run:

```sh
node <<SCRIPT_PATH>> start-work <ticket-id> --json
```

`start-work` creates a branch when the ticket has no `branch`, switches to a recorded existing branch when it exists, records the selected branch in front matter, appends a run-log entry, and moves `ready_for_implementation` tickets to `implementing`.

If the user pre-seeded work on a branch that is not yet recorded in the ticket, run:

```sh
node <<SCRIPT_PATH>> start-work <ticket-id> --branch <branch-name> --json
```

When switching to an existing branch, `start-work` refuses a dirty worktree unless `--allow-dirty` is supplied. Do not use plain `git switch` for ticket work unless the CLI command is unavailable or the user explicitly asks for manual git control.

## Delegation

Use `plans/local-board.config.jsonc` to decide how each action is handled. Comments and trailing commas are valid:

- `inline`: do the work in the current agent.
- `claude-subagent`: delegate to a Claude subagent when the harness supports it.
- `codex-task:read-only`: use codex-task for read-only investigation/proposals if available.
- `codex-task:workspace-write`: use codex-task for bounded edits if available and the user has approved that delegation pattern.

Delegated agents may produce proposals or patches. The orchestrator remains responsible for canonical ticket state unless a delegated worker was explicitly assigned that write scope.

If the configured agent is unavailable, do not continue inline by default. Ask the user for approval. If approved, run:

```sh
node <<SCRIPT_PATH>> approve-inline <ticket-id> <action> --reason "<user-approved reason>"
```

Then run `complete-step` with `--executor inline`. If the user does not approve the deviation, move the ticket to `questions` and record the blocker.

## CLI Commands

```sh
node <<SCRIPT_PATH>> validate
node <<SCRIPT_PATH>> query-next --json
node <<SCRIPT_PATH>> query-ticket <ticket-id> --json
node <<SCRIPT_PATH>> state-report --json
node <<SCRIPT_PATH>> schema --json
node <<SCRIPT_PATH>> create <epic|story|task|bug> "<title>" --status <status> --priority <priority> [--parent <id>]
node <<SCRIPT_PATH>> start-work <ticket-id> [--branch <branch>] [--allow-dirty] [--json]
node <<SCRIPT_PATH>> begin-step <ticket-id> [--action <action>] [--json]
node <<SCRIPT_PATH>> complete-step <ticket-id> <action> --executor <executor> --evidence "<evidence>" [--json]
node <<SCRIPT_PATH>> approve-inline <ticket-id> <action> --reason "<reason>" [--json]
node <<SCRIPT_PATH>> move <ticket-id> <status>
node <<SCRIPT_PATH>> set <ticket-id> <field> <value>
node <<SCRIPT_PATH>> section <ticket-id> "<text>" --section "<section>"
node <<SCRIPT_PATH>> comment <ticket-id> "<text>" [--section "<section>"]
node <<SCRIPT_PATH>> link-parent <child-id> <parent-id>
node <<SCRIPT_PATH>> link-child <parent-id> <child-id>
node <<SCRIPT_PATH>> block <ticket-id> <dependency-id>
node <<SCRIPT_PATH>> unblock <ticket-id> <dependency-id>
```

Use `comment` for run-log style notes. Use `move` for status transitions. Use relationship commands for parent/child and dependency state.
