---
id: T20260707T1327Z
type: task
status: done
priority: P2
parent: null
children: []
blockedBy: []
blocks: [T20260707T1333Z]
branch: local-board/T20260707T1327Z-enforce-record-gate-check-consultation-and-require-it-when-leaving-gated-stages
estimate: 4
estimateBasis: T20260707T1325Z
workStartedAt: 2026-07-07T21:22:36Z
workCompletedAt: 2026-07-07T21:51:37Z
created: 2026-07-07T13:27:41Z
updated: 2026-07-07T21:51:37Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "implement:claude-subagent:local-board-implementer@sonnet", review:codex-task:read-only, "test:claude-subagent:local-board-tester@sonnet", gate:test:skipped-empty-catalog, document:codex-task:workspace-write]
routingApprovals: []
---
# enforce: record gate-check consultation and require it when leaving gated stages

## Requirement

Gate-check is entirely skippable with no trace: `routing.doneRequires` lists only the six mandatory actions, and `SKILL.md:181` states specialty evidence never blocks closeout. No token records that gate-check was consulted for the design/implement/test stages, so an orchestrator that never runs it silently drops security_threat_model/security_audit — and the ticket cannot show the difference between "judged unnecessary" and "never asked".

Fix: record a `gate:<stage>:<executor>` token in `completedSteps` at gate time (new CLI verb or extend `complete-step`), and have `move` out of a gated stage require the consultation token for that stage. Keep specialty *results* non-gating — gate only the *consultation*. An empty catalog should still record a (skipped) consultation deterministically (see T20260707T1333Z).

Acceptance: `move` out of design/implement/test without a recorded gate consultation is refused (with a config switch for projects that opt out); tickets show which stages were gate-checked; existing flows with empty catalogs still pass without dispatching an agent.

## Acceptance Criteria

## Related Tickets

## Technical Design

Make the gate-check consultation leave a durable trace and require that trace before a ticket leaves a gated stage, without retroactively breaking in-flight tickets and without dispatching an agent for empty catalogs.

### Related tickets and conflicts

- **T20260707T1333Z (blocked by this ticket)** wants `gate-check` to return `skip: true` for empty catalogs. This design's empty-catalog **auto-record** is the adjacent write; the two must land coherently. Split of responsibility: **this ticket** owns the `completedSteps` gate token, the move precondition, and the empty-catalog auto-stamp; **T1333** owns the *response-shape* change (`skip: true`). Implement the stamp here so that when T1333 adds `skip: true`, the same empty-catalog path already records the token. Do not change the JSON payload shape here beyond what recording requires.
- **B1320** (assertPromptExists gated on non-empty catalog) is load-bearing: empty catalogs already never open `gate-check.md`. The empty-catalog auto-stamp must live on that same "no dispatch" branch so an empty catalog still needs no prompt file and no agent.
- **B1322** (moveTicket runs under a ticket lock) means the new move precondition executes inside the existing `withTicketLock` span in `moveTicket` — the read of `completedSteps` and the transition decision are already atomic with the rename. No new lock needed.
- **B1321** (estimation.enabled default split: `false` in `DEFAULT_CONFIG`, `true` in `defaultConfigJsonc`) is the exact precedent for the new config switch's default handling and its guard-test allowlist entry.
- **T1324** established binding new gates to move-time, not done-time `validateRouting`, so already-past tickets still close. This design follows it.

### Approach

**1. Token grammar.** Record a consultation as a `completedSteps` entry `gate:<stage>:<executor>`, where `<stage>` is `design|implement|test`. Two producers:
- Empty catalog: `gate:<stage>:skipped-empty-catalog` (no executor answered — the CLI determined "nothing to consult" deterministically).
- Non-empty catalog: `gate:<stage>:<executor>` where `<executor>` is the gate agent that answered (e.g. `claude-subagent:local-board-gatecheck@haiku`), recorded *after* the agent responds.

**Collision hazard (must fix):** `completedStepRecords` (src/tickets.js:1047) splits each token on the *first* `:`, so `gate:design:skipped-empty-catalog` parses as `action="gate"`, `executor="design:skipped-empty-catalog"`. Fed through `validateRouting` (done-time) that yields a spurious `unknown action gate` issue and would block `move ... done`. Fix: filter tokens with the `gate:` prefix out of `completedStepRecords` (the routing-validation view) and parse them via a dedicated `gateConsultationRecords(ticket)` helper matching `/^gate:(design|implement|test):(.+)$/`. Gate tokens are deliberately **not** routing evidence — they never flow through `validateStepRouting` or `doneRequires`.

**2. Recording mechanism (chosen: honest two-path).**
- Extend `commandGateCheck` (src/cli.js:879): on the **empty-catalog branch only**, stamp `gate:<stage>:skipped-empty-catalog` via a new locked writer before returning the payload. Idempotent through `addUnique`, so re-running is safe. This makes `gate-check` mutate for the empty case — acceptable because the write is deterministic and idempotent, and it is the single command the orchestrator already runs. Keep the non-empty branch a pure read.
- Add a new verb **`gate-complete <ticket-id> --stage <stage> --executor <executor> [--evidence <text>]`** backed by an exported `recordGateConsultation(root, ticketId, stage, executor, evidence)` in src/tickets.js under `withTicketLock`. It stamps `gate:<stage>:<executor>` and appends a Run Log line (`Gate consultation <stage> via <executor>: <requestedSteps-or-none>`). The orchestrator calls this **after** the gate agent answers, so the token means "a consultation actually produced a result," and `--evidence` captures the verdict (which specialties, or `none`) — the very "judged unnecessary vs never asked" distinction the requirement demands.

*Rejected alternative:* have `gate-check` stamp the non-empty case at fetch time (single command, no new verb). Rejected because fetch-time stamping lets an orchestrator fetch the catalog, ignore the answer, and still satisfy the gate — defeating the requirement's integrity goal. The empty case is the only one the CLI can honestly self-certify (there is nothing to ask). This tension is called out as an open question in case the user prefers the lighter contract.

**3. Move precondition.** In `moveTicket` (src/tickets.js:335), inside the existing lock after `findTicket`, add a forward-transition gate. A helper `gateStageForForwardMove(fromStatus, toStatus)` returns the stage that must have been consulted, else `null`:
- `ready_for_design | designing` → `ready_for_implementation` ⇒ `design`
- `ready_for_implementation | implementing` → `ready_for_review` ⇒ `implement`
- `ready_for_test | testing` → `ready_for_docs` ⇒ `test`

Only these three *forward* pairs return non-null. Backward moves (e.g. `ready_for_implementation → ready_for_design`), lateral moves (`questions`, `blocked`), and archive/done paths return `null` and are never gated — satisfying "loop-backs must NOT require it." When non-null and `config.routing.requireGateConsultation === true`, require `gateConsultationRecords(ticket)` to contain an entry for that stage; otherwise throw a clear error naming the stage and the remedy (run `gate-check`, and `gate-complete` if the catalog was non-empty). This is the **only** enforcement site — nothing is added to `validateRouting`, so already-past tickets (including this board's in-flight tickets) still close.

**4. Config switch.** Add `routing.requireGateConsultation`:
- `DEFAULT_CONFIG` (src/config.js:252, the ENOENT fallback / deep-merge base): `false`. Existing boards whose config omits the key inherit `false` and do not suddenly start refusing moves.
- `defaultConfigJsonc` scaffold: `true`, so new boards enforce by default. Add a comment beside it.
- Update the `DEFAULT_CONFIG` header comment (src/config.js:16-38) to document the *third* intentional divergence, and extend the guard test `defaultConfigJsonc matches DEFAULT_CONFIG except for documented differences` (test/config.test.js:231): set `expected.routing.requireGateConsultation = true` before `deepEqual`, and add `routing.requireGateConsultation` to the collapsed-diff allowlist at line 259.
- **Dogfooding:** this repo's own `plans/local-board.config.jsonc` routing block (lines 243-251) omits the key, so it would default `false`. To actually dogfood enforcement, add `"requireGateConsultation": true` there. That is a config edit, not production source; flag for the implementer.

### Affected files

- **src/config.js** — add `requireGateConsultation` to `DEFAULT_CONFIG.routing` (`false`) and to the `defaultConfigJsonc` routing block (`true`) + comment; update the divergence comment.
- **src/tickets.js** — `gateConsultationRecords` + `gateToken` helpers; exclude `gate:` tokens from `completedStepRecords`; `gateStageForForwardMove`; move-time gate in `moveTicket`; exported `recordGateConsultation` writer.
- **src/cli.js** — empty-catalog auto-stamp in `commandGateCheck`; new `commandGateComplete` + switch case (near line 153) + `printUsage` entry.
- **test/config.test.js** — guard-test allowlist (third divergence).
- **test/** (tickets/cli suites) — new coverage (see Test strategy).
- **SKILL.md** (and `skills/codex/local-board/SKILL.md`) — document `gate-complete`, the move precondition, and correct line ~185 ("never blocks closeout"): consultation is now required for forward moves out of gated stages when the switch is on, while specialty *results* remain non-gating.
- **resources/prompts/steps/gate-check.md**, and the design/implement/test step prompts (`plans/prompts/steps/design.md`, `.../roles/implementer.md`, `plans/prompts/steps/test.md`) — instruct recording the consultation before `move`.
- **memory-bank/systemPatterns.md** — note the gate-consultation token and move gate.

### Risks and edge cases

- **Token-collision regression (highest):** if `gate:` tokens are not excluded from `completedStepRecords`, every done-move for a gated ticket breaks. Cover with a direct test.
- **`gate-check` becoming a writer** surprises callers expecting a pure read; confine the write to the empty-catalog branch and keep it idempotent.
- **Executor string in the gate token** must not be re-validated as routing evidence (gate agents are not in `doneRequires`); the exclusion in `completedStepRecords` handles this.
- **Active-stage variants** (`designing`/`implementing`/`testing`) must be handled identically to their `ready_for_*` counterparts in `gateStageForForwardMove`.
- **`set <id> status <forward>`** routes through `moveTicket` (src/tickets.js:439), so it is gated too — intended, but note it in tests.
- **Backward/lateral/archive moves** must stay ungated; a too-broad `from`-status check would trap loop-backs and `archiveDoneTickets`.
- **Default-off for existing boards** must be verified so no pre-existing board starts refusing moves after upgrade.

### Test strategy

- Config: guard test updated; `loadConfig` yields `requireGateConsultation=false` when omitted and `true` from the scaffold.
- `completedStepRecords` / `validateRouting`: a ticket with a `gate:design:...` token still passes done-validation (no `unknown action` issue) and `move ... done` succeeds.
- `moveTicket` gating (switch on): forward move out of each gated stage is refused without a matching gate token and succeeds with one; backward, `questions`, `blocked`, and archive moves are never refused; switch off disables all refusals.
- `gate-check` empty catalog: records `gate:<stage>:skipped-empty-catalog`, dispatches no agent, needs no prompt file (B1320), is idempotent on re-run.
- `gate-complete`: records `gate:<stage>:<executor>`, appends Run Log, rejects bad stage/missing args.
- Back-compat: a ticket already at `ready_for_docs` with no gate tokens still moves to `done`.

### Open questions

1. **Recording contract:** confirm the two-path design (empty auto-stamp by `gate-check` + `gate-complete` verb for non-empty) over the simpler single-command "gate-check stamps on every run at fetch time." The two-path is more honest but adds a verb; the single-command is lighter but lets fetch-and-ignore satisfy the gate. Recommendation: two-path.
2. **Field vs completedSteps:** requirement says record in `completedSteps`; a dedicated `gateChecks` front-matter field would avoid the token-collision fix entirely. Staying with `completedSteps` per the requirement, but flagging the cleaner alternative.
3. **Dogfood config:** should this ticket also flip `requireGateConsultation: true` in this repo's `plans/local-board.config.jsonc`, or leave that to a follow-up so the board doesn't start refusing its own in-flight moves mid-migration?

## Implementation Notes

Implemented per the Technical Design, resolving all three open questions as recommended (two-path recording; `completedSteps` per the requirement; dogfood config left untouched — see below).

**src/tickets.js**
- Added `gateConsultationRecords(ticket)` (parses `gate:<stage>:<executor>` via `/^gate:(design|implement|test):(.+)$/`) and `gateStageForForwardMove(fromStatus, toStatus)` (returns the stage for exactly the three forward pairs — `ready_for_design|designing`→`ready_for_implementation`, `ready_for_implementation|implementing`→`ready_for_review`, `ready_for_test|testing`→`ready_for_docs` — `null` otherwise, so backward/lateral/archive/done moves are never gated).
- `completedStepRecords` now filters out `gate:` tokens before the first-`:` split, so they never surface as routing evidence (`validateStepRouting`/`doneRequires`/done-time `validate`).
- `moveTicket` computes `gateStageForForwardMove` before the write; when non-null and `config.routing.requireGateConsultation === true`, it requires a matching `gateConsultationRecords` entry or throws an actionable error naming the stage and remedy (`gate-check` then `gate-complete`). Config is loaded once, only when the gate check or the done-time `validateRouting` needs it (unchanged perf characteristics for the common backward/lateral/in-stage move). `setTicketField(..., "status", ...)` routes through `moveTicket`, so `set <id> status <forward>` is gated too, as noted in the design.
- Added exported writers `recordGateSkippedEmptyCatalog(root, ticketId, stage, options)` (stamps `gate:<stage>:skipped-empty-catalog`, no Run Log line — deterministic CLI self-certification) and `recordGateConsultation(root, ticketId, stage, executor, evidence, options)` (stamps `gate:<stage>:<executor>` and appends a Run Log line), both under `withTicketLock` via a shared `stampGateToken` helper, both idempotent via `addUnique`.

**src/cli.js**
- `commandGateCheck`: on the empty-catalog branch (and only there), calls `recordGateSkippedEmptyCatalog` before returning the payload; the non-empty branch stays a pure read.
- New `commandGateComplete` + `gate-complete` switch case + `printUsage` line: `gate-complete <ticket-id> --stage <stage> --executor <executor> [--evidence <text>]` (evidence defaults to `"none"` when omitted, per the Technical Design's bracketed-optional signature).

**src/config.js**
- `DEFAULT_CONFIG.routing.requireGateConsultation = false` (ENOENT fallback / merge base — backward compat).
- `defaultConfigJsonc()` routing block: `"requireGateConsultation": true` with an inline comment; updated the `DEFAULT_CONFIG` header comment to document this as the third intentional divergence (alongside `estimation.enabled` and `optionalSteps`).

**test/config.test.js**
- Guard test `defaultConfigJsonc matches DEFAULT_CONFIG except for documented differences`: added `expected.routing.requireGateConsultation = true` and `"routing.requireGateConsultation"` to the collapsed-diff allowlist (third entry, alphabetically after `optionalSteps`).

**test/tickets.test.js** (11 new tests) — pure-function coverage for `gateConsultationRecords`/`gateStageForForwardMove`; `recordGateSkippedEmptyCatalog` (idempotent, no Run Log) and its bad-stage rejection; `recordGateConsultation` (route and route@model executor forms, Run Log line) and its bad-stage/invalid-executor/empty-evidence rejections; the token-collision regression test (hand-written `gate:design:...`/`gate:implement:...`/`gate:test:...` tokens alongside full mandatory evidence still `validate` clean and reach `done`); `moveTicket` refusal for all six from/to variants of the three gated pairs (refused without token, succeeds once `recordGateSkippedEmptyCatalog` runs) with one `writeConfig` helper added; a backward/lateral/archive/done non-gating test with the switch on; a switch-off test (both no-config-file default and explicit `false`); `set status` routing-through-`moveTicket` gating; and a back-compat test (pre-existing `ready_for_docs` ticket with no gate tokens still reaches `done` with the switch on, since `ready_for_docs`→`done` is not one of the three gated pairs).

**test/cli.test.js** (8 new tests) — CLI-level empty-catalog auto-stamp + idempotency; non-empty-catalog pure-read (no stamp); `gate-complete` JSON + plain output covering both `route@model` and route-only executor forms plus the default `"none"` evidence; `gate-complete` argument/stage validation; an end-to-end `move` refusal-then-success test against the `init`-scaffolded config (switch on by default); and a switch-off override test.

**Docs**: `SKILL.md` and `skills/codex/local-board/SKILL.md` document `gate-complete`, the move precondition, and correct the prior "never blocks closeout" line to distinguish gated *consultation* (now enforced) from non-gating specialty *evidence* (unchanged). `memory-bank/systemPatterns.md` updated (Config, Role/Step Prompts, MVP CLI sections). Added a short "record before move" note to `plans/prompts/steps/{design,test,gate-check}.md` and `plans/prompts/roles/implementer.md`, mirrored byte-for-byte into their `resources/prompts/...` counterparts (required by `test/resources-sync.test.js`).

**Dogfood config — intentionally NOT changed**: per the dispatch instruction, this repo's own `plans/local-board.config.jsonc` routing block still omits `requireGateConsultation`, so it defaults to `false` (unaffected). The orchestrator will flip it to `true` after this ticket merges, to avoid refusing in-flight tickets mid-run.

**Verification**: `npm run check` clean; `npm test` → 303 tests, 302 pass, 1 skipped (pre-existing opt-in slow smoke test, unrelated), 0 fail; `npm run validate` → "Ticket validation OK" against this repo's own live board (confirms the switch-off default leaves in-flight tickets, including this one, unaffected). Ran `resources-sync`/`prompt-scaffold`/`install` suites individually after doc edits to confirm the `plans/`↔`resources/` mirror and rendered-SKILL invariants still hold.

**Deviations from the dispatch summary's paraphrase**: the dispatch text's prose sketch showed `gate-complete <ticket-id> <stage> --executor ...` (stage positional). The Technical Design section is explicit and authoritative on the actual signature — `gate-complete <ticket-id> --stage <stage> --executor <executor> [--evidence <text>]` — so that is what's implemented and tested; no ambiguity remained once the Technical Design was read.

**No known remaining risks** beyond what the design flagged: the token-collision regression is covered directly; all three config states (unset/false/true) are covered; the three forward pairs and their active-status variants are covered individually.

## Review Findings

Reviewed by codex-task:read-only (gpt-5.5) against commit b4659ce.

No blocking findings.

- Routing isolation holds: completedStepRecords filters gate:(design|implement|test): before routing validation (src/tickets.js:1189); validateRouting/doneRequires see only action evidence.
- Grammar collision contained: an action literally named "gate" can't match GATE_TOKEN_RE unless its executor starts with a stage name + colon, which the executor route grammar forbids (:1717).
- Forward pairs exact (declared :80, enforced :414); loop-backs/questions/blocked/done/archive return null; a ticket born at ready_for_implementation still requires the implement consultation before ready_for_review.
- Two-path honesty as designed; the self-reported gate-complete residual is documented in the ticket (hooks dispatch-ledger covers the Claude side).
- gate-complete validates stage/executor/evidence via existing paths; addUnique prevents duplicate tokens (repeat calls do append extra Run Log lines — cosmetic).
- Config split per the B1321 pattern with the guard allowlist updated; paired plans/resources prompt edits byte-identical and covered by the drift test.

Verification caveat: reviewer inspected only (read-only sandbox); suite delegated to test stage.

Verdict: pass

## Test Evidence

Tested by claude-subagent:local-board-tester (sonnet) on branch local-board/T20260707T1327Z-..., commit b4659ce.

**Suite:** `npm run check` pass; `npm test` 302 pass / 1 gated-skip; `npm run validate` OK.

**End-to-end probe (fresh scaffold board, switch ON):**
- Forward moves refused without tokens at all three boundaries, each with the actionable message naming gate-check and gate-complete with exact next commands (full text captured for design; implement/test variants confirmed).
- Non-empty catalogs (design, implement): gate-check is a pure read (no premature stamp); gate-complete stamps gate:<stage>:<route>@<model> and unblocks the move.
- Empty catalog (test): gate:test:skipped-empty-catalog auto-stamped with zero agent dispatch; idempotent on re-run; move then succeeds.
- Review boundary correctly ungated. Loop-backs (questions round-trip, explicit backward move) never gated. `set status` routes through moveTicket and is gated identically.
- Switch-off board reproduces old behavior exactly.
- Done-time invisibility verified live: a ticket carrying all three gate-token forms moved to done with clean validate.

**Gaps / caveats:** review-stage inline variant untested (review is not a gated stage); switch-off edit used a scratch-board node script (tester lacks Write); no flakes.

Result: pass

## Documentation Updates

Documented by codex-task:workspace-write (gpt-5.5).

- `docs/Workflow.md` + `docs/specialty-steps.md` — gate-check narrative updated: consultations recorded as gate:<stage> tokens, empty catalogs self-certify, gate-complete records real consultations, requireGateConsultation gates forward stage moves, tokens invisible to routing evidence and doneRequires.
- `README.md` — gate-complete added to the CLI list beside gate-check.
- `memory-bank/systemPatterns.md` — verified the implementation-pass note already covers the scaffold/fallback defaults; unchanged.
- SKILL.md, codex skill, and the paired prompt files were updated during implementation.

## Questions

## Run Log

- 2026-07-07T21:21:40Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): gate tokens via honest two-path recording (auto-stamp skipped-empty-catalog; gate-complete verb after real dispatch), move-time enforcement on three forward pairs only, routing.requireGateConsultation defaulting per the B1321 pattern; gate-token filtering flagged as top regression risk. Estimate 4 (basis T20260707T1325Z).

- 2026-07-07T21:22:36Z: Ensured git branch local-board/T20260707T1327Z-enforce-record-gate-check-consultation-and-require-it-when-leaving-gated-stages (created).

- 2026-07-07T21:39:50Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Implementer (sonnet): gate token grammar + auto-stamp + gate-complete verb + move-time precondition + config switch; 302 pass 1 gated-skip; repo config intentionally not flipped mid-run.

- 2026-07-07T21:44:24Z: Completed review via codex-task:read-only: Codex (gpt-5.5, read-only) verdict pass: routing isolation, grammar-collision containment, exact forward pairs, honest two-path recording all verified; duplicate-Run-Log nit noted.

- 2026-07-07T21:49:23Z: Completed test via claude-subagent:local-board-tester@sonnet: Tester (sonnet): 302+1 gated; full pipeline probe hit all three refusals with actionable messages, verified pure-read non-empty gates, idempotent empty-catalog auto-stamp, ungated loop-backs, switch-off back-compat, and done-time invisibility live. Result: pass.

- 2026-07-07T21:51:37Z: Completed document via codex-task:workspace-write: Codex (workspace-write): Workflow + specialty-steps narratives updated for consultation tokens; README gains gate-complete; systemPatterns verified current.
