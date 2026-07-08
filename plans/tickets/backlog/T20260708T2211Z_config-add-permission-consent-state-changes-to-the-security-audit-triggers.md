---
id: T20260708T2211Z
type: task
status: backlog
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-08T22:10:44Z
updated: 2026-07-08T22:11:52Z
completedSteps: []
routingApprovals: []
---
# config: add permission/consent state changes to the security_audit triggers

## Requirement

The `security_audit` specialty-step triggers ("Changes to auth code, input validation, external API calls, credential handling") are miscalibrated, demonstrated in production: the gate requested an audit for T20260708T2015Z's marker-flag parsing (harmless CLI string validation) but NOT for B20260708T0459Z (mutating `~/.claude/settings.json` permission grants — the most consent-sensitive surface in the project). "Input validation" over-matches on benign flag parsing; permission/consent state management is not in the trigger text at all.

Fix: reword the `security_audit` triggers in the specialty catalog (plans/local-board.config.jsonc, and the scaffold defaults in resources/ so new boards inherit it) to add "changes to permission grants, consent state, or settings files that gate tool execution (e.g. Claude settings.json allow rules, hooks entries)" and narrow the input-validation trigger to "validation of untrusted external input (network, file uploads, cross-trust-boundary data) — not internal CLI flag parsing".

## Acceptance Criteria

- Repo board catalog and the scaffold/resources default both carry the reworded triggers.
- The gate-check prompt/catalog wording change only — no gate-check machinery changes.
- resources drift test stays green (mirror updated in lockstep).
- A short note in docs (wherever the specialty catalog is documented) explains the trigger philosophy: match on consequence surface (what the change can grant or leak), not on technique keywords.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
