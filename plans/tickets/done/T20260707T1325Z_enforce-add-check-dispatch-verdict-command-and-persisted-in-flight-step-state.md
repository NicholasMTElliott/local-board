---
id: T20260707T1325Z
type: task
status: done
priority: P1
parent: null
children: []
blockedBy: []
blocks: [T20260707T1326Z]
branch: local-board/T20260707T1325Z-enforce-add-check-dispatch-verdict-command-and-persisted-in-flight-step-state
estimate: 4
estimateBasis: T20260707T1320Z
workStartedAt: 2026-07-07T17:26:56Z
workCompletedAt: 2026-07-07T18:00:03Z
created: 2026-07-07T13:25:41Z
updated: 2026-07-07T18:00:03Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "implement:claude-subagent:local-board-implementer@sonnet", review:codex-task:read-only, "test:claude-subagent:local-board-tester@sonnet", document:codex-task:workspace-write]
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

Implemented per the Technical Design.

**New module `src/active-steps.js`:**
- `ledgerPath(root)` resolves `<mainCheckout>/.local-board/active-steps.json` via `git rev-parse --git-common-dir` (parent = main worktree root); falls back to `path.resolve(root)` when git resolution fails (non-git dirs).
- `readActiveSteps(root)`: strict read — missing file reads as `{}`, but an unparseable file throws `active-steps ledger at <path> is corrupt (...)`. Used by `checkDispatch` so a corrupt ledger fails loudly (exit 2), not silently.
- `stampActiveStep`/`clearActiveStep`: read via a self-healing variant (corrupt/unreadable ledger treated as `{}`, next write repairs it), then an atomic whole-file write (`writeTicketFile` from `tickets.js`, temp+rename). `clearActiveStep` is a no-op when the key is absent.
- `checkDispatch(root, {agent, model, ticketId})`: pure verdict resolver, returns `{ code, body }`. Strips `claude-subagent:` from the configured route only (per design, `--agent` is already the bare `subagent_type`). Non-`local-board-*` agents pass through immediately (`not-local-board-agent`). With `--ticket`: prefers the ledger record; falls back to `resolveExpectedStep` (new pure export from `tickets.js`) when no record exists, catching ticket-not-found into `{code:2, reason:"ticket-not-found"}`. Model gate: null-pin always passes; omitted `--model` passes with `model-unverifiable`; mismatch denies with `model-mismatch` via the existing `modelSatisfies`. Without `--ticket`: scans all ledger entries for a bare-route+model match, `no-active-step-for-agent` on miss.

**`src/tickets.js`:** extracted `resolveStepFromBoard` (private) and exported `resolveExpectedStep` (pure, no board-wide `validate`, so an unrelated ticket's validation issue can't block a hook's `check-dispatch`). `beginStep` unchanged in return shape; now also unconditionally stamps the ledger after resolving action/route/model (not swallowed — a ledger write failure surfaces). `completeStep` and `approveInline` call `clearActiveStep(...).catch(() => {})` after their existing ticket-file write (best-effort, matches "Clearing is best-effort" in the design).

Note: `active-steps.js` imports `resolveExpectedStep`/`modelSatisfies`/`writeTicketFile` from `tickets.js`, and `tickets.js` imports `stampActiveStep`/`clearActiveStep` from `active-steps.js` — a circular ESM import. Verified safe: both only invoke the imported bindings inside async function bodies, never at module-evaluation time. Confirmed via test run (circular-import failures would show up immediately as `undefined is not a function`).

**`src/cli.js`:** added `check-dispatch` command. Always emits JSON to stdout (per design, the hook needs deterministic parsing); `--json` accepted as a no-op flag. Missing `--agent` throws (bad args → existing outer catch → stderr, exit 2, no JSON) — this is the one case that does NOT get JSON on stdout, matching "matches the existing CLI catch that returns 2." `ticket-not-found` is caught inside `checkDispatch` itself and DOES get JSON + exit 2, since the design's `--root` section explicitly shows `{reason:"ticket-not-found"}` as a verdict body, not a bare error.

**Gitignore:** `.local-board/` (whole directory, not just `tmp/`/`runs/`) added to this repo's own `.gitignore` and to `scaffold.js`'s `GITIGNORE_TEMPLATE`/idempotent-append logic (`writeGitignore` now appends any of `[.worktrees/, .local-board/]` that's missing, individually idempotent). `test/pack.test.js` asserts `.local-board/` is excluded from `npm pack`.

**Corruption handling (design was open on this):** chose "self-heal on write, error on read" — `begin-step`/`complete-step`/`approve-inline` never fail due to a corrupt ledger (self-heals to `{}` and overwrites), but `check-dispatch` (the query the hook depends on) surfaces a clear, path-carrying error on a corrupt ledger, as exit 2 rather than a silent false pass or false deny.

**Tests** (`test/active-steps.test.js`, 20 new; all pass): ledger path fallback in non-git dirs; stamp/read/clear round-trip and RMW preserves other tickets' keys; stamp idempotency (re-stamp overwrites only its own key, verified via `--action implement` override rather than a timing-based `ts` diff — `formatIsoSeconds` truncates to whole seconds, so a millisecond-scale re-stamp can land on the same second); corruption tolerance (self-heal on write, throw on read, both directions); begin-step→complete-step and begin-step→approve-inline clear round-trips via the CLI; a real `git worktree` fixture proving a worktree-invoked `begin-step` stamps the MAIN checkout's ledger (not the worktree's) and that a main-checkout-invoked `check-dispatch` sees it; the full check-dispatch verdict matrix (right agent+model, wrong agent, wrong model, model-omitted-with-pin, configured-model-null via a hand-crafted ledger record, no-active-step scan miss, non-local-board passthrough, `--ticket` vs scan, ledger-snapshot-beats-live-config, ticket-not-found, bad-args, corrupt-ledger).

**Existing-test updates:** two scaffold `.gitignore` tests in `test/tickets.test.js` updated for the new `.local-board/` entry (one now also asserts `.local-board` bare-form recognition; one asserts no duplication across repeated `--overwrite`).

**Verification:** `npm run check` — clean. `npm test` — 205/205 pass (185 pre-existing + 20 new), zero regressions. `npm run validate` — OK. Live check on this repo's own ledger: `begin-step T20260707T1325Z --action implement --json` stamped `.local-board/active-steps.json` (confirmed via `cat`, and confirmed absent from `git status --short` — properly ignored); `check-dispatch --agent local-board-implementer --model sonnet --ticket T20260707T1325Z` → exit 0, `{ok:true, reason:"match"}`; `check-dispatch --agent local-board-reviewer --ticket T20260707T1325Z` → exit 1, `{ok:false, reason:"agent-mismatch"}`.

**Deviation from the literal live-check instruction:** `begin-step T20260707T1325Z --json` (no `--action`) fails with "ticket ... has no configured action for status implementing" — this ticket's current front-matter status is `implementing`, which (pre-existing, unrelated to this ticket) has no `statusActions` mapping; only `ready_for_*` statuses do. This is unrelated to the change under test (same behavior existed before this ticket). Ran with the explicit `--action implement` override instead, which mirrors what the orchestrator's own begin-step dispatch would have used (`configuredAgent: claude-subagent:local-board-implementer`). Did not run `complete-step` or otherwise clear this ticket's active-step entry, per instructions — the orchestrator owns that.

**Remaining risk (accepted per design, not addressed here):** the ledger read-modify-write is atomic per-write but not lock-protected across concurrent `begin-step` calls for different tickets in parallel mode; a lost-update is possible (design flags this, defers the fix to B20260707T1322Z). Also flagged: `begin-step` gaining a ledger-write side effect means any script treating it as a pure query now also writes `.local-board/`.

## Rework (2026-07-07T17:45:20Z review, two blockers)

Fixed both blockers from the review of commit 905982b, scope held to exactly those two items:

1. **check-dispatch now always emits JSON on stdout, including exit-2 errors.** `commandCheckDispatch` (`src/cli.js`) wraps the `checkDispatch(...)` call in try/catch: on any thrown error (e.g. `readActiveSteps` throwing on a corrupt ledger from `src/active-steps.js`), prints `{ ok: false, reason: "error", error: "<message>" }` to stdout and returns exit code 2, instead of letting the error escape to the generic CLI catch (stderr-only, empty stdout). The bad-args path (missing `--agent`) is unaffected — that throw happens before the try block, by design (per the original "matches the existing CLI catch that returns 2" note, stdout stays empty and the message goes to stderr for malformed invocations, not runtime ledger errors).
   - Updated `test/active-steps.test.js` ("a corrupt ledger is an error... rather than a silent pass"): previously asserted `stdout === ""` and matched the corruption message on stderr. Now asserts exit 2 and parses `stdout` as JSON, checking `ok: false`, `reason: "error"`, and `error` matching `/active-steps ledger.*is corrupt/`.

2. **Scan mode (`checkDispatchByScan` in `src/active-steps.js`) now mirrors `--ticket` mode's model-gate semantics.** Previously, once a route match was found, an omitted `--model` with a pinned `expectedModel` fell through to `reason: "match"` (silently claiming full verification). Now, per matched record: null-pinned model → `match`; `--model` omitted with a pinned model → pass-with-reason `model-unverifiable` (mirrors `checkDispatchForTicket`); `--model` present and mismatched → `continue` (keep scanning, unchanged); `--model` present and satisfies → `match`.
   - Added new test "check-dispatch: scan mode with --model omitted passes with model-unverifiable when the matched step pins a model" asserting `ok: true`, `reason: "model-unverifiable"`, correct `ticket` and `expected`.

**Verification (rework):** `npm run check` — clean. `npm test` — 206/206 pass (0 fail), zero regressions. `npm run validate` — OK. Live re-check per the rework instructions: this ticket's own ledger entry had already been cleared by the prior implementer's `complete-step implement` call (visible in front matter `completedSteps`), so a bare `check-dispatch --ticket T20260707T1325Z` first returned `ticket-not-found` (expected, given no ledger record and status `implementing` has no `statusActions` mapping — same pre-existing, unrelated gap noted in the original Implementation Notes). Re-stamped via `begin-step T20260707T1325Z --action implement --json` (same override used previously, mirroring the orchestrator's real dispatch), then re-ran:
   - `check-dispatch --agent local-board-implementer --ticket T20260707T1325Z` (no `--model`) → exit 0, `{ok:true, reason:"model-unverifiable", expected:{agent:"local-board-implementer", model:"sonnet"}, ticket:"T20260707T1325Z"}`.
   - `check-dispatch --agent local-board-implementer` (scan mode, no `--model`, no `--ticket`) → exit 0, same `model-unverifiable` verdict — confirms fix 2 live.
   Did not run `complete-step` afterward; left the ledger stamped, matching the state the orchestrator's own begin-step produces for this in-flight step.

**Remaining risks (unchanged, documented deferrals, not addressed in this rework):** action-aware clearing (clearing is ticket-wide, not per-action) and RMW lock-protection across concurrent `begin-step` calls (pending B20260707T1322Z) are both out of scope per the rework instructions.

## Review Findings

- 2026-07-07T17:45:20Z: Review (codex): two blockers — check-dispatch exit-2 paths emit stderr-only (hook contract requires JSON on stdout always; a test even codifies the wrong behavior), and scan mode returns match instead of model-unverifiable when --model omitted with a pinned model. Non-blocking: clearing is ticket-wide rather than action-aware (documented design; deferred); concurrent RMW risk accepted pending B20260707T1322Z. Looping back.

- 2026-07-07T17:51:53Z: Re-review (codex): both blockers verified fixed; usage errors still route through the generic path; genuine-mismatch deny preserved. Verdict: pass.

## Test Evidence

Tested by claude-subagent:local-board-tester (sonnet) on branch local-board/T20260707T1325Z-..., commits 905982b + f74da9c.

**Suite:** `npm run check` pass; `npm test` 206/206 pass; `npm run validate` OK.

**Independent end-to-end probe (throwaway git repo + board):**
- begin-step stamped `.local-board/active-steps.json` with { ticket, action, route, model, root, ts }.
- Full verdict matrix captured live (exit / reason): right agent+model 0/match; right agent no model 0/model-unverifiable (both --ticket and scan modes); wrong model 1/model-mismatch; wrong agent 1/agent-mismatch; Explore 0/not-local-board-agent; bogus ticket 2/ticket-not-found; scan miss 1/no-active-step-for-agent. All JSON bodies carried expected{agent,model} and ticket where applicable.
- complete-step (proper @sonnet suffix) cleared the entry — ledger back to {}.
- Corrupt ledger: exit 2 with stdout JSON {"ok":false,"reason":"error","error":"active-steps ledger ... is corrupt (invalid JSON): ..."}; stderr empty. Contract fix verified live.
- Worktree: begin-step --root <worktree> stamped the MAIN checkout ledger (worktree has no .local-board of its own); also demonstrated self-heal-on-write repairing the corrupted ledger. Worktree removed cleanly.
- .local-board/ confirmed gitignored in both the probe repo and this repo.

**Rework tests confirmed by name:** corrupt-ledger JSON-verdict test; scan-mode model-unverifiable test (plus the --ticket-mode counterpart and the self-heal-on-write test).

**Gaps / caveats:** approve-inline clearing verified via the unit suite only (shares the clearActiveStep path proven live by complete-step); concurrent RMW and action-aware clearing are documented deferrals (B20260707T1322Z).

Result: pass

## Documentation Updates

Documented by codex-task:workspace-write (gpt-5.5).

- `memory-bank/systemPatterns.md` — dispatch-verification note (active-steps ledger, begin-step stamp side effect, clear behavior, check-dispatch verdict contract); check-dispatch added to the MVP CLI list.
- `SKILL.md` and `skills/codex/local-board/SKILL.md` — begin-step description no longer reads as a pure query; check-dispatch added to both CLI command lists.
- `docs/Workflow.md` — short dispatch-verification paragraph with a command example.
- No new docs page and no README change (no entry point changed); the full hooks narrative belongs to T20260707T1326Z.

## Questions

## Run Log

- 2026-07-07T17:26:04Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): main-checkout sidecar ledger (worktree-invisibility of front matter to hooks is decisive), git-common-dir resolution, unconditional idempotent stamp on begin-step, best-effort clear, pass-with-reason for unverifiable models, exit 0/1/2 JSON verdicts. Estimate 4 (basis T20260707T1320Z).

- 2026-07-07T17:26:56Z: Ensured git branch local-board/T20260707T1325Z-enforce-add-check-dispatch-verdict-command-and-persisted-in-flight-step-state (created).

- 2026-07-07T17:41:25Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Implementer (sonnet): src/active-steps.js ledger + check-dispatch CLI + stamp/clear lifecycle; 205/205 tests; live check-dispatch verdicts verified on this repo's own ledger.

- 2026-07-07T17:45:21Z: Completed review via codex-task:read-only: Codex (gpt-5.5, read-only) changes_requested: JSON-on-stdout contract violated on error paths; scan-mode verdict reason wrong for unverifiable models. Ledger anchoring, worktree tests, and verdict matrix otherwise verified.

- 2026-07-07T17:45:21Z: Ensured git branch local-board/T20260707T1325Z-enforce-add-check-dispatch-verdict-command-and-persisted-in-flight-step-state (already-current).

- 2026-07-07T17:50:17Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Rework (sonnet): check-dispatch prints JSON on stdout for error exits; scan mode mirrors the model-unverifiable semantics; 206/206 green with live verdict confirmation.

- 2026-07-07T17:51:53Z: Completed review via codex-task:read-only: Re-review (gpt-5.5): verdict pass — JSON-on-stdout contract and scan-mode model gate verified fixed, no regressions in focused paths.

- 2026-07-07T17:56:45Z: Completed test via claude-subagent:local-board-tester@sonnet: Tester (sonnet): 206/206; full verdict matrix live-probed including corrupt-ledger JSON contract and worktree main-checkout anchoring with self-heal. Result: pass.

- 2026-07-07T18:00:03Z: Completed document via codex-task:workspace-write: Codex (workspace-write): systemPatterns dispatch-verification note + CLI list, SKILL begin-step wording + command lists, Workflow.md paragraph.
