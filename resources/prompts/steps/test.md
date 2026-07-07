# Test Step

Validate the implemented ticket.

Include:
- commands run;
- results;
- failures;
- untested risk;
- recommendation: pass, changes_requested, or questions.

## Output and Persistence

Return the `## Test Evidence` section body as Markdown. When this step is delegated, the subagent returns the evidence text and writes no file — the `local-board-tester` subagent has no Write tool. The orchestrator persists it with `section --file`, creating the temp file with the Write tool, never with shell redirection.

## Gate consultation before move

Before moving this ticket out of `test`, the orchestrator must run `gate-check --stage test` and, if the catalog is non-empty, record the result with `gate-complete` (see SKILL.md). When `config.routing.requireGateConsultation` is true, `move` refuses the transition without a recorded consultation.