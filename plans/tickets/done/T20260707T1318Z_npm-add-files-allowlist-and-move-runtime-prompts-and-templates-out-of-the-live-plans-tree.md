---
id: T20260707T1318Z
type: task
status: done
priority: P1
parent: null
children: []
blockedBy: []
blocks: [T20260707T1320Z]
branch: local-board/T20260707T1318Z-npm-add-files-allowlist-and-move-runtime-prompts-and-templates-out-of-the-live-plans-tree
estimate: 4
estimateBasis: bootstrap
workStartedAt: 2026-07-07T14:13:29Z
workCompletedAt: 2026-07-07T14:26:39Z
created: 2026-07-07T13:18:26Z
updated: 2026-07-07T14:26:39Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "implement:claude-subagent:local-board-implementer@sonnet", review:codex-task:read-only, "test:claude-subagent:local-board-tester@sonnet", document:codex-task:workspace-write]
routingApprovals: []
---
# npm: add files allowlist and move runtime prompts and templates out of the live plans tree

## Requirement

`package.json` has no `files` field, so `npm publish`/`npm pack` today would ship the repo's live board: `plans/tickets/`, `memory-bank/`, `.local-board/`, `docs/`, `test/`, plus stray dirs. Additionally `install.mjs:135-136` copies `plans/prompts` and `plans/templates` as runtime assets — conflating the package's runtime resources with this repo's own planning artifacts.

Fix: move the runtime prompt/template copies out of the live `plans/` tree into a `resources/` directory that is unambiguously package content, update `install.mjs` and any CLI fallback-path logic, and add a `files` allowlist (`bin`, `src`, `resources`, `install.mjs`, `SKILL.md`, `SKILL_TEAM.md`, `agents`, `skills`). Also add `repository`, `description` polish, and `keywords` to package.json.

Acceptance: `npm pack --dry-run` lists only intended files; no live tickets, memory-bank, or test content in the tarball; installer and CLI resolve prompts/templates from the new location.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Technical Design

### Summary

Two independent packaging defects, fixed together:

1. `package.json` has no `files` allowlist, so `npm pack`/`npm publish` would ship the entire repo working tree — `plans/tickets/`, `memory-bank/`, `.local-board/`, `docs/`, `test/`, `tests/`, `local_board/`, plus config — as the published tarball.
2. `install.mjs:135-136` reads this repo's live planning tree (`plans/prompts`, `plans/templates`) as if it were package runtime content, conflating package resources with this repo's own board artifacts.

Fix: introduce a `resources/` directory that is unambiguously package content (a mirror of the default prompt/template set), repoint `install.mjs` at it, add a `files` allowlist, and polish `package.json` metadata. A drift guard keeps `resources/` in sync with this repo's own `plans/prompts` + `plans/templates`.

### Key finding that narrows scope: there is no CLI fallback-path logic

Runtime prompt/template resolution is **always relative to the project worktree root**, never to the install dir:

- `src/config.js` `actionPrompts` and `optionalSteps[].prompt` are `plans/prompts/...` strings.
- `src/cli.js:848` resolves optional-step prompts via `path.resolve(root, entry.prompt)`.
- `src/cli.js:779` hardcodes `path.resolve(root, "plans", "prompts", "steps", "gate-check.md")`.

A repo-wide search for `.local-board` / `INSTALL_DIR` / `homedir` in `src/` returns nothing runtime-facing. The only consumer of the installed `~/.local-board/prompts` and `~/.local-board/templates` copies is... nothing in the CLI. Those copies are written by `install.mjs` but never read back by `local-board`. Each consuming project instead gets its own `plans/prompts` from `init` scaffolding (inline strings in `src/scaffold.js`).

Consequence: **no CLI change is required.** The task brief's "any CLI fallback-path logic" does not exist. This ticket is purely packaging + installer asset relocation. The installed `~/.local-board/prompts`/`templates` remain vestigial reference assets (removing them entirely is out of scope and reversible-later).

### Design decision 1: `resources/` is canonical package content; `plans/prompts` stays as this repo's project-local board

This repo's own board must keep a working `plans/prompts` + `plans/templates`:

- `src/cli.js:779` hardcodes `plans/prompts/steps/gate-check.md` relative to root.
- `plans/local-board.config.jsonc` action/optional-step prompts point at `plans/prompts/...`.
- Project-local prompts are authoritative by design (systemPatterns).

So `plans/` cannot be deleted for this repo. But the `files` allowlist deliberately excludes `plans/`, which means `install.mjs` (running from the packed tarball) can no longer read `SCRIPT_DIR/plans/prompts`. Therefore the shipped default prompt/template set must live in an allowlisted directory.

Chosen layout:

- `resources/prompts/**` and `resources/templates/**` — the packaged default set, mirroring the current `plans/prompts` + `plans/templates` trees.
- `plans/prompts` + `plans/templates` — unchanged; this repo's own dogfooded board, authoritative for this repo's runtime.

Rejected alternative — "repo dogfoods directly from `resources/`" (symlink `plans/prompts` → `resources/`, or repoint config/gate-check at `resources/`): rejected because (a) `gate-check` hardcodes `plans/prompts`, (b) config would diverge from what `init` gives consuming projects (`plans/prompts`), (c) symlinks are fragile on Windows (this repo's primary platform). Keeping `plans/prompts` as the runtime path preserves parity with every consuming project and requires zero CLI change.

**Drift risk + mitigation.** With two committed copies (`plans/prompts` and `resources/prompts`), they can drift. Mitigation: a synchronization guard.

- Designate `plans/prompts` + `plans/templates` as the human-edited source of truth (that is where this repo's board actually runs, and where authors already edit).
- `resources/` is a committed mirror, regenerated by a small `sync-resources` npm script (recursive copy `plans/prompts`→`resources/prompts`, `plans/templates`→`resources/templates`).
- Add a test (`test/resources-sync.test.js`) that walks both trees and asserts byte-identical file sets + contents; it fails if `resources/` is stale. This makes drift a red build rather than a silent shipping bug. Optionally also wire a `--check` variant into `npm run check`, but the `node --test` guard is sufficient and preferred (avoids a second code path).

### Design decision 2: leave `src/scaffold.js` untouched

`scaffold.js` embeds init file contents as inline strings and writes them to a new project's `plans/prompts`. It is tempting to make `init` read from `resources/` instead (eliminating the duplicated strings and closing the gap that scaffold omits `gate-check.md` and the optional-steps prompts). **Do not do that here.** The missing-scaffold-prompts problem is owned by ticket B20260707T1320Z; folding it in would collide scope and expand risk/blast radius. This ticket keeps `scaffold.js` byte-for-byte unchanged. Note as a follow-up that once `resources/` exists, `init` could source from it — coordinate with B20260707T1320Z.

### Implementation approach

1. Create `resources/prompts/**` and `resources/templates/**` by copying the current `plans/prompts` and `plans/templates` trees verbatim (roles, steps incl. `gate-check.md`, optional-steps, and `templates/ticket.md`).
2. `install.mjs`: change the two runtime-asset copies (lines 135-136) from
   `copyDir(join("plans", "prompts"), "prompts")` / `copyDir(join("plans", "templates"), "templates")`
   to source from `resources/` — `copyDir(join("resources", "prompts"), "prompts")` and `copyDir(join("resources", "templates"), "templates")`. Target layout under `~/.local-board/` is unchanged (`~/.local-board/prompts`, `~/.local-board/templates`), so installed-layout behavior is identical — fully reversible.
3. `package.json`:
   - Add `"files"`: `["bin", "src", "resources", "install.mjs", "SKILL.md", "SKILL_TEAM.md", "agents", "skills"]`. (npm always includes `package.json`, `README.md`, and `LICENSE` automatically — `install.mjs` copies `README.md` and `SKILL.md` into the install dir, so both must be in the tarball; `README.md` is auto-included, the rest are listed.)
   - Add `"repository": { "type": "git", "url": "git+https://github.com/NicholasMTElliott/local-board.git" }`.
   - Add `"keywords"` (e.g. `["kanban", "tickets", "board", "ai-agents", "workflow", "orchestration", "cli", "markdown"]`).
   - Polish `"description"` if desired (current one is serviceable; keep change minimal).
   - Add `"sync-resources"` script (`node ./scripts/sync-resources.mjs` or inline `cpSync` helper) — small mirror generator used by maintainers.
4. Add `test/resources-sync.test.js` — the drift guard described above.
5. Docs: if a new `docs/*.md` is added, update the README Documentation Index (per AGENTS.md). Likely just a short note in README/packaging docs that `resources/` is packaged default assets and `plans/prompts` is the dogfooded copy; touch `memory-bank/systemPatterns.md` or `techContext.md` only if it records the packaging layout.

### Affected files/modules

- `package.json` — add `files`, `repository`, `keywords`, description polish, `sync-resources` script.
- `install.mjs` — repoint two `copyDir` calls (lines 135-136) at `resources/`.
- `resources/prompts/**`, `resources/templates/**` — new, mirror of `plans/`.
- `scripts/sync-resources.mjs` — new (optional but recommended), mirror generator.
- `test/resources-sync.test.js` — new drift guard.
- `src/cli.js`, `src/config.js`, `src/scaffold.js` — **no change** (documented rationale above).
- README / memory-bank — doc-index + packaging note only if a doc file is added.

### Risks

- **Drift between `resources/` and `plans/prompts`.** Highest-likelihood regression. Mitigated by the sync test; without it, shipped defaults silently rot. Must land the test in the same change.
- **Under-broad `files` allowlist ships a broken package.** If a needed asset is omitted, `install.mjs` throws at install time (it `existsSync`-guards most copies, so failures may be silent-degraded rather than loud). Validate with `npm pack --dry-run` and, ideally, an install smoke test from the packed tarball.
- **Over-broad allowlist re-leaks board content.** Verify the tarball contains no `plans/`, `memory-bank/`, `.local-board/`, `test/`, `tests/`, `local_board/`, `docs/`.
- **`bin`/`src` internal references.** Low risk — they resolve against project root, not the package dir, so packing does not change runtime resolution.
- **Windows path handling** in any new `sync-resources` script — use `node:path` join and `cpSync`, avoid shell.

### Test strategy

- `test/resources-sync.test.js` (new): assert `resources/prompts` and `resources/templates` are content-identical to `plans/prompts` and `plans/templates` (same relative file set, same bytes). Fails on drift.
- `npm pack --dry-run` (manual/CI acceptance): assert the file list contains only `bin/`, `src/`, `resources/`, `install.mjs`, `SKILL.md`, `SKILL_TEAM.md`, `agents/`, `skills/`, `package.json`, `README.md`, `LICENSE`; assert it excludes `plans/`, `memory-bank/`, `.local-board/`, `test/`, `tests/`, `local_board/`, `docs/`. Could be codified as a test that runs `npm pack --dry-run --json` and inspects entries.
- Installer smoke: run `node install.mjs --target=claude` (or dry equivalent) after packing and confirm `~/.local-board/prompts` and `~/.local-board/templates` are populated from `resources/`.
- Existing suite (`node --test`) must stay green; `npm run check` includes `install.mjs` syntax check.

### Related tickets and conflicts

- **T20260707T1320Z** (publish + PATH skills) — `blocks` target of this ticket; depends on the `files` allowlist and `resources/` landing first.
- **T20260707T1319Z** (install subcommand — moves `install.mjs` logic into `src/`) — will touch the same `copyDir` calls. Sequencing: land this ticket's minimal `resources/` repoint first; T1319Z then carries the `resources/` paths when it relocates the logic. Flag for whoever sequences: coordinate to avoid a merge conflict on `install.mjs` lines 135-136.
- **B20260707T1323Z** and **B20260707T1327Z** (placeholder rendering) — noted as superseded if npm packaging lands first; no direct code overlap here.
- **B20260707T1320Z** (missing scaffold prompts) — owns the `scaffold.js` gap; this ticket intentionally does not touch `scaffold.js` to avoid scope collision.

### Open questions

None blocking. Two low-stakes preferences for the implementer/maintainer:

- Sync direction: this design picks `plans/prompts` as source of truth and `resources/` as the generated mirror. If the maintainer prefers `resources/` as canonical (with `plans/prompts` the mirror), the sync script and test invert trivially — behavior is identical either way.
- Whether to also delete the now-vestigial installed `~/.local-board/prompts`/`templates` copies (CLI never reads them). Left in place here for reversibility; can be reaped in a later cleanup once confirmed no external tooling depends on them.

## Implementation Notes

Implemented per the Technical Design section, no deviations.

**Changes:**
- `resources/prompts/**` and `resources/templates/**` (new): byte-for-byte mirror of `plans/prompts` and `plans/templates` (16 files total: roles/, steps/, optional-steps/, templates/ticket.md).
- `install.mjs`: repointed the two runtime-asset `copyDir` calls (was `plans/prompts` / `plans/templates`) to `resources/prompts` / `resources/templates`. Installed layout under `~/.local-board/` unchanged.
- `package.json`: added `files` allowlist (`bin`, `src`, `resources`, `install.mjs`, `SKILL.md`, `SKILL_TEAM.md`, `agents`, `skills`); added `repository` (git+https://github.com/NicholasMTElliott/local-board.git); added `keywords` (kanban, tickets, board, ai-agents, workflow, orchestration, cli, markdown); minor `description` polish; added `sync-resources` script.
- `scripts/sync-resources.mjs` (new): maintainer mirror generator, recursive copy `plans/prompts` -> `resources/prompts` and `plans/templates` -> `resources/templates` using `node:fs` `cpSync`/`rmSync` (no shell, Windows-safe).
- `test/resources-sync.test.js` (new): drift guard — walks both tree pairs, asserts identical relative file sets and byte-identical contents; also asserts both resource dirs are non-empty.
- `src/cli.js`, `src/config.js`, `src/scaffold.js`: untouched, per design (no CLI fallback-path logic exists; scaffold.js gap is owned by B20260707T1320Z).
- `plans/prompts`, `plans/templates`: untouched — remain this repo's authoritative dogfooded board content.

**Verification:**
- `npm run check`: pass (all `node --check` targets clean, including `install.mjs`).
- `npm test`: 142/142 pass, 0 fail (includes 3 new resources-sync tests: prompts mirror, templates mirror, non-empty guard).
- `npm run validate`: "Ticket validation OK".
- `npm pack --dry-run`: 48 files, 59.1 kB packed / 245.6 kB unpacked. Contents: `LICENSE`, `README.md`, `package.json` (npm auto-included) + `SKILL.md`, `SKILL_TEAM.md`, `agents/**` (14 files), `bin/local-board.js`, `install.mjs`, `resources/prompts/**` + `resources/templates/**` (16 files), `skills/codex/**` (4 files), `src/*.js` (7 files). No `plans/`, `memory-bank/`, `docs/`, `test/`, `tests/`, `local_board/`, or `.local-board/` present — confirms no live board/test content leaks into the tarball.
- Installer smoke test: ran `node install.mjs --target=codex` against a throwaway `HOME` — confirmed `~/.local-board/prompts` (15 files) and `~/.local-board/templates` (1 file) populate correctly and match the `resources/` mirror exactly.
- `npm run sync-resources`: ran manually — confirmed idempotent (re-copies cleanly, drift guard tests stay green afterward).

**Risks / follow-ups (per design, none newly introduced):**
- Drift between `plans/prompts` and `resources/` is now caught by the test guard; maintainers must remember to run `npm run sync-resources` after editing `plans/prompts`/`plans/templates` (not automated into `npm run check`, per design's stated preference for the `node --test` guard alone).
- `~/.local-board/prompts`/`templates` remain vestigial (nothing in the CLI reads them back); left in place for reversibility per design decision.
- T20260707T1319Z (install subcommand relocation) will touch the same two `copyDir` lines — flagged in the ticket for sequencing coordination.

## Review Findings

Reviewed by codex-task:read-only (gpt-5.5) against commit 76781b5.

No blocking findings.

Non-blocking observations:
- memory-bank/techContext.md:13 and README.md:123 list the repository layout but do not mention the new `resources/` package asset tree; `memory-bank/` is authoritative agent context and should record the packaging layout (defer to the document stage of this ticket).
- package.json adds `npm run sync-resources`, but the `files` allowlist excludes `scripts/` from the tarball. Acceptable as source-repo-only maintainer tooling (useless in the package without `plans/`), but the packed package carries a script entry that cannot run.

Review checks:
- Allowlist completeness correct for installer runtime: install.mjs:125-136 copies package.json, README.md, SKILL.md, optional SKILL_TEAM.md, bin, src, agents, skills, resources/prompts, resources/templates; npm auto-includes package.json/README/LICENSE.
- Installed layout unchanged: still ~/.local-board/prompts and ~/.local-board/templates; SKILL.md:90 fallback path expectations hold.
- Line-ending flake risk addressed: .gitattributes:5 forces `* text=auto eol=lf` covering both trees identically; the drift test will not fail from platform line endings alone.
- scripts/sync-resources.mjs:15-28 mirrors plans -> resources only, Node rmSync/cpSync, no shell.
- test/resources-sync.test.js:26-44 compares relative file lists and per-file contents both directions; :48-61 covers prompts, templates, non-empty guards.
- Scope tight; no unrelated product changes.

Verification caveat: sandbox blocked independent `npm pack --dry-run` (npm cache write) and `node --test` (spawn EPERM); reviewer validated the mirror with an inline read-only Buffer comparison — 15 prompt files and 1 template file matched byte-for-byte. Full-suite verification delegated to the test stage.

Verdict: pass

## Test Evidence

Tested by claude-subagent:local-board-tester (sonnet) on branch local-board/T20260707T1318Z-..., commit 76781b5.

**Verification suite:** `npm run check` pass; `npm test` 142/142 pass (~12.5s) including the three new drift-guard tests; `npm run validate` pass.

**Package boundary:** `npm pack --dry-run --json` -> 48 entries, 59,138 bytes packed. Full entry list inspected: only auto-included LICENSE/README/package.json plus SKILL.md, SKILL_TEAM.md, agents (14), bin, install.mjs, resources/prompts (15), resources/templates (1), skills/codex (4), src (7). Confirmed absent: plans/, memory-bank/, docs/, test/, .local-board/, scripts/. Matches implementer's claims exactly.

**Independent install probe (throwaway HOME):** `node install.mjs --list-targets` resolved all 6 targets cleanly. With USERPROFILE redirected to a scratch dir, `node install.mjs --target=codex` exited 0 and populated `<scratch>\.local-board\prompts` (15 files) and `templates` (1 file); `diff -rq` against resources/ showed byte-identical copies. Scratch removed; `git status` confirmed no leaked artifacts.

**Drift guard (read-only inspection):** assertMirrored does full-set equality on file lists plus per-file content equality — bidirectional; an edit/add/delete on either side fails the test.

**Gaps / caveats:**
- Reviewer's non-blocking observation re-confirmed: `sync-resources` script entry ships in the packed package.json while scripts/ is excluded from the tarball — fails if run from an installed package; accepted as maintainer-only tooling.
- Only the codex target was installed in the probe; all targets share the same single resources/ copy step, so coverage is sufficient.

Result: pass

## Documentation Updates

Documented by codex-task:workspace-write (gpt-5.5).

- `memory-bank/techContext.md` — added `resources/` (packaged prompt/template mirror synced from plans/ via `npm run sync-resources`), `scripts/` (maintainer tooling, not packaged), and the package.json `files` allowlist constraint, in terse current-state form.
- `README.md` — added `resources/` to the Repository Layout with a one-line description.
- `memory-bank/systemPatterns.md` — checked, unchanged; no stale installer copy-source statement.
- `docs/` — no narrative page covers packaging yet; the npm install story is deferred to T20260707T1338Z (docs/Install.md) and T20260707T1320Z (publish).

## Questions

## Run Log

- 2026-07-07T14:12:22Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): resources/ mirror as packaged content with plans/prompts staying repo-authoritative, sync script + drift-guard test, files allowlist + metadata polish; found no CLI fallback-path logic needs changing. Estimate 4 (bootstrap).

- 2026-07-07T14:13:29Z: Ensured git branch local-board/T20260707T1318Z-npm-add-files-allowlist-and-move-runtime-prompts-and-templates-out-of-the-live-plans-tree (created).

- 2026-07-07T14:17:41Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Implementer (sonnet): resources/ mirror + files allowlist + metadata + sync script + 3 drift-guard tests; npm check/test/validate pass (142/142); npm pack --dry-run confirmed clean 48-file tarball; install smoke test against throwaway HOME populated prompts/templates from resources/.

- 2026-07-07T14:21:45Z: Completed review via codex-task:read-only: Codex (gpt-5.5, read-only) verdict pass: allowlist complete for installer runtime, CRLF risk covered by .gitattributes eol=lf, sync script safe, drift test bidirectional; two non-blocking doc observations deferred to document stage.

- 2026-07-07T14:24:40Z: Completed test via claude-subagent:local-board-tester@sonnet: Tester (sonnet): check/test/validate pass (142/142); npm pack --dry-run 48-entry list fully inspected with all exclusions confirmed; independent throwaway-HOME install probe byte-identical; drift guard verified bidirectional. Result: pass.

- 2026-07-07T14:26:39Z: Completed document via codex-task:workspace-write: Codex (workspace-write): techContext layout gains resources/, scripts/, files-allowlist note; README layout gains resources/; systemPatterns checked unchanged.
