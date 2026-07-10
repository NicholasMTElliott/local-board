---
id: T20260710T1220Z
type: task
status: ready_for_design
priority: P2
parent: S20260710T1206Z
children: []
blockedBy: []
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-10T12:20:25Z
updated: 2026-07-10T12:21:30Z
completedSteps: []
routingApprovals: []
---
# design-review: routing flag, move precondition, and evidence recorder

## Requirement

Parent S20260710T1206Z adds a design-review step gated on the design -> ready_for_implementation forward move, mirroring the requireGateConsultation pattern (mechanism decision recorded in the parent's decomposition). This task lands the config surface and all src/config.js + src/tickets.js logic; the CLI task and skill/docs task build on it.

## Scope

- src/config.js: add routing.requireDesignReview — false in DEFAULT_CONFIG (ENOENT fallback / deep-merge base), true in defaultConfigJsonc() (init scaffold), with an explanatory comment matching the six existing backward-compat flags. Add an agents["design-review"] default profile { "route": "codex-task:read-only", "model": "gpt-5.6-sol", "effort": "xhigh" } to BOTH DEFAULT_CONFIG and defaultConfigJsonc() identically (the agents block is a shared, non-allowlisted block in the guard test, so the two copies must match). normalizeAgents/normalizeAgentProfile already validate route+model+effort — confirm the profile normalizes cleanly.
- src/tickets.js:
  - Recognize design-review as a known routed action: isKnownAction/configuredRouteForAction/profileForAction must resolve it via agents["design-review"] even though it is absent from statusActions.
  - Add a design -> implementation precondition in moveTicket, active only when config.routing.requireDesignReview === true, refusing the forward move (from ready_for_design/designing to ready_for_implementation) when no design-review:<executor> token is present in completedSteps. The refusal must be a hard error naming the missing step and the command to run (parallel to the gate-consultation refusal at src/tickets.js:715). It must run in the same "no side effects on refusal" position as the gate check, and must never gate backward/lateral/archive moves.
  - Add a recorder (e.g. recordDesignReview(root, ticketId, executor, evidence, options)) that composes the design-review:<executor>@<model> token, runs validateStepRouting with model enforcement so the model pin is enforced (codex-default wildcard via modelSatisfies), applies the guardPrematureEvidence check, appends a Run Log line, and writes atomically under withTicketLock. Effort is a dispatch-time hint only and must never enter the executor token/evidence.
  - Extend producingStatusForToken so a design-review token maps to ready_for_design, making invalidateDownstreamEvidence (loop-back) and evidenceStrippedByPendingForwardMove (premature-evidence guard) treat design-review evidence consistently with design evidence. A FAIL loop-back to ready_for_design must strip the design-review token so a re-run re-records fresh evidence.
  - Do NOT add design-review to routing.doneRequires (deliberate: doneRequires is not conditional on the flag; adding it would break byte-identical behavior for boards with the feature off).

## Acceptance criteria

- With requireDesignReview: true, move <id> ready_for_implementation from ready_for_design/designing is refused (hard error naming the missing design-review step) until a design-review token is recorded; then it succeeds.
- With requireDesignReview omitted/false, the same move and all moveTicket/evidence behavior are byte-identical to today (new test/config.test.js backward-compat-disabled case for the flag; agents["design-review"] is inert when the flag is off).
- The recorder enforces the configured model pin (gpt-5.6-sol; codex-default accepted; a mismatched model is refused with the same shape as complete-step's model gate) and rejects empty evidence; effort never appears in the token.
- A loop-back move <id> ready_for_design (with invalidateOnLoopBack: true) strips the design-review token and enumerates it in the Run Log line, exactly as design/action tokens are stripped.
- test/config.test.js "defaultConfigJsonc matches DEFAULT_CONFIG except for documented differences" passes with routing.requireDesignReview added to the allowlist (and only that path added).
- npm run check and node --test pass.

## Non-goals

No CLI commands (sibling CLI task). No prompt file (sibling prompt task). No skill/docs text (sibling docs task). No second reviewer, no human-approval gate, no doneRequires entry.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
