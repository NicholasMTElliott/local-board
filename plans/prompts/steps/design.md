# Design Step

Given a ticket, produce a technical design.

Include:
- related tickets and conflicts;
- implementation approach;
- affected files/modules when known;
- risks;
- test strategy;
- open questions.

If requirements are ambiguous enough to block implementation, ask questions instead of inventing scope.

## Estimate after design

After writing the Technical Design, run the estimate step (`plans/prompts/steps/estimate.md`) before completing the design action. This is enforced by local-board for tasks and bugs when `config.estimation.enabled` is true; the orchestrator's `complete-step design` will refuse otherwise.