---
id: T20260710T1206Z
type: task
status: ready_for_design
priority: P2
parent: null
children: []
blockedBy: [T20260710T1156Z]
blocks: []
branch: local-board/T20260710T1206Z-config-scaffold-defaults-ship-gpt-5-6-pins-for-review-and-security-specialty-steps
estimate: null
estimateBasis: null
workStartedAt: 2026-07-10T13:11:07Z
workCompletedAt: null
created: 2026-07-10T12:06:56Z
updated: 2026-07-10T13:11:07Z
completedSteps: []
routingApprovals: []
---
# config: scaffold defaults ship GPT-5.6 pins for review and security specialty steps

## Requirement

User decision (2026-07-10, overriding the plan-portability caution): the init scaffold's delivered routing defaults should ship GPT-5.6 pins, matching this board's live config. New boards scaffolded by local-board init get them out of the box.

## Scope

All changes in src/config.js defaultConfigJsonc() (the init scaffold), NOT DEFAULT_CONFIG (the ENOENT/deep-merge fallback — leave that unpinned for backward compat; the guard test in test/config.test.js keeps the two defaults' structure in sync and must be updated deliberately for this intentional divergence in values):

1. Scaffold agents.review becomes { "route": "codex-task:read-only", "model": "gpt-5.6-terra", "effort": "high" }.
2. Scaffold optionalSteps design/security_threat_model and impl/security_audit entries gain agent profiles { "route": "codex-task:read-only", "model": "gpt-5.6-sol", "effort": "xhigh" } — DEPENDS on T20260710T1156Z (optionalSteps profile support); blockedBy records this.
3. Scaffold config comment text documents the pins and names the escape hatch (delete model/effort keys, or reroute, if the plan lacks GPT-5.6; codex validates server-side and the T20260710T0035Z validate warning plus the codex-task failure hint cover the missing/unsupported cases).
4. docs: docs/CodexSupport.md and docs/specialty-steps.md note the scaffolded pins and how to remove them.

## Acceptance criteria

- Fresh local-board init in a temp repo produces a config whose review profile carries gpt-5.6-terra/high and whose two security specialty entries carry gpt-5.6-sol/xhigh, and local-board validate passes on the scaffolded board.
- Boards with existing configs are untouched (init never overwrites existing config).
- DEFAULT_CONFIG fallback behavior unchanged; the defaults-sync guard test updated with an explicit allowlist for the intentional value divergence.
- npm run check and node --test pass.

## Non-goals

- No change to this repo's own plans/local-board.config.jsonc (already pinned, commit 20edd13).
- No scaffold default for the design-review step (separate ticket; it adds its own scaffold entry when it lands).
- No model-availability probing at init time (server-side validation + the existing detection warning are the guardrails).

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-10T13:11:07Z: Ensured git branch local-board/T20260710T1206Z-config-scaffold-defaults-ship-gpt-5-6-pins-for-review-and-security-specialty-steps (already-current).
