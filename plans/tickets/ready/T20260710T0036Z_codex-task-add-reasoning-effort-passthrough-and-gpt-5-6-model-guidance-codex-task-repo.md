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
estimate: 2
estimateBasis: T20260709T1119Z
workStartedAt: 2026-07-10T01:05:10Z
workCompletedAt: null
created: 2026-07-10T00:36:09Z
updated: 2026-07-10T01:09:48Z
completedSteps: ["design:claude-subagent:local-board-designer@opus"]
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

Adds a `--reasoning-effort <level>` pass-through to the codex-task wrapper (repo `../codex-task`), composing `-c model_reasoning_effort="<level>"` onto the `codex exec` invocation, echoing the resolved value as `reasoningEffort` in the result JSON, extending the failure-hint mapping, and updating SKILL.md + smoke tests. All changes are additive and follow the existing `--model` / `--profile` pass-through pattern. No client-side validation of effort levels (server-owned, model-dependent).

## Related tickets and conflicts

- Blocks `T20260710T0037Z` (local-board `effort` profile-field integration), which consumes this flag. No shared files; no merge conflict expected.
- No other in-flight tickets touch `../codex-task`. The change is confined to that sibling repo; the board ticket only records design/notes.

## Implementation approach (all edits in `C:/Users/Nicho/Documents/codex-task`)

### 1. `codex-task.mjs` — flag parse (value required)

In `parseArgs`, add a state var initialised to the "unset" sentinel:

```js
let reasoningEffort = null; // null = flag absent; string = resolved level
```

Add a branch in the arg loop (co-located with `--model`):

```js
else if (arg === '--reasoning-effort') {
  if (next === undefined || next === '') usageErr('--reasoning-effort requires a value');
  reasoningEffort = next; i++;
}
```

Requiring `next` be present makes "flag with no value" a hard `usageErr` (exit 2), while a genuinely-unset flag stays `null`. Do NOT reuse the `!value` idiom used by `--model` (there the default is non-empty; here unset and empty must be distinguishable). Add `reasoningEffort` to the returned object.

Deliberately **no** client-side enum check — the effort set is plan- and model-dependent (probe: terra = `none|minimal|low|medium|high|xhigh`; sol additionally `max`, `ultra`), so codex validates server-side, identical philosophy to `--model`.

### 2. `codex-task.mjs` — `buildSpawnArgs` composition

Thread `reasoningEffort` into the destructured params and, after the base `args` array is built (after `--model`, before the `--profile` push), append only when set:

```js
if (reasoningEffort) {
  args.push('-c', `model_reasoning_effort="${reasoningEffort}"`);
}
```

Update the `buildSpawnArgs({ ... })` call site in `main()` to pass `reasoningEffort: args.reasoningEffort` (and drop the stray `search: args.search`, which references a non-existent field — harmless but dead).

**Cross-platform quoting note (load-bearing).** The literal TOML string quotes are intentional and must be kept:
- Non-Windows: `spawn` runs with `shell:false` (`shell: isWin`), so the array element `model_reasoning_effort="high"` reaches codex's argv verbatim; codex TOML-parses `"high"` to the string `high`.
- Windows: `shell:true` joins args raw and sets `windowsVerbatimArguments`; cmd.exe + codex's argv parsing strip the inner quotes, so codex's argv receives `model_reasoning_effort=high`. codex's `-c` override treats an unparseable bare value as a raw string, yielding the same `high`. This mirrors how the ticket's manual probe (run in a shell that also strips quotes) succeeded.

Both paths converge on the string `high`. Omitting the flag pushes nothing, so spawn args are byte-identical to today (acceptance criterion satisfied).

### 3. `codex-task.mjs` — result-JSON echo

Add `reasoningEffort: args.reasoningEffort` (which is `null` when unset) to **every** `emit({...})` object — the success path plus all early-exit failure paths (missing `--cwd`, codex unavailable, session-dir failure, spawn failure, non-zero exit, unreadable result). Placing it beside the existing `model` / `permissions` echoes keeps the output schema uniform across success and failure, satisfying "Result JSON contains `reasoningEffort` in both set and unset cases".

### 4. `codex-task.mjs` — usage/help + known-model hints

- Add `[--reasoning-effort LEVEL]` to the `printUsage` synopsis line near `[--model MODEL]`.
- Add a `--reasoning-effort` entry under "Codex pass-throughs" describing it as plan- and model-dependent, server-validated, unset by default, and naming commonly-seen levels (`minimal|low|medium|high|xhigh`, plus `max`/`ultra` on some tiers) as *hints only, not a validated enum*.
- Extend `KNOWN_MODEL_HINTS` to include `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` so `--help` model hints stay consistent with SKILL.md, and refresh the adjacent comment. `DEFAULT_MODEL` stays `gpt-5.5` (per ticket non-goal — no default change).

### 5. `codex-task.mjs` — failure-hint mapping

In `codexFailureHint`, add an effort-specific branch **before** the existing model/`400` branch (the current `/400/` alternative would otherwise swallow effort 400s under the model hint):

```js
if (/model_reasoning_effort|reasoning[_ ]?effort/i.test(detail)) {
  return 'The chosen --reasoning-effort may not be supported for this model/plan; drop --reasoning-effort or pick a supported level (e.g. low, medium, high). ';
}
```

Keying on the config key `model_reasoning_effort` (which the server 400 echoes, per the probe that enumerated the accepted set) is the most reliable signal; `reasoning[_ ]?effort` is a looser fallback.

### 6. `SKILL.md`

- Synopsis block: add `[--reasoning-effort LEVEL]`.
- "Codex pass-throughs" parameter list: add `--reasoning-effort` (optional; unset by default; plan/model-dependent; server-validated; no wrapper enumeration).
- Model guidance: keep default `gpt-5.5`; extend the known-names list with the GPT-5.6 tiers and tier guidance — `gpt-5.6-sol` (flagship; additionally accepts `max`/`ultra` effort), `gpt-5.6-terra` (balanced), `gpt-5.6-luna` (cheap/fast). Mark which claims were CLI-validated (2026-07-09, codex-cli 0.144.1): the three model names accepted; terra effort enum `none|minimal|low|medium|high|xhigh`; sol additionally `max`/`ultra`. Note effort sets are model-dependent, hence no client-side validation.
- Output JSON example: add `"reasoningEffort": null` (and show a non-null value where a set example is illustrative), and add a `reasoningEffort` bullet to "Field semantics" (resolved level, `null` when the flag was omitted).
- Failure modes: add a bullet for the unsupported-effort hint.

### 7. `tests/cli-smoke.test.mjs`

Extend the fake-codex shim to record its received argv when an env var is set (cross-platform, no production export needed):

```js
// inside fakeCodexJs, before writing the last-message file:
if (process.env.FAKE_CODEX_ARGV_OUT) {
  writeFileSync(process.env.FAKE_CODEX_ARGV_OUT, JSON.stringify(process.argv.slice(2)));
}
```

New tests:

1. **Help documents the flag** — `--help` stdout matches `/--reasoning-effort/`.
2. **Rejected without a value** — `['codex-task.mjs','--reasoning-effort','--prompt','x']`... note the parser would consume `--prompt` as the value; the faithful "no value" case is `--reasoning-effort` as the final arg: run `['codex-task.mjs','--prompt','noop','--reasoning-effort']`, assert `status === 2` and stderr matches `/--reasoning-effort requires a value/`.
3. **Accepted with value: composition + echo** — run with fake codex, `--reasoning-effort high`, and `FAKE_CODEX_ARGV_OUT` set to a temp file. Assert exit 0; parse the argv dump and assert it contains `-c` and an element matching the platform-tolerant regex `/^model_reasoning_effort=("?)high\1$/` (matches quoted POSIX form and quote-stripped Windows form); assert result JSON `reasoningEffort === 'high'`.
4. **Unset default** — run with fake codex, no flag, `FAKE_CODEX_ARGV_OUT` set. Assert argv contains no `-c` and result JSON `reasoningEffort === null`.

The platform-tolerant regex avoids asserting on shell-stripped quoting differences while still proving the wrapper composed the override. Existing tests that `deepEqual` only `files` / specific fields are unaffected by the new `reasoningEffort` key.

## Affected files

- `codex-task.mjs` — parse, `buildSpawnArgs`, all `emit` sites, `printUsage`, `KNOWN_MODEL_HINTS`, `codexFailureHint`.
- `SKILL.md` — synopsis, parameters, model guidance, output example + field semantics, failure modes.
- `tests/cli-smoke.test.mjs` — fake-codex argv capture + 4 new tests.

## Risks

- **Windows quote stripping**: relies on codex's `-c` fallback treating a bare `model_reasoning_effort=high` as a string. Cross-platform reasoning above argues both paths converge, but this should be confirmed with one real-codex smoke on Windows before closing (the CI/unit tests use a fake shim and cannot prove codex's TOML fallback).
- **Failure-hint regex wording unverified**: the exact codex 400 text for a bad effort is not captured verbatim. Keying on the `model_reasoning_effort` config key is the safest bet; recommend capturing one real 400 to confirm during implementation and tighten if needed.
- **Echo-field breadth**: `reasoningEffort` must be added to *all* emit sites; missing one leaves an inconsistent schema. Low risk, mechanical, but easy to overlook.

## Test strategy

- `npm run check` + `npm test` in `../codex-task` (acceptance gate).
- The 4 new smoke tests cover: help surface, missing-value rejection, set-case composition+echo, unset default.
- Manual (out of automated scope, recommended pre-close): one real `codex exec` against `gpt-5.6-terra --reasoning-effort high` on Windows to confirm codex accepts the shell-stripped override.

## Open questions

None blocking. The two verification items (Windows real-codex smoke, exact 400 wording) are implementation-time confirmations, not scope ambiguities — the probe facts in the ticket are sufficient to build against.

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-10T00:38:52Z: Probe evidence (2026-07-09, codex-cli 0.144.1): gpt-5.6-{sol,terra,luna} accepted via --model; -c model_reasoning_effort enum on terra = none|minimal|low|medium|high|xhigh (server 400 enumerates); sol additionally accepts max and ultra (both exit 0). Effort sets are model-dependent; do not validate client-side.

- 2026-07-10T01:05:10Z: Ensured git branch local-board/T20260710T0036Z-codex-task-add-reasoning-effort-passthrough-and-gpt-5-6-model-guidance-codex-task-repo (already-current).

- 2026-07-10T01:09:36Z: Completed design via claude-subagent:local-board-designer@opus: Technical Design written by opus designer: --reasoning-effort flag parse->spawn->emit threading, cross-platform TOML quoting, reasoningEffort echo at all emit sites, SKILL.md GPT-5.6 tier guidance, 4 smoke tests via FAKE_CODEX_ARGV_OUT argv capture. Estimate 2.
