---
id: T20260707T1332Z
type: task
status: ready_for_design
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T13:32:54Z
updated: 2026-07-07T13:23:41Z
completedSteps: []
routingApprovals: []
---
# cli: fix the begin-step before start-work ordering footgun

## Requirement

Two skills devote paragraphs to a CLI-created footgun: `start-work` moves `ready_for_implementation -> implementing`, and `implementing` has no `statusActions` entry, so a later `begin-step` fails with "no configured action". Skills must warn to run `begin-step` before `start-work` for the implement step (`SKILL.md:110-118`, `SKILL_TEAM.md:110-113`, codex skill equivalent).

Fix in the CLI so the prose warnings can be deleted: map active statuses to their stage action in `statusActions` resolution (`implementing -> implement`, and likewise `designing`/`reviewing`/`testing` if affected), or have `start-work` return the resolved step profile itself.

Acceptance: `begin-step` succeeds regardless of ordering around `start-work`; the ordering warnings are removed from all skill texts.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
