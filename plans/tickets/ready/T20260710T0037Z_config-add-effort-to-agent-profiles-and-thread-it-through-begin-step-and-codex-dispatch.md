---
id: T20260710T0037Z
type: task
status: ready_for_design
priority: P2
parent: null
children: []
blockedBy: [T20260710T0036Z]
blocks: []
branch: local-board/T20260710T0037Z-config-add-effort-to-agent-profiles-and-thread-it-through-begin-step-and-codex-dispatch
estimate: null
estimateBasis: null
workStartedAt: 2026-07-10T01:31:18Z
workCompletedAt: null
created: 2026-07-10T00:36:10Z
updated: 2026-07-10T01:31:18Z
completedSteps: []
routingApprovals: []
---
# config: add effort to agent profiles and thread it through begin-step and codex dispatch

## Requirement

local-board agent profiles pin a per-step model (`{ route, model?, prompt? }`) but have no reasoning-effort knob. With GPT-5.6's tiered reasoning (and the Claude harness's own per-agent effort option), boards need e.g. `review` routed to `codex-task:read-only` on `gpt-5.6-sol` at `xhigh` while `document` runs `gpt-5.6-luna` at `medium`. Depends on the codex-task wrapper ticket that adds `--reasoning-effort` (blockedBy T20260710T0036Z).

Validated 2026-07-09 against local codex-cli 0.144.1: model IDs `gpt-5.6-sol|terra|luna` all accepted; effort enum is model-dependent (`none|minimal|low|medium|high|xhigh` on terra; sol additionally accepts `max` and `ultra`). Effort values must therefore stay schema-shape-checked only, never enumerated in local-board.

## Scope

1. **Config schema** (`src/config.js`): extend agent profiles to `{ route, model?, effort?, prompt? }`. `effort` is a non-empty token matching the same shape rule as model (`^[A-Za-z0-9][A-Za-z0-9._-]*$`), rejected on `inline` routes (same rationale as model). Applies to `agents.*` and `optionalSteps[].agent` object forms if those accept profiles today (match existing behavior; do not widen otherwise).
2. **begin-step** (`src/cli.js`): surface `configuredEffort` (or null) alongside `configuredAgent`/`configuredModel`.
3. **Codex translation** (`src/codex-dispatch.js`): thread `effort` through `translateCodexDispatch` into the dispatch block (`effort` field, null when unset). No sanitization denylist needed beyond the schema shape — effort names are not Claude/Codex-partitioned the way model aliases are.
4. **Evidence policy**: effort stays OUT of the executor evidence token. `<route>@<model>` composition, `modelSatisfies`, strict routing, `complete-step`, and `gate-complete` are untouched. Effort is a dispatch hint, not routed-work identity.
5. **Skill text**: SKILL.md (and the byte-identical `skills/codex/local-board/SKILL.md` CLI block, per test/skill-usage-sync.test.js) — document the profile field and dispatch rule: for `claude-subagent:*` routes pass effort as the subagent dispatch effort option; for `codex-task:*` routes pass `--reasoning-effort <effort>`.
6. **Docs**: docs/CodexSupport.md Models section gains an Effort paragraph; config comment blocks (`plans/local-board.config.jsonc` scaffold text in config.js) updated.
7. **Tests**: config validation (accepted, rejected-on-inline, shape-rejected), begin-step JSON surface, codex-dispatch threading, and skill-sync remain green.

## Acceptance criteria

- `{ "route": "codex-task:read-only", "model": "gpt-5.6-sol", "effort": "xhigh" }` validates; `begin-step --json` returns `configuredEffort: "xhigh"`; `begin-step --harness codex --json` returns it in `codexDispatch`.
- `{ "route": "inline", "effort": "high" }` is rejected with an actionable message.
- Boards with no `effort` keys behave byte-identically to today (JSON adds only the new null field).
- Evidence recording is unchanged: `complete-step --executor <route> --model <model>` still composes `<route>@<model>`; no effort appears in `completedSteps`.
- `npm run check` and `node --test` pass.

## Non-goals

- No effort enforcement or evidence matching; no schema for allowed effort values (plan/model-dependent, validated by the target harness).
- No change to the gate-check/specialty routing surface beyond profile parity.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-10T01:31:18Z: Ensured git branch local-board/T20260710T0037Z-config-add-effort-to-agent-profiles-and-thread-it-through-begin-step-and-codex-dispatch (already-current).
