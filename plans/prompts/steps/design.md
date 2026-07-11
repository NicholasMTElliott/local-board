# Design Step

Given a ticket, produce a technical design.

Include:
- related tickets and conflicts;
- implementation approach;
- affected files/modules when known;
- risks;
- test strategy;
- open questions;
- on a re-design after a loop-back, read the `Review Findings`, `Test Evidence`, and Run Log design-review comments for the findings that caused it, and address each explicitly.

If requirements are ambiguous enough to block implementation, ask questions instead of inventing scope.

## Output and Persistence

Persist the `Technical Design` section body only - do not include the heading
line itself (local-board manages the heading), and fence any literal ## sample
lines - as Markdown with `section --file`, creating the temp file with the Write
tool, never with shell redirection.

- When this step is delegated to the `local-board-designer` subagent, that
  subagent writes its own `Technical Design` section (it has a scoped Write tool)
  and returns only a terse summary, so the large design body never funnels back
  through the orchestrator.
- When this step runs inline, the orchestrator composes the section, writes the
  temp file with the Write tool, and runs `section --file` itself.

## Estimate after design

After writing the Technical Design, run the estimate step (`plans/prompts/steps/estimate.md`) before completing the design action. This is enforced by local-board for tasks and bugs when `config.estimation.enabled` is true; the orchestrator's `complete-step design` will refuse otherwise.
