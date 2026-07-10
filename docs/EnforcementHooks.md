# Enforcement Hooks

local-board can install a small set of Claude Code hooks that make unobserved
Claude subagent route claims harder to record. They are opt-in because they edit
the user's Claude Code settings and depend on Claude Code hook behavior.

Enable them with:

```sh
local-board install --hooks
```

Disable them with either:

```sh
local-board install --no-hooks
local-board install --uninstall
```

The normal installer leaves hooks off and prints a hint. When enabled, the
installer writes managed entries into `~/.claude/settings.json` and copies the
hook scripts under `~/.local-board/hooks/`. Reinstalling deduplicates managed
entries by script path, not exact quoting, so older unquoted commands and newer
quoted commands collapse to one entry. Uninstall removes the same managed
entries and leaves user-authored hooks alone.

## What They Enforce

The hooks reduce one specific self-reported evidence gap for Claude subagent
routes: whether a matching dispatch was observed in the current session. They
do not prove that the recorded evidence text is authentic, complete, or
tamper-proof; see `SECURITY.md`'s "Orchestrator-authored evidence" limitation.
Without them, an orchestrator or prompt-injected command could attempt to run:

```sh
local-board complete-step <ticket-id> implement --executor claude-subagent:local-board-implementer ...
```

even if no Claude subagent was actually dispatched in that session. The CLI
still validates route names and completion requirements, but it cannot observe
Claude Code tool calls by itself. The hooks add that runtime observation.

There are four hook scripts:

- `routing-validator.js`: a `PreToolUse` hook for `Task|Agent`. Before a
  `local-board-*` subagent dispatch, it runs `local-board check-dispatch` using
  the ticket id, subagent type, and optional model from the dispatch. A computed
  route or model mismatch is denied before the subagent starts.
- `dispatch-ledger.js`: a `PostToolUse` hook for `Task|Agent`. After each
  subagent dispatch, it appends a JSONL record to
  `.local-board/dispatch-ledger.jsonl` with `ts`, `session_id`,
  `subagent_type`, `model`, and `ticketId`. It is silent and never denies.
- `evidence-gate.js`: a `PreToolUse` hook for `Bash`. Before a
  `complete-step` command that claims a `claude-subagent:*` executor, it checks
  the dispatch ledger for a matching `(session_id, ticketId, subagent_type)`
  entry. If none exists, it denies the command.
- `approve-inline-consent.js`: a `PreToolUse` hook for `Bash`. Before an
  `approve-inline` command, it returns `permissionDecision: "ask"` so the
  Claude Code permission prompt becomes the explicit user consent for that
  routing deviation.

The `Task|Agent` matcher is intentional. Claude Code has used `Task` for
subagent dispatches, and release notes have referred to an `Agent` tool name.
Registering both keeps the hook tolerant of that rename.

## Prompt Convention

Claude subagent dispatch prompts must start with:

```text
Ticket: <id>
```

The routing validator and dispatch ledger extract the ticket id from that line.
If the line is missing, routing validation cannot tie the tool call to a ticket
and allows the dispatch. The CLI-side `begin-step`, `complete-step`, and
done-time validation remain the backstop.

## Ledgers

The CLI owns `.local-board/active-steps.json`. `begin-step` records the active
ticket action, configured route, and configured model there. A non-empty
`gate-check` or `specialty-run` records a scoped consultation stamp with
`kind` (`gate` or `specialty`) and stage/action/route/model identity; these
stamps use no-clobber semantics. `check-dispatch` reads the ledger for hook
decisions. `complete-step`/`approve-inline` clear the matching action identity;
specialty completion clears its matching specialty identity; gate completion
clears only the matching gate-kind stage. A real status change sweeps abandoned
consultation stamps, while a same-status re-save leaves them alone. If no
ledger entry exists, the fallback first uses the ticket's
existence-verified registered worktree, then the invocation root. Stamps and
clears are lock-serialized by the CLI.

The hooks own `.local-board/dispatch-ledger.jsonl`. It is append-only JSONL in
v1. Entries are small and there is no rotation. The dispatch ledger is
best-effort hook evidence, not the canonical mutation ledger. A long running
project can delete old ledger entries when no Claude Code session needs them,
but do not delete entries in the middle of an active session if `evidence-gate`
still needs to match a completion claim to a dispatch.

Both paths live under `.local-board/`, which is machine-local runtime state.

## Fail-Open Policy

The hooks fail open on errors. If the CLI is missing, a child process times out,
the ledger is unreadable, JSON parsing fails, or `check-dispatch` returns an
ambiguous error exit, the hook allows the action and reports a warning where
Claude Code supports one.

This is deliberate. A broken hook should not brick a coding session or strand a
ticket. The authoritative enforcement remains in the deterministic CLI:
`complete-step` validates strict routing at write time, and `move ... done` /
`validate` re-check completion evidence before closeout.

## Known Limits

Hooks only see tool calls that Claude Code sends through the hook system. They
cannot see inline work in the orchestrator's own context, skipped steps that
produce no tool event, or Codex-side spawned agents. Those paths are owned by
the CLI preconditions and strict-routing checks.

The evidence gate is session-scoped. A same-session loop-back through the same
ticket and subagent can satisfy the gate with an earlier ledger entry. The CLI
must still decide whether the current ticket state is eligible to complete.

`approve-inline-consent.js` depends on `permissionDecision: "ask"`. In a
headless or non-interactive Claude Code run, ask behavior may block, fail, or be
handled by the harness policy rather than an interactive user prompt. Treat
inline fallback as an explicit operational decision in those environments.

The hooks are for Claude Code. Codex has no equivalent deny-hook surface here,
so Codex enforcement stays in the local-board CLI and Codex orchestration skill.

The hook API and subagent tool naming should be treated as a moving integration
surface until the relevant Claude Code behavior is stable. The installer keeps
the feature opt-in, registers both `Task` and `Agent`, and supports
`--no-hooks` / `--uninstall` so projects can migrate cleanly if the upstream
hook contract changes.
