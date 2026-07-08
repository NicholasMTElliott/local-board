---
id: T20260707T1340Z
type: task
status: done
priority: P4
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260707T1340Z-docs-document-the-orchestrator-authored-evidence-limitation-in-security-md-and-systempatterns
estimate: 1
estimateBasis: T20260707T1338Z
workStartedAt: 2026-07-08T11:53:31Z
workCompletedAt: 2026-07-08T12:02:11Z
created: 2026-07-07T13:40:06Z
updated: 2026-07-08T12:02:11Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", review:codex-task:read-only, "test:claude-subagent:local-board-tester@sonnet", gate:test:skipped-empty-catalog, document:codex-task:workspace-write]
routingApprovals: []
---
# docs: document the orchestrator-authored evidence limitation in SECURITY.md and systemPatterns

## Requirement

Return-only section content (Review Findings, Test Evidence) is persisted by the orchestrator via `section --file`, so even with dispatch verification (T20260707T1325Z/T20260707T1326Z), the orchestrator could substitute or summarize a subagent's findings undetectably. This is inherent to the return-only architecture and should be acknowledged as a known limitation rather than silently trusted.

Fix: document the limitation and its rationale in `SECURITY.md` (threat model section) and `memory-bank/systemPatterns.md` (Safety Pattern section), noting that the dispatch ledger narrows but does not close it, and that the mitigation is human review of ticket diffs.

Acceptance: both documents state the limitation explicitly.

## Acceptance Criteria

## Related Tickets

## Technical Design

Docs-only change. Two files, two focused edits. No production, CLI, or test code changes. The goal is to name an inherent trust limitation and its mitigation in the two places that already hold the trust model, cross-linking the dispatch-ledger facts that partially address it.

### The limitation

Return-only subagents (reviewer, tester, gatecheck, decomposer, and any `codex-task:read-only` route) have no Write or Edit tool. They return their section content (Review Findings, Test Evidence) or JSON as Markdown in their final message. The orchestrator then writes that text to a temp file with its own Write tool and persists it via `section --file`. The orchestrator is therefore a trusted-but-unobserved intermediary between the subagent and the ticket file: it can substitute, summarize, soften, truncate, or fabricate a subagent's findings before writing them, and nothing in the current architecture detects the divergence.

### Why it is inherent, not a bug

The return-only contract exists on purpose. These agents are denied Write/Edit because a subagent told to author its own file falls back to Bash redirection (`echo`, heredoc, `Set-Content`), which corrupts backticks and code fences. So the evidence *must* pass through the orchestrator's context to reach the ticket. There is no direct, signed channel from a return-only subagent to the ticket Markdown. Closing the gap fully would require either giving every subagent a safe self-write path (the escaping problem the contract was designed to avoid) or a content-integrity channel the harness does not provide. This is an architectural property of return-only delegation, so it is documented as a known limitation rather than treated as a defect to be fixed.

### What the dispatch ledger does and does not cover

The dispatch-verification machinery — `.local-board/active-steps.json`, `check-dispatch`, and the opt-in Claude Code hooks from `T20260707T1325Z`/`T20260707T1326Z` (`routing-validator`, `dispatch-ledger`, `evidence-gate`, `approve-inline-consent`) — narrows this gap but does not close it:

- Covered: whether a dispatch of the claimed route/model actually happened. `begin-step` stamps the resolved action/route/model; `evidence-gate` refuses a `complete-step` claiming a `claude-subagent:*` executor unless a matching `(session_id, ticketId, subagent_type)` dispatch is in the ledger. This defeats the "no subagent was dispatched at all" spoof.
- Not covered: whether the *content* the orchestrator writes matches what the subagent returned. The ledgers record that a dispatch occurred and its route/model — not the returned payload. An orchestrator that genuinely dispatched a real reviewer can still write findings that differ from what the reviewer produced, and every ledger check passes. Hooks also fail open and are Claude-only, so they are a backstop, not a guarantee.

### The mitigation

Human review of ticket diffs is the control. All persisted section content lands in the ticket Markdown and in git history, so a maintainer reviewing the ticket diff (the same discipline as reviewing a pull request) is what actually validates that the recorded evidence is faithful. This is consistent with the existing SECURITY.md guidance to "treat agent-proposed changes as untrusted until reviewed." The designer is a partial exception to the return-only pattern — it self-writes its `Technical Design` section via a scoped Write tool and returns only a terse summary — but its output is likewise a ticket diff subject to the same human review.

### Placements (exact anchors)

1. `SECURITY.md`, under the existing `## Security Model` section. Add a short labeled subsection `### Orchestrator-authored evidence` placed after the "Use local-board only against repositories and workflows you control and review..." paragraph and before the closing "local-board does not store credentials..." paragraph. Content: two to three sentences stating the limitation, that the dispatch ledger narrows but does not close it, and that the mitigation is human review of ticket diffs. Keep the small-project tone; do not restate the full ledger mechanics — reference them.

2. `memory-bank/systemPatterns.md`, at the end of the `## Safety Pattern` section (after the `worktrees.guardWrongRoot` paragraph). Add one terse paragraph in Memory Bank style: return-only evidence (Review Findings, Test Evidence) is orchestrator-persisted via `section --file`, so the orchestrator can alter a subagent's returned content undetectably; the dispatch ledger (`.local-board/active-steps.json`, `check-dispatch`, opt-in hooks) proves a dispatch happened but not that the written content matches the return; mitigation is human review of ticket diffs. Cross-reference the existing "Return-only subagents" paragraph in `## Delegation and Subagent Tools` and the coarse-grant risk in `## Subagent CLI Permission` so the three facts read as one trust model.

### Scope and non-goals

- Docs only: `SECURITY.md` and `memory-bank/systemPatterns.md`. No changes to `src/`, `bin/`, prompts, config, or tests.
- Do not invent new enforcement. This ticket documents an accepted limitation; it does not add a content-integrity mechanism.
- Do not duplicate the ledger mechanics already in `docs/EnforcementHooks.md` and systemPatterns; link/reference them instead of restating.

### Risks and edge cases

- Tone/length drift: SECURITY.md is deliberately short. Risk is over-explaining. Keep the subsection tight and reference the ledger rather than re-deriving it.
- Consistency: use the same "untrusted until reviewed" framing already in SECURITY.md so the two documents do not present conflicting trust postures.
- Memory Bank rule ("terse, current-state, no history"): the systemPatterns paragraph must be a current-state fact, not a changelog entry; do not reference ticket IDs there (SECURITY.md may reference the hooks work narratively, but systemPatterns stays fact-only).

### Test plan

No automated tests (docs only). Verification is manual:

- `SECURITY.md` `## Security Model` explicitly states the orchestrator-authored-evidence limitation and the human-diff-review mitigation.
- `memory-bank/systemPatterns.md` `## Safety Pattern` states the same limitation in Memory Bank style with the ledger cross-references.
- Both statements agree that the dispatch ledger narrows but does not close the gap.
- `git diff` touches only the two target files.

### Documentation impact

This *is* the documentation change. No README Documentation Index update is needed (no new `docs/*.md` file). `docs/EnforcementHooks.md` "Known Limits" covers hook blind spots but not orchestrator content substitution; a one-line pointer there is optional and out of scope for this ticket's acceptance.

## Implementation Notes

## Review Findings

Reviewed by codex-task:read-only (gpt-5.5). No findings. Both documents explicitly state the return-only evidence limitation; wording verified against the actual ledger (src/active-steps.js) and hook behavior — ledger proves dispatch, not content fidelity. Placement, cross-references, tone, and Memory Bank rules all correct. Verdict: pass

## Test Evidence

Verified by claude-subagent:local-board-tester (sonnet).

| Check | Result |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS — 385 tests, 384 pass, 0 fail, 1 skipped |
| `npm run validate` | PASS — Ticket validation OK |

- `SECURITY.md:32-34` — `### Orchestrator-authored evidence` inside `## Security Model`; all required substance present (return-only workers, section --file persistence, undetectable substitution, ledger/hooks prove dispatch not content fidelity, inherent to architecture, mitigation = review ticket diffs like a PR).
- `memory-bank/systemPatterns.md:200` — one paragraph at the end of `## Safety Pattern`; same substance; cross-referenced headings (`## Delegation and Subagent Tools`, `## Subagent CLI Permission`) exist verbatim (lines 142, 183); no ticket IDs or history language.
- Accuracy spot-check: no hook in hooks/ compares persisted section content against a worker return — `evidence-gate.js:152-159` matches ledger entries on ticketId + subagent_type + session_id only. The "proves dispatch, not content fidelity" claim holds.

No gaps or flakes.

Result: pass

## Documentation Updates

Documented by codex-task:workspace-write (gpt-5.5). Closing audit: docs/EnforcementHooks.md softened (hooks verify observed dispatch matching, not evidence authenticity) with a pointer to SECURITY.md's Orchestrator-authored evidence limitation. No other doc overclaims; primary additions (SECURITY.md, systemPatterns) shipped at implement.

## Questions

## Run Log

- 2026-07-08T11:53:01Z: Completed design via claude-subagent:local-board-designer@opus: SECURITY.md Security Model subsection + systemPatterns Safety Pattern paragraph; ledger proves dispatch not content; human diff review mitigation; estimate 1 basis T1338

- 2026-07-08T11:53:30Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (docs-only; documenting a limitation, not changing auth code)

- 2026-07-08T11:53:31Z: Ensured git branch local-board/T20260707T1340Z-docs-document-the-orchestrator-authored-evidence-limitation-in-security-md-and-systempatterns (created).

- 2026-07-08T11:55:25Z: Completed implement via claude-subagent:local-board-implementer@sonnet: SECURITY.md Security Model subsection + systemPatterns Safety Pattern paragraph; ledger-narrows-not-closes + human diff review; 384 pass + 1 skip

- 2026-07-08T11:56:16Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (Markdown-only)

- 2026-07-08T11:58:06Z: Completed review via codex-task:read-only: pass, no findings; recorded post-move per evidence-invalidation ordering

- 2026-07-08T12:00:10Z: Completed test via claude-subagent:local-board-tester@sonnet: 384 pass + 1 skip; both docs state limitation with required substance; hook spot-check confirms ledger proves dispatch not content

- 2026-07-08T12:02:11Z: Completed document via codex-task:workspace-write: EnforcementHooks.md overclaim softened + SECURITY.md pointer; other docs clean
