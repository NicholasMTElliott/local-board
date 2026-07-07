---
id: T20260707T1319Z
type: task
status: ready_for_implementation
priority: P1
parent: null
children: []
blockedBy: []
blocks: [T20260707T1320Z]
branch: null
estimate: 4
estimateBasis: T20260707T1318Z
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T13:19:26Z
updated: 2026-07-07T15:07:32Z
completedSteps: ["design:claude-subagent:local-board-designer@opus"]
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

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-07T15:06:38Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): src/install.js module + cli subcommand + install.mjs shim; HOME injection seam for tests; rendering unchanged (T1320 boundary); SCRIPT_DIR anchor flagged as top risk. Estimate 4 (basis T20260707T1318Z).
