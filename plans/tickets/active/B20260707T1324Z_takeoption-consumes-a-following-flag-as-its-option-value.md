---
id: B20260707T1324Z
type: bug
status: implementing
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/B20260707T1324Z-takeoption-consumes-a-following-flag-as-its-option-value
estimate: 1
estimateBasis: B20260707T2245Z
workStartedAt: 2026-07-08T00:40:42Z
workCompletedAt: null
created: 2026-07-07T13:24:08Z
updated: 2026-07-08T00:44:04Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
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

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-08T00:39:51Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): 2-line guard in takeOption rejecting --prefixed values with a usage error, covering all ~17 option sites; suite grep confirms no legitimate flag-like values. Estimate 1 (basis B20260707T2245Z).

- 2026-07-08T00:40:41Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (CLI parsing guard)

- 2026-07-08T00:40:42Z: Ensured git branch local-board/B20260707T1324Z-takeoption-consumes-a-following-flag-as-its-option-value (created).
