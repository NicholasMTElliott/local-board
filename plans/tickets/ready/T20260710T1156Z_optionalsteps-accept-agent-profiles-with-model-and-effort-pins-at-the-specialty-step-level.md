---
id: T20260710T1156Z
type: task
status: ready_for_design
priority: P2
parent: null
children: []
blockedBy: []
blocks: [T20260710T1206Z]
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-10T11:56:26Z
updated: 2026-07-10T12:07:16Z
completedSteps: []
routingApprovals: []
---
# optionalSteps: accept agent profiles with model and effort pins at the specialty-step level

## Requirement

Agent profiles ({ route, model?, effort?, prompt? }) exist only for agents.<action> entries (T20260710T0037Z). optionalSteps[].agent still accepts a bare route string and the schema rejects anything else (src/config.js normalizeOptionalStepEntry, typeof agent !== "string" throws). Users cannot pin a model or reasoning effort for a specialty step. Concrete driver (2026-07-10 user request): route the security specialty steps to codex on gpt-5.6-sol at xhigh reasoning while the mandatory review step runs gpt-5.6-terra at high.

## Scope

1. **Schema** (src/config.js): widen optionalSteps[].agent to accept a route string (back-compat sugar) or a { route, model?, effort? } profile object, validated with the same rules as agents.<action> profiles (route grammar, model/effort shape regex, both rejected on inline). Note: optionalSteps entries already carry their own top-level prompt field — the agent profile must NOT accept prompt (reject with an actionable message pointing at the entry-level field).
2. **Scanner parity** (src/config.js codexTaskRoutedActions): recognize the object form's route when scanning for codex-task:* routes. This exact follow-up was flagged in T20260710T0035Z's Review Findings ("if a future ticket widens optionalSteps[].agent to profile objects, the scanner must be updated in the same change").
3. **specialty-run surface** (src/cli.js): return agent (route), model, and effort (null when unset) alongside the existing prompt/ticketContext, mirroring begin-step's configuredAgent/configuredModel/configuredEffort naming or documenting the divergence.
4. **Evidence composition**: specialty complete-step currently records <step-name>:<executor>. Support --model on specialty evidence the same way mandatory steps do (server-side <route>@<model> composition, codex-default wildcard, modelSatisfies pin enforcement when the specialty profile pins a model). Effort stays out of evidence tokens (same rule as T20260710T0037Z).
5. **Skill text**: SKILL.md Specialty Steps section (and skills/codex/local-board/SKILL.md counterpart) — dispatch the specialty through the returned route with the returned model/effort pins (claude-subagent: model pinned at dispatch, effort frontmatter-static today; codex-task: --model / --reasoning-effort).
6. **Docs**: docs/specialty-steps.md and docs/CodexSupport.md updated for the profile form.
7. **Tests**: schema accept/reject (string sugar, profile, prompt-in-profile rejection, inline-with-model/effort rejection), scanner object-form detection (closing the T0035Z review gap), specialty-run JSON surface, specialty evidence model composition, skill-sync green.

## Acceptance criteria

- Config accepts: { "name": "security_audit", "prompt": "...", "triggers": "...", "agent": { "route": "codex-task:read-only", "model": "gpt-5.6-sol", "effort": "xhigh" } } and specialty-run returns those pins.
- Bare-string agent entries behave byte-identically to today.
- validate warns (T0035Z detection) when an object-form optional step routes to codex-task:* and codex-task is missing.
- Specialty evidence with a pinned model enforces the pin (codex-default wildcard accepted); effort never appears in completedSteps.
- npm run check and node --test pass.

## Non-goals

- No change to gate-check's own routing (agents.gate-check already supports profiles).
- No per-dispatch effort for claude subagents (harness limitation; frontmatter remains the static lever).

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
