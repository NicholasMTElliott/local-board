---
id: T20260707T1333Z
type: task
status: implementing
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
updated: 2026-07-08T02:51:41Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", gate:test:skipped-empty-catalog]
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

Implemented the additive `skip`/`recorded` fields in `gate-check` per the design's default (single-producer echo).

- `src/tickets.js`: `recordGateSkippedEmptyCatalog` now returns `{ ticket, stage, path, token }` (added `token`, additive).
- `src/cli.js` (`commandGateCheck`): computes `skip = catalog.length === 0` once; on the empty branch captures `recorded` from the recorder's return value (`skipResult.token`) instead of re-deriving the string, so the wire value cannot drift from the stamped token; on the non-empty branch `recorded` stays `null`. Both `skip` and `recorded` added to the JSON payload (additive, `catalog` unchanged). Non-JSON mode prints an additional line on the skip branch: `skip: empty catalog — recorded gate:<stage>:skipped-empty-catalog (no dispatch)`; the existing first line is unchanged.
- `SKILL.md`, `SKILL_TEAM.md`, `skills/codex/local-board/SKILL.md`: one-line clarifications so dispatch is keyed off the `skip` flag ("dispatch the gate agent only when `skip` is `false`"), keeping the existing auto-stamp sentences.
- `test/cli.test.js`: extended the empty-branch test (idempotent-rerun test, ~line 783) to assert `skip: true` / `recorded: "gate:test:skipped-empty-catalog"` on both the first and idempotent second call, plus a new non-JSON assertion that the skip line appears. Extended the non-empty-branch "pure read" test (~line 808) to assert `skip: false` / `recorded: null`, plus a non-JSON assertion that the skip line is absent.

No mirrored/generated copy of the skill markdown was found (checked for other files containing the same SKILL.md prose); `test/pack.test.js` only checks file inclusion, not content, so no regeneration was needed.

Verification: `npm run check`, `npm test` (365 tests, 364 pass, 1 pre-existing unrelated skip, 0 fail), `npm run validate` all green. Live check on this ticket (`gate-check T20260707T1333Z --stage test --json`) returns `skip: true` and `recorded: "gate:test:skipped-empty-catalog"` — the expected auto-stamp side effect this ticket's own empty test-stage catalog triggers.

No deviations from the Technical Design's default choices (single-producer token echo; `requestedSteps` not added to the CLI payload; `catalog` left unchanged).

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-08T02:47:20Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): scope-checked against T1327 (stamp + skill alignment already done); remaining work is the additive skip boolean + recorded token echo in gate-check JSON, human-mode line, one-line skill clarifications. Estimate 2 (basis T20260707T1329Z).

- 2026-07-08T02:48:13Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (response shape)

- 2026-07-08T02:48:14Z: Ensured git branch local-board/T20260707T1333Z-cli-gate-check-returns-an-explicit-skip-result-when-the-stage-catalog-is-empty (created).
