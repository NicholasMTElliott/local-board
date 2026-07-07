---
id: T20260707T1327Z
type: task
status: ready_for_implementation
priority: P2
parent: null
children: []
blockedBy: []
blocks: [T20260707T1333Z]
branch: null
estimate: 4
estimateBasis: T20260707T1325Z
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T13:27:41Z
updated: 2026-07-07T21:22:35Z
completedSteps: ["design:claude-subagent:local-board-designer@opus"]
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

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-07T21:21:40Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): gate tokens via honest two-path recording (auto-stamp skipped-empty-catalog; gate-complete verb after real dispatch), move-time enforcement on three forward pairs only, routing.requireGateConsultation defaulting per the B1321 pattern; gate-token filtering flagged as top regression risk. Estimate 4 (basis T20260707T1325Z).
