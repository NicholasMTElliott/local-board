# Workflow

The local board mimics a kanban pipeline using ticket status and folders.

## Priority Selection

The orchestrator reads all tickets and picks the highest-priority eligible ticket.

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

Priority order is `P0`, `P1`, `P2`, `P3`, then `P4`. Ties use oldest `created`, then ticket ID.

## Decomposition

Epics decompose into stories.

Stories decompose into tasks.

Generated child tickets should link back to the parent and should be committed as planning changes.

## Task and Bug Flow

1. Cross-reference related tickets.
2. Write technical design.
3. Ask questions if blocked by ambiguity.
4. Create a branch.
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
node ./bin/local-board.js create story "Ticket parser" --status backlog --priority P2
node ./bin/local-board.js move T20260514T1234Z ready_for_design
node ./bin/local-board.js set T20260514T1234Z branch feature/T20260514T1234Z-ticket-parser
node ./bin/local-board.js comment T20260514T1234Z "Design pass complete." --section "Run Log"
```

Use `move` for status transitions. Do not use `set status`; it delegates to the same move behavior so folder placement stays consistent.
