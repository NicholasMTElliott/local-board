---
id: T20260710T1534Z
type: task
status: ready_for_review
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
updated: 2026-07-11T20:30:44Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "design-review:codex-task:read-only@gpt-5.6-sol", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku"]
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
`../codex-task`, all code at `C:/Users/Nicho/Documents/codex-task`). The wrapper
retries an invocation, serially and in-process, up to `n` times with a short
fixed backoff when it observes the **single** supported transient-infrastructure
trigger, and never otherwise. Default `n = 0` preserves today's behavior
byte-for-byte.

The one retry trigger is:

- **Trigger A — non-zero exit, transient terminal diagnostic.** `codex exec`
  exits non-zero and the diagnostic tail's terminal line classifies as a
  recognized transient class (model-capacity or sandbox-wrapper prep failure).
  This is the "capacity mid-run" shape from the 2026-07-10 parallel-run retro.

Every other outcome — auth, unsupported model/effort, durable quota/usage-cap
exhaustion, generic "please try again" errors, JSON/contract failures
(missing/malformed final message), and **every** clean (`code === 0`) exit,
including task-level `completed`/`partial`/`blocked`/`failed` — is non-transient
and never retried.

Descope note (single attribution; do not re-expand): an auto-retry for the
clean-exit Windows sandbox case (codex exits 0 and reports `taskResult: blocked`)
was removed per the user decision of 2026-07-11 (option 2). Do NOT re-add a
clean-exit retry without a structured tool-failure record from codex's event
output — matching sandbox phrases in the untyped diagnostic tail causes false
retries on genuinely durable blocked runs. Windows sandbox blocked-runs stay a
manual re-dispatch, documented as a known limitation in SKILL.md (candidate
future ticket, out of scope here).

This design ships one trigger only, hardened across design-review rounds 1-4:
last-lines, first-classified-line-wins classification; durable exclusions checked
first; removal of the bare "please try again" signal; a mandatory pre-attempt
final-message delete; gated `attempts` semantics; and the narrow
structural-equivalence contract.

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

### Why text-pattern classification is the only signal (Trigger A)

The wrapper captures codex output as `stdoutTail` / `stderrTail` (last 4000
chars each) in `runCodex` (`codex-task.mjs:477-506`, the 4000-char cap at
`:487-498`), and on `runResult.code !== 0` builds the diagnostic via
`formatCodexRunFailure` (`:508`) which sets
`tail = (stderrTail || stdoutTail || '').trim()`. There is **no structured JSON
on the non-zero path** — the result JSON is only the model's final message,
written via `--output-last-message`, and only exists after a clean (code 0) exit.
Exit codes are uninformative: codex returns non-zero for every failure class with
no distinct code. So error-text pattern matching on the diagnostic tail is the
only viable signal for Trigger A, exactly what `codexFailureHint` (`:515`)
already does.

### Classification: last-lines, first-classified-line-wins (Trigger A)

For the non-zero-exit path the operative codex terminal error is the **final
line(s)** of the tail. A single pure helper `classifyFailure(tail)` scans the
non-blank lines from the END and returns the classification of the first line
(nearest the end) that matches any known pattern, together with that exact
matched line for the warning text:

```js
// Scan the last few non-blank lines from the END. The first line (closest to
// the end) that matches a durable OR transient pattern decides the whole tail.
// A line matching neither is skipped. Durable wins over transient WITHIN a line.
// No banner grammar: we never try to recognize or strip banner/config text.
const MAX_TAIL_SCAN = 3; // codex terminal errors are 1-2 lines; 3 is headroom.

function classifyFailure(tail) {
  const lines = tail.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const window = lines.slice(-MAX_TAIL_SCAN); // last N non-blank lines
  for (let i = window.length - 1; i >= 0; i--) { // scan from the END backward
    const line = window[i];
    if (NON_TRANSIENT_PATTERNS.some((re) => re.test(line))) {
      return { label: null, line }; // durable classified line wins -> no retry
    }
    for (const { label, re } of TRANSIENT_PATTERNS) {
      if (re.test(line)) return { label, line }; // transient classified line wins
    }
    // line matched nothing -> keep scanning the earlier line
  }
  return { label: null, line: window[window.length - 1] ?? '' };
}
```

**The Trigger A classification rule, stated precisely:**

> Split the diagnostic tail into non-blank, trimmed lines. Take at most the last
> `MAX_TAIL_SCAN` (= 3) of them. Scan that window from the last line backward.
> For each line, test the durable (non-transient) patterns first, then the
> transient patterns; the first line that matches any pattern decides the tail
> and the scan stops. A durable match on a line beats a transient match on the
> same line. If no line in the window matches, the tail is non-transient (no
> retry). The retry warning quotes the exact line that matched — the real
> diagnostic — never a window head or banner text.

Why this is robust: it never needs to know what a banner line looks like, so it
cannot be defeated by unrecognized banner lines (`session id:`, `user`, ...) or
by streamed model output appearing before the terminal error. Durable-looking
text streamed earlier is never reached when the terminal line is the operative
transient error; and a durable terminal line correctly excludes a transient line
streamed earlier. The 4000-char cap can truncate the head mid-line, but a
last-`N`-lines rule is always well defined regardless of head truncation. The
full raw tail is still what `formatCodexRunFailure` reports in `error`; only the
*classification input* is the trailing window.

### Durable and transient pattern lists

`NON_TRANSIENT_PATTERNS` (Phase 1, tested first per line — any match returns
`null`):

```js
// Durable failures — retry cannot help. Tested first on each scanned line.
const NON_TRANSIENT_PATTERNS = [
  // auth / login expiry
  /missing bearer|unauthoriz(?:ed|ation)|authentication|\b401\b|codex login|not logged in|invalid api key/i,
  // unsupported model
  /model .*not supported|not supported.*ChatGPT account|unsupported model|\b400\b/i,
  // unsupported / rejected reasoning effort — anchored to explicit REJECTION
  // grammar so a banner echo like "reasoning effort: high" can never match.
  /(?:reasoning[ _]?effort|model_reasoning_effort)[^.\n]{0,40}(?:not supported|unsupported|invalid|not a valid)|(?:unsupported|invalid)(?: value(?: for)?)?[^.\n]{0,40}(?:reasoning[ _]?effort|model_reasoning_effort)/i,
  // durable quota / usage-cap exhaustion — CONTEXTUAL phrases only. Deliberately
  // NO bare "limit exceeded" and NO bare "rate limit" here, so transient
  // "429 rate limit exceeded" is NOT swallowed by this phase.
  /usage limit|weekly limit|monthly limit|usage cap|plan limit|\bquota\b|(?:hit|reached|exceeded) your[^.\n]*\blimit\b/i,
];
```

The sandbox-wrapper transient markers are factored into a named constant used by
the Trigger A transient classifier:

```js
// Isolated sandbox-wrapper PREP failures — retry can help. Used by the Trigger A
// transient classifier. Intentionally NARROW: wrapper-prep phrases only, NOT the
// broad sandbox branch in codexFailureHint. A generic permission / read-only
// denial is a config problem, not transient, so it is NOT retried.
const SANDBOX_WRAPPER_PATTERNS = [
  /failed to prepare\b[^\n]*sandbox wrapper/i,
  /cannot enforce split writable root sets/i,
  /refusing to run unsandboxed/i,
  /restricted-token sandbox/i,
];

// Transient infrastructure for Trigger A — retry can help. First label wins.
const TRANSIENT_PATTERNS = [
  { label: 'model-capacity',
    // Bare "please try again" / "try again later" REMOVED: a real capacity /
    // rate / temporary signal must be present on the line itself.
    re: /\bat capacity\b|\b429\b|rate[ _-]?limit|too many requests|temporarily unavailable|server (?:is )?overloaded/i },
  { label: 'sandbox-wrapper',
    re: new RegExp(SANDBOX_WRAPPER_PATTERNS.map((r) => r.source).join('|'), 'i') },
];
```

The bare `please try again` / `try again later` alternation is **removed
entirely** from the capacity pattern: a genuine capacity failure already carries
a real signal on the same terminal line, so nothing transient is lost, and a
durable error whose only retry-ish wording is "please try again" is not retried.
The narrowed reasoning-effort pattern matches both rejection orderings but never
the bare banner echo `reasoning effort: high`.

Worked Trigger A classifications (each is a named test below), all via
`classifyFailure`:

- Banner frame (config lines incl. `reasoning effort: high` and `session id:`,
  prompt echo) then a final `Selected model is at capacity` -> **model-capacity**;
  warning quotes `Selected model is at capacity`. Retries.
- `Error: 429 rate limit exceeded, please try again later` -> `\b429\b` ->
  **model-capacity**.
- `You've hit your weekly usage limit` -> durable -> **null**.
- `You've hit your weekly usage limit` then `Selected model is at capacity` ->
  final line capacity -> **model-capacity**.
- `Selected model is at capacity` then `You've hit your weekly usage limit` ->
  final line durable -> **null**.
- `Selected model is at capacity. You've hit your weekly usage limit.` ->
  durable-first-within-line -> **null**.
- `Some permanent failure. Please try again` -> matches neither -> **null**.
- `stream error: missing bearer token` -> durable auth -> **null**.
- `model gpt-5.6-terra is not supported for this ChatGPT account` -> durable
  unsupported-model -> **null**.
- `reasoning effort 'xhigh' is not supported` -> durable narrowed-effort ->
  **null**.
- `windows unelevated restricted-token sandbox cannot enforce split writable root
  sets directly; refusing to run unsandboxed` -> transient **sandbox-wrapper**.
- `failed to prepare windows sandbox wrapper` -> transient **sandbox-wrapper**.

### Which failure paths retry wraps

Retries wrap the `runCodex` attempt loop in `main()`. The single trigger and its
exclusions:

- **Trigger A** — `runResult.code !== 0` and `classifyFailure(tailOf(runResult))`
  returns a non-null label (model-capacity or sandbox-wrapper). Retries.

Explicitly NON-retryable:

- Spawn errors (the `child.on('error')` handler at `:501` rejects the `runCodex`
  promise, caught by the `main()` try/catch that emits "failed to spawn codex" at
  `:778-787`): environmental, already gated by the `checkCodexAvailable`
  preflight; part of attempt 1, emitted immediately (with `attempts` when gated).
- `readResult` failures on a code-0 exit (missing / empty / non-JSON / malformed
  final message, `:801-813`): contract failures — a Non-goal; they need a prompt
  fix, not a repeat. Structurally these are the code-0 branch with `!read.ok`, and
  the loop treats them as a terminal (break) outcome, never a retry — asserted by
  dedicated tests (exit-0 malformed JSON, exit-0 missing-final-message, and the
  stale-file sentinel test).
- **Every clean (`code === 0`) exit**, regardless of `taskResult`. `completed`
  succeeded; `partial`/`failed`/`blocked` are substantive task-level outcomes, not
  transient-infrastructure signals, so none are retried. (The Windows
  sandbox-wrapper `apply_patch` case, which exits 0 and reports `blocked`, falls
  here — it stays a manual re-dispatch per the Summary descope note.)

### Final-message file hygiene across attempts

All attempts reuse one `sessionDir` / `lastMessagePath`. At the TOP of every
retry-loop iteration, before each `runCodex`, the loop runs
`rmSync(lastMessagePath, { force: true })`. This makes the invariant exact:
`readResult` runs only after a code-0 exit, and the file was cleared immediately
before that attempt's `codex exec`, so it reflects **only what that attempt
wrote** (or its absence). `force: true` makes the first-attempt delete a no-op.
The pre-attempt delete runs for every Trigger A re-run: a retried attempt
re-enters the loop top, deletes the prior failed attempt's stale final message
(if any), and re-runs, so the next attempt's `readResult` again sees only its own
write. This is mandatory even though the only trigger is a non-zero exit, because
a prior failed attempt can still leave a stale final-message file behind (the
sentinel test below).

Justification vs attempt-specific paths (`last-message.<attempt>.txt`): a single
reused path keeps `sessionDir`, `--debug` retention, and the
`--output-last-message` spawn arg identical to today; per-attempt paths would
require rebuilding `buildSpawnArgs` each iteration. The pre-delete is one line and
strictly sufficient.

The stale-file sentinel test (test 12) guards a Trigger A retry that clears a
stale final message before a later clean, no-message attempt.

### Implementation approach (codex-task.mjs)

1. Arg parsing (`parseArgs`, `:146`): add `--retries`. Parse `next` as a
   non-negative integer; reject negatives / non-numbers / missing value via
   `usageErr('--retries must be a non-negative integer')` (exit 2, no result
   object). Store `retries` (number, default 0). Derive
   `retriesEnabled = retries > 0` for output gating.
2. Attempt counter: declare `let attempt = 0;` at the top of `main()` (right after
   `parseArgs`), BEFORE any structured emit. Every structured `emit` includes
   attempts uniformly and gated:
   `...(retriesEnabled ? { attempts: attempt } : {})`, inserted at a fixed
   position in each object literal so the shape is stable when present. Pre-loop
   emits therefore carry `attempts: 0`; loop / post-loop emits carry the
   incremented count.
3. Retry loop in `main()`: replace the single `runCodex` call + `code !== 0` emit
   with a bounded loop whose body is:
   - top of iteration: `attempt++`; `rmSync(lastMessagePath, { force: true })`;
     `runResult = runCodex(...)` inside the existing spawn-error try/catch (a spawn
     throw stays non-retryable and emits immediately with `attempts`).
   - **Trigger A branch** (`runResult.code !== 0`): `const { label: cls, line:
     diagLine } = classifyFailure(tailOf(runResult));` if `cls && attempt <=
     retries`: push warning ``codex attempt ${attempt}/${retries + 1} failed
     (${cls}): ${diagLine}; retrying``, sleep `backoffMs` unless final attempt,
     `continue`; else `break`.
   - **Clean-exit branch** (`runResult.code === 0`): `break` immediately. A clean
     exit is never retried (all clean-exit `taskResult` values, including
     `blocked`, are terminal — see "Which failure paths retry wraps"), so the loop
     falls straight through to the existing post-loop `readResult` ->
     `normalizeResult` -> emit path with no new logic on this branch.
   - after the loop, the code path is UNCHANGED: the existing `runResult.code !== 0`
     emit (`:789-799`) reports the last non-zero failure via `formatCodexRunFailure`
     (full raw tail), and the existing code-0 `readResult` -> `normalizeResult` ->
     emit path (`:801-843`) runs on a clean exit exactly as today (re-reading the
     last attempt's file, which is still present because `rmSync` runs only at the
     next loop top). The loop only decides `continue` (retry) vs `break` (proceed
     to the existing post-loop handling); no post-loop emit block changes.
   - `tailOf(runResult)` derives the same `(stderrTail || stdoutTail).trim()`
     string `formatCodexRunFailure` uses (the Trigger A classification input);
     `error` still reports the full raw tail.
4. Backoff: **short fixed** delay. Constant `RETRY_BACKOFF_MS` (2000 ms),
   overridable via env `CODEX_TASK_RETRY_DELAY_MS` so tests set `0` and never
   sleep. No backoff after the final failed attempt.

Serial discipline: the loop `await`s each `runCodex` before the next; retries are
strictly sequential in the single process. No new concurrency, no `CODEX_HOME`
isolation.

Minimal-diff note: the clean-exit branch does no work inside the loop (it just
`break`s), so the existing post-loop `readResult` -> `normalizeResult` -> emit
blocks stay verbatim and remain the sole place that pushes `norm.warnings` and
emits. This keeps the diff limited to the non-zero-exit path plus the loop
scaffolding.

### attempts on pre-retry-loop early failures

Three structured results are emitted after argument parsing but before the retry
loop runs (zero `codex exec` invocations). Each MUST carry `attempts: 0` when
`retriesEnabled`:

1. Invalid working directory — `--cwd ... does not exist` emit (`:708-717`, exit 2).
2. Codex preflight failure — `checkCodexAvailable` not-ok emit (`:723-733`, exit 1).
3. Session-directory creation failure — `mkdirSync` catch emit (`:745-754`, exit 1).

Argument-parse failures exit via `usageErr` (exit 2) BEFORE any result object is
built and emit no structured JSON, so they are outside this contract. The uniform
gated-emit approach (step 2) covers all three sites automatically.

### JSON result reporting and the structural-equivalence contract

- `attempts`: integer = number of `codex exec` invocations (0 = failed before the
  loop; 1 = one invocation, no retry; 2 = one retry; ...). Present only when
  `--retries > 0`.
- Warnings: one entry per retried failure, quoting the matched diagnostic line and
  the trigger class + attempt index, appended to the existing `warnings` array.

`emit` (`:661`) serializes with `JSON.stringify(r, null, 2)` in object-literal
insertion order.

The structural-equivalence acceptance line uses **option (b), a NARROW structural
contract** (not fixed-clock / session injection + stdout fixture):

> Contract scope: the two paths exercised by the structural-equivalence test —
> (i) the clean-success emit (`:830-843`), and (ii) the `runResult.code !== 0`
> failure emit (`:789-799`) driven by a **fixed** fake diagnostic tail. On both,
> the ONLY nondeterministic fields are `durationMs` and `sessionDir`. For a given
> input on these two paths: with `--retries` omitted (or `0`) the result has **no
> `attempts` key** and **no retry-related warning**, and after deleting
> `durationMs` and `sessionDir` is **deep-equal** to the result the same input
> produces with the flag entirely absent. This is explicitly NOT a universal
> deep-equality claim; the session-dir-failure, missing-final-message,
> unreadable-final-message, and cleanup-failure paths embed the session path in
> `error` / `warnings` and are out of scope (their no-retry behavior is asserted
> separately by invocation-count).

With `retries = 0` the retry loop runs once and `attempt <= retries` is `1 <= 0`
(false), so no retry ever fires and every result emits exactly as today with no
`attempts` key.

Open question (non-blocking): whether the maintainer prefers `attempts` always
present over the gated omission. Default chosen: gated, to honor this contract.

### Interaction with other flags

- `--quiet`: unchanged; gates live streaming, not warnings. Retry warnings go to
  `warnings[]` and mirror to stderr like the install-check warning.
- `--out`: unchanged; the single final JSON (now possibly carrying `attempts` +
  retry warnings) is written once at the end.
- `--debug`: `sessionDir` preserved as today. All attempts reuse one `sessionDir`
  / `lastMessagePath`; the mandatory pre-attempt delete guarantees a code-0
  attempt's `readResult` sees only that attempt's write. On `--debug` the surviving
  `last-message.txt` is the LAST attempt's.
- `--reasoning-effort` / `--model` / `--permissions` / `--profile`: identical spawn
  args on every attempt (same `buildSpawnArgs`).

### Affected files

- `codex-task.mjs` — arg parse (`--retries`), attempt counter + uniform gated
  `attempts` emit, retry loop in `main()` (with pre-attempt `rmSync` and the
  single Trigger A branch; the clean-exit branch just `break`s), `classifyFailure()`
  (+ `NON_TRANSIENT_PATTERNS` / `TRANSIENT_PATTERNS` + `MAX_TAIL_SCAN`),
  `SANDBOX_WRAPPER_PATTERNS`, `tailOf()`, backoff constant + env override,
  `printUsage` text.
- `SKILL.md` — see docs section.
- `tests/cli-smoke.test.mjs` — extend fake-codex shim + new tests.
- No changes to `install.mjs` or `scripts/permission-matrix.mjs`.

### Test strategy and seams

`makeFakeCodex()` (`tests/cli-smoke.test.mjs:242`) builds a per-call temp dir with
a `codex.cmd` / `codex` shim delegating to `fake-codex.mjs`; PATH is prepended so
the fake wins. The shim answers `--version` and exits BEFORE any other logic
(`fakeCodexJs`, `:267`; the `--version` branch is `:271`), so a disk counter
equals the number of `codex exec` invocations, i.e. the true attempt count.

Extend `fakeCodexJs` with env-driven, on-disk modes (state on disk because each
`codex exec` is a fresh process):

- `FAKE_CODEX_STATE` — path to a counter file; every non-`--version` invocation
  reads, increments, writes it. `makeFakeCodex` returns this path.
- `FAKE_CODEX_FAIL_TIMES` (int, default 0) — leading invocations that fail
  non-zero: if `count <= FAIL_TIMES`, write `FAKE_CODEX_FAIL_MESSAGE` to stderr and
  `process.exit(1)`. (Trigger A / non-transient / contract-fail cases.)
- `FAKE_CODEX_FAIL_MESSAGE` — stderr text on a failing invocation (may be
  multi-line, for the banner-bearing test).
- `FAKE_CODEX_FAIL_WRITES_FINAL` (flag) — on a FAILING invocation, write a
  valid-JSON sentinel (`{"taskResult":"completed","summary":"STALE"}`) to the
  `--output-last-message` path before exiting 1 (stale-file sentinel test).
- `FAKE_CODEX_BAD_FINAL` (flag) — on SUCCESS, write non-JSON garbage and exit 0.
- `FAKE_CODEX_NO_FINAL` (flag) — on SUCCESS, do NOT write the final-message file
  and exit 0.
- `FAKE_CODEX_FAIL_VERSION` (flag) — make the `--version` branch exit non-zero.

All retry tests set `CODEX_TASK_RETRY_DELAY_MS=0` and assert the state-file counter
alongside the reported `attempts` field — they must agree.

Tests (all model a non-zero-exit or contract-failure shape; every fake mode above
exits non-zero on failure or writes a normal `completed` message on success):

1. transient-retry-success (capacity, Trigger A): `FAIL_TIMES=1`, "Selected model
   is at capacity", `--retries 2` -> status 0, `ok:true`, `attempts:2`, one warning
   `/at capacity/i`; counter == 2.
2. banner-bearing capacity: `FAIL_TIMES=1`, multi-line codex frame (config banner
   incl. `reasoning effort: high` and `session id: ...`, prompt echo, final line
   `Selected model is at capacity`), `--retries 2` -> status 0, `attempts:2`, one
   warning quoting `Selected model is at capacity`; counter == 2.
3. multiline durable-earlier-then-capacity: two lines `You've hit your weekly usage
   limit` then `Selected model is at capacity` -> retried, status 0, `attempts:2`;
   counter == 2.
4. multiline capacity-earlier-then-durable: `Selected model is at capacity` then
   `You've hit your weekly usage limit` -> NOT retried, status 1, `attempts:1`;
   counter == 1.
5. 429 transient class: "Error: 429 rate limit exceeded, please try again later",
   `--retries 1` -> status 0, `attempts:2`, warning `/429|rate limit/i`; counter==2.
6. generic please-try-again (must NOT retry): "Some permanent failure. Please try
   again", `--retries 2` -> status 1, `attempts:1`; counter == 1.
7. non-transient auth: "stream error: missing bearer token", `FAIL_TIMES=1`,
   `--retries 2` -> status 1, `attempts:1`; counter == 1.
8. unsupported-model exclusion: "model gpt-5.6-terra is not supported for this
   ChatGPT account" -> not retried, status 1, `attempts:1`; counter == 1.
9. unsupported reasoning-effort exclusion: "reasoning effort 'xhigh' is not
   supported for this model" -> not retried, status 1, `attempts:1`; counter == 1.
10. mixed durable+transient single line: "Selected model is at capacity. You've hit
    your weekly usage limit." -> not retried, status 1, `attempts:1`; counter == 1.
11. retries-exhausted (capacity): `FAIL_TIMES=5`, `--retries 2` -> status 1,
    `attempts:3`, two retry warnings, `error` carries the capacity tail; counter==3.
12. stale-final-message sentinel: `FAIL_TIMES=1` + `FAKE_CODEX_FAIL_WRITES_FINAL=1`
    (attempt 1 fails on a capacity message after writing a `STALE` final message) +
    `FAKE_CODEX_NO_FINAL=1` (attempt 2 exits 0 writing nothing), `--retries 2` ->
    status 1, error `/did not write a final message/`, result does NOT contain
    `STALE`, `attempts:2`; counter == 2.
13. sandbox-wrapper as a NON-ZERO terminal error (Trigger A): "windows unelevated
    restricted-token sandbox cannot enforce split writable root sets directly;
    refusing to run unsandboxed" via `FAIL_TIMES=1`, `--retries 1` -> status 0,
    `attempts:2`; counter == 2. Covers a sandbox-wrapper prep failure that
    surfaces as a non-zero exit.
14. exit-0 malformed-final-message-JSON (must NOT retry): `FAKE_CODEX_BAD_FINAL=1`,
    `--retries 2` -> status 1, error `/not valid JSON|no extractable JSON/`,
    `attempts:1`, counter == 1.
15. exit-0 missing-final-message-file (must NOT retry): `FAKE_CODEX_NO_FINAL=1`,
    `--retries 2` -> status 1, error `/did not write a final message/`,
    `attempts:1`, counter == 1.
16. preflight-failure-with-retries: `FAKE_CODEX_FAIL_VERSION=1`, `--retries 2` ->
    status 1, error from `formatCodexUnavailable`, `attempts:0`, counter == 0.
17. structural-equivalence / field-gating (option b, two in-scope paths): (a) plain
    SUCCESS fake with flag OMITTED vs `--retries 0` — neither JSON has an `attempts`
    key, no warning matches `/attempt|retry/i`, deep-equal modulo `durationMs` +
    `sessionDir`. (b) same for the plain FAILURE fake (capacity, large FAIL_TIMES).
18. `--help` documents `--retries` (help-contract test asserts `/--retries/`).
19. invalid value: `--retries -1` and `--retries abc` -> status 2, stderr
    `/--retries must be a non-negative integer/`.

Tests 1-19 are the full set. That a clean exit is never retried is covered
structurally: the clean-exit branch unconditionally `break`s, and tests 14, 15,
and 17 already assert `attempts:1` (no retry) on clean / near-clean exits.

`npm run check` (node --check) and `npm test` (node --test) are the acceptance
gate; both must pass in `../codex-task`.

### Documentation updates

- `SKILL.md` "How to invoke" synopsis (`SKILL.md:38-45`): add `[--retries N]`.
- `SKILL.md` Wrapper options (`:75-81`): new `--retries` bullet — default 0
  preserves current behavior; retries only one transient-infrastructure shape: a
  **non-zero codex exit** whose terminal diagnostic is model-capacity ("at
  capacity", 429/rate-limit/temporarily-unavailable/overloaded) or a
  sandbox-wrapper prep failure. Explicitly NOT retried: auth, unsupported
  model/effort, durable quota/usage cap, generic "please try again", JSON/contract
  failures, and **every clean (exit-0) result** regardless of `taskResult`
  (`completed`/`partial`/`blocked`/`failed`) — a clean exit means the model was
  reachable and produced a structured result, so its outcome is task-level, not a
  transient-infrastructure signal. Short fixed backoff; serial (never parallel).
- `SKILL.md` Output / Field semantics (`:116-137`): document `attempts` (present
  only when `--retries > 0`; equals `codex exec` invocation count, 0 if it failed
  before the loop) and the per-retry warning entries.
- `SKILL.md` "After invoking" / Failure modes (`:139-171`): point "re-run only if
  it looks like a transient codex hiccup" (`:144`) at `--retries` as the built-in
  automated path for non-zero-exit capacity/sandbox-wrapper hiccups.
- **`SKILL.md` known-limitation note (new; item 4 of the ticket mandate).** Add a
  short subsection under Failure modes recording that Windows sandbox blocked-runs
  are NOT auto-retried: when codex hits the restricted-token sandbox-wrapper prep
  failure during an `apply_patch` mid-turn, it recovers, exits **0**, and reports
  `taskResult: blocked`. Because `--retries` only retries non-zero exits, this
  clean-exit blocked case remains a **manual re-dispatch** — re-invoke codex-task
  yourself when you see a `blocked` result whose `details` cite a sandbox-wrapper
  prep failure. Note the rationale: a reliable automatic retry here would require
  distinguishing a genuine external-blocker `blocked` from an isolated
  environment-level tool failure, which needs a **structured tool-failure record
  from codex's event output** (not the untyped diagnostic tail the wrapper sees
  today); that is a candidate future ticket, out of scope here.
- `codex-task.mjs` `printUsage` (`:218`): mirror the `--retries` flag doc (a
  help-contract test asserts on it). No mention of a clean-exit/blocked retry.
- No README index change (README not in scope).

### Risks and edge cases

- Classification window size (Trigger A). `classifyFailure` assumes the operative
  terminal error is within the last `MAX_TAIL_SCAN` (= 3) non-blank lines; a longer
  future terminal diagnostic with the classifiable phrase above the window
  classifies non-transient (fail-safe). Tunable constant; tests 2-4 pin the shape.
- Misclassification. A durable tail whose final line coincidentally matches a
  transient phrase wastes up to `n` bounded retries; the higher-stakes direction
  (retrying durable quota/auth) is blocked because the durable phrase, when
  terminal, matches Phase 1 first. Both directions covered (tests 3, 4, 10).
- Wall-clock cost. Failed attempts happened after 180s+ of work; `n` retries
  multiply worst-case latency. `n` bounds it; default 0 is opt-in.
- Idempotency of write tasks. The retried transient classes fail *before* a
  successful write (capacity = pre-work; sandbox-wrapper prep = apply_patch
  refused), and codex runs `--ephemeral` (fresh read each attempt), so retry is as
  safe as the manual re-run it replaces. Because only non-zero exits are retried,
  a run that exited 0 with committed partial progress is never re-run. A transient
  failure *after* a partial write is identical in risk to today's human manual
  retry; noted, not solved.
- Stale `lastMessagePath` across attempts: eliminated by the mandatory pre-attempt
  `rmSync(lastMessagePath, { force: true })` at each loop top; sentinel test (12)
  guards it.
- Test flakiness from real sleeps: eliminated by `CODEX_TASK_RETRY_DELAY_MS=0`.

### Open questions (non-blocking; defaults chosen)

1. `attempts` presence gated to `--retries > 0` (honors the structural contract).
   Confirm vs always-present.
2. Backoff magnitude: fixed 2000 ms (env-overridable). Acceptable, or 0/1000 ms?
3. `MAX_TAIL_SCAN` = 3: confirm no known codex mode emits a terminal diagnostic
   whose classifiable phrase sits more than 3 non-blank lines above end.

## Implementation Notes

### Summary

Implemented the approved r7 design (Trigger A only) in the sibling repo
`C:/Users/Nicho/Documents/codex-task`, branch `T20260710T1534Z-retries`
(created from `mainline`, clean tree). Local-board repo/worktree touched
only for this Implementation Notes section, per the implementer contract.

### Files changed (all in ../codex-task)

- `codex-task.mjs` — new `--retries <n>` flag (`parseArgs`, non-negative
  integer validation via `usageErr`); `classifyFailure()` + `NON_TRANSIENT_PATTERNS`
  / `SANDBOX_WRAPPER_PATTERNS` / `TRANSIENT_PATTERNS` / `MAX_TAIL_SCAN` (last-lines,
  first-classified-line-wins, durable-first-per-line); `tailOf()`;
  `RETRY_BACKOFF_MS` (2000ms, env-overridable via `CODEX_TASK_RETRY_DELAY_MS`);
  `attempt` counter declared right after `parseArgs`, before any structured
  emit; retry loop in `main()` replacing the single `runCodex` call — mandatory
  pre-attempt `rmSync(lastMessagePath, {force:true})` at every loop top, clean
  (code 0) exit unconditionally `break`s (never retried, including `blocked`),
  Trigger A branch retries only when `classifyFailure` returns a transient
  label and `attempt <= retries`; uniform gated `...(retriesEnabled ? {attempts:
  attempt} : {})` spread inserted at a fixed position (before `warnings`) in
  all six structured-emit sites (bad cwd, preflight failure, session-dir
  failure, spawn-error catch, non-zero-exit failure, readResult contract
  failure, final success); `printUsage` updated (synopsis + new `--retries`
  bullet).
- `tests/cli-smoke.test.mjs` — extended `fakeCodexJs` shim with on-disk
  env-driven modes: `FAKE_CODEX_STATE` (invocation counter file,
  `makeFakeCodex` now returns `{dir, statePath}`), `FAKE_CODEX_FAIL_TIMES` /
  `FAKE_CODEX_FAIL_MESSAGE` / `FAKE_CODEX_FAIL_WRITES_FINAL`,
  `FAKE_CODEX_BAD_FINAL`, `FAKE_CODEX_NO_FINAL`, `FAKE_CODEX_FAIL_VERSION`.
  Added tests 1-19 exactly per the design's test strategy (transient-retry-
  success, banner-bearing capacity, durable-earlier/transient-earlier mixed
  multiline, 429, generic-please-try-again no-retry, auth/unsupported-model/
  unsupported-effort exclusions, mixed-single-line durable+transient,
  retries-exhausted, stale-final-message sentinel, non-zero-exit
  sandbox-wrapper retry [test 13], exit-0 malformed-JSON no-retry, exit-0
  missing-final-message no-retry, preflight-failure attempts:0, option-b
  structural-equivalence on the clean-success and fixed-diagnostic-failure
  paths, help-contract, invalid `--retries` value). No `FAKE_CODEX_BLOCK_*`
  knobs, no tests 20-23 — matches the descoped (Trigger-A-only) design.
- `SKILL.md` — `--retries` documented in the how-to-invoke synopsis and a new
  Wrapper options bullet (transient-class list, default-0 byte-identical
  note, serial/backoff note); Output section gains an `attempts` +
  retry-warning example; Field semantics documents `attempts` (gated
  presence) and the retry-warning shape; "After invoking" step 4 points at
  `--retries` for the non-zero-exit transient shapes; new "Known limitation:
  Windows sandbox blocked-runs are not auto-retried" subsection under
  Failure modes, with the structured-tool-failure-record future-ticket
  pointer, per the ticket's item 4 mandate.

### Test evidence

- `npm run check` (node --check on codex-task.mjs, install.mjs,
  scripts/permission-matrix.mjs): pass, no output.
- `npm test` (node --test): **33/33 pass, 0 fail, 0 skipped** (14 pre-existing
  + 19 new `--retries` tests). Ran twice (once after the code+test commits,
  once after the SKILL.md commit) — both green. Full run ~5.9-6.5s.

### Commits (on `T20260710T1534Z-retries`, codex-task repo)

- `aa1a063` — T20260710T1534Z: add --retries flag for transient
  capacity/sandbox-wrapper failures (Trigger A) [codex-task.mjs]
- `ea026b1` — T20260710T1534Z: extend fake-codex shim and add tests 1-19 for
  --retries [tests/cli-smoke.test.mjs]
- `8aeec88` — T20260710T1534Z: document --retries and the Windows sandbox
  blocked-run known limitation [SKILL.md]

Working tree clean after the three commits; `mainline` untouched.

### Deviations from design

None. Implemented the r7 (PASSED, xhigh, no findings) design as written:
Trigger A only, last-lines/first-classified-line-wins classification with
durable patterns checked first per line, no bare "please try again" pattern,
mandatory pre-attempt `rmSync`, gated `attempts` semantics including the
three pre-loop preflight sites, clean exits (incl. `blocked`) never retried,
option-b narrow structural-equivalence contract, tests 1-19 exactly, SKILL.md
known-limitation item as specified.

### Remaining risks (carried from design, not new)

- `MAX_TAIL_SCAN=3` is a tunable fail-safe bound; a future terminal
  diagnostic burying the classifiable phrase deeper than 3 non-blank lines
  classifies non-transient (no retry), by design.
- Windows sandbox clean-exit (`blocked`) case remains a manual re-dispatch,
  documented; a reliable automatic path needs a structured tool-failure
  record from codex's event output (candidate future ticket, out of scope).

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

ANSWERED 2026-07-11 by the user: option 2 - descope Trigger B.

Direction for the next design pass: ship --retries for the non-zero-exit transient class only (Trigger A as already review-hardened across rounds 1-4: last-lines classification, durable-exclusions-first, mandatory pre-attempt final-message deletion, gated attempts semantics, structural-equivalence contract). Remove Trigger B (clean-exit blocked + sandbox-marker retry) from scope entirely; Windows sandbox blocked-runs remain a manual re-dispatch, documented in SKILL.md as a known limitation with a pointer that a reliable automatic retry would require a structured tool-failure record from codex's event output (candidate future ticket, not scoped). Drop tests 20-23 and the FAKE_CODEX_BLOCK_* knobs; keep tests 1-19.

Original question history (for context): five sol@xhigh design-review rounds; rounds 1-4 resolved (classifier ordering, banner-tail isolation, bare try-again, stale final-message, clean-exit shape); round 5 High was Trigger B matching sandbox phrases in untyped tails (prompt echoes / model explanations could trigger false retries on durable blocked runs). Options were (1) structured-event constraint round, (2) descope Trigger B, (3) accept residual risk. User chose 2, matching the orchestrator recommendation.

## Run Log

- 2026-07-10T17:45:37Z: Ensured git branch local-board/T20260710T1534Z-codex-task-retries-for-transient-capacity-and-sandbox-failures-codex-task-repo (already-current).

- 2026-07-10T17:51:05Z: Completed design via claude-subagent:local-board-designer@opus: Opt-in --retries (default 0, byte-identical omitted); classifyTransient text-pattern classifier (capacity/sandbox-wrapper) with non-transient exclusions checked first; fixed 2s backoff env-overridable; attempts field gated; fake-codex fail-N-then-succeed seam; SKILL/usage docs; local-board guidance = follow-up. Estimate 4pts basis T20260710T1533Z.

- 2026-07-10T17:52:56Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: none requested (CLI wrapper retry flag; no security/UI/UX triggers)

- 2026-07-10T18:01:57Z: Design review (sol@xhigh): FAIL. [High] Exclusion-first patterns break the transient/durable split: blanket 'limit exceeded' catches '429 rate limit exceeded' before transient patterns; bare 'try again' misclassifies durable failures; unsupported-effort exclusions omit 'reasoning effort' wording. [Medium] Byte-identical test as specified is unstable (durationMs, sessionDir) and only checks attempts-absence; needs deterministic seams + baseline fixture or clarified requirement. [Medium] Coverage gaps: 429-transient class, unsupported model/effort exclusions, mixed durable+transient tails, code-zero malformed-JSON no-retry; assert fake state counter to prove invocation count. Disposition: designer revision.

- 2026-07-10T18:22:51Z: Design re-review #2 (sol@xhigh): FAIL. [High] codex exec writes a config banner incl. 'reasoning effort: <level>' to stderr before the diagnostic, so the broad reasoning-effort exclusion matches on realistic capacity failures and suppresses the retry (codex issue 22047); isolate the terminal error portion, narrow the effort exclusion to explicit rejection grammar, add a banner-bearing capacity test. [Medium] Structural-equivalence dynamic-field enumeration incomplete (session path in error/warnings on some failure paths, session IDs in tails); narrow contract to tested fixed-tail paths or normalize. [Medium] attempts contract vs pre-loop structured failures (bad cwd, preflight, session-dir) - specify gated attempts:0 + one preflight test. Disposition: revision #2.

- 2026-07-10T18:50:05Z: Design review #3 (sol@xhigh): FAIL. [High] isolateTerminalError BANNER_LINE misses real banner lines (session id:, user) and codex can emit output before the final error, so the 8-line window can still trip durable exclusions and the warning first-line would be banner text (test 2 internally inconsistent); classify the final error line(s) only or define a reliable boundary. [Medium] Bare please-try-again still in Phase 2 - require accompanying capacity/rate/temporary signal. [Medium] lastMessagePath reuse across retries can serve stale content on a later code-zero no-message attempt - mandatory pre-retry delete or attempt-specific path + sentinel test. Disposition: revision #3; round 4 = hard stop (non-PASS/CONCERNS on new blockers goes to questions).

- 2026-07-10T19:11:31Z: Design review #4 (sol@xhigh): FAIL, one new High - the real Windows sandbox-wrapper failure surfaces as apply_patch tool failure inside a continuing turn: codex exits 0 with taskResult blocked, so the exit-nonzero retry loop never fires for the second motivating transient class. Disposition: final revision #4 per reviewer's specified fix (retry when exit 0 + taskResult blocked + isolated sandbox-wrapper pattern in captured output; missing/malformed-final-message and other contract failures stay non-retryable). Round 5 non-PASS/CONCERNS parks the ticket in questions.

- 2026-07-10T19:26:53Z: Design review #5 FINAL (sol@xhigh): FAIL. [High] Trigger B matches sandbox-wrapper phrases in untyped tails, so prompt echoes or model explanations mentioning the phrase on a durable blocked run would retry - violates transient-only. Five rounds each found a new real defect; per the declared stop, parking in questions with options (continue structured-event round / descope Trigger B / accept residual).

- 2026-07-11T19:45:22Z: User decision 2026-07-11: option 2 - descope Trigger B. Next design pass ships Trigger A (capacity/non-zero-exit) only; sandbox blocked-runs stay manual, documented as a known limitation in SKILL.md with a structured-event future pointer. Resuming questions -> ready_for_design.

- 2026-07-11T19:45:22Z: Invalidated downstream evidence on loop-back to ready_for_design: removed completedSteps [design:claude-subagent:local-board-designer@opus, gate:design:claude-subagent:local-board-gatecheck@haiku].

- 2026-07-11T20:05:07Z: Completed design via claude-subagent:local-board-designer@opus: Descope pass per user option-2 decision: Trigger B fully removed (section, findSandboxWrapperMarker, clean-exit retry branch, tests 20-23, FAKE_CODEX_BLOCK_* knobs); Trigger A kept as rounds-1-4 hardened (classifyFailure last-lines first-match, durable exclusions first, pre-attempt rmSync lastMessagePath, gated attempts, option-b structural equivalence, tests 1-19); SKILL.md known-limitation item added; descope note recorded; stale line refs refreshed against sibling repo.

- 2026-07-11T20:06:02Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: none (CLI retry flag; auth failures explicitly non-retryable; no UI/API/PII surface)

- 2026-07-11T20:10:03Z: Design review r6 (codex-task:read-only@gpt-5.6-sol, xhigh; descope-scoped): FAIL. 1) [High] Excision incomplete: Trigger B material retained at Technical Design lines 75-94, 464-465, 527-535, 585-592, 614-618 (clean-exit sandbox-marker retry, tests 20-23, FAKE_CODEX_BLOCK_* knobs preserved as historical detail) - violates the ANSWERED directive; allowed remnant is only a concise attribution note (option-2 decision 2026-07-11, warn against re-adding without structured tool-failure data). 2) [Low] Spawn-error bullet cites codex-task.mjs:778-787 for child.on(error) which is at line 501; 778-787 is the main() catch/emit path - cite both or relabel. Looping design rework.

- 2026-07-11T20:14:06Z: Completed design via claude-subagent:local-board-designer@opus: Rework r7: Trigger B fully excised (Summary subsection collapsed to single attribution note ~L75; FAKE_CODEX_BLOCK_/tests-20-23/clean-exit-retry prose deleted from test strategy, risks, open questions, failure-paths); SKILL.md known-limitation item retained; spawn-error refs corrected (child.on error :501, :778-787 relabeled main catch/emit).

- 2026-07-11T20:19:13Z: Design review r7 (codex-task:read-only@gpt-5.6-sol, xhigh; descope-scoped): PASS, no findings. Trigger B excised, Trigger A hardening intact, clean exits unambiguously no-retry, SKILL.md limitation correctly scoped, sibling refs current.

- 2026-07-11T20:19:14Z: Recorded design review via codex-task:read-only@gpt-5.6-sol: r7 PASS (descope revision): excision complete, Trigger A intact, no-retry on clean exit unambiguous, SKILL.md item scoped, refs current

- 2026-07-11T20:19:27Z: Ensured git branch local-board/T20260710T1534Z-codex-task-retries-for-transient-capacity-and-sandbox-failures-codex-task-repo (already-current).

- 2026-07-11T20:29:02Z: Completed implement via claude-subagent:local-board-implementer@sonnet: codex-task repo branch T20260710T1534Z-retries: aa1a063 (--retries flag, classifyFailure last-lines/durable-first, retry loop, gated attempts at six emit sites, pre-attempt rmSync), ea026b1 (fake-codex shim + tests 1-19), 8aeec88 (SKILL.md --retries docs + Windows sandbox known limitation). npm run check pass; npm test 33/33 (14 pre-existing + 19 new). No deviations from r7 design.

- 2026-07-11T20:30:43Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: none (stderr pattern classification of tool output; auth detection is exclusion logic, not auth implementation; no UI)
