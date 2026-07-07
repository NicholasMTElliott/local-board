---
id: T20260707T1321Z
type: task
status: implementing
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260707T1321Z-npm-add-version-command-and-skill-version-skew-preflight
estimate: 2
estimateBasis: T20260707T1325Z
workStartedAt: 2026-07-07T19:35:55Z
workCompletedAt: null
created: 2026-07-07T13:21:26Z
updated: 2026-07-07T19:40:16Z
completedSteps: ["design:claude-subagent:local-board-designer@opus"]
routingApprovals: []
---
# npm: add version command and skill version-skew preflight

## Requirement

The CLI has no `version`/`--version`/`help` command (`src/cli.js` — zero matches). Once the CLI is updated via `npm update -g` while installed skill copies stay frozen, skill text can silently reference commands or flags that moved — version skew becomes the main drift risk of npm distribution.

Fix: add `local-board --version` (read package.json via `new URL("../package.json", import.meta.url)`). Have `local-board install` stamp the package version into the rendered skills, and add a one-line preflight to the skills comparing the stamped version against `local-board --version`, warning on mismatch (re-run `local-board install`).

Acceptance: `local-board --version` prints the package version; installed skills carry the stamped version; a skew between the two is detectable by the documented preflight.

## Acceptance Criteria

## Related Tickets

## Technical Design

Add a `--version`/`version` command that reads the package version, stamp that
version into rendered skills and `install-info.json` at install time, and add an
advisory version-skew preflight line to the skills. Small, self-contained change
across `src/cli.js`, `src/install.js`, and the two skill templates.

## Related Tickets

- **T20260707T1320Z (done)** — skills now invoke the `local-board` command on
  PATH, so the only per-install rendering left is `<<INSTALL_PATH>>` (metadata)
  and, after this ticket, `<<VERSION>>` (metadata). Command/invocation text is
  already machine-independent; this ticket keeps it that way.
- **T20260707T1322Z (ready)** — will add `local-board where --json` (reporting
  install dir, prompt dirs, and *version*) and retire `<<INSTALL_PATH>>`. This is
  the natural seam: the package-version reader added here should be a small shared
  helper that `where` reuses, and the `version` field this ticket adds to
  `install-info.json` is the same field `where` will surface. Design the reader
  and the `install-info.json` field so T1322 consumes them without rework.
- **T20260707T1323Z (ready)** — plugin packaging; orthogonal, but the version
  stamp is the drift signal that motivates both.

## Approach

### 1. `local-board --version` / `version` (src/cli.js)

Add a package-version reader and dispatch it early in `main`.

- Helper: `async function readPackageVersion()` returning the `version` field
  from `new URL("../package.json", import.meta.url)`. `src/cli.js` already imports
  `readFile` from `node:fs/promises`; use
  `JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version`.
- Resolution holds in both layouts: repo `<root>/src/cli.js` → `<root>/package.json`,
  and the flattened runtime copy `~/.local-board/src/cli.js` →
  `~/.local-board/package.json` (install.js copies `package.json` to the install
  dir root and `src/` beneath it). No dependence on `process.cwd()`.
- Dispatch: `--root` is consumed by `takeOption` before `command = args.shift()`,
  so after that line, handle **both** forms cheaply — `command === "--version"`,
  `command === "-v"`, or `command === "version"` → print the version, return 0.
  Recommend accepting all three (both flag and subcommand is a one-line `||`);
  `-v` is optional and flagged as an open question (some CLIs reserve `-v` for
  verbose).
- Add a `local-board --version` line to `printUsage`.
- Keep the bare-`local-board` (no args) path unchanged: still prints usage, exit 2.

### 2. Stamp the version at install (src/install.js)

- Read the package version once in `performInstall`:
  `const version = JSON.parse(readFileSync(join(SCRIPT_DIR, "package.json"), "utf8")).version;`
  (`readFileSync` and `join`/`SCRIPT_DIR` are already imported/defined.)
- Introduce a `<<VERSION>>` placeholder and thread `version` through the render
  pipeline: `installRenderedSkillDir` → `renderFilesInPlace` → `renderSkill`.
  In `renderSkill`, add `.replace(/<<VERSION>>/g, () => version)` alongside the
  existing `<<INSTALL_PATH>>` / `<<SCRIPT_PATH>>` replacements. Both skill paths
  (Claude single-file render and the Codex template-dir `cpSync` +
  `renderFilesInPlace`) funnel through `renderSkill`, so both get stamped with no
  extra branching.
- `install-info.json`: add `version` to the object written by `writeInstallInfo`
  (pass `version` in alongside `nodeVersion`). Positioned next to `nodeVersion`
  for T1322's `where` to read.

### 3. Stamp location in skill text

Put the stamp in the existing **Installation metadata** block, not in any command
line:

- `SKILL.md` and `skills/codex/local-board/SKILL.md` gain a metadata line such as:
  `- Installed from local-board v<<VERSION>>`
- Rationale: command/invocation text stays byte-identical across machines and
  versions (the acceptance goal of T1320). The stamp itself necessarily varies
  per version — that is intended and is the whole point of the skew check.
  `<<INSTALL_PATH>>` already makes the metadata block machine-specific today, so
  adding a per-version token there changes nothing about the invariant that
  matters (the CLI *commands* the skill tells agents to run).

### 4. Advisory version-skew preflight in the skills

Add a single advisory line to both skills (Claude `SKILL.md` near the top / Core
Loop preamble; Codex `SKILL.md` in its existing `## Preflight` section). Proposed
wording:

> Version-skew check (advisory): this skill was installed from local-board
> `v<<VERSION>>`. If `local-board --version` prints a different version, the
> runtime was updated after this skill was installed — warn the user and suggest
> re-running `local-board install` to refresh the skills. This is advisory: warn
> and continue; never treat it as a hard gate or block the ticket.

Explicitly **not** a gate: no `move`-blocking, no exit-code contract. The
orchestrator surfaces a warning and proceeds. Both skill copies get the stamped
`<<VERSION>>` via the render pipeline, so the comparison is self-contained.

## Affected Files

- `src/cli.js` — add `readPackageVersion` helper, `--version`/`version`/`-v`
  dispatch, `printUsage` line.
- `src/install.js` — read package version; add `<<VERSION>>` to `renderSkill`;
  thread `version` through `installRenderedSkillDir` / `renderFilesInPlace`;
  add `version` to `writeInstallInfo` output.
- `SKILL.md` — metadata stamp line + advisory preflight line.
- `skills/codex/local-board/SKILL.md` — metadata stamp line + advisory preflight
  line. (`skills/codex/local-team/SKILL.md` / `SKILL_TEAM.md` optional — add the
  stamp only if the team skills should also self-report; recommend keeping scope
  to the two `local-board` skills unless the team skills already carry a metadata
  block.)
- `resources/` mirror — if skills are mirrored under `resources/` (see
  `scripts/sync-resources.mjs` / `resources-sync.test.js`), run
  `npm run sync-resources` so the packaged copies match; the pack/resources-sync
  tests will otherwise fail.

## Risks / Edge Cases

- **package.json resolution in the flattened copy** — verified: install copies
  `package.json` to the install-dir root and `src/` beneath it, so
  `../package.json` from `src/cli.js` resolves in both layouts. Guard with a test
  that runs `--version` from the installed runtime dir, not just the repo.
- **Preflight misused as a gate** — the largest behavioral risk. Wording must be
  unambiguously advisory; the agent must warn and continue. Review the phrasing
  against the "must not become a hard gate" requirement.
- **Stale skills after `npm update -g`** — this is exactly the skew this ticket
  makes *detectable*, not auto-fixed. Re-running `local-board install` remains the
  remedy; the preflight surfaces the need.
- **Version consistency within one install** — the skill stamp, `install-info.json`
  `version`, and the runtime `--version` all derive from the same
  `SCRIPT_DIR/package.json` at install time, so a fresh install is internally
  consistent by construction; skew only appears when the runtime is later updated
  without re-running install.
- **Missing/parse-failing package.json** — extremely unlikely (it ships in the
  package `files` list), but `--version` should surface a clean error via the
  existing `main` try/catch rather than a raw stack.
- **`-v` collision** — minor; if there is any doubt, ship `--version` + `version`
  only and defer `-v`.

## Test Strategy

- `test/cli.test.js`: `local-board --version` and `local-board version` each print
  the `package.json` `version` and exit 0; assert output equals the version read
  from `package.json` (not a hardcoded string, so bumps don't break the test).
- `test/install.test.js`: after an in-process/subprocess install into a temp HOME,
  assert (a) the rendered `SKILL.md` contains `local-board v<version>` and no
  literal `<<VERSION>>` remains; (b) `install-info.json` has a `version` field
  equal to `package.json`'s version; (c) the Codex template render also carries
  the stamp. Optionally assert a command-invocation line (e.g. the PATH usage) is
  unchanged to lock the byte-identical-command invariant.
- `test/install.test.js` (runtime `--version`): run `node <installDir>/bin/local-board.js --version`
  and assert it prints the version, proving resolution from the flattened copy.
- `npm run check` (syntax) and `npm test` (full suite incl. resources-sync/pack).

## Open Questions

- Support `-v` as an alias for `--version`, or `--version` + `version` only?
  (Recommend the latter to avoid the verbose-flag convention clash; cheap to add
  `-v` later.)
- Should `--version` print only the bare version (e.g. `0.1.0`) or a labeled line
  (`local-board 0.1.0`)? Recommend bare version for easy scripting/`where` reuse.
- Should the team skills (`SKILL_TEAM.md` / codex `local-team`) also carry the
  stamp + preflight, or only the two `local-board` skills? Recommend scoping to
  `local-board` unless team skills are in active use.

## Implementation Notes

Implemented per the Technical Design:

- `src/cli.js`: added `readPackageVersion()` (reads `version` from
  `new URL("../package.json", import.meta.url)`), dispatched on
  `command === "--version" || command === "version"` before the existing
  command table, printing the bare version and returning 0. Errors (e.g. a
  missing/corrupt package.json) fall through to the existing `main` try/catch
  and print a clean message instead of a raw stack. Added a
  `local-board --version` line to `printUsage`. Resolved open questions per
  the design's recommendation: `--version` + `version` only (no `-v`, to
  avoid the verbose-flag convention clash); bare version output (no
  `local-board` label prefix), for easy scripting/`where` reuse (T1322).

- `src/install.js`: `performInstall` reads the package version once from
  `SCRIPT_DIR/package.json` via `readFileSync`/`join` (already imported).
  Threaded `version` through `installRenderedSkillDir` → `renderFilesInPlace`
  → `renderSkill`, which now also replaces `<<VERSION>>` alongside the
  existing `<<INSTALL_PATH>>`/`<<SCRIPT_PATH>>` tokens. Both the Claude
  single-file render and the Codex template-dir (`cpSync` +
  `renderFilesInPlace`) funnel through `renderSkill`, so both get stamped.
  `writeInstallInfo` now also writes a `version` field (positioned next to
  `nodeVersion`) for T1322's `where` command to read.

- `SKILL.md` (Claude) and `skills/codex/local-board/SKILL.md`: added an
  `Installed from local-board v<<VERSION>>` line to the existing Installation
  metadata block, plus an advisory version-skew preflight line (Claude: near
  the Core Loop preamble; Codex: as preflight step 5 in the existing
  `## Preflight` section) using the wording proposed in the design. Both are
  explicitly advisory — warn and continue, never a gate.

- Scope decisions (per the design's Open Questions, resolved as recommended):
  `-v` alias not added; version output is bare (no label); the stamp/preflight
  were added only to the two `local-board` skills, not `SKILL_TEAM.md` or the
  Codex `local-team` skill.

- `resources/` mirror: not touched — `resources/` only mirrors
  `plans/prompts` and `plans/templates` (per `scripts/sync-resources.mjs`);
  skill files are not part of that mirror, so `npm run sync-resources` was
  not needed. Verified by inspecting `scripts/sync-resources.mjs` and the
  `resources/` tree.

Tests added:

- `test/cli.test.js`: one new test asserting `local-board --version` and
  `local-board version` each print `package.json`'s `version` (read live,
  not hardcoded) and exit 0.
- `test/install.test.js`: two new tests —
  1. Claude target: install into a temp HOME, assert the rendered `SKILL.md`
     contains `local-board v<version>` with no residual `<<VERSION>>`,
     `install-info.json` has a matching `version` field, and running
     `node <installDir>/bin/local-board.js --version` (the flattened runtime
     copy) prints the same version — proving the `../package.json` URL
     resolution holds in that layout too.
  2. Codex target: asserts the rendered Codex `SKILL.md` carries the version
     stamp (no residual `<<VERSION>>`) and the advisory preflight line.

Verification: `npm run check` (syntax, clean), `npm test` (261/261 passing,
including the 3 new tests), `npm run validate` (Ticket validation OK).

No deviations from the design beyond the three explicitly-flagged Open
Questions, which were resolved per the design's own recommendations (no
`-v`; bare version string; stamp/preflight scoped to the two `local-board`
skills only, not the team skills).

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-07T19:34:53Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): --version/version command via package.json URL resolution (both layouts verified), <<VERSION>> stamp in the skill metadata block, install-info version field, advisory preflight line; T1322 seam noted. Estimate 2 (basis T20260707T1325Z).

- 2026-07-07T19:35:55Z: Ensured git branch local-board/T20260707T1321Z-npm-add-version-command-and-skill-version-skew-preflight (created).
