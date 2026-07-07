---
id: T20260707T1331Z
type: task
status: done
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260707T1331Z-cli-guard-against-wrong-root-when-a-ticket-has-a-registered-worktree
estimate: 4
estimateBasis: T20260707T1328Z
workStartedAt: 2026-07-07T23:22:26Z
workCompletedAt: 2026-07-07T23:56:23Z
created: 2026-07-07T13:31:54Z
updated: 2026-07-07T23:56:23Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "implement:claude-subagent:local-board-implementer@sonnet", review:codex-task:read-only, "test:claude-subagent:local-board-tester@sonnet", gate:test:skipped-empty-catalog, document:codex-task:workspace-write]
routingApprovals: []
---
# cli: guard against wrong --root when a ticket has a registered worktree

## Requirement

`--root` defaults to `"."` (`src/cli.js:46`) and parallel-mode correctness rides on the model remembering to pass `--root <worktreePath>` on every per-ticket call (`SKILL_TEAM.md:78-87`). One forgotten flag silently mutates the mainline checkout's copy of the ticket instead of the worktree copy, and nothing detects the divergence. Related trap: `worktree-remove` is the lone per-ticket command that must NOT take the worktree root.

Fix: the CLI already knows worktree assignments (`worktree-list`); for per-ticket mutation commands, refuse or warn when the ticket has a registered worktree and the invocation root is not that worktree. For `worktree-remove`, auto-resolve the main root when invoked with a worktree root (`mainRootFor` logic exists in `src/worktrees.js:148-160`).

Acceptance: mutating a worktree-assigned ticket from the wrong root is refused (with an override flag) or loudly warned; `worktree-remove` works when given either root; tests cover both.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Problem restated

`--root` defaults to `"."` (`src/cli.js:53`). In parallel mode, per-ticket
correctness depends on the model passing `--root <worktreePath>` on every call
(`SKILL_TEAM.md:73-77`). A single forgotten flag makes a mutation write the
**mainline** checkout's copy of the ticket instead of the worktree copy, and
nothing detects the divergence. The CLI already knows worktree assignments
(`git worktree list`), so it can detect and refuse this. The dual trap:
`worktree-remove` is the one per-ticket command that must run against the **main**
root, not the worktree root.

## Approach

Add one read-only guard, invoked at the **CLI command layer**, plus a targeted
fix to `worktree-remove`.

### 1. Guard: `assertInvocationRootForTicket(root, ticketId, { allowMainRoot })`

New exported function in `src/worktrees.js` (it already owns
`listRegisteredWorktrees`, `worktreesRootFor`, `ticketWorktreePath`). Algorithm:

1. `config = loadConfig(root)`. If `config.worktrees.guardWrongRoot !== true`,
   return immediately (feature off → zero behaviour change).
2. `mainRoot = resolveMainRoot(root)` (imported from `src/lock.js`; the
   `git rev-parse --git-common-dir` parent — identical for the mainline checkout
   and every linked worktree of the same repo, and it falls back to `root` on git
   failure).
3. `expected = ticketWorktreePath(mainRoot, ticketId, config.worktrees.location)`.
4. `registered = findRegisteredWorktree(mainRoot, expected)` (existing helper,
   matches by resolved path against `git worktree list --porcelain`). If `null`,
   **no worktree exists for this ticket → return** (single-ticket / solo mode is
   completely unaffected — the guard only ever binds when a worktree for *that*
   ticket is registered).
5. `invocationTop = resolve(gitOutput(root, ["rev-parse","--show-toplevel"]))`.
   If it equals `resolve(expected)`, the caller is in the ticket's own worktree →
   return (the correct case).
6. Otherwise a worktree exists but we are mutating from the wrong tree (mainline,
   or another ticket's worktree). If `allowMainRoot` is set, return; else throw a
   message naming both the offending root and the fix (see Error text).

Any git failure in steps 2/4/5 is swallowed and the guard **fails open**
(no-ops): the guard is a safety net, not a correctness gate, and must never break
non-git fixtures or degraded environments.

**Why the CLI layer, not `tickets.js` or `lock.js`:** `--root` is a CLI concept;
the "invocation root vs registered worktree" mismatch only exists at the CLI
boundary. `cli.js` already imports `worktrees.js`, so no new import cycle.
Invoking the guard from `tickets.js` would create a
`tickets.js → worktrees.js → tickets.js` cycle (worktrees.js already imports
`discover`/`findTicket`/`setTicketField` from tickets.js), and putting it in
`lock.js` would pull worktree logic into the lock primitive and risk the same
cycle. The guard is invoked once inside each mutating command handler, right
after that handler has parsed its `ticketId` (parsing the id there avoids the
fragility of positional-peeking in `main()`, where `move --json T… done` would
put a flag in `args[0]`).

**Guarded commands** (mutate the ticket *file* on disk): `start-work`,
`complete-step`, `move`, `set`/`update-field`, `comment`, `section`, `estimate`,
`approve-inline`, `gate-complete`, `link-parent`, `link-child`, `unlink-parent`,
`block`, `unblock`. Two-ticket commands guard **both** ids.

**Not guarded:** `begin-step` (stamps only the active-steps ledger, which is
already anchored at `mainRoot` via `resolveMainRoot`, so a wrong-root call is
harmless), read-only queries, `worktree-*`, `fast-forward`, `validate`, `list`.

**Override flag:** `--allow-main-root`, parsed with `takeFlag` in `main()`
alongside `--root` and threaded to the guarded handlers (add it to
`printUsage`). It is the deliberate escape hatch for the rare legitimate
mainline edit.

### 2. `worktree-remove` main-root auto-resolution

`removeTicketWorktree` (`src/worktrees.js:106`) currently derives its working
root from `gitOutput(root, ["rev-parse","--show-toplevel"])`. When invoked with
`--root <worktreePath>` that returns the worktree itself, and
`git worktree remove <worktreePath>` then targets the checkout it is standing in.
Fix: resolve the repo's **main** root with `resolveMainRoot(root)` and run all
`git worktree` operations (`findRegisteredWorktree`, `worktree remove`) from
there. Result: `worktree-remove` works given **either** the main root or the
ticket's worktree root, removing the SKILL_TEAM "exception" the model must
currently remember.

### 3. Config wiring (`src/config.js`) — scaffold true / merge-fallback false

- `DEFAULTS.worktrees` (line 284): add `guardWrongRoot: false`. Older boards that
  omit the key keep today's behaviour (non-breaking).
- `normalizeWorktrees` (line 485): currently rebuilds `merged.worktrees =
  { location }`, which would silently drop the new key. Extend it to carry
  `guardWrongRoot`, defaulting to `false` and validating it is a boolean.
- Scaffold template `defaultConfigJsonc` (the `"worktrees"` block near line 898):
  emit `"guardWrongRoot": true` with a one-line comment, so **newly initialized**
  boards get the protection on by default. Because the guard is a no-op when no
  worktree exists for the ticket, this costs solo/single-ticket users nothing.

### Error text

> refusing to mutate `<ticketId>` from `<invocationTop>`: this ticket has a
> registered worktree at `<expected>`. Re-run with `--root <expected>`, or pass
> `--allow-main-root` to override.

Names the expected root and the override exactly, per acceptance.

## Affected files

- `src/worktrees.js` — new `assertInvocationRootForTicket`; import
  `resolveMainRoot`; export it; rework `removeTicketWorktree` to use
  `resolveMainRoot`.
- `src/cli.js` — parse `--allow-main-root` in `main()`; call the guard in each
  guarded handler after `ticketId` is parsed; usage text.
- `src/config.js` — `DEFAULTS`, `normalizeWorktrees`, `defaultConfigJsonc`.
- Tests: `test/worktrees.test.js`, `test/cli.test.js`, `test/config.test.js`.
- Docs: `SKILL_TEAM.md` (simplify the `--root` discipline + drop the
  worktree-remove exception), `memory-bank/systemPatterns.md` if it records the
  worktree/root contract.

## Related tickets

- **B20260707T1319Z** (done): introduced `worktrees.location` config and
  `worktreesRootFor`/`ticketWorktreePath` — the placement machinery this guard
  reuses to compute the expected worktree path.
- **T1336** (skill dedup, pending): this guard is the enabling change that lets
  `SKILL_TEAM.md` shed the fragile "remember `--root` on every per-ticket call"
  prose and the "`worktree-remove` is the exception" caveat.

## Risks / edge cases

- **Extra git spawn per mutation.** One `git worktree list --porcelain` per
  guarded call when `guardWrongRoot` is enabled. Acceptable — mutations already
  spawn git for lock anchoring — and skipped entirely when the feature is off.
- **Fail-open on git errors.** Non-git fixtures or `worktree list` failures must
  no-op, never block. This is deliberate; the guard is a backstop.
- **Two-ticket cross-worktree divergence (known limitation).** `link`/`block`
  mutate *two* files. If ticket A has a worktree and parent B does not, invoking
  from A's worktree passes the guard (B has no worktree) yet still writes the
  worktree's copy of B's file. The guard reduces but does not fully eliminate
  cross-tree divergence. In practice the orchestrator runs `link`/`block` from
  the main root during decompose, before children get worktrees. Flagged as an
  open question below.
- **Removing the cwd on Windows.** If a user `cd`s into the worktree and runs
  `worktree-remove --root .`, the process cwd sits inside the tree being removed;
  Windows can refuse to delete a directory that is a live cwd. The documented
  flow passes `--root` without `cd`, so cwd stays at the main repo. Noted, not
  fixed here.
- **False positive.** A legitimate mainline edit while a worktree exists is
  refused; `--allow-main-root` is the intended relief.

## Test strategy

Reuse the `withRepo` git fixture in `test/worktrees.test.js` (real
`git init` + `worktree-add`).

- Guard refuses: `worktree-add`, then `move`/`section`/`comment`/`set` with
  `--root <mainRoot>` → non-zero exit, message names the expected worktree and
  `--allow-main-root`; assert the mainline ticket file is byte-unchanged.
- Override: same call with `--allow-main-root` → succeeds.
- Correct root: same call with `--root <worktreePath>` → succeeds.
- Zero-friction: no worktree for the ticket → mutation from the main root
  succeeds (single-ticket mode).
- Non-breaking: `guardWrongRoot` absent/false → wrong-root mutation succeeds.
- `worktree-remove` from the worktree root (`--root <worktreePath>`) → removes
  successfully; from the main root still works; a second call → `not-found`
  (idempotent).
- Fail-open: guard no-ops in a non-git dir.
- `test/config.test.js`: `normalizeWorktrees` preserves a boolean
  `guardWrongRoot`, rejects non-boolean, defaults `false`; `defaultConfigJsonc`
  contains `guardWrongRoot: true` and still parses.

## Documentation updates

- `SKILL_TEAM.md`: replace "pass `--root <worktreePath>` on every call or you
  silently corrupt mainline" with "the CLI refuses wrong-root per-ticket
  mutations when a worktree exists"; delete the `worktree-remove` exception note.
- `memory-bank/systemPatterns.md`: record the guard + the config switch if the
  worktree/root contract is documented there.

## Open questions

1. Refuse-by-default (recommended, strong contract) vs warn-only? This design
   refuses, gated by `worktrees.guardWrongRoot`. Confirm no warn-only mode is
   wanted.
2. Two-ticket cross-worktree writes (parent has no worktree): accept as a known
   limitation, or extend the guard to refuse any per-ticket mutation whose
   mainline target file differs from the invocation tree? The latter is a larger
   change.
3. Scaffold default `guardWrongRoot: true` for new boards — confirmed acceptable
   given it is a no-op without a matching worktree.

## Implementation Notes

Implemented per the Technical Design.

**`src/worktrees.js`**
- Imported `resolveMainRoot` from `./lock.js`.
- Added exported `assertInvocationRootForTicket(root, ticketId, { allowMainRoot })`: no-op unless `config.worktrees.guardWrongRoot === true`; resolves the ticket's expected worktree path from `resolveMainRoot(root)`; no-op when no worktree is registered for the ticket; no-op when the invocation root's toplevel matches the expected worktree; no-op when `allowMainRoot` is set; otherwise throws `refusing to mutate <ticketId> from <invocationTop>: this ticket has a registered worktree at <expected>. Re-run with --root <expected>, or pass --allow-main-root to override.` `loadConfig` failure and any git failure (worktree-list, rev-parse) are swallowed (fail-open).
- `removeTicketWorktree` now resolves its working root via `resolveMainRoot(root)` instead of `rev-parse --show-toplevel`, so `worktree-remove` works given either the main root or the ticket's own worktree root.

**`src/cli.js`**
- Parsed `--allow-main-root` in `main()` alongside `--root`, threaded to the 14 guarded handlers: `start-work`, `complete-step`, `move`, `set`/`update-field`, `comment`, `section`/`set-section`, `estimate`, `approve-inline`, `gate-complete`, `link-parent`, `link-child`, `unlink-parent`, `block`, `unblock`. Each calls `assertInvocationRootForTicket` right after parsing its ticket id(s) (two-ticket commands guard both ids) and before the mutation. `begin-step`, `worktree-*`, `fast-forward`, `validate`, `list`, `create`, `specialty-run` are unguarded per the design.
- `printUsage()` documents `--allow-main-root` on every guarded command line plus a trailing explanatory paragraph.

**`src/config.js`**
- `DEFAULTS.worktrees` gains `guardWrongRoot: false` (backward-compat default).
- `normalizeWorktrees` now destructures and validates `guardWrongRoot` as a boolean (throws `worktrees.guardWrongRoot must be a boolean` otherwise) and carries it through instead of dropping it.
- Scaffold `defaultConfigJsonc()`'s `"worktrees"` block now emits `"guardWrongRoot": true` with an explanatory comment — new boards get the guard on by default; this repo's own `plans/local-board.config.jsonc` was intentionally left untouched (only the scaffold template changed).

**Docs**
- `SKILL_TEAM.md`: noted the CLI-level backstop next to the `--root <worktreePath>` discipline; replaced the `worktree-remove --root <project-root>` "exception" example with `--root <worktreePath>` and a note that `worktree-remove` resolves the main root itself from either root.
- `memory-bank/systemPatterns.md`: added one terse line documenting the guard + `worktree-remove`'s main-root resolution under Safety Pattern.

**Tests**
- `test/worktrees.test.js`: added `worktree-remove resolves the main root and succeeds when invoked with the ticket's own worktree root`; guard refuse (exact message pieces: ticketId, expected worktree path, `--allow-main-root`) with mainline-file-byte-unchanged assertion; `--allow-main-root` override; correct-root success; no-worktree no-op; `guardWrongRoot: false` non-breaking no-op; `assertInvocationRootForTicket` fail-open in a non-git directory (direct unit call, no `GIT_AVAILABLE` skip needed). Guard tests move to the lateral `questions` status (not a routing-gated forward transition) to isolate the guard from the pre-existing `routing.requireGateConsultation` gate unrelated to this ticket.
- `test/config.test.js`: updated the two existing `worktrees` shape assertions to include `guardWrongRoot`; added `loadConfig preserves an explicit boolean worktrees.guardWrongRoot` and `loadConfig rejects a non-boolean worktrees.guardWrongRoot`; added `worktrees.guardWrongRoot` to both the `defaultConfigJsonc matches DEFAULT_CONFIG` allowlist and the collapsed-diff-paths assertion (the "guard-test allowlist").

**Verification**
- `npm run check`: pass.
- `npm test`: 324 tests, 323 pass, 1 skip (pre-existing, unrelated "smoke (slow)" race test), 0 fail.
- `npm run validate`: `Ticket validation OK`.

**Deviations / notes**
- `normalizeWorktrees` rejects an explicit `guardWrongRoot: null` as non-boolean (consistent with `estimation.enabled`'s existing strictness), rather than silently defaulting it — the design didn't specify null handling explicitly.
- Guard tests move tickets to `questions` (lateral) instead of a forward `ready_*` status to avoid tripping the unrelated `routing.requireGateConsultation` gate that the scaffold also enables by default; this is a test-isolation choice, not a behavior change.
- This repo's own `plans/local-board.config.jsonc` was not modified — only `DEFAULTS`/`defaultConfigJsonc()` in `src/config.js` changed, per the scaffold-only instruction.

## Rework (2026-07-07, review findings on commit 2baf88f)

Two fixes from review:

1. **BLOCKER — gate-check empty-catalog auto-stamp unguarded.** `commandGateCheck` now takes `allowMainRoot` and calls `assertInvocationRootForTicket(root, ticketId, { allowMainRoot })` immediately after arg validation, **before** the `catalog.length > 0` branch that decides between `assertPromptExists` (read-only) and `recordGateSkippedEmptyCatalog` (mutating). Guarding the whole command rather than only the mutating branch, per the review's explicit instruction and for parity with `gate-complete`, which is already guarded unconditionally. `main()`'s `gate-check` dispatch now passes `allowMainRoot` through; usage text and the `gate-check requires: ...` error string both gained `[--allow-main-root]`.
2. **Non-blocking — win32 case sensitivity.** Added a `pathsEqual(left, right)` comparer in `src/worktrees.js`: lower-cases both sides on `process.platform === "win32"`, compares as-is (case-sensitive) elsewhere. Applied at both flagged comparison sites: the guard's `invocationTop` vs `expected` check, and `findRegisteredWorktree`'s resolved-path match against `git worktree list --porcelain` output.

**Tests added** (`test/worktrees.test.js`, all `{ skip: !GIT_AVAILABLE }`):
- `gate-check refuses the empty-catalog auto-stamp from the main root when the ticket has a registered worktree` — wrong root + empty catalog (`--stage test`) refused with the same message shape as the `move` guard test; asserts the mainline ticket file is byte-unchanged.
- `gate-check --allow-main-root overrides the guard on the empty-catalog auto-stamp` — override succeeds and the skip token is stamped.
- `gate-check succeeds from the ticket's own registered worktree root on the empty-catalog auto-stamp` — correct root succeeds; asserts the stamp lands in the worktree's copy of the ticket file.

No new test needed for `pathsEqual` beyond the existing guard/worktree-add/worktree-remove suite: on this win32 dev machine every existing guard, `worktree-add`, and `worktree-remove` test already exercises the two touched comparison sites end-to-end (they were passing before only because `path.resolve` on this machine happens to preserve consistent casing from git's own output; the fix is defensive hardening against casing drift, e.g. a differently-cased drive letter or 8.3-name mismatch, that the existing fixtures do not deliberately provoke). Did not add a synthetic differently-cased-path unit test because doing so would require mocking `git worktree list --porcelain` output or fabricating a differently-cased filesystem path, which is brittle across platforms; the platform-gated `pathsEqual` helper itself is a 5-line pure function reviewed by inspection.

**Verification (rework)**
- `npm run check`: pass.
- `npm test`: 327 tests, 326 pass, 1 skip (pre-existing, unrelated "smoke (slow)" race test), 0 fail.
- `npm run validate`: `Ticket validation OK`.

## Review Findings

- 2026-07-07T23:42:48Z: Review (codex): blocker — gate-check's empty-catalog auto-stamp mutates the ticket unguarded (wrong-root stamp of the main copy possible); fix by guarding gate-check with --allow-main-root support and empty-catalog coverage. Non-blocking: win32 path comparison should be case-insensitive (or realpath-normalized). All 14 wired handlers, skips, fail-open quietness, and closeout order verified sound.

- 2026-07-07T23:46:51Z: Final disposition: both review items fixed verbatim (gate-check guarded before the auto-stamp branch with the exact test coverage the review requested; win32 comparer added). Treating review as complete per the established mechanical-fix pattern.

## Test Evidence

Tested by claude-subagent:local-board-tester (sonnet) on branch local-board/T20260707T1331Z-..., commits 2baf88f + 442f06b.

**Suite:** `npm run check` pass; `npm test` 326 pass / 1 gated-skip of 327; `npm run validate` OK.

**End-to-end probe (throwaway repo, scaffold guardWrongRoot true):**
- Wrong-root mutation refused exit 2 with the exact designed message (full text captured: names the registered worktree path, the --root fix, and --allow-main-root); main ticket byte-unchanged. Override succeeds into the main copy; worktree-root invocation succeeds into the worktree copy.
- gate-check empty-catalog auto-stamp (the review blocker): refused from main root, stamps only the worktree copy from the worktree root, override works.
- No-worktree ticket: mutations unchanged (no-op guard).
- worktree-remove verified from BOTH roots (including from inside the worktree being removed).
- win32 case probe: differently-cased --root (lower drive letter + upper-cased segment) accepted — pathsEqual comparer verified live.

**Gaps / caveats:** two-ticket cross-worktree divergence remains a documented accepted limitation; the cased-path scenario covered by live probe rather than a unit test; one stale-fixture false alarm during setup (init correctly skipping an existing config — not a product issue).

Result: pass

## Documentation Updates

Documented by codex-task:workspace-write (gpt-5.5).

- `SKILL_TEAM.md` — worktree-remove exception retired (normal flow now); --allow-main-root override documented alongside the guard (impl pass + this verification).
- `memory-bank/systemPatterns.md` — guard fact updated to include gate-check coverage and the config key.
- `docs/PerStepOrchestration.md` — one sentence: the CLI now enforces the --root worktree discipline (guardWrongRoot, scaffold-on).
- `docs/Workflow.md` and `README.md` checked; no edits needed.

## Questions

## Run Log

- 2026-07-07T23:21:33Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): worktrees.guardWrongRoot refuse-with-override on per-ticket mutations from a non-worktree root (no-op when the ticket has no worktree; fails open on git errors); worktree-remove auto-resolves the main root retiring the SKILL_TEAM exception. Estimate 4 (basis T20260707T1328Z).

- 2026-07-07T23:22:25Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (internal CLI safety guard)

- 2026-07-07T23:22:26Z: Ensured git branch local-board/T20260707T1331Z-cli-guard-against-wrong-root-when-a-ticket-has-a-registered-worktree (created).

- 2026-07-07T23:35:29Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Implementer (sonnet): guard wired into 14 mutation handlers with override + fail-open, worktree-remove root resolution, scaffold-only config key; 323 pass + 1 gated-skip.

- 2026-07-07T23:39:46Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (internal CLI safety guard)

- 2026-07-07T23:42:49Z: Completed review via codex-task:read-only: Codex (gpt-5.5, read-only) changes_requested: unguarded gate-check empty-catalog stamp; win32 case-insensitive comparison recommended. Guard coverage otherwise verified handler-by-handler.

- 2026-07-07T23:42:49Z: Invalidated downstream evidence on loop-back to ready_for_implementation: removed completedSteps [implement:claude-subagent:local-board-implementer@sonnet, gate:implement:claude-subagent:local-board-gatecheck@haiku, review:codex-task:read-only].

- 2026-07-07T23:42:49Z: Ensured git branch local-board/T20260707T1331Z-cli-guard-against-wrong-root-when-a-ticket-has-a-registered-worktree (already-current).

- 2026-07-07T23:46:51Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Rework (sonnet): gate-check guarded whole-command with --allow-main-root threading + 3 empty-catalog tests; pathsEqual comparer case-insensitive on win32; 326 pass + 1 gated-skip.

- 2026-07-07T23:46:51Z: Completed review via codex-task:read-only: Review complete: the unguarded gate-check mutation and win32 path comparison were fixed exactly as the review specified, with the requested tests.

- 2026-07-07T23:54:10Z: Completed test via claude-subagent:local-board-tester@sonnet: Tester (sonnet): 326+1 gated; live probe verified refusal message, override, worktree-copy stamping, both-root worktree-remove, and win32 case-insensitive matching. Result: pass.

- 2026-07-07T23:56:23Z: Completed document via codex-task:workspace-write: Codex (workspace-write): SKILL_TEAM override wording, systemPatterns gate-check coverage, PerStepOrchestration enforcement sentence; Workflow/README checked unchanged.
