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
node ./bin/local-board.js estimate T20260514T1234Z 4 --basis bootstrap --json
node ./bin/local-board.js calibration suggest T20260514T1234Z --json
node ./bin/local-board.js gate-check T20260514T1234Z --stage implement --json
node ./bin/local-board.js specialty-run T20260514T1234Z security_audit --json
node ./bin/local-board.js start-work T20260514T1234Z --json
node ./bin/local-board.js begin-step T20260514T1234Z --json
node ./bin/local-board.js complete-step T20260514T1234Z review --executor codex-task:read-only --evidence "Review notes added."
node ./bin/local-board.js approve-inline T20260514T1234Z review --reason "User approved fallback."
node ./bin/local-board.js move T20260514T1234Z implementing
node ./bin/local-board.js move T20260514T1234Z done --json
node ./bin/local-board.js set T20260514T1234Z priority P1
node ./bin/local-board.js section T20260514T1234Z "A clear requirement." --section Requirement
node ./bin/local-board.js section T20260514T1234Z --file /tmp/design.md --section "Technical Design"
node ./bin/local-board.js comment T20260514T1234Z "Started implementation."
node ./bin/local-board.js link-parent S20260514T1235Z E20260514T1234Z
node ./bin/local-board.js block T20260514T1236Z T20260514T1235Z
```

The same commands are available through `local-board` when the package bin is on `PATH`.

For multi-line Markdown, `section --file <path>` is preferred. It avoids shell quoting failures from apostrophes, backticks, dollar signs, and long generated text. Create that file with the Write tool, not shell redirection.

## Installable Skills

`SKILL.md` turns a compatible coding agent into a local-board orchestrator. It tells the agent to call `query-next` or `query-ticket` for deterministic workflow dispatch and transition guidance, then use CLI mutation commands for canonical state changes.

`SKILL_TEAM.md` adds an opt-in team-mode entry point for Claude Code. The lead session uses `list --ready --limit 6 --json` to fan out a batch of ready tickets to teammate sessions in a Claude Code agent team. Each teammate is the orchestrator for one ticket and uses the bundled `local-board-teammate` subagent. Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` and Claude Code v2.1.32+. See [docs/TeamMode.md](docs/TeamMode.md).

Workflow routing lives in `plans/local-board.config.jsonc`. Comments and trailing commas are allowed. Strict routing is enforced by `begin-step`, `complete-step`, `approve-inline`, `move ... done`, and `validate`.

Ticket dependencies use `blockedBy`/`blocks` while the dependent ticket stays in its intended ready status. `status: blocked` is reserved for non-ticket blockers.

When `git.autoMerge` is `true`, `move ... done` commits planning-only closeout changes and merges the recorded ticket branch into the configured or detected default branch after strict routing validation passes.

When `retention.archiveOnMoveDone` is `true`, `move ... done` also archives older done tickets after the configured retention window. Archived tickets remain closed for dependency checks.

Claude subagent definitions live in `agents/claude/` and are installed to the user's Claude agents directory by `node install.mjs`.

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

The test suite includes function-level ticket kernel coverage and CLI command-surface coverage for init, create, list, validate, next/query, schema, state report, transition guidance, strict routing evidence, branch start-work, auto-merge closeout, done-ticket retention, field/section edits, comments, moves, parent-child links, and dependency links.

## Documentation Index

- [docs/LocalBoardConcept.md](docs/LocalBoardConcept.md) — human-readable overview of the repo-native board model, workflow, and tradeoffs.
- [docs/TicketFormat.md](docs/TicketFormat.md) — ticket naming, front matter, sections, and state rules.
- [docs/Workflow.md](docs/Workflow.md) — lifecycle from epic/story decomposition through implementation, review, test, docs, and closeout.
- [docs/specialty-steps.md](docs/specialty-steps.md) — optional security, UI, and UX specialty review steps and how the gate-check classifier dispatches them.
- [docs/TeamMode.md](docs/TeamMode.md) — opt-in agent-team mode that runs up to six ready tickets in parallel, one teammate per ticket.

## Repository Layout

```text
memory-bank/         Token-optimized project context for AI agents
agents/              Installable agent definitions
docs/                Human-facing documentation
plans/               File-backed board: tickets, prompts, templates
plans/tickets/       Ticket files grouped by human-friendly status folders
plans/prompts/       Role and step prompts for delegated agents, including estimator and estimate prompts
plans/prompts/optional-steps/
                     Specialty review prompts for optional workflow steps
plans/templates/     Reusable ticket templates
plans/local-board.config.jsonc
src/                 Node.js ESM ticket parser, validator, writer, picker, and CLI
bin/                 CLI executable entrypoint
test/                Unit tests for the ticket kernel
install.mjs          Cross-harness skill installer
SKILL.md             Installable orchestration skill template
SKILL_TEAM.md        Installable team-mode skill template (Claude Code agent teams)
```

## License

MIT. See [LICENSE](LICENSE).
