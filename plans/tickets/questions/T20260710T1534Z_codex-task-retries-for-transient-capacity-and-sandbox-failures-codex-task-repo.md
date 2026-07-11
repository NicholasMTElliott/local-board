---
id: T20260710T1534Z
type: task
status: questions
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
updated: 2026-07-11T19:45:22Z
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
`../codex-task`, all code at `C:/Users/Nicho/Documents/codex-task`). The wrapper
retries an invocation, serially and in-process, up to `n` times with a short
fixed backoff when it observes one of **two** transient-infrastructure triggers,
and never otherwise. Default `n = 0` preserves today's behavior byte-for-byte.

The two retry triggers correspond to the two motivating transient classes from
the 2026-07-10 parallel-run retro, which surface in **structurally different**
codex outcomes:

- **Trigger A — non-zero exit.** `codex exec` exits non-zero and the diagnostic
  tail's terminal line classifies as a recognized transient class
  (model-capacity or sandbox-wrapper). This is the "capacity mid-run" shape.
- **Trigger B — clean exit, blocked result, sandbox-wrapper marker.** `codex exec`
  exits **0** with a contract-valid final message that normalizes to
  `taskResult === 'blocked'`, AND the captured output of that attempt contains a
  sandbox-wrapper tool-failure marker. This is the **real Windows sandbox-wrapper
  shape**: the wrapper failure is emitted as an `apply_patch` tool-call failure
  *inside a continuing codex turn*; codex recovers, finishes the turn, exits 0,
  and reports the write as blocked. The exit-non-zero loop alone never sees it.

Every other outcome — auth, unsupported model/effort, durable quota/usage-cap
exhaustion, generic "please try again" errors, JSON/contract failures
(missing/malformed final message), and task-level `partial`/`failed`, and
`blocked` results **without** a sandbox-wrapper marker (including a blocked result
whose tail carries only capacity text) — is non-transient and never retried.

This is revision #4 (post design review round 4 FAIL, one new High). Revision #3
delivered Trigger A (last-lines, first-classified-line-wins classification;
removal of bare "please try again"; mandatory pre-attempt final-message delete).
This revision adds **Trigger B** so the second motivating transient class — the
one the incident actually produced — is retried, and adds tests that model its
reachable shape (exit 0 + blocked + sandbox-wrapper text) rather than only a
synthetic exit-1 shape.

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
chars each) in `runCodex` (`codex-task.mjs:463-478`), and on
`runResult.code !== 0` builds the diagnostic via `formatCodexRunFailure`
(`:484`) which sets `tail = (stderrTail || stdoutTail || '').trim()`. There is
**no structured JSON on the non-zero path** — the result JSON is only the model's
final message, written via `--output-last-message`, and only exists after a
clean (code 0) exit. Exit codes are uninformative: codex returns non-zero for
every failure class with no distinct code. So error-text pattern matching on the
diagnostic tail is the only viable signal for Trigger A, exactly what
`codexFailureHint` (`:491`) already does.

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

The sandbox-wrapper transient markers are factored into a **single shared
constant** so both the Trigger A classifier and the Trigger B check use one
source of truth:

```js
// Isolated sandbox-wrapper PREP failures — retry can help. Shared by the
// Trigger A transient classifier and the Trigger B clean-exit-blocked check.
// Intentionally NARROW: wrapper-prep phrases only, NOT the broad sandbox branch
// in codexFailureHint. A generic permission / read-only denial is a config
// problem, not transient, so it is NOT retried.
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

### Trigger B: clean exit + blocked + isolated sandbox-wrapper marker (fixes review High)

**The reachable shape the reviewer identified.** The motivating Windows incident
did NOT produce a non-zero exit. codex hit the sandbox-wrapper failure while
executing an `apply_patch` tool call *inside* a turn, surfaced it as a tool-call
failure, continued the turn, and exited **0**. The wrapper's post-exit path
(`:770-812`) then parsed a contract-valid final message and `normalizeResult`
(`:581`) produced `taskResult === 'blocked'` (codex's own prompt guidance, `:356`,
maps sandbox/auth/external blockers to `blocked`). Trigger A's
`runResult.code !== 0` loop never fires here, so revision #3 would never retry the
second motivating class. This revision adds Trigger B to cover it.

**The second-trigger rule, stated precisely:**

> On a clean (`code === 0`) exit whose final message is present, parses, and
> normalizes to `taskResult === 'blocked'`, scan the **full captured output of
> that attempt** — both `stdoutTail` and `stderrTail`, not a last-N-line window —
> for any `SANDBOX_WRAPPER_PATTERNS` marker ("failed to prepare ... sandbox
> wrapper", "cannot enforce split writable root sets", "refusing to run
> unsandboxed", "restricted-token sandbox"). Retry the invocation only when such a
> marker is present AND retries remain. Every other clean-exit result is NOT
> retried by Trigger B: `completed`, `partial`, and `failed` regardless of tail
> content; and `blocked` whose captured tail contains no sandbox-wrapper marker —
> including a `blocked` result whose tail carries only capacity / rate-limit text.

Implemented as a small helper distinct from `classifyFailure` because the marker
is **mid-turn, not terminal** on this path:

```js
// Trigger B: the sandbox-wrapper tool failure is emitted DURING a turn (an
// apply_patch failure) and codex then exits 0, so the marker is NOT the last
// line. Scan the WHOLE captured tail (both streams), not a last-N-line window.
// Only the sandbox-wrapper class qualifies here (see decisions below); capacity
// text on a clean-exit blocked result does NOT retry.
function findSandboxWrapperMarker(runResult) {
  const hay = `${runResult.stdoutTail || ''}\n${runResult.stderrTail || ''}`;
  for (const line of hay.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    if (SANDBOX_WRAPPER_PATTERNS.some((re) => re.test(line))) return line;
  }
  return null;
}
```

**Decision 1 — `blocked` only, NOT `partial` (conservative).** Only
`taskResult === 'blocked'` gates Trigger B. Justification:

- `blocked` is codex's designated outcome for an external blocker it could not
  work around (prompt guidance `:356`: "sandbox, auth, missing dependency, or
  another external" blocker). The sandbox-wrapper `apply_patch` refusal maps
  exactly onto `blocked`, so it is the correct and sufficient gate for the
  incident's shape.
- `partial` means "some requested outcomes were achieved, but not all" (`:355`) —
  it signals **real, committed progress**. Re-running a partial task is not a
  clean transient retry: codex runs `--ephemeral` (fresh read each attempt) and
  would redo already-completed writes, risking duplicated or conflicting edits,
  and a partial result is a substantive task-level outcome the operator should
  see, not silently repeat. There is no evidence the incident ever produced
  `partial`; it produced a fully-blocked write. Admitting `partial` would widen
  the retry surface to genuine progress with no observed benefit, so it is
  excluded. (`failed`/`completed` are likewise excluded: `completed` succeeded;
  `failed` is a substantive negative outcome, and a sandbox-wrapper prep failure
  that fully failed the run surfaces on the non-zero-exit path as Trigger A, not
  as a clean exit.)

**Decision 2 — capacity text on a clean-exit blocked result does NOT retry.**
Trigger B checks only `SANDBOX_WRAPPER_PATTERNS`, never `TRANSIENT_PATTERNS`
capacity markers. Justification:

- A clean exit with a parsed final message is **proof the model was reachable and
  drove a turn to completion** — it produced a structured result. So a `blocked`
  outcome here is a **task-level determination**, not an infrastructure
  reachability failure. Capacity ("at capacity" / 429) text appearing in the tail
  of such a run is at most stale mid-turn streamed noise; the run demonstrably was
  not throttled off the model (it finished the turn). Retrying it would re-run a
  task codex already adjudicated as blocked for a task-level reason, wasting a
  full re-read for no expected change.
- The sandbox-wrapper class is different: it is an **isolated tool-call failure**
  (the OS refused the sandbox wrapper for one `apply_patch`) that codex could not
  work around but which is transient at the environment level — the manual
  immediate re-run in the retro succeeded. That single isolated, environment-level
  failure blocking an otherwise-reachable turn is exactly what warrants an
  automatic retry, and nothing else on the clean-exit path does.

No concrete reason was found to widen either split, so both stay narrow: Trigger B
= `blocked` AND sandbox-wrapper-marker only.

### Which failure paths retry wraps

Retries wrap the `runCodex` attempt loop in `main()`. The two triggers and their
exclusions:

- **Trigger A** — `runResult.code !== 0` and `classifyFailure(tailOf(runResult))`
  returns a non-null label (model-capacity or sandbox-wrapper). Retries.
- **Trigger B** — `runResult.code === 0`, `readResult` ok, `taskResult` normalizes
  to `blocked`, and `findSandboxWrapperMarker(runResult)` is non-null. Retries.

Explicitly NON-retryable (unchanged from revision #3 except where noted):

- Spawn errors (`child.on('error')` -> "failed to spawn codex", `:746`):
  environmental, already gated by the `checkCodexAvailable` preflight; part of
  attempt 1, emitted immediately (with `attempts` when gated).
- `readResult` failures on a code-0 exit (missing / empty / non-JSON / malformed
  final message, `:770-782`): contract failures — a Non-goal; they need a prompt
  fix, not a repeat. Structurally these are the code-0 branch with `!read.ok`, and
  the loop treats them as a terminal (break) outcome, never a retry — asserted by
  dedicated tests (exit-0 malformed JSON, exit-0 missing-final-message, and the
  stale-file sentinel test). This holds identically under Trigger B: Trigger B is
  evaluated only when `read.ok` is true.
- Task-level `partial` / `failed` on a clean exit: substantive outcomes; never
  retried.
- `blocked` on a clean exit **without** a sandbox-wrapper marker (including a
  blocked result whose tail has only capacity text): never retried (Decisions 1-2).

### Final-message file hygiene across attempts

All attempts reuse one `sessionDir` / `lastMessagePath`. At the TOP of every
retry-loop iteration, before each `runCodex`, the loop runs
`rmSync(lastMessagePath, { force: true })`. This makes the invariant exact:
`readResult` runs only after a code-0 exit, and the file was cleared immediately
before that attempt's `codex exec`, so it reflects **only what that attempt
wrote** (or its absence). `force: true` makes the first-attempt delete a no-op.
This single pre-attempt delete covers **both** trigger paths' re-runs identically
(item 3 of the mandate): a Trigger B retry re-enters the loop top, deletes the
prior attempt's blocked final message, and re-runs, so the next attempt's
`readResult` again sees only its own write.

Justification vs attempt-specific paths (`last-message.<attempt>.txt`): a single
reused path keeps `sessionDir`, `--debug` retention, and the
`--output-last-message` spawn arg identical to today; per-attempt paths would
require rebuilding `buildSpawnArgs` each iteration. The pre-delete is one line and
strictly sufficient.

The stale-file sentinel test (test 12) still guards a Trigger A retry that clears
a stale final message before a later clean, no-message attempt.

### Implementation approach (codex-task.mjs)

1. Arg parsing (`parseArgs`, `:122`): add `--retries`. Parse `next` as a
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
   incremented count. Both trigger paths share this counter, so `attempts`
   semantics are identical across them (item 3).
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
   - **Clean-exit branch** (`runResult.code === 0`): `const read =
     readResult(lastMessagePath);` if `!read.ok`, `break` (contract failure —
     never retried; falls through to the existing `:770` handling which re-derives
     and emits it). Else compute `const peek = normalizeResult(read.value, {
     trackReferences: args.trackReferences });` **only to read `peek.taskResult`**
     (`normalizeResult` is pure — its warnings are pushed once by the post-loop
     path, so this peek must NOT push `peek.warnings`). If
     `peek.taskResult === 'blocked' && attempt <= retries` and
     `const marker = findSandboxWrapperMarker(runResult)` is non-null: push warning
     ``codex attempt ${attempt}/${retries + 1} exited cleanly but reported
     taskResult=blocked with a sandbox-wrapper tool failure (${marker}); retrying``,
     sleep `backoffMs` unless final attempt, `continue`; else `break`.
   - after the loop, the code path is UNCHANGED: the existing `runResult.code !== 0`
     emit (`:758`) reports the last non-zero failure via `formatCodexRunFailure`
     (full raw tail), and the existing code-0 `readResult` -> `normalizeResult` ->
     emit path (`:770-812`) runs on a clean exit exactly as today (re-reading the
     last attempt's file, which is still present because `rmSync` runs only at the
     next loop top). The loop only decides `continue` (retry) vs `break` (proceed
     to the existing post-loop handling); no post-loop emit block changes.
   - `tailOf(runResult)` derives the same `(stderrTail || stdoutTail).trim()`
     string `formatCodexRunFailure` uses (Trigger A input). `findSandboxWrapperMarker`
     scans both streams combined (Trigger B input). `error` still reports the full
     Trigger A tail.
4. Backoff: **short fixed** delay. Constant `RETRY_BACKOFF_MS` (2000 ms),
   overridable via env `CODEX_TASK_RETRY_DELAY_MS` so tests set `0` and never
   sleep. No backoff after the final failed/blocked attempt. Both triggers use the
   same backoff.

Serial discipline: the loop `await`s each `runCodex` before the next; retries are
strictly sequential in the single process. No new concurrency, no `CODEX_HOME`
isolation.

Recompute note: the code-0 branch computes `peek` inside the loop only to read
`taskResult`; the unchanged post-loop path recomputes `readResult` +
`normalizeResult` once more on the final attempt and is the sole place that pushes
`norm.warnings` and emits. This double-normalize is idempotent (pure function) and
keeps the existing emit blocks verbatim, minimizing diff.

### attempts on pre-retry-loop early failures

Three structured results are emitted after argument parsing but before the retry
loop runs (zero `codex exec` invocations). Each MUST carry `attempts: 0` when
`retriesEnabled`:

1. Invalid working directory — `--cwd ... does not exist` emit (`:676-685`, exit 2).
2. Codex preflight failure — `checkCodexAvailable` not-ok emit (`:692-702`, exit 1).
3. Session-directory creation failure — `mkdirSync` catch emit (`:713-723`, exit 1).

Argument-parse failures exit via `usageErr` (exit 2) BEFORE any result object is
built and emit no structured JSON, so they are outside this contract. The uniform
gated-emit approach (step 2) covers all three sites automatically.

### JSON result reporting and the structural-equivalence contract

- `attempts`: integer = number of `codex exec` invocations (0 = failed before the
  loop; 1 = one invocation, no retry; 2 = one retry; ...). Present only when
  `--retries > 0`. Identical meaning for Trigger A and Trigger B retries.
- Warnings: one entry per retried failure, quoting the matched diagnostic line (or
  sandbox-wrapper marker) and the trigger class + attempt index, appended to the
  existing `warnings` array.

`emit` (`:637`) serializes with `JSON.stringify(r, null, 2)` in object-literal
insertion order.

The structural-equivalence acceptance line uses **option (b), a NARROW structural
contract** (not fixed-clock / session injection + stdout fixture):

> Contract scope: the two paths exercised by the structural-equivalence test —
> (i) the clean-success emit (`:799`), and (ii) the `runResult.code !== 0`
> failure emit (`:758`) driven by a **fixed** fake diagnostic tail. On both, the
> ONLY nondeterministic fields are `durationMs` and `sessionDir`. For a given
> input on these two paths: with `--retries` omitted (or `0`) the result has **no
> `attempts` key** and **no retry-related warning**, and after deleting
> `durationMs` and `sessionDir` is **deep-equal** to the result the same input
> produces with the flag entirely absent. This is explicitly NOT a universal
> deep-equality claim; the session-dir-failure, missing-final-message,
> unreadable-final-message, and cleanup-failure paths embed the session path in
> `error` / `warnings` and are out of scope (their no-retry behavior is asserted
> separately by invocation-count).

Trigger B does not perturb the default: with `retries = 0`, `attempt <= retries`
is `1 <= 0` (false), so no clean-exit-blocked retry ever fires, and the blocked
result emits exactly as today with no `attempts` key.

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
  `attempts` emit, retry loop in `main()` (with pre-attempt `rmSync`, Trigger A
  and Trigger B branches), `classifyFailure()` (+ `NON_TRANSIENT_PATTERNS` /
  `TRANSIENT_PATTERNS` + `MAX_TAIL_SCAN`), shared `SANDBOX_WRAPPER_PATTERNS`,
  `findSandboxWrapperMarker()`, `tailOf()`, backoff constant + env override,
  `printUsage` text.
- `SKILL.md` — see docs section.
- `tests/cli-smoke.test.mjs` — extend fake-codex shim + new tests.
- No changes to `install.mjs` or `scripts/permission-matrix.mjs`.

### Test strategy and seams

`makeFakeCodex()` (`tests/cli-smoke.test.mjs:204`) builds a per-call temp dir with
a `codex.cmd` / `codex` shim delegating to `fake-codex.mjs`; PATH is prepended so
the fake wins. The shim answers `--version` and exits BEFORE any other logic
(`fakeCodexJs`, `:233`), so a disk counter equals the number of `codex exec`
invocations, i.e. the true attempt count.

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
- **NEW `FAKE_CODEX_BLOCK_TIMES` (int, default 0)** — leading invocations that
  model the reachable Trigger B shape: exit **0**, write a contract-valid final
  message `{"taskResult": FAKE_CODEX_BLOCK_RESULT, "summary": "sandbox blocked"}`
  to the `--output-last-message` path, and write `FAKE_CODEX_BLOCK_MARKER` to
  **stderr** to model the mid-turn tool-failure text. On `count > BLOCK_TIMES`,
  fall through to the normal SUCCESS branch (a `completed` final message, exit 0).
- **NEW `FAKE_CODEX_BLOCK_MARKER`** — the stderr text on a blocked invocation
  (sandbox-wrapper text, capacity text, or empty).
- **NEW `FAKE_CODEX_BLOCK_RESULT` (default `blocked`)** — the `taskResult` value
  written by the blocked-mode branch, so a test can also emit `partial`.

All retry tests set `CODEX_TASK_RETRY_DELAY_MS=0` and assert the state-file counter
alongside the reported `attempts` field — they must agree.

Tests (existing retained/renumbered; NEW marks additions in this revision):

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
    `attempts:2`; counter == 2. (Retained; models a hypothetical exit-non-zero
    sandbox failure, distinct from the reachable clean-exit shape in tests 20-23.)
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
20. **NEW clean-exit blocked + sandbox-wrapper -> retry then success (Trigger B,
    the real incident shape)**: `FAKE_CODEX_BLOCK_TIMES=1`,
    `FAKE_CODEX_BLOCK_MARKER` = "windows unelevated restricted-token sandbox cannot
    enforce split writable root sets directly; refusing to run unsandboxed"
    (to stderr), `--retries 2` -> attempt 1 exits 0 with `taskResult:blocked` +
    marker, attempt 2 exits 0 `completed`. Expect status 0, `ok:true`,
    `taskResult:'completed'`, `attempts:2`, exactly one warning matching
    `/sandbox|blocked/i`; counter == 2. Proves Trigger B retries the reachable shape
    and eventually succeeds.
21. **NEW clean-exit blocked + capacity text -> NO retry (Decision 2)**:
    `FAKE_CODEX_BLOCK_TIMES=1`, `FAKE_CODEX_BLOCK_MARKER` = "Selected model is at
    capacity", `--retries 2` -> attempt 1 exits 0 with `taskResult:blocked` +
    capacity text. Expect NOT retried: status 1, `ok:false`, `taskResult:'blocked'`,
    `attempts:1`, no retry warning; counter == 1. Proves capacity on a clean-exit
    blocked result does not trigger Trigger B.
22. **NEW clean-exit blocked, no transient marker -> NO retry**:
    `FAKE_CODEX_BLOCK_TIMES=1`, `FAKE_CODEX_BLOCK_MARKER` empty, `--retries 2` ->
    status 1, `ok:false`, `taskResult:'blocked'`, `attempts:1`, no retry warning;
    counter == 1. Proves a plain blocked result is a task-level outcome, not retried.
23. **NEW clean-exit partial + sandbox-wrapper -> NO retry (Decision 1,
    blocked-only)**: `FAKE_CODEX_BLOCK_TIMES=1`, `FAKE_CODEX_BLOCK_RESULT=partial`,
    `FAKE_CODEX_BLOCK_MARKER` = a sandbox-wrapper line, `--retries 2` -> status 1,
    `ok:false`, `taskResult:'partial'`, `attempts:1`, no retry warning; counter == 1.
    Proves `partial` does not qualify for Trigger B even with a sandbox marker.

`npm run check` (node --check) and `npm test` (node --test) are the acceptance
gate; both must pass in `../codex-task`.

### Documentation updates

- `SKILL.md` "How to invoke" synopsis: add `[--retries N]`.
- `SKILL.md` Wrapper options: new `--retries` bullet — default 0 preserves current
  behavior; retries only transient infrastructure, in two shapes: (a) a non-zero
  codex exit whose terminal diagnostic is model-capacity ("at capacity",
  429/rate-limit/temporarily-unavailable/overloaded) or a sandbox-wrapper prep
  failure; and (b) a **clean exit that reports `taskResult: blocked` with a
  sandbox-wrapper tool failure in the output** (the Windows apply_patch case).
  Explicitly NOT retried: auth, unsupported model/effort, durable quota/usage cap,
  generic "please try again", JSON/contract failures, `partial`/`failed` results,
  and a `blocked` result whose only transient-looking text is capacity (the model
  was reachable — blocked is task-level). Short fixed backoff; serial (never
  parallel).
- `SKILL.md` Output / Field semantics: document `attempts` (present only when
  `--retries > 0`; equals `codex exec` invocation count, 0 if it failed before the
  loop) and the per-retry warning entries.
- `SKILL.md` "After invoking" / Failure modes: point "re-run only if it looks like
  a transient codex hiccup" at `--retries` as the built-in automated path, noting
  it now also covers the clean-exit blocked sandbox-wrapper case.
- `codex-task.mjs` `printUsage` (`:194`): mirror the flag doc (a help-contract test
  asserts on it).
- No README index change (README not in scope).

### Risks and edge cases

- Trigger B tail scan (primary new risk). The sandbox-wrapper marker is matched
  anywhere in the combined 4000-char-capped `stdoutTail` + `stderrTail`. If a very
  long turn pushes the marker out of both 4000-char windows before codex exits 0,
  Trigger B misses it and the run reports `blocked` without retry (fail-safe: never
  a wrong retry). The observed incident's tool failure is near the run's end, well
  within the window. The narrowness of `SANDBOX_WRAPPER_PATTERNS` (wrapper-prep
  phrases only) keeps false positives low; a generic permission/read-only denial in
  a blocked tail is a config problem and does not match.
- Whole-tail vs last-N-lines asymmetry. Trigger A uses the terminal window (the
  operative error is last); Trigger B scans the whole tail (the marker is mid-turn).
  This asymmetry is deliberate and reflects the two distinct codex output shapes;
  conflating them would either miss Trigger B (last-N) or over-match Trigger A
  (whole-tail catching earlier streamed durable text).
- Classification window size (Trigger A). `classifyFailure` assumes the operative
  terminal error is within the last `MAX_TAIL_SCAN` (= 3) non-blank lines; a longer
  future terminal diagnostic with the classifiable phrase above the window
  classifies non-transient (fail-safe). Tunable constant; tests 2-4 pin the shape.
- Misclassification. A durable tail whose final line coincidentally matches a
  transient phrase wastes up to `n` bounded retries; the higher-stakes direction
  (retrying durable quota/auth) is blocked because the durable phrase, when
  terminal, matches Phase 1 first. Both directions covered (tests 3, 4, 10, 21).
- Wall-clock cost. Failed attempts happened after 180s+ of work; `n` retries
  multiply worst-case latency. `n` bounds it; default 0 is opt-in.
- Idempotency of write tasks. Both observed transient classes fail *before* a
  successful write (capacity = pre-work; sandbox-wrapper = apply_patch refused), and
  codex runs `--ephemeral` (fresh read each attempt), so retry is as safe as the
  manual re-run it replaces. `blocked`-only (excluding `partial`) keeps Trigger B
  from re-running a run that already committed partial progress. A transient failure
  *after* a partial write is identical in risk to today's human manual retry; noted,
  not solved.
- Stale `lastMessagePath` across attempts: eliminated by the mandatory pre-attempt
  `rmSync(lastMessagePath, { force: true })`, covering both trigger paths; sentinel
  test (12) guards it.
- Test flakiness from real sleeps: eliminated by `CODEX_TASK_RETRY_DELAY_MS=0`.

### Open questions (non-blocking; defaults chosen)

1. `attempts` presence gated to `--retries > 0` (honors the structural contract).
   Confirm vs always-present.
2. Backoff magnitude: fixed 2000 ms (env-overridable). Acceptable, or 0/1000 ms?
3. `MAX_TAIL_SCAN` = 3 (Trigger A): confirm no known codex mode emits a terminal
   diagnostic whose classifiable phrase sits more than 3 non-blank lines above end.
4. Trigger B is `blocked`-only and sandbox-wrapper-only (Decisions 1-2). Confirm no
   maintainer preference to also retry `partial` or capacity-on-clean-exit.

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

2026-07-10, parked by the orchestrator after design review round 5 (declared final round) returned FAIL.

Five sol@xhigh design-review rounds each found a genuinely new defect; rounds 1-4 were resolved in revisions (classifier exclusion ordering; banner-tail isolation replaced by last-lines scan; bare try-again removed; stale final-message deletion; clean-exit blocked+sandbox Trigger B). The remaining round-5 High: Trigger B scans untyped stdout/stderr tails for sandbox-wrapper phrases, so a prompt or model explanation that merely MENTIONS such a phrase on a blocked-for-durable-reasons run would be retried - a transient-only violation. Recommended fix per the reviewer: constrain matching to an identifiable tool-failure record or structured codex event (excluding prompt/final-response echoes) plus a negative echo test.

Question for the user - pick a direction:
1. Continue: one more design round constraining Trigger B to structured tool-failure evidence (requires inspecting codex's event/output structure for a reliable tool-failure frame; the classifier work so far suggests unstructured text keeps leaking).
2. Descope Trigger B: ship --retries for the non-zero-exit capacity class only (Trigger A, already review-hardened); Windows sandbox blocked-runs stay a manual re-dispatch, documented as a known limitation.
3. Accept the residual risk and ship Trigger B as designed (the false-positive needs the conjunction of a marker phrase in prompt/output AND a durable blocked result; retry cost is one duplicate --ephemeral run).

Orchestrator's recommendation: option 2 - the capacity class caused both observed incidents' retries to succeed and is cleanly detectable; Trigger B's value is real but its reliable form needs structured-event work disproportionate to a P3.

Design state is fully preserved in the Technical Design section (both triggers specified, tests 1-23 enumerated) - any option resumes from there.

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
