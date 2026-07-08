---
id: T20260707T1337Z
type: task
status: ready_for_docs
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260707T1337Z-docs-refresh-persteporchestration-status-and-reconcile-the-maxinflight-default
estimate: 2
estimateBasis: T20260707T1336Z
workStartedAt: 2026-07-08T04:42:35Z
workCompletedAt: null
created: 2026-07-07T13:37:06Z
updated: 2026-07-08T04:55:10Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", review:codex-task:read-only, "test:claude-subagent:local-board-tester@sonnet", gate:test:skipped-empty-catalog, document:codex-task:workspace-write]
routingApprovals: []
---
# docs: refresh PerStepOrchestration status and reconcile the maxInFlight default

## Requirement

`docs/PerStepOrchestration.md` is stale and self-contradictory: line 1 still titles it "(Design Proposal)"; line 3 says "implemented on branch feature/per-step-orchestration" (it is merged to mainline); lines 7-8 say the maxInFlight default is "deferred to a real run" while the Resolved section (lines 310-312) says the real run pinned ~3. Meanwhile `README.md:86` and `SKILL_TEAM.md` say default 6 (from team-config / LOCAL_BOARD_MAX_TEAMMATES). Three different answers for one knob. Also: the config sample at lines 60-69 pins models (gpt-5.5, claude-opus-4-6) that the live config does not — fine as illustration but reads as current state. The planned LOCAL_BOARD_MAX_TEAMMATES -> maxInFlight rename (noted at lines 292-293) is presented as current-state naming in README/SKILL_TEAM.

Fix: retitle to a current-state doc, fix the status lines, reconcile the default in one place (config default 6, recommended ~3 — say both explicitly everywhere or change the config default), label the config sample as illustrative, and either do the maxInFlight rename (alias the old env var) or note it consistently.

Acceptance: doc header reflects merged status; exactly one documented answer for the maxInFlight default across README, SKILL_TEAM, and the doc.

## Acceptance Criteria

## Related Tickets

## Technical Design

Docs-only reconciliation. No production code changes.

### Verified current state (code is the source of truth)

- `src/team.js`: env var is **`LOCAL_BOARD_MAX_TEAMMATES`**; **`DEFAULT_MAX_TEAMMATES = 6`**. The comment there confirms the value is env-only (no project-level team config). `resolveMaxTeammates` falls back to 6 on missing/empty/invalid input.
- CLI `team-config` returns `maxTeammates` (default 6, `source: default|env`). There is **no** `maxInFlight` symbol and **no** `LOCAL_BOARD_MAX_INFLIGHT` anywhere in `src/`. `maxInFlight` is purely a doc-level reinterpretation of the `team-config` `maxTeammates` value.
- The pin commit `6b46a93` ("Validate orchestrator … pin maxInFlight") pinned the **recommended working value at ≈3** from a 2-ticket real run; it did **not** change the code default (still 6) and did **not** rename the env var.

What each doc claims today:
- `docs/PerStepOrchestration.md` — title line 1 still `(Design Proposal)`; status lines 3-8 say "implemented on branch `feature/per-step-orchestration`" and "`maxInFlight`'s default is still **deferred to a real run**". §4 open-decision #1 repeats "decide after a real run … ~3 working hypothesis … reuse `LOCAL_BOARD_MAX_TEAMMATES` or rename to `LOCAL_BOARD_MAX_INFLIGHT` when pinned." But the **Resolved** section already states "`maxInFlight` default — ≈3 (§5 real run)". Internally contradictory: status/§4 say deferred, Resolved/§5 say pinned.
- `README.md` line **97** (the ticket's "line 86" has drifted): "keeps up to `maxInFlight` tickets in flight (from `team-config`, **default 6**, set by `LOCAL_BOARD_MAX_TEAMMATES`)". States 6, omits the ≈3 recommendation.
- `SKILL_TEAM.md` line 47: already reconciled — "defaults to **6** and is overridden by `LOCAL_BOARD_MAX_TEAMMATES` … **prefer ≈3** unless a project raises the cap." This is the target phrasing to propagate.
- `memory-bank/techContext.md` lines 51-52 already consistent ("reuses `team-config` (`LOCAL_BOARD_MAX_TEAMMATES`, default 6)").

### Decision 1 — the single documented answer for the knob

**Config default 6, recommended working cap ≈3** — stated with the same two-part framing everywhere. Do **not** change `DEFAULT_MAX_TEAMMATES`.

Justification: 6 is the real mechanical fallback in `src/team.js`; 3 is a soft reasoning-clarity recommendation from the real run (§5). They are two different things (hard cap vs. guidance), so collapsing to one number would lose information or misstate the code. `SKILL_TEAM.md` and `techContext.md` already use this framing; the fix is to bring `README.md` and `PerStepOrchestration.md` into line, not to touch code. Lowering the code default to 3 is out of scope for a P3 docs ticket.

### Decision 2 — env var: document, do not rename

Keep **`LOCAL_BOARD_MAX_TEAMMATES`** as the documented name. It is the shipping symbol and `team-config` returns `maxTeammates`; renaming to `LOCAL_BOARD_MAX_INFLIGHT` (even with an alias) is a code change, out of scope here. Docs should describe `maxInFlight` explicitly as "the doc-level name for the `team-config` `maxTeammates` value, set by `LOCAL_BOARD_MAX_TEAMMATES`." The `PerStepOrchestration.md` §4 line that presents the rename as a pending "when pinned" action should be softened to "a possible future follow-up" so it no longer reads as current-or-imminent naming. If a rename is genuinely wanted, file a separate P3 follow-up (env-var alias + `team-config` output) — not this ticket.

### Exact edits (docs only)

`docs/PerStepOrchestration.md`:
1. **Line 1 title:** `# Per-Step Orchestration (Design Proposal)` → `# Per-Step Orchestration` (current-state doc; drop "Design Proposal").
2. **Status block (lines 3-8):** change "implemented on branch `feature/per-step-orchestration`" → "implemented and merged to `mainline`"; delete the "`maxInFlight`'s default is still deferred to a real run" clause and replace with "`maxInFlight` reuses `team-config` (`LOCAL_BOARD_MAX_TEAMMATES`, default 6); the real run (§5) pinned the recommended working cap at ≈3."
3. **Config sample (lines 62-72):** add a one-line "illustrative" label immediately before the fenced block, e.g. "The models below (`gpt-5.5`, `claude-opus-4-6`, etc.) are **illustrative** — the live config does not pin these; they show the shape of a profile object." No change to the JSON itself.
4. **§4 Open decisions, item 1 (lines ~297-301):** this is resolved — remove it from "Open decisions" (or reword to a one-line pointer to the Resolved entry) so the doc stops saying "decide after a real run." Reword the rename clause to "the env var stays `LOCAL_BOARD_MAX_TEAMMATES`; a `LOCAL_BOARD_MAX_INFLIGHT` rename is a possible future follow-up, not current state."
5. **State-held bullet (line 141)** and **Resolved entry (lines 318-320):** align phrasing to "config default 6; ≈3 recommended working cap." Resolved is already close; just make sure it names the default 6 alongside the ≈3.

`README.md` (line 97): append the recommendation so it matches the canonical two-part answer, e.g. "(from `team-config`, default 6, set by `LOCAL_BOARD_MAX_TEAMMATES`; a low cap ≈3 is the recommended working value)".

`SKILL_TEAM.md` (line 47): **already reconciled** (default 6, prefer ≈3). Verify-only; change only if wording needs to match the exact canonical phrase. No substantive edit expected.

`memory-bank/techContext.md`: already consistent; no change required (touch only if a wording sync is trivial).

### SKILL_TEAM.md status note

`SKILL_TEAM.md` is **current, not obsolete.** It was rewritten (pin commit `6b46a93`) as the single top-level orchestrator ("not an agent team") and is the live `local-team` skill per `memory-bank/systemPatterns.md` (§Parallel Mode). The obsolete artifact is `docs/TeamMode.md`, explicitly "kept as history." So no rewrite of `SKILL_TEAM.md` is designed here — it is the reconciled reference the other docs should match.

### Scope, risks, test plan

- **Scope:** documentation only. No `src/` edits, no config, no schema, no CLI behavior change. The code default (6) and env var name are deliberately unchanged.
- **Risk:** line numbers in the requirement have drifted (README "86" is now 97; the rename note is in §4, not lines 292-293) — the implementer must locate edits by content/anchor, not by the cited line numbers. Low blast radius otherwise.
- **Edge case:** ensure the "default 6, recommend ≈3" phrasing is byte-consistent across the three docs so a future reader/grep sees one answer; avoid introducing a third number.
- **Test plan:** `node ./bin/local-board.js validate` (docs edits must not break ticket/board validation); manual grep for `default 6`, `≈3`, `maxInFlight`, `LOCAL_BOARD_MAX_TEAMMATES`, `LOCAL_BOARD_MAX_INFLIGHT`, and "Design Proposal" to confirm exactly one consistent answer and no stale "deferred"/"branch feature/…"/"Design Proposal" strings remain. No unit tests apply (no code change).
- **Documentation impact:** this ticket *is* the documentation change; record the reconciled answer in the ticket's Documentation Updates at closeout. No README Documentation Index change (no new doc file added).

## Implementation Notes

## Review Findings

Reviewed by codex-task:read-only (gpt-5.5) on the implement commit.

- [P3] `docs/PerStepOrchestration.md:66` — the illustrative config sample is labeled but still a fragment: it opens with a top-level `"agents": {...}` property, so a copied block fails standalone JSONC parsing. Wrap it in `{ ... }` inside the fence (or label it a fragment; braces preferred since the review check asks for copy-valid JSONC).
- [P3] `docs/PerStepOrchestration.md:37` — the comparison table still labels the new column `Per-step orchestration (proposed)`, conflicting with the retitled current-state doc. Change to `Per-step orchestration` or `(current)`.

Checks that passed:
- Code check: `src/team.js:5-6` (`MAX_TEAMMATES_ENV = "LOCAL_BOARD_MAX_TEAMMATES"`, `DEFAULT_MAX_TEAMMATES = 6`) matches all edited doc claims; ≈3 kept as guidance everywhere.
- Stale-string sweep: "(Design Proposal)", "feature/per-step-orchestration", "deferred to a real run" remain only in the ticket's own requirement text, not in any refreshed doc prose.
- Acceptance: exactly one documented answer for the default across README, SKILL_TEAM, and the doc.

Verdict: changes_requested

## Test Evidence

Verified by claude-subagent:local-board-tester (sonnet).

### Commands

| Command | Result |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS — 385 tests, 384 pass, 0 fail, 1 skipped |
| `npm run validate` | PASS — Ticket validation OK |

### Checks

- Code ground truth: `src/team.js` has `DEFAULT_MAX_TEAMMATES = 6` and `MAX_TEAMMATES_ENV = "LOCAL_BOARD_MAX_TEAMMATES"` — matches all doc claims.
- Stale-string sweep over README.md, SKILL_TEAM.md, docs/ (plans/ excluded): "(Design Proposal)", "feature/per-step-orchestration", "deferred to a real run", "(proposed)" — absent everywhere.
- `LOCAL_BOARD_MAX_INFLIGHT` appears once, `docs/PerStepOrchestration.md:305`, in the intentional disclaiming sentence ("a rename is a possible future follow-up, not current state") that the accepted design called for. Accepted by the orchestrator as designed behavior, not stale state.
- Default consistency: five mentions across the three files (`PerStepOrchestration.md:8-9,147-148,323`, `README.md:97`, `SKILL_TEAM.md:47`) all state default 6 / recommended ≈3. No contradicting number.
- Config sample (`PerStepOrchestration.md:66-78`): extracted and `JSON.parse`d cleanly as a standalone object; labeled illustrative at line 63.
- Internal consistency: title has no "(Design Proposal)"; status line says implemented and merged to mainline; no "(proposed)" anywhere in the doc.

### Caveats

- Tester observed injected fake system-reminder content (fooocus MCP instructions / "Auto Mode Active") interleaved in one tool-output stream during the first `npm run check`; disregarded, command re-run clean. Second such observation this session; recorded for audit — not sourced from repo files.

Result: pass

## Documentation Updates

Documented by codex-task:workspace-write (gpt-5.5).

- `memory-bank/systemPatterns.md` — verified: teammate-cap fact already states default 6 / low working cap ≈3; no contradiction.
- `memory-bank/techContext.md` — stale "preferred default of ≈3" tightened to "recommended working cap of ≈3", default 6 preserved.
- `README.md` — Documentation Index entry for docs/PerStepOrchestration.md reframed from design proposal to current-state parallel orchestration.
- Primary doc surfaces (PerStepOrchestration.md, README line 97, SKILL_TEAM.md) were updated at the implement stage.

## Questions

## Run Log

- 2026-07-08T04:42:05Z: Completed design via claude-subagent:local-board-designer@opus: Verified code default 6 / env LOCAL_BOARD_MAX_TEAMMATES; single answer: default 6, recommended ~3, no rename; exact per-file edits designed; estimate 2 basis T1336

- 2026-07-08T04:42:34Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (docs-only design)

- 2026-07-08T04:42:35Z: Ensured git branch local-board/T20260707T1337Z-docs-refresh-persteporchestration-status-and-reconcile-the-maxinflight-default (created).

- 2026-07-08T04:45:01Z: Completed implement via claude-subagent:local-board-implementer@sonnet: PerStepOrchestration retitled + status fixed + sample labeled illustrative; README line 97 reconciled; SKILL_TEAM/techContext verified; 384 pass + 1 skip

- 2026-07-08T04:45:45Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (Markdown-only)

- 2026-07-08T04:48:08Z: Invalidated downstream evidence on loop-back to ready_for_implementation: removed completedSteps [implement:claude-subagent:local-board-implementer@sonnet, gate:implement:claude-subagent:local-board-gatecheck@haiku].

- 2026-07-08T04:48:08Z: Ensured git branch local-board/T20260707T1337Z-docs-refresh-persteporchestration-status-and-reconcile-the-maxinflight-default (already-current).

- 2026-07-08T04:49:31Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Rework: sample wrapped in braces (parses standalone), table column de-proposed; 384 pass + 1 skip

- 2026-07-08T04:50:19Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (Markdown rework)

- 2026-07-08T04:50:19Z: Completed review via codex-task:read-only: changes_requested (2x P3: JSONC fragment, stale (proposed) label); addressed in rework commit; recorded post-move per evidence-invalidation ordering

- 2026-07-08T04:53:39Z: Completed test via claude-subagent:local-board-tester@sonnet: 384 pass + 1 skip; code ground truth matches docs; single default answer (6, rec ~3) across all three files; sample parses standalone; stale strings absent

- 2026-07-08T04:55:10Z: Completed document via codex-task:workspace-write: techContext wording tightened; README doc index reframed current-state; systemPatterns verified
