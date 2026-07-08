---
id: T20260707T1336Z
type: task
status: done
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260707T1336Z-skills-dedupe-cli-command-blocks-across-skill-texts
estimate: 2
estimateBasis: T20260707T1329Z
workStartedAt: 2026-07-08T03:42:54Z
workCompletedAt: 2026-07-08T04:37:27Z
created: 2026-07-07T13:36:55Z
updated: 2026-07-08T04:37:27Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", review:codex-task:read-only, "test:claude-subagent:local-board-tester@sonnet", gate:test:skipped-empty-catalog, document:codex-task:workspace-write]
routingApprovals: []
---
# skills: dedupe CLI command blocks across skill texts

## Requirement

Four overlapping skill texts have no single source and are already drifting: the CLI command block is duplicated verbatim in `SKILL.md:231-255` and `skills/codex/local-board/SKILL.md:157-181`, and both omit `worktree-add`/`worktree-remove`/`worktree-list`, `fast-forward`, `team-config`, `list`, and `next` — commands the team skills rely on. The skills also say "use schema --json, don't inspect source", which makes the long duplicated block redundant.

Fix: shrink the command blocks to the core loop plus a pointer to `--help`/`schema --json`, or generate the blocks from `src/cli.js` usage text in CI (a check that fails when skill blocks drift from the usage output). Also restructure the SKILL.md Branch Discipline ordering rule as a numbered sequence (the codex skill's form is clearer), pending T20260707T1332Z which removes the rule entirely.

Acceptance: command documentation exists in one authoritative place (or is generated/CI-checked); no skill lists a stale command set.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Technical Design

### Problem (re-surveyed against current texts)

The requirement was written before the recent skill overhaul (PATH invocation, `version`/`where`/`gate-complete`/`check-dispatch`, skip flags, `--model`). Re-diffing the live texts against the authoritative surface (`src/cli.js` `printUsage`, lines 1227-1270) shows the drift is now **omission and cross-file duplication, not stale/removed commands**:

Authoritative command names in `printUsage` (37): `--version, where, validate, list, next, query-next, query-ticket, state-report, schema, init, install, create, start-work, worktree-add, worktree-remove, worktree-list, fast-forward, team-config, begin-step, complete-step, approve-inline, check-dispatch, move, set, comment, section, link-parent, link-child, unlink-parent, block, unblock, estimate, gate-check, gate-complete, specialty-run, calibration suggest`.

Both fenced `## CLI Commands` blocks — `SKILL.md:255-281` and `skills/codex/local-board/SKILL.md:160-186` — list the **same 24-command set**: `validate, query-next, query-ticket, state-report, schema, create, start-work, begin-step, check-dispatch, complete-step, approve-inline, gate-check, gate-complete, specialty-run, calibration suggest, estimate, move, set, section (x2), comment, link-parent, link-child, block, unblock`. The only line-level difference is `begin-step` carrying `[--harness claude|codex]` in the codex copy.

**Missing from both blocks (in usage, not in block), 12:** `--version, where, list, next, init, install, worktree-add, worktree-remove, worktree-list, fast-forward, team-config, unlink-parent`.

**Stale in either block (in block, not in usage):** none today. Every listed command still exists. So the current defect is (a) the two blocks can silently diverge from each other, and (b) they can go stale on a future rename/removal — neither is currently guarded.

Scope check on the other texts:
- `SKILL_TEAM.md` (local-team parallel skill) carries **no** fenced CLI Commands block. It references `worktree-add/remove/list`, `fast-forward`, `team-config`, `list` inline in prose. Per the scope guard, no block to align — leave it.
- The worktree/`team-config`/`fast-forward`/`list` commands are **team-mode** surface. The two single-ticket skills legitimately do not use them in their own loops; adding them to the single-ticket blocks would re-bloat exactly what the requirement wants trimmed.

### Decision: (a) curate + a narrow drift-guard test (reject full generation (b))

Recommended: **shrink/curate each single-ticket block to the single-ticket command surface, add an explicit "not exhaustive" pointer, and add one structural drift-guard test** modeled on the `test/resources-sync.test.js` precedent.

Reject full generation-from-usage (option (b) in its strong form): regenerating the blocks from `printUsage` would auto-flood both with every future command (worktree/team-mode), re-bloating them and coupling skill prose formatting to CLI usage formatting — the opposite of the requirement's intent ("the long duplicated block redundant"). A curated block plus a *directional* guard keeps the blocks small, audience-appropriate, and safe.

The guard asserts two things, which together satisfy the acceptance criteria without forcing exhaustiveness:
1. **Mutual consistency:** the command-name set of the `SKILL.md` block equals the command-name set of the `skills/codex/local-board/SKILL.md` block. Directly kills "duplicated and drifting apart."
2. **Subset-of-truth:** every command name in each block exists in the authoritative `printUsage` surface. Directly enforces "no skill lists a stale command set" — a rename/removal that leaves a block referencing a dead command fails CI.

Exhaustiveness (blocks listing *all* commands) is deliberately **not** asserted: curated omission is the design, covered by the pointer line. This is why the guard is subset, not equality-with-usage.

### Curated block content

Keep each single-ticket block, trimmed to the single-ticket orchestrator surface, and add three commands the single-ticket prose already invokes or that pair with listed commands:
- add `where` and `--version` (both referenced in the version-skew / `where --json` prose at the top of each skill);
- add `unlink-parent` for symmetry with the already-listed `link-parent`/`link-child`/`block`/`unblock`.

Explicitly **exclude** `worktree-add/remove/list`, `fast-forward`, `team-config`, `list`, `next`, `init`, `install` from the single-ticket blocks (setup/team-mode surface), and add a pointer line under each block, e.g.:

> This block is the single-ticket command surface, not the full CLI. Run `local-board` with no arguments for complete usage, `schema --json` for accepted enums, and `where --json` for asset paths. Worktree, `fast-forward`, `team-config`, and `list` live in the parallel (`local-team`) skill. Do not inspect source to discover commands.

Net curated set per block ≈ 27 names (current 24 + `where` + `--version` + `unlink-parent`). Both blocks must carry the identical name set (line differences like `begin-step [--harness ...]` are fine; the guard compares names, not lines).

### Guard-test implementation

New file `test/skill-usage-sync.test.js` (Node built-in `node:test`, matching repo style):

1. Obtain the authoritative name set. Preferred: add a tiny **test-support export** to `src/cli.js` — export either the raw usage template string or a derived `usageCommandNames()`/`COMMAND_NAMES` array — so the test does not spawn a process or scrape stderr. This is the only production touch and is inert at runtime (no behavior change; `printUsage` keeps rendering from the same source). Fallback if we want zero prod change: `execFileSync("node", ["bin/local-board.js"])`, capture stderr, and parse — more fragile, so the export is recommended.
2. Extract names from usage lines with a regex that takes the first token after `local-board`, skipping an optional `[--root <path>]`, and special-casing `--version` and the two-word `calibration suggest`.
3. Extract each skill block: read `SKILL.md` and `skills/codex/local-board/SKILL.md`, slice the fenced ```` ```sh ```` block that follows the `## CLI Commands` heading, and pull command names with the same tokenizer (handling the duplicated `section` line and `calibration suggest`).
4. Assertions: `assert.deepEqual(codexNames, skillNames, ...)`; then for each set assert it is a subset of the usage names, with a message pointing at the offending command and the block file. Failure messages should name the fix ("update the CLI Commands block in <file> to match printUsage / the sibling skill"), mirroring the resources-sync "run npm run sync-resources" guidance.

No generation script and no `resources/` mirror are involved — the skills are shipped directly (`install.js` copies `SKILL.md`; `package.json` `files` includes it), so this is a pure read-only CI check, not a sync step.

### Affected files

- `SKILL.md` — retrim `## CLI Commands` block to the curated set; add pointer line.
- `skills/codex/local-board/SKILL.md` — same edit, keeping the `begin-step --harness` variant.
- `src/cli.js` — small test-support export of the usage command-name list/string (no runtime behavior change). Optional if the test spawns the binary instead.
- `test/skill-usage-sync.test.js` — new drift-guard test.
- `SKILL_TEAM.md` — no change (no block; scope guard).

### Out of scope / deferred

The requirement's secondary ask — restructure `SKILL.md` "Branch Discipline" ordering rule into a numbered sequence — is explicitly contingent on `T20260707T1332Z`, which removes that rule entirely. Do **not** touch Branch Discipline here; editing text another in-flight ticket deletes invites a merge conflict. Track it there. (Open question below.)

### Risks

- **Usage-text parse fragility.** Mitigated by exporting the name list from `src/cli.js` rather than scraping stderr; the tokenizer must special-case `--version`, `calibration suggest`, and the `[--root <path>]` prefix, or it will mis-extract and either false-pass or false-fail.
- **Independent shipping of the two skills.** They install to different agents and cannot share one source file without a build step, so mutual-set-equality is the pragmatic substitute for true single-sourcing; a divergent-but-valid edit to one block will (correctly) fail the equality assertion and force the author to update both.
- **Curation judgment.** Choosing to exclude team-mode commands assumes the single-ticket audience never needs them at hand; the pointer line mitigates by naming where they live. If a future single-ticket flow adopts a worktree command, add it to both blocks and the equality guard still holds.
- **Low blast radius otherwise** — docs + one test + an inert export; no ticket-state, routing, or git logic touched.

### Test strategy

- New `test/skill-usage-sync.test.js`: (1) both blocks have equal name sets; (2) each block ⊆ usage names; (3) a guard that the extracted usage set and block sets are non-empty (mirrors resources-sync's "directories not empty" guard against a silently-broken parser).
- Manually confirm the curated blocks render and the pointer line is present in both skills.
- Run full `node --test` to ensure the `src/cli.js` export change breaks nothing (`test/cli.test.js`, `install.test.js`, `pack.test.js` exercise adjacent surface).
- `npm run check` (node --check) after the `src/cli.js` edit.

### Open questions

- Confirm the curated inclusion set: is adding `where`, `--version`, `unlink-parent` to the single-ticket blocks (and excluding worktree/`team-config`/`fast-forward`/`list`) the intended trim, or should the blocks stay at the current 24 and rely purely on the pointer? (Recommendation above assumes the former.)
- Confirm Branch Discipline restructuring is owned by `T20260707T1332Z` and should be left untouched here.

## Implementation Notes

Implemented per the design's curated-inclusion-set decision (reject full generation).

Files changed:
- `SKILL.md`: `## CLI Commands` block retrimmed to the curated 27-name single-ticket surface (added `--version`, `where [--json]`, `unlink-parent`; kept the existing 24). Added a pointer line under the fence directing to `local-board` (no args), `schema --json`, `where --json`, and naming that worktree/`fast-forward`/`team-config`/`list` live in the `local-team` skill.
- `skills/codex/local-board/SKILL.md`: identical retrim, keeping the `begin-step <ticket-id> [--action <action>] [--harness claude|codex] [--json]` variant. Same pointer line added.
- `SKILL_TEAM.md`: untouched (no fenced block; out of scope per design).
- `src/cli.js`: refactored `printUsage()`'s inline template literal into a module-level `USAGE_TEXT` constant (byte-identical content, zero behavior change) and added a new exported `usageCommandNames()` — a test-support-only function that tokenizes `USAGE_TEXT` into the 36 unique authoritative command names (handles the `[--root <path>]` prefix, `--version`, and the two-word `calibration suggest`). `printUsage()` now just logs `USAGE_TEXT`; runtime output is unchanged.
- `test/skill-usage-sync.test.js` (new): modeled on `test/resources-sync.test.js`. Reads both skill files, extracts the fenced ` ```sh ` block under `## CLI Commands` with the same tokenizer logic, and asserts (1) the two blocks' command-name sets are deep-equal, (2) each block's name set is a subset of `usageCommandNames()`, with failure messages naming the offending file/command and pointing at "update the CLI Commands block ... to match printUsage / the sibling skill", and (3) both the usage set and each block are non-empty (broken-parser guard, mirroring resources-sync's directory-not-empty check).

Tests added: 3 new tests in `test/skill-usage-sync.test.js`. Full suite: 384 tests total, 383 pass, 1 pre-existing skip (unrelated smoke test), 0 fail.

Verification:
- `npm run check` — clean (no output = all `node --check` calls passed).
- `npm test` — 384 tests, 383 pass, 1 skip, 0 fail.
- `npm run validate` — "Ticket validation OK".

Perturbation probe: appended a bogus line `local-board bogus-command <ticket-id>` to the `SKILL.md` fenced block only, reran `node --test test/skill-usage-sync.test.js`. Both the equality test and the subset test failed as expected:
- equality test: `AssertionError` diffing the two name arrays, showing `bogus-command` present only in the `SKILL.md`-derived (expected) side.
- subset test: `AssertionError`: `SKILL.md lists "bogus-command" in its CLI Commands block, but it is not in local-board's usage output; update the CLI Commands block in SKILL.md to match printUsage / the sibling skill`.
Reverted the perturbation immediately after confirming the failure; reran the three tests plus `npm run check`/`npm test`/`npm run validate` to confirm the clean pass shown above.

Deviations from the design: none. Followed the curated-inclusion recommendation (add `where`, `--version`, `unlink-parent`; exclude worktree/team-config/fast-forward/list/next/init/install) and left Branch Discipline / SKILL_TEAM.md untouched as directed.

Risks: the block tokenizer in the test and the `usageCommandNames()` tokenizer in `src/cli.js` are independent implementations of the same regex idea (by design — the test must not import private skill-block-parsing code, and `usageCommandNames()` only ever needs to parse `USAGE_TEXT`). A future change to either regex without updating the other could reintroduce silent drift in the parsing logic itself, though the non-empty guard test would catch a fully-broken parser.

## Review Findings

Reviewed by codex-task:read-only (gpt-5.5) on commit 8109d1e (post mainline reconciliation).

- [P2] `test/skill-usage-sync.test.js:46-52` reduces each skill block to a sorted Set of command names and compares only that derived set. This misses the accepted requirement that the two fenced command blocks stay byte-identical and that presentation drift fails CI. The current tree already demonstrates the false pass: `SKILL.md:265` lists `begin-step <ticket-id> [--action <action>] [--json]` while `skills/codex/local-board/SKILL.md:170` lists `begin-step <ticket-id> [--action <action>] [--harness claude|codex] [--json]` (drift introduced by the T1335 mainline merge). Fix: extract the fenced block text and assert exact normalized byte equality alongside the command-name subset check, and re-sync the two blocks.

Additional checks (pass):
- Curated set is 27 unique names and includes the critical commands (`start-work`, `check-dispatch`, `approve-inline`, `gate-check`, `gate-complete`, `unlink-parent`). No stale names vs the CLI dispatch/usage surface (`src/cli.js:62-170`, `src/cli.js:1228-1264`).
- Pointer line present in both files (`SKILL.md:286`, `skills/codex/local-board/SKILL.md:191`) referencing `schema --json` and `where --json`.
- `resources/skills/local-board/SKILL.md` does not exist; packaging uses root `SKILL.md` + `skills/codex/local-board/SKILL.md`, and `test/resources-sync.test.js:58-64` mirrors prompts/templates only — no mirror gap.
- Reviewer sandbox could not spawn `node --test` (read-only EPERM); verification was source inspection.

Verdict: changes_requested

## Test Evidence

Verified by claude-subagent:local-board-tester (sonnet).

### Repo-level checks

| Command | Result |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS — 385 tests, 384 pass, 0 fail, 1 skipped (pre-existing gated smoke) |
| `npm run validate` | PASS — Ticket validation OK |

### Baseline

- Blocks in `SKILL.md:253-284` and `skills/codex/local-board/SKILL.md:158-189` are byte-identical after `normalizeEol`; 28 command lines / 27 unique names (two `section` forms share one name).
- Critical commands present: `start-work`, `check-dispatch`, `approve-inline`, `gate-check`, `gate-complete`.
- `begin-step` line includes `[--harness claude|codex]` in both files.

### Anchoring probe

Both files have an unrelated ` ```sh ` fence near the top (lines 12-14 / 10-12) before the `## CLI Commands` heading; a naive first-fence extraction would grab those. The test anchors via `indexOf("## CLI Commands")` + regex from that offset (`test/skill-usage-sync.test.js:25-34`) — correct.

### Mutation probes (edit → targeted test run → assert FAIL → revert via `git checkout --` → re-run green)

- (a) Trailing space on one line in root SKILL.md only → byte-identical test FAILED with canonical-file guidance message; reverted, 4/4 green.
- (b) Fake `local-board frobnicate <id>` added identically to both blocks → byte-identical PASSED, subset-of-usage FAILED naming `frobnicate`; reverted, 4/4 green.
- (c) `unblock` line removed from codex SKILL.md only → both list-same-commands and byte-identical FAILED (26 vs 27 names, diff shows the missing entry); reverted, 4/4 green.

### Gaps / caveats

- Mutation edits performed via inline Node fs scripts (tester has no Write tool; avoids shell backtick mangling of fences); every probe diffed before testing and reverted exactly, `git status` clean of tester changes after each.
- No flakes across three full suite runs.

Result: pass

## Documentation Updates

Documented by codex-task:workspace-write (gpt-5.5).

- `memory-bank/systemPatterns.md` — terse current-state fact: curated 27-command byte-identical skill blocks, enforced by test/skill-usage-sync.test.js, root SKILL.md canonical.
- `docs/CodexSupport.md` — one maintenance sentence: keep the root and Codex skill CLI command blocks in lockstep.
- README Documentation Index — verified, no change needed (no new doc file).

## Questions

## Run Log

- 2026-07-08T03:42:06Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): curated single-ticket command blocks + pointer line + structural drift-guard test (skill-usage-sync) asserting block-name-set equality and subset-of-printUsage; drift enumerated (12 omissions, no stale entries); T1332 restructure already landed so out of scope. Estimate 2 (basis T20260707T1329Z).

- 2026-07-08T03:42:54Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (docs + test hygiene)

- 2026-07-08T03:42:54Z: Ensured git branch local-board/T20260707T1336Z-skills-dedupe-cli-command-blocks-across-skill-texts (created).

- 2026-07-08T03:48:07Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Implementer (sonnet): curated blocks + pointer + skill-usage-sync drift guard with a verified failure probe; 383 pass + 1 gated-skip.

- 2026-07-08T03:49:13Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (docs + test hygiene)

- 2026-07-08T04:27:33Z: Invalidated downstream evidence on loop-back to ready_for_implementation: removed completedSteps [implement:claude-subagent:local-board-implementer@sonnet, gate:implement:claude-subagent:local-board-gatecheck@haiku].

- 2026-07-08T04:27:34Z: Ensured git branch local-board/T20260707T1336Z-skills-dedupe-cli-command-blocks-across-skill-texts (already-current).

- 2026-07-08T04:30:38Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Rework: re-synced begin-step line (--harness) across both blocks; anchored extraction + normalizeEol byte-identical assertion; 384 pass + 1 skip

- 2026-07-08T04:31:33Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (skill Markdown + test only)

- 2026-07-08T04:31:33Z: Completed review via codex-task:read-only: changes_requested (P2: name-set-only comparison, blocks had drifted) on 8109d1e; addressed in rework commit (byte-identical assertion + re-sync); recorded post-move per evidence-invalidation ordering

- 2026-07-08T04:35:43Z: Completed test via claude-subagent:local-board-tester@sonnet: 384 pass + 1 skip; mutation probes a/b/c all caught by the sync tests; anchoring verified; blocks byte-identical with 27 unique commands

- 2026-07-08T04:37:27Z: Completed document via codex-task:workspace-write: systemPatterns lockstep fact; CodexSupport maintenance sentence; README index verified unchanged
