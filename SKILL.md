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
7. Read the returned ticket `path`, returned `prompt`, `branch`, `transitions`, and relevant project context.
8. Run `node <<SCRIPT_PATH>> begin-step <ticket-id> --json`.
9. Execute the returned `action` through the configured route. For `claude-subagent:<agent-name>`, delegate to the named Claude agent after the colon.
10. Run `node <<SCRIPT_PATH>> complete-step <ticket-id> <action> --executor <configuredAgent> --evidence "<evidence>"`.
11. Mutate ticket state only through CLI commands.
12. After the action, choose the next status from the returned `transitions` list and run `node <<SCRIPT_PATH>> move <ticket-id> <status> --json`.
13. Choose `done` only when all required stages are complete.
14. Run `validate` again before reporting completion.

Do not infer the workflow state when `query-next` or `query-ticket` can answer it.
Do not invent next statuses. Use the returned `transitions` list or `schema --json`.
Do not inspect local-board source files to discover statuses or command contracts. Use `schema --json`.
Do not bypass configured routing. Strict routing is policy, not preference.
Do not move ticket-dependency blockers to `blocked`. Use `block <ticket-id> <dependency-id>` and leave or return the ticket to its intended ready status so it becomes eligible when the dependency is `done` or `archived`.

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

## Transition Guidance

`query-next --json`, `query-ticket <id> --json`, and `begin-step <id> --json` return a `transitions` array for the ticket's current status. Each item has:

- `status`: exact value to pass to `move`;
- `when`: the condition for choosing that status.

Use those statuses after completing the action. Examples:

- review passes: move to `ready_for_test`;
- review finds implementation gaps: move to `ready_for_implementation`;
- review finds a fundamental design flaw: move to `ready_for_design`;
- any stage needs user input: move to `questions` and write the question;
- ticket dependency blocks progress: use `block <ticket-id> <dependency-id>` and keep or return the ticket to its intended ready status;
- non-ticket blocker stops progress: move to `blocked` and record the blocker.

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

## Done and Auto-Merge

Use `move <ticket-id> done --json` only after required design, implementation, review, test, and documentation evidence is recorded.

When `git.autoMerge` is `true`, `move ... done` also:

- verifies the current branch is the ticket's recorded `branch`;
- refuses uncommitted non-planning changes;
- commits planning-only ticket updates when `git.commitPlanningChanges` is `true`;
- switches to `git.defaultBranch` or the detected default branch;
- merges the ticket branch into the default branch.

When `retention.archiveOnMoveDone` is `true`, `move ... done` also archives other `done` tickets whose `updated` timestamp is older than `retention.archiveDoneAfterDays`. Archived tickets remain closed and still satisfy dependencies.

If auto-merge refuses to proceed, fix the reported git state or ask the user. Do not mark the ticket done by manual front matter edits.

## Specialty Steps

After the mandatory action for a `design`, `implement`, or `test` stage completes (evidence recorded via `complete-step`) and before running `move <ticket-id> <next-status>`, run gate-check to ask the gate agent which specialty reviews apply.

Gate-check is not run after `decompose` or `document`.

```sh
node <<SCRIPT_PATH>> gate-check <ticket-id> --stage <stage> --json
```

`<stage>` must be one of `design`, `implement`, or `test`. The CLI returns the gate-check `prompt` path, a narrow `ticketContext`, and the stage `catalog` of available specialty entries. The CLI does not invoke an agent.

Dispatch the gate-check prompt through the configured agent (or inline) and parse the agent's strict JSON response:

```json
{ "requestedSteps": ["security_audit"] }
```

An empty `requestedSteps` array is the normal case; skip the specialty pass and proceed to `move`.

For each name in `requestedSteps`, resolve the specialty:

```sh
node <<SCRIPT_PATH>> specialty-run <ticket-id> <step-name> --json
```

`specialty-run` derives the stage automatically from ticket status; do not pass `--stage`. It returns the resolved `prompt`, the `agent` route (defaulting to `inline`), and a narrow `ticketContext`. Dispatch the prompt through that route, parse the specialty agent's `verdict` (`PASS` / `CONCERNS` / `FAIL`) plus `findings`, then record evidence:

```sh
node <<SCRIPT_PATH>> complete-step <ticket-id> <step-name> --executor <executor> --evidence "<VERDICT>: <short summary>"
```

Use the exact `<step-name>` returned by gate-check. `specialty-run` rejects unknown names. Use the resolved executor string (the `agent` value from `specialty-run`, or `inline`) so the `<step-name>:<executor>` evidence pair satisfies strict routing.

Only after every requested specialty has recorded completion evidence does the orchestrator run `move <ticket-id> <next-status>`.

Specialty evidence is never gated by `routing.doneRequires`; it lives in `completedSteps` for traceability but never blocks closeout. Tickets that run zero specialties still pass `validate` and `move ... done`.

## Delegation

Use `plans/local-board.config.jsonc` to decide how each action is handled. Comments and trailing commas are valid:

- `inline`: do the work in the current agent.
- `claude-subagent:<agent-name>`: delegate to the named Claude subagent when the harness supports it.
- `codex-task:<mode>`: use codex-task in the configured mode, such as `codex-task:read-only` or `codex-task:workspace-write`.

Bundled Claude subagent names:

- `local-board-decomposer`
- `local-board-designer`
- `local-board-implementer`
- `local-board-reviewer`
- `local-board-tester`
- `local-board-documenter`

### Persisting Delegated Output

The `local-board-designer`, `local-board-reviewer`, `local-board-tester`, and `local-board-decomposer` subagents have only Read, Glob, Grep, and Bash. They have no Write or Edit tool and are return-only:

- They return their section content — Technical Design, Review Findings, Test Evidence — as Markdown in their final message.
- They do not create files and do not run `section` themselves.
- The orchestrator takes that returned content, writes it to a temp file with the Write tool, and runs `section <ticket-id> --file <temp-path> --section "<Section>"` itself.

Never instruct a return-only subagent to "write a temp file" or "use the Write tool". It cannot, and it falls back to Bash `echo`/heredoc/`Set-Content`, which loops endlessly on backtick and code-fence escaping. The same return-only contract applies to any `codex-task:read-only` route.

The `local-board-implementer` and `local-board-documenter` subagents do have Write and Edit. They persist their own file changes — using Write and Edit, never Bash redirection.

Whenever a CLI command needs a file argument (such as `section --file`), create that file with the Write tool. Never build it with `echo`, heredoc, `Set-Content`, or `Out-File`.

The orchestrator remains responsible for canonical ticket state unless a delegated worker was explicitly assigned write scope.

When recording completion evidence, use the exact configured executor string from `begin-step`, for example `claude-subagent:local-board-designer`.

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
node <<SCRIPT_PATH>> gate-check <ticket-id> --stage <stage> [--json]
node <<SCRIPT_PATH>> specialty-run <ticket-id> <step-name> [--json]
node <<SCRIPT_PATH>> calibration suggest <ticket-id> [--json]
node <<SCRIPT_PATH>> estimate <ticket-id> <points> [--basis <ticket-id-or-bootstrap>] [--force] [--json]
node <<SCRIPT_PATH>> move <ticket-id> <status> [--json]
node <<SCRIPT_PATH>> set <ticket-id> <field> <value>
node <<SCRIPT_PATH>> section <ticket-id> "<text>" --section "<section>"
node <<SCRIPT_PATH>> section <ticket-id> --file <path> --section "<section>"
node <<SCRIPT_PATH>> comment <ticket-id> "<text>" [--section "<section>"]
node <<SCRIPT_PATH>> link-parent <child-id> <parent-id>
node <<SCRIPT_PATH>> link-child <parent-id> <child-id>
node <<SCRIPT_PATH>> block <ticket-id> <dependency-id>
node <<SCRIPT_PATH>> unblock <ticket-id> <dependency-id>
```

Use `comment` for run-log style notes. Use `move` for status transitions. Use relationship commands for parent/child and dependency state.
Use `section --file <path>` for generated or multi-line Markdown. Inline `section <text>` is only for short edits. Create the `--file` target with the Write tool; never build it with `echo`, heredoc, `Set-Content`, or `Out-File`.
Use `blockedBy` for ticket dependencies without moving the dependent ticket to `blocked`.
