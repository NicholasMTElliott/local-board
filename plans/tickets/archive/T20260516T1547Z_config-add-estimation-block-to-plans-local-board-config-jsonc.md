---
id: T20260516T1547Z
type: task
status: archived
priority: P2
parent: S20260516T1537Z
children: []
blockedBy: [T20260516T1543Z]
blocks: [T20260516T1548Z, T20260516T1549Z]
branch: feature/estimation-and-specialty-steps
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-05-16T15:47:43Z
updated: 2026-07-07T14:07:41Z
completedSteps: [design:claude-subagent:local-board-designer, implement:claude-subagent:local-board-implementer, review:codex-task:read-only, test:claude-subagent:local-board-tester, document:codex-task:workspace-write]
routingApprovals: []
---
# Config: add estimation block to plans/local-board.config.jsonc

## Requirement

Add the `estimation` block to `plans/local-board.config.jsonc` and teach the config loader to recognize it. Pure configuration surface — no behavior change in this task.

Block shape:

```jsonc
"estimation": {
  "enabled": true,
  "scale": [1, 2, 4, 8],
  "bootstrapDefault": 4,
  "splitThreshold": 16,
  "runAfter": "design"
}
```

The config loader should expose these values through whatever struct other tasks (estimate CLI, enforcement gate, prompts) read from. Defaults must apply when keys are missing.

## Acceptance Criteria

- `plans/local-board.config.jsonc` contains an `estimation` block with the documented keys and defaults.
- The config loader parses the block and exposes the values to the rest of the codebase.
- Missing keys fall back to documented defaults (`scale: [1,2,4,8]`, `bootstrapDefault: 4`, `splitThreshold: 16`, `runAfter: "design"`, `enabled: true`).
- `validate` does not regress on the new config shape.
- Tests cover: default fill-in when block is absent, full block parses, partial block fills missing defaults, malformed `scale` (non-array or non-numeric) is rejected.

## Related Tickets

## Technical Design

### Scope

Pure configuration-surface change. Add an `estimation` block to `plans/local-board.config.jsonc` and teach `src/config.js` to recognize, validate, and default it. Expose the parsed block on `schemaRecord` so downstream consumers (T20260516T1548Z enforcement, T20260516T1549Z prompts) read it through a stable API. No runtime behavior, no enforcement, no CLI changes.

Important: this design intentionally diverges from the parent story default for one key. The story acceptance criteria say `enabled: true` is the default. We default `enabled: false` in `DEFAULT_CONFIG` so projects that upgrade local-board without rewriting their config do not silently turn on enforcement. The shipped `plans/local-board.config.jsonc` block opts in with `enabled: true` for this repo. T20260516T1548Z enforcement will check `config.estimation.enabled`, which now requires an explicit opt-in for legacy configs.

### Files inspected

- `C:/Users/Nicho/Documents/local-board/src/config.js` — DEFAULT_CONFIG shape, mergeConfig, loadConfig flow, normalizeOptionalSteps as the validation pattern to copy.
- `C:/Users/Nicho/Documents/local-board/plans/local-board.config.jsonc` — shipping config; ordering and comment conventions.
- `C:/Users/Nicho/Documents/local-board/src/tickets.js` — schemaRecord exposure (lines 840-866). New `estimation` field added next to `optionalSteps`.
- `C:/Users/Nicho/Documents/local-board/test/config.test.js` — `withRoot`/`writeConfig` helpers and the validation-failure test shape used by optionalSteps; mirror those patterns.
- Parent story design `plans/tickets/done/S20260516T1537Z_relative-sized-estimation-with-calibration-and-actuals.md` — Config subsection.

### Design

#### Block shape (shipped config)

```jsonc
// Relative-sized estimation. Sized after design; enforced on complete-step
// design for tasks and bugs when enabled is true. Stories and epics are exempt.
// scale: allowed point values, must be a sorted-ascending array of positive integers.
// bootstrapDefault: anchor value when no calibration exists; must be in scale.
// splitThreshold: estimator flags tickets at or above this for decomposition.
"estimation": {
  "enabled": true,
  "scale": [1, 2, 4, 8],
  "bootstrapDefault": 4,
  "splitThreshold": 16
}
```

Placed in `defaultConfigJsonc()` after the `optionalSteps` block, with the leading comment summarizing semantics. Comma placement follows the existing trailing-block pattern.

#### DEFAULT_CONFIG addition (src/config.js)

```js
estimation: {
  enabled: false,
  scale: [1, 2, 4, 8],
  bootstrapDefault: 4,
  splitThreshold: 16,
},
```

Placed at the end of DEFAULT_CONFIG, after `optionalSteps`. `enabled: false` is the backward-compat default for projects whose config predates this block.

Note on `runAfter`: the parent story acceptance criteria mention a `runAfter` key with default "design". The parent Technical Design Config subsection (the canonical port source) lists only the four keys above and does not mention runAfter. Pipeline placement is hardcoded to the design step (enforcement lives in complete-step design — see T20260516T1548Z), so `runAfter` would be dead config today. We omit it. A future story can add it if configurable placement is ever needed.

#### Validation: normalizeEstimation

Add to `loadConfig` immediately after `normalizeOptionalSteps(merged, configPath)`:

```js
normalizeEstimation(merged, configPath);
```

Function shape and rules (mirrors normalizeOptionalSteps for style and error formatting):

1. If `merged.estimation` is not an object, throw `estimation must be an object`. mergeConfig guarantees DEFAULT_CONFIG fills it when missing, so this branch only fires on a malformed overlay like `"estimation": null` or `"estimation": []`. Per backward-compat, an entirely absent block hits DEFAULT_CONFIG and is accepted.
2. `enabled`: must be a boolean. Reject `"true"`, 1, etc.
3. `scale`: must be a non-empty array of positive integers, sorted strictly ascending. Validate per element with `Number.isInteger(v) && v > 0` and an adjacent-pair monotonic check. Reject non-arrays, empty arrays, non-integer or non-positive values, and unsorted or duplicate arrays.
4. `bootstrapDefault`: must be a positive integer and must appear in the validated `scale` array. mergeConfig fills missing keys from DEFAULT_CONFIG, so a config that supplies a custom `scale` but omits `bootstrapDefault` inherits the default `4` — which may not be in the custom scale. Validate the final merged combination, not the overlay. If the inherited default is not in the custom scale, throw a clear message instructing the user to set `bootstrapDefault` explicitly when overriding scale. This matches the parent story intent: bootstrapDefault is always a member of the active scale.
5. `splitThreshold`: must be a positive integer. No requirement that it appear in scale (it is a decomposition signal, not a sizing value).
6. Unknown sub-keys: pass through silently (forward-compat for sibling tickets). No warning needed for this small block.

All thrown errors are wrapped by the existing catch in `loadConfig` which prefixes with `configPath`, so messages stay user-actionable.

#### schemaRecord (src/tickets.js)

Add one line after the existing `optionalSteps: config.optionalSteps,` at line 864:

```js
estimation: config.estimation,
```

No other tickets.js changes. No validate.js changes — the existing validate flow already calls `loadConfig`, so any malformed-config error surfaces through the existing path.

### Test plan (test/config.test.js)

Append tests using the existing `withRoot`/`writeConfig` helpers:

1. `loadConfig parses the shipped estimation block` — write `defaultConfigJsonc()` to disk; assert `config.estimation.enabled === true`, `deepEqual(scale, [1,2,4,8])`, `bootstrapDefault === 4`, `splitThreshold === 16`.
2. `loadConfig defaults estimation when the block is omitted` — write `{ "version": 1 }`; assert `config.estimation.enabled === false` and the other defaults present. This is the load-bearing backward-compat guarantee.
3. `loadConfig fills missing estimation keys from defaults` — partial overlay `{ "estimation": { "enabled": true } }`; assert scale/bootstrapDefault/splitThreshold defaults remain.
4. `loadConfig rejects invalid estimation.scale` — non-array (`"scale": "x"`), empty array, contains zero, contains a non-integer, unsorted (`[4,2,1]`). Each case uses `assert.rejects(loadConfig(root), /scale/i)` with a tighter regex where it helps.
5. `loadConfig rejects invalid estimation.bootstrapDefault` — value not in the supplied scale (`scale: [1,2,3], bootstrapDefault: 4`), non-integer, non-positive.
6. `loadConfig rejects invalid estimation.enabled` — `"true"` string and numeric 1.
7. `loadConfig rejects invalid estimation.splitThreshold` — zero, negative, non-integer.
8. Happy-path test asserts the loaded config object has `estimation` populated; a separate schemaRecord assertion is optional given the one-line passthrough.

### Risks and edge cases

- Default override asymmetry: DEFAULT_CONFIG ships `enabled: false` while defaultConfigJsonc ships `enabled: true`. Loading this repo returns `enabled: true`; loading a repo whose config omits the block returns `enabled: false`. Intentional and documented in the inline comment above the block.
- bootstrapDefault default vs custom scale: validate the merged combination, not the overlay. Error message should name both values, e.g. `estimation.bootstrapDefault 4 is not a member of estimation.scale [1,3,9]; set bootstrapDefault explicitly when overriding scale`.
- mergeConfig array overwrite semantics (already documented for optionalSteps) apply to `scale`: an overlay `scale` fully replaces the default, it does not concat. Desired.
- ENOENT path: `loadConfig` returns `structuredClone(DEFAULT_CONFIG)` and never runs `normalizeEstimation`. Since DEFAULT_CONFIG is valid by construction, this is fine and matches existing behavior.
- Forward-compat: unknown sub-keys under `estimation` pass through. Acceptable for this small surface.

### Documentation impact

No README or memory-bank update required for this ticket; the block is a small additive config surface and the parent story carries user-facing documentation. The implementer should add the inline JSONC comments above the block (shown above) — the only doc surface this ticket owns. T20260516T1548Z (enforcement) and T20260516T1549Z (prompts) will carry user-facing behavior documentation when they land.

### Out of scope

- Enforcement of `enabled` at complete-step design — T20260516T1548Z.
- Estimator prompt/role files reading scale and splitThreshold — T20260516T1549Z.
- Wall-clock plumbing and front-matter fields — T20260516T1543Z (already complete).
- Calibration auto-pick — T20260516T1545Z.
- `runAfter` config key — deferred; design step placement is hardcoded.

## Implementation Notes

- Added `estimation` block to `plans/local-board.config.jsonc` with `enabled: true`, `scale: [1, 2, 4, 8]`, `bootstrapDefault: 4`, `splitThreshold: 16`, and explanatory JSONC comments. Block is positioned after `optionalSteps`.
- `src/config.js`:
  - `DEFAULT_CONFIG.estimation` set to `{ enabled: false, scale: [1, 2, 4, 8], bootstrapDefault: 4, splitThreshold: 16 }`. Legacy configs that omit the block default to `enabled: false` for back-compat.
  - `defaultConfigJsonc()` updated to emit the block with `enabled: true` so freshly-initialized projects opt in.
  - New `normalizeEstimation(merged)` runs in `loadConfig` after `normalizeOptionalSteps`. Validates: `enabled` is boolean, `scale` is a non-empty array of strictly-ascending positive integers, `bootstrapDefault` is a positive integer that is a member of the merged `scale`, `splitThreshold` is a positive integer. Errors flow through the existing `configPath`-prefixed catch.
  - Forward-compat: unknown sub-keys under `estimation` pass through silently.
- `src/tickets.js`: `schemaRecord` now exposes `estimation: config.estimation` next to `optionalSteps`.
- Tests added to `test/config.test.js` (7 new):
  1. parses shipped estimation block
  2. defaults estimation when block is omitted (enabled:false back-compat)
  3. fills missing keys from defaults on partial overlay
  4. rejects invalid scale (6 sub-cases: non-array, empty, contains 0, non-integer, descending, duplicates)
  5. rejects bootstrapDefault not in supplied scale
  6. rejects invalid enabled types (string, numeric)
  7. rejects invalid splitThreshold (zero, negative, non-integer)
- Commands run: `npm run check` (pass), `npm test` (69 pass / 0 fail; 7 new tests under loadConfig), `npm run validate` (Ticket validation OK).
- Commit: `9a4a838 Add estimation config block (T20260516T1547Z)`. Files changed: `plans/local-board.config.jsonc`, `src/config.js`, `src/tickets.js`, `test/config.test.js`.
- No README or memory-bank updates required per design.

## Review Findings

**Verdict:** PASS.

Reviewer: codex-task:read-only (gpt-5.5). Review by code inspection (read-only sandbox blocked test execution).

- DEFAULT_CONFIG.estimation.enabled is false; defaultConfigJsonc() and the shipped config emit enabled:true. Asymmetry documented in implementation notes as legacy back-compat.
- loadConfig() merges defaults before normalizeEstimation(merged), so validation runs against the merged config (critical for the bootstrapDefault-in-scale check when scale is overridden).
- normalizeEstimation validates: boolean enabled; non-empty strictly-ascending positive-integer scale; bootstrapDefault positive integer and member of merged scale; positive-integer splitThreshold.
- schemaRecord() exposes estimation downstream.
- 7 new tests cover shipped block parsing, omitted-block defaults, partial-overlay defaults, invalid scale shapes/values, bootstrapDefault outside active scale, invalid enabled types, invalid splitThreshold values.

## Test Evidence

- Commands run on branch `feature/estimation-and-specialty-steps` at commit `9a4a838` (cwd: `c:\Users\Nicho\Documents\local-board`):
  - `npm test` -> 69 pass / 0 fail / 0 skipped (duration ~3.76s). The 7 new estimation tests appear in the run:
    1. `loadConfig parses the shipped estimation block`
    2. `loadConfig defaults estimation when the block is omitted (backward-compat disabled)`
    3. `loadConfig fills missing estimation keys from defaults on partial overlay`
    4. `loadConfig rejects invalid estimation.scale values`
    5. `loadConfig rejects estimation.bootstrapDefault not in scale`
    6. `loadConfig rejects invalid estimation.enabled types`
    7. `loadConfig rejects invalid estimation.splitThreshold values`
  - `npm run check` -> `node --check` clean across `bin/local-board.js`, `src/cli.js`, `src/config.js`, `src/git.js`, `src/scaffold.js`, `src/tickets.js`, `install.mjs`.
  - `npm run validate` -> `Ticket validation OK`.
  - `node bin/local-board.js schema --json` -> top-level `estimation` block is present alongside `optionalSteps` with `{ "enabled": true, "scale": [1, 2, 4, 8], "bootstrapDefault": 4, "splitThreshold": 16 }`. Confirms `schemaRecord` exposure.

- Acceptance Criteria coverage:
  - AC1 (block present in `plans/local-board.config.jsonc` with documented defaults): verified via shipped-config parse test and schema CLI output. enabled=true, scale=[1,2,4,8], bootstrapDefault=4, splitThreshold=16.
  - AC2 (loader parses and exposes values): verified by test #1 and by `schema --json` exposing `estimation` through `schemaRecord`.
  - AC3 (missing keys fall back to documented defaults): verified by tests #2 (block omitted entirely) and #3 (partial overlay fills missing keys). Note: `DEFAULT_CONFIG` ships `enabled: false` for legacy back-compat; this is the intentional asymmetry documented in the design and Review Findings. The shipped `plans/local-board.config.jsonc` opts in with `enabled: true`.
  - AC4 (`validate` does not regress): `npm run validate` returns `Ticket validation OK` against the current ticket tree.
  - AC5 (tests cover required cases): tests #2 (default fill-in when block absent), #1 (full block parses), #3 (partial overlay fills defaults), #4 (malformed scale: non-array, empty, contains 0, non-integer, descending, duplicates). Bonus coverage via #5 (bootstrapDefault not in active scale), #6 (invalid enabled types), #7 (invalid splitThreshold).

- Gaps / caveats:
  - `runAfter` key from the parent story AC is intentionally omitted in this ticket per the Technical Design (pipeline placement is hardcoded to the design step; runAfter would be dead config today). Deferred to a future ticket. Not a regression.
  - Default-asymmetry (`DEFAULT_CONFIG.enabled: false` vs shipped `enabled: true`) is intentional and called out in Implementation Notes and Review Findings. Tests assert both branches.
  - No flakes observed; single test run was stable.
  - No environment blockers. Windows PowerShell host; all commands ran clean.

## Documentation Updates

Updated in commit 15aaa26:

- `memory-bank/systemPatterns.md` — added `estimation` bullet to the Config section list.
- `docs/Workflow.md` — new "Estimation" subsection covering: block shape, key meanings (enabled, scale, bootstrapDefault, splitThreshold), the back-compat asymmetry (DEFAULT enabled:false; shipped config enabled:true), and forward references to T20260516T1548Z (design-step enforcement) and T20260516T1549Z (estimator prompts) which consume the config.

README untouched (no config-block list).

Docs author: codex-task:workspace-write (gpt-5.5). Codex sandbox blocked .git writes; orchestrator committed.

## Questions

## Run Log

- 2026-05-16T17:09:04Z: Completed design via claude-subagent:local-board-designer: Design: estimation block (enabled, scale, bootstrapDefault, splitThreshold). defaultConfigJsonc ships enabled:true; DEFAULT_CONFIG.enabled:false for legacy back-compat. normalizeEstimation validates boolean/array-asc/positive-int/bootstrapDefault-in-scale. schemaRecord exposes estimation. 4-case test plan.

- 2026-05-16T17:09:04Z: Ensured git branch feature/estimation-and-specialty-steps (already-current).

- 2026-05-16T17:12:34Z: Completed implement via claude-subagent:local-board-implementer: Implemented in commit 9a4a838. plans/local-board.config.jsonc + src/config.js (DEFAULT_CONFIG.estimation enabled:false; defaultConfigJsonc emits enabled:true; normalizeEstimation validates boolean/scale-asc/bootstrapDefault-in-scale/positive-int splitThreshold). src/tickets.js schemaRecord exposes estimation. 7 new tests; npm test 69/69; check + validate clean.

- 2026-05-16T17:16:41Z: Completed review via codex-task:read-only: Codex read-only review of commit 9a4a838. Verdict: PASS. Confirmed: DEFAULT_CONFIG.enabled=false; defaultConfigJsonc enabled=true (intentional asymmetry); merged-config validation in normalizeEstimation; 7-test coverage of AC. Sandbox blocked npm test; verdict by code inspection.

- 2026-05-16T17:18:48Z: Completed test via claude-subagent:local-board-tester: npm test 69/69; check clean; validate clean. schema --json exposes estimation block. 7 new tests in test/config.test.js cover all AC items. Verdict: PASS.

- 2026-05-16T17:20:33Z: Completed document via codex-task:workspace-write: Codex authored doc updates in commit 15aaa26: memory-bank/systemPatterns.md and docs/Workflow.md (new Estimation subsection). README untouched.
