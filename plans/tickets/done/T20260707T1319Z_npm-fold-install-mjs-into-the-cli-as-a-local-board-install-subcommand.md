---
id: T20260707T1319Z
type: task
status: done
priority: P1
parent: null
children: []
blockedBy: []
blocks: [T20260707T1320Z]
branch: local-board/T20260707T1319Z-npm-fold-install-mjs-into-the-cli-as-a-local-board-install-subcommand
estimate: 4
estimateBasis: T20260707T1318Z
workStartedAt: 2026-07-07T15:07:32Z
workCompletedAt: 2026-07-07T15:29:23Z
created: 2026-07-07T13:19:26Z
updated: 2026-07-07T15:29:23Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "implement:claude-subagent:local-board-implementer@sonnet", review:codex-task:read-only, "test:claude-subagent:local-board-tester@sonnet", document:codex-task:workspace-write]
routingApprovals: []
---
# npm: fold install.mjs into the CLI as a local-board install subcommand

## Requirement

`install.mjs` is a standalone script with a shebang but no `bin` entry; once the package is on npm there is no way to run the harness installer from an installed copy. Harness installation (skills to `~/.claude/skills`, `~/.codex/skills`, opencode/cline/cursor dirs, Claude agents to `~/.claude/agents`, the settings.json allow rule, legacy-dir cleanup) must remain an explicit, consent-visible step.

Fix: fold install.mjs into the CLI as `local-board install [--target=...] [--list-targets] [--uninstall]`, reusing the existing TARGETS logic. Do NOT wire it to npm postinstall: postinstall fires in CI and when installed as a dependency, is skipped under --ignore-scripts, and writing to `~/.claude/settings.json` implicitly is intrusive. At most, print a one-line pointer from postinstall.

Acceptance: `local-board install` performs everything `node install.mjs` does today; `install.mjs` delegates to it or is removed; no postinstall side effects.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Summary

Move the installer logic out of the standalone `install.mjs` script and into a
reusable module (`src/install.js`) that `src/cli.js` dispatches as
`local-board install [--target=…] [--all] [--no-<id>] [--list-targets]
[--uninstall]`. `install.mjs` becomes a thin back-compat shim that imports and
runs the same module. No npm `postinstall` hook is added. Rendering behaviour
(`<<INSTALL_PATH>>` / `<<SCRIPT_PATH>>`) is copied verbatim — this ticket only
relocates code and adds a CLI entry point; PATH-based invocation is out of scope.

## Related Tickets and Conflicts

- **T20260707T1318Z (landed)** — added `resources/prompts` and
  `resources/templates`, which `install.mjs` already copies (lines 135-136).
  The relocated module must keep copying those. No conflict; just carry the
  behaviour across.
- **T20260707T1320Z (blocks this / depends on it)** — full PATH-based
  invocation for npm-global installs. **Boundary:** this ticket keeps
  `SCRIPT_PATH` pointing at the copied `~/.local-board/bin/local-board.js`
  runtime exactly as today. Do **not** change rendering to point at a PATH
  binary here. The new subcommand must be byte-for-byte behaviourally identical
  to `node install.mjs`.
- **B20260707T1323Z / B20260707T1327Z (placeholder rendering)** — unchanged.
  `renderSkill` / `renderFilesInPlace` move verbatim; do not touch placeholder
  semantics.
- **T20260707T1338Z (docs/Install.md)** — the full install page is that
  ticket. The Documentation stage here should make only the minimal edits
  needed for correctness (mention `local-board install` alongside
  `node install.mjs`); do not author the full page.
- No conflicts with in-flight production edits; `src/cli.js` and `install.mjs`
  are the only production files touched.

## Implementation Approach

### 1. New module `src/install.js`

Move the entire body of `install.mjs` (TARGETS table, `install`, `uninstall`,
`listTargets`, `patchSettings`, `renderSkill`, `renderFilesInPlace`,
`installRenderedSkillDir`, `resolveSkillTemplate`, `removeLegacyDirs`,
`installClaudeAgents`, `uninstallClaudeAgents`, `claudeAgentNames`,
`writeInstallInfo`, `copyDir`, `getVersion`, `resolveTargets`) into
`src/install.js`. Export a single entry point plus the parts the CLI needs:

- `export function runInstall(argv, options)` — parses installer flags and
  dispatches to install / uninstall / list / help, returning an exit code
  (`0`/`1`) rather than calling `process.exit`, so it composes with
  `main()`'s return-code contract in `src/cli.js`.
- Keep the internal helpers module-private.

**Resolve two path anchors that are currently top-level constants:**

- `SCRIPT_DIR` today is `dirname(fileURLToPath(import.meta.url))` = repo root
  (because `install.mjs` sits at the root). In `src/install.js` the module
  lives one level down, so the package root becomes
  `join(dirname(fileURLToPath(import.meta.url)), "..")`. Compute it once and
  keep the semantics ("directory that holds `package.json`, `bin/`, `src/`,
  `agents/`, `skills/`, `resources/`"). This is the single most bug-prone part
  of the move — every `join(SCRIPT_DIR, …)` copy source depends on it.
- `HOME` / `INSTALL_DIR` must stop being evaluated once at module load and
  instead be resolved per-run from an injectable home (see Testability). The
  `TARGETS` table is currently built at module load from `HOME`; convert it to
  a factory `buildTargets(home)` returning the same array, called inside the
  run with the resolved home. `KNOWN_IDS` derives from the built targets.

### 2. CLI wiring in `src/cli.js`

- Import `runInstall` from `./install.js`.
- Add a dispatch branch in `main()`:
  `if (command === "install") return await commandInstall(root, args);`
  Place it near the other command branches (e.g. after `init`).
- `commandInstall(root, args)` passes the remaining `args` straight to
  `runInstall(args, {})` and returns its numeric exit code. It deliberately
  **ignores `--root`**: the installer operates on `HOME`, not the board root.
  Document this in the help text so users are not surprised that
  `--root` has no effect on `install`.
- The installer's own flags (`--target=`, `--all`, `--no-<id>`,
  `--list-targets`, `--uninstall`, `--help`) are parsed by the installer's
  existing `parseArgs`, not by `takeOption`/`takeFlag`. Keeping the installer's
  parser intact avoids re-deriving `--target=a,b` and `--no-<id>` semantics in
  the CLI style and minimises risk. (An alternative — reimplementing parsing in
  `takeOption` style for consistency — is rejected: higher churn, no user
  benefit, and it would fork the `--no-<id>`/`--target=` logic.)
- Add an `install` line to `printUsage()`:
  `local-board install [--target=<ids>] [--all] [--no-<id>] [--list-targets] [--uninstall]`
  with a note that it acts on the user HOME and ignores `--root`.
- Error handling: `main()` already wraps command dispatch in try/catch and
  returns `2` on throw, printing `error.message`. `runInstall` should let
  errors propagate (throw) rather than doing its own `console.error` +
  `process.exit(1)`, so the CLI path yields consistent exit codes. The shim
  (below) is responsible for the process exit code.

### 3. `install.mjs` back-compat shim

Replace the 409-line file with a thin shim (zero duplication):

```js
#!/usr/bin/env node
import { runInstall } from "./src/install.js";
process.exitCode = runInstall(process.argv.slice(2), {});
```

Add a short deprecation comment at the top: prefer `local-board install`;
`node install.mjs` is retained for existing docs/scripts and forwards to the
same module. Keep the shebang and `install.mjs` in `package.json` `files` so
published behaviour is unchanged. This preserves every existing invocation
(`node install.mjs --list-targets`, `--uninstall`, `--target=…`) including the
current `test/install.test.js`.

### 4. No postinstall

Do not add a `postinstall` script to `package.json`. Rationale is in the
Requirement (fires in CI, skipped by `--ignore-scripts`, writes to
`~/.claude/settings.json` are consent-sensitive). At most a future ticket may
print a one-line pointer; not in scope here. Update `package.json` `scripts.check`
to `node --check src/install.js` (in addition to or in place of the current
`node --check install.mjs`; keep both since the shim still ships).

## Testability / HOME Injection

The installer writes to `HOME`. Two injection layers:

1. **Env-based (already proven).** `homedir()` honours `USERPROFILE` /
   `HOME`; `test/install.test.js` already redirects it on Windows via
   `installEnv`. Resolve home inside the run as
   `options.home ?? homedir()` so both env redirection (subprocess) and a direct
   `home` option (in-process) work.
2. **Option-based (new).** Because `runInstall(argv, options)` accepts
   `{ home }`, new `node:test` cases can call the module in-process against a
   `mkdtemp` dir without spawning a subprocess — faster and easier to assert on.
   Note: `getVersion("node")` shells out via `execSync`; keep it, it is
   home-independent and works in tests.

Do **not** expose `home` as a user-facing CLI flag (avoids an install footgun).
It is a test/programmatic seam only, passed as `options.home`.

## Affected Files

- `src/install.js` — **new.** Relocated installer logic; exports `runInstall`
  (and `buildTargets` if useful for tests). Anchors `SCRIPT_DIR` to package
  root and resolves `home` per-run.
- `src/cli.js` — add `install` dispatch branch, `commandInstall`, import, and
  usage line. ~15 lines.
- `install.mjs` — reduced to a ~5-line shim delegating to `src/install.js`.
- `package.json` — update `scripts.check` to `--check src/install.js`; leave
  `bin`, `files`, `type` unchanged. **No `postinstall`.**
- `test/install.test.js` — extend (see Test Strategy). Existing subprocess
  cases keep working through the shim.
- Docs (`docs/`, `memory-bank/systemPatterns.md` / `techContext.md`) — minimal
  mention of `local-board install`; full page is T1338Z.

## Risks

- **Path anchor regression (highest).** Getting `SCRIPT_DIR` wrong after the
  move (missing the `".."`) silently copies from the wrong directory or throws
  "not found". Mitigation: an explicit test asserting the installed
  `~/.local-board/bin/local-board.js` and `~/.local-board/prompts` /
  `templates` exist.
- **Module-load side effects.** `install.mjs` currently runs on import
  (top-level `parseArgs` + try/catch). After extraction, `src/install.js` must
  export functions and do nothing at import time, or `import`ing it from
  `src/cli.js` would trigger an install. Ensure no top-level execution in the
  module.
- **`resolveTargets` closure over `args`.** Today `resolveTargets` and
  `install`/`uninstall` read a module-global `args`. After the move these must
  take parsed args + resolved targets as parameters (no shared mutable
  module state), otherwise concurrent/in-process test runs interfere.
- **Exit-code contract drift.** Installer previously `process.exit(1)` on
  error; through the CLI, errors should propagate so `main()` returns `2`
  uniformly. The shim maps to `process.exitCode`. Verify `--uninstall` and a
  bad `--target=nope` both exit non-zero on both entry points.
- **settings.json patch on real user HOME.** Running `local-board install`
  against the developer's own HOME during manual testing will mutate
  `~/.claude/settings.json`. Tests must always redirect HOME. Idempotency is
  already handled (`includes(allowRule)` guard) — cover it with a test.
- **Scope creep into T1320Z.** Easy to "improve" rendering to a PATH binary
  while in this file. Explicitly out of scope; keep rendering identical.

## Test Strategy

Extend `test/install.test.js` (node:test), reusing `withHome` /
`installEnv` / `runInstall`:

1. **CLI parity — install tree.** Run `bin/local-board.js install --target=codex`
   (subprocess with redirected HOME) and assert the same tree the current
   `install.mjs --target=codex` test asserts (skill dir, team skill,
   `~/.local-board/bin/local-board.js`, `~/.local-board/prompts`,
   `~/.local-board/templates`, `install-info.json`). Proves the subcommand does
   everything `node install.mjs` does.
2. **`--list-targets` output** via the CLI path — assert the codex row and
   tab-separated columns, mirroring the existing shim test.
3. **`--uninstall` removes what install created** via the CLI path — install
   then uninstall, assert skill/team dirs and `~/.local-board` are gone.
4. **settings.json patch idempotency.** With a Claude target, run install
   twice; assert `~/.claude/settings.json` `permissions.allow` contains the
   `Bash(node …*)` rule exactly once.
5. **`--root` is ignored by install.** Run
   `install --root <somewhere> --target=codex`; assert it still installs under
   the redirected HOME, not under root.
6. **Shim still works.** Keep at least one existing `node install.mjs` case to
   prove back-compat (the current tests already do this).
7. **In-process option seam (optional but recommended).** Import `runInstall`
   and call with `{ home: tmp }` for a fast install/uninstall roundtrip,
   asserting the return code is `0`.
8. `npm run check` (adds `node --check src/install.js`) and `npm test` green.

## Open Questions

None blocking. One judgement call for the implementer: whether to also export
`buildTargets(home)` for direct in-process testing or keep tests
subprocess-only. Recommendation: export it — it enables the fast option-based
seam and costs nothing.

## Implementation Notes

Implemented per Technical Design, no deviations from the approach.

**New `src/install.js`**: relocated all installer logic (`buildTargets(home)`,
`runInstall(argv, options)`, and private helpers). `SCRIPT_DIR` anchors to
`join(dirname(fileURLToPath(import.meta.url)), "..")` (one level up, since the
module now lives in `src/`). `HOME`/`INSTALL_DIR` are resolved per-run from
`options.home ?? homedir()`; no module-level mutable state (args/targets are
threaded as parameters through `resolveTargets`, `performInstall`,
`performUninstall`, etc.) per the Risks section. `runInstall` has no
top-level execution and lets errors throw (no internal try/catch or
`process.exit`). Also exported `buildTargets` per the Open Question
recommendation.

**`src/cli.js`**: imports `runInstall`, adds `install` dispatch branch calling
new `commandInstall(root, args)` (ignores `root`, passes `args` straight to
`runInstall(args, {})`), and adds a `printUsage()` line documenting that
`install` acts on user HOME and ignores `--root`.

**`install.mjs`**: reduced from 409 lines to a 3-line shim (plus a
deprecation comment) that imports `runInstall` from `./src/install.js` and
assigns `process.exitCode`. Shebang and `install.mjs` `package.json` files
entry kept unchanged.

**`package.json`**: `scripts.check` now also runs `node --check src/install.js`
(kept the existing `install.mjs` check).

**Tests** (`test/install.test.js`, extended, all via HOME redirection —
never the real dev HOME): added 7 new cases —
1. CLI install tree parity (`local-board install --target=codex` vs the
   existing `install.mjs` assertions: skill dirs, team skill, rendered
   `<<SCRIPT_PATH>>`, runtime dir, prompts/templates, install-info.json).
2. CLI `--list-targets` output matches the shim's output byte-for-byte.
3. CLI `--uninstall` removes what CLI install created.
4. settings.json allow-rule idempotency (`--target=claude` run twice; rule
   count stays 1; full settings object is byte-identical across runs).
5. `--root` is ignored by `install` (installs under redirected HOME, not the
   bogus root path).
6. In-process `runInstall({ home })` option-seam install/uninstall roundtrip
   (no subprocess).
7. `buildTargets(home)` unit check (paths anchored under the supplied home).

Existing 3 tests (subprocess shim invocations) kept untouched to prove
back-compat.

**Verification**:
- `npm run check` — clean (all `node --check` targets pass, including new
  `src/install.js`).
- `npm test` — 154/154 passing (was 147 before; added 7 new install tests,
  0 failures).
- `npm run validate` — "Ticket validation OK".
- `node install.mjs --list-targets` vs `node ./bin/local-board.js install
  --list-targets` (both run against a redirected HOME): `diff` reported no
  differences (byte-identical output).
- Manually verified non-zero exit codes for both entry points on
  `--target=nope` (shim: uncaught throw, stack trace, exit 1; CLI: caught by
  `main()`, clean `error.message`, exit 2 — both non-zero, satisfying the
  Risks-section check) and confirmed `--uninstall` is a 0-exit no-op on a
  clean HOME for both entry points.

**Note on shim error UX**: the design's literal 3-line shim (no try/catch)
means `node install.mjs` with a bad argument now prints a Node stack trace
instead of the old `ERROR: <message>` one-liner, though the exit code is
still non-zero (1, via Node's default uncaught-exception handling) as the
design's Risks section requires. This is implemented exactly as specified in
Technical Design section 3; flagging it here since it is a small, deliberate
UX regression versus the previous handcrafted `console.error` + `process.exit(1)`.

No documentation files were touched — the ticket explicitly scopes doc edits
to a later Documentation stage / T20260707T1338Z.

## Review Findings

Reviewed by codex-task:read-only (gpt-5.5) against commit 42f2ad1.

No blocking findings.

Non-blocking observations:
- install.mjs:7-9 lets runInstall throws escape: `node install.mjs --target=nope` now prints a raw stack trace (exit 1) vs the old one-line ERROR. Design-specified thin shim; a one-line catch is reasonable polish if legacy script UX matters.
- SCRIPT_DIR anchor (src/install.js:20) is correct for repo checkouts and npm package installs. Running `install` FROM the copied runtime (~/.local-board/bin/local-board.js install) would copy the runtime onto itself — unsupported path, worth documenting (self-refresh should use the source checkout or npm copy).
- Test coverage gaps (not bugs): tree assertions check key entries and rendered skill contents, not byte-for-byte trees or install-info.json field values; the settings-idempotency test does not seed unrelated pre-existing settings (the implementation does preserve them via object mutation + tmp/rename at src/install.js:399-415).

Extraction fidelity verified: legacy-dir cleanup in both install and uninstall paths (:171-172, :302-303); codex template resolution unchanged (:45-46, :182-191); install-info.json content preserved (:240-257); uninstall still leaves the Claude settings allow rule in place — matching the old installer rather than silently changing behavior.
Packaging safe: src/ allowlisted so src/install.js ships; no installed-runtime dependency on excluded scripts/.
Verification caveat: node --check passed on the three changed modules; full suite not run in the read-only sandbox — delegated to test stage.

Verdict: pass

## Test Evidence

Tested by claude-subagent:local-board-tester (sonnet) on branch local-board/T20260707T1319Z-..., commit 42f2ad1.

**Suite:** `npm run check` pass (9 targets incl. src/install.js); `npm test` 154/154 pass; `npm run validate` OK.

**Independent end-to-end probe (throwaway USERPROFILE):**
- `local-board install --target=codex`: full tree verified — ~/.local-board (bin, src×8, agents, skills, prompts×15, templates×1, install-info.json with correct fields, SKILL.md); codex skill + team skill installed; grep found zero unrendered `<<` placeholders.
- `install --list-targets` CLI vs shim under same HOME: byte-identical (diff exit 0).
- `install --uninstall`: all three install locations confirmed removed.
- Error paths: CLI `--target=nope` clean one-liner exit 2; shim raw stack trace exit 1 (documented deliberate shim behavior).
- Scratch HOME cleaned; git status unchanged beyond ticket lifecycle moves.

**7 new tests confirmed by name (test/install.test.js:120-228):** CLI-vs-shim tree parity, list-targets byte parity, uninstall symmetry, settings allow-rule idempotency, --root ignored, in-process runInstall seam, buildTargets home anchoring. Pre-existing 3 shim tests untouched.

**Acceptance:** subcommand does everything install.mjs does (tests + probe); shim is a true 3-line delegate; package.json has NO postinstall script (verified by direct read — only prose mentions in the ticket).

**Gaps / caveats:** reviewer's non-blocking notes stand (shim stack-trace UX, self-copy from installed runtime unsupported/undocumented, tree assertions not byte-for-byte); Windows-only verification, consistent with the existing harness style.

Result: pass

## Documentation Updates

Documented by codex-task:workspace-write (gpt-5.5).

- `README.md` — Quick start and Installable Skills examples now use `node ./bin/local-board.js install ...` as the primary form with a one-line deprecated-alias note for `node install.mjs`; repository layout references updated.
- `memory-bank/techContext.md` — layout now describes the installer as src/install.js behind `local-board install`, with install.mjs as the deprecated shim.
- `memory-bank/systemPatterns.md` — checked, unchanged (installer behavior wording still current).
- Full installation guide deferred to T20260707T1338Z (docs/Install.md) by design.

## Questions

## Run Log

- 2026-07-07T15:06:38Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): src/install.js module + cli subcommand + install.mjs shim; HOME injection seam for tests; rendering unchanged (T1320 boundary); SCRIPT_DIR anchor flagged as top risk. Estimate 4 (basis T20260707T1318Z).

- 2026-07-07T15:07:32Z: Ensured git branch local-board/T20260707T1319Z-npm-fold-install-mjs-into-the-cli-as-a-local-board-install-subcommand (created).

- 2026-07-07T15:19:36Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Implementer (sonnet): src/install.js + cli install subcommand + 3-line shim; 154/154 tests; shim vs subcommand --list-targets diff byte-identical; check script covers new module.

- 2026-07-07T15:23:08Z: Completed review via codex-task:read-only: Codex (gpt-5.5, read-only) verdict pass: extraction faithful (legacy cleanup, codex templates, install-info, uninstall symmetry all preserved), SCRIPT_DIR anchor correct for repo and npm layouts; notes on shim error UX, self-refresh path, and test depth recorded.

- 2026-07-07T15:26:19Z: Completed test via claude-subagent:local-board-tester@sonnet: Tester (sonnet): 154/154 green; throwaway-HOME probe verified install tree, list-targets byte parity, uninstall symmetry, error paths, zero unrendered placeholders; no postinstall script confirmed. Result: pass.

- 2026-07-07T15:29:23Z: Completed document via codex-task:workspace-write: Codex (workspace-write): README install examples switched to the subcommand with deprecated-alias note; techContext layout updated; systemPatterns checked unchanged.
