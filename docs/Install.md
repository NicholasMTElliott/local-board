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
- codex-task is a **peer install, detected but not managed**. If your config
  routes any action to `codex-task:*` (the default `review`/`document`
  routes do), `validate` and a `claude`-target `install` emit a `WARNING`
  when the `codex` CLI is off `PATH` or the codex-task skill is not
  installed. Remedy: install the codex-task skill and run `codex login`, or
  reroute the affected action(s) to another agent. local-board never
  installs or manages codex-task itself.

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
local-board install --home <dir>       # install under <dir> instead of the real home (see Testing / sandboxing)
local-board install --status [--json]  # report install/version/content-hash skew (see Content hash and skew status below)
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
`nodeVersion`, `version`, `skillName`, `teamSkillName`, `claudeAgents[]`, and
(additive) `contentHash` and `targets` — see "Content hash and skew status"
below.

This copy exists for hooks and provenance, not for day-to-day skill use.
Codex executor prompts resolve from `local-board where --json`'s `agentsDir`
field, not from `~/.local-board/`.

## Content hash and skew status

Every install records a deterministic SHA-256 hash (`sha256:<hex>`) over the
exact payload it copies — `package.json`, `README.md`, `SKILL.md`,
`SKILL_TEAM.md` (if present), `bin/`, `src/`, `agents/`, `skills/`, `hooks/`,
and `resources/prompts`/`resources/templates` (renamed `prompts`/`templates`
on install). `install.mjs` is deliberately NOT part of this set: the
installer does not copy it, so a change to the 9-line shim alone never
flips the hash. The hash is computed over sorted POSIX-style relative paths
with CRLF normalized to LF, so it is identical across OS and checkout
line-ending settings.

`install-info.json` carries this hash twice:

- `contentHash` at the top level: the hash of the payload as of the most
  recent install (any target).
- `targets.<id>.contentHash`: the hash recorded the last time THAT target
  was (re)installed. A legacy pre-hash record, or a target discovered only
  via footprint (below) without its own stored entry, is seeded
  `contentHash: null` — an explicit "unknown", which never compares equal to
  a current hash.

`local-board install --status [--json]` recomputes the CURRENT source's hash
(from the running CLI's own package root — always a source layout for an
on-PATH install) and compares it against each target's recorded hash:

```json
{
  "verdict": "current | skewed | not-installed | indeterminate",
  "skewed": false,
  "current": { "version": "1.2.3", "contentHash": "sha256:..." },
  "targets": {
    "claude": { "version": "1.2.3", "contentHash": "sha256:...", "installedAt": "...", "verdict": "current" }
  }
}
```

Per-target verdict: `current` only when the target's recorded hash is a
non-null digest equal to the current hash; otherwise `skewed` (this includes
a null/unknown recorded hash — unknown is never current).

Global verdict (worst-of, in order):

1. `not-installed` (exit `4`) — no target has ANY current-or-legacy
   footprint (skill dir, team skill dir, or a legacy dir), whether or not
   `install-info.json` exists. Never a vacuous `current`.
2. `indeterminate` (exit `5`) — the current source hash is `null` (not a
   source layout; not reachable for a correctly on-PATH CLI, but defined).
   No target is ever reported `current` in this state.
3. `skewed` (exit `3`) — any reconciled target is `skewed`.
4. `current` (exit `0`) — every reconciled target is `current`.

`--json` always prints the full report, regardless of exit code. `2` stays
reserved for usage/parse errors. `--status` reuses the same home resolution
as install/uninstall, so `--home <dir>` works as a test seam here too.

### Per-target tracking and legacy migration

Each target's install state is tracked separately (`targets.<id>`), fixing a
class of bug where installing one target (e.g. `--target=codex`) would make
the *global* status read `current` even though another already-installed
target (e.g. `claude`) was stale. Reconciliation (`reconcileTargets`, shared
by the install-write path and `--status`) is footprint-driven and
re-validates every entry against disk on every call:

- A target is included only when it currently has a footprint: its current
  skill dir, its current team skill dir, or any of its legacy dirs
  (`local-board-orchestrator`, `local-board-team`) exists on disk right now.
- A target with a footprint but no stored `targets.<id>` entry (a
  pre-feature/legacy `install-info.json`, or a target whose directories
  predate per-target tracking) is seeded with `contentHash: null` — always
  `skewed`, never a false `current`.
- A stored `targets.<id>` entry whose directories have all since been
  deleted is dropped from the reconciled map (never lingers as stale
  `current`).
- Installing a target always overwrites its own entry with fresh
  `{ version, contentHash, installedAt }` (its dirs now exist by
  construction).

## where --json

`local-board where --json` additionally reports `contentHash` (the same
source-only hash `install --status` compares against): `null` on a flattened
`~/.local-board` runtime layout, which is never invoked as the CLI, so this
is an explicit, defined value there rather than an error.

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
`settings.json`. `local-board install --uninstall` reverses this write
(exact-match only — see "Uninstall" below).

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

## Testing / sandboxing

`local-board install --home <dir>` is the supported, first-class way to run a
real install (or uninstall) against a throwaway directory instead of the real
`os.homedir()`. It applies to every install/uninstall entrypoint (`local-board
install`, the deprecated `node install.mjs` shim, and the in-process
`runInstall(argv, { home })` seam), since all three route through the same
home-resolution code. An overridden home also skips the on-PATH precheck (a
sandboxed home has no PATH expectation, so probes need not also stub PATH).
`--home <dir>` rejects empty/blank values (nothing is written); a relative
`<dir>` is resolved against the current directory, not against the
installer's own location.

For test harnesses that must never risk touching the real home directory, set
`LOCAL_BOARD_INSTALL_REQUIRE_HOME=1` in the environment: with the guard set,
`install`/`uninstall` refuse to run against the real home unless `--home` (or
programmatic `options.home`) is supplied, and exit non-zero naming the guard.
This is a fail-closed backstop for automated harnesses, motivated by a
2026-07-08 incident in which a test probe's home fell through to the real
`os.homedir()` and mutated the real `~/.claude/settings.json`. The guard is
opt-in (unset by default) so it never surprises an interactive user; passing
`options.home` as an explicit `undefined` (key present, value `undefined`) is
always an error too, independent of the guard, so a caller's own
mis-configured seam cannot silently fall back to the real home either.

## Uninstall

```sh
local-board install --uninstall
```

`--home <dir>` applies symmetrically here: `local-board install --home <dir>
--uninstall` removes everything under `<dir>` instead of the real home.

Removes:

- `~/.local-board/` (the whole runtime directory).
- Every target's skill dir, team skill dir, and configured legacy dirs
  (checked for all six targets, not just installed ones; `codex` has no
  legacy dirs to remove).
- The `Bash(local-board *)` allow rule from `permissions.allow` in
  `~/.claude/settings.json`, when it exactly matches the installer's rule
  text. A user-narrowed or renamed rule (e.g. `Bash(local-board move *)`) is
  left in place — uninstall never guesses at a hand-edited grant.
- The four managed hooks entries from `~/.claude/settings.json`, if present.
- The seven `~/.claude/agents/local-board-*.md` files.

Install and uninstall are symmetric for the allow rule: install adds it,
uninstall removes it (exact-match only). If `permissions.allow` and
`permissions` are left empty by the removal, both are pruned from
`settings.json`.

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
