---
id: T20260710T0035Z
type: task
status: ready_for_design
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260710T0035Z-validate-install-warn-when-config-routes-to-codex-task-but-codex-task-is-not-installed
estimate: 2
estimateBasis: T20260709T1119Z
workStartedAt: 2026-07-10T01:05:09Z
workCompletedAt: null
created: 2026-07-10T00:35:52Z
updated: 2026-07-10T01:12:11Z
completedSteps: []
routingApprovals: []
---
# validate/install: warn when config routes to codex-task but codex-task is not installed

## Requirement

local-board never checks whether the codex-task skill or the `codex` CLI is actually available, yet the shipped default config routes `review` -> `codex-task:read-only` and `document` -> `codex-task:workspace-write` (src/config.js defaults and the init scaffold). On a machine without codex-task, the failure surfaces mid-workflow as strict-routing friction: every review/document step dead-ends into the approve-inline deviation path. Convert that silent gap into an up-front, actionable warning. Detection only — local-board must NOT take ownership of installing codex-task.

## Scope

Add codex-task availability detection to `validate` (and surface the same check in `install`):

1. **Trigger condition**: the resolved config routes at least one action (in `agents`, including per-entry `optionalSteps[].agent`) to a `codex-task:*` route.
2. **Detection probe** (best-effort, fail-open):
   - `codex` binary resolvable on PATH (the runtime prerequisite), and
   - a codex-task skill install present for at least one harness skills dir (e.g. `~/.claude/skills/codex-task/SKILL.md`), reusing the same home-resolution seam as `install` (`--home` must apply for tests).
3. **`validate` behavior**: emit a WARNING (not an error; exit code unchanged) naming the routed actions and the missing prerequisite(s), with a one-line remedy hint (install codex-task / `codex login`, or reroute the action). No new flags required; a `--quiet`-style suppression is out of scope.
4. **`install` behavior**: after a `claude`-target install, if the project config in cwd routes to `codex-task:*` and detection fails, print the same hint. Purely informational.
5. **Docs**: short note in docs/Install.md and docs/CodexSupport.md that codex-task is a peer install, detected not managed.

## Acceptance criteria

- `validate` on a board whose config has zero `codex-task:*` routes prints no codex-task warning, regardless of whether codex is installed.
- `validate` on a board routing `review` to `codex-task:read-only` with `codex` absent from PATH prints one warning naming `review` and the missing binary; exit code remains 0 when tickets are otherwise valid.
- Detection never hard-fails validate: probe errors (unreadable dirs, spawn failures) degrade to the warning or silence, never a crash.
- Tests cover: no-codex-routes silence, warning content, `--home`-scoped skill-dir detection, and PATH probe stubbing (no dependency on the real machine state, per the LOCAL_BOARD_INSTALL_REQUIRE_HOME testing conventions).
- `npm run check` and `node --test` pass.

## Non-goals

- No npm dependency on codex-task; no chained install (explicitly deferred - see 2026-07-09 discussion of the dependency-plus-chained-install alternative).
- No runtime gate in `begin-step`/`complete-step`; workflow behavior is unchanged.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Summary

Add best-effort, fail-open detection that warns when the resolved config routes any
action to a `codex-task:*` route but the codex-task prerequisites are not present on
the machine. Surface the warning in `validate` (WARNING, exit code unchanged) and echo
the same hint after a `claude`-target `install`. Detection only — local-board never
installs or manages codex-task.

## Approach

Introduce one small, dependency-injected detection module and wire it into the two
existing command paths. No new CLI flags, no schema changes, no change to routing
enforcement or `begin-step`/`complete-step`.

### New module: `src/codex-detect.js`

Three functions; the module imports only `node:os`, `node:fs`, `node:path`, and
`codexTaskRoutedActions` from `config.js`. It deliberately does **not** import from
`install.js`; the PATH probe and the harness target list are injected by callers.
This keeps the dependency graph one-directional (`cli.js`/`install.js` -> `codex-detect.js`,
and `codex-detect.js` -> `config.js`) with no `install.js <-> codex-detect.js` cycle,
and makes the fs/PATH seams trivially stubbable in unit tests.

1. `codexTaskRoutedActions(config)` — pure config scan, **no fs/PATH**. Returns an array
   of human labels for every action routed to a `codex-task:*` route:
   - `config.agents`: for each `[action, value]`, `route = typeof value === "string" ? value : value?.route`;
     if `route` starts with `"codex-task:"`, push `action`. Handles both the normalized
     profile-object shape (from `loadConfig`) and the raw string/object shape (from a
     sync `parseJsonc` read used by `install`).
   - `config.optionalSteps[stage][].agent`: if it starts with `"codex-task:"`, push a
     `"<name> (<stage>)"` label. Covers the per-entry `optionalSteps[].agent` requirement.
   - This function lives in `config.js` (a config concern with no fs deps) and is
     imported by `codex-detect.js`, so both `validate` and `install` share one authority
     for "does this config reference codex-task".

2. `codexTaskSkillInstalled(home, buildTargets)` — for each target from the injected
   `buildTargets(home)`, derive the harness skills root as `dirname(target.skillDir)`
   (e.g. `<home>/.claude/skills/local-board` -> `<home>/.claude/skills`) and test
   `existsSync(join(skillsRoot, "codex-task", "SKILL.md"))`. Any one hit => installed.
   Requiring the `SKILL.md` file (not just the directory) matches the ticket's probe
   example and avoids a false positive on an empty `codex-task/` dir. Wrapped so it can
   never throw (returns `false` on error).

3. `codexTaskWarning(config, { home = homedir(), resolvesOnPath, buildTargets })` —
   the orchestrator. Entire body wrapped in `try/catch` returning `null` (fail-open):
   - `const actions = codexTaskRoutedActions(config); if (actions.length === 0) return null;`
     **Computed first**, so a config with zero codex-task routes never spawns a PATH probe
     — zero cost for the common case (acceptance bullet 1).
   - `codexOnPath = safe(() => resolvesOnPath("codex"))` (the runtime prerequisite).
   - `skillInstalled = codexTaskSkillInstalled(home, buildTargets)`.
   - Build a `missing` list: `` "`codex` CLI not found on PATH" `` when `!codexOnPath`;
     `"codex-task skill not installed in any harness skills dir"` when `!skillInstalled`.
   - `if (missing.length === 0) return null;` (both prereqs satisfied).
   - Otherwise return the warning string (shape below).

### Warning text shape

Single line, prefixed `WARNING:`, naming the routed actions and the specific missing
prerequisite(s), with a one-line remedy hint. Example:

```
WARNING: config routes review, document to codex-task, but `codex` CLI not found on PATH; codex-task skill not installed in any harness skills dir. Install the codex-task skill and run `codex login`, or reroute these actions to another agent. local-board detects codex-task; it does not install or manage it.
```

When only one prerequisite is missing, only that clause appears (acceptance: `codex`
absent while skill present names only the binary). The action list is the exact set of
codex-task-routed actions/steps.

### `validate` integration (`src/cli.js`, `commandValidate`, ~line 252)

After computing `issues` and before returning, and independent of `--json`:

```js
const home = homedir();
const warning = codexTaskWarning(config, { home, resolvesOnPath, buildTargets });
if (warning) console.warn(warning);
```

- `resolvesOnPath` and `buildTargets` are imported from `./install.js`
  (`resolvesOnPath` must be added to install.js's exports; `buildTargets` is already
  exported).
- Emitted on **stderr** via `console.warn`, not pushed into `issues`. This guarantees the
  exit code stays driven solely by `issues.length` (unchanged) and keeps `--json` stdout a
  clean, parseable payload. The warning prints regardless of whether tickets are otherwise
  valid (so a board with a real ticket error still exits 1 and still shows the warning).
- Adding a `warnings` array to the `--json` object is intentionally **out of scope**
  (no schema churn); stderr is the single surface.

### `install` integration (`src/install.js`, `performInstall`, after the target loop)

Only after a `claude`-target install (`selected.some(t => t.id === "claude")`), best-effort
and informational:

```js
if (selected.some((t) => t.id === "claude")) {
  const cwd = options.cwd ?? process.cwd();
  const cfg = readCwdConfigForHint(cwd); // sync, best-effort, null on any error
  if (cfg) {
    const warning = codexTaskWarning(cfg, { home, resolvesOnPath: checkResolvesOnPath, buildTargets });
    if (warning) console.log(warning);
  }
}
```

- `install.js` imports `codexTaskWarning` from `./codex-detect.js`. Because
  `codex-detect.js` does not import from `install.js`, there is no import cycle.
- `readCwdConfigForHint(cwd)` does a sync `readFileSync` + `parseJsonc` (both already
  available: `parseJsonc` is exported from `config.js`) of
  `join(cwd, "plans", "local-board.config.jsonc")`, wrapped in `try/catch` returning
  `null` (no config in cwd, unreadable, or malformed => silently skip). It scans the raw
  parsed object; `codexTaskRoutedActions` already tolerates the raw route-string /
  `{route}` shape, so no merge/normalize is needed for the hint.
- Reuses the installer's already-resolved `home` (which honored `--home`) and its existing
  `checkResolvesOnPath` seam (the `options.resolvesOnPath` override or the real probe),
  so the same home-resolution and PATH seams that the install tests already drive apply
  unchanged. `options.cwd` is a new test-only seam (defaults to `process.cwd()`), added so
  the in-process installer tests can point the config lookup at a temp project dir without
  `chdir`.

### Home-resolution seam reuse

Detection derives skill dirs from `buildTargets(home)` and `dirname(target.skillDir)` —
the exact target list `install` uses. `validate` resolves `home` via `os.homedir()`
(the same mechanism `install`'s default path uses; it honors `HOME`/`USERPROFILE`, which
the install test harness already overrides per-child in `installEnv`). `install` passes
its own resolved `home`. Unit tests inject `home` (a temp dir) plus a fake `buildTargets`
/ stub `resolvesOnPath`, so `--home`-style redirection applies with no dependency on real
machine state.

## Affected files / modules

- `src/codex-detect.js` — new: `codexTaskSkillInstalled`, `codexTaskWarning`
  (uses `codexTaskRoutedActions`).
- `src/config.js` — add and export pure `codexTaskRoutedActions(config)`.
- `src/install.js` — export `resolvesOnPath`; import `codexTaskWarning`; add the
  post-loop claude hint; add `options.cwd` seam and `readCwdConfigForHint`.
- `src/cli.js` — import `codexTaskWarning` + `resolvesOnPath`/`buildTargets`; emit the
  warning in `commandValidate`.
- `test/codex-detect.test.js` — new unit tests (below).
- `test/install.test.js`, `test/cli.test.js` (or the `validate` test) — integration coverage.
- `docs/Install.md`, `docs/CodexSupport.md` — doc notes.

## Test strategy

All hermetic; no dependency on whether `codex`/codex-task exist on the host, matching the
`LOCAL_BOARD_INSTALL_REQUIRE_HOME` / `sanitizedSystemPath` conventions in
`test/install.test.js`.

New `test/codex-detect.test.js` (inject `home`, `resolvesOnPath`, `buildTargets`):

1. **No codex-task routes -> silence**: config with only claude/inline routes returns
   `null` even with `resolvesOnPath: () => false` and no skill dir (and asserts the probe
   is never called — pass a `resolvesOnPath` that throws if invoked, to prove the
   short-circuit).
2. **`codex` absent -> warning names action + binary**: `review -> codex-task:read-only`,
   `resolvesOnPath: () => false`, skill absent; assert warning contains `review` and the
   ``codex` CLI not found`` clause.
3. **Both present -> silence**: create `<tmpHome>/.claude/skills/codex-task/SKILL.md`,
   `resolvesOnPath: () => true` -> `null`.
4. **Skill missing only -> names skill, not binary**: `resolvesOnPath: () => true`, no
   SKILL.md -> warning names the skill clause and omits the binary clause.
5. **`--home`/home-scoped skill detection**: build a temp home, toggle SKILL.md presence
   under it; assert detection follows the injected `home` (proves the seam).
6. **optionalSteps coverage**: an `optionalSteps.design[].agent = "codex-task:read-only"`
   entry with codex absent -> warning names `<name> (design)`.
7. **Fail-open**: `resolvesOnPath` that throws, and a `buildTargets` that throws, each ->
   `codexTaskWarning` returns without throwing (never a crash).

CLI `validate` integration (child process, `test/cli.test.js`):

8. Board routing `review -> codex-task:read-only`, tickets otherwise valid, child env with
   `HOME`/`USERPROFILE` = temp home lacking the skill and a PATH sanitized to exclude
   `codex` -> assert **exit code 0** and stderr matches `/WARNING:.*codex-task/` naming
   `review`.
9. Control: config with zero codex-task routes -> no `codex-task` warning on stderr,
   exit 0.
10. Board with a genuine ticket error + codex-task route -> exit **1** and the warning
    still appears (warning independent of `issues`).

`install` integration (`test/install.test.js`, in-process `runInstall` with
`{ home, cwd, resolvesOnPath: () => false }`):

11. `--target=claude` with `cwd` = temp project whose config routes to `codex-task:*` and
    `resolvesOnPath: () => false` -> installer output includes the hint; exit 0.
12. Control: `cwd` config without codex-task routes -> no hint.

`npm run check` and `node --test` must pass.

## Risks / edge cases

- **Fail-open discipline**: `existsSync` does not throw, but `resolvesOnPath` shells out
  (`where` / `command -v`) and can throw; wrap each probe and the whole `codexTaskWarning`
  body in `try/catch` returning `false`/`null`. Detection must never turn a passing
  `validate` into a crash or a non-zero exit.
- **Extra subprocess cost**: `validate` gains one `where codex` / `command -v codex` spawn
  — but only when the config actually has a codex-task route (routes scanned first). Zero
  cost for codex-free configs.
- **stdout cleanliness**: warning on stderr keeps `validate --json` stdout parseable and
  the exit code untouched.
- **Windows**: `resolvesOnPath` already branches to `where` on win32 and resolves
  `codex.cmd`/`codex.exe`; skill path uses `path.join`.
- **Skill false-positive**: requiring the `SKILL.md` file (not just the `codex-task/` dir)
  avoids counting an empty directory as installed.
- **Multi-harness**: codex-task under any one harness skills dir counts as installed
  (a shared `codex` login/skill serves all).
- **Import cycle**: avoided by injecting `buildTargets`/`resolvesOnPath` into
  `codex-detect.js` rather than importing them there.

## Documentation touchpoints

- `docs/Install.md`: short note (Prerequisites or a new "codex-task (peer install)"
  subsection) — codex-task is an optional **peer** install that local-board **detects but
  does not manage**; `validate` and a `claude`-target `install` emit a WARNING when the
  config routes to `codex-task:*` but `codex` is off PATH or the skill is missing; remedy
  is to install codex-task + `codex login`, or reroute the action.
- `docs/CodexSupport.md`: note near "Route Translation" / "Limits" — the default config
  routes `review`/`document` to `codex-task:*`; local-board only checks availability and
  warns, and never installs codex-task (cross-link to Install.md).
- No new docs file, so the README Documentation Index needs no change.

## Non-goals (restated)

No npm dependency on codex-task, no chained install, no new CLI flags, no
`--quiet`-style suppression, and no runtime gate in `begin-step`/`complete-step`.

## Open questions

None blocking. One minor product choice deferred to implementation: whether to also add a
`warnings` array to `validate --json` (currently proposed stderr-only to avoid schema
churn).

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-10T01:05:09Z: Ensured git branch local-board/T20260710T0035Z-validate-install-warn-when-config-routes-to-codex-task-but-codex-task-is-not-installed (already-current).
