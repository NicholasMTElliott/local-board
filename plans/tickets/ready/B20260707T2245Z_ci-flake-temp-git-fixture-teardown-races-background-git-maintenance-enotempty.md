---
id: B20260707T2245Z
type: bug
status: ready_for_implementation
priority: P1
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: 2
estimateBasis: B20260707T1322Z
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T22:45:32Z
updated: 2026-07-07T22:53:19Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
routingApprovals: []
---
# CI flake: temp git fixture teardown races background git maintenance (ENOTEMPTY)

## Requirement

GitHub Actions CI (ubuntu, Node 20/22) fails intermittently — roughly half of today's mainline pushes — always with the same signature: `ENOTEMPTY: directory not empty, rmdir '/tmp/local-board-*/.git/objects/pack'` (or `.git/objects`, `.git/info`) thrown during the recursive removal of a temp git fixture in test teardown. The failing test varies per run (worktree-add, validate/list, move done, gitignore append — runs 28901276019, 28901212625, 28897378880, 28893075980, 28891314668); the assertion itself passed in every case. Local Windows runs never hit it.

Root cause: test fixtures run real `git` commands (init/commit/worktree), which can spawn background maintenance (auto gc, detached object packing). Teardown then does an unretried recursive `rm` of the fixture directory while a git process is still writing into `.git`, so a directory becomes non-empty between readdir and rmdir.

Fix direction:
1. Disable background maintenance in fixtures: create fixture repos with `gc.auto=0` and `gc.autoDetach=false` (via `git -c` flags on init/commit, a fixture-level `git config`, or GIT_CONFIG_* env in the test helpers) so git never detaches a writer.
2. Make teardown resilient: a shared removeFixtureDir helper using fs.rm with { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } (Node retries ENOTEMPTY/EBUSY with these options) instead of bare rmSync.
Apply both to every test helper that creates temp git repos (test/git.test.js, test/worktrees.test.js, test/tickets.test.js fixture helpers, and any others found by grep for mkdtemp + git).

Acceptance: all fixture-creating test helpers disable auto-gc and use retrying teardown; a CI run (or several consecutive pushes) passes; no ENOTEMPTY teardown failures reproducible under a stress loop of the worktree suite.

## Acceptance Criteria

## Related Tickets

## Technical Design

Fixes the intermittent ubuntu CI failure where recursive teardown of a `/tmp` git fixture throws `ENOTEMPTY` on `.git/objects[/pack|/info]`. Two independent, additive changes: (1) stop git from spawning background maintenance in fixture repos, and (2) make fixture teardown retry the recursive remove. Both are test-only; no production source changes.

## Root cause (confirmed against the code)

Every affected fixture creates a real repo with `git init`, runs commits, and in the worktree suites triggers production `git worktree add` (via `src/worktrees.js`) and auto-merge (via `src/git.js` `gitRun`). Teardown then does an **unretried** `rm(dir, { recursive: true, force: true })`. On Linux, git can detach a background gc/object-packing writer that is still creating files under `.git/objects` after the assertion returns; `fs.rm` reads a directory as empty, then `rmdir` fails because the writer re-populated it. Windows never detaches the same way, matching the Windows-clean observation. The failing test varies run-to-run because the race is timing-driven, and it is always in teardown, never an assertion — exactly the reported signature.

## Affected files (every fixture helper that creates a real git repo)

| File | Helper | Teardown site | Notes |
| --- | --- | --- | --- |
| `test/worktrees.test.js` | `withRepo` (line ~18) | two `rm` calls, lines ~42-43 (`worktreesRoot` then `root`) | Highest risk. Exercises `git worktree add` in production code; commits + object packing most active here. Both `rm` calls need the retry helper. |
| `test/git.test.js` | `withRepo` (line ~17) | `rm` line ~32 | Auto-merge / commit-heavy (`move done`, branch prune). |
| `test/active-steps.test.js` | `withRepo` (line ~34) | `rm` line ~48 | Calls `addTicketWorktree` (production) in the worktree-ledger test. |
| `test/hooks.test.js` | `withRepo` (line ~17) | `rm` line ~23 | Only `git init -q`, no commits — lowest risk, but included for uniformity. |

Non-git fixtures (`withBoard` in `test/active-steps.test.js` and `test/cli.test.js`, plus `test/tickets.test.js`, `test/config.test.js`, `test/lock.test.js`, `test/prompt-scaffold.test.js`, `test/install.test.js`) run `local-board init` only — no `git init`, so no background maintenance. They are **out of scope** for the auto-gc change. Converting their teardown to the shared retry helper is optional and harmless; recommend doing it only where it costs nothing (keeps one teardown idiom repo-wide).

Each of the four git fixture files today **duplicates** its own `git`, `hasGit`, and `runCli` helpers — there is no shared test-helper module yet.

## Approach

### Part 1 — disable background maintenance in fixture repos

The mechanism must cover **all** git invocations against a fixture, including the ones the production code under test spawns (`src/git.js` `gitRun`/`gitOutput` and `src/worktrees.js`, all of which shell out to `git -C <root> ...`). That rules out `git -c gc.auto=0` flags on the test-local `git()` helper alone, because production code builds its own argv and would not carry the flags.

Two mechanisms do cover production invocations. Recommended primary: **per-repo `git config` immediately after `git init`.**

```js
await git(root, ["init"]);
await git(root, ["config", "gc.auto", "0"]);
await git(root, ["config", "gc.autoDetach", "false"]);
```

- Writes to the fixture's `.git/config`, which every later `git -C <root> ...` reads — test helper AND production code alike.
- Linked worktrees created by `git worktree add` share the main repo's `.git/config` (no `extensions.worktreeConfig` is set), so the setting applies to operations run inside the worktree too. No per-worktree config needed.
- Explicit and self-documenting; scoped to the fixture only; no process-global state.
- Cost: two extra `git` subprocesses per fixture setup. Negligible.

Apply in all four `withRepo` helpers (including `hooks.test.js`, whose `git init -q` gets the same two `config` calls).

Alternative considered — **`GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n` env**, set once at the top of each fixture file (or via a shared import side-effect):

```js
process.env.GIT_CONFIG_COUNT = "2";
process.env.GIT_CONFIG_KEY_0 = "gc.auto";        process.env.GIT_CONFIG_VALUE_0 = "0";
process.env.GIT_CONFIG_KEY_1 = "gc.autoDetach";  process.env.GIT_CONFIG_VALUE_1 = "false";
```

- Broadest coverage: every git the process spawns inherits it, including `git init` itself and worktree-created repos, with zero per-fixture wiring.
- `node --test` runs each test file in its own child process, so a module-top-level `process.env` mutation is isolated to that file and safe under the runner's per-file parallelism (the values are constant, so intra-file test concurrency is a non-issue).
- Downside: process-global and slightly "magic" (affects any git the process runs, not just the fixture); a stray `GIT_CONFIG_COUNT` already in the CI environment would need care (unlikely here).

Recommendation: use the per-repo `git config` (explicit, local, obviously correct) as the primary fix. The env approach is a reasonable fallback if a future fixture is added that runs git before the `config` calls land; note it but do not adopt both.

### Part 2 — resilient teardown

Introduce one shared helper and route every fixture teardown through it, so the retry semantics live in exactly one place:

- New file `test/helpers/fixtures.js` exporting:

```js
import { rm } from "node:fs/promises";
export async function removeFixtureDir(dir) {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
```

- `maxRetries: 10, retryDelay: 100` — Node's `fs.rm` retries exactly the errno set that includes `ENOTEMPTY` (also `EBUSY`, `EMFILE`, `ENFILE`, `EPERM`) when `maxRetries > 0`, with a linear backoff of `retryDelay * attempt`. Worst-case added latency per removed dir is ~5.5s, only paid when a race is actually in flight; the normal path is unaffected. This directly absorbs the observed `ENOTEMPTY` even if Part 1 misses an edge.
- Replace every `rm(dir, { recursive: true, force: true })` in the four `withRepo` teardowns (and both `rm` calls in `worktrees.test.js`) with `await removeFixtureDir(dir)`.

Rationale for a shared module over per-file duplication: the retry constants are a correctness contract; four hand-copied copies would drift. The module is tiny and imported with the existing ESM style. It is acceptable to leave the per-file `git`/`hasGit`/`runCli` duplication as-is for this ticket (out of scope) rather than expand the refactor.

Defense-in-depth: Part 1 removes the cause, Part 2 removes the symptom. Ship both. Even with auto-gc disabled, a slow filesystem-sync or antivirus/indexer on the runner could still momentarily hold a handle; the retry keeps teardown robust.

## Risks and edge cases

- **Worktree config inheritance.** Verified assumption: `git worktree add`-created worktrees read gc config from the parent repo's shared `.git/config`; setting it once on the main repo covers them. No `extensions.worktreeConfig` is enabled anywhere, so this holds.
- **`worktrees.test.js` two-call teardown ordering.** `worktreesRoot` is removed before `root`. For sibling layout `worktreesRoot` is an outside temp sibling; for inside layout it is `root/.worktrees`. Both must use `removeFixtureDir`. Leaving one un-retried would keep a live race window.
- **Env-vs-parallelism (only if the env mechanism is chosen).** Safe because `node --test` forks per file; documented above. Not a concern for the recommended `git config` mechanism.
- **`fs.rm` retry coverage is version-dependent only in ancient Node.** Engines require `>=20`; both CI matrix versions (20.x, 22.x) support `maxRetries`/`retryDelay` and retry `ENOTEMPTY`. No compatibility gap.
- **Not a masking fix.** Disabling auto-gc changes nothing about what the tests assert (they never assert on pack layout); it only removes a background writer. The retry only affects teardown, never assertions.
- **Residual `.git/worktrees/<name>` metadata** when a worktree dir is removed without `git worktree remove` is pre-existing test behavior and unaffected by this change.

## Test strategy

Cannot reproduce on Windows locally (the race is Linux-specific), so verification is layered:

1. **Correctness/regression:** run the full suite locally (`npm test`) after the change to confirm no fixture behavior regressed and teardown still succeeds. `npm run check` for syntax.
2. **Retry-path exercise (local, proportionate):** a short stress loop around the worktree suite to at least drive the teardown helper repeatedly and catch any accidental breakage of the retry contract, e.g.:
   `for i in $(seq 1 30); do node --test test/worktrees.test.js || break; done`
   This will not reliably reproduce the Linux race on Windows, but it confirms the helper and the new `git config` setup are sound under repetition and that teardown never throws in the happy path.
3. **CI as the real signal:** the failure is ~50% per ubuntu push, so a handful of consecutive green CI runs (or one green run re-run several times via the Actions "Re-run all jobs" button) is the acceptance evidence. Optionally add a *temporary* second run of `npm test` in `ci.yml` (or bump the matrix with a repeat dimension) to raise per-push exposure, then revert once several consecutive passes land. Keep this temporary and out of the shipped default to avoid doubling CI time permanently.
4. **Optional stress guard (only if desired):** a Linux-gated, opt-in loop (env-flagged) is possible but likely overkill; the disabled-gc + retry combination plus CI observation is proportionate for a flaky-teardown bug. Recommend not adding permanent stress infrastructure.

Acceptance is met when: all four git fixtures disable auto-gc and route teardown through `removeFixtureDir`; the local stress loop shows no teardown throw; and consecutive ubuntu CI runs are green with no `ENOTEMPTY` teardown failures.

## Documentation impact

None required in `docs/` or `README.md`. This is a test-infrastructure fix. If `memory-bank/systemPatterns.md` or `techContext.md` documents test-fixture conventions, add a one-line note that git fixtures disable auto-gc and tear down via the shared retry helper; otherwise no Memory Bank change. A short code comment at each `withRepo` (why gc is disabled) and at `removeFixtureDir` (why retries) is worth adding for future maintainers.

## Open questions

- None blocking. Preference check for the implementer: primary mechanism `git config` per-repo (recommended) vs `GIT_CONFIG_*` env — either satisfies acceptance; the design recommends `git config`.
- Whether to temporarily raise CI exposure (extra `npm test` run) during verification, or rely solely on natural consecutive pushes. Default: rely on re-runs; add the temporary duplicate run only if a green streak is hard to observe.

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-07T22:52:35Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): per-repo gc.auto=0/gc.autoDetach=false after fixture init (covers -C invocations and linked worktrees) + shared removeFixtureDir with fs.rm maxRetries/retryDelay; verification via consecutive ubuntu CI runs. Estimate 2 (basis B20260707T1322Z).

- 2026-07-07T22:53:18Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (test-only CI fix)
