---
id: T20260707T1322Z
type: task
status: done
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260707T1322Z-npm-add-where-json-and-absolute-fallback-prompt-paths-retire-install-path-placeholder
estimate: 2
estimateBasis: T20260707T1325Z
workStartedAt: 2026-07-07T20:15:07Z
workCompletedAt: 2026-07-07T20:43:32Z
created: 2026-07-07T13:22:26Z
updated: 2026-07-07T20:43:32Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "implement:claude-subagent:local-board-implementer@sonnet", review:codex-task:read-only, "test:claude-subagent:local-board-tester@sonnet", document:codex-task:workspace-write]
routingApprovals: []
---
# npm: add where --json and absolute fallback prompt paths; retire INSTALL_PATH placeholder

## Requirement

Even with a PATH-based command, skills still reference `<<INSTALL_PATH>>` for fallback prompts (`SKILL.md:90`) and Codex executor prompts (`skills/codex/*/SKILL.md:18`). Under npm the assets live in the global `node_modules` at a path the skill text cannot know.

Fix: make the CLI report its own asset locations — add `local-board where --json` (install dir, prompts dir, templates dir, agents dir, version, from install-info.json plus import.meta.url resolution), and/or have `begin-step`/`gate-check`/`specialty-run` return absolute fallback-prompt paths directly (they already return project-prompt paths). Then remove the `<<INSTALL_PATH>>` placeholder from all skill templates.

Acceptance: no `<<INSTALL_PATH>>` remains in any skill template; an orchestrator can locate fallback prompts and Codex executor prompts purely from CLI output.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Related Tickets

- **T20260707T1321Z (done)** — added `local-board --version` and the self-locating package-version reader `readPackageVersion()` (`src/cli.js:174`), which reads `new URL("../package.json", import.meta.url)` and works in both the dev/npm-global layout and the flattened `~/.local-board` runtime copy. `where` reuses this exact seam; the `version` field it surfaces is the same one written to `install-info.json`.
- **B20260707T1320Z (done)** — added `packagedResourceDir(name, packageRoot)` (`src/scaffold.js:114`), which probes the two packaged layouts (`<root>/resources/<name>` layered vs `<root>/<name>` flattened) and throws loudly if neither resolves. `where` reuses it for `promptsDir`/`templatesDir`. Also hardened `gate-check`/`specialty-run` to fail loudly on a missing project prompt (`assertPromptExists`, `src/cli.js:815`) and made `init` scaffold the full prompt tree, which is why an automatic packaged-fallback is *not* needed here (see Decision 2).
- **T20260707T1320Z (done)** — moved skills to the PATH command and explicitly deferred INSTALL_PATH retirement and `where` to this ticket (its "INSTALL_PATH boundary" section). Also already stripped `<<SCRIPT_PATH>>` from every live skill template.
- **T20260707T1323Z (plugin evaluation, ready)** — a future consumer: a plugin/marketplace layout would locate assets the same way, so `where --json` is the reusable seam it should build on rather than re-deriving paths.

## Approach

Two moving parts, one primary. Add a self-locating `local-board where --json` that reports the running CLI's own asset locations, then delete the `<<INSTALL_PATH>>` placeholder from every skill template and its rendering machinery. The skills stop naming a machine-specific runtime directory and instead tell agents to call `where`.

### Decision 1 — `where --json` self-locates; it reports the PACKAGE's own assets, not `~/.local-board`

`where` resolves everything from `import.meta.url` of the executing `src/cli.js`, the same seam `readPackageVersion` already uses. This is correct for every install mode because the CLI that agents invoke on PATH is *co-located* with its own assets:

- `npm install -g local-board` → PATH `local-board` runs the global `node_modules/local-board` copy; assets sit beside it in the layered layout (`resources/prompts`, `agents/codex`).
- clone + `npm install -g .` / `npm link` → PATH `local-board` runs the clone; layered layout again.
- The `~/.local-board` runtime copy is a *separate* flattened copy and is **not** what PATH resolves to, so it is irrelevant for asset lookup.

Because `packagedResourceDir` already handles layered-vs-flattened, `where` works identically whichever copy happens to be executing. Proposed JSON shape:

```json
{
  "version": "0.1.0",
  "packageRoot": "<abs dir holding package.json>",
  "promptsDir": "<abs>/resources/prompts  (or <abs>/prompts when flattened)",
  "templatesDir": "<abs>/resources/templates (or <abs>/templates)",
  "agentsDir": "<abs>/agents/codex"
}
```

- `version`: reuse `readPackageVersion()`.
- `packageRoot`: `fileURLToPath(new URL("..", import.meta.url))`.
- `promptsDir` / `templatesDir`: `packagedResourceDir("prompts"/"templates", packageRoot)`. This is the fallback-prompt location the skills need.
- `agentsDir`: `join(packageRoot, "agents", "codex")` — the Codex executor prompts. `agents/` is *not* normalized under `resources/` in either layout (install copies `agents`→`agents`), so it needs no dual-layout probe.

Add a `packageRoot` override parameter to `commandWhere` (mirroring `packagedResourceDir`'s `packageRoot` seam) so tests can exercise both layouts hermetically against fixtures.

Human/non-JSON output prints the same fields as labelled lines.

**What the `~/.local-board` runtime copy is still FOR afterward:** essentially only the enforcement hooks. `settings.json` hook entries reference absolute `~/.local-board/hooks/*.js` paths (`hookScriptPath`, `src/install.js:474`), and `install-info.json` records provenance. `where` deliberately ignores the runtime copy. So the copy is not retired by this ticket, but its role shrinks to "hooks + provenance." Note for a **future ticket**: once hooks also self-locate (or are registered from the package), the `~/.local-board` copy could be dropped entirely. Out of scope here.

Do **not** make `where` read `~/.local-board/install-info.json` as the source of asset dirs — that reintroduces the machine-specific coupling this ticket removes and would be wrong under a bare global npm install where the running CLI is in `node_modules`, not `~/.local-board`. (Optional, low value: a supplementary `installInfo` field parsed from `~/.local-board/install-info.json` when it exists, purely as provenance. Recommend omitting for simplicity — see Open Questions.)

### Decision 2 — no automatic packaged-fallback in begin-step / gate-check / specialty-run; `where` alone suffices

Of the ticket's "and/or", take `where` **only**; do not add absolute-fallback-path return plumbing. Rationale:

- After B1320, `init` scaffolds the complete prompt tree, so fresh boards always have `plans/prompts/**`. The fallback matters only for pre-B1320 boards or hand-deleted files.
- `gate-check`/`specialty-run` already fail loudly via `assertPromptExists` when a *project-configured* prompt is missing. That loud error is the correct contract: a missing project prompt is a board defect, and silently substituting a packaged copy could diverge from a workflow the user has customized. Keep it as-is.
- `begin-step` returns `configuredPrompt` as a project-relative path (`promptForAction`, `src/tickets.js:1409`) and does not verify existence. Leave it unchanged.

The only "fallback" the skill text needs is *where to find the packaged copy to restore from* — which is exactly `where`'s `promptsDir`. So `where` closes the acceptance ("locate fallback prompts and Codex executor prompts purely from CLI output") with no per-command signature changes. This keeps machinery minimal.

### Decision 3 — skill text rewrite (remove the placeholder, point at `where`)

- `SKILL.md:18` — delete the `Runtime directory: <<INSTALL_PATH>>` line. Keep the `Installed from local-board v<<VERSION>>` line. Optionally add one line: "Run `local-board where --json` for packaged asset locations (prompts, templates, Codex executor prompts)."
- `SKILL.md:92` — replace "…or copy the file from `<<INSTALL_PATH>>/prompts/`" with "…or copy it from the `promptsDir` reported by `local-board where --json`." (The primary remedy, `local-board init`, already leads that sentence.)
- `SKILL_TEAM.md:29` — delete the `Runtime directory: <<INSTALL_PATH>>` line.
- `skills/codex/local-board/SKILL.md:16` and `skills/codex/local-team/SKILL.md:16` — delete the `Runtime directory` line.
- `skills/codex/local-board/SKILL.md:17` and `skills/codex/local-team/SKILL.md:17` — replace "Codex executor prompts: `<<INSTALL_PATH>>/agents/codex/`" with "Codex executor prompts: run `local-board where --json` and read `agentsDir`."
- `skills/codex/local-team/SKILL.md:72` (and the `local-board` skill's equivalent routing line, if present) — replace "translate to the matching Codex executor prompt in `<<INSTALL_PATH>>/agents/codex/`" with "…in the `agentsDir` reported by `local-board where --json`."

After these edits, no live skill template contains `<<INSTALL_PATH>>` (acceptance).

### Decision 4 — install.js: drop the INSTALL_PATH replacement; keep VERSION

- Remove the `.replace(/<<INSTALL_PATH>>/g, …)` line from `renderSkill` (`src/install.js:264`). No template uses the token anymore, so rendering it is dead work.
- `installDir` becomes unused by `renderSkill`. Cleanest is to drop the `installDir` argument from `renderSkill` (and stop threading it through `installRenderedSkillDir`→`renderFilesInPlace` *for render purposes*), but `installDir` is still needed by the surrounding install flow for the copy and `writeInstallInfo`. Minimal-risk option: leave the parameter threaded but remove only the replacement line. Recommend the small cleanup (drop the now-dead `installDir` render arg) but flag it as optional polish, not required for acceptance.
- The `<<SCRIPT_PATH>>` replacement is already dead for templates (T1320 removed it from all live skills) — leave it untouched; sweeping it is a separate concern, out of scope.
- Keep `writeInstallInfo` writing `installDir`/`scriptPath`/`version` unchanged; hooks and provenance still consume it.
- The rendered "Installation metadata" block loses its runtime-dir line; keep the `<<VERSION>>` line rendering.

## Affected Files

- `src/cli.js` — add `commandWhere(root, args)` + a `where` branch in `main`; add `where` to `printUsage`. Reuse `readPackageVersion`; import `packagedResourceDir` from `./scaffold.js`. Compute `packageRoot` from `import.meta.url`. Add a `packageRoot` test-override seam.
- `SKILL.md`, `SKILL_TEAM.md` — remove `<<INSTALL_PATH>>` lines; rewrite fallback-prompt sentence.
- `skills/codex/local-board/SKILL.md`, `skills/codex/local-team/SKILL.md` — remove `<<INSTALL_PATH>>` lines; point Codex executor-prompt references at `where`'s `agentsDir`.
- `src/install.js` — remove the `<<INSTALL_PATH>>` replacement in `renderSkill` (+ optional `installDir` arg cleanup).
- `test/install.test.js` — drop/adjust the assertion that `<<INSTALL_PATH>>` is rendered to a concrete runtime path; keep/strengthen the "no `<<…>>`" negative assertion; assert the rendered skills no longer contain a "Runtime directory:" line.
- `test/` (new or existing CLI test file) — add `where --json` coverage and a template-scan test (see Test Strategy).
- Docs (light): `printUsage` is the main surface; optionally note `where` in `memory-bank/techContext.md`/`systemPatterns.md` and any docs mentioning asset locations. No dedicated CLI command table exists to update.

## Risks and Edge Cases

- **import.meta.url through symlinks** (`npm link`, pnpm): Node resolves `import.meta.url` to the real file path, so assets remain co-located. Low risk; covered by the existing `readPackageVersion` precedent already shipping in T1321.
- **`packagedResourceDir` throw** if neither layout resolves: `where` should let it surface as the existing clean, actionable error (it already names both probed paths and says "reinstall") rather than a stack trace. The `main` try/catch prints `error.message`.
- **`agents/codex` presence**: it must ship in the package tarball. `pack.test.js` already asserts `agents/` is included; add an assertion in the `where` test that `agentsDir` exists on disk to catch packaging regressions.
- **Back-compat with already-installed skills**: existing installs still contain a rendered `Runtime directory: <abs ~/.local-board>` line pointing at a real dir — harmless and inert until the user reinstalls. The T1321 version-skew advisory already nudges reinstall on upgrade. No migration needed.
- **Runtime copy still created**: this ticket must not remove the `~/.local-board` copy or the `install-info.json`/hooks it holds; hook `settings.json` entries depend on it. Only the *asset-lookup* role is retired.
- **Non-JSON `where`**: keep it, but the acceptance path is `--json`; ensure labels are stable if any agent parses text.

## Test Strategy

- **`where --json`, layered layout (repo/dev)**: assert `version` equals `package.json`, `promptsDir` ends with `resources/prompts`, `templatesDir` ends with `resources/templates`, `agentsDir` ends with `agents/codex`, and each returned dir `existsSync`.
- **`where --json`, flattened layout**: drive `commandWhere` with a `packageRoot` override pointing at a fixture laid out like `~/.local-board` (`prompts/`, `templates/`, `agents/codex/` at root) and assert the flattened paths resolve — mirrors the existing `packagedResourceDir` layout tests.
- **Template scan (acceptance)**: a test that reads `SKILL.md`, `SKILL_TEAM.md`, and `skills/codex/**/SKILL.md` and asserts none contain `<<INSTALL_PATH>>`.
- **install.test.js**: assert rendered skills contain no `<<…>>` placeholders and no `Runtime directory:` line; confirm `renderSkill` still stamps `<<VERSION>>`.
- **E2E acceptance**: run `local-board where --json`, read `agentsDir`, and assert the seven Codex executor prompt files (`local-board-designer.md`, etc.) resolve there; read `promptsDir` and assert `steps/gate-check.md` resolves.
- Full `npm run check` + `npm test` + `npm run validate` green.

## Open Questions (non-blocking; recommended answers taken)

1. Should `where` include a supplementary `installInfo`/`installDir` field read from `~/.local-board/install-info.json` when present? Recommend **no** (keep it purely self-locating; add only if a concrete consumer needs provenance).
2. Drop the "Runtime directory" metadata line entirely vs. replace with a `local-board where` pointer line? Recommend **drop + add one pointer line** so the metadata block still tells agents where to look.
3. Clean up the now-dead `installDir` argument threading in `renderSkill`/`renderFilesInPlace`, or just remove the replacement line? Recommend the **small cleanup**, but it is optional polish.

## Implementation Notes

Implemented per Technical Design, following all four decisions and the recommended answers to the open questions.

**`local-board where [--json]` (src/cli.js)**
- Added `commandWhere(root, args, packageRootOverride)`, dispatched from `main` on `where`, and added to `printUsage`.
- Self-locates via `selfPackageRoot()` (`path.resolve(fileURLToPath(new URL("..", import.meta.url)))`), reusing `readPackageVersion` (now accepts an optional `packageRoot` override, read via `path.join(packageRoot, "package.json")` instead of the `import.meta.url`-relative URL when overridden) and `packagedResourceDir` (imported from `./scaffold.js`) for `promptsDir`/`templatesDir`. `agentsDir` is `path.join(packageRoot, "agents", "codex")` (no dual-layout probe needed, per design).
- JSON shape: `{ version, packageRoot, promptsDir, templatesDir, agentsDir }`. Non-JSON prints the same five fields as labelled lines.
- `commandWhere` is exported (`export { commandWhere }`) so tests can pass a `packageRoot` override directly (mirrors `packagedResourceDir`'s test seam) without a CLI flag.
- Does not read `~/.local-board/install-info.json` (Decision 1 / Open Question 1: recommended "no").

**No new fallback plumbing** — `begin-step`/`gate-check`/`specialty-run` are unchanged (Decision 2). `where` alone satisfies the acceptance criterion.

**INSTALL_PATH placeholder retirement (Decision 3)**
- `SKILL.md`: replaced the `Runtime directory: <<INSTALL_PATH>>` line with a `Run local-board where --json for packaged asset locations...` pointer line (kept `Installed from local-board v<<VERSION>>`); rewrote the fallback-prompt sentence to point at `promptsDir` from `where --json`.
- `SKILL_TEAM.md`: deleted the `Runtime directory: <<INSTALL_PATH>>` line (no replacement text needed here; it never had a `<<VERSION>>` line either).
- `skills/codex/local-board/SKILL.md`: deleted `Runtime directory:` line; replaced the Codex-executor-prompts line with "run `local-board where --json` and read `agentsDir`."
- `skills/codex/local-team/SKILL.md`: same two edits, plus the routing-table line ("translate to the matching Codex executor prompt in `<<INSTALL_PATH>>/agents/codex/`") now reads "...in the `agentsDir` reported by `local-board where --json`."
- Confirmed no live skill template (or any non-ticket file) contains `<<INSTALL_PATH>>` (grep-verified; also covered by a new test).

**src/install.js (Decision 4)**
- Removed the `.replace(/<<INSTALL_PATH>>/g, ...)` line from `renderSkill`; kept `<<SCRIPT_PATH>>` and `<<VERSION>>` replacements untouched.
- Took the recommended small cleanup: dropped the now-dead `installDir` argument from `renderSkill`, `installRenderedSkillDir`, and `renderFilesInPlace` (render-only threading). `installDir` remains used elsewhere in `install.js` for the copy/`writeInstallInfo`/hooks flow, unchanged.

**Tests**
- `test/cli.test.js`: added `commandWhere` to the import; three new tests — `where --json` in the repo/dev-clone layout (asserts version matches `package.json`, dirs end with `resources/prompts`/`resources/templates`/`agents/codex`, all exist on disk, and both a sample prompt file and `local-board-designer.md` resolve); `where` (non-JSON) labelled-line shape; `where --json` against a flattened-layout fixture via the `packageRoot` override parameter (mirrors the existing `packagedResourceDir` fixture tests).
- `test/install.test.js`:
  - Removed the two assertions that rendered skills matched the concrete `installDir` path (no longer true — INSTALL_PATH is never rendered); added `assert.doesNotMatch(..., /Runtime directory:/)` in both affected tests, alongside the existing `<<SCRIPT_PATH>>|<<INSTALL_PATH>>` negative assertion.
  - New test: "no live skill template contains the retired `<<INSTALL_PATH>>` placeholder" — reads `SKILL.md`, `SKILL_TEAM.md`, and both `skills/codex/*/SKILL.md` directly and asserts neither `<<INSTALL_PATH>>` nor a `Runtime directory:` line survives.
  - New test: "renderSkill no longer replaces `<<INSTALL_PATH>>`" — uses the existing `createPackagedCopy()` fixture helper, reintroduces a literal `<<INSTALL_PATH>>` token into a copied Codex `SKILL.md`, runs a real install from that packaged copy, and asserts the token survives verbatim in the rendered output (proves the replacement code path is actually gone, not just that current templates happen to lack the token).

**Verification**
- `npm run check`: clean (all `node --check` targets pass).
- `npm test`: 267/267 passing (includes 5 new/changed assertions specific to this ticket: 3 in `cli.test.js`, 2 new + 2 edited in `install.test.js`).
- `npm run validate`: `Ticket validation OK`.

**Deviations from the design:** none. Took the recommended answer on all three Open Questions (no `installInfo` field; drop + pointer line; small `installDir`-arg cleanup in `renderSkill`).

**Files touched:** `src/cli.js`, `src/install.js`, `SKILL.md`, `SKILL_TEAM.md`, `skills/codex/local-board/SKILL.md`, `skills/codex/local-team/SKILL.md`, `test/cli.test.js`, `test/install.test.js`.

## Review Findings

Reviewed by codex-task:read-only (gpt-5.5) against commit c9edfa1.

No blocking findings.

- where dispatches before repo-dependent paths; reviewer verified it works from the repo and from $TEMP.
- Reported dirs consistent with both layouts (agents copied verbatim; prompts/templates flattened) per src/install.js:160-166.
- Residual <<INSTALL_PATH>> confined to tests and historical ticket prose; zero live template/agent/docs/source residue.
- Codex skills keep the executor prompt filename convention alongside the agentsDir lookup — parallel orchestrator has everything it needs.
- Installer cleanup removed only the retired rendering; version/script rendering, allow rule, and hooks wiring untouched.
- Tests cover JSON/non-JSON/flattened shapes plus residue scans and the removed substitution.

Verdict: pass

## Test Evidence

Tested by claude-subagent:local-board-tester (sonnet) on branch local-board/T20260707T1322Z-..., commit c9edfa1.

**Suite:** `npm run check` pass; `npm test` 267/267 pass; `npm run validate` OK.

**Probes:**
- `where --json` from the repo and a temp cwd: identical absolute paths, all four dirs exist, version 0.1.0 — self-location via import.meta.url confirmed.
- Throwaway-HOME `install --all --hooks` (npm link/unlink restored): zero `<<INSTALL_PATH>>` or `Runtime directory` matches ANYWHERE in the fake home (both rendered skill dirs and the raw ~/.local-board copy — the source templates themselves are clean now); residue confined to the intentional negative-assertion test fixture and historical ticket prose.
- The INSTALLED runtime's own CLI (`<fakehome>/.local-board/bin/local-board.js where --json`) reported correctly flattened paths (prompts/templates at root, agents/codex present with all seven executor prompts) — live proof of dual-layout resolution, not a fixture.
- Codex skill instructions verified: where --json -> agentsDir with the executor filename convention intact; local-team consistent; Claude skill points fallback prompts at promptsDir.

**Gaps / caveats:** none; Windows homedir override needed both HOME and USERPROFILE (test-harness detail).

Result: pass

## Documentation Updates

Documented by codex-task:workspace-write (gpt-5.5).

- `README.md` — where --json added to the CLI examples.
- `memory-bank/systemPatterns.md` — where [--json] in the MVP CLI list; Codex executor prompts resolve via where --json agentsDir; ~/.local-board noted as hooks + provenance only.
- `docs/CodexSupport.md` — stale installed-runtime executor-prompt wording replaced with the where --json contract.
- Skill templates were rewritten during implementation.

## Questions

## Run Log

- 2026-07-07T20:15:06Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): self-locating where --json from the running CLI's own assets (packagedResourceDir + readPackageVersion), INSTALL_PATH deleted from all templates and renderSkill; no new fallback plumbing (B1320's loud error is the contract); runtime copy noted as hooks+provenance only. Estimate 2 (basis T20260707T1325Z).

- 2026-07-07T20:15:07Z: Ensured git branch local-board/T20260707T1322Z-npm-add-where-json-and-absolute-fallback-prompt-paths-retire-install-path-placeholder (created).

- 2026-07-07T20:32:31Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Implementer (sonnet): where command with dual-layout resolution, INSTALL_PATH fully retired from templates and renderSkill, 5 net-new tests; 267/267 green.

- 2026-07-07T20:35:46Z: Completed review via codex-task:read-only: Codex (gpt-5.5, read-only) verdict pass: where works everywhere, dual-layout paths verified against installer behavior, zero live placeholder residue, codex skill instructions complete.

- 2026-07-07T20:40:33Z: Completed test via claude-subagent:local-board-tester@sonnet: Tester (sonnet): 267/267; where verified in repo, temp cwd, and live from an installed flattened runtime; zero placeholder residue anywhere in a full fake-home install; codex instructions complete. Result: pass.

- 2026-07-07T20:43:32Z: Completed document via codex-task:workspace-write: Codex (workspace-write): README/systemPatterns CLI lists gain where; CodexSupport executor-prompt wording updated; runtime-copy purpose noted.
