# Install

`local-board install` copies a runtime, renders portable skills, and (for
Claude Code) installs seven subagents. On the Claude target it also patches
`~/.claude/settings.json` — a consent-sensitive change, covered below.

Paths below use `~/` for the home directory (`os.homedir()`). On Windows this
resolves to `%USERPROFILE%`, e.g. `~/.claude` is
`C:\Users\<you>\.claude`.

## Prerequisites

- Node.js 20 or later.
- `local-board` must already resolve on `PATH`. The installer checks this
  first and fails fast: from a checkout it suggests `npm install -g .` or
  `npm link`; otherwise it suggests `npm install -g local-board`.
- `npx local-board` is not supported. A first `npx` run needs network access
  to fetch the package, which sandboxed environments (including the Codex
  sandbox) deny.

## Install methods

```sh
npm install -g local-board             # published package
local-board install                    # default targets

# from a checkout of this repo instead:
npm install -g .                       # or: npm link
local-board install
```

Deprecated aliases for running the installer from a checkout (both require the
same prior global install/link so `local-board` resolves on `PATH`):

```sh
node ./bin/local-board.js install
node install.mjs                       # install.mjs is a 10-line shim, install-only
```

Flags:

```sh
local-board install --list-targets     # show detected targets, no writes
local-board install --all              # install every target
local-board install --target=codex     # install only the named target(s)
local-board install --no-opencode      # install defaults except one target
local-board install --hooks            # opt in to Claude Code hooks (below)
local-board install --no-hooks         # remove the hooks entries
local-board install --uninstall        # remove everything installable
```

## Targets and what is written

Six targets. Selection with no flags: every default-on target, plus any
detect-only target whose detect path already exists. `--all` selects all six.
`agents` only installs when named explicitly (`--target=agents`).

| id | Label | settings.json? | Selection policy | Detect path |
|---|---|---|---|---|
| `claude` | Claude Code | yes | default-on | `~/.claude` |
| `codex` | Codex | no | detect-only | `~/.codex` |
| `opencode` | opencode | no | detect-only | `~/.config/opencode` |
| `cline` | Cline | no | detect-only | `~/.cline` |
| `cursor` | Cursor | no | detect-only | `~/.cursor` |
| `agents` | Agents (cross-harness) | no | explicit-only | `~/.agents` |

Codex renders its skills from its own templates under `skills/codex/`. Every
other target renders from the repo-root `SKILL.md` / `SKILL_TEAM.md`, with
`<<SCRIPT_PATH>>` and `<<VERSION>>` substituted.

## Paths written per target

### Runtime (every install, regardless of target)

`~/.local-board/` is always written:

| Path | Source |
|---|---|
| `~/.local-board/package.json` | copied |
| `~/.local-board/README.md` | copied |
| `~/.local-board/SKILL.md` | copied |
| `~/.local-board/SKILL_TEAM.md` | copied, if present |
| `~/.local-board/bin/` | copied |
| `~/.local-board/src/` | copied |
| `~/.local-board/agents/` | copied |
| `~/.local-board/skills/` | copied |
| `~/.local-board/hooks/` | copied |
| `~/.local-board/prompts/` | copied from `resources/prompts` |
| `~/.local-board/templates/` | copied from `resources/templates` |
| `~/.local-board/install-info.json` | generated (see below) |

`install-info.json` records `name`, `installedAt`, `installDir`, `scriptPath`,
`nodeVersion`, `version`, `skillName`, `teamSkillName`, `claudeAgents[]`.

This copy exists for hooks and provenance, not for day-to-day skill use.
Codex executor prompts resolve from `local-board where --json`'s `agentsDir`
field, not from `~/.local-board/`.

### Per-target skill directories (selected targets only)

| Target | Skill dir | Team skill dir |
|---|---|---|
| `claude` | `~/.claude/skills/local-board` | `~/.claude/skills/local-team` |
| `codex` | `~/.codex/skills/local-board` | `~/.codex/skills/local-team` |
| `opencode` | `~/.config/opencode/skills/local-board` | `~/.config/opencode/skills/local-team` |
| `cline` | `~/.cline/skills/local-board` | `~/.cline/skills/local-team` |
| `cursor` | `~/.cursor/skills/local-board` | `~/.cursor/skills/local-team` |
| `agents` | `~/.agents/skills/local-board` | `~/.agents/skills/local-team` |

Each directory is rendered fresh on every install. Legacy directories from
older layouts (`*-orchestrator`, `local-board-team`) are removed if present,
for each target's configured legacy dirs (`codex` has none — it never used
the older layout).

### Claude agents (`claude` target only)

`agents/claude/*.md` is copied to `~/.claude/agents/`, one file per agent:

```text
~/.claude/agents/local-board-decomposer.md
~/.claude/agents/local-board-designer.md
~/.claude/agents/local-board-documenter.md
~/.claude/agents/local-board-gatecheck.md
~/.claude/agents/local-board-implementer.md
~/.claude/agents/local-board-reviewer.md
~/.claude/agents/local-board-tester.md
```

## settings.json side effects (consent-sensitive)

The `claude` target is the only target that touches `~/.claude/settings.json`.
This is a real consent decision, not a formality — read this section before
installing the `claude` target.

**Always, on every `claude`-target install:** the installer appends the
permission allow rule

```text
Bash(local-board *)
```

to `permissions.allow` in `~/.claude/settings.json` (idempotent write; it
checks first, so it is only added once). Claude subagent frontmatter cannot
scope Bash permissions to a command prefix or a specific ticket, so this rule
is necessarily session-wide: it pre-approves **every** `local-board`
subcommand — including mutating ones such as `move`, `complete-step`, and
`create` — for any Bash-capable agent or subagent in that Claude Code session.
The decomposer subagent is propose-only, but other Bash-capable agents in the
same session (including the orchestrator itself) can invoke any local-board
subcommand without a further prompt once this rule is present. Ticket content
should be treated as untrusted input given this grant.

The write is atomic (temp file + rename) and does not touch anything else in
`settings.json`.

## Hooks (opt-in)

`local-board install --hooks` additionally patches `settings.hooks` with four
managed entries, each running `node "<script>"` under
`~/.local-board/hooks/`:

| Event | Matcher | Script |
|---|---|---|
| `PreToolUse` | `Task\|Agent` | `routing-validator.js` |
| `PreToolUse` | `Bash` | `evidence-gate.js` |
| `PreToolUse` | `Bash` | `approve-inline-consent.js` |
| `PostToolUse` | `Task\|Agent` | `dispatch-ledger.js` |

Hooks are off by default. A plain `local-board install` on the `claude`
target prints a hint to run `--hooks`. `local-board install --no-hooks`
removes exactly these four managed entries (matched by script path, so both
the current quoted form and an older unquoted form are recognized) and prunes
any matcher group or event array left empty; any hooks you authored yourself
are left untouched.

See [docs/EnforcementHooks.md](EnforcementHooks.md) for what each hook does
and why they fail open on errors.

## Uninstall / manual removal

```sh
local-board install --uninstall
```

Removes:

- `~/.local-board/` (the whole runtime directory).
- Every target's skill dir, team skill dir, and configured legacy dirs
  (checked for all six targets, not just installed ones; `codex` has no
  legacy dirs to remove).
- The four managed hooks entries from `~/.claude/settings.json`, if present.
- The seven `~/.claude/agents/local-board-*.md` files.

**Uninstall does not remove the `Bash(local-board *)` allow rule.** Install
and uninstall are asymmetric here: install adds the rule, uninstall leaves
it in `~/.claude/settings.json`. The consent-sensitive grant survives a full
uninstall. To remove it, manually delete the
`Bash(local-board *)` entry from `permissions.allow` in
`~/.claude/settings.json`. (Tracked as a follow-up: see bug
`B20260708T0459Z`, which proposes having `--uninstall` remove this rule too,
mirroring hook removal.)

## Per-harness notes

**Claude Code**: the only target with settings.json side effects (above).
Also the only target that installs the seven subagents.

**Codex**: detect-only, and covered in more depth in
[docs/CodexSupport.md](CodexSupport.md), including route translation between
the configured Claude-first routes and Codex dispatch, model sanitization,
and worktree/sandbox notes. This page does not duplicate that content.

**opencode, Cline, Cursor**: detect-only, skill-only (no agents, no
settings.json changes). Same rendering and legacy-cleanup behavior as Claude's
skill install, minus the settings.json and agents steps.

**Agents (cross-harness)**: explicit-only — install with
`--target=agents` or `--all`. Intended for harnesses that read a shared
`~/.agents/skills/` convention rather than a harness-specific directory.

## Verification

```sh
local-board version
local-board where --json
local-board install --list-targets
```

`where --json` reports the resolved install locations (including
`agentsDir`, which Codex executor prompts read from directly). `--list-targets`
prints each target's id, label, detected/not-detected state, selection
policy, skill dir, and team skill dir without writing anything.
