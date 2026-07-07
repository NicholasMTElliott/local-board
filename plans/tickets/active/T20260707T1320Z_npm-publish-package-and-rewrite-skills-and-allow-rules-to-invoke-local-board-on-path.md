---
id: T20260707T1320Z
type: task
status: implementing
priority: P1
parent: null
children: []
blockedBy: [T20260707T1318Z, T20260707T1319Z]
blocks: []
branch: local-board/T20260707T1320Z-npm-publish-package-and-rewrite-skills-and-allow-rules-to-invoke-local-board-on-path
estimate: 4
estimateBasis: T20260707T1319Z
workStartedAt: 2026-07-07T16:14:58Z
workCompletedAt: null
created: 2026-07-07T13:20:26Z
updated: 2026-07-07T16:27:21Z
completedSteps: ["design:claude-subagent:local-board-designer@opus"]
routingApprovals: []
---
# npm: publish package and rewrite skills and allow rules to invoke local-board on PATH

## Requirement

Publish the package to npm and make the PATH command the canonical invocation. `package.json` already declares `"bin": { "local-board": "./bin/local-board.js" }`, so `npm install -g local-board` yields a `local-board` command with Windows shims. This deletes the largest fragility class in the skill texts: all ~60 rendered `node <<SCRIPT_PATH>>` occurrences become a stable `local-board ...`, skill texts become byte-identical across machines, and the Claude allow rule becomes the constant `Bash(local-board *)` — no absolute paths, no quoting, no path-separator mismatch, no per-machine divergence.

Scope: rewrite SKILL.md, SKILL_TEAM.md, and both codex skill templates to invoke `local-board`; change the installer's allow rule to `Bash(local-board *)`; update agents/claude and agents/codex texts; skip the `~/.local-board` runtime copy when running from an npm install (keep it only for git-clone installs); document that npx is NOT supported (first-run npx needs network, which the Codex sandbox denies) — require a prior global install.

Depends on: T20260707T1318Z (files allowlist / resources split) and T20260707T1319Z (install subcommand).

Acceptance: after `npm install -g` and `local-board install`, a fresh Claude Code and Codex session can run the full workflow with no absolute paths in any skill text; version skew between CLI and skills is detectable (see T20260707T1321Z).

## Acceptance Criteria

## Related Tickets

## Technical Design

Make the PATH command `local-board` the canonical, byte-identical invocation across
all machines and both install modes, and land the package as publish-ready.

## Related tickets and conflicts

- **T20260707T1318Z** (files allowlist) and **T20260707T1319Z** (`install` subcommand):
  already landed; this ticket builds on `package.json.bin`, the `files` allowlist,
  and `src/install.js`.
- **T20260707T1321Z** (version command + skew preflight): owns version stamping into
  rendered skills. This ticket does **not** stamp a version. It leaves the seam:
  `renderSkill` stays the injection point, and the PATH-verification helper can later
  be upgraded to call `local-board --version`. Do not add a `<<SKILL_VERSION>>` token
  here.
- **T20260707T1322Z** (`where --json` + INSTALL_PATH retirement): owns removing the
  remaining `<<INSTALL_PATH>>` references (fallback prompts, Codex executor prompts)
  and, coupled with that, safely skipping the `~/.local-board` runtime copy. See the
  INSTALL_PATH boundary below — this ticket deliberately stops short of that.
- **B20260707T1323Z** (unquoted SCRIPT_PATH breaks on spaces) and
  **B20260707T1327Z** (Claude designer agent placeholder never rendered): both are
  **superseded** by this ticket. The PATH form has no absolute path to quote (kills
  B1323) and the designer agent text becomes a literal `local-board section ...` with
  no placeholder to render (kills B1327). Recommend the orchestrator close both as
  superseded once this lands.
- **T20260707T1336Z** (skill dedup): will touch the same skill files later. No direct
  conflict, but land order matters — a mechanical find/replace here reduces the
  surface T1336 has to reconcile.

## Design decisions

### 1. Install-mode detection

Detect a **git clone / source checkout** by the presence of a `.git` entry at the
package root (`SCRIPT_DIR`); treat its **absence** as a packaged/npm install.

Rationale: `.git` presence is a direct signal that we are running from a working
checkout. The alternative heuristic — "is `SCRIPT_DIR` inside a `node_modules`
directory" — is fragile: `npm link` symlinks a checkout into the global
`node_modules` (so a dev checkout would be misdetected as npm), and pnpm/Yorkie
layouts vary. `npm install -g` (from registry or from `.`) copies files **without**
`.git`, so the packaged tree is reliably `.git`-free.

Failure modes (all benign for this ticket, because we keep the runtime copy in both
modes — see boundary): a checkout exported as a tarball without `.git` is classified
as npm; a `.git`-bearing tree that a user manually placed on the global prefix is
classified as clone. Neither breaks skill rendering; detection only selects the
guidance string in the PATH-resolution error and is otherwise cosmetic in this
ticket. It becomes load-bearing only when T1322 skips the copy.

Implementation: `const fromClone = existsSync(join(SCRIPT_DIR, ".git"));`

### 2. Rendering mode — always the constant PATH form, with installer verification

Choose **(a)+(c) combined**: always render the literal `local-board ...` (option a),
and have the installer **verify `local-board` resolves on PATH** and fail fast with
targeted guidance when it does not (option c). Reject option (b).

Rationale: the entire point of the ticket is deleting per-machine skill divergence.
Option (b) keeps two renderings and therefore preserves the fragility class (absolute
paths, quoting, separators) for clone installs — unacceptable. Option (a) alone makes
skills byte-identical and the allow rule a constant, but silently produces a broken
skill for a clone user who never ran `npm link`. Adding the (c) verification closes
that gap with an actionable error instead of a mysterious runtime failure. The
skill templates therefore hardcode `local-board` — **no placeholder for the command**
— so `SKILL.md`, `SKILL_TEAM.md`, and both Codex templates become byte-identical
everywhere and the Claude allow rule becomes the constant `Bash(local-board *)`.

Verification helper (works today, before T1321 adds `--version`): resolve the command
on PATH — `where local-board` on win32, `command -v local-board` elsewhere — returning
a boolean. On failure, throw:

- clone mode: `local-board is not on PATH. From this checkout run: npm install -g .`
  `(or: npm link), then re-run local-board install.`
- npm mode: `local-board is not on PATH. Install it globally: npm install -g`
  `local-board, then re-run local-board install.`

The allow rule and the skill text always agree because both are now constants derived
from the same literal command name.

### 3. INSTALL_PATH boundary (explicit, minimal)

**Keep `<<INSTALL_PATH>>` rendering and the `~/.local-board` runtime copy unchanged in
both install modes in this ticket.** Do not skip the copy yet, and do not implement
`where --json`.

Rationale / skeptical note: the ticket scope lists "skip the runtime copy for npm
installs," but the surviving `<<INSTALL_PATH>>` references (fallback prompts at
`SKILL.md:90`, Codex executor prompts at `skills/codex/*/SKILL.md:18,71`,
`SKILL_TEAM.md:29`) resolve against `~/.local-board`, whose layout is a **normalized**
copy (`resources/prompts` → `prompts`, `resources/templates` → `templates`). The real
packaged tree under `node_modules/local-board` has a different layout, so repointing
INSTALL_PATH at the package root would either break those references or reintroduce
per-machine absolute-path divergence for exactly those lines — contradicting the
ticket's own goal. Skipping the copy is only safe **after** INSTALL_PATH is retired,
which is T1322's job (`where --json` / absolute fallback-prompt paths). This ticket
therefore migrates only the ~90 CLI-invocation occurrences and the allow rule; the
handful of INSTALL_PATH asset references and the runtime copy are handed to T1322.

Recommendation to the orchestrator: re-scope the "skip runtime copy" bullet onto
T1322 (or land the two together), since the acceptance line "no absolute paths in any
skill text" cannot be fully met until INSTALL_PATH is gone.

### 4. Version-stamping seam

None here. `renderSkill` is retained (still needed for `<<INSTALL_PATH>>`), which is
the natural place T1321 will add a `<<SKILL_VERSION>>` replacement plus a preflight
line. Keep `scriptPath` threaded through the installer so T1321/T1322 can surface it.
No comment line or token is added by this ticket.

### 5. Publish mechanics — deliver publish-READY, not published

Actual `npm publish` needs human credentials/OTP, so the deliverable is a package that
is verified-publishable:

- **Version: keep `0.1.0`.** The package has never been published, so `0.1.0` is the
  correct initial public release. Bump only if the name/version is already taken at
  publish time.
- **`npm pack` validation** as a test (extend `test/install.test.js` or a small
  `test/pack.test.js`): run `npm pack --dry-run --json` and assert the tarball
  **includes** `bin/`, `src/`, `resources/`, `SKILL.md`, `SKILL_TEAM.md`, `agents/`,
  `skills/`, `install.mjs`, and **excludes** `plans/`, `test/`, `memory-bank/`,
  `docs/`, `scripts/`. This guards the `files` allowlist against regressions.
- **`prepublishOnly` script** in `package.json`: `npm run check && npm test` so a
  human's `npm publish` cannot ship a broken tree.
- **RELEASING note** (one paragraph) added to `README.md` (Install/Contributing area)
  or `docs/`: run `npm run check && npm test`, inspect with `npm pack`, then
  `npm publish` (human, OTP), then tag. If a new `docs/*.md` file is used, update the
  README Documentation Index per AGENTS.md.
- **Document npx is NOT supported**: a short note in the README install section (and
  echoed in the installer's PATH-failure guidance) — first-run `npx` needs network,
  which the Codex sandbox denies; require a prior `npm install -g local-board`.

### 6. install-info.json / "Do not search the filesystem"

`scriptPath` (`~/.local-board/bin/local-board.js`) is **not consumed by any runtime
code** — its only current consumer was the allow-rule construction, which now becomes
the constant `Bash(local-board *)`. Keep the `scriptPath` field in `install-info.json`
for informational/back-compat and future `where --json` reporting; it no longer drives
the allow rule. Update the skill's guidance line (`SKILL.md:21`, and the top "Use the
installed CLI" block at `SKILL.md:10-14` / codex `:8-12`) to: use the `local-board`
command on PATH; do not search the filesystem for local-board source or scripts. The
"CLI entrypoint" metadata line that pointed at `<<SCRIPT_PATH>>` is replaced by a
statement that the command is `local-board` on PATH.

## Implementation approach

1. **Skill templates** — mechanical rewrite of every `node <<SCRIPT_PATH>>` →
   `local-board` in `SKILL.md`, `SKILL_TEAM.md`, `skills/codex/local-board/SKILL.md`,
   `skills/codex/local-team/SKILL.md`. Change the `allowed-tools` frontmatter
   `Bash(node <<SCRIPT_PATH>> *)` → `Bash(local-board *)`. Rewrite the top "Use the
   installed CLI" block and the "CLI entrypoint" metadata line. Leave every
   `<<INSTALL_PATH>>` line untouched.
2. **Agents** — `agents/claude/local-board-designer.md:41`:
   `node <local-board-cli> section ...` → `local-board section ...`. Sweep
   `agents/claude/*.md` and `agents/codex/*.md` for any other `node <...>`/CLI-path
   invocation text and normalize to `local-board ...`. The Codex agents' input-list
   item "local-board CLI path" (`agents/codex/*.md:15`) becomes unnecessary; simplify
   to reference the `local-board` command. (Agent files are copied verbatim, so the
   literal `local-board` is correct with no rendering — this is what supersedes B1327.)
3. **Installer (`src/install.js`)**:
   - Add `fromClone = existsSync(join(SCRIPT_DIR, ".git"))`.
   - Add `resolvesOnPath("local-board")` helper (`where` / `command -v`) and call it in
     `performInstall`; throw the mode-specific guidance on failure.
   - Change `allowRule` to the constant `"Bash(local-board *)"` (drop the interpolated
     `scriptPath`).
   - Keep `scriptPath`, `installDir`, `renderSkill`, `writeInstallInfo`, and the runtime
     copy exactly as-is (INSTALL_PATH boundary).
4. **package.json** — add `prepublishOnly`; extend `check`/`test` wiring if the pack
   test needs a script. Version stays `0.1.0`.
5. **README / docs** — RELEASING paragraph + "npx not supported" note + Documentation
   Index update if a new doc file is added.
6. **memory-bank** — update `techContext.md`/`systemPatterns.md` note about the allow
   rule (currently documents `Bash(node ./bin/local-board.js *)`) to reflect the
   installed constant `Bash(local-board *)`; the project-source rule in
   `.claude/settings.json` is separate and can stay for repo-local dev.

## Affected files

- `SKILL.md`, `SKILL_TEAM.md`, `skills/codex/local-board/SKILL.md`,
  `skills/codex/local-team/SKILL.md` (invocation rewrite + allow-tools constant).
- `agents/claude/local-board-designer.md` (+ sweep of `agents/claude/*.md`,
  `agents/codex/*.md`).
- `src/install.js` (detection, PATH verification, constant allow rule).
- `package.json` (`prepublishOnly`, version confirmation).
- `test/install.test.js` (+ possible `test/pack.test.js`).
- `README.md` (RELEASING + npx note + Documentation Index), optional `docs/*.md`.
- `memory-bank/systemPatterns.md` (allow-rule fact).

## Risks

- **Clone-dev friction**: developers running from a checkout must `npm link` /
  `npm install -g .` before `local-board install` succeeds. Mitigated by the explicit
  PATH-failure guidance. This is the deliberate tradeoff for zero divergence.
- **PATH resolution false negative**: `where`/`command -v` could miss a freshly linked
  command if the shell PATH is stale in the current session. Guidance should mention
  opening a new shell. Low severity.
- **Windows shim quirks**: `npm install -g` creates `local-board.cmd`/`.ps1` shims;
  the Bash tool invokes via the `.cmd` shim. Verify `Bash(local-board *)` actually
  matches how Claude Code shells out on Windows (it invokes through cmd) — this is the
  one behavior to validate on a real machine, since the allow-rule match is exact.
- **Scope-vs-acceptance gap**: acceptance says "no absolute paths in any skill text,"
  but INSTALL_PATH lines remain until T1322. Flagged as an open question; recommend
  co-sequencing.
- **Superseded-ticket coordination**: if B1323/B1327 are worked in parallel they'll
  conflict; orchestrator should close them first.

## Test strategy

Installer tests already redirect `HOME`; extend them:

- **Allow rule**: update the two assertions filtering `rule.startsWith("Bash(node ")`
  to expect the constant `Bash(local-board *)`; assert exactly one such rule and
  idempotency across re-runs.
- **Rendered skills contain no placeholders and no `node <path>` CLI calls**: assert
  installed `SKILL.md`/team skill match `local-board ` invocations and do **not** match
  `node .*local-board\.js`. Keep the existing `<<SCRIPT_PATH>>`/`<<INSTALL_PATH>>`
  negative assertions (INSTALL_PATH still gets rendered to a concrete path, so the
  "no `<<...>>`" checks remain valid).
- **Byte-identical across modes**: render skills under two simulated modes and assert
  the CLI-invocation lines are identical (INSTALL_PATH lines will differ by home path —
  compare the invocation lines specifically, or assert both contain `Bash(local-board *)`).
- **PATH verification**: add a test that runs the installer with a PATH lacking
  `local-board` and asserts it throws the guidance error; and a positive test with a
  stub `local-board` on PATH (or skip-if-not-resolvable) that installs cleanly.
- **Detection**: unit-test the `.git`-presence branch selects the clone guidance vs npm
  guidance in the error string.
- **Pack validation**: `npm pack --dry-run --json` includes/excludes assertions.
- Source-template test (`Codex skill templates ... route translation`) still passes
  since routes are unchanged.

## Documentation impact

- README: RELEASING paragraph, "npx not supported" note, Documentation Index update if a
  new doc file is added, and refresh any `node ./bin/local-board.js` install snippets
  that should now show `npm install -g local-board` + `local-board install`.
- memory-bank: update the allow-rule fact in `systemPatterns.md`.

## Open questions

1. Confirm the "skip `~/.local-board` runtime copy for npm installs" bullet should move
   to T1322 (INSTALL_PATH retirement), since skipping it now would strand the surviving
   INSTALL_PATH asset references. (Recommended.)
2. On Windows, does Claude Code's Bash tool invoke the global `local-board` shim such
   that `Bash(local-board *)` matches exactly? Needs one real-machine confirmation.
3. RELEASING note location: README section vs a new `docs/releasing.md`? (Recommend
   README to avoid a new doc + index entry.)

## Implementation Notes

Implemented exactly per the ticket's Technical Design.

**Skill templates rewritten to the PATH constant** (`SKILL.md`, `SKILL_TEAM.md`, `skills/codex/local-board/SKILL.md`, `skills/codex/local-team/SKILL.md`): all `node <<SCRIPT_PATH>>` invocations became `local-board`; the "Use the installed CLI" block and "CLI entrypoint" metadata line were rewritten to "Use the `local-board` command on PATH" (added to the Codex templates too, which previously lacked that guidance); `<<INSTALL_PATH>>` lines are untouched. Claude `allowed-tools` frontmatter is now `Bash(local-board *)`; the Codex templates carry no `allowed-tools` (unchanged, matches existing test expectation).

**Agents**: `agents/claude/local-board-designer.md` — `node <local-board-cli> section ...` → `local-board section ...`. Swept all `agents/claude/*.md` and `agents/codex/*.md`; no other literal invocation lines existed. Removed the now-unnecessary `- local-board CLI path;` bullet from the six `agents/codex/*.md` Inputs lists (decomposer, designer, documenter, implementer, reviewer, tester) — the codex designer/implementer agent bodies already reference the bare `local-board` command generically, consistent with dropping the path input.

**`src/install.js`**: added `fromClone = existsSync(join(SCRIPT_DIR, ".git"))` and `resolvesOnPath(command)` (`where`/`command -v`), called in `performInstall` before any copying, throwing mode-specific guidance on failure (clone: `npm install -g .` / `npm link`; packaged: `npm install -g local-board`). Added an `options.resolvesOnPath` override seam (used only by in-process tests) so `runInstall`/`performInstall` can inject a stub predicate without touching real PATH. `allowRule` is now the constant `"Bash(local-board *)"` (dropped the interpolated `scriptPath`). `scriptPath`, `installDir`, `renderSkill`, `writeInstallInfo`, and the `~/.local-board` runtime copy are unchanged (INSTALL_PATH boundary honored — out of scope for this ticket).

**`package.json`**: added `"prepublishOnly": "npm run check && npm test"`. Version stays `0.1.0`.

**Tests** (`test/install.test.js`): added a stub `local-board` executable on a temp bin dir, prepended to PATH by default via an updated `installEnv(home, { includeLocalBoardStub })` helper (opt-out flag for negative tests). Updated existing assertions: allow-rule test now asserts the exact constant `["Bash(local-board *)"]`; rendered-skill tests assert `local-board ` invocations, absence of `<<SCRIPT_PATH>>`/`<<INSTALL_PATH>>`, and absence of `node .*local-board\.js`; replaced the old `expectedScriptPath` match with an `expectedInstallDir` (INSTALL_PATH) match since the script path is no longer rendered into skill bodies. Added: an in-process `resolvesOnPath` failure-throw test; a real-PATH clone-mode failure test (via this repo's own `.git`) asserting `npm install -g .` + `npm link` guidance; a packaged/no-`.git` failure test (copies the `files` allowlist into a fresh `.git`-free temp dir and runs its own copied `bin/local-board.js`) asserting `npm install -g local-board` guidance with no `npm link` mention; a positive stub-on-PATH success test; and a byte-identical-invocation-lines-across-homes test. Also strengthened the raw (unrendered) Codex-template test to check for `local-board ` and absence of `<<SCRIPT_PATH>>`/`node .*local-board\.js`.

Added `test/pack.test.js`: runs `npm pack --dry-run --json` and asserts the tarball includes `bin/`, `src/`, `resources/`, `SKILL.md`, `SKILL_TEAM.md`, `agents/`, `skills/`, `install.mjs`, `package.json`, and excludes `plans/`, `test/`, `memory-bank/`, `docs/`, `scripts/`.

**README.md**: rewrote the "install the skills" snippet to `npm install -g local-board` (or `npm install -g .` / `npm link` from a checkout) + `local-board install`, with a note that installed skill/agent text always invokes the bare `local-board` command (byte-identical regardless of install mode) and that the installer verifies PATH resolution first. Added a bold "npx local-board is not supported" callout (Codex sandbox denies the network access a first `npx` run needs). Kept the repo-dev `node ./bin/local-board.js <cmd>` snippets (Quick start, CLI reference) unchanged — those demonstrate running this checkout's own CLI, not the installed skill, and are out of this ticket's scope per the design's own instruction. Added a "Releasing" section (check + test via `prepublishOnly`, `npm pack --dry-run` inspection, human `npm publish` with OTP, tag). No new `docs/*.md` file was added, so no Documentation Index change was needed.

**memory-bank/systemPatterns.md**: updated the "Subagent CLI Permission" fact — the installed allow rule is now the constant `Bash(local-board *)` (installer verifies PATH resolution first); the project-source rule `Bash(node ./bin/local-board.js *)` in this repo's own `.claude/settings.json` is unchanged and stays for repo-local dev, per the design's explicit note.

**Not touched** (per design boundary / ticket scope): `<<INSTALL_PATH>>` rendering, the `~/.local-board` runtime copy, `where --json`, version stamping, `plans/` ticket content, `.claude/settings.json` (project-local dev rule).

**Verification**:
- `npm run check`: clean (all `node --check` targets pass).
- `npm test`: 179/179 pass, 0 fail.
- `npm run validate`: `Ticket validation OK`.
- Real-machine PATH-shim validation (the one flagged risk): ran `npm link` in this checkout to produce a real Windows `local-board.cmd`/`local-board` shim, confirmed `where local-board` resolves both, ran `local-board validate` successfully through the Bash tool (confirms `Bash(local-board *)` is the correct allow-rule shape for how the Bash tool invokes global npm shims on Windows). Then ran a full throwaway-HOME `local-board install --all` (all 6 targets: Claude, Codex, opencode, Cline, Cursor, Agents) using that real shim. Grepped every installed skill/agent directory (excluding the internal `.local-board/src` runtime copy, which legitimately contains the `<<SCRIPT_PATH>>` string as installer source code, not rendered output) for `node C:` and `<<SCRIPT_PATH>>`: zero matches in both cases. The installed Claude `.claude/settings.json` allow rule was exactly `["Bash(local-board *)"]`. Cleaned up: removed the throwaway HOME and ran `npm unlink -g local-board`; confirmed `local-board` is off PATH again and the full test suite (179/179) still passes afterward (tests rely only on the stub bin dir, not the real link).

**Deviations from the ticket's own exact wording**: none substantive. One judgment call: the design said the "local-board CLI path" Codex-agent Input bullet "becomes unnecessary; simplify to reference the local-board command" — I removed the bullet outright (rather than rewording it in place) since the surrounding agent bodies (e.g. designer, implementer) already reference the bare `local-board` command generically elsewhere in their Rules sections, so no replacement input line was needed.

**Remaining risks** (matching the ticket's own Risks section, now with real-machine confirmation added): clone-dev friction (must `npm link`/`npm install -g .` first) is the deliberate tradeoff and is now covered by a passing test; Windows shim quirks were validated live via `npm link` + Bash-tool invocation as above; the scope-vs-acceptance gap (INSTALL_PATH lines survive until T1322) is unchanged and was out of scope here by design.

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-07T16:14:04Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): always-PATH rendering + installer PATH verification with mode-specific guidance (.git detection); INSTALL_PATH + runtime copy stay until T1322; publish-ready deliverable (pack test, prepublishOnly, RELEASING note); B1323/B1327 flagged superseded. Estimate 4 (basis T20260707T1319Z).

- 2026-07-07T16:14:58Z: Ensured git branch local-board/T20260707T1320Z-npm-publish-package-and-rewrite-skills-and-allow-rules-to-invoke-local-board-on-path (created).
