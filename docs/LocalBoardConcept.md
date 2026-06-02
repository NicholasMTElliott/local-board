# Local Board Concept

`local-board` is a repo-native alternative to using GitHub Projects, Trello, or another external kanban board as the planning control plane.

Instead of cards in a remote board, tickets are Markdown files in `plans/tickets/`. The files are committed with the project. They can be reviewed, searched, branched, merged, and edited with normal developer tools.

Claude Code acts as the first orchestrator. It reads the tickets, decides what is eligible next, delegates individual workflow steps to agents or prompts, and updates the ticket as work moves forward.

An installable `local-board` skill makes this portable across projects. The skill teaches compatible agents to initialize a board, call deterministic query commands, load project-local prompts, delegate configured steps, and mutate canonical ticket state only through the CLI.

## Why Local Files

Local files remove setup friction. There is no board API, no synchronization layer, and no separate planning store. The plan travels with the code.

This is especially useful for solo development and open-source work where the ticket history should be inspectable in git.

## Tradeoffs

The upside is simplicity and locality.

The downside is that the system must be strict about file state. A remote board naturally owns columns and transitions. In `local-board`, front matter and validation must do that job.

The guiding rule: agents can write content, but deterministic tooling should validate state transitions.
