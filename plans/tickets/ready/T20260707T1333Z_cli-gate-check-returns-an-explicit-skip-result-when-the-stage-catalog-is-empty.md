---
id: T20260707T1333Z
type: task
status: ready_for_docs
priority: P3
parent: null
children: []
blockedBy: [T20260707T1327Z]
blocks: []
branch: local-board/T20260707T1333Z-cli-gate-check-returns-an-explicit-skip-result-when-the-stage-catalog-is-empty
estimate: 2
estimateBasis: T20260707T1329Z
workStartedAt: 2026-07-08T02:48:14Z
workCompletedAt: null
created: 2026-07-07T13:33:55Z
updated: 2026-07-08T03:04:43Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", "test:claude-subagent:local-board-tester@sonnet", gate:test:skipped-empty-catalog, document:codex-task:workspace-write]
routingApprovals: []
---
# cli: gate-check returns an explicit skip result when the stage catalog is empty

## Requirement

When a stage's specialty catalog is empty, skipping the gate-agent dispatch is legitimate — but only two of the three skill texts say so (`SKILL_TEAM.md:124-126`, codex skill; `SKILL.md:147-163` does not), so single-ticket Claude runs waste a haiku dispatch on projects with no catalog, and behavior differs by skill.

Fix: make it deterministic — `gate-check` returns `{ "skip": true, "requestedSteps": [] }` (or similar) when the catalog for the stage is empty, and all skills say "dispatch the gate agent only when skip is false". Coordinate with T20260707T1327Z so an empty-catalog skip still records the consultation token.

Acceptance: empty-catalog gate-checks require no agent dispatch in any skill; the skip is visible in gate-check JSON output; skill texts are aligned.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Scope check (do this first)

This ticket predates `T20260707T1327Z`, which already landed the empty-catalog
auto-stamp. Re-reading the current code, that work is done and part of this
ticket's ask (c) is satisfied:

- `commandGateCheck` (`src/cli.js:962-970`) already branches on
  `catalog.length`: non-empty asserts the prompt exists; empty calls
  `recordGateSkippedEmptyCatalog(root, ticket.id, stage)`, which deterministically
  stamps `gate:<stage>:skipped-empty-catalog` in `completedSteps`
  (`src/tickets.js:1093-1100`), idempotently, dispatching no agent.
- All three skill families already tell the orchestrator to skip dispatch on an
  empty catalog and describe the auto-stamp:
  - `SKILL.md:168-171` ("empty `requestedSteps` … skip"; "on an **empty** stage
    catalog it auto-stamps `gate:<stage>:skipped-empty-catalog` … dispatches no
    agent").
  - `SKILL_TEAM.md:125-128` ("When `gate-check` returns an empty `catalog`, skip
    the gate-agent dispatch entirely").
  - `skills/codex/local-board/SKILL.md:137,155` ("If the catalog is empty, skip
    dispatch"; auto-records `gate:<stage>:skipped-empty-catalog`).

**What remains (the requirement's ask (a), and a touch of (b)):** the gate-check
JSON payload does **not** carry any explicit skip indicator. Today the empty
branch is inferred only from `catalog: []` (`src/cli.js:987-996`). The requirement
asks for an explicit `{ skip: true, … }` result and for the skills to key off that
flag. The skills currently key off `catalog` (semantically equivalent, but not the
explicit signal the ticket wants). So this is a **small** ticket: add the
response field(s), echo the recorded token, add a human-mode line, and do a light
skill-wording alignment. Ask (c) needs nothing.

## Approach

Make the empty-catalog skip an explicit, machine-checkable field in the
`gate-check` result rather than an inference from `catalog.length`.

In `commandGateCheck` (`src/cli.js`), compute the branch once and thread it into
the payload:

- Add `skip` (boolean) to the JSON `payload`: `true` on the empty-catalog branch,
  `false` on the non-empty branch.
- On the empty branch, echo the token the CLI just recorded as
  `recorded: "gate:<stage>:skipped-empty-catalog"`; on the non-empty branch set
  `recorded: null`. Prefer sourcing the string from the return value of
  `recordGateSkippedEmptyCatalog` rather than re-deriving it — that function
  already builds the token via `gateToken(stage, GATE_SKIPPED_EMPTY_CATALOG_EXECUTOR)`.
  If it does not currently return the token, extend its return object with
  `token` (additive) and use it here, so the wire string has a single producer
  and cannot drift from what was stamped.
- Non-JSON mode: when `skip` is true, print one extra human line, e.g.
  `skip: empty catalog — recorded gate:<stage>:skipped-empty-catalog (no dispatch)`.
  Keep the existing first line (`gate-check … catalog=0`) unchanged so current
  output is a superset.

Keep `catalog` in the payload unchanged; `skip` is a derived convenience, not a
replacement. Do not add `requestedSteps: []` to the CLI payload — `requestedSteps`
is the *gate agent's* response contract, not the CLI's, and the CLI never
classifies. Adding it here would blur the two contracts. The explicit `skip`
flag is the CLI-side signal the orchestrator needs.

Skill sweep (ask b): update the three skill texts so the empty-catalog rule reads
off the flag — "dispatch the gate agent only when `skip` is `false`" — while
retaining the existing auto-stamp sentence. This is a one-line clarification per
skill, not a rewrite:

- `SKILL.md` (~168-171)
- `SKILL_TEAM.md` (~125-128)
- `skills/codex/local-board/SKILL.md` (~137,155)

## Affected files

- `src/cli.js` — `commandGateCheck`: add `skip` + `recorded` to `payload`; add the
  human-mode skip line.
- `src/tickets.js` — `recordGateSkippedEmptyCatalog`: return the `token` string
  (additive) so `cli.js` echoes the exact stamped value. (Skip if the design
  reviewer prefers re-deriving via `gateToken`; single-producer is cleaner.)
- `SKILL.md`, `SKILL_TEAM.md`, `skills/codex/local-board/SKILL.md` — align the
  empty-catalog rule to the `skip` flag.
- `test/cli.test.js` — extend the two existing gate-check branch tests.
- Possibly `skills/` mirror/pack sync — confirm no generated copy of the skill
  text needs regeneration (see risks).

## Back-compat

Purely additive. `skip`/`recorded` are new keys; every existing consumer that
reads `catalog`, `prompt`, `agent`, etc. is unaffected. The non-JSON first line is
unchanged; the skip line is additive. No behavior change on the wire beyond new
fields — the auto-stamp side effect already exists.

## Test strategy

Extend the existing, already-passing tests rather than adding parallel ones:

- **Empty branch** (build on `test/cli.test.js:783` "auto-stamps … skipped-empty-catalog"
  and `:703-707`/`:720-747`): assert `out.skip === true` and
  `out.recorded === "gate:test:skipped-empty-catalog"` (or the design stage used),
  alongside the existing `catalog: []` and stamp assertions.
- **Non-empty branch** (build on `:808` "does not stamp … pure read" and
  `:646-716`): assert `out.skip === false` and `out.recorded === null`, and that
  no gate token was stamped (existing assertion).
- **Idempotent re-run** (`:802-804`): assert the second invocation still reports
  `skip: true` and the same `recorded` token.
- **Non-JSON mode**: assert the skip line appears on the empty branch and is absent
  on the non-empty branch (extends the plain-output assertion at `:712-716`).

Run `node --test` for the suite.

## Risks / edge cases

- **Token drift.** If the echoed `recorded` string is re-derived in `cli.js`
  instead of sourced from `recordGateSkippedEmptyCatalog`, the wire value could
  silently diverge from the stamped value in a future refactor. Mitigate by
  returning the token from the recorder (single producer) and asserting equality
  in tests.
- **Skill/pack mirror.** Confirm whether any bundled/packed copy of the skill
  markdown is generated from these sources (check `test/pack.test.js` /
  `test/resources-sync.test.js`); if so, regenerate or the sync test fails. Light
  check, likely no-op, but must be verified before closeout.
- **Semantic overlap.** `skip` must be strictly `catalog.length === 0`; do not let
  it encode anything else (e.g. an agent's empty `requestedSteps`). Keeping the CLI
  flag = "no catalog to consult" preserves the clean split from the gate agent's
  response contract.
- Low blast radius overall: one command, additive fields, no status-machine or
  routing changes.

## Open questions

None blocking. One judgment call for the implementer, defaulted above: echo the
token via the recorder's return value (preferred) vs. re-derive in `cli.js`.

## Implementation Notes

--json

- 2026-07-08: Rework — rewrote `skills/codex/local-board/SKILL.md:137` as two explicit branches (skip false → dispatch; skip true → no dispatch, token already recorded), resolving the contradiction; `npm run check`/`npm test` (364 pass, 1 skip)/`npm run validate` all green, no count changes.

## Review Findings

- 2026-07-08T02:55:16Z: Review (codex): one fix — the codex skill's updated sentence says dispatch only when skip is false, then 'Otherwise dispatch...' (the otherwise branch IS skip:true); rewrite as two explicit branches. CLI shapes, idempotent echo, guard ordering, and the other two skills verified.

- 2026-07-08T02:57:14Z: Final disposition: the single sentence fixed verbatim per the review; all behavior had already been verified. Treating review as complete per the established pattern.

## Test Evidence

Tested by claude-subagent:local-board-tester (sonnet) on branch local-board/T20260707T1333Z-..., commits 0a64a98 + 179e862.

**Suite:** `npm run check` pass; `npm test` 364 pass / 1 gated-skip of 365; `npm run validate` OK.

**Live probes (throwaway board):**
- Empty catalog: skip:true + recorded:"gate:test:skipped-empty-catalog"; re-run byte-identical, exactly one token in completedSteps.
- Non-empty catalog: skip:false, recorded:null, no premature stamp.
- Non-JSON mode: skip line printed only on the empty branch, exact text verified.
- Code cross-check: recorded sourced from the recorder's return (single producer); human line matches spec.

**Skill grep:** all three texts key dispatch off the skip flag; the codex skill's contradiction is gone (two explicit branches verified).

**Gaps / caveats:** none.

Result: pass

## Documentation Updates

Documented by codex-task:workspace-write (gpt-5.5).

- `docs/Workflow.md` — gate-check --json example gains skip/recorded with branch value descriptions.
- `docs/specialty-steps.md` — empty-catalog skip:true/recorded behavior added.
- `memory-bank/systemPatterns.md` — gate-check pattern line carries the current JSON values, kept terse.
- Skill texts updated during implementation; codex-skill contradiction fixed in the rework.

## Questions

## Run Log

- 2026-07-08T02:47:20Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): scope-checked against T1327 (stamp + skill alignment already done); remaining work is the additive skip boolean + recorded token echo in gate-check JSON, human-mode line, one-line skill clarifications. Estimate 2 (basis T20260707T1329Z).

- 2026-07-08T02:48:13Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (response shape)

- 2026-07-08T02:48:14Z: Ensured git branch local-board/T20260707T1333Z-cli-gate-check-returns-an-explicit-skip-result-when-the-stage-catalog-is-empty (created).

- 2026-07-08T02:52:06Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Implementer (sonnet): skip + recorded fields (single-producer token echo), human-mode line, skill clarifications, branch tests extended; 364 pass + 1 gated-skip; live check on this ticket showed skip:true with the recorded token.

- 2026-07-08T02:52:56Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (response shape)

- 2026-07-08T02:52:56Z: Invalidated downstream evidence on loop-back to ready_for_review: removed completedSteps [gate:test:skipped-empty-catalog].

- 2026-07-08T02:55:16Z: Completed review via codex-task:read-only: Codex (gpt-5.5, read-only) changes_requested: one contradictory sentence in the codex skill; all behavior verified correct.

- 2026-07-08T02:55:16Z: Invalidated downstream evidence on loop-back to ready_for_implementation: removed completedSteps [implement:claude-subagent:local-board-implementer@sonnet, gate:implement:claude-subagent:local-board-gatecheck@haiku, review:codex-task:read-only].

- 2026-07-08T02:55:16Z: Ensured git branch local-board/T20260707T1333Z-cli-gate-check-returns-an-explicit-skip-result-when-the-stage-catalog-is-empty (already-current).

- 2026-07-08T02:57:14Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Rework (sonnet): contradictory sentence rewritten as two explicit branches; docs-only, counts unchanged.

- 2026-07-08T02:57:14Z: Completed review via codex-task:read-only: Review complete: single-sentence fix applied verbatim; behavior verified in the first pass.

- 2026-07-08T02:58:35Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (fresh consultation after loop-back; docs-only rework)

- 2026-07-08T02:58:35Z: Invalidated downstream evidence on loop-back to ready_for_review: removed completedSteps [review:codex-task:read-only].

- 2026-07-08T03:02:18Z: Completed test via claude-subagent:local-board-tester@sonnet: Tester (sonnet): 364+1 gated; both branches live-probed (idempotent token echo, no premature stamp, human-mode line), skill grep clean. Result: pass.

- 2026-07-08T03:04:43Z: Completed document via codex-task:workspace-write: Codex (workspace-write): Workflow example + specialty-steps + systemPatterns gain the skip/recorded fields.
