---
id: T20260516T1549Z
type: task
status: backlog
priority: P2
parent: S20260516T1537Z
children: []
blockedBy: [T20260516T1545Z, T20260516T1546Z, T20260516T1547Z]
blocks: []
branch: null
estimate: null
created: 2026-05-16T15:49:46Z
updated: 2026-05-16T15:45:32Z
completedSteps: []
routingApprovals: []
---
# Prompts: add estimator role and estimate step; update design step

## Requirement

Port the estimator role and add the estimate step prompt. Depends on the estimate CLI (T20260516T1545Z), calibration suggest CLI (T20260516T1546Z), and config block (T20260516T1547Z).

Files to add:
- `plans/prompts/roles/estimator.md` — adapt from `task-board/prompts/estimator.md`. Drop the section-update contract. Keep relative-sizing principles, powers-of-2 guidance, and the bootstrap branch ("if calibration is `bootstrap`, size the ticket as if it were a 4 on the configured scale and note that this ticket will become the calibration anchor for its type").
- `plans/prompts/steps/estimate.md` — short step prompt that: reads the ticket, reads the calibration ticket body when basis is non-`bootstrap`, compares scope/complexity/risk/unknowns, outputs a single number on the configured scale, then calls `local-board estimate <id> <n> --basis <basis>`.

File to update:
- The existing `design` step prompt: append the calibration-then-estimator-then-estimate sequence as the final instruction. Reference both new prompts and both new CLI commands.

## Acceptance Criteria

- `plans/prompts/roles/estimator.md` exists, follows local-board prompt conventions, and includes the bootstrap branch.
- `plans/prompts/steps/estimate.md` exists and instructs: read ticket, read calibration if non-bootstrap, output a single point value on the configured scale, call `local-board estimate <id> <n> --basis <basis>`.
- The existing `design` step prompt instructs the agent to run `local-board calibration suggest`, the estimator role/prompt, and `local-board estimate` after writing the design.
- Prompts reference the configured scale and `splitThreshold` (flag for decomposition when estimate >= splitThreshold).
- No managed-section update contract appears in the estimator role (intentionally dropped per parent story).
- A grep/lint check (or equivalent existing prompt-presence test) confirms the new files exist and the design prompt references the new commands.

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
