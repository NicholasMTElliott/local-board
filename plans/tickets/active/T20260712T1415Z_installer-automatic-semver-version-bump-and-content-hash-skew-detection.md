---
id: T20260712T1415Z
type: task
status: designing
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260712T1415Z-installer-automatic-semver-version-bump-and-content-hash-skew-detection
estimate: 4
estimateBasis: T20260710T1532Z
workStartedAt: null
workCompletedAt: null
created: 2026-07-12T14:15:09Z
updated: 2026-07-12T14:40:42Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
routingApprovals: []
---
# installer: automatic semver version bump and content-hash skew detection

## Requirement

From the 2026-07-12 install-process test: package.json has been pinned at 0.1.0 since scaffold, so the skills' version-skew advisory (compare installed-from version vs local-board --version) can never fire on this setup, and install-info.json carries no content fingerprint - a stale install is undetectable except by manually diffing artifacts. Meanwhile the installable payload changed materially across the last two run batches (skills, agents, prompts, hooks).

### Scope

1. Automatic semver version bump. Design decides the mechanism and mapping; candidates to evaluate: (a) bump wired into the merge/closeout flow (e.g. a bump script the orchestrator or a git hook runs when mainline advances with installable-content changes); (b) CI-driven bump via the existing .github/workflows/ci.yml; (c) npm version invoked by a release script. Semver mapping candidate: bug ticket merged -> patch, task/story -> minor, epic or an explicit breaking marker -> major - evaluate viability against the board's merge flow (merges are manual --no-ff by the orchestrator; commitPlanningOnTransition auto-commits are noise that must not trigger bumps). A plain patch-bump-per-installable-merge is an acceptable fallback if type-mapped semver proves brittle. The bump must be automatic in the normal workflow, not a manual release chore, and must not bump when nothing installable changed.
2. Content hash for skew detection. The installer computes a deterministic hash over the installed payload (the exact source set it copies: skills, agents, hooks, prompts, templates, src/bin runtime files), records it in install-info.json alongside version and installedAt. Add a CLI surface - install --status (or an extension of where --json; design decides) - that recomputes the hash from the current package source and reports current/installed version + hash and a clear skewed/current verdict. Exit code should distinguish skew (non-zero or a JSON field; design decides, but scriptable).
3. Skill advisory alignment: update the version-skew advisory paragraph in the skills (SKILL.md + codex mirror at minimum; all four if the team skills carry it) to mention the hash-based check as the reliable path. Skills/prompts are production artifacts: content-assertion + sync suites apply; plans/prompts edits need npm run sync-resources (skills ship verbatim, no mirror).
4. Tests: hash determinism (stable across runs; changes when any payload file changes; insensitive to line-ending/platform noise - decide and document CRLF handling since install copies can be checked out either way); bump logic unit tests (mapping, no-op when no installable diff); --status skew/current paths incl. missing install-info; existing installer tests extended if present (design enumerates the current install test surface).
5. Docs: README install section, docs/ page that covers install (CodexSupport.md or wherever install is documented - design locates), memory-bank/techContext.md.

### Acceptance criteria

- After a merge that changes installable content, either the version differs or (for unbumped dev checkouts) install --status reports skew; both version and contentHash appear in install-info.json.
- A fresh install followed by install --status reports current; touching any installed-payload source file flips it to skewed.
- Auto-commits of plans/tickets alone do not trigger a bump.
- npm run check and node --test pass.

### Non-goals

- No npm-registry publishing or release automation beyond the version field.
- No breaking changes to existing CLI commands or install layout; install-info.json gains keys only.

## Acceptance Criteria

## Related Tickets

## Technical Design

Automatic semver version bump plus a content-hash skew check for the installed
payload. Reworked after design review r1 (FAIL, 3 High / 5 Medium) - the git-hook
mechanism is dropped entirely; the bump now rides an existing deterministic
closeout CLI op (`fast-forward`) behind an opt-in config gate, per-target install
metadata resolves the multi-target staleness gap, and the shared inventory /
grammar / command-contract Mediums are closed below. `install.mjs` is a thin shim
over `src/install.js`, which `src/cli.js` and (new) `src/version-bump.js` also
import, so one shared payload inventory backs copy, hash, and bump-trigger with no
duplication.

### Related tickets and context

- T20260707T1322Z / T20260707T1318Z: dual layout (the on-PATH CLI - dev checkout
  or npm-global - is co-located with a SOURCE layout that has `resources/`; the
  flattened `~/.local-board` runtime snapshot has `prompts/`/`templates/` and is
  NOT invoked as the CLI) and the `resources/` mirror of `plans/`.
- Merge reality (`plans/local-board.config.jsonc`): `git.autoMerge` is `false`,
  `commitPlanningOnTransition` is `true`. Closeout is a manual `git merge --no-ff`
  landing on the `mainline` ref, after which `local-board fast-forward` reconciles
  the default checkout. Confirmed: all four skill closeout contracts (`SKILL.md`,
  `SKILL_TEAM.md`, `skills/codex/local-board/SKILL.md`,
  `skills/codex/local-team/SKILL.md`) already invoke `fast-forward` on the root.
- Grammar: `TICKET_ID_RE = /^[ESBT]\d{8}T\d{4}Z$/` (`src/tickets.js:607`) - ids are
  E/S/B/T-prefixed; history contains `Merge B...`, `Merge S...`, etc.

### Decision 1 - bump mechanism: ride `fast-forward`, opt-in config gate, no git hooks (resolves Highs 1 and 2)

The r1 git `post-merge` hook is removed. Rationale it failed on: `init` runs in
arbitrary consumer repos (a generic hook would bump THEIR `package.json`); and
per-clone hooks are not "automatic in the normal workflow" (fresh clones lack
them, `core.hooksPath` bypasses them, no contract invokes them).

Replacement: a single deterministic closeout CLI op does the bump.

- Integration point: `fastForwardDefaultBranch` (`src/worktrees.js:261`). It
  already runs in the project root on the default branch after every merge, in
  ALL FOUR closeout contracts, and it already knows `previousHead`/`newHead`/
  `advanced`. No new skill step and no CLI-Commands-fence change is required
  (avoiding the byte-identical fence-sync burden the reviewer flagged).
- Repo-safety gate (resolves High 1): the bump fires only when a new opt-in
  config flag `git.autoVersionBump` is `true`. It defaults `false` in
  `DEFAULT_CONFIG` (`src/config.js` git block) and in the scaffolded config, so
  every consumer repo is inert; `local-board`'s own
  `plans/local-board.config.jsonc` sets it `true`. A fork that renamed the
  package still works by setting the flag - the flag, not a hard-coded package
  name, is the authority; the op operates on the invocation root's own
  `package.json`, which for an opted-in repo is that repo's own package by
  construction. Because the default is off, existing `fast-forward` behaviour and
  tests are unchanged when the flag is absent.
- Automatic-in-workflow (resolves High 2): with the flag on, every `fast-forward`
  reconciliation that advanced the default branch over installable-payload
  changes performs the bump - no reliance on hooks, no per-clone install, no
  contract edit. Fresh clones inherit it because the flag lives in the committed
  config, not in `.git/`.
- Kept for manual use: a standalone `local-board version-bump` command (contract
  in Decision 5) for one-off/major/minor overrides and recovery.

Bump gating inside `fastForwardDefaultBranch` (all guarded so a non-opted repo is
untouched):

1. If `advanced` is false (`previousHead === newHead`), skip.
2. If `git.autoVersionBump !== true`, skip.
3. Compute `git diff --name-only previousHead newHead`; if no path satisfies
   `isInstallablePath` (Decision 3), skip (this is exactly the "planning-only
   auto-commits do not bump" criterion - `plans/` is not installable).
4. Determine the level (Decision 2), rewrite `package.json`, and commit ONLY
   `package.json` (Decision 5 recovery contract). The bump commit is a plain
   (non-merge) commit, so it never re-enters a merge-subject scan; the next
   `fast-forward` starts from a `previousHead` at/after it, so the same range is
   never re-processed (no double increment).

`fastForwardDefaultBranch` returns an added `versionBump: { bumped, from, to,
level } | null`; `commandFastForward` surfaces it in text/`--json`. The pure logic
lives in `src/version-bump.js`; `worktrees.js` only calls it.

Note on `autoMerge: true` repos (not this repo's config): the single-checkout
auto-merge-then-switch path advances the default checkout without a subsequent
`fast-forward`, so the auto-bump would not fire there. That path is out of scope
for local-board's own workflow (`autoMerge: false`); such repos use the manual
`version-bump` command, and the hash-skew status is the safety net either way.
Documented as a known limitation, not a silent gap.

### Decision 2 - semver mapping over the advanced range (shared grammar, no new front-matter field) (resolves Medium 4)

Types are `epic | story | task | bug` (`src/tickets.js`). Mapping: `bug -> patch`,
`task | story -> minor`, `epic -> major`.

The advanced range can span several merges (parallel reconciliation), so the level
is computed across the WHOLE range and reduced to the max (`major > minor >
patch`), applied as ONE bump:

- `git log --merges --format=%s previousHead..newHead` yields merge subjects.
- Extract ids with the shared grammar's character class, not a `T`-only regex:
  `MERGE_SUBJECT_RE = /^Merge\s+([ESBT]\d{8}T\d{4}Z)\b/` (derived from and
  cross-referenced to `TICKET_ID_RE` so B/S/E merges - present in history - are
  matched). Export a small helper so both stay in lockstep.
- For each id, `findTicket(root, id)` (searches active/done/archived, so a
  merged-then-archived ticket still resolves) and read `frontMatter.type`.
- Reduce to the max level. If NO subject parses or NO ticket resolves but the
  range did change installable paths, fall back to a flat `patch` (a payload
  change always advances at least a patch; never skips).

Breaking-change contract (resolves the "breaking marker needs a schema/setter
contract" half of Medium 4): NO new front-matter field is added. `epic -> major`
is the mapped major path; a breaking change that is not an epic is handled by the
manual escape hatch `local-board version-bump --level major`. This deliberately
avoids new schema/validator/setter surface for a rare case. Documented in
Workflow.md.

Pure helpers in `src/version-bump.js` (git-free, unit-tested):

```text
mapBumpLevel(ticketType) -> "major" | "minor" | "patch"
maxLevel(levels[]) -> "major" | "minor" | "patch"
nextVersion(current, level) -> "X.Y.Z"   // bumps the part, zeroes lower parts
selectBump({ changedPaths, levels }) -> { bump: boolean, level }
```

### Decision 3 - payload hash: one inventory === the installer copy set; source-layout-only (resolves Mediums 5 and 6)

Single source of truth: extract the installer's copy set into an exported spec in
`src/install.js` and drive BOTH the copy step AND the hash from it. The
bump-trigger predicate is derived from the SAME spec, so the "installable" set,
the hashed set, and the copied set are one definition (this closes Medium 5: r1's
`isInstallablePath` counted `install.mjs`, which the installer does NOT copy).
`install.mjs` is therefore NOT installable for bump/hash purposes; installer-logic
changes are still covered because `src/install.js` is under the copied `src/`
root. A change to the 9-line `install.mjs` shim alone will not trigger a bump -
accepted and documented.

```text
PAYLOAD_SPEC = [
  { type: "file", source: "package.json" },
  { type: "file", source: "README.md" },
  { type: "file", source: "SKILL.md" },
  { type: "file", source: "SKILL_TEAM.md", optional: true },
  { type: "dir",  source: "bin" },
  { type: "dir",  source: "src" },
  { type: "dir",  source: "agents" },
  { type: "dir",  source: "skills" },
  { type: "dir",  source: "hooks" },
  { type: "dir",  source: "resources/prompts",   target: "prompts" },
  { type: "dir",  source: "resources/templates", target: "templates" },
]
```

`performInstall`'s hardcoded copies are refactored to iterate `PAYLOAD_SPEC`
(`target` drives the install-dir rename; it does NOT affect the hash, which keys
on `source`-relative paths).

Helpers in `src/install.js`:

```text
isSourceLayout(root) -> boolean            // resources/prompts present (source) vs prompts/ (flattened snapshot)
collectPayloadEntries(root) -> [{ relPath, absPath }]   // dirs expanded, sorted by POSIX relPath
computePayloadHash(root) -> "sha256:<hex>" | null       // null when !isSourceLayout(root)
isInstallablePath(relPath) -> boolean      // relPath under any PAYLOAD_SPEC source root; nothing else
```

Layout constraint (resolves Medium 6): the hash is DEFINED only over the SOURCE
layout. Both sides of every comparison use a source layout: install-time hashes
`SCRIPT_DIR` (source); the stored `install-info` hash was source-computed;
`install --status` and `where --json` recompute from the on-PATH CLI's own root,
which is always a source layout (the flattened `~/.local-board` snapshot is never
invoked as the CLI - T20260707T1322Z). `computePayloadHash` returns `null` on a
non-source layout, and `where --json` emits `contentHash: null` there. The
flattened tree is never hashed; it is only compared against via its stored
`install-info` hash. This is the explicit source-only constraint the reviewer
asked for, with flattened behaviour defined.

Hash construction: one SHA-256 (Node `crypto`, no dependency) fed, per entry in
sorted POSIX-`relPath` order, with `relPath + "\0" + normalize(content) + "\0"`,
where `normalize = buf.toString("utf8").replace(/\r\n/g, "\n")`. POSIX `/`
separators and `\r\n -> \n` make the digest identical across OS and line-ending
representation (same hazard `sync-resources.mjs`/`normalizeEol` already handle).
Text-only payload assumption is valid today (`.md/.js/.mjs/.yaml/.yml/.json`);
binary-extension skip is the noted future seam. `package.json` is in the set, so a
bump also changes `contentHash`; both signals then agree - intentional.

### Decision 4 - per-target install metadata + per-target status (resolves High 3)

r1 recorded a single global version/hash, so `install --target=codex` rewrote it
while the Claude skill dir stayed stale ("false-current"). Fix: record per-target
metadata and derive a worst-of verdict.

`writeInstallInfo` is changed to MERGE (read existing `install-info.json` if
present, update only the just-installed targets) rather than overwrite, and adds a
`targets` map. Existing top-level keys are unchanged; `contentHash` and `targets`
are additive (structural-equivalence preserved):

```text
{
  ...existing keys (name, installedAt, installDir, scriptPath, nodeVersion,
     version, skillName, teamSkillName, claudeAgents) unchanged...,
  contentHash: "sha256:<hex>",          // additive: the snapshot's payload hash (last install)
  targets: {                            // additive: per-target skew state
    claude: { version, contentHash, installedAt },
    codex:  { version, contentHash, installedAt }
  }
}
```

Each selected target's entry is (re)written on that install; untouched targets'
entries are preserved. So after `--target=codex`, `targets.claude` still holds the
hash from the earlier Claude install; when the source has since changed,
`targets.claude.contentHash !== current` => that target reports `skewed`.

### Decision 5 - status surface, `version-bump` command, and exit contracts (resolves Medium 7)

`install --status [--json]` (a flag on `install`, via `runInstall` ->
`performStatus`). Recomputes `computePayloadHash(SCRIPT_DIR)` (current source) and
compares per target against `<home>/.local-board/install-info.json`.

Per-target verdict, then a GLOBAL verdict = worst of them (skew dominates):

```text
{
  verdict,                       // "current" | "skewed" | "not-installed"
  skewed,                        // boolean (verdict === "skewed")
  current: { version, contentHash },
  targets: {                     // one entry per recorded target
    <id>: { version, contentHash, installedAt, verdict }
  }
}
```

- A target is `skewed` when its recorded `contentHash` differs from `current`, OR
  the record predates this feature and has no `contentHash`.
- Global `verdict`: `not-installed` when no `install-info.json`/no `targets`;
  `skewed` when any target is skewed; else `current`.
- Exit codes (scriptable; verified clean by review): `0` current, `3` skewed, `4`
  not-installed. `2` stays reserved for usage/parse errors. `--json` always prints
  the report regardless of exit code. `--status` reuses `resolveHome` (so `--home`
  is the test seam).

`where --json` additionally gains `contentHash` (source-only per Decision 3;
`null` on a flattened layout).

`local-board version-bump` command contract (Medium 7 - fully specified):

- Usage: `local-board [--root <path>] version-bump [--level major|minor|patch]
  [--allow-main-root] [--json]`. Root-scoped mutation on the default checkout.
- Behaviour: same range-scan/level logic as Decision 1/2 when invoked without
  `--level` (scans the merge span since the previous bump commit on the default
  branch). `--level` forces the level and skips the range scan (the major/minor
  escape hatch).
- JSON shape: `{ bumped: boolean, from: "X.Y.Z", to: "X.Y.Z"|null,
  level: "major"|"minor"|"patch"|null, reason }` where `reason` is one of
  `bumped | not-enabled | not-advanced | no-payload-change | not-on-default |
  dirty-package-json | already-bumped`.
- Exit codes: `0` on success (bump or intentional no-op); `2` on precondition/
  usage error.
- Dirty/partial-failure recovery (never double-increment, never sweep user edits):
  1. Refuse (`reason: dirty-package-json`, exit 2, no write) if `package.json`
     has uncommitted changes at entry - so a user's in-flight edit is never
     folded into a bump commit.
  2. Stage and commit ONLY `package.json` by explicit pathspec
     (`git commit -- package.json`), never `git add -A`.
  3. If the commit step fails after the file write, restore `package.json` to its
     pre-write bytes before surfacing the error, leaving a clean tree so a re-run
     recomputes the same target rather than incrementing again.
  4. If `HEAD` is already a `chore: bump version` commit, no-op
     (`reason: already-bumped`).

### Decision 6 - skill advisory rewording (unchanged from r1; reviewer verified clean)

Reword the version-skew advisory in `SKILL.md` (prose) and
`skills/codex/local-board/SKILL.md` (numbered `5.`). Team skills do not carry it.
Keep `<<VERSION>>`. Not asserted by `skill-usage-sync.test.js` (that suite compares
only the `## CLI Commands` fences and `## Delegation` fallback-walk sections), and
no command is added to the CLI-Commands fences, so no byte-identical fence update
is needed. Canonical sentence:

Version-skew check (advisory): this skill was installed from local-board
`v<<VERSION>>`. Two signals indicate the runtime drifted from what these skills
were built against: (1) `local-board --version` prints a version different from
`v<<VERSION>>`, and (2) more reliably, `local-board install --status` reports
`skewed` - it recomputes a content hash over the installed payload and compares it
to the hash recorded at install time, so it catches drift even when the version
number was not bumped (common on dev checkouts). If either fires, warn the user
and suggest re-running `local-board install` to refresh the skills. This is
advisory: warn and continue; never treat it as a hard gate or block the ticket.

### Affected files

- `src/install.js`: `PAYLOAD_SPEC`; refactor `performInstall` copies to iterate
  it; `isSourceLayout`, `collectPayloadEntries`, `computePayloadHash`,
  `isInstallablePath`; `writeInstallInfo` merge + `contentHash` + `targets`;
  `parseArgs` `--status`; `performStatus` (per-target, worst-verdict);
  `runInstall` dispatch; `printHelp`.
- `src/version-bump.js` (new): `mapBumpLevel`, `maxLevel`, `nextVersion`,
  `selectBump`, `MERGE_SUBJECT_RE`, `runVersionBump(root, { level, config, now })`
  (imports `isInstallablePath`/`computePayloadHash` from install.js to stay
  single-source).
- `src/worktrees.js`: `fastForwardDefaultBranch` calls `runVersionBump` under the
  `git.autoVersionBump` gate; returns `versionBump`.
- `src/config.js`: add `git.autoVersionBump: false` to `DEFAULT_CONFIG` and the
  scaffolded config template + comment.
- `plans/local-board.config.jsonc`: set `git.autoVersionBump: true` (local-board
  opts itself in).
- `src/cli.js`: dispatch `version-bump` -> `commandVersionBump`; `commandFastForward`
  surfaces `versionBump`; `commandWhere` adds `contentHash`; `printUsage` lists
  `version-bump` and the `install --status` flag (expands `usageCommandNames`;
  harmless to the subset test; NOT added to skill CLI-Commands fences).
- `SKILL.md`, `skills/codex/local-board/SKILL.md`: advisory rewording.
- Docs: `README.md`, `docs/Install.md`, `docs/Workflow.md`,
  `memory-bank/techContext.md`.
- No `src/scaffold.js` git-hook change (r1's hook mechanism removed).

### Test plan

Existing `install.test.js` surface to extend (not break) - ~40 tests across:
list-targets output/shape; codex skill render + uninstall removal; version
stamping into skills / install-info / runtime `--version`; codex-task hint
present/absent; codex skill frontmatter + route-translation; retired
`<<INSTALL_PATH>>` guards; `renderSkill` token behaviour; CLI-vs-`install.mjs`
parity and `--home` (skips PATH precheck); `--home` fail-closed/blank/relative;
`LOCAL_BOARD_INSTALL_REQUIRE_HOME` guard; allow-rule patch idempotent/preserve/
prune; uninstall no-op on missing/malformed/unrelated settings; `--hooks`
opt-in/idempotent/quoting/uninstall/`--no-hooks`/non-Claude. All remain valid
(only additive install-info keys).

- `test/version-bump.test.js` (new): `mapBumpLevel` each type; `maxLevel`
  reduction; `nextVersion` increments and zeroes lower parts (`1.2.3` minor
  `1.3.0`, major `2.0.0`); `selectBump` no-op when `changedPaths` are all
  `plans/...` and bumps when any payload path changed; `MERGE_SUBJECT_RE` matches
  `Merge B...`/`S...`/`E...`/`T...` and rejects non-merge subjects;
  `runVersionBump` on a throwaway git repo: range touching `src/` bumps and commits
  `chore: bump version...`; range touching only `plans/` no-ops; multi-merge range
  takes the MAX level; merged-then-archived ticket still resolves its type;
  unresolved id falls back to patch; not-on-default no-op; second run on a bump
  HEAD no-op (idempotent); dirty `package.json` refused (no write); commit-failure
  path restores `package.json` (no double increment); `--level major` forces major
  and skips the range scan; user edits to other files are never in the bump commit.
- `test/worktrees` (fast-forward suite): flag `false`/absent => NO bump and
  identical prior return shape (regression); flag `true` + advanced over `src/` =>
  bump commit + `versionBump` populated; flag `true` but not advanced / only
  `plans/` => no bump; non-git and generic-consumer repos (flag default false) =>
  never bump.
- `test/install.test.js` (extend): `install-info.json` carries `contentHash`
  matching `^sha256:[0-9a-f]{64}$` and a `targets` map; determinism (two installs
  same source => same hash); CRLF insensitivity (packaged copy with a payload file
  rewritten to CRLF hashes identically to LF); MULTI-TARGET staleness: install
  `claude`, mutate a payload file in a packaged source copy, install `--target=
  codex` from the mutated copy => `install --status` reports `claude` skewed,
  `codex` current, GLOBAL `skewed`/exit 3; fresh install => `current`/exit 0; no
  `install-info.json` => `not-installed`/exit 4; pre-feature record (no
  `contentHash`/no `targets`) => `skewed`; `computePayloadHash` on a flattened
  layout returns `null` and `where --json` emits `contentHash: null`.
- `test/cli.test.js` (extend): `version-bump` dispatch + `--json` shape + exit
  codes; usage lists `version-bump`; `fast-forward --json` includes `versionBump`;
  `where --json` includes `contentHash`.
- Note: r1 hook-specific test gaps (user hooks, `core.hooksPath`, fresh-clone hook
  absence) are MOOT - no hook is installed.
- Regression: FULL `node --test` (skills/prompts are production artifacts per
  AGENTS.md). No `plans/prompts` edit here, so `npm run sync-resources` is not
  required; advisory edits are to verbatim-shipped skill files.

### Docs

- `README.md`: `contentHash`/`targets` in `install-info.json`; `install --status`.
- `docs/Install.md`: `contentHash`, per-target `targets`, `install --status`
  verdicts + exit codes (0/3/4).
- `docs/Workflow.md`: closeout - `fast-forward` auto-bumps when
  `git.autoVersionBump` is on; `version-bump --level` major/minor escape hatch;
  the `autoMerge: true` limitation.
- `memory-bank/techContext.md`: versioning mechanism (fast-forward + config gate)
  and hash-skew command.
- No new `docs/*.md`, so the README Documentation Index is unchanged.

### Risks and open questions

- `git.autoVersionBump` default `false` is the sole safety gate for consumers;
  correct by construction (opt-in, committed config, no `.git/` dependency), and
  regression-guarded by the flag-off fast-forward tests.
- `autoMerge: true` single-checkout repos skip the auto-bump (no post-merge
  `fast-forward`); covered by manual `version-bump` + hash-skew status. Documented.
- Merge subjects that deviate from `Merge <id>...` degrade to a flat patch, never a
  skip; `--level` is the override.
- `fast-forward` gains a commit side effect when opted in - a behaviour change, but
  gated off by default so existing semantics/tests are preserved.
- `package.json` in the hash set means a bump also flips `contentHash` (both
  signals agree; intentional).
- Text-only payload assumption holds today; binary-extension skip is the future
  seam.

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-12T14:24:01Z: Completed design via claude-subagent:local-board-designer@opus: Post-merge local-board version-bump command auto-wired via init-installed .git/hooks/post-merge (mainline-only, once per no-ff closeout; CI and branch-side bump rejected with rationale); type-mapped semver (bug patch / task-story minor / epic-breaking major) from merge subject -> ticket front matter with flat-patch fallback + --level escape hatch; SHA-256 over shared PAYLOAD_SPEC in src/install.js driving both copy and hash (sorted POSIX paths, CRLF-normalized); additive contentHash in install-info; install --status with current/skewed/not-installed at exit 0/3/4 + where --json contentHash; advisory reworded in SKILL.md + codex mirror; new version-bump.test.js + extended install/cli tests; README/Install/Workflow/techContext docs. Risk: init writing .git/hooks is new scope (manual fallback documented).

- 2026-07-12T14:25:01Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: none (versioning/integrity feature; hook execution surface addressed in design with guards + fallback; hash is fingerprint not crypto)

- 2026-07-12T14:32:39Z: Design review r1 (codex-task:read-only@gpt-5.6-sol, xhigh): FAIL. 1) [High] init installing a post-merge hook is UNSAFE generically: init runs in arbitrary consumer repos, which would then bump/commit their own package.json after merges touching src/ - needs package-identity/opt-in guard or a repo-specific mechanism. 2) [High] git hooks are per-clone and uncommitted (fresh clones never get one; core.hooksPath bypasses); the closeout contracts in the four skills never invoke version-bump, so bumping is NOT automatic in the normal workflow - put the command in every applicable closeout contract or integrate into a deterministic closeout CLI op; resolve hooks through git incl. common-dir/linked-worktree cases. 3) [High] multi-target false-current: install --target=codex rewrites the single global install-info hash while Claude skills stay stale - record per-target hashes/versions or refresh all previously-installed targets before stamping. 4) [Med] merge-subject regex ^Merge T... misses B/S/E ids (history has Merge B...) - use the shared TICKET_ID_RE grammar; breaking-field needs a schema/setter contract. 5) [Med] isInstallablePath treats install.mjs as installable but the installer does not copy it - violates no-op criterion/single source of truth; remove or split versioned-payload vs installed-snapshot definitions. 6) [Med] flattened ~/.local-board layout has prompts/ and templates/ not resources/... - hash collector needs layout-aware keys or an explicit source-only constraint for where --json contentHash. 7) [Med] version-bump command contract undefined (JSON shape, exit codes, dirty-package.json handling, partial-failure recovery to avoid double-increment; keep user edits out of the bump commit). 8) [Med] test plan gaps: generic/non-git init, user hooks/core.hooksPath, fresh clones, multi-target staleness, B/S/E parsing with done tickets, flattened hashing, partial failures; enumerate existing install.test.js surface. Verified clean: CI-rejection rationale (read-only token), exit codes 3/4 no conflict, sync suite tolerates fence omission (subset not parity), Install.md exists+indexed, text-only payload assumption valid today. Looping design rework.
