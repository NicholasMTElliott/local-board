---
id: T20260707T1325Z
type: task
status: ready_for_implementation
priority: P1
parent: null
children: []
blockedBy: []
blocks: [T20260707T1326Z]
branch: null
estimate: 4
estimateBasis: T20260707T1320Z
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T13:25:41Z
updated: 2026-07-07T17:26:56Z
completedSteps: ["design:claude-subagent:local-board-designer@opus"]
routingApprovals: []
---
# enforce: add check-dispatch verdict command and persisted in-flight step state

## Requirement

Nothing persists what dispatch is expected or in flight, and no command answers "is this dispatch correct?" — the two primitives external enforcement (hooks) needs. `begin-step` is a pure query; `begin-step`/`complete-step` are not paired; a PreToolUse hook intercepting an Agent dispatch sees `subagent_type` and `model` but has no deterministic way to know which ticket/action the dispatch serves.

Fix, two parts:
1. Persist in-flight step state: `begin-step` stamps an active-step record (front-matter field `activeStep: <action>:<route>[@<model>]` or a `.local-board/active-steps.json` ledger keyed by ticket), cleared by `complete-step`/`approve-inline`.
2. Add `local-board check-dispatch --agent <subagent_type> [--model <model>] [--ticket <id>]`: exits 0/1 with a JSON reason. With `--ticket`, compares against that ticket's expected step (agent name from `configuredAgent`, model from `configuredModel`); without, scans active steps for any match. `profileForAction` and `beginStep` already provide the pieces (~30 lines).

Acceptance: `check-dispatch` returns correct verdicts for right-agent/right-model, wrong-agent, wrong-model, and no-active-step cases, with tests; active-step state round-trips through begin/complete/approve-inline.

## Acceptance Criteria

## Related Tickets

## Technical Design

Two primitives external enforcement needs: a durable record of what step is in flight per ticket, and a deterministic verdict command (`check-dispatch`) that answers "is this Task dispatch the one this ticket expects?". The design is driven by one hard constraint from the consumer (T20260707T1326Z): the PreToolUse hook runs in the **main session cwd = main checkout**, while the orchestrator works each ticket in a **per-ticket worktree**.

## Storage choice: main-checkout sidecar ledger (not front matter)

**Decision: a JSON ledger at `<mainCheckout>/.local-board/active-steps.json`, keyed by ticket id. Reject the front-matter `activeStep` field.**

The worktree question is decisive and rules out front matter outright:

- The hook (T20260707T1326Z, step 2) fires on the Task dispatch inside the **main session**, whose cwd is the main checkout. The orchestrator does the ticket's work in a sibling worktree on a ticket branch. A front-matter `activeStep` written in the worktree is a *different file on disk* and lives on an *unmerged branch*; it is invisible in the main checkout until the branch merges (long after the step ran). A hook can therefore never read a worktree-local front-matter field. **Only a store the hook and the writer both resolve to the same physical path can work, and that path must live in the main checkout.**
- A sidecar ledger anchored at the main checkout satisfies this: `begin-step` (invoked by the orchestrator with `--root <worktree>`) and `check-dispatch` (invoked by the hook with no `--root`, main-checkout cwd) both resolve the ledger to the **main worktree root** via `git rev-parse --git-common-dir` (its parent is the main worktree; reuse `gitOutput` from `src/worktrees.js`). They then share one file regardless of which worktree the step runs in. Fall back to the passed `--root` when git resolution fails (non-git / test dirs).

Secondary reasons front matter loses even ignoring worktrees:

- **Not actually a forced migration, but still churn.** `validateTicketShape` only checks that `REQUIRED_FIELDS` are *present* and shape-checks specific known fields; it does not reject unknown keys, and `serializeFrontMatter` preserves unknown keys (sorted after `CANONICAL_FIELDS`). So an additive `activeStep` would validate on all ~63 existing tickets without a migration and without touching `createTicket`/`REQUIRED_FIELDS`. The "63-ticket migration" fear is unfounded — but the worktree-invisibility is fatal regardless.
- Front matter would make `begin-step` (a pure query today) dirty `git status` on every call, churn the ticket body, and interleave with `completeStep`'s own front-matter write — directly worsening the two-file/RMW race in B20260707T1322Z.

Sidecar downsides (accepted): it is unversioned and per-machine, and a crashed orchestrator can leave a stale entry (see Lifecycle). `.local-board/` must be gitignored (it already hosts T1326Z's `dispatch-ledger.jsonl`; colocate). This keeps it out of `git status` and the autoMerge closeout dirty-check in `src/git.js`.

### Record shape

```json
{
  "T20260707T1325Z": {
    "ticket": "T20260707T1325Z",
    "action": "design",
    "route": "claude-subagent:local-board-designer",
    "model": "opus",
    "root": "<abs worktree path passed to begin-step>",
    "ts": "2026-07-07T13:40:05Z"
  }
}
```

Keyed by ticket id: exactly one active step per ticket; parallel mode is many keys, one per in-flight ticket. `route`/`model` snapshot the pinned profile at begin time (so `check-dispatch` reports the true expectation even if config later changes), `root` disambiguates which worktree owns it, `ts` supports staleness diagnostics.

## Lifecycle

- **When `begin-step` writes.** Recommend `begin-step` stamps the record **unconditionally** as an additive side effect; its return shape is unchanged. It is only invoked at true step start by the orchestrator, and the pure-query role is already served by `query-ticket`/`query-next`, which stay read-only. Stamping is idempotent: it overwrites this ticket's own key, so a re-`begin-step` self-heals a stale entry. (Alternative: gate behind a `--stamp` flag to keep `begin-step` pure — see Open Questions; I recommend unconditional + documenting the new side effect.)
- **When entries clear.** `complete-step` and `approve-inline` delete the ticket's key after their existing ticket-file write. Clearing is best-effort and idempotent (missing key = no-op), so a completion without a prior begin still succeeds.
- **Staleness.** A crashed orchestrator leaves an entry forever. v1 does **not** auto-expire (keep it deterministic); mitigations are overwrite-on-next-begin plus the `ts` field. `check-dispatch` reports but does not silently drop old entries. A `--clear`/prune escape hatch is optional and deferred.
- **Concurrency.** Two `begin-step` calls for *different* tickets both read-modify-write the *same* shared ledger → classic lost-update. The ledger writer must use an atomic whole-file write (temp-in-same-dir + `rename`, mirroring `writeTicketFile`) and, to be race-safe under parallel mode, should sit behind the per-ticket/lock primitive from **B20260707T1322Z** (a shared-file lock, not per-ticket, is what this actually needs). Bounded blast radius: a lost active-step entry only weakens a hook check (fail-open); it never corrupts a ticket. Flag the coordination with B20260707T1322Z explicitly.

## check-dispatch matching semantics

`local-board check-dispatch --agent <subagent_type> [--model <model>] [--ticket <id>] [--json]`

- **Prefix stripping.** `--agent` is the hook-visible `subagent_type` (e.g. `local-board-designer`, no `claude-subagent:` prefix). The configured route is `claude-subagent:local-board-designer`; strip `claude-subagent:` and compare the bare names. Only `claude-subagent:*` routes are hook-enforceable (codex routes are not dispatched via Task `subagent_type`).
- **Pass-through for non-local-board agents.** If `--agent` does not start with `local-board-`, exit 0 with `{ok:true, reason:"not-local-board-agent"}` so the hook stays cheap and never blocks unrelated subagents.
- **With `--ticket`.** Resolve that ticket's expected step. Prefer the ledger record for the ticket (it snapshots route+model at begin time); if absent, fall back to a pure resolver derived from config for the ticket's current status. This requires extracting the read-only core of `beginStep` into a shared `resolveExpectedStep(root, ticketId)` (action from `statusActions`, `agentForAction`, `modelForAction`) that both `beginStep` and `check-dispatch` call — `check-dispatch` must **not** stamp.
- **Without `--ticket`.** Scan the ledger for any record whose stripped route equals `--agent` (and whose model satisfies `--model` when given). Match → exit 0 `{ok:true, ticket, expected}`; none → exit 1 `{ok:false, reason:"no-active-step-for-agent"}`.
- **Model comparison** via the landed `modelSatisfies(configuredModel, dispatchModel)`:
  - configured model null (route pins none) → model check passes.
  - `--model` present and satisfies → pass.
  - `--model` present and mismatches → exit 1 `{ok:false, reason:"model-mismatch", expected}`.
  - **`--model` omitted while a model is pinned** → the hook cannot see the agent-frontmatter default, and agents pin their own model, so most legitimate dispatches omit `--model`. Denying here would block the common case. **Decision: pass-with-reason** — exit 0 `{ok:true, reason:"model-unverifiable", expected:{model}}`. The explicit reason lets the hook log or soft-warn; the skill should be updated to pass `--model` explicitly (a one-line change mirroring T1326Z's `Ticket:` prompt line). Confirm with T1326Z whether the hook prefers to translate this reason into `ask`.
- **Agent mismatch** (bare name != stripped configured route) → exit 1 `{ok:false, reason:"agent-mismatch", expected}`.

### Exit codes and JSON shape

- `0` = allowed / pass-through, `1` = deny (agent/model mismatch or no active step), `2` = error (bad args, ticket not found, invalid board) — matches the existing CLI catch that returns `2`.
- Verdict JSON always to stdout (even on deny) so the hook parses a reason: `{ ok, reason, expected?, ticket? }` with `expected = { agent, model }`. Errors go to stderr with exit 2; the hook (T1326Z) owns fail-open vs fail-closed on error.

## --root and the worktree resolution

- The hook invokes `check-dispatch` with **no `--root`** (main-checkout cwd); the orchestrator invokes `begin-step` with `--root <worktree>`. Both anchor the ledger to the main worktree root (`git rev-parse --git-common-dir` → parent), so they share one file across worktrees.
- With `--ticket` for a ticket that exists only on a worktree branch (absent from the main checkout's `plans/`), resolve from the **ledger record** (it carries route/model/root without needing the ticket file). Only if there is no record *and* the ticket is not discoverable in the main checkout does `check-dispatch` return exit 2 `{reason:"ticket-not-found"}`, leaving fail-open policy to the hook.

## Affected files

- **`src/active-steps.js` (new)** — ledger path resolution (main-checkout anchor + fallback), atomic JSON read-modify-write (temp+rename), record CRUD (`readActiveSteps`, `stampActiveStep`, `clearActiveStep`), and the `checkDispatch(root, {agent, model, ticketId})` core. A dedicated module keeps `tickets.js` focused and gives T1326Z a clean import surface.
- **`src/tickets.js`** — extract `resolveExpectedStep` (pure) out of `beginStep`; call `stampActiveStep` from `beginStep`, `clearActiveStep` from `completeStep` and `approveInline`. `profileForAction`/`agentForAction`/`modelForAction` reused via the resolver.
- **`src/cli.js`** — add `commandCheckDispatch` + dispatch entry + usage line; return its numeric exit code directly (0/1/2). `begin-step`/`complete-step`/`approve-inline` command surfaces unchanged (side effects internal).
- **Install/init** — ensure `.local-board/` is gitignored (coordinate with T1326Z, same dir).
- **Tests** — new `test/active-steps.test.*` (or extend existing) for ledger + `check-dispatch`; extend begin/complete/approve tests for round-trip.
- **Docs** — `memory-bank/systemPatterns.md` (ledger + command), README/CLI usage, and the MVP CLI list.

## Risks

1. **Shared-ledger RMW race** across concurrent `begin-step` for different tickets → lost entry. Needs atomic write + ideally the B20260707T1322Z lock. Fail-open blast radius (weakens a hook check, never corrupts a ticket).
2. **Stale entries** from crashed orchestrators → false positive on the no-`--ticket` scan (an old record matches a new dispatch). Mitigated by `ts` + overwrite; residual accepted.
3. **Model-default blind spot** — pass-with-reason means a genuinely wrong model dispatched *without* `--model` slips the gate. Mitigation: skill passes `--model` explicitly. Flagged.
4. **`begin-step` gains a write side effect** — scripts using it as a pure query now write the ledger and dirty `.local-board/`. Mitigation: `query-ticket`/`query-next` stay pure; document; optional `--no-stamp`.
5. **Anchor resolution failure** (non-git, tests) → fall back to `--root`; hook and worktree could then disagree. Acceptable for tests; documented.
6. **`.local-board/` must be gitignored** or the ledger pollutes commits and the autoMerge closeout dirty-check in `src/git.js`. Verify against those dirty checks.

## Test strategy

- **Unit** — ledger anchors to main checkout (mock `git-common-dir`); atomic RMW preserves other tickets' entries; write/clear idempotency.
- **Round-trip** — `begin-step` stamps (record has route/model/ts); `complete-step` clears; `approve-inline` clears; re-`begin-step` overwrites.
- **check-dispatch matrix** — right-agent/right-model (0); wrong-agent (1); wrong-model (1); model-omitted-with-pin (0 + `model-unverifiable`); no-active-step (1); non-local-board agent (0 pass-through); configured-model-null (0); `--ticket` vs scan; ticket-not-found (2); bad args (2).
- **Concurrency** — two racing `begin-step` for different tickets both survive (or the documented single-writer constraint if deferring to B20260707T1322Z).
- **CLI** — exit-code + JSON-shape assertions; errors on stderr with exit 2.

## Related tickets and conflicts

- **T20260707T1326Z (hooks — the consumer, blocked by this)**: shapes every decision. It reads the same `.local-board/` dir, calls `check-dispatch` from a main-checkout PreToolUse hook, and owns fail-open/fail-closed. Keep the JSON reason strings stable as its contract.
- **T20260707T1324Z (landed)**: reuse the exported `modelSatisfies` for the model gate — do not re-implement.
- **B20260707T1322Z (locking)**: the ledger's read-modify-write must use the atomic write helper and should ride its lock primitive to be race-safe under parallel mode. Coordinate.

## Open questions

1. `begin-step` unconditional stamp vs a `--stamp` flag? (Recommend unconditional; `query-ticket` stays pure.)
2. Model-omitted verdict — pass-with-reason vs deny vs `ask`? (Recommend pass-with-reason `model-unverifiable`; the T1326Z hook may translate it into `ask`.)
3. `--ticket` for a worktree-only ticket with no ledger record and absent from the main checkout — exit 2 and let the hook fail open? (Recommended.)
4. Does `check-dispatch` prune stale entries, or is that the orchestrator's job? (Recommend no auto-prune in v1.)
5. Confirm `.local-board/` gitignore + colocation with T1326Z's `dispatch-ledger.jsonl` and the B20260707T1322Z lock file.

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-07T17:26:04Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): main-checkout sidecar ledger (worktree-invisibility of front matter to hooks is decisive), git-common-dir resolution, unconditional idempotent stamp on begin-step, best-effort clear, pass-with-reason for unverifiable models, exit 0/1/2 JSON verdicts. Estimate 4 (basis T20260707T1320Z).
