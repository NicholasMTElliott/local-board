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
updated: 2026-07-12T15:10:18Z
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
payload. Reworked through design reviews r1-r3 - the git-hook mechanism is dropped
entirely; the bump rides an existing deterministic closeout CLI op (`fast-forward`)
behind an opt-in, boolean-validated config gate; idempotence is a single-owner,
CAS-written marker ref that points at the resulting bump commit and is tested by
ANCESTRY (closing the r3 same-clone double-bump); install metadata is per-target
with a FOOTPRINT-driven reconciliation over current-and-legacy dirs that
re-validates every entry against disk (closing r3 false-current); and the
range/recovery, config-validation, null-hash, and flag-off-shape contracts are
pinned down below. `install.mjs` is a thin shim
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
- Validation (Medium 2): `git` keys are currently unvalidated in `loadConfig`.
  Add a `normalizeGit(merged)` following the exact `normalizeWorktrees` idiom
  (`src/config.js:694`) - called in `loadConfig`'s normalize `try` block - that
  throws `git.autoVersionBump must be a boolean; got <JSON>` for a non-boolean and
  otherwise leaves the value as-is (scoped to this new key so existing untyped git
  keys are untouched). Documented plainly in Install.md/Workflow.md: setting
  `git.autoVersionBump: true` - including by blind-copying another repo's config -
  AUTHORIZES `local-board` to rewrite and commit THIS repo's own `package.json`
  version on every payload-changing `fast-forward`; leave it `false`/absent unless
  this repo IS the package being versioned.
- Automatic-in-workflow (resolves High 2): with the flag on, every `fast-forward`
  reconciliation that advanced the default branch over installable-payload
  changes performs the bump - no reliance on hooks, no per-clone install, no
  contract edit. Fresh clones inherit it because the flag lives in the committed
  config, not in `.git/`.
- Kept for manual use: a standalone `local-board version-bump` command (contract
  in Decision 5) for one-off/major/minor overrides and recovery.

Bump gating inside `fastForwardDefaultBranch` (ordered so a non-opted repo is
byte-identical to today):

1. If `git.autoVersionBump !== true` (the default), return WITHOUT any
   `versionBump` key at all (Medium 5: the flag-off return object is unchanged;
   the key exists ONLY when the flag is on). Every step below is flag-on only.
2. If `advanced` is false (`previousHead === newHead`), return `versionBump:
   { bumped: false, reason: "not-advanced" }`.
3. `git diff --name-only <previousHead> <newHead>`; if no path satisfies
   `isInstallablePath` (Decision 3), `versionBump: { bumped: false, reason:
   "no-payload-change" }` (exactly the "planning-only auto-commits do not bump"
   criterion - `plans/` is not installable).
4. Idempotence via a single-owner processed-head marker ref
   `refs/local-board/version-bump-head`, NOT the HEAD subject. "Already processed"
   is tested by ANCESTRY, not equality or subject match. Read the marker value
   `Mold` at entry; if `<newHead>` is an ancestor-or-equal of `Mold`
   (`git merge-base --is-ancestor <newHead> Mold`), no-op
   (`reason: "already-bumped"`). Otherwise call `runVersionBump(root, { range:
   { previousHead, newHead }, config })` (explicit range), which determines the
   level (Decision 2), rewrites `package.json`, and commits ONLY `package.json` as
   commit `B` (parent `<newHead>`).

Marker advance = compare-and-swap to B, the ONE marker owner (this is the r3
double-bump fix). After the commit succeeds, advance the marker to `B` (the bump
commit, now HEAD), NOT to the merge tip `<newHead>`. Advancing to the merge tip
`M` was the r3 defect: a later no-range `version-bump` then resolved `M..HEAD`,
saw B's own `package.json` change, and fallback-patch-bumped AGAIN on the
originating clone. Because `B` is a descendant of `M`, a marker at `B` covers BOTH
the processed tip `M` and the resulting bump `B` under the ancestry test - no
subject matching, and the same-clone re-bump is closed. The write is
`git update-ref refs/local-board/version-bump-head B <Mold>` - a compare-and-swap
against the value read at entry (for first creation the old-value is the empty
string, asserting the ref is absent) - so this single code path is the sole owner
and a concurrent mover aborts safely.

Recovery soundness: `fast-forward` has already `reset --hard`ed the tree to
`<newHead>`, so a SECOND `fast-forward` run computes `advanced: false` and cannot
recover a failed range. On a commit failure `runVersionBump` rolls the
`package.json` write back (Decision 5), leaves the marker UNMOVED, and
`fast-forward` surfaces the exact failed range with the recovery instruction
`local-board version-bump --range <previousHead>..<newHead>`. Recovery runs
through the manual command with that explicit range, never a `fast-forward`
re-run.

`fastForwardDefaultBranch` includes `versionBump` ONLY when the flag is on
(key omitted otherwise); `commandFastForward` surfaces it in text/`--json` when
present. The pure/range logic lives in `src/version-bump.js`; `worktrees.js` only
calls it and moves the marker ref.

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
while the Claude skill dir stayed stale ("false-current"). r2's naive merge
re-created the defect for LEGACY records: a pre-feature `install-info.json` has no
`targets` map, so seeding only the selected target left stale Claude untracked and
global read `current` again. Fix per the reviewer: DISCOVER-then-seed migration.

`writeInstallInfo` is changed to MERGE, not overwrite, and adds a `targets` map.
Existing top-level keys are unchanged; `contentHash` and `targets` are additive
(structural-equivalence preserved):

```text
{
  ...existing keys (name, installedAt, installDir, scriptPath, nodeVersion,
     version, skillName, teamSkillName, claudeAgents) unchanged...,
  contentHash: "sha256:<hex>",          // additive: the snapshot's payload hash (last install)
  targets: {                            // additive: per-target skew state
    claude: { version, contentHash, installedAt },
    codex:  { version|null, contentHash: "sha256:..."|null, installedAt|null }
  }
}
```

Migration/reconciliation rule (single shared helper used by BOTH the install
write and the `--status` read, so they cannot diverge). `reconcileTargets(
existing, home)` is FOOTPRINT-DRIVEN and re-validates every entry against disk on
each call:

1. Compute the footprint set: for each target in `buildTargets(home)`, it "has a
   footprint" when ANY of its current OR legacy skill/team directories exists -
   `skillDir`, `teamSkillDir`, every entry of `legacySkillDirs`, and every entry
   of `legacyTeamSkillDirs` (r3 fix (a): legacy-dir-only and team-only installs
   were previously undiscovered because only `skillDir`/`teamSkillDir` were
   probed).
2. Build the result keyed ONLY by targets that have a footprint:
   - if `existing.targets[id]` is present, retain its stored
     `{ version, contentHash, installedAt }`;
   - else seed `{ version: existing.version ?? null, contentHash: null,
     installedAt: existing.installedAt ?? null }` (`contentHash: null` = UNKNOWN,
     never `current` per Decision 5 - captures a legacy stale install).
3. Re-validation (r3 fix (b)): any `existing.targets` entry whose id has NO
   footprint is DROPPED - a target whose directories were deleted never lingers as
   `current` on a stored hash.
4. (Install write only) overwrite the just-installed targets with their fresh
   `{ version, contentHash, installedAt }` (their dirs now exist, so they are in
   the footprint set).

Empty-map verdict (r3 fix (c)): when the reconciled map is empty (no target has
any current-or-legacy footprint), the state is `not-installed` - even if an
`install-info.json` file exists - never a vacuous `current`.

So a legacy record + `install --target=codex`: step 2 seeds `targets.claude`
(discovered via its skill/legacy dirs) with `contentHash: null`, step 4 writes a
fresh `targets.codex`; `--status` reports Claude `skewed`, codex `current`, GLOBAL
`skewed`. A deleted Claude install (fix (b)) drops out entirely and can never
report `current`.

### Decision 5 - status surface, `version-bump` command, and exit contracts (resolves Medium 7)

`install --status [--json]` (a flag on `install`, via `runInstall` ->
`performStatus`). Recomputes `computePayloadHash(SCRIPT_DIR)` (current source),
runs the shared `reconcileTargets(existing, home)` (Decision 4) against
`<home>/.local-board/install-info.json`, and derives a per-target then a global
worst-of verdict.

```text
{
  verdict,                       // "current" | "skewed" | "not-installed" | "indeterminate"
  skewed,                        // boolean (verdict === "skewed")
  current: { version, contentHash },   // contentHash may be null (see below)
  targets: {                     // one entry per reconciled target
    <id>: { version, contentHash, installedAt, verdict }
  }
}
```

- Current-hash null (Medium 4): if `computePayloadHash(SCRIPT_DIR)` returns `null`
  (a non-source/flattened layout - not reachable for a correctly on-PATH CLI, but
  handled explicitly), the command does NOT compare null==null. It returns global
  `verdict: "indeterminate"`, exit `5`, and message "cannot determine current
  payload hash: not a source layout"; no target is ever reported `current`.
- Per-target verdict (current hash is a real digest): `current` ONLY when the
  target's recorded `contentHash` is a non-null digest EQUAL to `current`;
  otherwise `skewed` (this includes a null/absent recorded hash - "unknown is
  never current", covering the discover-then-seed legacy entries).
- Global verdict (order matters):
  - `not-installed` (exit 4) when `reconcileTargets` returns an EMPTY map (no
    target has any current-or-legacy footprint) - whether or not an
    `install-info.json` file exists (no vacuous `current`).
  - else `indeterminate` (exit 5) when the current source hash is null.
  - else `skewed` (exit 3) when any reconciled target is `skewed` (incl. legacy
    null-hash entries).
  - else `current` (exit 0) when every reconciled target is `current`.
- Exit codes (scriptable; 3/4 verified clean by review): `0` current, `3` skewed,
  `4` not-installed, `5` indeterminate. `2` stays reserved for usage/parse errors.
  `--json` always prints the report regardless of exit code. `--status` reuses
  `resolveHome` (so `--home` is the test seam).

`where --json` additionally gains `contentHash` (source-only per Decision 3;
`null` on a flattened layout, which is an explicit, defined value there).

`local-board version-bump` command contract (Medium 7 + Medium 3 - fully
specified):

- Usage: `local-board [--root <path>] version-bump [--level major|minor|patch]
  [--range <a>..<b>] [--allow-main-root] [--json]`. Root-scoped mutation on the
  default checkout. Shares `runVersionBump(root, { range?, level?, config, now })`
  with `fast-forward`.
- Range resolution (first-run base): the level is derived by scanning merge
  subjects in `base..tip`:
  - `--range <a>..<b>` supplies base and tip explicitly (the recovery path
    `fast-forward` prints after a commit failure).
  - Else `tip` = `HEAD` and `base` = the marker ref if it exists (it points at the
    last bump commit `B`, so a no-range run immediately after an auto bump resolves
    `B..HEAD` = empty and no-ops - the same-clone regression guard); else the last
    `chore: bump version` commit on the default branch (fresh clones with no marker
    are safe this way - they detect `B` and do not re-bump); else (genuine first
    run: no marker, no prior bump) the root commit `git rev-list --max-parents=0
    HEAD`.
  - `--level` forces the level and skips the range scan and ticket lookup.
- JSON shape: `{ bumped: boolean, from: "X.Y.Z", to: "X.Y.Z"|null,
  level: "major"|"minor"|"patch"|null, reason }` where `reason` is one of
  `bumped | not-enabled | not-advanced | no-payload-change | not-on-default |
  dirty-package-json | already-bumped`.
- Exit codes: `0` on success (bump or intentional no-op); `2` on precondition/
  usage error.
- Idempotence (marker ancestry, subject-free): no-op (`reason: already-bumped`)
  when the resolved `tip` is an ancestor-or-equal of the marker
  (`git merge-base --is-ancestor <tip> <marker>`), so both the processed merge tip
  `M` and the resulting bump commit `B` are recognized as done without any
  commit-subject match. A successful manual bump advances the marker to its own new
  bump commit by the same `git update-ref <ref> <new> <oldvalue>` compare-and-swap
  that the automatic path uses (single owner).
- Dirty/partial-failure recovery (never double-increment, never sweep user edits):
  1. Refuse (`reason: dirty-package-json`, exit 2, no write) if `package.json`
     has uncommitted changes at entry - a user's in-flight edit is never folded
     into a bump commit.
  2. Stage and commit ONLY `package.json` by explicit pathspec
     (`git commit -- package.json`), never `git add -A`.
  3. On a successful commit, advance the marker ref to the resulting bump commit
     `B` (via the same single shared `git update-ref <ref> B <oldvalue>` CAS
     owner). If the commit fails after the file write, restore `package.json` to
     its pre-write bytes and do NOT advance the marker, leaving a clean tree;
     because the target version is a
     pure function of the (explicit or re-resolvable) range and the marker did not
     move, a re-run recomputes the SAME target rather than incrementing again.

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
  `isInstallablePath`; `reconcileTargets(existing, home)` (footprint-driven -
  probes current AND legacy skill/team dirs, re-validates and drops entries with no
  footprint; shared by write and status); `writeInstallInfo` merge + `contentHash`
  + `targets`; `parseArgs`
  `--status`; `performStatus` (per-target, worst-verdict, indeterminate/null
  handling); `runInstall` dispatch; `printHelp`.
- `src/version-bump.js` (new): `mapBumpLevel`, `maxLevel`, `nextVersion`,
  `selectBump`, `MERGE_SUBJECT_RE`, `runVersionBump(root, { range, level, config,
  now })` (accepts the explicit `{ previousHead, newHead }` range; imports
  `isInstallablePath`/`computePayloadHash` from install.js to stay single-source).
- `src/worktrees.js`: `fastForwardDefaultBranch` calls `runVersionBump` under the
  `git.autoVersionBump` gate with the computed `{ previousHead, newHead }` range;
  compare-and-swap-advances the `refs/local-board/version-bump-head` marker to the
  RESULTING bump commit `B` (not the merge tip) on success, via
  `git update-ref <ref> B <oldvalue>`; includes `versionBump` in its return ONLY
  when the flag is on (key omitted otherwise). `runVersionBump`/the marker helper
  are the single owner of the ref.
- `src/config.js`: add `git.autoVersionBump: false` to `DEFAULT_CONFIG` and the
  scaffolded config template + comment; add `normalizeGit(merged)` (boolean check
  on `autoVersionBump`, `normalizeWorktrees` idiom) to `loadConfig`'s normalize
  block.
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
  unresolved id falls back to patch; not-on-default no-op; `--range <a>..<b>`
  first-run base and explicit-range recovery; first-run base falls back to the
  root commit when no marker and no prior bump exist; marker contract (ancestry,
  subject-free): after an auto bump the marker points at the bump commit `B` via
  `update-ref` compare-and-swap, a no-range `version-bump` on the SAME clone
  immediately afterward is a no-op (the r3 double-bump regression test), a FRESH
  clone with no marker does NOT re-bump the already-bumped range (detects `B` as
  the last bump commit - the fresh-clone regression test), an unrelated commit
  whose subject starts `chore: bump version` does NOT falsely suppress a real bump,
  and a concurrent marker move fails the CAS safely; dirty `package.json` refused
  (no write); commit-failure path restores `package.json` AND does not advance the
  marker (a re-run recomputes the same target - no double increment); `--level
  major` forces major and skips the range scan; user edits to other files are
  never in the bump commit.
- `test/config.test.js` (extend): `git.autoVersionBump` defaults `false`; a
  non-boolean value throws the `normalizeGit` message; `true` loads unchanged.
- `test/worktrees` (fast-forward suite): flag absent/`false` => return object has
  NO `versionBump` key (byte-identical flag-off shape regression - Medium 5); flag
  `true` + advanced over `src/` => bump commit + marker advanced + `versionBump`
  present; flag `true` but not advanced / only `plans/` => `versionBump.bumped
  false` with the right reason, no commit; non-git and generic-consumer repos
  (flag default false) => never bump.
- `test/install.test.js` (extend): `install-info.json` carries `contentHash`
  matching `^sha256:[0-9a-f]{64}$` and a `targets` map; determinism (two installs
  same source => same hash); CRLF insensitivity (packaged copy with a payload file
  rewritten to CRLF hashes identically to LF); MULTI-TARGET staleness: install
  `claude`, mutate a payload file in a packaged source copy, install `--target=
  codex` from the mutated copy => `install --status` reports `claude` skewed,
  `codex` current, GLOBAL `skewed`/exit 3; LEGACY MIGRATION: hand-write a
  pre-feature `install-info.json` (no `targets`, no `contentHash`) plus an existing
  Claude skill dir, then `install --target=codex` => `reconcileTargets` seeds
  `targets.claude` with `contentHash: null`, `--status` reports Claude `skewed`,
  codex `current`, GLOBAL `skewed`/exit 3 (the r2 regression guard); FOOTPRINT
  reconciliation (r3): legacy-DIRECTORY-only install (only a `legacySkillDirs`
  path such as `local-board-orchestrator` on disk, no current `skillDir`) is
  discovered and seeded null => target `skewed`; DELETED-target (stored
  `targets.claude` with a real hash but all its skill/team/legacy dirs removed) is
  DROPPED from the reconciled map and never reports `current`; TEAM-only footprint
  (only `teamSkillDir` or a `legacyTeamSkillDirs` path exists) is discovered;
  install-info-with-NO-directories (file present, zero footprints) => reconciled map
  empty => `not-installed`/exit 4 (never a vacuous `current`); fresh install =>
  `current`/exit 0; truly absent (no `install-info.json`, no target dirs) =>
  `not-installed`/exit 4; current-hash-null (flattened layout seam) => verdict
  `indeterminate`/exit 5, no target `current`; `computePayloadHash` on a flattened
  layout returns `null` and `where --json` emits `contentHash: null`.
- `test/cli.test.js` (extend): `version-bump` dispatch + `--json` shape + exit
  codes + `--range`/`--level`; usage lists `version-bump`; `fast-forward --json`
  includes `versionBump` only when the flag is on; `where --json` includes
  `contentHash`.
- Note: r1 hook-specific test gaps (user hooks, `core.hooksPath`, fresh-clone hook
  absence) are MOOT - no hook is installed.
- Regression: FULL `node --test` (skills/prompts are production artifacts per
  AGENTS.md). No `plans/prompts` edit here, so `npm run sync-resources` is not
  required; advisory edits are to verbatim-shipped skill files.

### Docs

- `README.md`: `contentHash`/`targets` in `install-info.json`; `install --status`.
- `docs/Install.md`: `contentHash`, per-target `targets`, legacy-record
  migration, `install --status` verdicts + exit codes (0/3/4/5).
- `docs/Workflow.md`: closeout - `fast-forward` auto-bumps when
  `git.autoVersionBump` is on; the plain statement that enabling the flag (incl.
  by blind-copying a config) authorizes bumping this repo's own `package.json`;
  `version-bump --level`/`--range` escape hatch and commit-failure recovery; the
  `autoMerge: true` limitation.
- `memory-bank/techContext.md`: versioning mechanism (fast-forward + config gate)
  and hash-skew command.
- No new `docs/*.md`, so the README Documentation Index is unchanged.

### Risks and open questions

- `git.autoVersionBump` default `false` is the sole safety gate for consumers;
  correct by construction (opt-in, committed config, no `.git/` dependency),
  boolean-validated by `normalizeGit`, and regression-guarded by the flag-off
  fast-forward tests (which assert the `versionBump` key is absent).
- The `refs/local-board/version-bump-head` marker ref (single-owner, CAS-written,
  pointing at the bump commit `B`) is the idempotence + recovery anchor and is what
  closes the r3 same-clone double-bump (marker at `B` covers both `M` and `B` by
  ancestry). Residual risk: if a user deletes the ref, a subsequent run re-derives
  the base from the last `chore: bump version` commit, so a deleted marker degrades
  to at most one redundant no-op, not an unbounded loop. Documented.
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

- 2026-07-12T14:41:16Z: Completed design via claude-subagent:local-board-designer@opus: Rework r2: git hooks dropped; bump rides fastForwardDefaultBranch gated by new git.autoVersionBump config opt-in (default false - consumer repos inert, local-board opts in via committed config; fresh clones automatic; no skill/fence edits); per-target install-info targets map (version+hash+installedAt, merge-not-overwrite) with worst-of global verdict; shared ESBT ticket grammar over the advanced range with max-level reduction; breaking marker dropped (epic->major + --level escape); PAYLOAD_SPEC unifies copy=hash=bump-trigger with install.mjs removed; hash source-layout-only (null on flattened snapshot); full version-bump contract (JSON shape, exit 0/2, dirty-refuse, pathspec-only commit, rollback on commit failure); test plan expanded incl. multi-target staleness and flag-off regression.

- 2026-07-12T14:49:56Z: Design review r2 (codex-task:read-only@gpt-5.6-sol, xhigh): FAIL. 1) [High] Legacy install-info migration recreates the multi-target false-current defect: a pre-feature record has no targets map, so install --target=codex seeds only codex and stale claude goes untracked -> global current; design also self-contradicts (no targets = not-installed at L280 vs skewed in test plan L398-400). Fix: migrate by discovering existing target directories, seed legacy entries with contentHash null, then update selected targets; add a stale-claude + --target=codex migration test. 2) [Med] git.autoVersionBump needs normalization/validation (boolean check - git keys currently unvalidated) and an explicit statement that blind-copying a config with true authorizes bumping that consumer repo. 3) [Med] Range/retry contracts incomplete: runVersionBump signature lacks the previousHead..newHead range it names; manual mode lacks a first-run base; after commit-failure the checkout is already at newHead so rerunning fast-forward yields advanced:false (recovery claim broken) - pass the range explicitly, define first-run base, persist a processed-head key or route recovery through the manual command; HEAD-subject-only already-bumped key can falsely suppress unrelated same-subject commits. 4) [Med] contentHash null semantics undefined for install --status (null-vs-null could read current); define an explicit verdict/error when current hash is null. 5) [Med] fastForwardDefaultBranch adding versionBump: null contradicts the byte-identical flag-off regression - omit the key when flag absent/false. Looping design rework r3.

- 2026-07-12T14:55:23Z: Completed design via claude-subagent:local-board-designer@opus: Rework r3: shared reconcileTargets(existing, home) seeds legacy entries with contentHash null from on-disk discovery (never current) used by both write and status paths, contradiction reconciled (no info + no dirs = not-installed; legacy + dirs = skewed); runVersionBump takes explicit range, idempotence via refs/local-board/version-bump-head marker ref, first-run base marker->last-bump->root, commit-failure rollback with version-bump --range recovery; normalizeGit boolean validation per normalizeWorktrees idiom + blind-copy consequence documented; null current-hash = indeterminate verdict exit 5; versionBump key omitted when flag off (regression test asserts absence).

- 2026-07-12T15:01:04Z: Design review r3 (codex-task:read-only@gpt-5.6-sol, xhigh): FAIL. 1) [High] Marker/double-bump: auto bump advances refs/local-board/version-bump-head to merge tip M while creating bump commit B; a subsequent no-range version-bump resolves M..B, sees the package.json change, and applies a fallback patch bump on the originating clone (fresh clones are safe via last-bump-commit detection; the originating clone is not). Fix: single marker owner, update-ref with expected-old value, marker/range contract must recognize both processed tip M and bump commit B without relying on commit subject; add local post-auto-bump and fresh-clone regression tests. 2) [High] Footprint reconciliation still permits false-current: discovery names only skillDir/teamSkillDir but buildTargets also defines legacySkillDirs/legacyTeamSkillDirs (legacy-dir-only installs undiscovered); retained target entries never re-validated against disk (deleted target stays current on stored hash); install-info with no entries and no dirs has no defined verdict (vacuous current). Fix: footprint = existence of ANY current or legacy skill/team dir; validate retained entries against footprints; define the empty-reconciled-map verdict; add legacy-dir-only, deleted-target, team-only, and no-directory migration tests. Verified consistent: normalizeGit + blind-copy warning, indeterminate exit 5, flag-off key omission, stale-mechanism sweep clean. Rework r4 = final within declared budget.

- 2026-07-12T15:06:31Z: Completed design via claude-subagent:local-board-designer@opus: Rework r4: marker single-owner CAS update-ref to bump commit B (not tip M) with ancestry-based already-processed (merge-base --is-ancestor tip marker) covering both M and B - no subject matching, no same-clone re-bump; no-range base marker->last-bump->root; commit-failure leaves marker unmoved with --range recovery; footprint = ANY current or legacy skill/team dir, retained entries re-validated per reconcile (deleted target drops), empty reconciled map = not-installed; new tests incl. same-clone no-op, fresh-clone no-re-bump, CAS-concurrent-fail, legacy-dir-only, deleted-target, team-only, no-directories.

- 2026-07-12T15:09:33Z: Design review r4 (codex-task:read-only@gpt-5.6-sol, xhigh; final budget round): FAIL on a single editorial contradiction - Decision 5 L416 says advance marker to tip while L403-409 correctly require bump commit B; implementing L416 literally recreates the r3 double-bump. Reviewer prescribed the exact fix (replace tip with the resulting bump commit B, one shared CAS owner) and verified EVERYTHING else: ancestry operand direction correct, same-clone no-op and fresh-clone traces pass, first-write CAS semantics correct, footprint/verdict rules fully pass with all four migration tests present, exit codes coherent. Orchestrator disposition: one-word editorial fix applied per prescription; proceeding to implementation without a fifth round (the authoritative contract lines already state the correct behavior; no open design judgment remains).
