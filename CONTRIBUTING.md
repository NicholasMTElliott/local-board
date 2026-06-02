# Contributing

Thanks for your interest in local-board. It is a small, dependency-free project, so the contribution loop is short.

By participating, you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Local Setup

Requirements: [Node.js](https://nodejs.org/) 20 or later. There are no runtime dependencies and no install step — clone the repo and run the CLI directly.

```sh
git clone https://github.com/NicholasMTElliott/local-board.git
cd local-board
node ./bin/local-board.js validate
```

See `README.md` for the full command surface and `docs/` for the concepts.

## Tests

The full check before every PR:

```sh
npm run check     # node --check on every source file
npm test          # node --test unit + CLI surface suite
npm run validate  # validate this repo's own plans/ board
```

All three must pass. The test suite is plain `node --test`; no framework, no network.

## Branches and Pull Requests

- Use short, descriptive branch names. Prefix when useful: `fix/...`, `feat/...`, or `docs/...`.
- Keep PRs small and focused.
- Link an issue when one exists.
- Include tests for new behavior — most changes touch `src/` and belong with a case in `test/`.
- Update docs when behavior, CLI surface, or the skill contracts change. When you add a `docs/*.md` file, add it to the README Documentation Index.

## Code Style

There is no enforced standalone style guide. Match the surrounding code: ESM modules, no dependencies, small reversible changes. Keep deterministic behavior in `src/` and keep agent/orchestration guidance in the skill and prompt files.

Agent-facing project context lives in `memory-bank/*.md`. Those files are terse, current-state-only project documentation with strict rules. See `AGENTS.md` before editing them.

## Commit Messages

Use imperative mood. Add a scope prefix when it clarifies the change:

- `Add list --ready and --limit filters`
- `Refuse move ... done when ticket branch is behind default`
- `docs: clarify team-mode scaling`

## License

This project does not require a CLA. By submitting a PR, you agree that your contribution will be licensed under the MIT License.
