---
id: B20260710T1225Z
type: bug
status: ready_for_design
priority: P1
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-10T12:25:41Z
updated: 2026-07-10T12:26:03Z
completedSteps: []
routingApprovals: []
---
# check-dispatch denies legitimate gate-check consultation dispatches when hooks are enabled

## Requirement

With enforcement hooks installed (local-board install --hooks), the routing-validator PreToolUse hook denies every legitimate gate-check consultation dispatch. Found live 2026-07-10 on this board, first gated stage after enabling hooks.

## Repro

1. Board with hooks installed and a gated stage (e.g. design) whose action agent is claude-subagent:local-board-designer@opus and gate-check profile claude-subagent:local-board-gatecheck@haiku.
2. Complete the design step (complete-step design ... clears the active-steps ledger entry).
3. Run gate-check <id> --stage design (non-empty catalog; pure read, stamps nothing).
4. Dispatch the gate agent with the documented "Ticket: <id>" first line.
5. routing-validator shells check-dispatch --agent local-board-gatecheck --ticket <id>, which exits 1: {"ok":false,"reason":"agent-mismatch","expected":{"agent":"local-board-designer","model":"opus"}}. Dispatch denied.

## Root cause

checkDispatchForTicket (src/active-steps.js:132-156) has two sources of expectation: the ledger entry, or (fallback) resolveExpectedStep = the ticket's status-configured ACTION agent. There is no representation of a gate-check consultation as a valid dispatch: complete-step has already cleared the ledger by the time gate-check runs (by design — the gate fires between action completion and the move), and the fallback resolves the action route (designer), never the config agents["gate-check"] route. The same structural gap applies to specialty-step dispatches routed to claude-subagent:* (specialty-run is also a pure read that stamps nothing) — the fallback will expect the action agent and deny the specialty agent.

## Expected behavior (design decides the mechanism; constraints below)

- A gate-check dispatch for the configured gate agent must be allowed at the point the documented flow requires it (after action complete-step, ticket still in the stage's ready/active status).
- Same for a configured specialty route once T20260710T1156Z lands specialty profiles.
- The fix must not simply allow any local-board-gatecheck dispatch unconditionally — the point of the hook is to catch misrouted dispatches. Candidate mechanisms: gate-check (and specialty-run) stamp a scoped consultation entry in the ledger that check-dispatch consumes (mirroring begin-step's stamp + gate-complete/complete-step clear), or check-dispatch consults config agents["gate-check"] / the stage's specialty catalog as additional valid expectations when the ticket sits at a gated stage boundary.
- Fail-open semantics of the hook itself are unchanged.

## Acceptance criteria

- With hooks installed, the full documented flow (begin-step -> action dispatch -> complete-step -> gate-check -> gate agent dispatch -> gate-complete -> move) runs with zero hook denials on a correctly-routed board.
- A deliberately misrouted gate dispatch (e.g. dispatching local-board-tester for the gate, or gatecheck for a ticket with no completed action evidence) is still denied.
- check-dispatch unit tests cover: gate dispatch allowed at stage boundary, gate dispatch denied when misrouted, specialty dispatch allowed for a configured specialty route (or explicitly deferred to the T1156Z follow-up if profiles land later).
- npm run check and node --test pass.

## Workaround in use until fixed (recorded for transparency)

Dispatching the gate agent without the "Ticket: <id>" first line — the hook's documented residual (extractTicketId null -> allow, routing-validator.js:64-67). This sacrifices dispatch-ledger verification for gate dispatches only; the consultation itself remains verified server-side by gate-complete evidence. Remove the workaround from the orchestrator flow once this bug is fixed.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
