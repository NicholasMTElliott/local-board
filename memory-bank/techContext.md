# Tech Context

## Current Stack
| Area | Choice |
|---|---|
| Ticket storage | Markdown + YAML front matter |
| Orchestrator | Claude Code initially |
| Delegated agents | Claude Code subagents, Codex, or prompt-directed external CLIs |
| Automation | Dependency-free Node.js ESM CLI package |
| VCS | Git |
| License | MIT |

## Repository Layout
```text
memory-bank/          AI context
agents/claude/        installable Claude subagent definitions
docs/                 human docs
plans/tickets/        local ticket board
plans/prompts/roles/  durable role instructions
plans/prompts/steps/  durable step instructions
plans/templates/      ticket templates
plans/local-board.config.jsonc workflow and routing config
src/                  parser, validator, writer, git workflow, priority picker, CLI
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

## Open Decisions
- Whether advisory transition guidance should become a hard transition validator.
- Agent routing refinements after real orchestration runs.
- Per-step orchestration redesign (`docs/PerStepOrchestration.md`): extend the
  `agents` map to `{ route, model, prompt }` profiles and replace teammates with a
  single top-level orchestrator. Pending a context-budget spike to size `maxInFlight`.

## Verification
- `npm run check`
- `npm test`
- `npm run validate`
