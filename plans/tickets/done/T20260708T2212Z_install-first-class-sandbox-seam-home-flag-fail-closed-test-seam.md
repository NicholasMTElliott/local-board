---
id: T20260708T2212Z
type: task
status: done
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260708T2212Z-install-first-class-sandbox-seam-home-flag-fail-closed-test-seam
estimate: 2
estimateBasis: T20260708T2016Z
workStartedAt: 2026-07-09T00:44:53Z
workCompletedAt: 2026-07-09T01:31:38Z
created: 2026-07-08T22:10:45Z
updated: 2026-07-09T01:31:38Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", review:codex-task:read-only, "test:claude-subagent:local-board-tester@sonnet", gate:test:skipped-empty-catalog, document:codex-task:workspace-write]
routingApprovals: []
---
# install: first-class sandbox seam (--home flag, fail-closed test seam)

## Requirement

Live installer tests currently sandbox via the programmatic `runInstall(args, { home })` seam, which fails OPEN: when `home` is undefined (e.g. an unset env var in a test harness), the installer silently falls through to the real `os.homedir()`. This caused a real incident (2026-07-08): a tester subagent's probe ran a genuine claude-target install against the user's actual home directory, adding the `Bash(local-board *)` allow rule to the real `~/.claude/settings.json` without consent. The current mitigation is prompt-level convention (assert the path contains "scratchpad"), which nothing enforces.

Fix, two layers:
1. CLI: add `local-board install --home <dir>` mapping to the existing seam, so probes can go through the public entrypoint instead of importing internals.
2. Fail closed under test: when `NODE_ENV=test` or a dedicated env guard (e.g. `LOCAL_BOARD_INSTALL_REQUIRE_HOME=1`) is set, `runInstall`/`runUninstall` REFUSE to operate on the real `os.homedir()` unless an explicit `--home`/options.home is supplied. Passing `{ home: undefined }` explicitly should be an error, not a fallback.

## Acceptance Criteria

- `install --home <dir> --target=claude` performs the full install under `<dir>`; `--home` with uninstall works symmetrically.
- With the guard env set and no home override, install/uninstall exit non-zero naming the guard; with an explicit home they proceed.
- `runInstall({ home: undefined, ... })` (key present, value undefined) throws rather than falling back to os.homedir().
- test/install.test.js migrates at least one probe to the CLI `--home` path; docs/Install.md documents the flag as the supported test/sandbox mechanism.
- Existing default behavior (no flag, no guard env) unchanged for real users.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Technical Design

### Summary

Two layers, both landing almost entirely in `src/install.js` and one doc:

1. A public `--home <dir>` flag on `install`/`uninstall`, parsed inside the
   installer's own `parseArgs` so it flows uniformly through the CLI
   (`local-board install`), the deprecated `install.mjs` shim, and the
   in-process seam.
2. Fail-closed home resolution: a single `resolveHome()` gate that throws on an
   explicit `options.home === undefined`, and — when a dedicated guard env var
   is set — refuses to touch the real `os.homedir()` unless a home override was
   supplied.

There is no separate `runUninstall` symbol today: uninstall is the `--uninstall`
branch inside `runInstall`, reached *after* home is resolved. Because home
resolution happens once at the top of `runInstall`, both install and uninstall
inherit the flag, the guard, and the throw for free — no second code path.

### Current flow (baseline)

`runInstall(argv, options = {})` (src/install.js:112) does, in order:
`home = options.home ?? homedir()` -> `buildTargets(home)` -> `parseArgs(argv,
knownIds)` -> branch (`--help` / `--list-targets` / `--uninstall` /
`performInstall`). The PATH check lives in `performInstall`:
`checkResolvesOnPath = options.resolvesOnPath ?? resolvesOnPath`.

Two production call sites pass `{}` (key **absent**): `install.mjs:9` and
`src/cli.js:680` (`commandInstall`). The `--root`/`--allow-main-root` options are
stripped generically in `main()` (cli.js:59) *before* dispatch, so `--home`
remains in `args` and reaches `parseArgs` untouched.

### Design decisions

#### D1 — Flag syntax: `--home <dir>` (space-separated), parsed in `parseArgs`

Match the acceptance wording (`install --home <dir> --target=claude`) and every
other CLI option (space form via `takeOption`). Parse it in `install.js`
`parseArgs` (not `cli.js`) so all three entrypoints get it identically and the
guard/throw semantics are enforced at the one true seam. Convert `parseArgs`'s
`for (const arg of argv)` to an indexed loop so `--home` can consume the
following token:

```
else if (arg === "--home") {
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error("--home requires a value");
  }
  parsed.home = value;
  i += 1;
}
```

`parsed.home` defaults to `null`. (Rejected: `--home=<dir>` equals form — it
would diverge from the AC wording and from the rest of the CLI surface. The
equals form is a trivial future add if wanted; not implemented now.)

#### D2 — Resolution order: flag > options.home > guard-refusal > homedir()

Reorder `runInstall` so args are parsed *before* home is resolved:

```
const knownIds = new Set(buildTargets(".").map((t) => t.id)); // ids are home-independent
const args = parseArgs(argv, knownIds);
const home = resolveHome(args, options);
const installDir = join(home, ".local-board");
const targets = buildTargets(home);
```

`buildTargets(".")` is called only to enumerate the home-independent target ids
for `parseArgs` validation; it touches no filesystem. `resolveHome`:

```
function resolveHome(args, options) {
  // 1. Explicit programmatic undefined is always a bug -> fail closed.
  if (Object.hasOwn(options, "home") && options.home === undefined) {
    throw new Error(
      "runInstall: options.home was provided but is undefined; pass a directory or omit the key",
    );
  }
  // 2. CLI/argv flag wins.
  if (args.home !== null) return args.home;
  // 3. Programmatic override (defined; validated non-empty string).
  if (Object.hasOwn(options, "home")) {
    if (typeof options.home !== "string" || options.home.trim() === "") {
      throw new Error("runInstall: options.home must be a non-empty string");
    }
    return options.home;
  }
  // 4. No override. Under the guard, refuse to touch the real home.
  if (process.env.LOCAL_BOARD_INSTALL_REQUIRE_HOME === "1") {
    throw new Error(
      "refusing to run against the real home directory: " +
        "LOCAL_BOARD_INSTALL_REQUIRE_HOME=1 is set and no --home/options.home override was supplied",
    );
  }
  // 5. Default: the real home.
  return homedir();
}
```

`Object.hasOwn(options, "home")` is what distinguishes **key present, value
undefined** (throw, AC bullet 3) from **key absent** (fall through to guard /
homedir). Both production call sites pass `{}`, so real users never hit the
explicit-undefined throw. The explicit-undefined check is placed *first* (ahead
of the flag) so a programmatic caller that passes a bad `{ home: undefined }` is
never silently rescued by an argv flag — mixed signals fail closed. In practice
flag and options.home never co-occur (CLI passes `{}`; the in-process seam passes
no argv flag), so ordering is a safety belt, not a functional constraint.

#### D3 — Guard env: `LOCAL_BOARD_INSTALL_REQUIRE_HOME=1` (chosen over `NODE_ENV=test`)

Active iff `process.env.LOCAL_BOARD_INSTALL_REQUIRE_HOME === "1"` exactly. Any
other value (unset, empty, `"0"`) leaves it inactive — no ambiguity.

Chosen over `NODE_ENV=test` because:

- This project runs `node --test`, which does **not** set `NODE_ENV`; so
  `NODE_ENV=test` buys no *automatic* protection here anyway.
- Its implicit setting elsewhere is a footgun, not a feature: many dev shells
  and third-party runners (e.g. Jest) export `NODE_ENV=test`. A developer with
  that in their environment would suddenly find real `local-board install`
  refusing to run with a confusing message. A dedicated, namespaced var is opt-in
  and can never fire for an unsuspecting user.
- `NODE_ENV` is broadly read by unrelated libraries; coupling install safety to
  it conflates concerns. `LOCAL_BOARD_INSTALL_REQUIRE_HOME` is self-documenting
  and collision-free, and the error message can name it precisely.

Trade-off accepted: the guard is opt-in, so a harness must set it deliberately.
That is acceptable because the `--home` flag + docs make the safe path the
obvious one; the guard is belt-and-suspenders for harnesses that opt in. Read
directly from `process.env`; exercised via subprocess tests (the dominant
`installEnv` pattern) so no env leaks into the test-runner process.

##### Guard behavior matrix

| Guard env | `--home` flag | `options.home` | Result |
|---|---|---|---|
| unset | absent | key absent | install/uninstall against `homedir()` (unchanged default) |
| `=1` | absent | key absent | **throw**, message names `LOCAL_BOARD_INSTALL_REQUIRE_HOME`, non-zero exit |
| `=1` | `<dir>` | key absent | proceeds under `<dir>` (flag wins before guard) |
| `=1` | absent | `"<dir>"` | proceeds under `<dir>` |
| any | absent | `undefined` (key present) | **throw** (explicit-undefined; independent of guard) |
| unset | `<dir>` | key absent | proceeds under `<dir>` |

#### D4 — Overriding home also skips the PATH check (with an explicit-seam escape hatch)

An overridden home is by definition a relocated/sandboxed install where the
*ambient* PATH expectation (that a real user can invoke the rendered skills'
`local-board ...` lines) does not hold. Requiring `local-board` on PATH there
forces probes to also stub PATH — the exact ceremony this ticket removes. So:

```
const homeOverridden = args.home !== null || Object.hasOwn(options, "home");
const checkResolvesOnPath =
  options.resolvesOnPath ?? (homeOverridden ? () => true : resolvesOnPath);
```

An explicitly supplied `options.resolvesOnPath` still wins, so the existing
in-process seam tests that assert the PATH-failure path (`resolvesOnPath:
() => false`) keep working. Only when home is overridden **and** no explicit
`resolvesOnPath` is given do we treat PATH as resolvable. Net effect: `--home`
becomes a single, complete sandbox switch — the migrated probe needs neither the
`local-board` PATH stub nor the internal `resolvesOnPath` seam.

### Files touched

- **src/install.js** (production, the only logic change):
  - `parseArgs`: indexed loop; add `--home <dir>` -> `parsed.home` (default
    `null`); value guard.
  - `runInstall`: reorder to parse-before-resolve; add `resolveHome(args,
    options)` + the guard read; derive `knownIds` from `buildTargets(".")`.
  - `performInstall`: derive `checkResolvesOnPath` via the `homeOverridden`
    rule (D4); thread `homeOverridden` (or `options` + `args.home`) in.
  - `printHelp`: add `--home <dir>` to the usage block and a one-line note that
    it is the sandbox/testing seam.
- **src/cli.js**: no functional change (`commandInstall` stays `runInstall(args,
  {})`; `--home` rides through `args`). Update `USAGE_TEXT`'s `install` line to
  include `[--home <dir>]`. (`usageCommandNames` still parses `install` as the
  command token — no new command name, `skill-usage-sync` unaffected.)
- **install.mjs**: no change — argv passes straight to `runInstall`, so `--home`
  and the guard/throw apply automatically.
- **test/install.test.js**: new tests + one migrated probe (below); small
  `installEnv` extension to inject the guard env var.
- **docs/Install.md**: flag row + a "Testing / sandboxing" subsection + an
  uninstall note (below).

### Test plan (mapped to acceptance criteria)

Use the existing `withHome` / `runInstallCli` / `runInstallInProcess` harness.
Add an `installEnv` option (e.g. `requireHome: true`) that sets
`LOCAL_BOARD_INSTALL_REQUIRE_HOME=1` in the child env.

- **AC1 (flag drives home; uninstall symmetric).** New CLI test: install with
  `--home <altDir>` where `altDir` differs from the env-redirected HOME; assert
  skills/agents/`.local-board` land under `<altDir>` and **not** under the env
  HOME. Then `--home <altDir> --target=claude --uninstall` removes them. Proves
  the flag, not env redirection, selects the home for both directions.
- **AC2 (guard refuses without home; proceeds with home).**
  - Refusal: `runInstallCli(home, ["--target=claude"], { requireHome: true })`
    -> `assert.rejects`, output matches `/LOCAL_BOARD_INSTALL_REQUIRE_HOME/` and
    non-zero exit. Repeat with `--uninstall` to prove symmetry.
  - Proceed: same guard env **plus** `--home <dir>` -> exit 0, skill dir present.
- **AC3 (explicit undefined throws).** In-process:
  `assert.throws(() => runInstallInProcess(["--target=codex"], { home: undefined,
  resolvesOnPath: () => true }), /home .*undefined/)`. Complementary assertion
  that `runInstallInProcess(["--target=codex"], { home, resolvesOnPath: () =>
  true })` (defined) still succeeds, i.e. only the undefined *value* trips it.
- **AC4 (migrate >=1 probe to CLI --home; docs).** Migrate one existing
  `runInstallCli` probe (e.g. the "CLI install subcommand installs the same
  tree" test, ~line 301, or the version-stamp test, ~line 201) to route through
  `--home <dir>` instead of relying solely on env HOME. To also prove D4, run the
  migrated probe with `{ includeLocalBoardStub: false, sanitizePath: true }`:
  it must still succeed because `--home` skips the PATH check. Docs delta below.
- **AC5 (defaults unchanged).** The entire existing suite — every `runInstallCli`
  / `runInstall` call with no `--home` and no guard env — must pass byte-for-byte
  unchanged; those exercise the `{}` (key-absent) -> `homedir()` path. Explicitly
  confirm the two production call sites (`install.mjs`, `commandInstall`) pass
  `{}`, so the explicit-undefined throw is unreachable in production.
- **Regression guard for D4.** Keep the existing in-process
  `resolvesOnPath: () => false` throw test (no `--home`) green — explicit
  `resolvesOnPath` still wins over the home-override skip.

### Documentation updates (docs/Install.md)

- Add `local-board install --home <dir>` to the Flags block (~line 42) with a
  one-line gloss: installs under `<dir>` instead of `os.homedir()`.
- New subsection **"Testing / sandboxing"**: `--home <dir>` is the supported,
  first-class way to run a real install against a throwaway directory; it also
  skips the on-PATH precheck (a sandboxed home has no PATH expectation).
  Document the `LOCAL_BOARD_INSTALL_REQUIRE_HOME=1` guard: when set, install and
  uninstall refuse to operate on the real home unless `--home` is supplied — a
  fail-closed backstop for test harnesses, motivated by the 2026-07-08 incident.
- Uninstall section: note `--home <dir>` applies symmetrically to `--uninstall`.

### Risks / edge cases

- **Reorder correctness.** `parseArgs` must run before `buildTargets(home)`;
  target-id validation now uses `buildTargets(".")`. Verified ids are
  home-independent (only path fields vary by home).
- **`--home` value parsing.** Guard against a missing value and a value that
  looks like a flag, mirroring `cli.js` `takeOption`.
- **Guard scope.** The guard only fires when *no* override is supplied; it must
  not block legitimate `--home` runs (flag is checked first in `resolveHome`).
- **No behavior change for real users.** Guard is inactive unless the dedicated
  var is exactly `"1"`; production call sites pass `{}`.

### Open questions

None blocking. (One deliberate choice flagged for the reviewer: D4 makes any
home override skip the PATH precheck; if a reviewer prefers `--home` to *retain*
the PATH check, that is a one-line change, but it would reintroduce the PATH-stub
ceremony the ticket set out to remove.)

## Implementation Notes

## Review Findings

Reviewed by codex-task:read-only (gpt-5.5) on the implement commit (worktree).

- [P2] `src/install.js:151,422` — `--home` bypasses the non-empty-string gate applied to `options.home`: `parseArgs` accepts any non-flag token and `resolveHome` returns `args.home` unchecked, so `--home ""` (or blank) marks `homeOverridden`, skips the PATH precheck, and `join(home, ".local-board")`/`buildTargets(home)` resolve relative to the CURRENT WORKING DIRECTORY — a sandbox flag that can mutate the repo/worktree (`.local-board/`, `.claude/settings.json`). Validate `args.home` with the same trimmed non-empty rule, normalize with `resolve()`, and add a regression test for `--home ""`; document the relative-path policy explicitly if intentional.

Passing: incident replay covered — `{ home: undefined, resolvesOnPath: () => true }` throws before `homedir()` (src/install.js:145) with a test asserting that exact shape (test/install.test.js:397); guard centralized ahead of install/uninstall branching so all entry points route through it; PATH-skip precedence honors an explicit resolvesOnPath; guard env parsed as exact `=1` with a refusal naming the env var and the fix; docs accurate and consistent with the consent callout.

Verdict: changes_requested

## Test Evidence

Verified by claude-subagent:local-board-tester (sonnet), in the ticket worktree. All live probes used --home inside the session scratchpad; real HOME never targeted.

### Static checks

| Command | Result |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS — 421 tests, 420 pass, 0 fail, 1 skipped |
| `npm run validate` | PASS — Ticket validation OK |
| `node --test test/skill-usage-sync.test.js` | PASS — 4/4 |

### Live CLI probes

- Full round trip (`--home <scratch>/probe-home --target=claude`): complete tree installed (runtime, both skills, 7 agents, settings.json with exactly the allow rule); `--uninstall --home <same>` removed runtime/skills/agents AND the allow rule — post-uninstall settings.json is `{}` (B0459's removal composes with --home). PASS.
- `--home ""` and `--home "  "`: `--home requires a non-empty value`, exit 2; git status identical before/after; nothing created in cwd; the worktree's own tracked .claude/settings.json untouched. PASS.
- Relative `--home ./rel-home` from a scratch cwd: landed under `<scratch>/rel-cwd/rel-home/` — resolved against invoker cwd, not the script location. PASS.
- `LOCAL_BOARD_INSTALL_REQUIRE_HOME=1` without --home: refusal naming the env var and the fix, exit 2, nothing created; with --home: proceeds fully. PASS.
- API incident replay: `runInstall(["--target=claude"], { home: undefined, resolvesOnPath: () => true })` throws synchronously ("options.home was provided but is undefined; pass a directory or omit the key") before homedir() or any write — the exact 2026-07-08 incident shape; real-home timestamps confirmed untouched. PASS.

### Docs

docs/Install.md documents the flag (usage line 50; Testing/sandboxing section 181-204: non-empty rule, cwd-relative resolution, PATH-precheck skip, guard env + incident motivation, fail-closed undefined rule) and uninstall symmetry (212-213). All claims matched observed behavior.

### Caveats

- Other targets (codex/opencode/cline/cursor/agents) and --hooks composition with --home not live-probed (covered by unit tests; acceptance names --target=claude).
- Probe dirs removed; worktree clean of tester changes.

Result: pass

## Documentation Updates

Documented by codex-task:workspace-write (gpt-5.5). Primary docs (Install.md testing/sandboxing + uninstall symmetry) shipped at implement/rework. Closing audit: techContext + systemPatterns gained terse current-state sandbox-seam facts (--home flag, fail-closed undefined, guard env); SECURITY.md gained one consent-focused sentence on sandboxed installs; Install.md vs README pointer verified consistent.

## Questions

## Run Log

- 2026-07-09T00:44:53Z: Ensured git branch local-board/T20260708T2212Z-install-first-class-sandbox-seam-home-flag-fail-closed-test-seam (already-current).

- 2026-07-09T00:53:30Z: Completed design via claude-subagent:local-board-designer@opus: resolveHome gate: flag > options.home > guard-refusal > homedir; Object.hasOwn distinguishes explicit-undefined (throw); LOCAL_BOARD_INSTALL_REQUIRE_HOME=1 guard (not NODE_ENV); --home skips PATH check; estimate 2 basis T2016

- 2026-07-09T00:54:39Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (hardening seam, no new trust surface)

- 2026-07-09T00:54:39Z: Ensured git branch local-board/T20260708T2212Z-install-first-class-sandbox-seam-home-flag-fail-closed-test-seam (already-current).

- 2026-07-09T01:06:18Z: Completed implement via claude-subagent:local-board-implementer@sonnet: resolveHome gate (flag > options.home > guard > homedir, explicit-undefined throws); LOCAL_BOARD_INSTALL_REQUIRE_HOME guard; PATH-check skip on override; 4 tests; 418 pass + 1 skip; skill-sync 4/4

- 2026-07-09T01:08:25Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (hardening seam, defensive validation only)

- 2026-07-09T01:15:25Z: Invalidated downstream evidence on loop-back to ready_for_implementation: removed completedSteps [implement:claude-subagent:local-board-implementer@sonnet, gate:implement:claude-subagent:local-board-gatecheck@haiku].

- 2026-07-09T01:15:26Z: Ensured git branch local-board/T20260708T2212Z-install-first-class-sandbox-seam-home-flag-fail-closed-test-seam (already-current).

- 2026-07-09T01:19:29Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Rework: --home validated (trimmed non-empty) + path.resolve normalization; 2 regression tests (empty/blank rejected fail-closed, relative resolves against cwd); 420 pass + 1 skip

- 2026-07-09T01:20:54Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (new trigger text correctly carved out internal CLI flag validation)

- 2026-07-09T01:20:55Z: Completed review via codex-task:read-only: changes_requested (P2 empty --home cwd-mutation risk) on impl commit; addressed in rework (validate + resolve); recorded post-move per evidence-invalidation ordering

- 2026-07-09T01:27:07Z: Completed test via claude-subagent:local-board-tester@sonnet: 420 pass + 1 skip; round trip incl. B0459 composition, empty/relative/guard/incident-replay probes all pass; docs match behavior

- 2026-07-09T01:31:38Z: Completed document via codex-task:workspace-write: memory-bank facts + SECURITY sentence; pointers consistent
