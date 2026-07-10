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
updated: 2026-07-10T18:50:05Z
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
non-zero `codex exec` exit, isolate the **terminal error portion** of the
captured diagnostic tail and classify it. If the failure is a recognized
**transient infrastructure** class (model capacity / sandbox-wrapper prep) the
wrapper retries the invocation in-process, serially, up to `n` times with a
short fixed backoff. Every other failure — auth, unsupported model/effort,
durable quota/usage-cap exhaustion, JSON/contract failures, task-level
partial/failed — is non-transient and never retried. Default `n = 0` preserves
today's behavior.

This is revision #2 (post design re-review FAIL). It fixes the classifier's
fatal blind spot to the codex config banner, narrows the reasoning-effort
exclusion to explicit rejection grammar, tightens the structural-equivalence
("byte-identical") contract to the exact tested paths, and specifies gated
`attempts: 0` on the pre-retry-loop early-failure emits.

### Related tickets and conflicts

- Basis / sibling: `T20260710T1533Z` (done, estimate 2) — process-hardening
  text edits from the same 2026-07-10 parallel-run retro. This ticket is the
  *code* counterpart.
- Same cross-repo pattern as `T20260710T0036Z` (sibling `../codex-task` tracked
  on this board; no board of its own).
- No file conflicts: touches only `../codex-task` (`codex-task.mjs`, `SKILL.md`,
  `tests/cli-smoke.test.mjs`). Board/evidence stay in local-board.
- Follow-up (OUT OF SCOPE, flag only): local-board's Delegation skill text could
  later mention `codex-task --retries`; that edits local-board files, so it is a
  separate ticket.

### Why text-pattern classification is the only signal

The wrapper captures codex output as `stdoutTail` / `stderrTail` (last 4000
chars each) in `runCodex` (`codex-task.mjs:463-478`), and on
`runResult.code !== 0` builds the diagnostic via `formatCodexRunFailure`
(`:484`) which sets `tail = (stderrTail || stdoutTail || '').trim()`. There is
**no structured JSON on the failure path** — the result JSON is only the model's
final message, written via `--output-last-message`, and only exists after a
clean (code 0) exit. Exit codes are uninformative: codex returns non-zero for
every failure class with no distinct code. So error-text pattern matching on the
diagnostic tail is the only viable signal, exactly what `codexFailureHint`
(`:491`) already does.

### Tail isolation before classification (fixes review High)

**Problem.** `codex exec` writes a configuration banner to stderr **before** any
diagnostic — a block of `key: value` lines that includes a literal
`reasoning effort: <level>` line — followed by the echoed prompt frame, then
(much later) the terminal error line. Because codex streams model
thinking/output to stdout but keeps the banner and the final error on stderr,
the whole of stderr on a realistic capacity failure is typically under the
4000-char `stderrTail` cap, so `stderrTail` still contains the banner. A
classifier that scans the **whole** tail therefore sees `reasoning effort: high`
and, under the prior broad effort exclusion, mis-classifies a genuine capacity
failure as durable and suppresses the retry. This is the review's High.

**Fix — classify only the terminal error segment.** Classification runs on the
output of a new pure helper `isolateTerminalError(tail)`, never on the raw tail.
The full raw tail is still what gets reported in the `error` field via
`formatCodexRunFailure`; only the *classification input* is narrowed.

Mechanism (robust to the 4000-char cap, which can truncate the head mid-line, so
"strip up to the banner" alone is unreliable — a last-lines rule is always
well-defined):

```js
// Leading codex banner / prompt-frame grammar. Config lines are "key: value"
// or rule/timestamp/prompt-echo markers. The "reasoning effort: <level>" banner
// line matches here and is dropped as a leading banner line.
const BANNER_LINE = /^(?:-{3,}|=+|\[?\d{4}-\d\d-\d\d|OpenAI Codex|codex\b|version\b|workdir\b|model\b|provider\b|approval\b|sandbox\b|reasoning (?:effort|summaries)\b|tokens used\b|user instructions\b)/i;

function isolateTerminalError(tail, maxLines = 8) {
  const lines = tail.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // 1) strip the contiguous leading banner/config block (covers the short-tail
  //    case where the banner survives inside the 4000-char window).
  let i = 0;
  while (i < lines.length && BANNER_LINE.test(lines[i])) i++;
  const body = i < lines.length ? lines.slice(i) : lines;
  // 2) keep only the trailing diagnostic window (covers the long-tail case and
  //    any interleaved banner remnants). The terminal codex error is at most a
  //    few lines; 8 is a comfortable ceiling that still excludes a full banner.
  return body.slice(-maxLines).join('\n');
}
```

The two steps are complementary: step 1 removes the banner when stderr is short
enough that it survives at the head of the window; step 2 removes it when the
banner is followed by many streamed lines. On the retro's real tails the
terminal line (`Selected model is at capacity`, or the sandbox refusal line)
survives intact and is what gets classified. `maxLines` is a named constant.

### Classifier redesign: durable-exclusion-first, two ordered phases

`classifyTransient(detail)` — where `detail = isolateTerminalError(tail)` —
runs **two ordered phases** and returns a transient-class label or `null`.

Phase 1 — DURABLE / non-transient exclusions, evaluated FIRST. Any match returns
`null` immediately (even when a transient substring co-occurs — this is how
"exclusion-first wins" on mixed tails). Wordings anchored to what
`codexFailureHint` recognizes (`:491-508`):

```js
// Phase 1: durable failures — retry cannot help. Any match => returns null.
const NON_TRANSIENT_PATTERNS = [
  // auth / login expiry
  /missing bearer|unauthoriz(?:ed|ation)|authentication|\b401\b|codex login|not logged in|invalid api key/i,
  // unsupported model
  /model .*not supported|not supported.*ChatGPT account|unsupported model|\b400\b/i,
  // unsupported / rejected reasoning effort — NARROWED to explicit rejection
  // grammar so the banner line "reasoning effort: high" NEVER matches (fixes High).
  /(?:reasoning[ _]?effort|model_reasoning_effort)[^.\n]{0,40}(?:not supported|unsupported|invalid|not a valid)|(?:unsupported|invalid)(?: value(?: for)?)?[^.\n]{0,40}(?:reasoning[ _]?effort|model_reasoning_effort)/i,
  // durable quota / usage-cap exhaustion — CONTEXTUAL phrases only. Deliberately
  // NO bare "limit exceeded" and NO bare "rate limit" here, so transient
  // "429 rate limit exceeded" is NOT swallowed by this phase.
  /usage limit|weekly limit|monthly limit|usage cap|plan limit|\bquota\b|(?:hit|reached|exceeded) your[^.\n]*\blimit\b/i,
];
```

The narrowed effort pattern matches both rejection orderings —
`reasoning effort 'xhigh' is not supported` and
`unsupported value for model_reasoning_effort` — but does **not** match the bare
banner echo `reasoning effort: high` (no rejection token within 40 chars of the
effort token). This is defense-in-depth alongside `isolateTerminalError`, which
already strips that banner line.

Phase 2 — TRANSIENT classes, evaluated only if Phase 1 did not match. Return the
label of the first list that matches, else `null`:

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

Worked classifications (each is a named test below), all on the *isolated*
segment:

- Banner-bearing capacity tail: full banner incl. `reasoning effort: high` +
  prompt echo + trailing `Selected model is at capacity` -> `isolateTerminalError`
  strips the banner; Phase 1 no match (narrowed effort pattern does not fire on
  the surviving line); Phase 2 `at capacity` -> **model-capacity** (transient).
  This is the exact case the re-review flagged; it now retries.
- `Error: 429 rate limit exceeded, please try again later` -> Phase 1 no match;
  Phase 2 `\b429\b` -> **model-capacity**.
- `You've hit your weekly usage limit` -> Phase 1 (`usage limit`, `hit your ...
  limit`) -> **null**.
- Mixed `Selected model is at capacity. You've hit your weekly usage limit.`
  -> Phase 1 `usage limit` -> **null** (exclusion-first wins).
- `stream error: missing bearer token` -> Phase 1 auth -> **null**.
- `model gpt-5.6-terra is not supported for this ChatGPT account` -> Phase 1
  unsupported-model -> **null**.
- `unsupported value for model_reasoning_effort` and `reasoning effort 'xhigh'
  is not supported` -> Phase 1 narrowed effort -> **null**.
- `windows unelevated restricted-token sandbox cannot enforce split writable
  root sets directly; refusing to run unsandboxed` -> Phase 2 sandbox-wrapper.
- `failed to prepare windows sandbox wrapper` -> Phase 2 sandbox-wrapper.

Design notes:

- The transient sandbox list is intentionally NARROW (wrapper-prep phrases only),
  not the broad `codexFailureHint` sandbox branch. A generic permission/
  read-only denial is a config problem, not transient, so it is NOT retried.
- Any co-occurring durable-cap phrase forces `null` (conservative: when in doubt
  between throttle and cap, do not retry).

### Which failure path retries wrap

Retries wrap **only** the `runCodex` + `runResult.code !== 0` branch in `main()`
(`codex-task.mjs:758`). They explicitly do NOT cover:

- Spawn errors (`child.on('error')` -> "failed to spawn codex", `:746`):
  environmental, already gated by the `checkCodexAvailable` preflight. A spawn
  throw is part of attempt 1 and emits immediately (with `attempts` when gated).
- `readResult` failures on a code-0 exit (missing / empty / non-JSON / malformed
  final message, `:770`): contract failures — a Non-goal; they need a prompt
  fix, not a repeat. This branch is structurally *after* the retry loop and only
  reached on a clean exit, so it can never trigger a retry. Asserted by two
  dedicated tests (exit-0 malformed JSON and exit-0 missing-final-message).
- Task-level `taskResult` of `partial` / `blocked` / `failed`: substantive
  outcomes on a clean exit; never retried.

### Implementation approach (codex-task.mjs)

1. Arg parsing (`parseArgs`): add `--retries`. Parse `next` as a non-negative
   integer; reject negatives / non-numbers / missing value via
   `usageErr('--retries must be a non-negative integer')` (exit 2, no result
   object). Store `retries` (number, default 0). Derive
   `retriesEnabled = retries > 0` for output gating.
2. Attempt counter: declare `let attempt = 0;` at the top of `main()` (right
   after `parseArgs`), BEFORE any structured emit. Every structured `emit`
   includes attempts uniformly and gated:
   `...(retriesEnabled ? { attempts: attempt } : {})`, inserted at a fixed
   position in each object literal so the shape is stable when present. Pre-loop
   emits therefore naturally carry `attempts: 0` (see below); loop/post-loop
   emits carry the incremented count.
3. Retry loop in `main()`: replace the single `runCodex` call + `code !== 0`
   emit with a bounded loop:
   - loop: `attempt++`; run `runCodex(...)` inside the existing spawn-error
     try/catch; if `runResult.code === 0` break; else
     `const cls = classifyTransient(isolateTerminalError(tailOf(runResult)))`;
     if `cls` AND `attempt <= retries` (retries remain): push a warning
     (`codex attempt ${attempt}/${retries + 1} failed (${cls}): <first line of
     isolated tail>; retrying`), optionally `rmSync(lastMessagePath,
     {force:true})`, sleep `backoffMs` unless it is the final attempt, continue;
     else break.
   - `tailOf` derives the same `(stderrTail || stdoutTail).trim()` string that
     `formatCodexRunFailure` uses; `isolateTerminalError` narrows it for
     classification only. `error` still reports the full tail.
4. Backoff: **short fixed** delay (no exponential — capacity recovered on the
   immediate manual retry in the retro). Constant `RETRY_BACKOFF_MS` (2000 ms),
   overridable via env `CODEX_TASK_RETRY_DELAY_MS` so tests set `0` and never
   sleep. No backoff after the final failed attempt.

Serial discipline: the loop `await`s each `runCodex` before the next; retries are
strictly sequential in the single process. No new concurrency, no `CODEX_HOME`
isolation.

### attempts on pre-retry-loop early failures (fixes review Medium 3)

Three structured results are emitted **after** argument parsing but **before**
the retry loop runs, at which point zero `codex exec` invocations have happened.
Each MUST carry `attempts: 0` when `retriesEnabled` (the counter is still 0), so
the contract reads precisely: *when `--retries > 0`, `attempts` is present on
every structured result and equals the number of `codex exec` invocations (0
before the loop, >=1 once the loop runs).* The three `attempts: 0` sites:

1. Invalid working directory — `--cwd ... does not exist` emit (`:676-685`,
   exit 2).
2. Codex preflight failure — `checkCodexAvailable` not-ok emit (`:692-702`,
   exit 1).
3. Session-directory creation failure — `mkdirSync` catch emit (`:713-723`,
   exit 1).

Argument-parse failures (`--retries -1`, unknown flag) exit via `usageErr`
(exit 2) BEFORE any result object is built and emit no structured JSON, so they
are outside this contract. The `attempts: 0` uniform-emit approach (step 2 above)
covers all three sites automatically.

### JSON result reporting and the structural-equivalence contract

- `attempts`: integer = number of `codex exec` invocations (0 = failed before
  the loop; 1 = one invocation, no retry; 2 = one retry; ...). Present only when
  `--retries > 0`.
- Warnings: one entry per retried failure, naming the transient class and attempt
  index, appended to the existing `warnings` array.

`emit` (`:637`) serializes with `JSON.stringify(r, null, 2)` in object-literal
insertion order.

**"Byte-identical" acceptance line — CHOICE: option (b), a NARROW structural
contract** (not option (a), fixed-clock/session injection + stdout fixture).
Rationale: option (a) forces a fixed-clock / injected-session-path seam into
production purely for a test; (b) tests the real guarantee — that the flag at its
default is inert — against only the fields that legitimately vary. The prior
draft's dynamic-field enumeration (`durationMs`, `sessionDir`) was incomplete as
a *universal* claim, because the generated session path is also embedded in:

- `error` on the session-dir creation-failure path (`failed to create session
  dir ${sessionDir}`) and the missing/unreadable final-message paths (`codex did
  not write a final message file at ${lastMessagePath}` / `failed to read final
  message file`);
- `warnings` on the cleanup-failure path (`failed to clean up scratch dir
  ${sessionDir}`);

and a real codex diagnostic tail can carry a codex session ID, which would flow
into `error`.

**Narrowing (the chosen fix): the structural-equivalence contract is scoped to
exactly the two tested emit paths, not promised as universal deep-equality:**

> Contract scope: the two paths exercised by the structural-equivalence test —
> (i) the clean-success emit (`:799`), and (ii) the `runResult.code !== 0`
> failure emit (`:759`) driven by a **fixed** fake diagnostic tail. On both, the
> ONLY nondeterministic fields are `durationMs` and `sessionDir`:
> - path (i): `sessionDir` is `null` (cleaned up) and `error` is absent, so only
>   `durationMs` varies;
> - path (ii): `error` is `formatCodexRunFailure` of the fixed fake tail
>   (deterministic — the fake message carries no session ID), `sessionDir` is the
>   generated path (dynamic), `durationMs` is dynamic; no cleanup warning fires
>   (cleanup runs only on the success path).
>
> For a given input on these two paths: with `--retries` omitted (or `0`) the
> result has **no `attempts` key** and **no retry-related warning**, and after
> deleting `durationMs` and `sessionDir` is **deep-equal** to the result the same
> input produces with the flag entirely absent. This is explicitly NOT a
> universal deep-equality claim: the session-dir-failure, missing-final-message,
> unreadable-final-message, and cleanup-failure paths additionally embed the
> session path in `error`/`warnings` and are out of the contract's scope (their
> no-retry behavior is asserted separately by invocation-count, not by
> deep-equality).

The `attempts` gating (present only when `retriesEnabled`) is what makes the
default byte-identical to today: with the flag absent the key is never added.

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
  Optional pre-attempt `rmSync(lastMessagePath, {force:true})` guards a stale
  prior message.
- `--reasoning-effort` / `--model` / `--permissions` / `--profile`: identical
  spawn args on every attempt (same `buildSpawnArgs`).

### Affected files

- `codex-task.mjs` — arg parse (`--retries`), attempt counter + uniform gated
  `attempts` emit, retry loop in `main()`, `isolateTerminalError()`,
  `classifyTransient()` (+ `NON_TRANSIENT_PATTERNS` / `TRANSIENT_PATTERNS`),
  backoff constant + env override, `printUsage` text.
- `SKILL.md` — see docs section.
- `tests/cli-smoke.test.mjs` — extend fake-codex shim + new tests.
- No changes to `install.mjs` or `scripts/permission-matrix.mjs`.

### Test strategy and seams

`makeFakeCodex()` (`tests/cli-smoke.test.mjs:204`) builds a per-call temp dir
with a `codex.cmd`/`codex` shim delegating to `fake-codex.mjs`; PATH is prepended
so the fake wins. The shim answers `--version` and exits BEFORE any other logic
(`fakeCodexJs`, `:233`), so the `checkCodexAvailable` preflight never touches
per-run state — a disk counter therefore equals the number of `codex exec`
invocations, i.e. the true attempt count.

Extend `fakeCodexJs` with env-driven, on-disk modes (state lives on disk because
each `codex exec` is a fresh process):

- `FAKE_CODEX_STATE` — path to a counter file. On every non-`--version`
  invocation the shim reads the integer (default 0), increments, writes it back.
  `makeFakeCodex` returns this path (inside `fake.dir`, per-test isolated).
- `FAKE_CODEX_FAIL_TIMES` (int, default 0) — leading invocations that fail: if
  `count <= FAIL_TIMES`, write `FAKE_CODEX_FAIL_MESSAGE` to stderr and
  `process.exit(1)`.
- `FAKE_CODEX_FAIL_MESSAGE` — the stderr text on a failing invocation (may be a
  multi-line string carrying a codex banner, for the banner-bearing test).
- `FAKE_CODEX_BAD_FINAL` (flag) — on the SUCCESS branch, write non-JSON garbage
  to the `--output-last-message` path and exit 0 (code-0 malformed path).
- `FAKE_CODEX_NO_FINAL` (flag) — on the SUCCESS branch, do NOT write the
  `--output-last-message` file and exit 0 (code-0 missing-final-message path).
- `FAKE_CODEX_FAIL_VERSION` (flag) — make the `--version` branch exit non-zero
  (drives a `checkCodexAvailable` preflight failure).

All retry tests set `CODEX_TASK_RETRY_DELAY_MS=0` (no real sleeps) and assert the
state-file counter (true invocation count) alongside the reported `attempts`
field — they must agree.

Tests (existing retained/renumbered; NEW marks review-mandated additions):

1. transient-retry-success (capacity): `FAIL_TIMES=1`, message "Selected model
   is at capacity", `--retries 2` -> status 0, `ok:true`, `attempts:2`, exactly
   one warning `/at capacity/i`; counter == 2.
2. **NEW banner-bearing capacity (fixes High)**: `FAIL_TIMES=1`, message = a
   realistic multi-line codex frame — the config banner including the literal
   line `reasoning effort: high`, then a prompt-echo line, then a final line
   `Selected model is at capacity` — `--retries 2` -> status 0, `ok:true`,
   `attempts:2`, one warning `/at capacity/i`; counter == 2. Proves the banner's
   `reasoning effort:` line does NOT suppress the retry.
3. **NEW 429-rate-limit transient class**: `FAIL_TIMES=1`, message "Error: 429
   rate limit exceeded, please try again later", `--retries 1` -> status 0,
   `attempts:2`, one warning `/429|rate limit/i`; counter == 2.
4. non-transient-no-retry (auth): `FAIL_TIMES=1`, "stream error: missing bearer
   token", `--retries 2` -> shim would succeed on attempt 2, but wrapper must NOT
   retry: status 1, `ok:false`, `attempts:1`; counter == 1.
5. **NEW unsupported-model exclusion**: "model gpt-5.6-terra is not supported for
   this ChatGPT account", `FAIL_TIMES=1`, `--retries 2` -> not retried, status 1,
   `attempts:1`; counter == 1.
6. **NEW unsupported reasoning-effort exclusion**: "reasoning effort 'xhigh' is
   not supported for this model", `FAIL_TIMES=1`, `--retries 2` -> not retried,
   status 1, `attempts:1`; counter == 1. Guards the narrowed effort pattern's
   true-positive side.
7. **NEW mixed durable+transient tail (exclusion-first wins)**: "Selected model
   is at capacity. You've hit your weekly usage limit.", `FAIL_TIMES=1`,
   `--retries 2` -> not retried, status 1, `attempts:1`; counter == 1.
8. retries-exhausted: `FAIL_TIMES=5`, capacity message, `--retries 2` -> status
   1, `ok:false`, `attempts:3`, two retry warnings, `error` carries the capacity
   tail; counter == 3.
9. sandbox-wrapper transient class: "windows unelevated restricted-token sandbox
   cannot enforce split writable root sets directly; refusing to run
   unsandboxed", `FAIL_TIMES=1`, `--retries 1` -> status 0, `attempts:2`;
   counter == 2.
10. **NEW exit-0 malformed-final-message-JSON (must NOT retry)**:
    `FAKE_CODEX_BAD_FINAL=1`, `--retries 2` -> status 1, `ok:false`, error
    `/not valid JSON|no extractable JSON/`, `attempts:1`, counter == 1 (single
    invocation proves the readResult contract failure never re-enters the loop).
11. **NEW exit-0 missing-final-message-file (must NOT retry, fixes Medium 2
    coverage)**: `FAKE_CODEX_NO_FINAL=1`, `--retries 2` -> status 1, `ok:false`,
    error `/did not write a final message/`, `attempts:1`, counter == 1.
12. **NEW preflight-failure-with-retries (fixes Medium 3)**:
    `FAKE_CODEX_FAIL_VERSION=1`, `--retries 2` -> status 1, `ok:false`, error
    from `formatCodexUnavailable`, `attempts:0`, counter == 0 (no `codex exec`
    ever ran).
13. structural-equivalence / field-gating (contract option b, narrowed to the
    two in-scope paths): (a) run the plain SUCCESS fake once with the flag
    OMITTED and once with `--retries 0`; assert neither JSON has an `attempts`
    key and no warning matches `/attempt|retry/i`; delete `durationMs` and
    `sessionDir` from both and `assert.deepEqual`. (b) Same for the plain
    FAILURE fake (capacity message, large `FAIL_TIMES`): flag omitted vs
    `--retries 0`, assert attempts absent, no retry warning, deep-equal modulo
    `durationMs` + `sessionDir`.
14. `--help` documents `--retries` (extend the help-contract test with
    `/--retries/`).
15. invalid value: `--retries -1` and `--retries abc` -> status 2, stderr
    `/--retries must be a non-negative integer/`.

`npm run check` (node --check) and `npm test` (node --test) are the acceptance
gate; both must pass in `../codex-task`.

### Documentation updates

- `SKILL.md` "How to invoke" synopsis: add `[--retries N]`.
- `SKILL.md` Wrapper options: new `--retries` bullet — default 0 preserves
  current behavior; retries only transient infrastructure classes (model-capacity
  incl. "at capacity" and 429/rate-limit; sandbox-wrapper prep failures);
  explicitly NOT auth, unsupported model/effort, durable quota/usage cap, or
  JSON/contract failures; short fixed backoff; serial (never parallel).
- `SKILL.md` Output / Field semantics: document `attempts` (present only when
  `--retries > 0`; equals `codex exec` invocation count, 0 if it failed before
  the loop) and the per-retry warning entries.
- `SKILL.md` "After invoking" / Failure modes: point "re-run only if it looks
  like a transient codex hiccup" at `--retries` as the built-in automated path.
- `codex-task.mjs` `printUsage`: mirror the flag doc (a help-contract test
  asserts on it).
- No README index change (README not in scope).

### Risks and edge cases

- Banner-vs-error isolation (primary new risk). `isolateTerminalError` assumes
  the codex terminal error is the last non-blank line(s) and the banner is a
  leading `key: value` block. If a future codex version reorders output or emits
  a >8-line terminal error, the isolation could clip it; `maxLines` is a tunable
  constant and the banner-bearing test (2) pins the current shape. Mitigation:
  the full raw tail is still reported in `error` regardless.
- Misclassification. A non-transient tail containing a transient substring wastes
  up to `n` bounded retries; the higher-stakes direction (retrying durable
  quota/auth) is blocked by Phase-1-first. The 429/"rate limit" boundary is the
  key judgement call: transient unless an explicit durable-cap phrase co-occurs.
  Both directions are covered by tests (3, 7).
- Wall-clock cost. Failed capacity attempts happened after 180s+ of work; `n`
  retries multiply worst-case latency. `n` bounds it; default 0 is opt-in.
- Idempotency of write tasks. Both observed transient classes fail *before* a
  successful write (capacity = pre-work; sandbox-wrapper = apply_patch refused),
  and codex runs `--ephemeral` (fresh read each attempt), so retry is as safe as
  the manual re-run it replaces. A transient failure *after* a partial write is
  identical in risk to today's human manual retry; noted, not solved.
- Stale `lastMessagePath` across attempts: mitigated (read only after code 0;
  codex overwrites) plus optional pre-attempt unlink.
- Test flakiness from real sleeps: eliminated by `CODEX_TASK_RETRY_DELAY_MS=0`.

### Open questions (non-blocking; defaults chosen)

1. `attempts` presence gated to `--retries > 0` (honors the structural contract).
   Confirm vs always-present.
2. Backoff magnitude: fixed 2000 ms (env-overridable). Acceptable, or 0/1000 ms?
3. `isolateTerminalError` `maxLines` = 8 and the banner grammar are pinned to the
   current codex output shape; confirm no known codex mode emits a multi-line
   terminal diagnostic longer than that.

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

- 2026-07-10T18:22:51Z: Design re-review #2 (sol@xhigh): FAIL. [High] codex exec writes a config banner incl. 'reasoning effort: <level>' to stderr before the diagnostic, so the broad reasoning-effort exclusion matches on realistic capacity failures and suppresses the retry (codex issue 22047); isolate the terminal error portion, narrow the effort exclusion to explicit rejection grammar, add a banner-bearing capacity test. [Medium] Structural-equivalence dynamic-field enumeration incomplete (session path in error/warnings on some failure paths, session IDs in tails); narrow contract to tested fixed-tail paths or normalize. [Medium] attempts contract vs pre-loop structured failures (bad cwd, preflight, session-dir) - specify gated attempts:0 + one preflight test. Disposition: revision #2.

- 2026-07-10T18:50:05Z: Design review #3 (sol@xhigh): FAIL. [High] isolateTerminalError BANNER_LINE misses real banner lines (session id:, user) and codex can emit output before the final error, so the 8-line window can still trip durable exclusions and the warning first-line would be banner text (test 2 internally inconsistent); classify the final error line(s) only or define a reliable boundary. [Medium] Bare please-try-again still in Phase 2 - require accompanying capacity/rate/temporary signal. [Medium] lastMessagePath reuse across retries can serve stale content on a later code-zero no-message attempt - mandatory pre-retry delete or attempt-specific path + sentinel test. Disposition: revision #3; round 4 = hard stop (non-PASS/CONCERNS on new blockers goes to questions).
