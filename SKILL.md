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

Operate in the user's current project unless they specify another root. Pass `--root <path>` for non-current projects.

## Core Loop

1. Read project instructions: `AGENTS.md`, `CLAUDE.md`, and `memory-bank/` when present.
2. If `plans/` is absent and the user asked to initialize, run `node <<SCRIPT_PATH>> init`.
3. Run `node <<SCRIPT_PATH>> validate`.
4. For whole-project work, run `node <<SCRIPT_PATH>> query-next --json`.
5. For a specific ticket, run `node <<SCRIPT_PATH>> query-ticket <id> --json`.
6. Read the returned ticket `path`, returned `prompt`, and relevant project context.
7. Execute the returned `action`.
8. Mutate ticket state only through CLI commands.
9. Run `validate` again before reporting completion.

Do not infer the workflow state when `query-next` or `query-ticket` can answer it.

## Actions

- `decompose`: create child tickets, then link them with `link-parent` or `link-child`.
- `design`: write or update `## Technical Design`; move to the next configured status only when the design is complete.
- `implement`: make scoped code changes, test them, and record notes/evidence.
- `review`: inspect changes and write `## Review Findings`.
- `test`: run appropriate tests and write `## Test Evidence`.
- `document`: update docs and write `## Documentation Updates`.

Project-local prompts in `plans/prompts/` are authoritative. If a returned prompt is missing, use fallback prompts from `<<INSTALL_PATH>>/prompts/`.

## Delegation

Use `plans/local-board.config.jsonc` to decide how each action is handled. Comments and trailing commas are valid:

- `inline`: do the work in the current agent.
- `claude-subagent`: delegate to a Claude subagent when the harness supports it.
- `codex-task:read-only`: use codex-task for read-only investigation/proposals if available.
- `codex-task:workspace-write`: use codex-task for bounded edits if available and the user has approved that delegation pattern.

Delegated agents may produce proposals or patches. The orchestrator remains responsible for canonical ticket state unless a delegated worker was explicitly assigned that write scope.

If the configured agent is unavailable, explain the fallback and continue inline unless doing so would be risky.

## CLI Commands

```sh
node <<SCRIPT_PATH>> validate
node <<SCRIPT_PATH>> query-next --json
node <<SCRIPT_PATH>> query-ticket <ticket-id> --json
node <<SCRIPT_PATH>> state-report --json
node <<SCRIPT_PATH>> create <epic|story|task|bug> "<title>" --status <status> --priority <priority> [--parent <id>]
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
