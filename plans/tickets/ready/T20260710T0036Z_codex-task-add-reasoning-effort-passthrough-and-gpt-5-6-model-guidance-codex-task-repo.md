---
id: T20260710T0036Z
type: task
status: ready_for_design
priority: P2
parent: null
children: []
blockedBy: []
blocks: [T20260710T0037Z]
branch: local-board/T20260710T0036Z-codex-task-add-reasoning-effort-passthrough-and-gpt-5-6-model-guidance-codex-task-repo
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-10T00:36:09Z
updated: 2026-07-10T01:04:35Z
completedSteps: []
routingApprovals: []
---
# codex-task: add --reasoning-effort passthrough and GPT-5.6 model guidance (../codex-task repo)

## Requirement

The codex-task wrapper (sibling repo `../codex-task`, no board of its own — tracked here) exposes `--model` but no reasoning-effort control. The codex CLI supports per-invocation effort via `-c model_reasoning_effort="<level>"` (config-reference values: `minimal|low|medium|high|xhigh`; GPT-5.6 preview docs additionally describe `max` and `ultra` modes on Sol). With GPT-5.6 (`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`) shipping tiered reasoning, callers need to pin both model AND effort per dispatch.

## Validated facts (local codex-cli 0.144.1, ChatGPT plan, 2026-07-09)

- `codex exec --model gpt-5.6-terra` / `gpt-5.6-sol` / `gpt-5.6-luna` all accepted; trivial prompts completed (exit 0).
- Effort override mechanism confirmed: `codex exec -c model_reasoning_effort="<level>"`.
- Server enum for terra (from a 400 on an invalid value): `none, minimal, low, medium, high, xhigh`.
- `gpt-5.6-sol` additionally accepts `max` and `ultra` (both ran successfully). Effort sets are model-dependent - this is why the wrapper must NOT validate client-side.
- `codex exec` appends piped stdin to the prompt and blocks until stdin closes; the wrapper already writes the prompt via stdin and ends it (codex-task.mjs:405-406), so no change needed there - just don't regress it.

## Scope (all in ../codex-task)

1. `codex-task.mjs`: add `--reasoning-effort <level>` (value required when flag present). When set, `buildSpawnArgs` appends `-c model_reasoning_effort="<level>"`. Pass through unvalidated — codex validates server-side, same philosophy as `--model`. Echo the resolved value as `reasoningEffort` in the result JSON (null when unset) and in usage/help text.
2. Failure-mode mapping: extend the friendly-hint regex that today catches unsupported-model errors to also catch unsupported-effort errors, hinting to drop `--reasoning-effort` or choose a supported level.
3. `SKILL.md`: document the flag under "Codex pass-throughs" (plan-dependent, server-validated); refresh the dated model guidance — default stays `gpt-5.5` for now, but the known-names list should include `gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna` with the tier guidance (sol = flagship/max+ultra, terra = balanced default, luna = cheap/fast) and note which claims were CLI-validated.
4. `tests/cli-smoke.test.mjs`: cover flag parsing (accepted with value, rejected without), spawn-args composition, result-JSON echo, and unset default.

## Acceptance criteria

- `node codex-task.mjs --prompt "..." --model gpt-5.6-terra --reasoning-effort high` composes `codex exec ... --model gpt-5.6-terra -c model_reasoning_effort="high"`.
- Omitting the flag produces byte-identical spawn args to today (no `-c` present).
- Result JSON contains `reasoningEffort` in both set and unset cases.
- `npm run check` and `npm test` pass in ../codex-task.
- SKILL.md usage block, parameters, and output example updated consistently.

## Non-goals

- No client-side enumeration/validation of effort levels (plan- and model-dependent; codex owns the truth).
- No change to `--profile` behavior (profiles remain the escape hatch for other config keys).
- local-board integration is a separate ticket (this repo's `effort` profile field), which depends on this one.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-10T00:38:52Z: Probe evidence (2026-07-09, codex-cli 0.144.1): gpt-5.6-{sol,terra,luna} accepted via --model; -c model_reasoning_effort enum on terra = none|minimal|low|medium|high|xhigh (server 400 enumerates); sol additionally accepts max and ultra (both exit 0). Effort sets are model-dependent; do not validate client-side.
