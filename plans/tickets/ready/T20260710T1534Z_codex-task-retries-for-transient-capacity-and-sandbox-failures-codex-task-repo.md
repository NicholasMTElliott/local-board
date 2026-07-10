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
updated: 2026-07-10T18:58:47Z
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
non-zero `codex exec` exit, classify the **final diagnostic line(s)** of the
captured tail. If the failure is a recognized **transient infrastructure** class
(model capacity / sandbox-wrapper prep) the wrapper retries the invocation
in-process, serially, up to `n` times with a short fixed backoff. Every other
failure — auth, unsupported model/effort, durable quota/usage-cap exhaustion,
generic "please try again" errors, JSON/contract failures, task-level
partial/failed — is non-transient and never retried. Default `n = 0` preserves
today's behavior byte-for-byte.

This is revision #3 (post design review round 3 FAIL). It replaces the fragile
banner-grammar stripping with a **last-lines, first-classified-line-wins** rule
that never depends on recognizing banner text; removes the bare "please try
again" transient pattern; and specifies a **mandatory pre-attempt delete** of the
final-message file so a later clean exit that writes nothing can never serve a
stale prior message.

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

### Classification: last-lines, first-classified-line-wins (fixes review High)

**Problem with the prior draft.** Revision #2 tried to *strip* a leading codex
config banner by grammar (a `BANNER_LINE` regex) and then classify an 8-line
trailing window. The reviewer showed this is unreliable: the real codex banner
contains lines the grammar misses (`session id:`, `user`, ...), and codex can
emit arbitrary streamed output *before* the terminal error, so an 8-line window
can still contain durable-looking text that suppresses a genuine capacity retry.
The banner-bearing test was internally inconsistent because the "first line" the
warning quoted would be banner text, not the capacity message.

**Fix — stop trying to identify the banner at all. Classify only the final error
line(s).** There is no `isolateTerminalError` and no `BANNER_LINE` grammar. A
single pure helper `classifyFailure(tail)` scans the **non-blank lines from the
END** and returns the classification of the **first line (nearest the end) that
matches any known pattern**, together with that exact matched line for the
warning text:

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

**The classification rule, stated precisely:**

> Split the diagnostic tail into non-blank, trimmed lines. Take at most the last
> `MAX_TAIL_SCAN` (= 3) of them. Scan that window from the last line backward.
> For each line, test the durable (non-transient) patterns first, then the
> transient patterns; the first line that matches any pattern decides the tail
> and the scan stops. A durable match on a line beats a transient match on the
> same line. If no line in the window matches, the tail is non-transient (no
> retry). The retry warning quotes the exact line that matched — the real
> diagnostic — never a window head or banner text.

Why this is robust where the grammar approach was not:

- It never needs to know what a banner line looks like, so it cannot be defeated
  by unrecognized banner lines (`session id:`, `user`, ...) or by streamed model
  output appearing before the terminal error.
- The two cases the reviewer mandated fall out directly:
  - **durable-looking text EARLIER, capacity line LAST** (e.g. a `usage limit`
    line streamed mid-run, then a final `Selected model is at capacity`): the
    final line is scanned first and matches transient -> **model-capacity**,
    retries. The earlier durable text is never reached.
  - **transient-looking text earlier, durable line LAST** (e.g. `... at capacity`
    then a final `You've hit your weekly usage limit`): the final line matches
    durable -> **null**, excluded. Correct: the operative terminal error is the
    durable one.
- The warning quotes `line`, which is exactly the line that drove the decision,
  so the banner-bearing test is now self-consistent.

The 4000-char cap can truncate the head of the tail mid-line, but a
last-`N`-lines rule is always well defined regardless of head truncation, so the
cap is a non-issue for this rule. The full raw tail is still what
`formatCodexRunFailure` reports in the `error` field; only the *classification
input* is the trailing window.

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

`TRANSIENT_PATTERNS` (Phase 2, tested only if no durable pattern matched the
line — first list to match wins):

```js
// Transient infrastructure — retry can help. First label to match wins.
const TRANSIENT_PATTERNS = [
  { label: 'model-capacity',
    // Bare "please try again" / "try again later" REMOVED (fixes review Medium):
    // a real capacity/rate/temporary signal must be present on the line itself.
    re: /\bat capacity\b|\b429\b|rate[ _-]?limit|too many requests|temporarily unavailable|server (?:is )?overloaded/i },
  { label: 'sandbox-wrapper',
    re: /failed to prepare\b[^\n]*sandbox wrapper|cannot enforce split writable root sets|refusing to run unsandboxed|restricted-token sandbox/i },
];
```

**"please try again" disposition (fixes review Medium).** The bare
`please try again` / `try again later` alternation is **removed entirely** from
the transient capacity pattern. A genuine capacity failure already carries a real
signal (`at capacity`, `429`, `rate limit`, `temporarily unavailable`,
`overloaded`) on the same terminal line, so nothing transient is lost. A generic
durable error whose only "retry-ish" wording is "please try again" (e.g. `Some
permanent failure. Please try again`) now matches neither list and is **not
retried**. This is the "remove it" option from the finding, chosen over "require
an accompanying signal on the same line" because removal is strictly simpler and,
since classification is already per-line, loses no true positive.

The narrowed reasoning-effort pattern matches both rejection orderings
(`reasoning effort 'xhigh' is not supported` and `unsupported value for
model_reasoning_effort`) but never the bare banner echo `reasoning effort: high`
(no rejection token within 40 chars). Combined with the last-lines rule (the
banner echo lives at the head, outside the trailing window), the banner cannot
suppress a capacity retry by either mechanism.

Worked classifications (each is a named test below), all via `classifyFailure`:

- Banner frame (config lines incl. `reasoning effort: high` and `session id:`,
  prompt echo) then a final `Selected model is at capacity` -> scan from end:
  final line matches capacity -> **model-capacity** (transient); warning quotes
  `Selected model is at capacity`. Retries.
- `Error: 429 rate limit exceeded, please try again later` (single final line) ->
  `\b429\b` -> **model-capacity**.
- `You've hit your weekly usage limit` (final line) -> durable -> **null**.
- Two lines `You've hit your weekly usage limit` then `Selected model is at
  capacity` -> final line capacity -> **model-capacity** (durable earlier line
  never reached).
- Two lines `Selected model is at capacity` then `You've hit your weekly usage
  limit` -> final line durable -> **null**.
- Single line `Selected model is at capacity. You've hit your weekly usage
  limit.` -> durable-first-within-line -> **null**.
- `Some permanent failure. Please try again` -> matches neither list -> **null**.
- `stream error: missing bearer token` -> durable auth -> **null**.
- `model gpt-5.6-terra is not supported for this ChatGPT account` -> durable
  unsupported-model -> **null**.
- `reasoning effort 'xhigh' is not supported` -> durable narrowed-effort ->
  **null**.
- `windows unelevated restricted-token sandbox cannot enforce split writable root
  sets directly; refusing to run unsandboxed` -> transient **sandbox-wrapper**.
- `failed to prepare windows sandbox wrapper` -> transient **sandbox-wrapper**.

Design notes:

- The transient sandbox list is intentionally NARROW (wrapper-prep phrases only),
  not the broad `codexFailureHint` sandbox branch. A generic permission /
  read-only denial is a config problem, not transient, so it is NOT retried.
- Durable-first-per-line is conservative: when a single line names both a throttle
  and a cap, treat it as a cap and do not retry.

### Which failure path retries wrap

Retries wrap **only** the `runCodex` + `runResult.code !== 0` branch in `main()`
(`codex-task.mjs:758`). They explicitly do NOT cover:

- Spawn errors (`child.on('error')` -> "failed to spawn codex", `:746`):
  environmental, already gated by the `checkCodexAvailable` preflight. A spawn
  throw is part of attempt 1 and emits immediately (with `attempts` when gated).
- `readResult` failures on a code-0 exit (missing / empty / non-JSON / malformed
  final message, `:770`): contract failures — a Non-goal; they need a prompt fix,
  not a repeat. This branch is structurally *after* the retry loop and only
  reached on a clean exit, so it can never trigger a retry. Asserted by dedicated
  tests (exit-0 malformed JSON, exit-0 missing-final-message, and the stale-file
  sentinel test below).
- Task-level `taskResult` of `partial` / `blocked` / `failed`: substantive
  outcomes on a clean exit; never retried.

### Final-message file hygiene across attempts (fixes review Medium)

**Problem.** All attempts reuse one `sessionDir` / `lastMessagePath`. A failed
attempt can leave a final-message file on disk (codex may write a partial or
sentinel message before failing). A later attempt that exits 0 but writes nothing
would let `readResult` (`:510`) consume that **stale** file and report a false
success instead of the missing-final-message contract failure.

**Fix — CHOICE: mandatory pre-attempt delete of the reused path** (not
attempt-specific paths). At the TOP of every retry-loop iteration, before each
`runCodex`, run `rmSync(lastMessagePath, { force: true })`. This makes the
invariant exact: `readResult` runs only after a code-0 exit, and the file was
cleared immediately before that attempt's `codex exec`, so it reflects **only
what that attempt wrote** (or its absence). `force: true` makes the first-attempt
delete (no file yet) a no-op.

Justification vs attempt-specific paths (`last-message.<attempt>.txt`): a single
reused path keeps `sessionDir`, `--debug` retention, and the
`--output-last-message` spawn arg identical to today; per-attempt paths would
require rebuilding `buildSpawnArgs` each iteration and would complicate `--debug`
(which path does the user inspect?) and the `sessionDir` reporting. The
pre-delete is one line, touches no other flag semantics, and is strictly
sufficient.

Sentinel test (below, test 12): attempt 1 fails on a capacity message **after**
writing a valid-JSON sentinel to `lastMessagePath`; attempt 2 exits 0 writing
nothing. Expected: the pre-delete wipes the sentinel before attempt 2 runs, so
`readResult` finds no file and returns the missing-final-message contract failure
-> status 1, `error /did not write a final message/`, `attempts: 2`,
counter == 2, and the sentinel content never appears in the result.

### Implementation approach (codex-task.mjs)

1. Arg parsing (`parseArgs`, `:122`): add `--retries`. Parse `next` as a
   non-negative integer; reject negatives / non-numbers / missing value via
   `usageErr('--retries must be a non-negative integer')` (exit 2, no result
   object). Store `retries` (number, default 0). Derive
   `retriesEnabled = retries > 0` for output gating.
2. Attempt counter: declare `let attempt = 0;` at the top of `main()` (right
   after `parseArgs`), BEFORE any structured emit. Every structured `emit`
   includes attempts uniformly and gated:
   `...(retriesEnabled ? { attempts: attempt } : {})`, inserted at a fixed
   position in each object literal so the shape is stable when present. Pre-loop
   emits therefore naturally carry `attempts: 0`; loop / post-loop emits carry the
   incremented count.
3. Retry loop in `main()`: replace the single `runCodex` call + `code !== 0` emit
   with a bounded loop:
   - top of iteration: `attempt++`; `rmSync(lastMessagePath, { force: true })`
     (final-message hygiene, above); `runCodex(...)` inside the existing
     spawn-error try/catch.
   - if `runResult.code === 0` break (fall through to `readResult`).
   - else `const { label: cls, line: diagLine } = classifyFailure(tailOf(runResult));`
     if `cls` AND `attempt <= retries` (retries remain): push a warning
     ``codex attempt ${attempt}/${retries + 1} failed (${cls}): ${diagLine}; retrying``,
     sleep `backoffMs` unless it is the final attempt, `continue`; else break.
   - after the loop, the existing `code !== 0` emit (`:759`) reports the last
     failure via `formatCodexRunFailure` (full raw tail); the existing code-0
     `readResult` path (`:770`) runs unchanged on a clean exit.
   - `tailOf(runResult)` derives the same `(stderrTail || stdoutTail).trim()`
     string `formatCodexRunFailure` uses; `classifyFailure` narrows it to the
     trailing window for classification only. `error` still reports the full tail.
4. Backoff: **short fixed** delay (no exponential — capacity recovered on the
   immediate manual retry in the retro). Constant `RETRY_BACKOFF_MS` (2000 ms),
   overridable via env `CODEX_TASK_RETRY_DELAY_MS` so tests set `0` and never
   sleep. No backoff after the final failed attempt.

Serial discipline: the loop `await`s each `runCodex` before the next; retries are
strictly sequential in the single process. No new concurrency, no `CODEX_HOME`
isolation.

### attempts on pre-retry-loop early failures

Three structured results are emitted **after** argument parsing but **before** the
retry loop runs, at which point zero `codex exec` invocations have happened. Each
MUST carry `attempts: 0` when `retriesEnabled` (the counter is still 0), so the
contract reads precisely: *when `--retries > 0`, `attempts` is present on every
structured result and equals the number of `codex exec` invocations (0 before the
loop, >=1 once the loop runs).* The three `attempts: 0` sites:

1. Invalid working directory — `--cwd ... does not exist` emit (`:676-685`,
   exit 2).
2. Codex preflight failure — `checkCodexAvailable` not-ok emit (`:692-702`,
   exit 1).
3. Session-directory creation failure — `mkdirSync` catch emit (`:713-723`,
   exit 1).

Argument-parse failures (`--retries -1`, unknown flag) exit via `usageErr`
(exit 2) BEFORE any result object is built and emit no structured JSON, so they
are outside this contract. The uniform gated-emit approach (step 2 above) covers
all three sites automatically.

### JSON result reporting and the structural-equivalence contract

- `attempts`: integer = number of `codex exec` invocations (0 = failed before the
  loop; 1 = one invocation, no retry; 2 = one retry; ...). Present only when
  `--retries > 0`.
- Warnings: one entry per retried failure, quoting the matched diagnostic line and
  the transient class + attempt index, appended to the existing `warnings` array.

`emit` (`:637`) serializes with `JSON.stringify(r, null, 2)` in object-literal
insertion order.

**"Byte-identical" acceptance line — CHOICE: option (b), a NARROW structural
contract** (not fixed-clock / session injection + stdout fixture). Rationale:
option (a) would force a fixed-clock / injected-session-path seam into production
purely for a test; (b) tests the real guarantee — that the flag at its default is
inert — against only the fields that legitimately vary.

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
> input produces with the flag entirely absent. This is explicitly NOT a universal
> deep-equality claim: the session-dir-failure, missing-final-message,
> unreadable-final-message, and cleanup-failure paths additionally embed the
> session path in `error` / `warnings` and are out of scope (their no-retry
> behavior is asserted separately by invocation-count, not deep-equality).

The `attempts` gating (present only when `retriesEnabled`) is what makes the
default byte-identical to today: with the flag absent the key is never added.

Open question (non-blocking): whether the maintainer prefers `attempts` always
present (cleaner for consumers) over the gated omission. Default chosen: gated, to
honor this contract.

### Interaction with other flags

- `--quiet`: unchanged; gates live streaming, not warnings. Retry warnings go to
  `warnings[]` and mirror to stderr like the install-check warning.
- `--out`: unchanged; the single final JSON (now possibly carrying `attempts` +
  retry warnings) is written once at the end.
- `--debug`: `sessionDir` preserved as today. All attempts reuse one `sessionDir`
  / `lastMessagePath`; the mandatory pre-attempt delete guarantees a code-0
  attempt's `readResult` sees only that attempt's write. On `--debug` the
  surviving `last-message.txt` is the LAST attempt's, matching intuition.
- `--reasoning-effort` / `--model` / `--permissions` / `--profile`: identical
  spawn args on every attempt (same `buildSpawnArgs`).

### Affected files

- `codex-task.mjs` — arg parse (`--retries`), attempt counter + uniform gated
  `attempts` emit, retry loop in `main()` (with pre-attempt `rmSync`),
  `classifyFailure()` (+ `NON_TRANSIENT_PATTERNS` / `TRANSIENT_PATTERNS` +
  `MAX_TAIL_SCAN`), `tailOf()`, backoff constant + env override, `printUsage`
  text.
- `SKILL.md` — see docs section.
- `tests/cli-smoke.test.mjs` — extend fake-codex shim + new tests.
- No changes to `install.mjs` or `scripts/permission-matrix.mjs`.

### Test strategy and seams

`makeFakeCodex()` (`tests/cli-smoke.test.mjs:204`) builds a per-call temp dir with
a `codex.cmd` / `codex` shim delegating to `fake-codex.mjs`; PATH is prepended so
the fake wins. The shim answers `--version` and exits BEFORE any other logic
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
- `FAKE_CODEX_FAIL_WRITES_FINAL` (flag) — on a FAILING invocation, write a
  valid-JSON sentinel (`{"taskResult":"completed","summary":"STALE"}`) to the
  `--output-last-message` path BEFORE exiting 1 (drives the stale-file sentinel
  test).
- `FAKE_CODEX_BAD_FINAL` (flag) — on the SUCCESS branch, write non-JSON garbage to
  the `--output-last-message` path and exit 0 (code-0 malformed path).
- `FAKE_CODEX_NO_FINAL` (flag) — on the SUCCESS branch, do NOT write the
  `--output-last-message` file and exit 0 (code-0 missing-final-message path).
- `FAKE_CODEX_FAIL_VERSION` (flag) — make the `--version` branch exit non-zero
  (drives a `checkCodexAvailable` preflight failure).

All retry tests set `CODEX_TASK_RETRY_DELAY_MS=0` (no real sleeps) and assert the
state-file counter (true invocation count) alongside the reported `attempts` field
— they must agree.

Tests (existing retained/renumbered; NEW marks review-mandated additions):

1. transient-retry-success (capacity): `FAIL_TIMES=1`, message "Selected model is
   at capacity", `--retries 2` -> status 0, `ok:true`, `attempts:2`, exactly one
   warning `/at capacity/i`; counter == 2.
2. **banner-bearing capacity (fixes High)**: `FAIL_TIMES=1`, message = a realistic
   multi-line codex frame — config banner including the literal line `reasoning
   effort: high` AND a `session id: ...` line, then a prompt-echo line, then a
   final line `Selected model is at capacity` — `--retries 2` -> status 0,
   `ok:true`, `attempts:2`, one warning whose quoted line is `Selected model is at
   capacity` (NOT banner text); counter == 2. Proves banner lines the old grammar
   missed do not suppress the retry and the warning quotes the real diagnostic.
3. **NEW multiline durable-earlier-then-capacity (first-classified-line-wins,
   fixes High)**: `FAIL_TIMES=1`, message = two lines `You've hit your weekly
   usage limit\nSelected model is at capacity` -> retried, status 0, `attempts:2`,
   warning `/at capacity/i`; counter == 2. Durable text earlier must NOT block the
   final capacity line.
4. **NEW multiline capacity-earlier-then-durable (inverse must exclude, fixes
   High)**: `FAIL_TIMES=1`, message = `Selected model is at capacity\nYou've hit
   your weekly usage limit` -> NOT retried, status 1, `ok:false`, `attempts:1`;
   counter == 1. Final durable line decides.
5. **NEW 429-rate-limit transient class**: `FAIL_TIMES=1`, message "Error: 429
   rate limit exceeded, please try again later", `--retries 1` -> status 0,
   `attempts:2`, one warning `/429|rate limit/i`; counter == 2.
6. **NEW generic please-try-again (must NOT retry, fixes Medium)**: `FAIL_TIMES=1`,
   message "Some permanent failure. Please try again", `--retries 2` -> NOT
   retried, status 1, `ok:false`, `attempts:1`; counter == 1.
7. non-transient-no-retry (auth): `FAIL_TIMES=1`, "stream error: missing bearer
   token", `--retries 2` -> shim would succeed on attempt 2, but wrapper must NOT
   retry: status 1, `ok:false`, `attempts:1`; counter == 1.
8. **NEW unsupported-model exclusion**: "model gpt-5.6-terra is not supported for
   this ChatGPT account", `FAIL_TIMES=1`, `--retries 2` -> not retried, status 1,
   `attempts:1`; counter == 1.
9. **NEW unsupported reasoning-effort exclusion**: "reasoning effort 'xhigh' is not
   supported for this model", `FAIL_TIMES=1`, `--retries 2` -> not retried, status
   1, `attempts:1`; counter == 1. Guards the narrowed effort pattern's
   true-positive side (banner echo `reasoning effort: high` alone not matching is
   covered by test 2).
10. **NEW mixed durable+transient single line (durable-first-per-line)**: "Selected
    model is at capacity. You've hit your weekly usage limit.", `FAIL_TIMES=1`,
    `--retries 2` -> not retried, status 1, `attempts:1`; counter == 1.
11. retries-exhausted: `FAIL_TIMES=5`, capacity message, `--retries 2` -> status 1,
    `ok:false`, `attempts:3`, two retry warnings, `error` carries the capacity
    tail; counter == 3.
12. **NEW stale-final-message sentinel (fixes Medium)**: `FAIL_TIMES=1` +
    `FAKE_CODEX_FAIL_WRITES_FINAL=1` (attempt 1 fails on a capacity message after
    writing a `{"summary":"STALE"}` final message) + `FAKE_CODEX_NO_FINAL=1`
    (attempt 2 exits 0 writing nothing), `--retries 2` -> status 1, `ok:false`,
    error `/did not write a final message/`, result does NOT contain `STALE`,
    `attempts:2`; counter == 2. Proves the pre-attempt delete prevents serving the
    stale sentinel and the contract failure is reported instead.
13. sandbox-wrapper transient class: "windows unelevated restricted-token sandbox
    cannot enforce split writable root sets directly; refusing to run unsandboxed",
    `FAIL_TIMES=1`, `--retries 1` -> status 0, `attempts:2`; counter == 2.
14. **NEW exit-0 malformed-final-message-JSON (must NOT retry)**:
    `FAKE_CODEX_BAD_FINAL=1`, `--retries 2` -> status 1, `ok:false`, error `/not
    valid JSON|no extractable JSON/`, `attempts:1`, counter == 1 (single
    invocation proves the readResult contract failure never re-enters the loop).
15. **NEW exit-0 missing-final-message-file (must NOT retry)**:
    `FAKE_CODEX_NO_FINAL=1`, `--retries 2` -> status 1, `ok:false`, error `/did not
    write a final message/`, `attempts:1`, counter == 1.
16. **NEW preflight-failure-with-retries**: `FAKE_CODEX_FAIL_VERSION=1`, `--retries
    2` -> status 1, `ok:false`, error from `formatCodexUnavailable`, `attempts:0`,
    counter == 0 (no `codex exec` ever ran).
17. structural-equivalence / field-gating (contract option b, narrowed to the two
    in-scope paths): (a) run the plain SUCCESS fake once with the flag OMITTED and
    once with `--retries 0`; assert neither JSON has an `attempts` key and no
    warning matches `/attempt|retry/i`; delete `durationMs` and `sessionDir` from
    both and `assert.deepEqual`. (b) Same for the plain FAILURE fake (capacity
    message, large `FAIL_TIMES`): flag omitted vs `--retries 0`, assert attempts
    absent, no retry warning, deep-equal modulo `durationMs` + `sessionDir`.
18. `--help` documents `--retries` (extend the help-contract test with
    `/--retries/`).
19. invalid value: `--retries -1` and `--retries abc` -> status 2, stderr
    `/--retries must be a non-negative integer/`.

`npm run check` (node --check) and `npm test` (node --test) are the acceptance
gate; both must pass in `../codex-task`.

### Documentation updates

- `SKILL.md` "How to invoke" synopsis: add `[--retries N]`.
- `SKILL.md` Wrapper options: new `--retries` bullet — default 0 preserves current
  behavior; retries only transient infrastructure classes (model-capacity incl.
  "at capacity" and 429/rate-limit/temporarily-unavailable/overloaded;
  sandbox-wrapper prep failures); explicitly NOT auth, unsupported model/effort,
  durable quota/usage cap, generic "please try again", or JSON/contract failures;
  short fixed backoff; serial (never parallel).
- `SKILL.md` Output / Field semantics: document `attempts` (present only when
  `--retries > 0`; equals `codex exec` invocation count, 0 if it failed before the
  loop) and the per-retry warning entries.
- `SKILL.md` "After invoking" / Failure modes: point "re-run only if it looks like
  a transient codex hiccup" at `--retries` as the built-in automated path.
- `codex-task.mjs` `printUsage` (`:194`): mirror the flag doc (a help-contract test
  asserts on it).
- No README index change (README not in scope).

### Risks and edge cases

- Classification window size (primary new risk). `classifyFailure` assumes the
  operative codex terminal error is within the last `MAX_TAIL_SCAN` (= 3) non-blank
  lines. If a future codex version emits a terminal diagnostic longer than 3 lines
  with the classifiable phrase above the window, the tail classifies as
  non-transient and does not retry (fail-safe: we never *wrongly* retry a durable
  failure). `MAX_TAIL_SCAN` is a tunable constant; tests 2-4 pin the current
  multi-line shape. The full raw tail is still reported in `error`.
- Misclassification. A durable tail whose final line coincidentally matches a
  transient phrase wastes up to `n` bounded retries; the higher-stakes direction
  (retrying durable quota/auth) is blocked because the durable phrase, when it is
  the terminal line, matches Phase 1 first. The 429 / "rate limit" boundary is the
  key judgement call: transient unless a durable-cap phrase is the terminal line.
  Both directions are covered (tests 3, 4, 10).
- Wall-clock cost. Failed capacity attempts happened after 180s+ of work; `n`
  retries multiply worst-case latency. `n` bounds it; default 0 is opt-in.
- Idempotency of write tasks. Both observed transient classes fail *before* a
  successful write (capacity = pre-work; sandbox-wrapper = apply_patch refused),
  and codex runs `--ephemeral` (fresh read each attempt), so retry is as safe as
  the manual re-run it replaces. A transient failure *after* a partial write is
  identical in risk to today's human manual retry; noted, not solved.
- Stale `lastMessagePath` across attempts: eliminated by the mandatory pre-attempt
  `rmSync(lastMessagePath, { force: true })`; the sentinel test (12) guards it.
- Test flakiness from real sleeps: eliminated by `CODEX_TASK_RETRY_DELAY_MS=0`.

### Open questions (non-blocking; defaults chosen)

1. `attempts` presence gated to `--retries > 0` (honors the structural contract).
   Confirm vs always-present.
2. Backoff magnitude: fixed 2000 ms (env-overridable). Acceptable, or 0/1000 ms?
3. `MAX_TAIL_SCAN` = 3: confirm no known codex mode emits a terminal diagnostic
   whose classifiable phrase sits more than 3 non-blank lines above the end.

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
