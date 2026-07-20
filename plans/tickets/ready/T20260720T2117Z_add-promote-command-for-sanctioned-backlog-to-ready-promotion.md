---
id: T20260720T2117Z
type: task
status: ready_for_design
priority: P1
parent: null
children: []
blockedBy: []
blocks: [T20260720T2118Z]
branch: local-board/T20260720T2117Z-add-promote-command-for-sanctioned-backlog-to-ready-promotion
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-20T21:16:06Z
updated: 2026-07-20T22:01:28Z
completedSteps: []
routingApprovals: []
---
# Add promote command for sanctioned backlog-to-ready promotion

## Requirement

### Problem

Backlog -> `ready_*` promotion is structurally allowed by `move` (the `enforceTransitions` allow-set includes "backlog promote"), but nothing computes the CORRECT entry status for a ticket. In the 2026-07-20 `local-team` run the orchestrator had to reverse-engineer the entry-status-per-type rule from config before moving anything, and nothing prevents an orchestrator from promoting a story straight to `ready_for_implementation`, skipping decomposition/design. Promotion is a user-authorized action (see policy ticket T20260720T2118Z) and deserves a first-class, auditable command.

### Requirement

1. New command: `local-board promote <ticket-id> [--to <status>] [--json]`.
   - Default (no `--to`): compute the type-appropriate entry status — derived from config (`workflow.pipelineOrder` / `workflow.statusActions` / `routing.doneRequires`), not hard-coded: e.g. epics/stories with no children enter `ready_for_decomposition`; tasks/bugs enter the first status of their pipeline (`ready_for_design` on the scaffold). Design decides the exact derivation; it must respect boards with customized pipelines.
   - `--to <status>` overrides the target; it must be a trigger (`ready_*`) status, else refuse.
   - Refuse when the ticket is not in `backlog` (message names the current status).
   - Warn (stderr, non-fatal) when the ticket has open `blockedBy` dependencies — promotion is allowed (eligibility gating already keeps it out of the ready queue) but the operator should know.
2. Route the actual transition through the existing `moveTicket` path so folder relocation, `enforceTransitions`, planning auto-commit, and Run Log behavior all apply unchanged.
3. Append a Run Log line recording the promotion and its trigger, e.g. `Promoted backlog -> <status> (user-directed)`.
4. `--json` returns the ticket id, from/to statuses, and computed-vs-overridden target.
5. Add `promote` to the curated CLI command blocks in root `SKILL.md` and the codex mirror (byte-identical; `test/skill-usage-sync.test.js` enforces), and to CLI usage text.

### Acceptance Criteria

- `promote` on a scaffold-config board sends an epic to `ready_for_decomposition` and a task to `ready_for_design` without `--to`.
- `promote --to designing` refuses (not a trigger status); `promote` on a `ready_for_design` ticket refuses (not backlog).
- Open-dependency promotion succeeds with a stderr warning and the ticket stays ineligible in `list --ready`.
- Run Log line present after promotion; front matter status and folder both updated.
- `test/skill-usage-sync.test.js` passes with the updated command blocks; full suite (`node --test`) green.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
