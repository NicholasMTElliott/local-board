---
id: T20260710T1223Z
type: task
status: ready_for_design
priority: P2
parent: S20260710T1206Z
children: []
blockedBy: [T20260710T1222Z]
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-10T12:20:26Z
updated: 2026-07-10T12:21:31Z
completedSteps: []
routingApprovals: []
---
# design-review: skill and docs updates for both flows

## Requirement

The single-ticket flow (SKILL.md, skills/codex/local-board/SKILL.md) and the local-team flow (SKILL_TEAM.md, skills/codex/local-team/SKILL.md) must document the design-review step, its verdict handling, and the FAIL loop-back. docs/ narrative and the README index must stay in sync. Parent: S20260710T1206Z.

## Scope

- Update the four skill files: insert the design-review step between design (complete-step design) and the move to ready_for_implementation. Document: resolve via design-review-check, dispatch the reviewer through the returned route pinning model and passing effort, parse the PASS/CONCERNS/FAIL verdict, record evidence via design-review-complete using the resolved agent/model verbatim, and on FAIL move back to ready_for_design (findings as input) — noting loop-back evidence stripping. State that this is skipped on boards with requireDesignReview off. Add both commands to each skill's command reference.
- Update docs/ narrative (the routing/workflow doc that covers gate consultation) and the README Documentation Index if a new doc file is added.
- Update memory-bank/ only if a current-state fact changes (e.g. systemPatterns routing flags list).

## Acceptance criteria

- All four skill files describe the design-review step, verdict handling, FAIL loop-back, and the two new commands, consistent with the shipped CLI; test/skill-usage-sync.test.js passes.
- docs/ reflects the new step; README index updated if a doc file was added.
- npm run check and node --test pass.

## Non-goals

No code or config changes. No prompt authoring (sibling prompt task).

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
