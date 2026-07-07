# Codex Support

local-board can be installed directly into Codex. Codex uses the same Markdown tickets and Node CLI as Claude Code, but it has its own skill templates and executor prompts.

## Install

```sh
node install.mjs --target=codex
```

The installer writes:

```text
~/.codex/skills/local-board/
~/.codex/skills/local-team/
~/.local-board/
```

`~/.local-board/` contains the installed CLI runtime and the Codex executor prompts under `agents/codex/`.

Use `node install.mjs --list-targets` to see detected targets. A normal `node install.mjs` includes Codex when `~/.codex/` exists.

## Skills

- `local-board`: create tickets, initialize a board, work the next eligible ticket, or work a specific ticket.
- `local-team`: keep several ready tickets in flight from one top-level Codex session using per-ticket worktrees and wave-barrier dispatch.

Both skills treat the local-board CLI as the state authority. Codex should query workflow state with `query-next`, `query-ticket`, and `begin-step`; mutate state with `create`, `section`, `comment`, `complete-step`, `move`, and relationship commands; and finish by running `validate`.

## Route Translation

Existing projects can keep Claude-first config in `plans/local-board.config.jsonc`. The Codex skill translates known Claude local-board routes at dispatch time:

| Configured route | Codex behavior |
|---|---|
| `inline` | current Codex session does the step |
| `codex-task:read-only` | spawn a Codex explorer |
| `codex-task:workspace-write` | spawn a Codex worker |
| `claude-subagent:local-board-decomposer` | spawn a Codex explorer with the decomposer prompt |
| `claude-subagent:local-board-designer` | spawn a Codex worker with the designer prompt |
| `claude-subagent:local-board-implementer` | spawn a Codex worker with the implementer prompt |
| `claude-subagent:local-board-reviewer` | spawn a Codex explorer with the reviewer prompt |
| `claude-subagent:local-board-tester` | spawn a Codex explorer with the tester prompt |
| `claude-subagent:local-board-documenter` | spawn a Codex worker with the documenter prompt |
| `claude-subagent:local-board-gatecheck` | spawn a Codex explorer with the gate-check prompt |

Strict routing still records the configured logical route. For example, if Codex physically runs the designer translated from a Claude route, completion evidence can be:

```sh
node ~/.local-board/bin/local-board.js complete-step T123 design --executor claude-subagent:local-board-designer@codex-default --evidence "Design written by Codex worker."
```

Validation compares only the route before `@`, so existing configs continue to pass.

## Worktrees and the sandbox

`worktree-add` and every worker edit inside a ticket worktree must land inside a
writable root. `worktrees.location` in `plans/local-board.config.jsonc` controls
where ticket worktrees are created:

- `"sibling"` (default): `<dirname(repoRoot)>/<basename(repoRoot)>-worktrees`. This
  is outside the repo. Under Codex's default `workspace-write` sandbox, writes
  outside the workspace root are blocked or trigger approval escalations. To use
  the sibling layout under Codex, add the sibling directory as an additional
  writable root (Codex `sandbox_workspace_write.writable_roots`, or the equivalent
  `-c` override) pointing at `<repo>-worktrees`.
- `"inside"`: `<repoRoot>/.worktrees`, git-ignored. This is under the workspace
  root, so `workspace-write` needs no extra configuration. **Recommended for
  Codex parallel (`local-team`) runs.**
- any other non-empty string: an explicit path (absolute, or relative to
  repoRoot), rejected if it resolves inside `plans/`.

## Models

Do not pass Claude aliases such as `opus`, `sonnet`, or `haiku` to Codex spawned agents. The Codex skill inherits the parent Codex model unless the configured model is already a valid Codex model id. When a Claude route is translated without a valid Codex model id, evidence uses `@codex-default`.

## Single-Ticket Flow

1. Read project instructions and Memory Bank.
2. Run `validate`.
3. Run `query-next --json` or `query-ticket <id> --json`.
4. Run `begin-step <id> --json`.
5. Dispatch the step through the route translation table.
6. Persist return-only output with `section --file`; workers persist their scoped edits.
7. Run `complete-step`.
8. Run gate-check and specialty steps for design, implement, or test stages.
9. Move to one returned transition status.
10. Run `validate`.

## Team Flow

`local-team` is one Codex orchestrator, not a set of persistent teammates. It:

- runs `fast-forward`, `team-config`, and `list --ready`;
- creates one worktree per in-flight ticket with `worktree-add`;
- dispatches each wave of ready steps to Codex explorers/workers;
- records evidence and transitions itself;
- runs closeout with `move ... done`;
- removes worktrees after successful closeout.

The first Codex team mode uses wave-barrier scheduling. It waits for a batch of step executors to finish before advancing tickets and refilling slots.

## Limits

- Unknown `claude-subagent:*` routes need user approval before inline fallback.
- Return-only executors must not edit files or run ticket mutation commands.
- Workers must stay in their assigned worktree and must not revert unrelated edits.
- Codex support does not add a new route grammar. `worktrees.location` is a
  general config key (see "Worktrees and the sandbox" above), not Codex-specific.
