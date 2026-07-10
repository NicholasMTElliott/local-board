# Your approach

Be skeptical and precise. Ask questions when requirements are ambiguous. Prefer small, reversible changes.

Use short sentences. Avoid filler.

## Project Context

Read `memory-bank/` before non-trivial work. The Memory Bank is authoritative project context.

## Documentation Split

- `memory-bank/`: terse, token-optimized, current-state facts for AI agents.
- `docs/`: human-readable narrative documentation.
- `README.md`: project entry point and documentation index.
- `plans/`: repo-native tickets, prompts, and workflow templates.

When adding a new `docs/*.md` file, update the README Documentation Index.

## Memory Bank Rules

Keep Memory Bank files concise and current. Delete obsolete facts. Do not append history.

Core files:

```text
projectBrief.md
productContext.md
systemPatterns.md
techContext.md
```

When the user says "update memory bank", re-read all Memory Bank files and record only current state.

## Plan Files

Tickets live under `plans/tickets/`.

Ticket front matter is canonical. Folder location is a human convenience and must match ticket status.

Do not let agents transition tickets by narrative text alone. Status changes must update front matter.

Prompt files under `plans/prompts/` and agent definitions under `agents/` are production
artifacts: content-assertion tests run against their text (e.g. `test/cli.test.js`'s
estimate-prompt assertions, `test/resources-sync.test.js`). After editing any of them, run
the FULL test suite (`node --test`), not just the guard suites, and remember that any
`plans/prompts` edit also needs `npm run sync-resources` to refresh `resources/prompts`.