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
resources/            packaged prompt/template mirror synced from plans/ via npm run sync-resources (sync writes LF; mirror comparison is line-ending-insensitive)
src/                  parser, validator, writer, git workflow, priority picker, CLI
src/install.js       installer behind local-board install (human-facing reference: docs/Install.md)
skills/codex/         Codex skill templates and metadata
scripts/              maintainer tooling, not packaged
bin/                  executable CLI entrypoint
test/                 node:test unit tests
install.mjs           deprecated shim for local-board install
SKILL.md              installable orchestration skill template
```

## Constraints
- Keep v0 file-first and simple.
- Prefer schemas and small scripts over hidden convention.
- Avoid external services for core workflow.
- Preserve portability across Windows/macOS/Linux.
- Installer requires `local-board` to resolve on PATH before rendering skills/agents.
- Installer sandbox seam: `--home <dir>` redirects install/uninstall roots; explicit
  undefined home fails closed, and `LOCAL_BOARD_INSTALL_REQUIRE_HOME=1` requires
  an override.
- `local-board install` has six targets: `claude` default-on,
  `codex`/`opencode`/`cline`/`cursor` detect-only, and `agents` explicit-only.
- Claude target adds consent-sensitive `Bash(local-board *)` to
  `~/.claude/settings.json`; hooks are opt-in with `--hooks`; uninstall removes
  that exact allow rule, leaving user-modified rules in place.
- `worktrees.location` controls ticket worktree placement: sibling default, inside `.worktrees`, or explicit non-`plans/` path.
- `package.json` `files` allowlist defines the npm package surface.
- Agent profiles support `{ route, model?, effort?, prompt? }`; `effort` is shape-validated like `model`, rejected on inline routes, surfaced by `begin-step`, and passed through `codexDispatch` without sanitization. It is excluded from evidence tokens and the active-steps ledger.

## Open Decisions
- Agent routing refinements after real orchestration runs.
- Whether to flip `routing.enforceTransitions` on in this repo's own
  `plans/local-board.config.jsonc` (the hard validator exists and is scaffold-on
  for new repos; this board's config has not opted in).
- Per-step orchestrator (`docs/PerStepOrchestration.md`) is implemented and
  validated by an end-to-end real run (2 tickets × design/implement/test with
  per-step models, loop-back, and rebase backstop). `maxInFlight` reuses
  `team-config` (`LOCAL_BOARD_MAX_TEAMMATES`, default 6); the run confirms a
  recommended working cap of ≈3. Limiter is cumulative session tokens + scheduling
  clarity, not raw concurrency.

## Verification
- `npm run check`
- `npm test`
- `npm run validate`
- Git temp fixtures set `gc.auto=0` and `gc.autoDetach=false`; recursive fixture teardown must use `test/helpers/fixtures.js` `removeFixtureDir` for retried `fs.rm`.
