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
estimate: 4
estimateBasis: T20260710T1533Z
workStartedAt: 2026-07-10T17:45:37Z
workCompletedAt: null
created: 2026-07-10T15:32:23Z
updated: 2026-07-10T18:08:08Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
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
non-zero `codex exec` exit, classify the captured diagnostic tail. If the
failure is a recognized **transient infrastructure** class (model capacity /
sandbox-wrapper prep) it retries the invocation in-process, serially, up to `n`
times with a short fixed backoff. Every other failure — auth, unsupported
model/effort, durable quota/usage-cap exhaustion, JSON/contract failures,
task-level partial/failed — is non-transient and never retried. Default
`n = 0` preserves today's behavior. This revision (post design-review FAIL)
rewrites the classifier as a two-phase, durable-exclusion-first design with
exact ordered pattern lists, pins the byte-identical claim to a precise
structural contract, and closes the enumerated test gaps.

### Related tickets and conflicts

- Basis / sibling: `T20260710T1533Z` (done, estimate 2) — process-hardening
  text edits from the same 2026-07-10 parallel-run retro. This ticket is the
  *code* counterpart from the same retro.
- Same cross-repo pattern as `T20260710T0036Z` (sibling `../codex-task` tracked
  on this board; no board of its own).
- No file conflicts: touches only `../codex-task` (`codex-task.mjs`, `SKILL.md`,
  `tests/cli-smoke.test.mjs`). Board/evidence stay in local-board. No overlap
  with in-flight local-board tickets.
- Follow-up (OUT OF SCOPE, flag only): local-board's Delegation skill text could
  later mention `codex-task --retries` as the automated path for transient
  hiccups. That edits local-board files, so it is a separate ticket.

### Why text-pattern classification is the only signal

The wrapper captures codex output as `stdoutTail` / `stderrTail` (last 4000
chars each) in `runCodex`, and on `runResult.code !== 0` builds the diagnostic
via `formatCodexRunFailure` -> `codexFailureHint(detail)` where
`detail = (stderrTail || stdoutTail).trim()`. There is **no structured JSON on
the failure path** — the result JSON is only the model's final message, written
via `--output-last-message`, and only exists after a clean (code 0) exit. Exit
codes are uninformative: codex returns non-zero for every failure class with no
distinct code. So error-text pattern matching on the diagnostic tail is the
only viable signal, and it is exactly what `codexFailureHint`
(`codex-task.mjs:491`) already does.

### Classifier redesign: durable-exclusion-first, two ordered phases

The prior draft used a single exclusion set whose blanket `limit exceeded`
swallowed transient `429 rate limit exceeded`, whose bare `try again` could
catch durable failures, and whose effort exclusion missed codex's actual
"reasoning effort" wording. This revision fixes all three by making the durable
exclusion use **contextual cap phrases only**, treating **429 / rate-limit as
transient unless an explicit durable-cap phrase co-occurs**, dropping bare
`try again` in favor of qualified forms, and adding the reasoning-effort
diagnostic to the exclusions.

Add one helper `classifyTransient(detail)` next to `codexFailureHint`. It runs
**two ordered phases** and returns a transient-class label or `null`:

Phase 1 — DURABLE / non-transient exclusions, evaluated FIRST. If ANY matches,
return `null` immediately (even when a transient substring co-occurs — this is
how "exclusion-first wins" on mixed tails). Wordings anchored to what
`codexFailureHint` already recognizes at `codex-task.mjs:491-508`:

```js
// Phase 1: durable failures — retry cannot help. Any match => classifyTransient returns null.
const NON_TRANSIENT_PATTERNS = [
  // auth / login expiry
  /missing bearer|unauthoriz(?:ed|ation)|authentication|\b401\b|codex login|not logged in|invalid api key/i,
  // unsupported model
  /model .*not supported|not supported.*ChatGPT account|unsupported model|\b400\b/i,
  // unsupported / rejected reasoning effort  (ADDED: covers codex's plain "reasoning effort" wording)
  /model_reasoning_effort|reasoning[_ ]?effort/i,
  // durable quota / usage-cap exhaustion — CONTEXTUAL phrases only.
  // Deliberately NO bare "limit exceeded" and NO bare "rate limit" here,
  // so transient "429 rate limit exceeded" is NOT swallowed by this phase.
  /usage limit|weekly limit|monthly limit|usage cap|plan limit|\bquota\b|(?:hit|reached|exceeded) your[^.\n]*\blimit\b/i,
];
```

Phase 2 — TRANSIENT classes, evaluated only if Phase 1 did not match. Return
the label of the first list that matches, else `null`:

```js
// Phase 2: transient infrastructure — retry can help. First match wins.
const TRANSIENT_PATTERNS = [
  { label: 'model-capacity',
    re: /\bat capacity\b|\b429\b|rate[ _-]?limit|too many requests|temporarily unavailable|server (?:is )?overloaded|please try again|try again (?:later|shortly|in\b)/i },
  { label: 'sandbox-wrapper',
    re: /failed to prepare\b[^\n]*sandbox wrapper|cannot enforce split writable root sets|refusing to run unsandboxed|restricted-token sandbox/i },
];

function classifyTransient(detail) {
  for (const re of NON_TRANSIENT_PATTERNS) if (re.test(detail)) return null;   // exclusion-first
  for (const { label, re } of TRANSIENT_PATTERNS) if (re.test(detail)) return label;
  return null;
}
```

Worked classifications proving the split (each is a named test in the plan below):

- `"Selected model is at capacity"` -> Phase 1 no match; Phase 2 `at capacity` ->
  **model-capacity** (transient).
- `"Error: 429 rate limit exceeded, please try again later"` -> Phase 1 no match
  (no `usage/weekly/quota` phrase, and `exceeded your ... limit` does not match
  `rate limit exceeded`); Phase 2 `\b429\b` -> **model-capacity** (transient).
  This is the exact case the review flagged; it now retries.
- `"You've hit your weekly usage limit"` -> Phase 1 matches (`usage limit` and
  `hit your ... limit`) -> **null** (durable, no retry).
- Mixed: `"Selected model is at capacity. You've hit your weekly usage limit."`
  -> Phase 1 matches `usage limit` -> **null**. Exclusion-first wins over the
  co-occurring transient wording.
- `"stream error: missing bearer token"` -> Phase 1 auth -> **null**.
- `"model gpt-5.6-terra is not supported for this ChatGPT account"` -> Phase 1
  unsupported-model -> **null**.
- `"unsupported value for model_reasoning_effort"` and `"reasoning effort 'xhigh'
  is not supported"` -> Phase 1 effort -> **null** (the wording the prior draft
  missed).
- `"windows unelevated restricted-token sandbox cannot enforce split writable
  root sets directly; refusing to run unsandboxed"` (the retro's observed tail)
  -> Phase 1 no match; Phase 2 sandbox-wrapper -> **sandbox-wrapper** (transient).
- `"failed to prepare windows sandbox wrapper"` (Scope item 1 wording) -> Phase 2
  sandbox-wrapper -> **sandbox-wrapper**.

Design notes on the split:

- The transient sandbox list is intentionally NARROW (wrapper-prep phrases only),
  not the broad `codexFailureHint` sandbox branch (`sandbox|permission denied|
  operation not permitted|patch rejected|read-only`). A generic permission/
  read-only denial is a config problem, not transient, so it is NOT retried.
- Any co-occurring durable-cap phrase (`quota`, `usage/weekly/monthly limit`,
  `usage cap`, `plan limit`, `... your ... limit`) forces `null`. This is the
  conservative direction: when in doubt between throttle and cap, do not retry.
- The effort exclusion (`reasoning[_ ]?effort`) is broad by design; a capacity/
  sandbox tail that merely mentions reasoning effort would be treated as
  non-transient. Accepted: a false-negative (a missed retry) is cheaper than
  retrying a durable config error, and the phrase is unlikely in a genuine
  capacity/sandbox tail.

### Which failure path retries wrap

Retries wrap **only** the `runCodex` + `runResult.code !== 0` branch in `main()`
(`codex-task.mjs:758`). They explicitly do NOT cover:

- Spawn errors (`child.on('error')` -> "failed to spawn codex",
  `codex-task.mjs:746`): environmental, already gated by the `checkCodexAvailable`
  preflight; not transient.
- `readResult` failures on a code-0 exit (empty / non-JSON / malformed final
  message, `codex-task.mjs:770`): contract failures — Non-goal; they need a
  prompt fix, not a repeat. Because this branch is structurally *after* the
  retry loop and only reached on a clean exit, it can never trigger a retry.
  This is asserted by a dedicated test (exit-0 malformed JSON, below).
- Task-level `taskResult` of `partial` / `blocked` / `failed`: substantive
  outcomes on a clean exit; never retried.

### Implementation approach (codex-task.mjs)

1. Arg parsing (`parseArgs`): add `--retries`. Parse `next` as a non-negative
   integer; reject negatives / non-numbers / missing value via
   `usageErr('--retries must be a non-negative integer')`. Store `retries`
   (number, default 0). Derive `retriesEnabled = retries > 0` for output gating.
2. Retry loop in `main()`: replace the single `runCodex` call + `code !== 0`
   emit with a bounded loop:
   - `let attempt = 0; let runResult;`
   - loop: `attempt++`; run `runCodex(...)` inside the existing spawn-error
     try/catch; if `runResult.code === 0` break; else
     `const cls = classifyTransient(tailOf(runResult))`; if `cls` AND
     `attempt <= retries` (retries remain): push a warning
     (`codex attempt ${attempt}/${retries + 1} failed (${cls}): <first line of
     tail>; retrying`), optionally `rmSync(lastMessagePath, {force:true})`, sleep
     `backoffMs` unless it is the final attempt, continue; else break.
   - `tailOf` derives the same `(stderrTail || stdoutTail).trim()` string that
     `formatCodexRunFailure` uses, so classification sees exactly the diagnostic.
   - Keep `attempt` for the `attempts` field. A spawn throw is non-transient and
     emits immediately (with `attempts` when enabled).
3. Backoff: **short fixed** delay (no exponential — capacity recovered on the
   immediate manual retry in the retro). Constant `RETRY_BACKOFF_MS` (2000 ms),
   overridable via env `CODEX_TASK_RETRY_DELAY_MS` so tests set `0` and never
   sleep. No backoff after the final failed attempt.
4. Emit paths: the final success `emit` and the `code !== 0` failure `emit` read
   the loop's `attempt` counter and include `attempts` **only when
   `retriesEnabled`** (see gating). Insert `attempts` in a fixed position in the
   object literal so the shape is stable when present.

Serial discipline: the loop `await`s each `runCodex` before the next; retries
are strictly sequential in the single process. No new concurrency, no
`CODEX_HOME` isolation — the serial-by-design contract is unchanged.

### JSON result reporting and the byte-identical contract

- `attempts`: integer = number of `codex exec` invocations (1 = no retry;
  2 = one retry; ...). Present only when `--retries > 0`.
- Warnings: one entry per retried failure, naming the transient class and
  attempt index, appended to the existing `warnings` array.

`emit` (`codex-task.mjs:637`) serializes with `JSON.stringify(r, null, 2)` in
object-literal insertion order. Two fields are already non-deterministic across
any two real runs today: `durationMs` (wall clock) and `sessionDir` (a
`Date.now()-pid` path on the failure/`--debug` paths; `null` on cleaned success).
Literal byte-identity was therefore never achievable between two live runs.

**Byte-identical contract — CHOICE: option (b), the precise structural
contract** (not option (a) fixed-clock/session-injection + stdout fixture). The
acceptance line "Omitting the flag is byte-identical to today" is pinned to:

> With `--retries` omitted (or `--retries 0`), for a given input the result
> object contains **no `attempts` key** and **no retry-related warning entries**,
> and — after deleting the enumerated dynamic fields `durationMs` and
> `sessionDir` — is **deep-equal** to the result the same input produces with the
> flag entirely absent.

Rationale for (b): option (a) would force a fixed-clock / injected-session-path
seam into production purely for a test, adding surface area the wrapper does not
otherwise need; (b) tests exactly the real guarantee (the flag at its default is
inert) against the only two fields that legitimately vary. Enumerated dynamic
fields: **`durationMs`, `sessionDir`** — nothing else on the success or failure
emit is nondeterministic given a fixed diagnostic tail (`error` is deterministic
from the fixed tail via `formatCodexRunFailure`).

Open question (non-blocking): whether the maintainer prefers `attempts` always
present (cleaner for consumers) over the gated omission. Default chosen: gated,
to honor this contract.

### Interaction with other flags

- `--quiet`: unchanged; gates live streaming, not warnings. Retry warnings go to
  `warnings[]` and mirror to stderr like the install-check warning.
- `--out`: unchanged; the single final JSON (now possibly carrying `attempts` +
  retry warnings) is written once at the end.
- `--debug`: `sessionDir` preserved as today. All attempts reuse one
  `sessionDir` / `lastMessagePath`; safe because `lastMessagePath` is read only
  after a code-0 exit and codex overwrites it via `--output-last-message`.
  Optional pre-attempt `rmSync(lastMessagePath, {force:true})` guards against any
  stale prior message.
- `--reasoning-effort` / `--model` / `--permissions` / `--profile`: identical
  spawn args on every attempt (same `buildSpawnArgs`).

### Affected files

- `codex-task.mjs` — arg parse (`--retries`), retry loop in `main()`,
  `classifyTransient()` (+ `NON_TRANSIENT_PATTERNS` / `TRANSIENT_PATTERNS`),
  backoff constant + env override, gated `attempts` field, `printUsage` text.
- `SKILL.md` — see docs section.
- `tests/cli-smoke.test.mjs` — extend fake-codex shim + new tests.
- No changes to `install.mjs` or `scripts/permission-matrix.mjs`.

### Test strategy and seams

`makeFakeCodex()` (`tests/cli-smoke.test.mjs:204`) builds a per-call temp dir
with a `codex.cmd`/`codex` shim delegating to `fake-codex.mjs`; PATH is
prepended so the fake wins. The shim answers `--version` and exits BEFORE any
other logic (`fakeCodexJs`, line 233), so the `checkCodexAvailable` preflight
never touches per-run state — a disk counter therefore equals the number of
`codex exec` invocations, i.e. the true attempt count.

Extend `fakeCodexJs` with an env-driven, on-disk fail-then-succeed mode (state
must live on disk because each `codex exec` is a fresh process):

- `FAKE_CODEX_STATE` — path to a counter file. On every non-`--version`
  invocation the shim reads the integer (default 0), increments, writes it back.
  `makeFakeCodex` returns this path (inside `fake.dir`, per-test isolated).
- `FAKE_CODEX_FAIL_TIMES` (int, default 0) — number of leading invocations that
  fail: if `count <= FAIL_TIMES`, write `FAKE_CODEX_FAIL_MESSAGE` to stderr and
  `process.exit(1)`.
- `FAKE_CODEX_FAIL_MESSAGE` — the stderr text on a failing invocation.
- `FAKE_CODEX_BAD_FINAL` (flag) — on the SUCCESS branch, write non-JSON garbage
  to the `--output-last-message` path and exit 0 (drives the code-0 malformed
  path).

All retry tests set `CODEX_TASK_RETRY_DELAY_MS=0` (no real sleeps) and, per the
review, **assert the state-file counter (true invocation count) alongside the
reported `attempts` field** — they must agree.

Tests (existing ones retained, renumbered; NEW marks review-mandated additions):

1. transient-retry-success (capacity): `FAKE_CODEX_FAIL_TIMES=1`, message
   "Selected model is at capacity", `--retries 2` -> status 0, `ok:true`,
   `attempts:2`, exactly one warning `/at capacity/i`; state counter == 2.
2. **NEW 429-rate-limit transient class**: `FAKE_CODEX_FAIL_TIMES=1`, message
   "Error: 429 rate limit exceeded, please try again later", `--retries 1` ->
   status 0, `ok:true`, `attempts:2`, one warning `/429|rate limit/i`; state
   counter == 2. Proves 429 is transient and NOT excluded.
3. non-transient-no-retry (auth): `FAKE_CODEX_FAIL_TIMES=1`, message
   "stream error: missing bearer token", `--retries 2` -> the shim *would*
   succeed on attempt 2, but the wrapper must NOT retry: status 1, `ok:false`,
   `attempts:1`; state counter == 1.
4. **NEW unsupported-model exclusion (non-transient)**: message "model
   gpt-5.6-terra is not supported for this ChatGPT account",
   `FAKE_CODEX_FAIL_TIMES=1`, `--retries 2` -> not retried, status 1, `ok:false`,
   `attempts:1`; state counter == 1.
5. **NEW unsupported reasoning-effort exclusion (non-transient)**: message
   "reasoning effort 'xhigh' is not supported for this model",
   `FAKE_CODEX_FAIL_TIMES=1`, `--retries 2` -> not retried, status 1,
   `attempts:1`; state counter == 1. Guards the wording the prior draft missed.
6. **NEW mixed durable+transient tail (exclusion-first wins)**: message
   "Selected model is at capacity. You've hit your weekly usage limit.",
   `FAKE_CODEX_FAIL_TIMES=1`, `--retries 2` -> not retried, status 1,
   `attempts:1`; state counter == 1. Proves durable exclusion beats co-occurring
   transient wording.
7. retries-exhausted: `FAKE_CODEX_FAIL_TIMES=5`, capacity message, `--retries 2`
   -> status 1, `ok:false`, `attempts:3` (1 initial + 2 retries), two retry
   warnings, `error` carries the capacity tail; state counter == 3.
8. sandbox-wrapper transient class: message "windows unelevated restricted-token
   sandbox cannot enforce split writable root sets directly; refusing to run
   unsandboxed", `FAKE_CODEX_FAIL_TIMES=1`, `--retries 1` -> status 0,
   `attempts:2`; state counter == 2.
9. **NEW exit-0 malformed-final-message-JSON (must NOT retry)**:
   `FAKE_CODEX_BAD_FINAL=1` (exit 0, garbage final message), `--retries 2` ->
   status 1, `ok:false`, error `/not valid JSON|no extractable JSON/`, and
   **state counter == 1** (a single invocation — proves the readResult contract
   failure never re-enters the retry loop). `attempts:1` present (retriesEnabled).
10. byte-identical / field-gating (contract option b): run the plain success
    fake once with the flag OMITTED and once with `--retries 0`. Parse both
    JSONs; assert neither has an `attempts` key and neither warning matches
    `/attempt|retry/i`; delete `durationMs` and `sessionDir` from both and
    `assert.deepEqual` them. Also run the plain FAILURE fake (capacity message,
    large `FAIL_TIMES`) with flag omitted vs `--retries 0` and assert the same
    (attempts absent, deep-equal modulo the two dynamic fields).
11. `--help` documents `--retries` (extend the help-contract test with a
    `/--retries/` assertion).
12. invalid value: `--retries -1` and `--retries abc` -> status 2, stderr
    `/--retries must be a non-negative integer/`.

`npm run check` (node --check) and `npm test` (node --test) are the acceptance
gate; both must pass in `../codex-task`.

### Documentation updates

- `SKILL.md` "How to invoke" synopsis: add `[--retries N]`.
- `SKILL.md` Wrapper options: new `--retries` bullet — default 0 preserves
  current behavior; retries only transient infrastructure classes (model-capacity
  incl. "at capacity" and 429/rate-limit backpressure; sandbox-wrapper prep
  failures); explicitly NOT auth, unsupported model/effort, durable quota/usage
  cap, or JSON/contract failures; short fixed backoff; serial (never parallel).
- `SKILL.md` Output / Field semantics: document `attempts` (present only when
  `--retries > 0`) and the per-retry warning entries.
- `SKILL.md` "After invoking" / Failure modes: point "re-run only if it looks
  like a transient codex hiccup" at `--retries` as the built-in automated path.
- `codex-task.mjs` `printUsage`: mirror the flag doc (a help-contract test
  asserts on it).
- No README index change (README not in scope).

### Risks and edge cases

- Misclassification (primary risk). A non-transient tail containing a transient
  substring wastes up to `n` bounded retries; the higher-stakes direction
  (retrying durable quota/auth) is blocked by the Phase-1 exclusion checked
  first. The key judgement call is the 429/"rate limit" boundary: transient
  unless an explicit durable-cap phrase co-occurs. Both directions are covered by
  named tests (2, 6).
- Wall-clock cost. Failed capacity attempts happened after 180s+ of work; `n`
  retries multiply worst-case latency. `n` bounds it; default 0 is opt-in; SKILL
  notes the cost.
- Idempotency of write tasks. Both observed transient classes fail *before* a
  successful write (capacity = pre-work; sandbox-wrapper = apply_patch refused),
  and codex runs `--ephemeral` (fresh read each attempt), so retry is as safe as
  the manual re-run it replaces. A transient failure *after* a partial write is
  theoretically possible; risk is identical to today's human manual retry, noted
  not solved.
- Stale `lastMessagePath` across attempts: mitigated (read only after code 0;
  codex overwrites) plus optional pre-attempt unlink.
- Test flakiness from real sleeps: eliminated by `CODEX_TASK_RETRY_DELAY_MS=0`.

### Open questions (non-blocking; defaults chosen)

1. `attempts` presence gated to `--retries > 0` (honors the structural
   byte-identical contract). Confirm vs always-present.
2. Backoff magnitude: fixed 2000 ms (env-overridable). Acceptable, or 0/1000 ms?
3. 429 / "rate limit" transient vs durable-quota exclusion — confirm the split
   (retry short-term throttle; do not retry usage-cap exhaustion).

None block implementation.

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-10T17:45:37Z: Ensured git branch local-board/T20260710T1534Z-codex-task-retries-for-transient-capacity-and-sandbox-failures-codex-task-repo (already-current).

- 2026-07-10T17:51:05Z: Completed design via claude-subagent:local-board-designer@opus: Opt-in --retries (default 0, byte-identical omitted); classifyTransient text-pattern classifier (capacity/sandbox-wrapper) with non-transient exclusions checked first; fixed 2s backoff env-overridable; attempts field gated; fake-codex fail-N-then-succeed seam; SKILL/usage docs; local-board guidance = follow-up. Estimate 4pts basis T20260710T1533Z.

- 2026-07-10T17:52:56Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: none requested (CLI wrapper retry flag; no security/UI/UX triggers)

- 2026-07-10T18:01:57Z: Design review (sol@xhigh): FAIL. [High] Exclusion-first patterns break the transient/durable split: blanket 'limit exceeded' catches '429 rate limit exceeded' before transient patterns; bare 'try again' misclassifies durable failures; unsupported-effort exclusions omit 'reasoning effort' wording. [Medium] Byte-identical test as specified is unstable (durationMs, sessionDir) and only checks attempts-absence; needs deterministic seams + baseline fixture or clarified requirement. [Medium] Coverage gaps: 429-transient class, unsupported model/effort exclusions, mixed durable+transient tails, code-zero malformed-JSON no-retry; assert fake state counter to prove invocation count. Disposition: designer revision.
