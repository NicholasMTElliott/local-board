---
id: T20260707T1326Z
type: task
status: ready_for_design
priority: P1
parent: null
children: []
blockedBy: [T20260707T1325Z]
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T13:26:41Z
updated: 2026-07-07T13:23:55Z
completedSteps: []
routingApprovals: []
---
# enforce: Claude Code hooks for dispatch ledger, evidence gate, routing validator, and approve-inline consent

## Requirement

Completion evidence is self-reported: an orchestrator can do every step inline and record `--executor claude-subagent:local-board-designer@opus`, and strict routing passes (`src/tickets.js:448-492`, `755-776`). `approve-inline` requires only a non-empty `--reason`, so the strict-routing escape hatch is controlled by the party it constrains. Claude Code hooks can close this on the Claude side. Confirmed mechanics: PreToolUse hooks receive the literal tool input (`subagent_type`, prompt, `model`) for Agent/Task dispatches, can deny with a reason fed back to the model or return `permissionDecision: "ask"`, and hook commands can be arbitrary node scripts configured in `.claude/settings.json`.

Build, in order:
1. Dispatch ledger + evidence gate: PostToolUse on Task appends `{ts, subagent_type, model, ticketId}` to `.local-board/dispatch-ledger.jsonl` (require a machine-readable `Ticket: <id>` line in dispatch prompts — one-line skill change). PreToolUse on Bash matching `complete-step`: deny a `claude-subagent:*` executor claim with no matching ledger entry newer than the ticket's last loop-back.
2. Routing/model validator: PreToolUse on Task; when `subagent_type` starts with `local-board-`, run `check-dispatch` (T20260707T1325Z) and deny on mismatch, reporting the expected route.
3. approve-inline consent: PreToolUse on Bash matching `approve-inline` returns `ask`, making the human permission prompt the deterministic user approval.

Hooks ship with `local-board install` (and/or the plugin, T20260707T1323Z). Document what hooks cannot see: inline work produces no tool call; skipped steps produce no event (CLI preconditions cover those — T20260707T1327Z, T20260707T1328Z); Codex has no deny-hook equivalent, so Codex enforcement stays CLI-side.

Depends on: T20260707T1325Z.

Acceptance: with hooks installed, a wrong-agent or wrong-model Task dispatch is denied; a complete-step claiming an unledgered subagent execution is denied; approve-inline triggers a human prompt; all three degrade gracefully when the CLI is absent.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
