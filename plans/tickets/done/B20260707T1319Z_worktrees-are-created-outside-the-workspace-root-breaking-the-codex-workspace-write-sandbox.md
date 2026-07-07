---
id: B20260707T1319Z
type: bug
status: done
priority: P1
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/B20260707T1319Z-worktrees-are-created-outside-the-workspace-root-breaking-the-codex-workspace-write-sandbox
estimate: 4
estimateBasis: B20260707T1318Z
workStartedAt: 2026-07-07T15:34:40Z
workCompletedAt: 2026-07-07T16:08:40Z
created: 2026-07-07T13:19:54Z
updated: 2026-07-07T16:08:40Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "implement:claude-subagent:local-board-implementer@sonnet", review:codex-task:read-only, "test:claude-subagent:local-board-tester@sonnet", document:codex-task:workspace-write]
routingApprovals: []
---
# Worktrees are created outside the workspace root, breaking the Codex workspace-write sandbox

## Requirement

`src/worktrees.js:128-129` places ticket worktrees at `<parent>/<repo>-worktrees/<ticket-id>` — outside the workspace root. Codex's default `workspace-write` sandbox blocks writes there, so `worktree-add`, every worker edit inside the worktree, and the rebase-in-worktree flow in `skills/codex/local-team/SKILL.md` hit approval escalations or hard denials. `docs/CodexSupport.md` does not mention sandbox modes, writable roots, or approval policy.

Fix: add a config option to place worktrees inside the repo (for example `.worktrees/`, git-ignored) or another configurable location, and document the required Codex configuration (additional writable root) in `docs/CodexSupport.md` for the out-of-repo layout.

Acceptance: a Codex `workspace-write` session can run the full parallel flow without sandbox escalations, or the docs state exactly what config is required.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Technical Design

### Problem

`ticketWorktreesRoot` (`src/worktrees.js:127-130`) hardcodes the placement of ticket
worktrees at `<parent-of-repo>/<repo-basename>-worktrees/<ticket-id>` — a sibling of
the repo, outside the workspace root. Codex's default `workspace-write` sandbox only
grants write access under the workspace (repo) root, so `git worktree add`, every
worker edit inside the worktree, the branch-stamp commit, and the rebase-in-worktree
closeout in `skills/codex/local-team/SKILL.md` all fall outside the writable boundary
and trigger approval escalations or hard denials. `docs/CodexSupport.md` documents
nothing about sandbox modes or writable roots.

Goal (per acceptance): either a Codex `workspace-write` session runs the full parallel
flow without escalations, or the docs state exactly what config is required. This design
delivers both — an opt-in in-repo layout that needs no sandbox config, plus documentation
of the writable-root requirement for the existing sibling layout.

### Approach

Introduce a single config knob, `worktrees.location`, consumed by the placement helpers
in `src/worktrees.js`. Default stays `"sibling"` for exact back-compat. Add an `"inside"`
mode that places worktrees at `<repoRoot>/.worktrees/<ticket-id>`, git-ignored. Thread
the loaded config into the four call sites that currently derive paths from
`ticketWorktreesRoot`. Document the Codex sandbox implications and recommend the inside
layout for Codex parallel runs.

#### Config shape (`src/config.js`)

Add to `DEFAULT_CONFIG`:

```
worktrees: { location: "sibling" }
```

Accepted values for `location`:

- `"sibling"` — current behavior: `<dirname(repoRoot)>/<basename(repoRoot)>-worktrees`.
  Default; keeps every existing board and test byte-identical.
- `"inside"` — `<repoRoot>/.worktrees`. Under the workspace root, so writable by the
  Codex `workspace-write` sandbox with no extra config.
- any other non-empty string — treated as an explicit path: absolute paths are used
  as-is; relative paths resolve against `repoRoot`. This satisfies "another configurable
  location" without extra keys.

Justification for keeping `"sibling"` as default: changing placement for existing boards
would strand already-registered worktrees (their `git worktree list` entries point at the
old sibling path) and could surprise Claude-first users who have no sandbox constraint.
Inside layout is opt-in and documented as the recommended setting for Codex.

Add a `normalizeWorktrees(merged)` validator called alongside `normalizeEstimation` in
`loadConfig`:

- `merged.worktrees` must be an object; default it when absent (so partial configs and
  every current config load unchanged — `mergeConfig` already deep-merges the block).
- `location` must be a non-empty string; reject empty/whitespace and non-strings.
- Reject explicit paths that resolve inside `<repoRoot>/plans` (guards ticket discovery;
  see hazards). Note: the validator does not know `repoRoot` at load time, so enforce the
  `plans/` guard in `worktreesRootFor` (below) where `repoRoot` is known, and keep the
  config-level check to type/emptiness only. State this split explicitly.

Update `defaultConfigJsonc()` to emit a documented `worktrees` block (values, default,
and the Codex note) so `init` scaffolds it.

#### Placement helpers (`src/worktrees.js`)

`ticketWorktreesRoot` currently takes only `repoRoot`. Make placement config-aware by
adding a resolver that accepts the location value:

```
worktreesRootFor(repoRoot, location)  // pure, given the resolved location string
```

- `"sibling"` → existing sibling computation (unchanged).
- `"inside"` → `path.join(repoRoot, ".worktrees")`.
- otherwise → `path.isAbsolute(location) ? location : path.join(repoRoot, location)`;
  throw if the result resolves inside `<repoRoot>/plans`.

Keep `ticketWorktreesRoot(repoRoot)` as a thin back-compat wrapper defaulting to
`"sibling"` so nothing outside this module breaks if missed, but route all real call
sites through the config-aware path.

The four consumers each already resolve `repoRoot` via git and can `await loadConfig`:

1. `addTicketWorktree` — load config from `repoRoot`, compute `worktreesRootFor`, then
   `path.join(root, ticketId)`. When location is inside-repo, call `ensureWorktreeIgnore`
   before `git worktree add` (see hazards).
2. `removeTicketWorktree` — same resolution to locate the registered path.
3. `listTicketWorktrees` — resolve `worktreesRoot` from config; the existing
   `isChildPath(worktreesRoot, record)` filter and `path.basename` → ticketId mapping work
   unchanged for the inside layout (the main worktree at `<repoRoot>` is not a child of
   `<repoRoot>/.worktrees`, so it stays excluded).
4. `ticketWorktreeMintOffsetMinutes` — this derives `worktreesRoot` from
   `records[0].worktreePath` (the main worktree is always first in `git worktree list`).
   Load config from that main root and use `worktreesRootFor`. It already swallows errors
   and returns `0`, so a config-load failure degrades safely to the current offset=0.

`ticketWorktreePath(repoRoot, ticketId)` stays as a helper but must take the resolved
location (or load config) — used by `addTicketWorktree`/`removeTicketWorktree` and, per
the conflict note below, by T20260707T1331Z's forthcoming guard.

Because `loadConfig` is async and these functions are already async, threading is
straightforward; no signature becomes newly async.

### In-repo layout hazards (addressed)

1. **git status noise / accidental commit.** `git worktree add <repoRoot>/.worktrees/<id>`
   is allowed by git — it does not refuse a path inside the main working tree — but the
   nested checkout's contents then appear as untracked in the parent's `git status`,
   risking `git add .` and dirtying `move ... done` planning-commit flows. Mitigation:
   `.worktrees/` must be git-ignored. Ownership split:
   - `init` scaffold (`src/scaffold.js`) seeds a repo-root `.gitignore` containing
     `.worktrees/` so new boards are clean regardless of chosen layout.
   - `addTicketWorktree`, when the resolved location is inside the repo, calls an
     idempotent `ensureWorktreeIgnore(repoRoot, relDir)` that appends the ignore entry to
     `<repoRoot>/.gitignore` only if absent. This covers existing boards that opt in
     without re-running `init`. The helper does not auto-commit — committing the
     `.gitignore` change is left to the user/orchestrator (git status shows only the
     one-line `.gitignore` edit, never the worktree contents). Open question flags whether
     to auto-commit; recommendation is not to, to avoid surprise commits mid-`worktree-add`.
   - Rejected alternative: `.git/info/exclude`. It is per-clone and uncommitted, so it
     would not propagate to teammates or fresh clones — wrong for a project-level layout.

2. **Ticket discovery double-count.** Verified safe: `discover()` (`src/tickets.js:159-186`)
   walks only `<root>/plans/tickets`. `.worktrees/` sits at the repo root, a sibling of
   `plans/`, so `walkMarkdown` never recurses into it and nested checkouts' `plans/tickets`
   are not discovered. This is why explicit-path support must reject any location resolving
   inside `<repoRoot>/plans` — that is the one placement that would make discovery walk
   nested checkouts and double-count tickets.

3. **`git clean -fdx` in the main root** would delete `.worktrees/` and orphan registered
   worktrees. Same exposure exists today for the sibling dir only via a broader clean;
   inside layout widens it slightly. Note as a documented risk, not a code change.

4. **Windows path length.** Inside layout adds `.worktrees/<id>` (~28 chars) of depth vs a
   sibling `<repo>-worktrees/<id>`. Net depth increase is small; combined with a deep repo
   path it could approach the 260-char `MAX_PATH`. Minor. Note `core.longpaths` as the
   escape hatch; no code change.

### Documentation

- `docs/CodexSupport.md`: add a "Worktrees and the sandbox" section stating that
  `git worktree add` and worker edits must land inside a writable root. For the default
  `sibling` layout under `workspace-write`, the sibling directory is outside the workspace
  and must be added as an additional writable root (e.g. Codex `sandbox_workspace_write`
  `writable_roots` / `-c` override pointing at `<repo>-worktrees`), or escalations occur.
  Recommend setting `worktrees.location: "inside"` for Codex parallel runs so no sandbox
  config is needed. Update the "Limits" note that "Codex support does not add a new config
  schema" — this ticket adds one config key; reword to reflect it.
- `skills/codex/local-team/SKILL.md`: the "Worktrees" section says "Every in-flight ticket
  uses a separate sibling worktree". Generalize to "a separate worktree (location per
  `worktrees.location`)" and cross-reference the CodexSupport sandbox note. Coordinate with
  the skills-dedup tickets that also touch this worktree text (conflict note below).
- Memory Bank `techContext.md`/`systemPatterns.md`: add the `worktrees.location` fact if
  worktree placement is documented there (documenter step to confirm).
- README Documentation Index: unchanged (no new docs file).

### Affected files

- `src/config.js` — `DEFAULT_CONFIG.worktrees`, `normalizeWorktrees`, `defaultConfigJsonc()`.
- `src/worktrees.js` — `worktreesRootFor`, config threading in `addTicketWorktree`,
  `removeTicketWorktree`, `listTicketWorktrees`, `ticketWorktreeMintOffsetMinutes`,
  `ticketWorktreePath`; `ensureWorktreeIgnore` helper.
- `src/scaffold.js` — seed root `.gitignore` with `.worktrees/`.
- `docs/CodexSupport.md`, `skills/codex/local-team/SKILL.md` — sandbox/placement docs.
- `test/worktrees.test.js`, `test/config.test.js` — new coverage.

### Related tickets and conflicts

- **T20260707T1331Z** (guard against wrong `--root` when a ticket has a registered
  worktree) touches the same placement/assignment surface and its Requirement cites the
  `mainRootFor`-style logic at `src/worktrees.js:148-160` (currently
  `ticketWorktreeMintOffsetMinutes`). Its guard will compute the expected worktree path per
  ticket — it must use the config-aware `ticketWorktreePath`/`worktreesRootFor` this ticket
  introduces. **Sequence B20260707T1319Z first**; T1331 then builds its guard on the
  config-aware helpers. If T1331 lands first it will hardcode sibling assumptions and need
  rework. Flag the overlap in both tickets' Related Tickets.
- **Skills dedup tickets** edit worktree-path wording in the Codex skill/SKILL text.
  Coordinate the SKILL.md "sibling" → "configurable location" edit to avoid a merge
  collision; whichever lands second rebases the one-line change.

### Risks

- Threading config into `ticketWorktreeMintOffsetMinutes` on the ticket-creation hot path:
  keep its existing try/catch-to-0 behavior so a config error never blocks `create`.
- Mixed-mode drift: if a board flips `location` while worktrees from the old layout are
  registered, `list`/`remove` filter by the new root and will not see the stranded old
  worktrees. Document that placement should be chosen before creating worktrees; consider a
  warning if `git worktree list` shows entries outside the resolved root (optional, flag as
  open question).
- `ensureWorktreeIgnore` writing to the main working tree during `worktree-add` is a
  production-file side effect; keep it append-only and idempotent, and never touch existing
  `.gitignore` lines.

### Test strategy

Existing worktree tests use real git fixtures (`withRepo` in `test/worktrees.test.js`);
extend that harness. `withRepo` currently hardcodes the sibling `worktreesRoot`; parameterize
it (or add an inside-layout variant) that writes a config with `worktrees.location: "inside"`
before the callback.

- **worktrees.test.js**
  - Inside-layout `worktree-add`: worktree created at `<root>/.worktrees/<id>`, branch
    stamped, idempotent — mirrors the existing sibling test with the inside path.
  - `.gitignore` assertion: after inside `worktree-add`, `<root>/.gitignore` contains
    `.worktrees/`; a second add does not duplicate the line.
  - **Sandbox-proxy assertion (acceptance):** after inside `worktree-add`, run
    `git status --porcelain` in the main root and assert `.worktrees/` produces no untracked
    entries — proves no accidental-commit/escalation surface. Also assert every created path
    is under `path.resolve(root)` (the workspace-root writability invariant), which is the
    testable stand-in for "no sandbox escalation".
  - `worktree-list` returns the inside path and still excludes the main worktree.
  - `worktree-remove` removes the inside worktree and is idempotent.
  - Peer-worktree mint-offset test under inside layout: distinct ticket IDs still minted
    (exercises config-aware `ticketWorktreeMintOffsetMinutes`).
  - Regression: all existing sibling tests pass unchanged (default config path).
  - Discovery guard: create a ticket, add an inside worktree, run `validate`/`list` in the
    main root and assert the ticket is counted exactly once (no nested double-count).
  - Negative: explicit `location` resolving inside `plans/` is rejected.
- **config.test.js**
  - Default config has `worktrees.location === "sibling"`.
  - `normalizeWorktrees` accepts "sibling"/"inside"/explicit path; rejects empty/non-string.
  - `defaultConfigJsonc()` round-trips and includes the `worktrees` block.
- Run the full `node --test` suite plus lint.

### Open questions

1. Should `ensureWorktreeIgnore` auto-commit the `.gitignore` edit, or leave it staged/
   dirty for the orchestrator to commit? (Recommendation: leave uncommitted, document.)
2. Explicit-path form: keep it in v1, or ship only `"sibling"`/`"inside"` and defer custom
   paths? (Recommendation: keep, low cost; the `plans/` guard covers the only unsafe case.)
3. Warn on stranded worktrees when `location` changes with existing registrations?

## Implementation Notes

Implemented per the approved technical design.

**Config (`src/config.js`)**
- Added `DEFAULT_CONFIG.worktrees = { location: "sibling" }`.
- Added `normalizeWorktrees(merged)` (type/emptiness check only; the `plans/`-interior
  guard needs `repoRoot`, which is not known at config-load time, so it is enforced in
  `worktreesRootFor`), wired into `loadConfig` alongside `normalizeEstimation`.
- `defaultConfigJsonc()` now emits a documented `worktrees` block (values, defaults,
  Codex sandbox note) so `init` scaffolds it.

**Placement (`src/worktrees.js`)**
- Added pure `worktreesRootFor(repoRoot, location)`: `"sibling"` (unchanged
  computation), `"inside"` -> `<repoRoot>/.worktrees`, otherwise an explicit path
  (absolute as-is, relative resolved against `repoRoot`); throws if the resolved path
  is inside `<repoRoot>/plans`.
- `ticketWorktreesRoot(repoRoot)` kept as a thin back-compat wrapper defaulting to
  `"sibling"`.
- `ticketWorktreePath(repoRoot, ticketId, location = "sibling")` now takes the resolved
  location.
- `addTicketWorktree`, `removeTicketWorktree`, `listTicketWorktrees` now `loadConfig`
  from `repoRoot` and route through `worktreesRootFor`/`ticketWorktreePath`.
- `ticketWorktreeMintOffsetMinutes` loads config from the main worktree root and falls
  back to the sibling default on any config-load or resolution failure (never blocks
  ticket creation).
- Added `ensureWorktreeIgnore(repoRoot)`: appends `.worktrees/` to `<repoRoot>/.gitignore`
  only if absent (append-only, idempotent, no auto-commit). Called from
  `addTicketWorktree` only when the resolved location is `"inside"`.

**Scaffold (`src/scaffold.js`)**
- `initProject` now seeds a repo-root `.gitignore` containing `.worktrees/` (via the
  existing `FILES` map / `writeScaffoldFile`, so it respects the existing
  create/skip/overwrite semantics and never clobbers a pre-existing `.gitignore`).

**Docs**
- `docs/CodexSupport.md`: new "Worktrees and the sandbox" section explaining the
  writable-root requirement for the default `sibling` layout under Codex
  `workspace-write`, and recommending `worktrees.location: "inside"` for Codex
  parallel runs. Updated the "Limits" note — Codex support no longer claims "no new
  config schema" (this ticket adds `worktrees.location`); it still adds no new route
  grammar.
- `skills/codex/local-team/SKILL.md`: generalized "Every in-flight ticket uses a
  separate sibling worktree" to reference `worktrees.location` and the new
  CodexSupport doc section.
- Memory Bank (`techContext.md`/`systemPatterns.md`): left untouched — the design
  flags this as "documenter step to confirm," out of implementer scope.

**Tests**
- `test/config.test.js`: 5 new tests — default `worktrees.location` is `"sibling"`;
  shipped config parses it; `"inside"` and explicit relative paths are accepted;
  empty/whitespace/non-string values are rejected; a non-object `worktrees` block is
  rejected.
- `test/worktrees.test.js`: `withRepo` now takes `{ location }` and computes
  `worktreesRoot` via the real `worktreesRootFor` (self-consistent with production
  code), and rewrites `plans/local-board.config.jsonc` post-`initProject` for
  non-sibling layouts. Also now stages `.gitignore` in the initial commit (scaffold
  change — see below). 10 new tests: inside-layout `worktree-add` (created path,
  branch stamp, idempotency, path-under-repo-root invariant), `.gitignore` seed +
  idempotent append + `git status --porcelain` clean-tree assertion, `worktree-list`
  under inside layout, `worktree-remove` under inside layout, peer mint-offset under
  inside layout, discovery double-count guard (`validate`/`list` count once), explicit
  relative path layout, and rejection of an explicit path resolving inside `plans/`.
- `test/git.test.js`: fixed `withRepo` to stage the new scaffold `.gitignore` in the
  initial commit (`git add plans .gitignore`) — without this, the untracked
  `.gitignore` file scaffolding now produces made pre-existing git.test.js tests fail
  with "working tree has uncommitted changes" in `ensureGitBranch`. No test logic
  changed, just the fixture setup.

**Deviations from the design**
- None substantive. One documentation wording choice: the "Limits" bullet in
  `docs/CodexSupport.md` was reworded to "does not add a new route grammar" (dropping
  "config schema" entirely) rather than a softer rewording, since this ticket does add
  one config key.

**Verification**
- `npm run check`: pass (all `node --check` targets clean).
- `npm test`: 167/167 pass (0 fail, 0 skipped).
- `npm run validate`: `Ticket validation OK`.

**Remaining risks** (carried from the design, no code changes made for these):
- Mixed-mode drift if `worktrees.location` changes while old-layout worktrees are
  still registered (`list`/`remove` will not see stranded worktrees under the old
  root).
- `git clean -fdx` in the main root would delete `.worktrees/` and orphan registered
  inside-layout worktrees.
- Windows `MAX_PATH` exposure is marginally higher for the inside layout in already-deep
  repo paths.

### Rework (post-review, commit 1c4feba review verdict: changes_requested)

Review by codex-task:read-only (gpt-5.5) found two blocking issues and one
non-blocking test gap; see the `## Review Findings` section for the full text. Summary
of what was found and what changed:

1. **`init --overwrite` could clobber a user's existing root `.gitignore`.** The
   `.gitignore` entry lived in the generic `FILES` map and every `FILES` entry was
   written with flag `"w"` under `--overwrite`, so re-running `init --overwrite` in an
   existing repo replaced any unrelated ignore rules with the template verbatim.
   **Fix:** pulled `.gitignore` out of the `FILES` map into a dedicated
   `writeGitignore()` in `src/scaffold.js`, called outside the generic
   `writeScaffoldFile` loop. Behavior now, regardless of the `--overwrite` flag: file
   absent -> write the full template (created); file present -> append the
   `.worktrees/` line only if not already present (idempotent), and never touch any
   other line (skipped if the entry is already there). Added
   `test/tickets.test.js`: "initProject --overwrite never clobbers an existing root
   .gitignore" — seeds a `.gitignore` with custom rules, runs `initProject(root, {
   overwrite: true })` twice, and asserts the custom rules are untouched, `.worktrees/`
   appears exactly once, and the second `--overwrite` run is a no-op.

2. **Explicit in-repo worktree paths got no ignore guard.** `addTicketWorktree` only
   called `ensureWorktreeIgnore` when `location === "inside"`, and the helper
   hard-coded the `.worktrees/` entry. An explicit relative location resolving inside
   the repo (e.g. `"custom-worktrees"`) got no `.gitignore` protection, so
   `worktree-add` would leave the parent checkout dirty with untracked nested worktree
   contents. **Fix:** generalized `ensureWorktreeIgnore(repoRoot, worktreesRoot)` in
   `src/worktrees.js` to compute the repo-relative path from `repoRoot` to the resolved
   `worktreesRoot` and append that exact entry (with trailing slash) instead of a fixed
   string. `addTicketWorktree` now calls it whenever `isChildPath(repoRoot,
   worktreesRoot)` is true — i.e. for any resolved root inside the repo (the `"inside"`
   layout and any explicit in-repo location), not just the literal `"inside"` constant.
   Locations resolving inside `plans/` remain rejected upstream by `worktreesRootFor`,
   unchanged. Added `test/worktrees.test.js`: "worktree-add ignore-guards an explicit
   in-repo worktrees.location and leaves git status clean" — uses
   `{ location: "custom-worktrees" }`, asserts the `.gitignore` gains a
   `custom-worktrees/` line and `git status --porcelain` in the main root shows no
   `custom-worktrees` entries after `worktree-add`.

3. **Non-blocking test gap (closed as cheap):** added append-path coverage for
   `ensureWorktreeIgnore` — "worktree-add appends the ignore entry to a board with no
   existing .gitignore" (removes the scaffolded `.gitignore`, runs `worktree-add` with
   `location: "inside"`, asserts the file is created containing exactly `.worktrees/\n`)
   and "worktree-add appends the ignore entry to an existing .gitignore lacking a
   trailing newline" (rewrites `.gitignore` to `"node_modules/\n*.log"` with no
   trailing newline, runs `worktree-add`, asserts the result is
   `"node_modules/\n*.log\n.worktrees/\n"` — confirms the newline-insertion branch is
   exercised, not just the already-covered "file already ends with \n" case).

**Deliberately not changed** (explicitly out of scope for this rework pass, called out
in the review as non-blocking and carried forward unresolved):
- Mixed-mode drift (`worktree-remove`/`worktree-list` derive one expected path from
  current config; switching `location` with worktrees still registered under the old
  root makes them invisible). No warning added.
- The `test/git.test.js:27` fixture change from the original implementation pass
  (confirmed by review as not a regression) was left as-is.

**Verification (rework)**
- `npm run check`: pass (all `node --check` targets clean).
- `npm test`: 171/171 pass (0 fail, 0 skipped) — up from 167 (+4 new tests: 1 in
  `test/tickets.test.js`, 3 in `test/worktrees.test.js`).
- `npm run validate`: `Ticket validation OK`.

### Rework (second pass, post re-review, commit-not-yet-tagged review verdict: changes_requested)

Re-review by codex-task:read-only (gpt-5.5) narrowed to a single remaining edge:
gitignore idempotency must treat an existing equivalent entry *without* a trailing
slash as already present.

**Finding:** `ensureWorktreeIgnore` (`src/worktrees.js:83-90`) and `writeGitignore`
(`src/scaffold.js:250-258`) both compared `line.trim() === entry`, where `entry`
always carries a trailing slash (e.g. `.worktrees/`, `custom-worktrees/`). A
pre-existing user line without the slash (`.worktrees` or `custom-worktrees`) is an
equivalent gitignore pattern but did not match, so a redundant slash-suffixed entry
was appended on top of it.

**Fix:** both helpers now also accept the bare form. Computed `bareEntry` (entry with
the trailing slash stripped) alongside the existing slash-suffixed `entry`/
`GITIGNORE_WORKTREE_ENTRY`, and the presence check now matches `line.trim() === entry
|| line.trim() === bareEntry` (same two-line duplicated predicate in each file, per
the design note — no shared import introduced, to keep the two modules' local-helper
boundary unchanged). No other logic touched: still append-only, still idempotent,
still preserves all unrelated lines.

**Tests added:**
- `test/tickets.test.js`: "initProject --overwrite treats an existing .worktrees line
  without a trailing slash as already present" — seeds `.gitignore` with a bare
  `.worktrees` line (no slash) among custom rules, runs `initProject(root, {
  overwrite: true })`, and asserts the file is byte-identical afterward (nothing
  appended).
- `test/worktrees.test.js`: "worktree-add treats a pre-existing explicit-path entry
  without a trailing slash as already present" — under `{ location:
  "custom-worktrees" }`, seeds `.gitignore` with a bare `custom-worktrees` line (no
  slash), runs `worktree-add`, and asserts the file is unchanged (nothing appended).

**Deliberately not changed:** everything else flagged in the prior review passes
(mixed-mode drift, `git clean -fdx` exposure, Windows `MAX_PATH` marginal increase)
remains out of scope for this surgical fix, per the rework brief.

**Verification (rework, second pass)**
- `npm run check`: pass (all `node --check` targets clean).
- `npm test`: 173/173 pass (0 fail, 0 skipped) — up from 171 (+2 new tests: 1 in
  `test/tickets.test.js`, 1 in `test/worktrees.test.js`).
- `npm run validate`: `Ticket validation OK`.

## Implementation Notes

Implemented per the approved technical design.

**Config (`src/config.js`)**
- Added `DEFAULT_CONFIG.worktrees = { location: "sibling" }`.
- Added `normalizeWorktrees(merged)` (type/emptiness check only; the `plans/`-interior
  guard needs `repoRoot`, which is not known at config-load time, so it is enforced in
  `worktreesRootFor`), wired into `loadConfig` alongside `normalizeEstimation`.
- `defaultConfigJsonc()` now emits a documented `worktrees` block (values, defaults,
  Codex sandbox note) so `init` scaffolds it.

**Placement (`src/worktrees.js`)**
- Added pure `worktreesRootFor(repoRoot, location)`: `"sibling"` (unchanged
  computation), `"inside"` -> `<repoRoot>/.worktrees`, otherwise an explicit path
  (absolute as-is, relative resolved against `repoRoot`); throws if the resolved path
  is inside `<repoRoot>/plans`.
- `ticketWorktreesRoot(repoRoot)` kept as a thin back-compat wrapper defaulting to
  `"sibling"`.
- `ticketWorktreePath(repoRoot, ticketId, location = "sibling")` now takes the resolved
  location.
- `addTicketWorktree`, `removeTicketWorktree`, `listTicketWorktrees` now `loadConfig`
  from `repoRoot` and route through `worktreesRootFor`/`ticketWorktreePath`.
- `ticketWorktreeMintOffsetMinutes` loads config from the main worktree root and falls
  back to the sibling default on any config-load or resolution failure (never blocks
  ticket creation).
- Added `ensureWorktreeIgnore(repoRoot)`: appends `.worktrees/` to `<repoRoot>/.gitignore`
  only if absent (append-only, idempotent, no auto-commit). Called from
  `addTicketWorktree` only when the resolved location is `"inside"`.

**Scaffold (`src/scaffold.js`)**
- `initProject` now seeds a repo-root `.gitignore` containing `.worktrees/` (via the
  existing `FILES` map / `writeScaffoldFile`, so it respects the existing
  create/skip/overwrite semantics and never clobbers a pre-existing `.gitignore`).

**Docs**
- `docs/CodexSupport.md`: new "Worktrees and the sandbox" section explaining the
  writable-root requirement for the default `sibling` layout under Codex
  `workspace-write`, and recommending `worktrees.location: "inside"` for Codex
  parallel runs. Updated the "Limits" note — Codex support no longer claims "no new
  config schema" (this ticket adds `worktrees.location`); it still adds no new route
  grammar.
- `skills/codex/local-team/SKILL.md`: generalized "Every in-flight ticket uses a
  separate sibling worktree" to reference `worktrees.location` and the new
  CodexSupport doc section.
- Memory Bank (`techContext.md`/`systemPatterns.md`): left untouched — the design
  flags this as "documenter step to confirm," out of implementer scope.

**Tests**
- `test/config.test.js`: 5 new tests — default `worktrees.location` is `"sibling"`;
  shipped config parses it; `"inside"` and explicit relative paths are accepted;
  empty/whitespace/non-string values are rejected; a non-object `worktrees` block is
  rejected.
- `test/worktrees.test.js`: `withRepo` now takes `{ location }` and computes
  `worktreesRoot` via the real `worktreesRootFor` (self-consistent with production
  code), and rewrites `plans/local-board.config.jsonc` post-`initProject` for
  non-sibling layouts. Also now stages `.gitignore` in the initial commit (scaffold
  change — see below). 10 new tests: inside-layout `worktree-add` (created path,
  branch stamp, idempotency, path-under-repo-root invariant), `.gitignore` seed +
  idempotent append + `git status --porcelain` clean-tree assertion, `worktree-list`
  under inside layout, `worktree-remove` under inside layout, peer mint-offset under
  inside layout, discovery double-count guard (`validate`/`list` count once), explicit
  relative path layout, and rejection of an explicit path resolving inside `plans/`.
- `test/git.test.js`: fixed `withRepo` to stage the new scaffold `.gitignore` in the
  initial commit (`git add plans .gitignore`) — without this, the untracked
  `.gitignore` file scaffolding now produces made pre-existing git.test.js tests fail
  with "working tree has uncommitted changes" in `ensureGitBranch`. No test logic
  changed, just the fixture setup.

**Deviations from the design**
- None substantive. One documentation wording choice: the "Limits" bullet in
  `docs/CodexSupport.md` was reworded to "does not add a new route grammar" (dropping
  "config schema" entirely) rather than a softer rewording, since this ticket does add
  one config key.

**Verification**
- `npm run check`: pass (all `node --check` targets clean).
- `npm test`: 167/167 pass (0 fail, 0 skipped).
- `npm run validate`: `Ticket validation OK`.

**Remaining risks** (carried from the design, no code changes made for these):
- Mixed-mode drift if `worktrees.location` changes while old-layout worktrees are
  still registered (`list`/`remove` will not see stranded worktrees under the old
  root).
- `git clean -fdx` in the main root would delete `.worktrees/` and orphan registered
  inside-layout worktrees.
- Windows `MAX_PATH` exposure is marginally higher for the inside layout in already-deep
  repo paths.

### Rework (post-review, commit 1c4feba review verdict: changes_requested)

Review by codex-task:read-only (gpt-5.5) found two blocking issues and one
non-blocking test gap; see the `## Review Findings` section for the full text. Summary
of what was found and what changed:

1. **`init --overwrite` could clobber a user's existing root `.gitignore`.** The
   `.gitignore` entry lived in the generic `FILES` map and every `FILES` entry was
   written with flag `"w"` under `--overwrite`, so re-running `init --overwrite` in an
   existing repo replaced any unrelated ignore rules with the template verbatim.
   **Fix:** pulled `.gitignore` out of the `FILES` map into a dedicated
   `writeGitignore()` in `src/scaffold.js`, called outside the generic
   `writeScaffoldFile` loop. Behavior now, regardless of the `--overwrite` flag: file
   absent -> write the full template (created); file present -> append the
   `.worktrees/` line only if not already present (idempotent), and never touch any
   other line (skipped if the entry is already there). Added
   `test/tickets.test.js`: "initProject --overwrite never clobbers an existing root
   .gitignore" — seeds a `.gitignore` with custom rules, runs `initProject(root, {
   overwrite: true })` twice, and asserts the custom rules are untouched, `.worktrees/`
   appears exactly once, and the second `--overwrite` run is a no-op.

2. **Explicit in-repo worktree paths got no ignore guard.** `addTicketWorktree` only
   called `ensureWorktreeIgnore` when `location === "inside"`, and the helper
   hard-coded the `.worktrees/` entry. An explicit relative location resolving inside
   the repo (e.g. `"custom-worktrees"`) got no `.gitignore` protection, so
   `worktree-add` would leave the parent checkout dirty with untracked nested worktree
   contents. **Fix:** generalized `ensureWorktreeIgnore(repoRoot, worktreesRoot)` in
   `src/worktrees.js` to compute the repo-relative path from `repoRoot` to the resolved
   `worktreesRoot` and append that exact entry (with trailing slash) instead of a fixed
   string. `addTicketWorktree` now calls it whenever `isChildPath(repoRoot,
   worktreesRoot)` is true — i.e. for any resolved root inside the repo (the `"inside"`
   layout and any explicit in-repo location), not just the literal `"inside"` constant.
   Locations resolving inside `plans/` remain rejected upstream by `worktreesRootFor`,
   unchanged. Added `test/worktrees.test.js`: "worktree-add ignore-guards an explicit
   in-repo worktrees.location and leaves git status clean" — uses
   `{ location: "custom-worktrees" }`, asserts the `.gitignore` gains a
   `custom-worktrees/` line and `git status --porcelain` in the main root shows no
   `custom-worktrees` entries after `worktree-add`.

3. **Non-blocking test gap (closed as cheap):** added append-path coverage for
   `ensureWorktreeIgnore` — "worktree-add appends the ignore entry to a board with no
   existing .gitignore" (removes the scaffolded `.gitignore`, runs `worktree-add` with
   `location: "inside"`, asserts the file is created containing exactly `.worktrees/\n`)
   and "worktree-add appends the ignore entry to an existing .gitignore lacking a
   trailing newline" (rewrites `.gitignore` to `"node_modules/\n*.log"` with no
   trailing newline, runs `worktree-add`, asserts the result is
   `"node_modules/\n*.log\n.worktrees/\n"` — confirms the newline-insertion branch is
   exercised, not just the already-covered "file already ends with \n" case).

**Deliberately not changed** (explicitly out of scope for this rework pass, called out
in the review as non-blocking and carried forward unresolved):
- Mixed-mode drift (`worktree-remove`/`worktree-list` derive one expected path from
  current config; switching `location` with worktrees still registered under the old
  root makes them invisible). No warning added.
- The `test/git.test.js:27` fixture change from the original implementation pass
  (confirmed by review as not a regression) was left as-is.

**Verification (rework)**
- `npm run check`: pass (all `node --check` targets clean).
- `npm test`: 171/171 pass (0 fail, 0 skipped) — up from 167 (+4 new tests: 1 in
  `test/tickets.test.js`, 3 in `test/worktrees.test.js`).
- `npm run validate`: `Ticket validation OK`.

## Review Findings

Reviewed by codex-task:read-only (gpt-5.5) against commit 1c4feba. Verdict: changes_requested.

Blocking findings:
1. `initProject(..., { overwrite: true })` can overwrite a user's existing root `.gitignore`: the new entry lives in the generic scaffold FILES map (src/scaffold.js:8) and every FILES entry is written with flag "w" under overwrite (src/scaffold.js:199, :216). `local-board init --overwrite` in an existing repo can replace unrelated ignore rules with the template. Fix: handle .gitignore separately — skip existing or append the `.worktrees/` line idempotently, never clobber. Add an overwrite regression test.
2. Explicit in-repo paths get no ignore guard: `addTicketWorktree` calls `ensureWorktreeIgnore` only when location === "inside" (src/worktrees.js:45) and the helper hard-codes `.worktrees/` (:17, :64). `"location": "custom-worktrees"` creates an in-repo root that leaves the parent checkout dirty with untracked nested worktree contents — reintroducing dirty-tree failures and accidental-commit risk. Fix: reject explicit paths under the repo except "inside", or append the correct relative ignore entry for any in-repo root outside plans/. Add a clean-status test for an explicit in-repo location (current explicit coverage only uses an outside path, test/worktrees.test.js:462).

Non-blocking observations:
- test/git.test.js:27 fixture change is NOT evidence of a normal-init papercut: init already creates untracked plans/ files and ensureGitBranch already refuses dirty trees; behavior is equivalent. The --overwrite clobber above is the real regression.
- Mixed-mode drift: worktree-remove derives one expected path from current config (:96), worktree-list filters to the configured root (:117, :131) — switching location with registered worktrees makes old ones invisible/removed:false. Docs should warn to remove worktrees before changing location, or the CLI should warn when registered worktrees exist outside the configured root.
- Test gap: inside-layout tests cover the seeded .gitignore path but not the append path (no-.gitignore board; existing file without trailing newline).

Confirmed correct: relative explicit paths resolve against repoRoot (:176); "inside" constant (:172); mint-offset uses the git main worktree before config (:210); CodexSupport.md recommends inside layout for workspace-write.

Verdict: changes_requested

- 2026-07-07T15:56:01Z: Re-review (codex) narrowed to one remaining edge: gitignore idempotency must accept an existing equivalent entry without trailing slash (worktrees.js:83-90, scaffold.js:250-258). Looping back for a surgical fix.

- 2026-07-07T16:02:11Z: Final re-review (codex): bare-entry idempotency fix verified in both helpers, tests cover the no-op cases, no new issues. Verdict: pass.

## Test Evidence

Tested by claude-subagent:local-board-tester (sonnet) on branch local-board/B20260707T1319Z-..., commits 1c4feba + 6081724 + 9d09553.

**Suite:** `npm run check` pass; `npm test` 173/173 pass; `npm run validate` OK.

**Independent end-to-end probe (throwaway git repo):**
- Sibling default: worktree lands at `<parent>/<repo>-worktrees/<id>`; list finds it; remove works.
- Inside layout: worktree lands at `<repo>/.worktrees/<id>`; .gitignore entry present exactly once; `git status --porcelain` empty (no worktree noise); list/remove work.
- Bare-entry idempotency: pre-seeded `.worktrees` (no slash) — .gitignore byte-identical (sha256-verified) after worktree-add.
- plans/-interior rejection: exit 2 with a clear actionable error message.
- Probe repo removed; project repo untouched.

**Docs check:** docs/CodexSupport.md "Worktrees and the sandbox" section covers all three location values, the sibling layout's writable_roots requirement, and recommends "inside" for Codex parallel runs; stale Limits claim reworded.

**Acceptance:** config option verified live; sibling back-compat intact; gitignore guard idempotent across slash/bare forms; clear rejection for plans/ paths; docs state the required Codex config. Actual Codex sandbox execution is out of scope in this environment — acceptance satisfied via the inside layout + documentation, per the ticket's own framing.

**Gaps / caveats:** init --overwrite clobber protection verified via unit tests only (adequate); mixed-mode drift and git clean -fdx exposure remain documented residual risks, out of scope per three review passes.

Result: pass

## Documentation Updates

Documented by codex-task:workspace-write (gpt-5.5).

- `docs/CodexSupport.md` — "Worktrees and the sandbox" section added during implementation: all three worktrees.location values, the sibling layout's sandbox_workspace_write.writable_roots requirement, and the "inside" recommendation for Codex parallel runs.
- `memory-bank/systemPatterns.md` — mint-offset wording generalized from sibling worktrees to ticket worktrees under the configured worktrees root; Parallel Mode section checked, already path-agnostic.
- `memory-bank/techContext.md` — one terse constraint line for worktrees.location (sibling default | inside .worktrees | explicit non-plans/ path).
- `README.md` — checked; no concrete worktree paths mentioned; unchanged.

## Questions

## Run Log

- 2026-07-07T15:33:49Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): worktrees.location config (sibling default | inside .worktrees | explicit path), threading through four placement consumers, gitignore seeding, CodexSupport doc for writable roots; discovery verified safe from double-count. Estimate 4 (basis B20260707T1318Z).

- 2026-07-07T15:34:40Z: Ensured git branch local-board/B20260707T1319Z-worktrees-are-created-outside-the-workspace-root-breaking-the-codex-workspace-write-sandbox (created).

- 2026-07-07T15:42:54Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Implementer (sonnet): worktrees.location config threaded through all placement consumers; gitignore seeding; CodexSupport sandbox docs; 167/167 tests green (+15).

- 2026-07-07T15:47:07Z: Completed review via codex-task:read-only: Codex (gpt-5.5, read-only) verdict changes_requested: init --overwrite can clobber user .gitignore; explicit in-repo worktree paths lack the ignore guard. Two blocking fixes + test additions specified in Review Findings.

- 2026-07-07T15:47:16Z: Ensured git branch local-board/B20260707T1319Z-worktrees-are-created-outside-the-workspace-root-breaking-the-codex-workspace-write-sandbox (already-current).

- 2026-07-07T15:53:31Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Rework (sonnet): dedicated append-only .gitignore scaffold path; ensureWorktreeIgnore generalized to any in-repo root; 4 new tests; 171/171 green.

- 2026-07-07T15:56:01Z: Completed review via codex-task:read-only: Re-review (gpt-5.5): both prior blockers fixed; one residual edge — no-slash equivalent gitignore entries not treated as present. changes_requested, scoped to that edge.

- 2026-07-07T15:56:01Z: Ensured git branch local-board/B20260707T1319Z-worktrees-are-created-outside-the-workspace-root-breaking-the-codex-workspace-write-sandbox (already-current).

- 2026-07-07T16:00:32Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Second rework (sonnet): both gitignore presence checks accept the bare (no-slash) equivalent entry; 2 new byte-identical tests; 173/173 green.

- 2026-07-07T16:02:11Z: Completed review via codex-task:read-only: Final re-review (gpt-5.5): verdict pass — both blockers and the residual bare-entry edge verified fixed across three review passes.

- 2026-07-07T16:06:45Z: Completed test via claude-subagent:local-board-tester@sonnet: Tester (sonnet): 173/173 green; live probe of all three layouts, byte-identical gitignore idempotency, plans/ rejection, and CodexSupport docs verified. Result: pass.

- 2026-07-07T16:08:39Z: Completed document via codex-task:workspace-write: Codex (workspace-write): CodexSupport sandbox section (impl pass) + memory-bank generalization; README checked unchanged.
