# Plugin Packaging (Claude Code)

Claude Code plugins bundle skills, agents, hooks, MCP servers, and default
settings into one installable unit sourced from a marketplace, git repo, zip
(`--plugin-url`), or local path (`--plugin-dir`). This document evaluates
packaging local-board's Claude-side assets (`skills/`, `agents/claude/`, and
the enforcement hooks) as a plugin.

## Decision

Document the plugin path as deliberate future work; keep `local-board install`
canonical for the Claude side now. Do not adopt a plugin at v0.1.0, and do not
open a spike branch yet. This is a *defer-with-a-concrete-plan* outcome, not a
flat rejection: the layout, migration hazards, and revisit triggers below are
recorded so a future adopt is a small, informed step rather than a fresh
investigation.

## Rationale

- **npm is not a plugin source.** Claude Code installs plugins from
  marketplace, git repo, zip, or local path — never npm. The CLI already
  ships via npm (`npm install -g local-board`), and installed skills/agents
  invoke the on-`PATH` `local-board` command. Adopting a plugin would add a
  *second, differently-sourced distribution channel* to maintain alongside
  the npm package, not replace it — net complexity at a stage where the
  installer was just consolidated.

- **Precedence footgun is real and load-bearing.** Plugin-delivered
  skills/agents rank **below** user-dir (`~/.claude/skills`,
  `~/.claude/agents`) and project-dir copies. Every current user has
  installer-written copies in exactly those user dirs. Shipping a plugin
  without first removing those copies means the stale user-dir skill
  *shadows* the plugin skill — the plugin silently does nothing, or worse
  serves an older skill after a plugin update. A correct adopt requires the
  installer to gain a "plugin mode" that deletes its own user-dir
  skills/agents and stops writing them, which is more work than the plugin
  bundling itself. That migration is only worth building once the plugin
  channel is committed to.

- **Hooks: atomic delivery is attractive, but the parallel-shape cost is low
  right now.** A plugin's `hooks/hooks.json` would ship the four enforcement
  hooks atomically with the skills they guard and remove the need to patch
  `~/.claude/settings.json` (`patchHooks`). That is the strongest single
  argument for a plugin. But the hooks just landed, are opt-in, and the hook
  API plus subagent tool naming (`Task`/`Agent`) are explicitly treated as a
  moving integration surface (see [EnforcementHooks.md](EnforcementHooks.md)).
  Freezing that shape into a second `hooks.json` artifact now, while it is
  still churning, doubles the maintenance of an unstable contract.
  `patchHooks` is already idempotent, script-path-matched, and reversible
  (`--no-hooks`/`--uninstall`); it is not a pain point that justifies the
  plugin today.

- **Plugin subagents ignore frontmatter `hooks`/`mcpServers`/`permissionMode`.**
  local-board's agents in `agents/claude/` rely only on `model`/`tools`
  frontmatter (respected by plugins), so agents *could* move cleanly. The
  enforcement design deliberately uses **settings-level** hooks rather than
  per-agent frontmatter hooks, so this restriction is neutral for us — it
  neither blocks nor motivates a move.

- **The CLI stays npm-only, not plugin `bin/`.** A plugin can expose `bin/`
  executables on `PATH`, so in principle a plugin could carry the CLI.
  Rejected: it would duplicate the npm distribution, fork version/update
  semantics, and break the "npm owns the command, skills invoke it on PATH"
  invariant established by the npm packaging work.

- **Marketplace discoverability is a genuine but premature upside.** It
  matters once the project wants distribution reach. At v0.1.0 "Early MVP
  kernel" it does not outweigh a second channel plus a migration.

Net: the plugin's real wins (atomic hook delivery, discoverability) are
either premature or cheaply matched by the existing installer, while its
costs (second channel, precedence migration, parallel unstable hook shape)
land immediately. Defer, but keep the plan cheap to revisit.

## Layout sketch (what a future plugin would contain)

```text
local-board-plugin/
  .claude-plugin/plugin.json      # manifest (name, version, description)
  skills/local-board/             # Claude SKILL.md variant (rendered)
  skills/local-team/              # Claude SKILL_TEAM.md variant
  agents/                         # the 7 local-board-*.md from agents/claude/
  hooks/hooks.json                # 4 enforcement hooks (PreToolUse Task|Agent,
                                   #   PreToolUse Bash x2, PostToolUse Task|Agent)
  hooks/*.js                      # the 4 scripts from hooks/
```

Skills/agents still need the `<<SCRIPT_PATH>>`/`<<VERSION>>` render step, or a
switch to the on-`PATH` `local-board` invocation form — which is already how
shipped skills are rendered, and is the simpler option if/when adopted.
`hooks/hooks.json` must mirror `HOOK_SPECS` in `src/install.js` (event,
matcher, script); this is a duplication risk if a plugin and the installer
both exist. Keep the sketch above descriptive, not a copy of exact JSON that
must be kept in sync — `src/install.js` (`HOOK_SPECS`) and `agents/claude/`
remain the sources of truth.

## Migration notes

Before any plugin ships:

- The installer must delete its own `~/.claude/skills/local-board`,
  `~/.claude/skills/local-team`, and `~/.claude/agents/local-board-*.md`
  copies, and stop writing them for the Claude target — otherwise those
  higher-precedence user-dir copies shadow the plugin's copies.
- `patchHooks` entries in `settings.json` must be removed in favor of
  `hooks/hooks.json`.
- Codex/opencode/cline/cursor/agents targets stay on the installer
  regardless — Claude Code does not honor cross-harness skill dirs, and those
  harnesses have no plugin system.

## Where the plugin would live

Recommend a **sibling repo / separate marketplace entry**, not this repo's
root. The plugin's source-of-truth (marketplace/git/zip) and release cadence
differ from the npm package; co-locating risks `npm pack` picking up plugin
files (the `files` allowlist would need to exclude them). Keep the canonical
skill/agent/hook *content* in this repo; a plugin, if built, is a packaging
view over it.

## Open item for a future adopt

If/when adopted, decide whether the plugin re-renders skill placeholders or
ships the already on-`PATH` `local-board` invocation form. The latter is
simpler and matches current shipped skills.

## Revisit triggers

Adopt when *any* of the following holds:

1. The Claude hook API and subagent tool name (`Task`/`Agent`) stabilize.
2. There is demand for marketplace discoverability.
3. The installer's `settings.json` patching becomes a real maintenance or
   support burden.
4. A supported npm-as-plugin-source path appears.

## Related tickets

- T20260707T1326Z — enforce Claude Code hooks (dispatch ledger, evidence gate,
  routing validator, approve-inline consent). The plugin's main upside is
  atomic delivery of these; this decision waits for that surface to
  stabilize.
- T20260707T1319Z — folded `install.mjs` into `local-board install`. The
  Claude side this document evaluates replacing is that consolidated
  installer.
- T20260707T1320Z — npm publish + on-`PATH` `local-board` invocation.
  Establishes npm as the CLI channel; a plugin would be a *second* channel.
- T20260707T1318Z — `files` allowlist / runtime resources move. Relevant to
  the "where does the plugin live" question.
