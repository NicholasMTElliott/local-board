---
id: B20260707T1324Z
type: bug
status: done
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/B20260707T1324Z-takeoption-consumes-a-following-flag-as-its-option-value
estimate: 1
estimateBasis: B20260707T2245Z
workStartedAt: 2026-07-08T00:40:42Z
workCompletedAt: 2026-07-08T00:59:04Z
created: 2026-07-07T13:24:08Z
updated: 2026-07-08T00:59:04Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "implement:claude-subagent:local-board-implementer@sonnet", review:codex-task:read-only, "test:claude-subagent:local-board-tester@sonnet", gate:test:skipped-empty-catalog, document:codex-task:workspace-write]
routingApprovals: []
---
# takeOption consumes a following flag as its option value

## Requirement

`takeOption` (`src/cli.js:924-935`) consumes whatever token follows an option flag, including another flag. `complete-step T1 test --evidence --json` silently records the string `--json` as evidence instead of erroring.

Fix: error when an option value starts with `--`.

Acceptance: passing a flag where a value is expected produces a clear usage error; existing tests still pass.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Approach

`takeOption` (`src/cli.js:1136`) currently returns `args[index + 1]` unconditionally, so when a flag immediately follows an option name the flag token is swallowed as the value (e.g. `complete-step T1 test --evidence --json` records the literal `"--json"`). Fix in the single helper: after resolving `value = args[index + 1]`, reject it when it starts with `--`, throwing a clear usage error that names the option, e.g. `--evidence expects a value, got flag "--json"`. Because every option site funnels through `takeOption`, the guard fixes all callers at once (`--root`, `--status`, `--limit`, `--priority`, `--parent`, `--branch`, `--action`, `--executor`, `--evidence`, `--reason`, `--agent`, `--model`, `--ticket`, `--section`, `--file`, `--basis`, `--stage`). Keep the existing "requires a value" throw for the trailing-flag case. `takeFlag` needs no change (boolean, consumes no value).

Guard on the `--` prefix specifically (not a single `-`): the CLI has no single-dash short options, and `--` is the exact hazard. A value that is genuinely a `--`-prefixed string would be rejected — an acceptable tradeoff for a workflow CLI whose option values are ticket ids, executors, points, section names, and free-text evidence/reason that do not begin with `--`. No escape hatch is warranted at this scale. A `--opt=value` form would be a clean future escape hatch but is out of scope; do not add it unless a real need appears.

## Affected files

- `src/cli.js` — `takeOption` only (production change, ~2 lines).
- `test/cli.test.js` — add regression coverage (test change).

## Risks

Low. The only risk is an existing caller legitimately passing a `--`-prefixed value. Grep of the test suite shows all option values are non-flag strings (`--executor claude-subagent:...`, `--evidence "done"`/`security_threat_model`, `--reason "will complete-step later"`, `--basis bootstrap`/ticket-id, `--reason "No --executor supplied."` — note the value contains `--executor` mid-string but does not start with `--`, so the prefix check is safe). No legitimate flag-like value found. Confirm the error message stays on the sad path so happy-path parsing is untouched.

## Test strategy

Add one focused CLI-level regression: invoke a command with a flag where a value is expected (e.g. `complete-step ... --evidence --json`) and assert non-zero exit with stderr naming the option (`/--evidence/` and a flag/value phrasing). Optionally add a positive case asserting a normal value (e.g. `--evidence done`) still parses. Run the full `node --test` suite to confirm no existing test regresses (the mid-string `--executor` reason case above is the key guard against over-matching).

## Open questions

None. The trailing-flag ("requires a value") message and the new following-flag message can share wording or differ; either is fine.

## Implementation Notes

`takeOption` (`src/cli.js:1136-1148`) now rejects a resolved value that starts with `--`, throwing `option <name> requires a value but got <value>` (e.g. `option --evidence requires a value but got --json`), instead of silently swallowing the following flag as the value. The existing trailing-flag ("`<name> requires a value`") throw is unchanged. No other production code touched; the guard covers all ~17 option sites that funnel through this helper.

Added `test/cli.test.js` test "CLI complete-step rejects a flag swallowed as an option value": creates a task, estimates it, approve-inlines the design step, then asserts `complete-step ... --evidence --json` exits 2 with stderr matching `/--evidence/`, and a follow-up `complete-step ... --evidence pre--post` (dashes mid-value, not a leading `--`) exits 0, confirming the prefix-only guard doesn't over-match.

Verification: `npm run check` (syntax check across all CLI/hook files) green; `npm test` 337 tests, 336 pass / 1 skipped (pre-existing unrelated smoke test), 0 fail; `npm run validate` — "Ticket validation OK". No deviations from the approved design.

### Rework (2026-07-08, addressing codex review of a8fc108)

Two fixes applied:

1. **Non-exercising regression test.** The original sad-path case (`complete-step ... --evidence --json`) passed even without the guard: `commandCompleteStep` calls `takeFlag(args, "--json")` before `takeOption(args, "--evidence")`, so `--json` is stripped from `args` first and `--evidence` ends up trailing with no following token — it hits the pre-existing "`--evidence requires a value`" branch, not the new `startsWith("--")` guard. Replaced the case with `complete-step <id> test --executor --evidence x`: since `--executor` is parsed via `takeOption` before `--evidence`, its value resolves to the literal token `"--evidence"`, which does exercise the new guard. Now asserts exit 2 and stderr matching both `/--executor/` (the option) and `/--evidence/` (the offending token).

   Revert-check performed: temporarily removed the `startsWith("--")` guard block in `takeOption` (`src/cli.js`), re-ran `test/cli.test.js` — both the reworked "flag swallowed" test and the new global-`--root` test failed as expected (`unexpected argument: x` / exit 1 instead of 2), confirming they genuinely exercise the fix. Guard restored immediately after; full suite re-run green.

2. **Global `--root` parsing outside the try block.** `main()` in `src/cli.js` previously ran `takeOption(args, "--root")` and `takeFlag(args, "--allow-main-root")` before entering the `try { ... } catch (error) { console.error(error.message); return 2; }` block, so a value-swallowing throw from the new guard (e.g. `local-board --root --json validate`) escaped uncaught, producing a stack trace and process exit 1 instead of the CLI's clean usage-error exit 2. Moved the `root`/`allowMainRoot`/`command` declarations inside the `try` (no other logic changed; indentation of the existing command-dispatch chain was already at the right depth since it was already inside `try`). Added `test/cli.test.js` test "CLI global --root option rejects a following flag as its value with a clean usage error": asserts `["--root", "--json", "validate"]` exits 2, stderr matches `/--root/`, and stderr does not match a stack-trace line pattern (`at ... (...:N:N)`).

Verification after rework: `npm run check` green; `npm test` — 338 tests, 337 pass / 1 skipped (same pre-existing unrelated smoke test), 0 fail; `npm run validate` — "Ticket validation OK".

## Review Findings

- 2026-07-08T00:48:08Z: Review (codex): two fixes — the regression test passes pre-fix (--json is pre-consumed by takeFlag; use --executor --evidence x instead), and global --root parses outside the try so the new guard stack-traces (exit 1) for local-board --root --json validate; move initial parsing inside the try. Guard placement/message and caller coverage otherwise verified.

- 2026-07-08T00:53:17Z: Final disposition: both findings fixed verbatim with a revert-check proving the test now exercises the new branch. Treating review as complete per the established pattern.

## Test Evidence

Tested by claude-subagent:local-board-tester (sonnet) on branch local-board/B20260707T1324Z-..., commits a8fc108 + 81ffc10.

**Suite:** `npm run check` pass; `npm test` 337 pass / 1 gated-skip of 338; `npm run validate` OK.

**Live probes (throwaway board):**
- `--executor --evidence x`: exit 2, "option --executor requires a value but got --evidence" — names both tokens, no stack trace.
- `--root --json validate`: exit 2, clean "option --root requires a value but got --json" — the rework's try-scope fix verified live.
- Precision: `--evidence "pre--post value"` accepted and recorded verbatim.
- Original repro (`--evidence --json`): clean exit-2 "requires a value" (the --json token is a flag consumed earlier) — no silent mis-recording; completedSteps unchanged after all failed attempts.

**Gaps / caveats:** none; both review-fix scenarios reproduced live.

Result: pass

## Documentation Updates

Documented by codex-task:workspace-write (gpt-5.5).

- `agents/codex/local-board-designer.md` — the one stale command shorthand found (`section --file --section ...`, which now reads as a rejected flag-as-value form) was expanded to the full `section <ticket-id> --file <temp-file> --section "Technical Design"` shape.
- README, docs/, SKILL texts, remaining agents/resources searched — no other flag-as-value examples remain.

## Questions

## Run Log

- 2026-07-08T00:39:51Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): 2-line guard in takeOption rejecting --prefixed values with a usage error, covering all ~17 option sites; suite grep confirms no legitimate flag-like values. Estimate 1 (basis B20260707T2245Z).

- 2026-07-08T00:40:41Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (CLI parsing guard)

- 2026-07-08T00:40:42Z: Ensured git branch local-board/B20260707T1324Z-takeoption-consumes-a-following-flag-as-its-option-value (created).

- 2026-07-08T00:44:23Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Implementer (sonnet): takeOption throws on --prefixed values naming the option; regression + precision tests; 336 pass + 1 gated-skip.

- 2026-07-08T00:45:03Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (parsing guard)

- 2026-07-08T00:48:08Z: Completed review via codex-task:read-only: Codex (gpt-5.5, read-only) changes_requested: non-exercising regression test and an uncaught path for the global --root option.

- 2026-07-08T00:48:08Z: Invalidated downstream evidence on loop-back to ready_for_implementation: removed completedSteps [implement:claude-subagent:local-board-implementer@sonnet, gate:implement:claude-subagent:local-board-gatecheck@haiku, review:codex-task:read-only].

- 2026-07-08T00:48:08Z: Ensured git branch local-board/B20260707T1324Z-takeoption-consumes-a-following-flag-as-its-option-value (already-current).

- 2026-07-08T00:53:17Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Rework (sonnet): sad-path test now genuinely exercises the guard (revert-check proved it fails without the fix); global --root parsing moved inside try so option errors exit 2 cleanly; 337 pass + 1 gated-skip.

- 2026-07-08T00:53:17Z: Completed review via codex-task:read-only: Review complete: non-exercising test and uncaught --root path fixed exactly as specified, revert-check documented.

- 2026-07-08T00:56:16Z: Completed test via claude-subagent:local-board-tester@sonnet: Tester (sonnet): 337+1 gated; all four live probes clean (guard, --root try-scope, precision, original repro); no state mutation from failed attempts. Result: pass.

- 2026-07-08T00:59:04Z: Completed document via codex-task:workspace-write: Codex (workspace-write): one stale flag-as-value shorthand expanded in the codex designer prompt; all other texts verified clean.
