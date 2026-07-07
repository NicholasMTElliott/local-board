---
name: local-board
description: Operate a repo-native local-board planning system where tickets are Markdown files under plans/tickets. Use when the user asks to run local-board, work the next ticket, work a specific ticket, decompose an epic/story, initialize local-board in a repo, or continue a file-backed planning workflow. The skill validates tickets, queries deterministic workflow state through the local-board CLI, loads project prompts/config, delegates bounded steps when configured, and updates canonical ticket state through CLI commands.
allowed-tools:
  - Bash(local-board *)
---

# local-board orchestrator

Use the `local-board` command on PATH:

```sh
local-board
```

Installation metadata:

- Runtime directory: `<<INSTALL_PATH>>`

Do not search the filesystem for local-board source or scripts. Use the `local-board` command on PATH.

Operate in the user's current project unless they specify another root. Pass `--root <path>` for non-current projects.

## Core Loop

1. Read project instructions: `AGENTS.md`, `CLAUDE.md`, and `memory-bank/` when present.
2. If `plans/` is absent and the user asked to initialize, run `local-board init`.
3. Run `local-board schema --json` when you need accepted statuses, priorities, actions, or agent values.
4. Run `local-board validate`.
5. For whole-project work, run `local-board query-next --json`.
6. For a specific ticket, run `local-board query-ticket <id> --json`.
7. Read the returned ticket `path`, returned `prompt`, `branch`, `transitions`, and relevant project context.
8. Run `local-board begin-step <ticket-id> --json`. It returns `configuredAgent` (the route), `configuredModel` (the per-step model, or null), and `configuredPrompt`.
9. Execute the returned `action` through the configured route. For `claude-subagent:<agent-name>`, dispatch the named Claude subagent after the colon and, when `configuredModel` is non-null, pin that subagent's model to `configuredModel` at dispatch. For `codex-task:<mode>`, shell out to codex in that mode. For `inline`, do the work yourself on your own model. Per-step models only take effect on subagent/codex routes — `inline` always runs on the orchestrator's model.
10. Run `local-board complete-step <ticket-id> <action> --executor <configuredAgent>[@<configuredModel>] --evidence "<evidence>"`. Append `@<configuredModel>` when a model was pinned, so the evidence records which model ran. Under strict routing, when the route matches the configured route and a model is pinned, `complete-step` requires the executor's `@model` suffix to match `configuredModel` (or `@codex-default` for a Codex-translated run, or an `approve-inline --executor <route>@<model>` approval) — otherwise it is rejected.
11. Mutate ticket state only through CLI commands.
12. After the action, choose the next status from the returned `transitions` list and run `local-board move <ticket-id> <status> --json`.
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
local-board start-work <ticket-id> --json
```

`start-work` creates a branch when the ticket has no `branch`, switches to a recorded existing branch when it exists, records the selected branch in front matter, appends a run-log entry, and moves `ready_for_implementation` tickets to `implementing`.

Run `begin-step` (to resolve the action and its `configuredAgent`/`configuredModel`) **before** `start-work` for the implement step: `start-work` moves `ready_for_implementation → implementing`, and `implementing` has no `statusActions` entry, so a later `begin-step` fails with "no configured action". Resolve first, or pass `begin-step --action implement`.

If the user pre-seeded work on a branch that is not yet recorded in the ticket, run:

```sh
local-board start-work <ticket-id> --branch <branch-name> --json
```

When switching to an existing branch, `start-work` refuses a dirty worktree unless `--allow-dirty` is supplied. Do not use plain `git switch` for ticket work unless the CLI command is unavailable or the user explicitly asks for manual git control.

## Done and Auto-Merge

Use `move <ticket-id> done --json` only after required design, implementation, review, test, and documentation evidence is recorded.

When `git.autoMerge` is `true`, `move ... done` also:

- verifies the current branch is the ticket's recorded `branch`;
- refuses uncommitted non-planning changes;
- commits planning-only ticket updates when `git.commitPlanningChanges` is `true`;
- switches to `git.defaultBranch` or the detected default branch;
- merges the ticket branch into the default branch;
- deletes the merged ticket branch when `git.pruneMergedBranches` is `true` (default).

When `retention.archiveOnMoveDone` is `true`, `move ... done` also archives other `done` tickets whose `updated` timestamp is older than `retention.archiveDoneAfterDays`. Archived tickets remain closed and still satisfy dependencies.

If auto-merge refuses to proceed, fix the reported git state or ask the user. Do not mark the ticket done by manual front matter edits.

## Specialty Steps

After the mandatory action for a `design`, `implement`, or `test` stage completes (evidence recorded via `complete-step`) and before running `move <ticket-id> <next-status>`, run gate-check to ask the gate agent which specialty reviews apply.

Gate-check is not run after `decompose` or `document`.

```sh
local-board gate-check <ticket-id> --stage <stage> --json
```

`<stage>` must be one of `design`, `implement`, or `test`. The CLI returns the gate-check `prompt` path, the configured gate-check `agent` (route) and `model`, a narrow `ticketContext`, and the stage `catalog` of available specialty entries. The CLI does not invoke an agent.

Dispatch the gate-check prompt through the returned `agent` route, pinning the subagent's model to the returned `model` when non-null (the bundled `local-board-gatecheck` agent runs on `haiku` by default). Parse the agent's strict JSON response:

```json
{ "requestedSteps": ["security_audit"] }
```

An empty `requestedSteps` array is the normal case; skip the specialty pass and proceed to `move`.

For each name in `requestedSteps`, resolve the specialty:

```sh
local-board specialty-run <ticket-id> <step-name> --json
```

`specialty-run` derives the stage automatically from ticket status; do not pass `--stage`. It returns the resolved `prompt`, the `agent` route (defaulting to `inline`), and a narrow `ticketContext`. Dispatch the prompt through that route, parse the specialty agent's `verdict` (`PASS` / `CONCERNS` / `FAIL`) plus `findings`, then record evidence:

```sh
local-board complete-step <ticket-id> <step-name> --executor <executor> --evidence "<VERDICT>: <short summary>"
```

Use the exact `<step-name>` returned by gate-check. `specialty-run` rejects unknown names. Use the resolved executor string (the `agent` value from `specialty-run`, or `inline`) so the `<step-name>:<executor>` evidence pair satisfies strict routing.

Only after every requested specialty has recorded completion evidence does the orchestrator run `move <ticket-id> <next-status>`.

Specialty evidence is never gated by `routing.doneRequires`; it lives in `completedSteps` for traceability but never blocks closeout. Tickets that run zero specialties still pass `validate` and `move ... done`.

## Delegation

Use `plans/local-board.config.jsonc` to decide how each action is handled. Comments and trailing commas are valid:

Each entry is a route string or a `{ route, model?, prompt? }` profile. `begin-step` resolves it to `configuredAgent` (route), `configuredModel`, and `configuredPrompt`.

- `inline`: do the work in the current agent, on the orchestrator's model. `inline` cannot carry a per-step model.
- `claude-subagent:<agent-name>`: dispatch the named Claude subagent. When `configuredModel` is set, pin the subagent's model to it at dispatch — this is how per-step models (haiku gate-check, opus design, sonnet implement, etc.) take effect.
- `codex-task:<mode>`: use codex-task in the configured mode, such as `codex-task:read-only` or `codex-task:workspace-write`.

Bundled Claude subagent names:

- `local-board-decomposer`
- `local-board-designer`
- `local-board-gatecheck`
- `local-board-implementer`
- `local-board-reviewer`
- `local-board-tester`
- `local-board-documenter`

### Persisting Delegated Output

The `local-board-reviewer`, `local-board-tester`, `local-board-decomposer`, and `local-board-gatecheck` subagents have only Read, Glob, Grep, and Bash. They have no Write or Edit tool and are return-only:

- They return their section content — Review Findings, Test Evidence — or strict JSON (gate-check `requestedSteps`) in their final message.
- They do not create files and do not run `section` themselves.
- The orchestrator takes that returned content, writes it to a temp file with the Write tool, and runs `section <ticket-id> --file <temp-path> --section "<Section>"` itself.

Never instruct a return-only subagent to "write a temp file" or "use the Write tool". It cannot, and it falls back to Bash `echo`/heredoc/`Set-Content`, which loops endlessly on backtick and code-fence escaping. The same return-only contract applies to any `codex-task:read-only` route.

The `local-board-designer`, `local-board-implementer`, and `local-board-documenter` subagents have Write and Edit. They persist their own output — the designer writes its own `Technical Design` section and returns a terse summary; the implementer and documenter write their file changes. All three use Write and Edit, never Bash redirection.

Whenever a CLI command needs a file argument (such as `section --file`), create that file with the Write tool. Never build it with `echo`, heredoc, `Set-Content`, or `Out-File`.

The orchestrator remains responsible for canonical ticket state unless a delegated worker was explicitly assigned write scope.

When recording completion evidence, use the configured route from `begin-step`, suffixed with `@<configuredModel>` when a model was pinned — for example `claude-subagent:local-board-designer@opus`. Strict routing matches the route, and when the route matches and a model is pinned, also requires the `@model` suffix to match (or `@codex-default`, or an approved deviation — see below).

If the configured agent is unavailable, do not continue inline by default. Ask the user for approval. If approved, run:

```sh
local-board approve-inline <ticket-id> <action> --reason "<user-approved reason>"
```

Then run `complete-step` with `--executor inline`. If the user does not approve the deviation, move the ticket to `questions` and record the blocker.

If instead the route is fine but the pinned model is unavailable (e.g. `opus` unavailable, running `sonnet`), approve the model deviation while keeping the route:

```sh
local-board approve-inline <ticket-id> <action> --executor <configuredAgent>@<actualModel> --reason "<user-approved reason>"
```

Then run `complete-step` with `--executor <configuredAgent>@<actualModel>`.

## CLI Commands

```sh
local-board validate
local-board query-next --json
local-board query-ticket <ticket-id> --json
local-board state-report --json
local-board schema --json
local-board create <epic|story|task|bug> "<title>" --status <status> --priority <priority> [--parent <id>]
local-board start-work <ticket-id> [--branch <branch>] [--allow-dirty] [--json]
local-board begin-step <ticket-id> [--action <action>] [--json]
local-board complete-step <ticket-id> <action> --executor <executor> --evidence "<evidence>" [--json]
local-board approve-inline <ticket-id> <action> --reason "<reason>" [--executor <executor>] [--json]
local-board gate-check <ticket-id> --stage <stage> [--json]
local-board specialty-run <ticket-id> <step-name> [--json]
local-board calibration suggest <ticket-id> [--json]
local-board estimate <ticket-id> <points> [--basis <ticket-id-or-bootstrap>] [--force] [--json]
local-board move <ticket-id> <status> [--json]
local-board set <ticket-id> <field> <value>
local-board section <ticket-id> "<text>" --section "<section>"
local-board section <ticket-id> --file <path> --section "<section>"
local-board comment <ticket-id> "<text>" [--section "<section>"]
local-board link-parent <child-id> <parent-id>
local-board link-child <parent-id> <child-id>
local-board block <ticket-id> <dependency-id>
local-board unblock <ticket-id> <dependency-id>
```

Use `comment` for run-log style notes. Use `move` for status transitions. Use relationship commands for parent/child and dependency state.
Use `section --file <path>` for generated or multi-line Markdown. Inline `section <text>` is only for short edits. Create the `--file` target with the Write tool; never build it with `echo`, heredoc, `Set-Content`, or `Out-File`.
Use `blockedBy` for ticket dependencies without moving the dependent ticket to `blocked`.
