---
id: T20260707T1331Z
type: task
status: ready_for_implementation
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: 4
estimateBasis: T20260707T1328Z
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T13:31:54Z
updated: 2026-07-07T23:22:25Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
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

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-07T23:21:33Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): worktrees.guardWrongRoot refuse-with-override on per-ticket mutations from a non-worktree root (no-op when the ticket has no worktree; fails open on git errors); worktree-remove auto-resolves the main root retiring the SKILL_TEAM exception. Estimate 4 (basis T20260707T1328Z).

- 2026-07-07T23:22:25Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (internal CLI safety guard)
