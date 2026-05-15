# Workflow

The local board mimics a kanban pipeline using ticket status and folders.

## Priority Selection

The orchestrator asks the CLI for deterministic dispatch:

```sh
node ./bin/local-board.js query-next --json
```

For a specific ticket:

```sh
node ./bin/local-board.js query-ticket T20260514T1234Z --json
```

The result includes the ticket path, action, prompt, configured agent, and eligibility.

For a board-level state summary:

```sh
node ./bin/local-board.js state-report --json
```

For the machine-readable workflow contract:

```sh
node ./bin/local-board.js schema --json
```

A ticket is eligible when:

- its status is a trigger status;
- all `blockedBy` tickets are done;
- it is not waiting on user questions;
- it is not already active.

Current trigger statuses are:

- `ready_for_decomposition`
- `ready_for_design`
- `ready_for_implementation`
- `ready_for_review`
- `ready_for_test`
- `ready_for_docs`

`backlog` is not selected by `next`; move a ticket to a ready status when it should enter the automation queue.

Priority order is `P0`, `P1`, `P2`, `P3`, then `P4`. Ties use configured pipeline order, then oldest `created`, then ticket ID.

Pipeline order and action dispatch live in `plans/local-board.config.jsonc`. Comments and trailing commas are allowed.

## Decomposition

Epics decompose into stories.

Stories decompose into tasks.

Generated child tickets should link back to the parent and should be committed as planning changes.

## Task and Bug Flow

1. Cross-reference related tickets.
2. Write technical design.
3. Ask questions if blocked by ambiguity.
4. Create or switch to the ticket branch with `start-work`.
5. Implement the task.
6. Run code review.
7. Run specialty review when needed.
8. Test the result.
9. Update documentation.
10. Commit changes.
11. Merge and push according to policy.
12. Mark ticket done.

## Human Questions

When work needs user input, set `status: questions` and write the questions in the `## Questions` section.

The user answers in the ticket or chat, then moves the ticket back to an eligible status.

## MVP Commands

```sh
node ./bin/local-board.js validate
node ./bin/local-board.js list
node ./bin/local-board.js next
node ./bin/local-board.js schema --json
node ./bin/local-board.js create story "Ticket parser" --status backlog --priority P2
node ./bin/local-board.js start-work T20260514T1234Z --json
node ./bin/local-board.js start-work T20260514T1234Z --branch preseeded/ticket-parser --json
node ./bin/local-board.js move T20260514T1234Z ready_for_design
node ./bin/local-board.js set T20260514T1234Z branch feature/T20260514T1234Z-ticket-parser
node ./bin/local-board.js section T20260514T1234Z "Use the existing parser." --section "Technical Design"
node ./bin/local-board.js comment T20260514T1234Z "Design pass complete." --section "Run Log"
node ./bin/local-board.js link-child E20260514T1234Z S20260514T1235Z
node ./bin/local-board.js block T20260514T1237Z T20260514T1236Z
```

Use `move` for status transitions. Do not use `set status`; it delegates to the same move behavior so folder placement stays consistent.

## Branch Handling

Use `start-work` before implementation and before review/test/docs work that must inspect or edit ticket changes.

`start-work`:

- uses the ticket's recorded `branch` when present;
- accepts `--branch <branch>` for pre-seeded work;
- creates the branch when it does not exist;
- switches to an existing local branch when it does exist;
- records the branch in front matter;
- appends a `## Run Log` entry;
- moves `ready_for_implementation` tickets to `implementing`;
- refuses to switch to an existing branch with a dirty worktree unless `--allow-dirty` is supplied.

## Agent Routing

`plans/local-board.config.jsonc` maps actions to agents. Supported values are conventions interpreted by the orchestration skill:

- `inline`
- `claude-subagent`
- `codex-task:read-only`
- `codex-task:workspace-write`

If a configured agent is unavailable, the orchestrator should explain the fallback and continue inline unless doing so would be risky.
