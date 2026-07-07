---
id: T20260707T1326Z
type: task
status: implementing
priority: P1
parent: null
children: []
blockedBy: [T20260707T1325Z]
blocks: []
branch: local-board/T20260707T1326Z-enforce-claude-code-hooks-for-dispatch-ledger-evidence-gate-routing-validator-and-approve-inline-consent
estimate: 8
estimateBasis: T20260707T1325Z
workStartedAt: 2026-07-07T18:06:04Z
workCompletedAt: null
created: 2026-07-07T13:26:41Z
updated: 2026-07-07T18:30:38Z
completedSteps: ["design:claude-subagent:local-board-designer@opus"]
routingApprovals: []
---
# enforce: Claude Code hooks for dispatch ledger, evidence gate, routing validator, and approve-inline consent

## Requirement

Completion evidence is self-reported: an orchestrator can do every step inline and record `--executor claude-subagent:local-board-designer@opus`, and strict routing passes (`src/tickets.js:448-492`, `755-776`). `approve-inline` requires only a non-empty `--reason`, so the strict-routing escape hatch is controlled by the party it constrains. Claude Code hooks can close this on the Claude side. Confirmed mechanics: PreToolUse hooks receive the literal tool input (`subagent_type`, prompt, `model`) for Agent/Task dispatches, can deny with a reason fed back to the model or return `permissionDecision: "ask"`, and hook commands can be arbitrary node scripts configured in `.claude/settings.json`.

Build, in order:
1. Dispatch ledger + evidence gate: PostToolUse on Task appends `{ts, subagent_type, model, ticketId}` to `.local-board/dispatch-ledger.jsonl` (require a machine-readable `Ticket: <id>` line in dispatch prompts — one-line skill change). PreToolUse on Bash matching `complete-step`: deny a `claude-subagent:*` executor claim with no matching ledger entry newer than the ticket's last loop-back.
2. Routing/model validator: PreToolUse on Task; when `subagent_type` starts with `local-board-`, run `check-dispatch` (T20260707T1325Z) and deny on mismatch, reporting the expected route.
3. approve-inline consent: PreToolUse on Bash matching `approve-inline` returns `ask`, making the human permission prompt the deterministic user approval.

Hooks ship with `local-board install` (and/or the plugin, T20260707T1323Z). Document what hooks cannot see: inline work produces no tool call; skipped steps produce no event (CLI preconditions cover those — T20260707T1327Z, T20260707T1328Z); Codex has no deny-hook equivalent, so Codex enforcement stays CLI-side.

Depends on: T20260707T1325Z.

Acceptance: with hooks installed, a wrong-agent or wrong-model Task dispatch is denied; a complete-step claiming an unledgered subagent execution is denied; approve-inline triggers a human prompt; all three degrade gracefully when the CLI is absent.

## Acceptance Criteria

## Related Tickets

## Technical Design

Three Claude Code hooks close the self-reporting hole on the Claude side: a dispatch ledger + evidence gate, a routing/model validator, and an `approve-inline` consent prompt. All enforcement is pre-emptive and best-effort; the CLI-side preconditions (T1327/T1328/T1329) remain the authoritative backstop. Hooks are pure stdin-JSON programs installed by `local-board install` and wired into the user `~/.claude/settings.json`.

## Related Tickets and Conflicts

- **T20260707T1325Z (landed)** — `check-dispatch` is the verdict primitive. The routing validator hook shells out to it (`src/active-steps.js:checkDispatch`, wired at `src/cli.js:513`). No conflict; this ticket consumes its stable JSON+exit-code contract.
- **T20260707T1327Z / T1328Z / T1329Z (CLI-side preconditions)** — own the cases hooks cannot see (inline work, skipped steps, loop-back evidence invalidation, Codex). This ticket must not duplicate their logic; it documents the residuals and defers to them. T1328Z specifically owns invalidating stale ledger/evidence across a loop-back, which lets us keep the v1 evidence gate simple (below).
- **T20260707T1323Z (plugin packaging)** — hooks should be plugin-compatible later. Keep every hook script self-contained (no `import` from `src/`; talk to the CLI only by spawning `bin/local-board.js`). That way the same script files can move into a plugin bundle unchanged.
- **B20260707T1322Z (ledger locking)** — the PostToolUse ledger append is a concurrent writer (background/parallel dispatches). This ticket ships an unlocked `appendFileSync`; B1322Z owns real locking. Note the race, do not solve it here.
- **Conflict watch:** `install.js` `patchSettings` (`src/install.js:414`) currently only manages `permissions.allow`. This ticket extends the same file with a `hooks` key; the two patchers must be independently idempotent so re-running install never duplicates entries.

## Implementation Approach

### Hook scripts (self-contained, pure)

Four scripts under a new package `hooks/` directory, each a pure `stdin JSON -> {stdout JSON | exit code}` program with a thin `main()` and an exported `handle(payload, deps)` for tests. Every script wraps `main()` in try/catch and **exits 0 (fail-open) on any unexpected error** — a buggy hook must never brick a session.

1. `hooks/dispatch-ledger.js` — **PostToolUse, matcher `Task`.** Reads `tool_input.prompt`, extracts the ticket id from the first line matching `^\s*Ticket:\s*(\S+)`, and appends one JSONL line `{ts, subagent_type, model, ticketId, session_id}` to `<mainRoot>/.local-board/dispatch-ledger.jsonl`. `subagent_type`/`model` come from `tool_input`; `session_id` from the payload. Root is derived from payload `cwd`; the main-worktree resolution reuses the same `git rev-parse --git-common-dir` logic as `active-steps.js:resolveMainRoot` (copied inline to stay import-free, or shelled via a tiny CLI helper — prefer inline `child_process` git call). No ticket line -> record `ticketId: null` (still audit-useful) and continue. Always exits 0 (PostToolUse cannot deny; failures are swallowed).

2. `hooks/routing-validator.js` — **PreToolUse, matcher `Task`.** Fast path: if `tool_input.subagent_type` does not start with `local-board-`, exit 0 with no spawn. Otherwise parse the ticket id from `tool_input.prompt` (`Ticket:` line); if absent, exit 0 (cannot validate — documented residual). Spawn `node <installDir>/bin/local-board.js check-dispatch --agent <subagent_type> [--model <tool_input.model>] --ticket <id> --root <cwd>` via `spawnSync`. Map result: exit 0 -> allow (exit 0); exit 1 -> emit `{hookSpecificOutput:{permissionDecision:"deny", permissionDecisionReason:<JSON reason>}}`; **exit 2 or spawn failure (ENOENT/timeout) -> fail-open allow** with a `permissionDecisionReason` warning string (below).

3. `hooks/evidence-gate.js` — **PreToolUse, matcher `Bash`.** Fast path: if `tool_input.command` contains neither `complete-step` -> exit 0 immediately (no spawn, no parse). Else parse the command line: match both `local-board complete-step` and `node <...>local-board.js complete-step`, extract the first positional (ticket id), the action, and `--executor <value>`. Only gate when the executor route starts with `claude-subagent:`; `inline`/`codex-task:*` executors exit 0 (they are not ledger-backed and are covered CLI-side). Map the executor `claude-subagent:<name>@<model>` to `subagent_type = <name>`. Gate: read `dispatch-ledger.jsonl`, require ≥1 entry with matching `ticketId` and `subagent_type` **scoped to the current `session_id`** (see loop-back simplification). Present -> allow; absent -> deny with a reason naming the missing dispatch. Ledger file missing / unreadable -> **fail-open allow**.

4. `hooks/approve-inline-consent.js` — **PreToolUse, matcher `Bash`.** Fast path unless `tool_input.command` matches the `approve-inline` subcommand token. On match, emit `{hookSpecificOutput:{permissionDecision:"ask", permissionDecisionReason:"approve-inline is a routing deviation; confirm to record it as user consent."}}`. This makes the human permission prompt the deterministic approval the requirement asks for.

The two Bash-matcher scripts are registered as **two separate hooks under one matcher** (not merged) so a crash in `evidence-gate` cannot disable `approve-inline-consent`, and vice-versa; each fires independently.

### Fail-open decision (exit 2 / spawn failure)

**Recommend fail-open.** The pre-emptive hook layer is defense-in-depth, not the sole gate: `complete-step` still runs `validateStepRouting` with `enforceModel` at write time (`src/tickets.js:872`), so a down or absent CLI does not remove enforcement — it only removes the *earlier* deny. Fail-closed would brick every `local-board-*` dispatch the moment the CLI is missing from PATH, the ledger is corrupt, or a spawn times out — a far worse failure mode than a momentarily-permissive dispatch that the CLI still catches at completion. The fail-open reason string is surfaced to the model (`permissionDecisionReason`) so the lapse is visible, not silent. exit 1 (a real, computed mismatch) always denies; only ambiguous/error states (exit 2, ENOENT, timeout, JSON parse failure) fall open.

### Loop-back evidence gate simplification (v1)

The requirement's "newer than the ticket's last loop-back" needs a loop-back timestamp the hook does not have. **v1 gate: require ≥1 `dispatch-ledger.jsonl` entry matching `(ticketId, subagent_type)` within the current `session_id`.** Session scoping (from the hook payload) bounds staleness to the live session and is the simplest defensible rule that still blocks the headline attack (claim a subagent execution that never happened this session). **Documented residual bypass:** within a single long session that loops a ticket back through the same step, a ledger entry from the *earlier* iteration satisfies the gate even if the re-run was done inline. T1328Z owns CLI-side loop-back evidence invalidation and closes this; do not attempt a timestamp-diffing heuristic in the hook.

### Install wiring

- New `hooks/` dir copied into `~/.local-board/hooks/` by adding `copyDir("hooks", "hooks", installDir)` in `performInstall` (`src/install.js:158`).
- New `patchHooks(settingsPath, installDir)` mirroring `patchSettings`: ensures `settings.hooks.PreToolUse` / `.PostToolUse` arrays exist and contains the four command entries, **deduped by exact command string** so re-runs are idempotent. Commands use absolute forward-slash paths: `node <installDir>/hooks/<script>.js`. Same atomic tmp+rename write as `patchSettings`.
- **Wiring is claude-only** (Codex has no deny-hook; `settingsPath` is null for every other target).
- **Opt-in for v1.** Add `--hooks` / `--no-hooks` to `parseArgs` (`src/install.js:345`). Default: hooks **off**, with a printed hint after install (`Run 'local-board install --hooks' to enable Claude Code dispatch-enforcement hooks`). Rationale: the existing allow-rule patch is non-destructive; deny-hooks change permission behavior and, if the tool-name matcher is wrong or a script misbehaves, can disrupt real work. Ship opt-in, prove it, then flip default-on in a follow-up once the matcher/tool-name is field-confirmed. `--no-hooks` removes the managed entries (dedup key makes removal precise).

### Skill / prompt change

One-line addition to `SKILL.md` (and the rendered skill templates) mandating that every dispatch prompt's **first line** be `Ticket: <id>` — this session's dispatches already follow it. This is the machine-readable anchor both the ledger and validator parse. No production dispatch-code change beyond the doc.

### Ledger growth

v1: append-only JSONL, no rotation. Add a one-line note in `docs/Workflow.md` that the file grows unbounded and a size cap / per-session prune is a follow-up. Entries are tiny (~120 bytes); realistic sessions stay well under a MB. Locking/rotation are B1322Z's concern.

## Affected Files

- `hooks/dispatch-ledger.js`, `hooks/routing-validator.js`, `hooks/evidence-gate.js`, `hooks/approve-inline-consent.js` — new.
- `src/install.js` — `copyDir("hooks", ...)`, `patchHooks()`, `--hooks`/`--no-hooks` in `parseArgs`, help text, printed hint.
- `SKILL.md` (+ `skills/**` rendered templates) — mandate the `Ticket: <id>` first line.
- `docs/Workflow.md` — new "Dispatch enforcement hooks" subsection: what they enforce, install flag, fail-open behavior, and the explicit limits (inline work emits no tool call; skipped steps emit no event; Codex has no deny-hook; loop-back residual) — restated as documented limits owned by the CLI preconditions.
- `test/hooks.test.js` (new) + `test/install.test.js` (extend for hook patching).
- Possibly `README.md` doc index if a new docs file is added (prefer a Workflow.md subsection, no new file).

## Risks

- **Tool-name matcher uncertainty (highest).** If the subagent dispatch tool is not literally `Task` (could be `Agent`) the PreToolUse/PostToolUse hooks silently never fire. Mitigation: confirm against the live harness during implementation; keep the matcher value in one constant; opt-in default limits blast radius. Open question below.
- **`approve-inline` "ask" in unattended runs.** If the orchestrator runs headless/CI, a `permissionDecision:"ask"` may hang or auto-deny, blocking legitimate inline approvals. Needs confirmation of headless behavior; may need a documented env bypass. Open question.
- **Command-parse false positives.** A `--evidence`/`--reason` text containing the literal `approve-inline` or `complete-step` could trigger a spurious `ask`/gate. Mitigation: match the subcommand as a whitespace-bounded token immediately after the `local-board`/`local-board.js` program token, not an arbitrary substring. Residual: still possible in pathological arg text; err toward `ask` (safe) and document.
- **Prompt spoofing.** A dispatch prompt could embed a fake `Ticket:` line to steer the ledger/validator. Low impact (worst case a wrong/absent ticket id degrades to fail-open allow); document, do not harden in v1.
- **Ledger write race** (B1322Z) — interleaved appends from concurrent background dispatches may corrupt a line; `appendFileSync` of a sub-4KB line is near-atomic on POSIX, weaker on Windows. Reader tolerates malformed lines (skip-on-parse-error). Note.
- **Windows execution shell** is under-documented — scripts are invoked as `node <abs-path>` with no shell builtins, no chained operators, forward-slash paths. Avoids the risk entirely.
- **Fail-open visibility** — a chronically-down CLI silently disables the pre-emptive layer; the `complete-step` backstop still fires, but a warning-reason string keeps it from being wholly invisible.

## Test Strategy

Each script exports `handle(payload, deps)` (deps = `{spawnSync, readLedger, appendLedger, now}`) so `node:test` drives it with synthetic payloads — no live Claude session needed.

- **dispatch-ledger:** Task payload with `Ticket:` line -> correct record appended; no ticket line -> `ticketId:null`; non-Task/other tool -> no-op; append target path resolves to main worktree.
- **routing-validator:** local-board agent, `spawnSync` stub exit 0 -> allow; exit 1 -> deny carrying the JSON reason; non-`local-board-` subagent -> allow **without** invoking spawn (assert stub uncalled); missing ticket line -> allow; stub exit 2 / thrown ENOENT / timeout -> fail-open allow with warning reason.
- **evidence-gate:** `complete-step` + `claude-subagent:...` executor with a matching in-session ledger entry -> allow; no matching entry -> deny; `inline`/`codex-task:*` executor -> allow; command lacking `complete-step` -> allow via fast path (assert no ledger read); missing/corrupt ledger -> fail-open allow; both `local-board complete-step` and `node .../local-board.js complete-step` command forms parse identically.
- **approve-inline-consent:** command with the `approve-inline` token -> `ask`; unrelated command -> allow.
- **install (integration):** `--hooks` writes all four entries into a temp `settings.json`; re-run is idempotent (no dupes); coexists with the existing allow rule; `--no-hooks` omits/removes them; non-claude targets untouched.
- **End-to-end (optional, in-process):** feed a real `check-dispatch` (not stubbed) against a fixture ledger through the validator to confirm the wire contract.

## Open Questions

1. Exact subagent dispatch tool name for the matcher (`Task` vs `Agent`) in the current Claude Code — blocks correct registration.
2. v1 default: opt-in `--hooks` (recommended) vs default-on — confirm product preference.
3. Headless/CI behavior of `permissionDecision:"ask"` for `approve-inline` — does it prompt, hang, or auto-deny? May need a documented bypass for unattended orchestrator runs.
4. Is `model` reliably present in `tool_input` for Task dispatches? If not, model validation degrades to `model-unverifiable` (already handled by `check-dispatch`) — acceptable, but confirm.

## Implementation Notes

Implemented all four self-contained hook scripts under `hooks/` per the Technical Design, plus install wiring, skill mandate, docs, and tests.

**New files:**
- `hooks/dispatch-ledger.js` (PostToolUse, matcher `Task|Agent`): appends `{ts, subagent_type, model, ticketId, session_id}` to `<mainRoot>/.local-board/dispatch-ledger.jsonl`; ticket id parsed from a `Ticket: <id>` first-matching line in `tool_input.prompt`; main-root resolved via an inline `git rev-parse --git-common-dir` shell-out (no `src/` import). Always exits 0.
- `hooks/routing-validator.js` (PreToolUse, matcher `Task|Agent`): fast-paths on non-`local-board-*` subagents and missing `Ticket:` lines (no spawn); otherwise spawns `node <installDir>/bin/local-board.js check-dispatch --agent --model --ticket --root <cwd>` (installDir resolved as the hook's own parent dir, valid both in a dev checkout and an installed `~/.local-board/` tree); exit 0 -> allow, exit 1 -> deny with the JSON reason, exit 2/ENOENT/timeout -> fail-open allow with a warning `permissionDecisionReason`. `LOCAL_BOARD_HOOK_CLI_PATH` env var and `deps.spawnSync`/`deps.cliPath` are test seams.
- `hooks/evidence-gate.js` (PreToolUse, matcher `Bash`): cheap substring fast-path on `complete-step`, then a whitespace-token-precise parse (locates the subcommand immediately after the `local-board`/`local-board.js` program token, skipping `--root <value>`) to avoid `--evidence`/`--reason` substring false positives; gates only `claude-subagent:*` executor claims (inline/codex-task:* pass through) on a session-scoped `dispatch-ledger.jsonl` match; missing/unreadable ledger fails open.
- `hooks/approve-inline-consent.js` (PreToolUse, matcher `Bash`): same token-precise match for `approve-inline`; returns `permissionDecision: "ask"` with the specified reason string.

All four export `handle(payload, deps)` for direct-import unit tests and wrap `main()` in try/catch, always exiting 0 (fail-open). **Notable fix during implementation:** stdin was originally read via `fs.readFileSync(0)`, which hangs indefinitely on Windows when the hook is launched by an async spawn (`child_process.execFile`/`spawn`) rather than a sync one (`execFileSync`/`spawnSync`) — reproduced independently of these scripts. Switched all four to async stream-based stdin reading (`process.stdin` `data`/`end` events), which works under both spawn styles. Recommend flagging this as a real risk for the live Claude Code hook runner if it uses async spawn internally.

**`src/install.js`:**
- `copyDir("hooks", "hooks", installDir)` — unconditional, hooks/ ships regardless of wiring.
- `--hooks` / `--no-hooks` flags in `parseArgs` (default: neither set, i.e. hooks off). `--no-hooks` is checked before the generic `--no-<target>` fallback so it doesn't collide with target-exclusion parsing.
- New `patchHooks(settingsPath, installDir, {remove})`: idempotent, dedup-by-exact-command-string patcher for `settings.hooks.{PreToolUse,PostToolUse}`, mirroring `patchSettings`'s atomic tmp+rename write. Registers `routing-validator.js` and `dispatch-ledger.js` each under their own `Task|Agent` matcher group, and `evidence-gate.js` + `approve-inline-consent.js` as two separate hook entries under one shared `Bash` matcher group (independent commands, not merged scripts, so one crashing can't disable the other). `remove: true` deletes only the managed command strings and prunes now-empty matcher groups/event arrays, leaving user-authored hooks untouched.
- Default install prints a hint (`Run 'local-board install --hooks' to enable...`) when hooks weren't enabled and a Claude-like target was selected. `performUninstall` also removes wired hook entries from `settings.json` for any target with a `settingsPath`.

**Skill mandate:** one-line addition to `SKILL.md` (step 9) and `SKILL_TEAM.md` (Execution profiles) requiring every Claude subagent dispatch prompt's first line be `Ticket: <id>`. Did not add this to the Codex skill templates (`skills/codex/**`) — Codex dispatch doesn't go through the Task/Agent tool the hooks match on, so the anchor has no consumer there; flagging as a minor scope call in case the ticket intended it for consistency.

**`docs/Workflow.md`:** new "Dispatch enforcement hooks" subsection (under Agent Routing) documenting the four hooks, fail-open policy, and the documented residual limits (inline/skipped-step blindness, same-session loop-back residual, Codex has no deny-hook, unlocked/unrotated ledger).

**`package.json`:** added `hooks` to the `files` allowlist and four `node --check` invocations to the `check` script.

**Tests:**
- `test/hooks.test.js` (new, 30 tests): direct `handle()` unit tests for every fast-path/deny/allow/fail-open branch in all four scripts (including "spawn not invoked" assertions via `deps` stubs), plus spawned-subprocess end-to-end tests (real `git` temp repos, real ledger files, a stub `check-dispatch` CLI via `LOCAL_BOARD_HOOK_CLI_PATH`) verifying the actual stdin-JSON -> exit-code/stdout-JSON contract. Note: the spawned-process test helper deliberately avoids `child_process.execFile`'s `input` option — on this Windows/Node (v24.14.0) combination that option hangs indefinitely (reproduced with a minimal isolated repro, independent of these hook scripts); it instead spawns and writes/closes `child.stdin` manually, which is the same pattern a real hook runner uses.
- `test/install.test.js`: 6 new tests for `--hooks`/`--no-hooks` (opt-in hint, all-four-entries + idempotency, precise removal preserving user-authored hooks/allow-rule, non-Claude target no-op, uninstall removes wired entries).
- `test/pack.test.js` and the packaged-copy fixture list in `test/install.test.js`: added `hooks/`.

**Verification:** `npm run check` (green), `npm test` — 241/241 passing (30 new in `hooks.test.js`, 6 new in `install.test.js`), `npm run validate` (green), `npm pack --dry-run` includes all four `hooks/*.js` files.

**Deviations / things to flag for review:**
1. Chose a uniform hook-output contract (`{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason } }`) for deny/ask/fail-open-with-warning, and print nothing for a plain allow. This wasn't spelled out verbatim in the design but follows its description closely; worth confirming against the live Claude Code hook JSON schema during the open-question validation pass.
2. `routing-validator.js` resolves its own CLI path as `<its own dir>/../bin/local-board.js` rather than taking an explicit `installDir` argument — this is exact for both a dev checkout and an installed tree (hooks/ and bin/ are always siblings), but differs from the design's literal phrasing of a passed `<installDir>`. Added `LOCAL_BOARD_HOOK_CLI_PATH` as an override/test seam.
3. Did not add the `Ticket: <id>` mandate to the Codex skill templates (see above).
4. Open questions 1/3/4 from the ticket (exact Task-vs-Agent tool name, headless `ask` behavior, `model` presence reliability) are not resolvable from this implementation pass — matcher registers both names defensively; the rest is unverifiable without a live harness run.

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-07T18:04:53Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): four self-contained stdin-JSON hook scripts in hooks/, installed to ~/.local-board/hooks and wired via new patchHooks into user settings; opt-in --hooks flag; fail-open on errors (CLI validation is the backstop); session-scoped ledger gate. Estimate 8 (basis T20260707T1325Z).

- 2026-07-07T18:06:04Z: Ensured git branch local-board/T20260707T1326Z-enforce-claude-code-hooks-for-dispatch-ledger-evidence-gate-routing-validator-and-approve-inline-consent (created).
