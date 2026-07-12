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
updated: 2026-07-12T14:23:28Z
completedSteps: []
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
payload. The installer already delegates through one module (`install.mjs` is a
thin shim over `src/install.js`, which `src/cli.js` also imports), so a single
shared payload inventory can back both the copy step and the hash with no
cross-boundary duplication.

### Related tickets and context

- T20260707T1322Z / T20260707T1318Z: established the dual layout (dev checkout /
  npm-global CLI on PATH is co-located with its assets; the flattened
  `~/.local-board` runtime snapshot is separate) and the `resources/` mirror of
  `plans/`. This design's skew check is exactly the "PATH source vs
  `~/.local-board` snapshot" duality made observable.
- Merge reality (this repo's `plans/local-board.config.jsonc`): `git.autoMerge`
  is `false`, `commitPlanningOnTransition` is `true`. Closeout merges are manual
  `git merge --no-ff` run by the orchestrator on the default checkout; the merge
  subject is `Merge <ticketId>[: summary]` (e.g. `Merge T20260709T1119Z: ...`).
  Planning mutations auto-commit to `plans/` only.

### Decision 1 - bump mechanism (chosen: post-merge `version-bump` command, auto-wired by a git `post-merge` hook)

A new `local-board version-bump` command performs a mainline-side, post-merge
bump. It is wired to run automatically via a `post-merge` git hook that
`local-board init` writes into `<repoGitDir>/hooks/post-merge`; the same command
is also a documented explicit closeout step for clones without the hook. One
command, one bump semantics - the hook is only the trigger.

Why this over the alternatives:

- Rejected (a) bump on the ticket branch during closeout: a `package.json`
  version edit on every branch collides at rebase (`assertTicketBranchUpToDate`
  rebases each branch onto the default before merge). A post-merge bump lands
  once, linearly, on the default branch, and ticket branches never touch
  `package.json`, so there is zero rebase churn.
- Rejected (b) CI-driven bump: `ci.yml` has `permissions: contents: read` and no
  token; committing back requires `contents: write`, a protected-branch push, and
  `[skip ci]` loop guards - heavy and fragile for a dependency-free, local-first
  tool. It also would not help the dev-checkout-on-PATH case, which is exactly
  what the hash check covers instead.
- Rejected (c) release script: manual, i.e. the "manual release chore" the
  acceptance criteria forbid.

The `post-merge` hook fires after any `git merge` that creates a commit (a
`--no-ff` closeout always does) and runs on the checkout where the merge
happened. It does NOT fire on the fast-forward pointer advance that
`fastForwardDefaultBranch` does in other worktrees (`--ff-only`, no hook), so the
bump happens exactly once. The bump commit is a plain commit (not a merge), so it
never re-triggers the hook.

`runVersionBump` self-guards so a misfire is a safe no-op:

1. Resolve the default branch; if the current branch is not it, no-op
   (`verdict: not-on-default`). This makes hook invocations on ticket branches
   inert.
2. If `HEAD`'s subject already starts with `chore: bump version`, no-op
   (idempotency; `verdict: already-bumped`).
3. Compute the merge's changed paths as `git diff --name-only HEAD^1 HEAD`
   (first parent vs merge). If none satisfy `isInstallablePath`, no-op
   (`verdict: no-payload-change`). Planning-only auto-commits and
   planning-only merges touch only `plans/` and never bump - this satisfies AC
   "auto-commits of plans/tickets alone do not trigger a bump".
4. Otherwise bump (see Decision 2), rewrite `package.json`, then
   `git add package.json && git commit -m "chore: bump version to <X.Y.Z> [skip ci]"`.

### Decision 2 - semver mapping (ticket-type mapped, flat-patch fallback)

Four ticket types exist (`epic`, `story`, `task`, `bug` - see `src/tickets.js`).
Mapping: `bug -> patch`, `task | story -> minor`, `epic -> major`, plus an
explicit breaking marker (`breaking: true` in front matter) `-> major`.

The mechanism learns the type from the merge: parse `HEAD`'s subject with
`/^Merge\s+(T\d{8}T\d{4}Z)/`, then `findTicket(root, id)` and read
`frontMatter.type` / `frontMatter.breaking`. If the id cannot be parsed or the
ticket cannot be resolved (front matter is authoritative but the branch may have
archived the file), fall back to a flat `patch` bump rather than skipping - a
payload change always advances the version by at least a patch. This keeps mapped
semver from being brittle: worst case it degrades to patch, and the manual escape
hatch is `local-board version-bump --level <major|minor|patch>` (design adds this
override flag) or an ordinary edit to `package.json` on the default branch.

New pure helpers (unit-testable with no git):

```text
mapBumpLevel(ticketType, { breaking }) -> "major" | "minor" | "patch"
nextVersion(current, level) -> "X.Y.Z"   // increments the part, zeroes lower parts
selectBump({ changedPaths, ticketType, breaking }) -> { bump: boolean, level }
```

### Decision 3 - payload hash (shared inventory, SHA-256, CRLF-normalized)

Single source of truth: extract the installer's copy set into an exported
declarative spec in `src/install.js` and drive BOTH the copy step and the hash
from it, so they cannot drift.

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
  { type: "dir",  source: "resources/prompts" },
  { type: "dir",  source: "resources/templates" },
]
```

`performInstall`'s hardcoded `copyFileSync`/`copyDir` calls are refactored to
iterate `PAYLOAD_SPEC` (preserving the existing `resources/prompts -> prompts`
and `resources/templates -> templates` rename on the install-dir side via a
per-entry `target` field; that rename is install-only and does not affect the
hash, which keys on source-relative paths).

New helpers in `src/install.js`:

```text
collectPayloadEntries(root) -> [{ relPath, absPath }]   // dirs expanded, sorted by relPath
computePayloadHash(root) -> "sha256:<hex>"
isInstallablePath(relPath) -> boolean                    // relPath under any PAYLOAD_SPEC root, or install.mjs
```

Hash construction: a single SHA-256, fed for each entry (in sorted `relPath`
order) with `relPath + "\0" + normalize(content) + "\0"`, where
`normalize = buf.toString("utf8").replace(/\r\n/g, "\n")`. Rationale:

- Algorithm SHA-256 (Node `crypto`, no dependency).
- Ordering: sorted relative POSIX paths, so directory-read order and OS are
  irrelevant.
- Path separators normalized to `/` in `relPath` so Windows `\` vs POSIX `/`
  does not change the digest.
- CRLF: `.gitattributes` enforces `eol=lf` on checkout, but a stale Windows
  working copy can be CRLF (the same hazard `sync-resources.mjs` and the
  `normalizeEol` test helpers already handle). Normalizing `\r\n -> \n` before
  hashing makes the digest identical across line-ending representations.
  Assumption: every payload file is text (current payload is `.md/.js/.mjs/
  .yaml/.yml/.json`); documented, and a binary-extension skip is the noted future
  seam if binaries ever enter the payload.

`writeInstallInfo` gains a `contentHash` argument and writes it as a new key. The
value is `computePayloadHash(SCRIPT_DIR)` - the hash of the source the install
copied from. install-info.json keys are otherwise unchanged; `contentHash` is
purely additive (structural-equivalence preserved).

Note (accepted): `package.json` is in the payload, so a version bump also changes
`contentHash`. Both signals then agree ("snapshot differs from source"); this is
intentional, not a bug.

### Decision 4 - status surface and exit contract (`install --status`)

`local-board install --status [--json]` (a flag on the existing `install`
command, routed through `runInstall`). It recomputes `computePayloadHash(
selfPackageRoot-equivalent SCRIPT_DIR)` from the running CLI's own source and
compares version + hash against the target home's
`<home>/.local-board/install-info.json` snapshot.

Report shape (always printed under `--json`, regardless of exit code, so scripts
read `.verdict`):

```text
{ verdict, skewed, installed: { version, contentHash, installedAt } | null,
  current: { version, contentHash } }
```

Verdicts and exit codes (scriptable):

- `current` -> exit 0 (installed hash == current hash).
- `skewed` -> exit 3 (hash differs, or the snapshot predates this feature and has
  no `contentHash`).
- `not-installed` -> exit 4 (no `install-info.json` under the resolved home).

Exit 2 remains reserved for usage/parse errors. `--status` reuses `resolveHome`
(so `--home` drives the test seam) and reads the single `~/.local-board` snapshot;
per-target skill dirs are irrelevant to the runtime snapshot, so multiple targets
need no special handling. `where --json` additionally gains a `contentHash` field
(cheap, computed from the same helper) so a script can read the current hash
without an install snapshot; the verdict logic stays in `install --status`.

New `src/install.js` internals: `parseArgs` recognizes `--status`; `runInstall`
dispatches `performStatus(args, home, installDir, options)` before
`performInstall`. `printHelp` documents `--status`.

### Decision 5 - skill advisory rewording

Replace the version-skew advisory paragraph in `SKILL.md` (line ~25, prose form)
and `skills/codex/local-board/SKILL.md` (line ~29, numbered "5." form). The team
skills (`SKILL_TEAM.md`, `skills/codex/local-team/SKILL.md`) do NOT carry this
advisory - confirmed by grep - so only these two files change. Keep the
`<<VERSION>>` token (installer renders it). Canonical sentence:

Version-skew check (advisory): this skill was installed from local-board
`v<<VERSION>>`. Two signals indicate the runtime drifted from what these skills
were built against: (1) `local-board --version` prints a version different from
`v<<VERSION>>`, and (2) more reliably, `local-board install --status` reports
`skewed` - it recomputes a content hash over the installed payload and compares
it to the hash recorded at install time, so it catches drift even when the
version number was not bumped (common on dev checkouts). If either fires, warn the
user and suggest re-running `local-board install` to refresh the skills. This is
advisory: warn and continue; never treat it as a hard gate or block the ticket.

(The codex mirror keeps its leading `5. ` list-item prefix.) The advisory
paragraph is not asserted by `skill-usage-sync.test.js` (that suite only compares
the fenced `## CLI Commands` blocks and the `## Delegation` fallback-walk
sections), so this rewording is free of the byte-identical CLI-block constraint.
`version-bump` is deliberately NOT added to the skills' `## CLI Commands` blocks
(it is a closeout/hook command, not an agent-facing verb); the subset test only
requires block names to be a subset of usage, which still holds.

### Affected files

- `src/install.js`: `PAYLOAD_SPEC`; refactor `performInstall` copies to iterate
  it; `collectPayloadEntries`, `computePayloadHash`, `isInstallablePath`;
  `writeInstallInfo` + `contentHash`; `parseArgs` `--status`; `performStatus`;
  `runInstall` dispatch; `printHelp` text.
- `src/version-bump.js` (new): `mapBumpLevel`, `nextVersion`, `selectBump`,
  `isInstallablePath` re-export (imported from install.js to stay single-source),
  `runVersionBump(root, { level, now, ... })`.
- `src/cli.js`: dispatch `version-bump` -> `commandVersionBump(root, args)`;
  `commandWhere` adds `contentHash`; `printUsage` lists `version-bump` and the
  `install --status` flag (expands `usageCommandNames`, harmless to the subset
  test).
- `src/scaffold.js` (`initProject`): write `<gitDir>/hooks/post-merge`
  (executable) invoking `local-board version-bump`; idempotent, skip if a
  non-managed hook already exists.
- `SKILL.md`, `skills/codex/local-board/SKILL.md`: advisory rewording.
- Docs: `README.md` install section, `docs/Install.md`, `docs/Workflow.md`
  closeout, `memory-bank/techContext.md`.

### Test plan

- `test/version-bump.test.js` (new): `mapBumpLevel` for each type + breaking;
  `nextVersion` increments and zeroes lower parts (`1.2.3` minor -> `1.3.0`,
  major -> `2.0.0`); `selectBump` no-op when `changedPaths` are all
  `plans/...` (non-installable) and bump when any payload path changed;
  `runVersionBump` on a throwaway git repo: merge touching `src/` bumps and
  commits `chore: bump version...`, merge touching only `plans/` is a no-op,
  not-on-default is a no-op, second run on a bump HEAD is a no-op (idempotent),
  unresolved ticket id falls back to patch.
- `test/install.test.js` (extend): `install-info.json` carries `contentHash`
  matching `^sha256:[0-9a-f]{64}$`; determinism (two installs from the same
  source produce the same hash); CRLF insensitivity (a packaged copy with a
  payload file rewritten to CRLF hashes identically to the LF copy);
  `install --status` -> `current`/exit 0 after a fresh install; touch one
  installed-source payload file (in a packaged copy) -> `skewed`/exit 3;
  no `install-info.json` -> `not-installed`/exit 4; `--status --json` shape and
  a pre-feature snapshot (no `contentHash`) -> `skewed`. Existing install cases
  are unaffected (additive key only).
- `test/cli.test.js` (extend): `version-bump` dispatch + `--json` shape; usage
  lists it; `where --json` includes `contentHash`.
- Regression: run the FULL suite (`node --test`) - skills/prompts are production
  artifacts (AGENTS.md). No `plans/prompts` edit here, so `npm run sync-resources`
  is not required; the advisory edits are to verbatim-shipped skill files.

### Docs

- `README.md`: note `contentHash` in `install-info.json` and `install --status`.
- `docs/Install.md`: `contentHash` field, `install --status` verdicts + exit
  codes (0/3/4), and the post-merge version-bump hook `init` installs.
- `docs/Workflow.md`: closeout section - the post-merge bump step / hook.
- `memory-bank/techContext.md`: versioning mechanism + hash-skew command.
- No new `docs/*.md` file, so the README Documentation Index is unchanged.

### Risks and open questions

- Post-merge hook not present on a clone -> the bump is skipped; the hash-skew
  `install --status` is the safety net (matches AC: "either the version differs
  or ... `install --status` reports skew"), and the command is runnable manually.
- Manual merge subject not matching `Merge <ticketId>` -> flat patch fallback
  (acceptable, documented escape hatch for major/minor).
- `package.json` (with version) is in the hash set, so a bump also flips
  `contentHash`; intentional (both signals agree), called out to avoid a false
  "bug" reading in review.
- CRLF normalization assumes text-only payload; true today, with a
  binary-extension skip as the noted future seam.
- `init` writing to `.git/hooks` is a new responsibility for `initProject`; kept
  idempotent and skip-if-user-hook-present to avoid clobbering. If the reviewer
  prefers to keep `init` purely `plans/`-scoped, the fallback is documenting the
  hook as one-time manual setup while keeping `version-bump` as the mandated
  closeout step - the command semantics are identical either way.

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
