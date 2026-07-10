---
id: B20260710T2050Z
type: bug
status: ready_for_design
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-10T20:50:02Z
updated: 2026-07-10T20:50:16Z
completedSteps: []
routingApprovals: []
---
# design-review: fallback-free claude-subagent dispatch is rejected by the routing-validator hook (D7 carve-out)

## Requirement

Carved out of T20260710T1532Z (design decision D7, 2026-07-10). A board may validly route agents["design-review"] to a claude-subagent (e.g. claude-subagent:local-board-reviewer). Today commandDesignReviewCheck stamps an active-steps ledger record ONLY when the resolved profile carries a non-empty fallbackModels list (the D6 conditionality rule). For a fallback-FREE claude-subagent design-review profile, no record is stamped, so the routing-validator hook's check-dispatch falls back to the ticket's status action and rejects the reviewer dispatch as an agent mismatch. The default codex-task route is unaffected (Bash dispatches are not hook-gated).

### Scope

1. Stamp the design-review action record in commandDesignReviewCheck for claude-subagent routes unconditionally (drop the fallback-configured condition for the stamp itself), reusing the existing stampActiveStepNoClobber identity semantics and recordDesignReview's identity-scoped clear. The fallbackModels FIELD on the record stays conditional per D6.
2. Byte-identical back-compat carve: codex-task design-review routes still stamp nothing; boards whose design-review profile is codex-task (the scaffold default) are unchanged.
3. Tests: claude-subagent design-review profile without fallbacks -> design-review-check stamps -> check-dispatch accepts the pinned model and rejects others; codex-task route stamps nothing (legacy-shape deep-equal); recordDesignReview still clears the stamp.

### Acceptance criteria

- A board with agents["design-review"] = { route claude-subagent:local-board-reviewer, model opus } passes check-dispatch for that reviewer after design-review-check, with hooks installed.
- Scaffold-default (codex-task) boards byte-identical.
- npm run check and node --test pass.

### Non-goals

- No change to the D6 conditionality of fallback FIELDS; no new CLI commands.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
