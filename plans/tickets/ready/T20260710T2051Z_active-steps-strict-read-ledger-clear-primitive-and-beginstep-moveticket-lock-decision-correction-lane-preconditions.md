---
id: T20260710T2051Z
type: task
status: ready_for_design
priority: P4
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260710T2051Z-active-steps-strict-read-ledger-clear-primitive-and-beginstep-moveticket-lock-decision-correction-lane-preconditions
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-10T20:50:03Z
updated: 2026-07-11T20:35:01Z
completedSteps: []
routingApprovals: []
---
# active-steps: strict-read ledger clear primitive and beginStep/moveTicket lock decision (correction-lane preconditions)

## Requirement

Recorded precondition from T20260710T1535Z (2026-07-10), whose authoring-correction lane was rejected after three design-review rounds each found a ledger-atomicity edge: (1) a stale kind:action record keeps the old stage's agent authorized after a lateral correction; (2) clearing after publish is non-atomic; (3) clearActiveStepIf reads through readLedgerSelfHeal, which converts corrupt or transiently unreadable ledgers to {} and silently no-ops instead of failing - so a fail-closed clear cannot be built on it. This ticket builds the primitives; it does NOT revive the lane.

### Scope

1. Add a strict-read variant of the active-steps ledger read (throws on unreadable/corrupt instead of self-healing to {}), and a clearActiveStepStrict(root, ticketId, predicate) built on it: genuinely-missing entry is a no-op success; read/parse/IO failure throws.
2. Evaluate (design decides) sharing the ticket lock between beginStep and moveTicket so status transitions and dispatch stamps serialize; if adopted, specify lock ordering to avoid deadlock with the ledger file lock; if rejected, document why (the current advisory/fail-open hook rationale) in systemPatterns.
3. Tests: strict clear on a healthy ledger (clears), on a missing entry (no-op success), on a corrupt ledger (throws, ledger untouched); self-healing read path unchanged for all existing callers (legacy-shape assertions).
4. Docs: memory-bank/systemPatterns.md ledger-semantics note.

### Acceptance criteria

- clearActiveStepStrict exists with the throw/no-op contract above; all existing callers keep self-healing semantics byte-identically.
- The beginStep/moveTicket lock decision is recorded with rationale either way.
- npm run check and node --test pass.

### Non-goals

- Does not implement the authoring-correction lane (a future ticket may, using these primitives).

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
