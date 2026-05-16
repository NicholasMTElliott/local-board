---
id: T20260516T1553Z
type: task
status: backlog
priority: P2
parent: S20260516T1538Z
children: []
blockedBy: [T20260516T1550Z]
blocks: [T20260516T1554Z]
branch: null
estimate: null
created: 2026-05-16T15:53:13Z
updated: 2026-05-16T15:48:48Z
completedSteps: []
routingApprovals: []
---
# Port initial specialty prompts from task-board

## Requirement

Port the five v1 specialty prompts from the sibling task-board project into local-board, trimming each to local-board prompt conventions.

Source directory: `c:/Users/Nicho/Documents/task-board/prompts/optional-steps/`.

Target paths (must match the config entries from T20260516T1550Z exactly):
- `plans/prompts/optional-steps/design/security_threat_model.md`
- `plans/prompts/optional-steps/design/ui_component_review.md`
- `plans/prompts/optional-steps/design/ux_interaction_review.md`
- `plans/prompts/optional-steps/impl/security_audit.md`
- `plans/prompts/optional-steps/impl/ui_visual_review.md`

For each port:
- Preserve the substantive review guidance (what to look for, what to flag, examples).
- Strip the task-board `section_update` contract (local-board records evidence via `complete-step`, not section diffs).
- Strip GitHub-specific references (no PR links, no labels, no Octokit hints).
- Strip any task-board-specific marker comment instructions; the comment-markers story handles that separately.
- Keep the prompts agent-agnostic — no executor-specific framing.

## Acceptance Criteria

- All five target files exist with the correct paths matching the config entries.
- Each ported prompt opens with a brief role/scope statement and lists the review questions or checklist drawn from the task-board source.
- No remaining references to `section_update`, managed sections, GitHub PRs, labels, or task-board-specific tooling in the ported files.
- Each prompt instructs the agent to leave findings via `complete-step <id> <step-name> --evidence "<summary>"` (or, when comments are warranted, via `local-board comment`), matching local-board's evidence model.
- Paths line up with `optionalSteps` entries from T20260516T1550Z so `specialty-run` can resolve them.
- `local-board validate` remains clean.
- Depends on T20260516T1550Z (paths must match the config catalog).

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
