# local-board

Repo-native planning and agent orchestration experiments.

`local-board` explores a file-backed alternative to external kanban boards. Tickets live in the project repo under `plans/`, and Claude Code can act as the orchestrator that selects, decomposes, designs, implements, reviews, tests, documents, and closes work.

## Why

External kanban tools put your plan in a separate system from your code. local-board keeps tickets in the repo as Markdown, so the plan is versioned, diffable, and reviewable alongside the work — and an AI coding agent can drive the whole pipeline through a small deterministic CLI instead of a web API.

## Requirements

- [Node.js](https://nodejs.org/) 20 or later.
- No runtime dependencies, no install step, no network access. The CLI is pure Node ESM.
- Parallel mode runs on any harness whose orchestrator can dispatch subagents and pin a model per dispatch (e.g. [Claude Code](https://claude.com/claude-code)). It does not require agent teams or `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`.

## Quick start

```sh
git clone https://github.com/NicholasMTElliott/local-board.git
cd local-board

# Try the CLI against this repo's own board:
node ./bin/local-board.js validate
node ./bin/local-board.js list --ready

# Scaffold a board in another project:
node ./bin/local-board.js --root /path/to/your/repo init
```

To use local-board as an agent orchestrator, install it globally so the `local-board` command is on `PATH`, then run the installer to place skills and agents:

```sh
npm install -g local-board            # or: npm install -g . / npm link, from a checkout
local-board install                   # install skills + agents
local-board install --hooks           # opt in to Claude Code dispatch-enforcement hooks
local-board install --list-targets    # see where they would go
local-board install --target=codex    # install only Codex skills
```

Installed skill and agent text always invokes the `local-board` command on `PATH` — never an absolute script path — so it is byte-identical regardless of how or where it was installed. The installer verifies `local-board` resolves on `PATH` before installing and fails fast with targeted guidance (`npm install -g .` / `npm link` for a checkout, `npm install -g local-board` otherwise) if it does not.

See [docs/Install.md](docs/Install.md) for every path the installer writes per target and the `~/.claude/settings.json` consent side effect.

**`npx local-board` is not supported.** A first run of `npx` needs network access to fetch the package, which sandboxed environments (including the Codex sandbox) deny. Install the package globally first, as above.

`node ./bin/local-board.js install` and `node install.mjs` remain available as deprecated aliases for running the installer from a checkout, but they still require a prior `npm install -g .` or `npm link` from that checkout — the installer's PATH check fails fast otherwise, and rendered skills need the `local-board` command on `PATH` to be invoked correctly.

## Status

Early MVP kernel. The repo has a dependency-free Node.js ESM CLI for parsing, validating, listing, creating, and selecting Markdown tickets, plus installable orchestration and team-mode skills.

## CLI

Run commands from the repository root:

```sh
node ./bin/local-board.js version
node ./bin/local-board.js where --json
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
node ./bin/local-board.js gate-complete T20260514T1234Z --stage implement --executor claude-subagent:local-board-gatecheck [--model <model>] --evidence "Consulted implement catalog."
node ./bin/local-board.js specialty-run T20260514T1234Z security_audit --json
node ./bin/local-board.js start-work T20260514T1234Z --json
node ./bin/local-board.js worktree-add T20260514T1234Z --json
node ./bin/local-board.js worktree-list --json
node ./bin/local-board.js worktree-remove T20260514T1234Z --json
node ./bin/local-board.js fast-forward --json
node ./bin/local-board.js begin-step T20260514T1234Z [--harness <claude|codex>] --json
node ./bin/local-board.js complete-step T20260514T1234Z review --executor codex-task:read-only [--model <model>] --evidence "Review notes added."
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

`SKILL_TEAM.md` installs as the `local-team` skill and adds an opt-in parallel-work entry point. It is a single top-level orchestrator (not an agent team): it keeps up to `maxInFlight` tickets in flight (from `team-config`, default 6, set by `LOCAL_BOARD_MAX_TEAMMATES`; a low cap ≈3 is the recommended working value) and dispatches each pipeline step to an ephemeral, model-specialized executor (subagent or codex), with the ticket file and a per-ticket git worktree as the durable baton. Per-step models work because the orchestrator is top-level. See [docs/PerStepOrchestration.md](docs/PerStepOrchestration.md); [docs/TeamMode.md](docs/TeamMode.md) is the superseded agent-teams design.

Workflow routing lives in `plans/local-board.config.jsonc`. Comments and trailing commas are allowed. Strict routing is enforced by `begin-step`, `complete-step`, `approve-inline`, `move ... done`, and `validate`.

Ticket dependencies use `blockedBy`/`blocks` while the dependent ticket stays in its intended ready status. `status: blocked` is reserved for non-ticket blockers.

When `git.autoMerge` is `true`, `move ... done` commits planning-only closeout changes and merges the recorded ticket branch into the configured or detected default branch after strict routing validation passes.

When `retention.archiveOnMoveDone` is `true`, `move ... done` also archives older done tickets after the configured retention window. Archived tickets remain closed for dependency checks.

Claude subagent definitions live in `agents/claude/` and are installed to the user's Claude agents directory by `local-board install`. Codex executor prompt fragments live in `agents/codex/`; `begin-step --harness codex` returns the Codex dispatch block while preserving the configured route in strict-routing evidence. See [docs/CodexSupport.md](docs/CodexSupport.md).

```sh
local-board install
local-board install --list-targets
```

## Tests

```sh
npm run check
npm test
npm run validate
```

The test suite includes function-level ticket kernel coverage and CLI command-surface coverage for init, create, list, validate, next/query, schema, state report, transition guidance, strict routing evidence, branch start-work, worktree helpers, fast-forward, auto-merge closeout, done-ticket retention, field/section edits, comments, moves, parent-child links, and dependency links.

## Documentation Index

- [docs/LocalBoardConcept.md](docs/LocalBoardConcept.md) — human-readable overview of the repo-native board model, workflow, and tradeoffs.
- [docs/TicketFormat.md](docs/TicketFormat.md) — ticket naming, front matter, sections, and state rules.
- [docs/Workflow.md](docs/Workflow.md) — lifecycle from epic/story decomposition through implementation, review, test, docs, and closeout.
- [docs/EnforcementHooks.md](docs/EnforcementHooks.md) — Claude Code hook enforcement for dispatch routing, evidence gating, and inline-fallback consent.
- [docs/CodexSupport.md](docs/CodexSupport.md) — installing and using local-board directly in Codex, including route translation and parallel team mode.
- [docs/Install.md](docs/Install.md) — installer targets, paths written per harness, the settings.json permission side effect, opt-in hooks, and uninstall cleanup.
- [docs/specialty-steps.md](docs/specialty-steps.md) — optional security, UI, and UX specialty review steps and how the gate-check classifier dispatches them.
- [docs/PerStepOrchestration.md](docs/PerStepOrchestration.md) — current-state parallel orchestration: a single top-level orchestrator dispatches each pipeline step to a model-specialized executor, enabling full per-step model/prompt/route variety. Operational contract in `SKILL_TEAM.md`.
- [docs/TeamMode.md](docs/TeamMode.md) — superseded historical context for the original agent-teams "one teammate per ticket" parallel mode.
- [docs/PluginPackaging.md](docs/PluginPackaging.md) — evaluation of Claude Code plugin packaging for skills/agents/hooks; decision is to defer, with a layout sketch, migration notes, and revisit triggers.

## Repository Layout

```text
memory-bank/         Token-optimized project context for AI agents
agents/              Installable agent definitions
skills/              Harness-specific skill templates
docs/                Human-facing documentation
plans/               File-backed board: tickets, prompts, templates
resources/           Packaged prompt/template mirror synced from plans/
plans/tickets/       Ticket files grouped by human-friendly status folders
plans/prompts/       Role and step prompts for delegated agents, including estimator and estimate prompts
plans/prompts/optional-steps/
                     Specialty review prompts for optional workflow steps
plans/templates/     Reusable ticket templates
plans/local-board.config.jsonc
src/                 Node.js ESM ticket parser, validator, writer, picker, installer, and CLI
bin/                 CLI executable entrypoint
test/                Unit tests for the ticket kernel
install.mjs          Deprecated installer shim for local-board install
SKILL.md             Installable orchestration skill template
SKILL_TEAM.md        Installable parallel-mode skill template (top-level per-step orchestrator)
```

## Contributing & Security

- [CONTRIBUTING.md](CONTRIBUTING.md) — setup, tests, branch and PR conventions.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — Contributor Covenant; expected conduct in community spaces.
- [SECURITY.md](SECURITY.md) — security model and how to report a vulnerability privately.

Issues and pull requests are welcome. Run `npm run check`, `npm test`, and `npm run validate` before opening a PR.

## Releasing

Run `npm run check && npm test` (also enforced by the `prepublishOnly` script, so a broken tree cannot be published), inspect the publishable contents with `npm pack --dry-run`, then a maintainer with npm credentials runs `npm publish` (requires OTP) and tags the release. Version stays at the last published value unless the package name/version is already taken at publish time.

## License

MIT. See [LICENSE](LICENSE).
