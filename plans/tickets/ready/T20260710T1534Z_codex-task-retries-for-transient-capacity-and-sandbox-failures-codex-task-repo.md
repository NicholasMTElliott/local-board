---
id: T20260710T1534Z
type: task
status: ready_for_design
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260710T1534Z-codex-task-retries-for-transient-capacity-and-sandbox-failures-codex-task-repo
estimate: null
estimateBasis: null
workStartedAt: 2026-07-10T17:45:37Z
workCompletedAt: null
created: 2026-07-10T15:32:23Z
updated: 2026-07-10T17:50:31Z
completedSteps: []
routingApprovals: []
---
# codex-task: --retries for transient capacity and sandbox failures (../codex-task repo)

## Requirement

Retro item from the 2026-07-10 parallel run (targets the sibling repo ../codex-task, which has no board of its own — tracked here, same pattern as T20260710T0036Z).

Three codex-task dispatches failed on transient causes and all succeeded on a manual immediate retry: gpt-5.6-terra "Selected model is at capacity" (twice, mid-run after 180s+ of work), and one Windows sandbox failure ("windows unelevated restricted-token sandbox cannot enforce split writable root sets directly; refusing to run unsandboxed" during apply_patch, stacked with a capacity error). Each manual retry cost orchestrator attention and a full re-read of the project by codex.

## Scope (all in ../codex-task)

1. codex-task.mjs: add --retries <n> (default 0, keeping current behavior). On a failed run, classify the diagnostic tail with the existing codexFailureHint machinery family: transient classes = model-capacity ("at capacity", rate limit/429) and sandbox-wrapper failures ("failed to prepare windows sandbox wrapper"); non-transient = auth, unsupported model/effort, prompt/JSON contract failures. Retry only transient classes, up to n times, with a short fixed backoff; surface attempt count in the result JSON (attempts field) and a warning entry per retried failure.
2. Serial discipline unchanged: retries are sequential within the single invocation.
3. SKILL.md: document the flag under wrapper options with the transient-class list; note the default preserves current behavior.
4. tests/cli-smoke.test.mjs: fake-codex shim gains a fail-N-times-then-succeed mode; tests for transient-retry-success, non-transient-no-retry, retries-exhausted, and attempts/warnings surfacing.

## Acceptance criteria

- --retries 2 with a shim failing once on a capacity-class message succeeds with attempts: 2 and one warning.
- An auth-class failure with --retries 2 fails immediately (attempts: 1).
- Omitting the flag is byte-identical to today.
- npm run check and npm test pass in ../codex-task.

## Non-goals

- No parallel dispatch, no CODEX_HOME isolation (separate concern).
- No retry of contract failures (bad JSON etc.) — those need prompt fixes, not repeats.

## Acceptance Criteria

## Related Tickets

## Technical Design

### Summary

Add an opt-in `--retries <n>` flag to the `codex-task` wrapper (repo:
`../codex-task`, all code at `C:/Users/Nicho/Documents/codex-task`). On a
non-zero `codex exec` exit, classify the captured diagnostic tail; if the
failure is a recognized **transient infrastructure** class (model capacity /
sandbox-wrapper prep), retry the invocation in-process, serially, up to `n`
times with a short fixed backoff. All other failures (auth, unsupported
model/effort, quota exhaustion, JSON/contract failures, task-level
partial/failed) are non-transient and never retried. Default `n = 0` preserves
today's behavior byte-for-byte.

### Related tickets and conflicts

- Basis / sibling: `T20260710T1533Z` (done, estimate 2) — process-hardening
  text edits from the same 2026-07-10 parallel-run retro. Item 2 there added a
  Delegation denial-recovery hint to local-board's single-ticket SKILL. This
  ticket is the *code* counterpart from the same retro.
- Same cross-repo pattern as `T20260710T0036Z` (sibling `../codex-task` tracked
  on this board; no board of its own).
- No file conflicts: this ticket touches only `../codex-task`
  (`codex-task.mjs`, `SKILL.md`, `tests/cli-smoke.test.mjs`). The local-board
  board/evidence stay here. No overlap with in-flight local-board tickets.
- Follow-up (OUT OF SCOPE, flag only): local-board's Delegation skill text
  (`SKILL.md` / `SKILL_TEAM.md`) could mention `codex-task --retries` as the
  automated path for transient hiccups instead of manual orchestrator re-runs.
  That edits local-board files, so it belongs in a separate local-board ticket,
  not here.

### How transient failures are recognized

The wrapper captures codex output as `stdoutTail` / `stderrTail` (last 4000
chars each) in `runCodex`, and on `runResult.code !== 0` builds the diagnostic
via `formatCodexRunFailure` -> `codexFailureHint(detail)` where
`detail = (stderrTail || stdoutTail).trim()`. There is **no structured JSON on
the failure path** — the JSON result is only the model's final message, written
via `--output-last-message`, and only exists after a clean (code 0) exit. Exit
codes are also uninformative: codex returns non-zero for every failure class
(auth, bad model, capacity, sandbox) with no distinct code per class. So
**error-text pattern matching on the diagnostic tail is the only viable signal**,
and it is exactly the mechanism the existing `codexFailureHint` already uses.

Decision: add a sibling classifier `classifyTransient(detail)` next to
`codexFailureHint`, returning a transient-class label or `null`:

- `model-capacity` — matches `at capacity` (e.g. "Selected model is at
  capacity"), or short-term throttling signals `\b429\b`, `rate limit`,
  `temporarily unavailable`, `try again`.
- `sandbox-wrapper` — matches `failed to prepare .* sandbox wrapper`,
  `cannot enforce split writable root sets`, `refusing to run unsandboxed`.

Precision guardrail (checked FIRST, wins over the transient patterns): a
non-transient exclusion set. If the tail matches auth (`missing bearer`,
`unauthorized`, `401`, `login`), unsupported model/effort
(`not supported`, `\b400\b`, `model_reasoning_effort`), or **durable** quota
exhaustion (`usage limit`, `weekly limit`, `quota`, `limit exceeded`),
`classifyTransient` returns `null` even if a transient substring also appears.
This deliberately separates transient "at capacity / 429 backpressure" (retry
helps) from durable "usage/weekly cap exhausted" (retry cannot help) — the
existing `codexFailureHint` lumps both under one "quota or rate limit" branch,
which is fine for a human hint but too coarse for an auto-retry gate.

Scope note / discrepancy to resolve in implementation: the retro *observed*
string was "windows unelevated restricted-token sandbox cannot enforce split
writable root sets directly; refusing to run unsandboxed", while Scope item 1
names the class "failed to prepare windows sandbox wrapper". The pattern set
above covers both phrasings so either real-world tail is caught.

### Which failure path retries wrap

Retries wrap **only** the `runCodex` + `runResult.code !== 0` branch in
`main()`. They explicitly do NOT cover:

- Spawn errors (`child.on('error')` -> "failed to spawn codex"): environmental
  and already gated by the preflight `checkCodexAvailable`; not transient here.
- `readResult` failures (empty / non-JSON final message): contract failures —
  Non-goal, needs a prompt fix not a repeat.
- Task-level `taskResult` of `partial` / `blocked` / `failed`: substantive
  outcomes on a clean exit; never retried.

### Implementation approach (codex-task.mjs)

1. Arg parsing (`parseArgs`): add `--retries`. Parse `next` as a non-negative
   integer; reject negatives / non-numbers via `usageErr('--retries must be a
   non-negative integer')`. Store `retries` (number, default 0). Also derive
   `retriesEnabled = retries > 0` for output gating (see JSON section).
2. Retry loop in `main()`: replace the single `runCodex` call + `code !== 0`
   emit with a bounded loop. Pseudocode:
   - `let attempt = 0; let runResult;`
   - loop: `attempt++`; `runResult = await runCodex(...)`; if
     `runResult.code === 0` break; classify the tail; if a transient class AND
     `attempt <= retries` (i.e. retries remain): push a warning
     (`codex attempt N/${retries+1} failed (<class>): <first line of tail>;
     retrying`), stream nothing new, sleep `backoffMs`, continue; else break.
   - Keep `attempt` for the JSON `attempts` field.
   - The existing spawn-error `try/catch` stays around each `runCodex` call; a
     spawn throw is non-transient and emits immediately (its own emit gets the
     `attempts` field too when enabled).
3. Backoff: **short fixed** delay between attempts (no exponential — capacity
   recovered on immediate manual retry in the retro; exponential adds latency
   for no evidence of benefit). Constant `RETRY_BACKOFF_MS` (proposal 2000 ms),
   overridable via env `CODEX_TASK_RETRY_DELAY_MS` so tests run without real
   sleeps (set to `0`). No backoff after the final (failed) attempt.
4. Emit paths: every `emit(...)` call in `main()` that can carry a completed or
   run-failed result includes `attempts` in its object **when `retriesEnabled`**
   (see gating). The final success `emit` and the `code !== 0` failure `emit`
   both read the loop's `attempt` counter.

Serial discipline: the loop `await`s each `runCodex` before the next; retries
are strictly sequential within the single process. No new concurrency, no
`CODEX_HOME` isolation — the serial-by-design contract (and the codex#11435
note in the file header) is unchanged.

### JSON result reporting

- `attempts`: integer = number of `codex exec` invocations made
  (1 = no retry needed; 2 = one retry; etc.).
- Warnings: one entry per retried failure, naming the transient class and
  attempt index, appended to the existing `warnings` array (so `--out` and
  stdout both carry them, and `ok`/`warnings` inspection already documented in
  SKILL surfaces them).

Byte-identical gate (acceptance criterion "Omitting the flag is byte-identical
to today"): adding `attempts` unconditionally would change the shape of every
result and break that criterion. Decision: **include `attempts` only when
`--retries` was given with a value > 0** (`retriesEnabled`). Consequences,
which satisfy all three stated acceptance rows:

- `--retries 2`, shim fails once on capacity -> success, `attempts: 2`, one
  warning. (field present)
- `--retries 2`, auth failure -> fail immediately, `attempts: 1`. (field
  present)
- Flag omitted (or `--retries 0`) -> no `attempts` key; output byte-identical
  to today.

Open question flagged below: whether the maintainer prefers `attempts` always
present (cleaner for consumers) over strict byte-identical omission.

### Interaction with other flags

- `--quiet`: unchanged semantics. It gates live streaming
  (`streamThinking && !quiet`), not warnings. Retry warnings follow the
  existing warning convention (into `warnings[]`; mirrored to stderr like the
  install-check warning). Each retried attempt re-streams codex chatter only if
  `--stream-thinking` is set and `--quiet` is not.
- `--out`: unchanged. The single final JSON (now possibly carrying `attempts` +
  retry warnings) is written once at the end, exactly as today.
- `--debug`: `sessionDir` is preserved on failure / with `--debug` as today.
  All attempts reuse the one `sessionDir` and `lastMessagePath`; safe because
  `lastMessagePath` is only read after a code-0 exit and codex overwrites it via
  `--output-last-message`. Implementation nicety: `rmSync(lastMessagePath,
  {force:true})` before each retry attempt to avoid any chance of reading a
  stale prior message (defensive; not strictly required).
- `--reasoning-effort` / `--model` / `--permissions` / `--profile`: spawn args
  are identical on every attempt (same `buildSpawnArgs` output).

### Affected files

- `codex-task.mjs` — arg parse (`--retries`), retry loop in `main()`,
  `classifyTransient()` helper, backoff constant + env override, `attempts`
  field on emits, and `printUsage` text (add `--retries` under Wrapper options
  and to the usage synopsis).
- `SKILL.md` — see docs section.
- `tests/cli-smoke.test.mjs` — extend fake-codex shim + new tests.
- No changes to `install.mjs` or `scripts/permission-matrix.mjs`.

### Test strategy (existing seams)

Test seams available today: `makeFakeCodex()` builds a per-call temp dir with a
`codex.cmd`/`codex` shim delegating to `fake-codex.mjs`; env
`FAKE_CODEX_ARGV_OUT` dumps the spawn argv; PATH is prepended so the fake wins.
Because each `codex exec` is a fresh process, cross-attempt "fail N times then
succeed" state must live on disk, not in memory.

Extend the shim (`fakeCodexJs`) with an env-driven fail-then-succeed mode:

- `FAKE_CODEX_FAIL_TIMES` (int, default 0) — number of leading invocations that
  should fail.
- `FAKE_CODEX_FAIL_MESSAGE` — text emitted to stderr on a failing invocation
  (e.g. "Selected model is at capacity").
- `FAKE_CODEX_STATE` — path to a counter file the shim reads/increments/writes
  each non-`--version` invocation. If `count <= FAIL_TIMES`: write
  `FAKE_CODEX_FAIL_MESSAGE` to stderr and `process.exit(1)`; else behave as the
  current success shim (write result JSON, exit 0). `makeFakeCodex` returns the
  state path (inside `fake.dir`, so it is per-test isolated).

All retry tests set `CODEX_TASK_RETRY_DELAY_MS=0` for determinism (no sleeping).

New tests:

1. transient-retry-success: `FAKE_CODEX_FAIL_TIMES=1`, message "Selected model
   is at capacity", `--retries 2` -> status 0, `ok:true`, `attempts:2`, exactly
   one warning matching /at capacity/i.
2. non-transient-no-retry (auth): `FAKE_CODEX_FAIL_TIMES=1`, message contains
   "stream error: missing bearer token" (or "401"), `--retries 2`. The shim
   *would* succeed on attempt 2, but the wrapper must NOT retry -> status 1,
   `ok:false`, `attempts:1`.
3. retries-exhausted: `FAKE_CODEX_FAIL_TIMES=5`, capacity message,
   `--retries 2` -> status 1, `ok:false`, `attempts:3` (1 initial + 2 retries),
   two retry warnings present, `error` carries the capacity tail.
4. sandbox-wrapper transient class: message "failed to prepare windows sandbox
   wrapper" (and/or "cannot enforce split writable root sets"),
   `FAKE_CODEX_FAIL_TIMES=1`, `--retries 1` -> status 0, `attempts:2`.
5. byte-identical / field-gating: run the plain success fake WITHOUT `--retries`
   -> parsed JSON has NO `attempts` key. Same with `--retries 0`.
6. durable-quota exclusion (precision guard): `FAKE_CODEX_FAIL_TIMES=1`, message
   "You've hit your weekly usage limit", `--retries 2` -> NOT retried, status 1,
   `attempts:1`. Guards against retrying real quota exhaustion.
7. `--help` documents `--retries` (extend the existing help-contract test with a
   `/--retries/` assertion).
8. invalid value: `--retries -1` (and `--retries abc`) -> status 2, stderr
   `/--retries must be a non-negative integer/`.

`npm run check` (node --check) and `npm test` (node --test) must pass; both are
the acceptance gate.

### Documentation updates

- `SKILL.md` "How to invoke" synopsis: add `[--retries N]`.
- `SKILL.md` Wrapper options: new `--retries` bullet — default 0 preserves
  current behavior; retries only the transient infrastructure classes
  (model-capacity: "at capacity" / 429 backpressure; sandbox-wrapper prep
  failures); explicitly NOT auth, unsupported model/effort, durable quota, or
  JSON/contract failures; short fixed backoff; serial (never parallel).
- `SKILL.md` Output / Field semantics: document `attempts` (present only when
  `--retries > 0`) and the per-retry warning entries.
- `SKILL.md` "After invoking" step 4 and Failure modes: point the "re-run only
  if it looks like a transient codex hiccup" guidance at `--retries` as the
  built-in automated path.
- `codex-task.mjs` `printUsage`: mirror the flag doc (production text edit, in
  scope — a help-contract test asserts on it).
- No README index change (README not in scope; SKILL is the wrapper's doc
  surface).

### Risks and edge cases

- Misclassification (primary risk). A non-transient tail that coincidentally
  contains a transient substring would waste up to `n` retries; bounded and
  low-cost. The higher-stakes direction — retrying durable quota/auth — is
  guarded by the non-transient exclusion checked first. The riskiest boundary is
  429 / "rate limit": treated as transient backpressure, while "usage/weekly
  limit exceeded" is excluded. This split is the key judgement call.
- Wall-clock cost. Failed attempts on capacity happened after 180s+ of work in
  the retro; `n` retries multiply worst-case latency. `n` bounds it; default 0
  means opt-in only; SKILL notes the cost.
- Idempotency of write tasks. Both observed transient classes fail *before* a
  successful write (capacity = pre-work; sandbox-wrapper = apply_patch refused,
  so nothing was written), and codex runs `--ephemeral` (fresh read each
  attempt), so retry is as safe as the manual re-run it replaces. A transient
  failure *after* a partial write is theoretically possible; the risk is
  identical to today's human manual retry and is noted, not solved here.
- Stale `lastMessagePath` across attempts: mitigated (read only after code 0;
  codex overwrites) plus optional pre-attempt unlink.
- Test flakiness from real sleeps: eliminated by `CODEX_TASK_RETRY_DELAY_MS=0`.

### Open questions (non-blocking; sensible defaults chosen)

1. `attempts` field presence: gated to `--retries > 0` to honor the
   byte-identical acceptance criterion. Confirm the maintainer prefers that over
   an always-present field.
2. Backoff magnitude: proposed fixed 2000 ms (env-overridable). Acceptable, or
   prefer 0/1000 ms?
3. 429 / "rate limit" as transient vs the durable-quota exclusion — confirm the
   split (retry short-term throttle, do not retry usage-cap exhaustion).

None of these block implementation; defaults above are ready to build.

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-10T17:45:37Z: Ensured git branch local-board/T20260710T1534Z-codex-task-retries-for-transient-capacity-and-sandbox-failures-codex-task-repo (already-current).
