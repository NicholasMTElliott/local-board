# local-board

Repo-native planning and agent orchestration experiments.

`local-board` explores a file-backed alternative to external kanban boards. Tickets live in the project repo under `plans/`, and Claude Code can act as the orchestrator that selects, decomposes, designs, implements, reviews, tests, documents, and closes work.

## Status

Early MVP kernel. The repo now has a dependency-free Node.js ESM CLI for parsing, validating, listing, creating, and selecting Markdown tickets.

## CLI

Run commands from the repository root:

```sh
node ./bin/local-board.js validate
node ./bin/local-board.js list
node ./bin/local-board.js next
node ./bin/local-board.js query-next --json
node ./bin/local-board.js query-ticket T20260514T1234Z --json
node ./bin/local-board.js state-report --json
node ./bin/local-board.js schema --json
node ./bin/local-board.js create task "Implement ticket validator" --status ready_for_design --priority P1
node ./bin/local-board.js start-work T20260514T1234Z --json
node ./bin/local-board.js move T20260514T1234Z implementing
node ./bin/local-board.js set T20260514T1234Z priority P1
node ./bin/local-board.js section T20260514T1234Z "A clear requirement." --section Requirement
node ./bin/local-board.js comment T20260514T1234Z "Started implementation."
node ./bin/local-board.js link-parent S20260514T1235Z E20260514T1234Z
node ./bin/local-board.js block T20260514T1236Z T20260514T1235Z
```

The same commands are available through `local-board` when the package bin is on `PATH`.

## Installable Skill

`SKILL.md` turns a compatible coding agent into a local-board orchestrator. It tells the agent to call `query-next` or `query-ticket` for deterministic workflow dispatch, then use CLI mutation commands for canonical state changes.

Workflow routing lives in `plans/local-board.config.jsonc`. Comments and trailing commas are allowed.

```sh
node install.mjs
node install.mjs --list-targets
```

## Tests

```sh
npm run check
npm test
npm run validate
```

The test suite includes function-level ticket kernel coverage and CLI command-surface coverage for init, create, list, validate, next/query, schema, state report, branch start-work, field/section edits, comments, moves, parent-child links, and dependency links.

## Documentation Index

- [docs/LocalBoardConcept.md](docs/LocalBoardConcept.md) — human-readable overview of the repo-native board model, workflow, and tradeoffs.
- [docs/TicketFormat.md](docs/TicketFormat.md) — ticket naming, front matter, sections, and state rules.
- [docs/Workflow.md](docs/Workflow.md) — lifecycle from epic/story decomposition through implementation, review, test, docs, and closeout.

## Repository Layout

```text
memory-bank/         Token-optimized project context for AI agents
docs/                Human-facing documentation
plans/               File-backed board: tickets, prompts, templates
plans/tickets/       Ticket files grouped by human-friendly status folders
plans/prompts/       Role and step prompts for delegated agents
plans/templates/     Reusable ticket templates
plans/local-board.config.jsonc
src/                 Node.js ESM ticket parser, validator, writer, picker, and CLI
bin/                 CLI executable entrypoint
test/                Unit tests for the ticket kernel
install.mjs          Cross-harness skill installer
SKILL.md             Installable orchestration skill template
```

## License

MIT. See [LICENSE](LICENSE).
