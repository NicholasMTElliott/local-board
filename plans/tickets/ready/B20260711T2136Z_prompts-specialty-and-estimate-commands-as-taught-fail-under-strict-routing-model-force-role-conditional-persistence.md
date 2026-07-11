---
id: B20260711T2136Z
type: bug
status: ready_for_design
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
created: 2026-07-11T21:36:09Z
updated: 2026-07-11T21:36:19Z
completedSteps: []
routingApprovals: []
---
# prompts: specialty and estimate commands as taught fail under strict routing (--model, --force, role-conditional persistence)

## Requirement

From the prompt-library review of 2026-07-11 (items 1, 4, 5): three places where a prompt teaches a command that fails as written.

1. All five optional-step specialty prompts (optional-steps/design/security_threat_model.md L50, design/ui_component_review.md L48, design/ux_interaction_review.md L48, impl/security_audit.md L49, impl/ui_visual_review.md L49) show a Recording command without --model: `complete-step <id> <step> --executor <executor> --evidence "..."`. security_threat_model and security_audit pin gpt-5.6-sol, so strict routing rejects the exact command taught. (Observed workaround this run: security_audit resolved to inline so the gap did not bite, but any model-pinned specialty route hits it.)
2. steps/estimate.md step 6 never mentions --force: the estimate field survives design loop-backs, so every re-design's estimate call fails as written. Add: re-run with --force and update --basis when an estimate already exists.
3. steps/estimate.md has no role-conditional persistence branch: when design routes to a return-only executor (codex-task:read-only), "Run local-board estimate" contradicts the return-only contract. Add the branch decompose.md already models: return points + basis + rationale for the orchestrator to record on return-only routes; run the command yourself on writable routes.

### Scope

1. Fix the Recording line in all five specialty prompts: `--executor <executor> --model <model> --evidence "<VERDICT>: <short summary>"` plus "(omit --model when specialty-run returned a null model)".
2. Add the --force re-estimation sentence and the role-conditional persistence note to steps/estimate.md. PRESERVE the pinned content-assertion substrings in test/cli.test.js: `local-board calibration suggest` and `local-board estimate` (additive edits only).
3. npm run sync-resources (all six files live under plans/prompts). Full node --test per AGENTS.md.
4. Optional (design decides): new content assertions pinning the corrected --model form.

### Acceptance criteria

- Every taught specialty Recording command passes strict routing verbatim for a model-pinned specialty profile.
- estimate.md covers the loop-back re-estimate and the return-only route; existing pinned substrings intact.
- npm run check and node --test pass; resources mirror synced.

### Non-goals

- No CLI behavior changes; no changes to specialty verdict JSON contracts.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
