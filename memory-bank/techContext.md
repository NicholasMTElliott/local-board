# Tech Context

## Current Stack
| Area | Choice |
|---|---|
| Ticket storage | Markdown + YAML front matter |
| Orchestrator | Claude Code or Codex |
| Delegated agents | Claude Code subagents, Codex, or prompt-directed external CLIs |
| Automation | Dependency-free Node.js ESM CLI package |
| VCS | Git |
| License | MIT |

## Repository Layout
```text
memory-bank/          AI context
agents/claude/        installable Claude subagent definitions
agents/codex/         Codex executor prompt fragments
docs/                 human docs
plans/tickets/        local ticket board
plans/prompts/roles/  durable role instructions
plans/prompts/steps/  durable step instructions
plans/templates/      ticket templates
plans/local-board.config.jsonc workflow and routing config
resources/            packaged prompt/template mirror synced from plans/ via npm run sync-resources
src/                  parser, validator, writer, git workflow, priority picker, CLI
skills/codex/         Codex skill templates and metadata
scripts/              maintainer tooling, not packaged
bin/                  executable CLI entrypoint
test/                 node:test unit tests
install.mjs           cross-harness installer
SKILL.md              installable orchestration skill template
```

## Constraints
- Keep v0 file-first and simple.
- Prefer schemas and small scripts over hidden convention.
- Avoid external services for core workflow.
- Preserve portability across Windows/macOS/Linux.
- `package.json` `files` allowlist defines the npm package surface.

## Open Decisions
- Whether advisory transition guidance should become a hard transition validator.
- Agent routing refinements after real orchestration runs.
- Per-step orchestrator (`docs/PerStepOrchestration.md`) is implemented and
  validated by an end-to-end real run (2 tickets × design/implement/test with
  per-step models, loop-back, and rebase backstop). `maxInFlight` reuses
  `team-config` (`LOCAL_BOARD_MAX_TEAMMATES`, default 6); the run confirms a
  preferred default of ≈3. Limiter is cumulative session tokens + scheduling
  clarity, not raw concurrency.

## Verification
- `npm run check`
- `npm test`
- `npm run validate`
