---
id: S20260710T1206Z
type: story
status: ready_for_decomposition
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
created: 2026-07-10T12:06:56Z
updated: 2026-07-10T12:07:33Z
completedSteps: []
routingApprovals: []
---
# design-review step: codex reviews the technical design before implementation

## Requirement

New pipeline step: design review. Claude (opus designer) writes the Technical Design as today; then, before the ticket can advance to implementation, a design reviewer routed to codex (default pin gpt-5.6-sol @ xhigh reasoning) inspects the design for flaws, contradictions, missing elements, unstated assumptions, and gaps against the Requirement's acceptance criteria. Rationale: catch design-level defects while they cost a re-design, not a loop-back from review/test (yesterday's T20260710T0037Z loop-back was implementation-cheap; design-level misses are not).

## Goal behavior

1. After design evidence is recorded (complete-step design) and before ready_for_implementation is reachable, a design-review step runs through its configured route. Default routing profile: { "route": "codex-task:read-only", "model": "gpt-5.6-sol", "effort": "xhigh" } (agents profiles already support model+effort since T20260710T0037Z — no schema dependency).
2. The reviewer is return-only (read-only route): it returns a verdict (PASS / CONCERNS / FAIL) plus findings; the orchestrator persists a "Design Review" ticket section and records completion evidence.
3. PASS (or CONCERNS with no blocking findings, per orchestrator judgment) unblocks the move toward implementation; FAIL loops the ticket back through design with findings as input. Loop-back evidence stripping must behave consistently with invalidateOnLoopBack.
4. Enforcement: skipping design review on a board that configures it must be refused the same way gate consultation is (hard precondition, not advisory prose).

## Mechanism (designer decides; requirement constrains, does not prescribe)

Candidate shapes, with tradeoffs the Technical Design must weigh:
- (a) Full pipeline stage: new status pair (e.g. ready_for_design_review) + action + statusActions/pipelineOrder/transitions/doneRequires/folder entries. Most explicit; touches the status enum, folder mapping, and every transition map; existing boards' configs must keep validating (additive status must not break older transition maps).
- (b) Stage-scoped required step: a requireDesignReview-style precondition on the design->implementation transition (pattern: requireGateConsultation), with the step executed like a specialty (prompt file + routed dispatch + completedSteps token design-review:<executor>@<model>).
- The design must state why the chosen shape wins, cover config schema, scaffold defaults (default OFF or ON — recommend scaffold ON per user direction, existing boards opt in), prompt file (plans/prompts/steps/design_review.md with a review rubric: flaws, missing elements, acceptance-criteria coverage, testability, unstated assumptions), CLI surface, evidence composition (model pin enforcement, effort excluded), skill-text updates for both the single-ticket and local-team flows, docs, and tests.

## Acceptance criteria

- A board configuring design review cannot move a designed ticket to ready_for_implementation without recorded design-review evidence (hard refusal naming the missing step).
- begin-step (or the step's resolution command) returns the design-review route/model/effort pins; evidence enforces the model pin (codex-default wildcard applies), effort never enters evidence.
- FAIL verdict path loops back to design and re-running design + design review produces fresh evidence (stale tokens stripped consistently).
- Boards that do not configure design review behave byte-identically to today.
- Scaffolded prompt file ships with the packaged prompt tree (resources sync) and init restores it when missing.
- npm run check and node --test pass.

## Non-goals

- No parallel/second reviewer, no human-approval gate (codex verdict + orchestrator judgment only).
- No change to the mandatory code-review step.
- No per-dispatch effort for claude-subagent routes (harness limitation stands; the default route here is codex).

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-10T12:07:33Z: Transition override: ready_for_design -> ready_for_decomposition: authoring correction: story was created with the wrong initial ready status; stories enter at decomposition
