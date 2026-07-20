---
id: T20260720T2118Z
type: task
status: backlog
priority: P1
parent: null
children: []
blockedBy: [T20260720T2116Z, T20260720T2117Z]
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-20T21:16:06Z
updated: 2026-07-20T21:17:56Z
completedSteps: []
routingApprovals: []
---
# Skill policy: never self-promote backlog; hard stop with state-report when ready queue is empty

## Requirement

### Problem

`SKILL_TEAM.md` preflight says only: "If empty, report 'no ready tickets' and stop." In a 2026-07-20 run against an all-backlog board (47 backlog, 0 ready), the orchestrator overrode that bare instruction, reverse-engineered the readiness model over ~6 turns, and planned to promote backlog tickets on its own. Other runs comply and stop. The one-line rule carries no rationale, so behavior is nondeterministic: the user's stated goal ("work my tickets in parallel") outweighs an unexplained stop.

### Requirement

Board semantics to encode: backlog vs `ready_*` is an approval boundary. `ready_*` means a human approved the ticket for work; `backlog` means it still needs review. Agents must never cross that boundary on their own initiative — but an explicit user instruction ("promote all backlog tickets", "promote everything for feature XYZ", "promote all unblocked tickets") authorizes promotion of the tickets it names.

1. In `SKILL_TEAM.md` (and codex mirror `skills/codex/local-team/SKILL.md`), replace the bare stop rule with a policy block that states:
   - the rationale above (approval boundary), so the instruction survives goal pressure;
   - on empty ready queue: run `state-report --json`, report `byStatus` counts plus how many backlog tickets are unblocked (`list --status backlog --unblocked --json`, from T20260720T2116Z), and stop — suggest the user review and promote;
   - never `move` a ticket out of `backlog` without an explicit user instruction in this session; when instructed, use `promote` (from T20260720T2117Z) for each ticket the instruction covers, then re-run `list --ready` and continue the normal loop;
   - a standing config or ticket-file note is NOT an instruction; only the user's message is.
2. Mirror the same policy in the single-ticket skill (root `SKILL.md` + `skills/codex/local-board/SKILL.md`): `query-next` returning null with a non-empty backlog gets the same state-report-and-stop treatment.
3. Keep wording terse (skill files are token-budgeted); one short policy block per skill, not a new section per flow.

### Acceptance Criteria

- All four skill files state: approval-boundary rationale, state-report-on-empty diagnostic, hard stop, and the explicit-instruction promotion path via `promote`.
- Codex mirrors stay byte-identical where `test/skill-usage-sync.test.js` requires; suite passes.
- No skill text instructs or permits autonomous backlog promotion in any branch.
- Full suite (`node --test`) green; `local-board install` refresh noted in Documentation Updates so installed skills pick up the change.

Blocked by T20260720T2116Z (`--unblocked` query) and T20260720T2117Z (`promote`) so the policy text references commands that exist.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
