# Codex Support

local-board can be installed directly into Codex. Codex uses the same Markdown tickets and Node CLI as Claude Code, but it has its own skill templates and executor prompts.

## Install

```sh
local-board install --target=codex
```

The installer writes:

```text
~/.codex/skills/local-board/
~/.codex/skills/local-team/
~/.local-board/
```

Codex executor prompts resolve from the running CLI package reported by `local-board where --json`, using its `agentsDir` field. The `~/.local-board/` copy remains only for hooks and provenance.

Use `local-board install --list-targets` to see detected targets. A normal `local-board install` includes Codex when `~/.codex/` exists. See [docs/Install.md](Install.md) for the full path inventory and other harness targets.

## Skills

- `local-board`: create tickets, initialize a board, work the next eligible ticket, or work a specific ticket.
- `local-team`: keep several ready tickets in flight from one top-level Codex session using per-ticket worktrees and wave-barrier dispatch.

Both skills treat the local-board CLI as the state authority. Codex should query workflow state with `query-next`, `query-ticket`, and `begin-step`; mutate state with `create`, `section`, `comment`, `complete-step`, `move`, and relationship commands; and finish by running `validate`.

When maintaining skill text, keep the repo-root `SKILL.md` and `skills/codex/local-board/SKILL.md` `## CLI Commands` blocks byte-identical; `test/skill-usage-sync.test.js` treats root `SKILL.md` as canonical.

## codex-task availability (detected, not managed)

The default config routes `review` -> `codex-task:read-only` and `document`
-> `codex-task:workspace-write`. The `init` scaffold pins `review` to
`gpt-5.6-terra`/`high` out of the box; delete the `model`/`effort` keys on
`agents.review` in `plans/local-board.config.jsonc` (or reroute the step) if
your plan lacks GPT-5.6. codex-task is a **peer install**: local-board
detects whether it is usable but never installs or manages it. `validate`
(and a `claude`-target `install`) check, best-effort and fail-open, whether
the `codex` CLI resolves on `PATH` and whether a codex-task skill is present
under any installed harness's skills directory. If the config routes to
`codex-task:*` and either prerequisite is missing, a one-line `WARNING` names
the affected action(s) and the missing prerequisite(s); the check never fails
the command it runs in (`validate`'s exit code is driven only by ticket
issues). See [docs/Install.md](Install.md#prerequisites) for the remedy.

Detection also covers `optionalSteps[].agent` entries routed to `codex-task:*`,
whether written as a bare route string or as a `{ route, model?, effort? }`
profile object (see [docs/specialty-steps.md](specialty-steps.md)) — the
warning names the entry as `<step-name> (<stage>)`.

## Route Translation

Existing projects can keep Claude-first config in `plans/local-board.config.jsonc`. `begin-step <ticket-id> --harness codex --json` computes the translation from the configured route directly (single authority: `src/codex-dispatch.js`) and returns it as an additive `codexDispatch` block. Dispatch straight from that block instead of a hand-maintained table.

The required `codexDispatch` fields are:

- `dispatchKind`: `inline` or `spawn_agent`.
- `agentType`: `worker`, `explorer`, or `null`.
- `promptPath`: absolute prompt path, or `null` when no safe prompt is known.
- `model`: denylist-sanitized Codex model override, or `null` for no Codex override.
- `evidenceExecutor`: exact `complete-step --executor` value; uses `@codex-default` when `model` is `null`.
- `known`: `false` means the orchestrator must ask before inline fallback, then use `approve-inline`, or move the ticket to `questions`.

One row, illustrative only:

| Configured route | Codex behavior |
|---|---|
| `claude-subagent:local-board-designer` | spawn a Codex worker with the designer prompt |

Strict routing still records the configured logical route. For example, if Codex physically runs the designer translated from a Claude route, completion evidence can be:

```sh
local-board complete-step T123 design --executor claude-subagent:local-board-designer@codex-default --evidence "Design written by Codex worker."
```

Route matching compares only the part before `@`, so existing configs continue to pass. When
the route matches and the action's profile pins a model, `complete-step` under strict routing
also requires the `@model` suffix to satisfy the pin — `codex-default` is a documented wildcard
that satisfies any pinned model, so translated Codex evidence always passes without needing the
real model id.

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

Do not pass Claude aliases such as `opus`, `sonnet`, or `haiku` to Codex spawned agents. `begin-step --harness codex` sanitizes this automatically: `codexDispatch.model` is `null` and `codexDispatch.evidenceExecutor` carries `@codex-default` whenever the configured model has no valid Codex id. A null `model` means do not pass a model override to Codex.

### Effort

Agent profiles may also pin `effort` (a reasoning-effort token) alongside `model`. `begin-step --harness codex` surfaces it as `codexDispatch.effort` — `null` when unset, no sanitization when set (unlike `model`, effort names are not Claude/Codex-partitioned, so the value passes through verbatim). A non-null effort maps to `--reasoning-effort <effort>` on `codex-task:*` routes. Effort values are plan- and model-dependent: local-board only shape-validates the token locally (same charset rule as `model`), never enumerating which values a given model supports — the target harness/server validates that.

`optionalSteps[].agent` accepts the same `{ route, model?, effort? }` profile grammar (route grammar, model/effort shape, `inline` rejects both) as `agents.<action>`, minus `prompt` (specialty entries carry their own top-level `prompt` instead). `specialty-run --json` returns the resolved `model`/`effort` alongside `agent`; dispatch a `codex-task:*` specialty by passing `--model <model>` / `--reasoning-effort <effort>` to the wrapper when non-null, mirroring `codexDispatch.model`/`codexDispatch.effort` above. See [docs/specialty-steps.md](specialty-steps.md) for the full evidence-recording contract.

## Single-Ticket Flow

1. Read project instructions and Memory Bank.
2. Run `validate`.
3. Run `query-next --json` or `query-ticket <id> --json`.
4. Run `begin-step <id> --harness codex --json`.
5. Dispatch the step from the returned `codexDispatch` block.
6. Persist return-only output with `section --file`; workers persist their scoped edits. Section payloads are body-only, so omit the target `## Heading` and fence literal top-level `## ` samples.
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

- Unknown or unconfigured routes return `known:false`; ask the user before inline fallback and record `approve-inline`, or move the ticket to `questions`.
- Return-only executors must not edit files or run ticket mutation commands.
- Workers must stay in their assigned worktree and must not revert unrelated edits.
- Codex support does not add a new route grammar. `worktrees.location` is a
  general config key (see "Worktrees and the sandbox" above), not Codex-specific.
