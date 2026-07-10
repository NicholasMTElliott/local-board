---
id: T20260710T1156Z
type: task
status: implementing
priority: P2
parent: null
children: []
blockedBy: []
blocks: [T20260710T1206Z]
branch: local-board/T20260710T1156Z-optionalsteps-accept-agent-profiles-with-model-and-effort-pins-at-the-specialty-step-level
estimate: 2
estimateBasis: T20260710T0037Z
workStartedAt: 2026-07-10T12:14:10Z
workCompletedAt: null
created: 2026-07-10T11:56:26Z
updated: 2026-07-10T12:42:44Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku"]
routingApprovals: []
---
# optionalSteps: accept agent profiles with model and effort pins at the specialty-step level

## Requirement

Agent profiles ({ route, model?, effort?, prompt? }) exist only for agents.<action> entries (T20260710T0037Z). optionalSteps[].agent still accepts a bare route string and the schema rejects anything else (src/config.js normalizeOptionalStepEntry, typeof agent !== "string" throws). Users cannot pin a model or reasoning effort for a specialty step. Concrete driver (2026-07-10 user request): route the security specialty steps to codex on gpt-5.6-sol at xhigh reasoning while the mandatory review step runs gpt-5.6-terra at high.

## Scope

1. **Schema** (src/config.js): widen optionalSteps[].agent to accept a route string (back-compat sugar) or a { route, model?, effort? } profile object, validated with the same rules as agents.<action> profiles (route grammar, model/effort shape regex, both rejected on inline). Note: optionalSteps entries already carry their own top-level prompt field — the agent profile must NOT accept prompt (reject with an actionable message pointing at the entry-level field).
2. **Scanner parity** (src/config.js codexTaskRoutedActions): recognize the object form's route when scanning for codex-task:* routes. This exact follow-up was flagged in T20260710T0035Z's Review Findings ("if a future ticket widens optionalSteps[].agent to profile objects, the scanner must be updated in the same change").
3. **specialty-run surface** (src/cli.js): return agent (route), model, and effort (null when unset) alongside the existing prompt/ticketContext, mirroring begin-step's configuredAgent/configuredModel/configuredEffort naming or documenting the divergence.
4. **Evidence composition**: specialty complete-step currently records <step-name>:<executor>. Support --model on specialty evidence the same way mandatory steps do (server-side <route>@<model> composition, codex-default wildcard, modelSatisfies pin enforcement when the specialty profile pins a model). Effort stays out of evidence tokens (same rule as T20260710T0037Z).
5. **Skill text**: SKILL.md Specialty Steps section (and skills/codex/local-board/SKILL.md counterpart) — dispatch the specialty through the returned route with the returned model/effort pins (claude-subagent: model pinned at dispatch, effort frontmatter-static today; codex-task: --model / --reasoning-effort).
6. **Docs**: docs/specialty-steps.md and docs/CodexSupport.md updated for the profile form.
7. **Tests**: schema accept/reject (string sugar, profile, prompt-in-profile rejection, inline-with-model/effort rejection), scanner object-form detection (closing the T0035Z review gap), specialty-run JSON surface, specialty evidence model composition, skill-sync green.

## Acceptance criteria

- Config accepts: { "name": "security_audit", "prompt": "...", "triggers": "...", "agent": { "route": "codex-task:read-only", "model": "gpt-5.6-sol", "effort": "xhigh" } } and specialty-run returns those pins.
- Bare-string agent entries behave byte-identically to today.
- validate warns (T0035Z detection) when an object-form optional step routes to codex-task:* and codex-task is missing.
- Specialty evidence with a pinned model enforces the pin (codex-default wildcard accepted); effort never appears in completedSteps.
- npm run check and node --test pass.

## Non-goals

- No change to gate-check's own routing (agents.gate-check already supports profiles).
- No per-dispatch effort for claude subagents (harness limitation; frontmatter remains the static lever).

## Acceptance Criteria

## Related Tickets

## Technical Design

## Related Tickets

- **T20260710T0037Z** (basis / effort rules): introduced agent profiles `{ route, model?, effort?, prompt? }` for `agents.<action>`, `normalizeAgentProfile`, per-step model enforcement in `validateStepRouting`, and the rule that **effort is a dispatch hint only and never enters evidence tokens**. This ticket extends the same profile grammar to `optionalSteps[].agent` and honors the effort-out-of-evidence rule verbatim.
- **T20260710T0035Z** (scanner note): its Review Findings flagged that "if a future ticket widens `optionalSteps[].agent` to profile objects, the scanner (`codexTaskRoutedActions`) must be updated in the same change." Scope item 2 closes that gap.
- **T20260710T1206Z**: blocked by this ticket (`blocks: [T20260710T1206Z]`); downstream consumer of the widened schema.

No conflicts with gate-check routing (`agents.gate-check` already supports profiles — non-goal).

## Technical Design

### Overview

Widen `optionalSteps[].agent` from a bare route string to accept either a route string (unchanged back-compat sugar) or a `{ route, model?, effort? }` profile object, validated by the **same authority** as `agents.<action>` profiles but with `prompt` rejected (the entry already owns a top-level `prompt`). Thread the resolved `model`/`effort` through the `specialty-run` surface and reuse the existing per-step model enforcement so specialty completion evidence honors a pinned model. Effort remains a dispatch hint and never enters evidence.

The design is deliberately reuse-first: no new command, no new token grammar, no change to `validateStepRouting`/`modelSatisfies`/`composeExecutor`. The single behavioral seam is making the profile resolvers (`configuredRouteForAction`/`modelForAction`/`effortForAction`) specialty-aware, which the model gate already consumes.

### 1. Schema — `src/config.js`

**Parameterize `normalizeAgentProfile`** so it is the one authority for profile grammar, with a caller-supplied message label and an `allowPrompt` switch:

- New signature: `normalizeAgentProfile(value, label, { allowPrompt = true } = {})`.
- Replace the hardcoded `agents.${key}` prefixes in every throw with `${label}`. `normalizeAgents` calls it as `normalizeAgentProfile(value, \`agents.${key}\`)` — output byte-identical to today (label substitutes to the same string), so existing agent-profile error-message tests keep passing.
- When `allowPrompt === false` and `prompt` is present (non-null/undefined), throw an actionable error pointing at the entry-level field: `${label}: agent profile cannot carry a prompt; set the entry-level "prompt" field instead`.

**Add `normalizeOptionalStepAgent(agent, stage, name)`** (module-private) that preserves the string form for byte-identical back-compat and validates the object form via the shared authority:

```
function normalizeOptionalStepAgent(agent, stage, name) {
  const label = `optionalSteps.${stage} entry "${name}" agent`;
  if (typeof agent === "string") {
    if (!isValidOptionalStepAgent(agent)) {
      throw new Error(`optionalSteps.${stage} entry "${name}" has invalid agent "${agent}"`);
    }
    return agent;               // stored as a string — unchanged from today
  }
  if (!isObject(agent)) {
    throw new Error(`optionalSteps.${stage} entry "${name}" agent must be a route string or a { route, model?, effort? } object`);
  }
  return normalizeAgentProfile(agent, label, { allowPrompt: false });
}
```

Rationale for keeping the string form as a string (not collapsing to `{ route }`): acceptance criterion "bare-string agent entries behave byte-identically" and the existing `loadConfig preserves an optional agent override` test asserts `config.optionalSteps.design[0].agent === "claude-subagent:local-board-reviewer"` (a string). Downstream consumers already tolerate both shapes (see §3/§4).

**In `validateOptionalStepEntry`** replace the string-only guard (the current `typeof agent !== "string"` throw) with:

```
if (agent !== undefined) {
  normalized.agent = normalizeOptionalStepAgent(agent, stage, name);
}
```

Object-form validation inherited from `normalizeAgentProfile`: valid route grammar (`isValidAgentRoute`), model regex `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`, effort regex (same), and `route: "inline"` rejects model/effort. `prompt` rejected via `allowPrompt: false`.

### 2. Scanner parity — `codexTaskRoutedActions` (`src/config.js`)

The optionalSteps loop currently reads `typeof entry.agent === "string" && entry.agent.startsWith("codex-task:")`. Widen it to extract the route from either shape, mirroring the agents-map branch directly above it:

```
const route = typeof entry.agent === "string" ? entry.agent : entry.agent?.route;
if (typeof route === "string" && route.startsWith("codex-task:")) {
  actions.push(`${entry.name} (${stage})`);
}
```

This function is documented to run over **both** normalized (post-`loadConfig`) and raw (`parseJsonc` sync read for install's config hint) shapes, so it must handle a raw object literal `{ route: "codex-task:..." }` before normalization as well as the post-normalization string/object. The `entry.agent?.route` optional-chain covers both. Closes the T0035Z review gap.

### 3. `specialty-run` surface — `src/cli.js` `commandSpecialtyRun`

Resolve the entry's agent to `{ route, model, effort }` and add `model`/`effort` to the JSON payload. Decision on field naming: **keep `agent`/`model`/`effort`, do not adopt begin-step's `configuredAgent`/`configuredModel`/`configuredEffort`.** Justification:

- Back-compat: `specialty-run` already emits `agent` (route) and the plain-text line `agent=${agent}`; an existing test asserts `out.agent === "codex-task:read-only"`. Renaming would break the wire contract for no benefit.
- begin-step's `configured*` prefix marks a *configured-vs-actual* duality in the mandatory ledger flow (it also stamps an active step). `specialty-run` is a pure resolver with no such duality, so the plain names read correctly.
- The divergence is documented in a code comment on the payload and in docs/specialty-steps.md.

Implementation:

```
const rawAgent = Object.hasOwn(entry, "agent") ? entry.agent : "inline";
const agent  = typeof rawAgent === "string" ? rawAgent : rawAgent.route;
const model  = typeof rawAgent === "string" ? null : (rawAgent.model  ?? null);
const effort = typeof rawAgent === "string" ? null : (rawAgent.effort ?? null);
```

Add `model` and `effort` to the `payload` object (both `null` when unset). Plain-text line may append `@${model}` when set (optional polish; JSON is the contract). To keep resolution DRY, prefer a small exported helper `resolveOptionalStepAgent(agentValue)` in `src/config.js` returning `{ route, model, effort }`, consumed by both `commandSpecialtyRun` and `tickets.js` (§4).

### 4. Evidence composition / model-pin enforcement — `src/tickets.js`

Today `configuredRouteForAction` is specialty-aware (reads `optionalStepEntry(...).agent`), but `modelForAction`/`effortForAction` route through `profileForAction`, which reads **only** `config.agents[action] ?? config.agents.default`. For a specialty step name that resolves to `agents.default` — currently harmless (default is `inline`, model `null`) but wrong once specialties carry pins. Fix: make profile resolution specialty-aware in one place.

Introduce a specialty-aware resolver and route all three accessors through it:

```
function profileForAction(config, action) {
  const mandatory = new Set(Object.values(config.workflow.statusActions));
  if (mandatory.has(action)) {
    const entry = config.agents[action] ?? config.agents.default ?? { route: "inline" };
    return typeof entry === "string" ? { route: entry } : entry;
  }
  const step = optionalStepEntry(config, action);
  if (step && step.agent !== undefined) {
    return typeof step.agent === "string" ? { route: step.agent } : step.agent;
  }
  return { route: "inline" };            // specialty w/o agent, or unknown action
}
```

- Mandatory branch: **unchanged**, including the `agents.default` fallback.
- Specialty branch: resolves the entry's own profile and **must not** fall back to `agents.default` (a specialty with no `agent` is `inline`, not the default agent).
- `configuredRouteForAction`, `modelForAction`, `effortForAction` all delegate to `profileForAction`, keeping one authority. `configuredRouteForAction` can be simplified to `profileForAction(config, action).route` — its old two-branch body is subsumed. (Consider reusing the exported `resolveOptionalStepAgent` from §3 for the specialty branch to avoid duplicating shape-normalization.)

**No change** to `validateStepRouting`, `modelSatisfies`, `composeExecutor`, or `completeStep`. The model gate at `completeStep` (`validateStepRouting(..., { enforceModel: true })`) now sees the specialty's `modelForAction`, so a pinned specialty enforces the model exactly like a mandatory step: `<route>@<model>` required, `<route>@codex-default` accepted via `modelSatisfies`, route-only or wrong model rejected with the existing actionable message.

**Effort never enters evidence**: `stepToken`/`composeExecutor` take only route+model; `effortForAction` is not consulted by `validateStepRouting`. So `completedSteps` tokens carry no effort by construction. `effortForAction` becoming specialty-aware only feeds surfaces/parity, not tokens.

### 5. Skill text — `SKILL.md` + `skills/codex/local-board/SKILL.md`

Update the Specialty Steps prose (not the `## CLI Commands` fenced block — that stays byte-identical, no new command/flag, so `skill-usage-sync.test.js` stays green):

- `SKILL.md` Specialty Steps: note `specialty-run` now returns `model` and `effort` alongside `agent`; dispatch the specialty through the returned route with the returned pins — for `claude-subagent:` pin the subagent model at dispatch (effort via frontmatter, static today); for `codex-task:` pass `--model` / `--reasoning-effort`. When recording, pass `--model` so `<step-name>:<route>@<model>` satisfies the pin.
- Codex `SKILL.md` Gate-Check and Specialty Steps: mirror the `--model`/`--reasoning-effort` dispatch note for the object form.

### 6. Docs — `docs/specialty-steps.md`, `docs/CodexSupport.md`

- `docs/specialty-steps.md`: document the `{ route, model?, effort? }` profile form for `optionalSteps[].agent` (string still valid), the `specialty-run` JSON `model`/`effort` fields, the deliberate divergence from begin-step naming, and that a pinned model is enforced on specialty evidence while effort is not.
- `docs/CodexSupport.md`: note object-form specialty steps routing to `codex-task:*` are detected by `validate`, and dispatch passes `--model`/`--reasoning-effort`.
- No README Documentation Index change (no new doc file).

### Risks / edge cases

- **Back-compat regression**: collapsing string agents to `{ route }` would break the existing preservation test and any byte-comparison — mitigated by keeping strings as strings.
- **`profileForAction` consolidation**: must preserve the mandatory `agents.default` fallback while denying it to specialties; a slip would silently apply the default agent's model to specialty steps. Covered by targeted tests.
- **Un-normalized scanner input**: `codexTaskRoutedActions` runs on raw parseJsonc for the install hint — `entry.agent?.route` must tolerate a raw object; covered by a raw-config scanner test.
- **inline + pin**: object form with `route: "inline"` and a model/effort is rejected at load, so no inline specialty can carry a pin (consistent with `agents.<action>`).
- **Retroactive validation**: `validate()` runs `validateStepRouting` without `enforceModel`, so pre-existing specialty tokens are not retroactively failed — the model gate fires once at complete-step write time (T0037Z rule preserved).
- **Cross-stage name uniqueness**: unchanged; `optionalStepEntry` still first-match across stages.

### Test plan (acceptance-criterion mapping)

- **AC1 — config accepts object profile + `specialty-run` returns pins**:
  - `test/config.test.js`: `loadConfig` accepts `{ name, prompt, triggers, agent: { route: "codex-task:read-only", model: "gpt-5.6-sol", effort: "xhigh" } }`; assert normalized `agent` object retains `route`/`model`/`effort`.
  - `test/cli.test.js`: `specialty-run --json` for that entry returns `agent: "codex-task:read-only"`, `model: "gpt-5.6-sol"`, `effort: "xhigh"`.
- **AC2 — bare-string byte-identical**:
  - `test/config.test.js`: existing preservation test (string agent stays a string) still passes; add assertion that a string entry has no `model`/`effort`.
  - `test/cli.test.js`: `specialty-run --json` for a string agent returns the route with `model: null`, `effort: null`.
- **AC3 — validate warns on object-form codex-task missing** (T0035Z gap):
  - `test/codex-detect.test.js` (or config scanner test): `codexTaskRoutedActions` detects an object-form `{ route: "codex-task:read-only" }` optionalSteps entry, from both normalized and raw-parseJsonc config; assert `validate` warns when `codex-task` is absent from PATH.
- **AC4 — specialty model pin enforced; codex-default accepted; effort absent from evidence**:
  - `test/tickets.test.js`: `completeStep` on a pinned specialty — (a) route-only executor rejected (configured-model message), (b) wrong `@model` rejected, (c) exact `@model` accepted, (d) `@codex-default` accepted; assert the recorded `completedSteps` token contains no effort substring.
- **Schema reject tests** (`test/config.test.js`): `prompt` inside the agent profile rejected (message points at entry-level field); `route: "inline"` with `model` rejected; `route: "inline"` with `effort` rejected; malformed object (non-object, bad route) rejected.
- **Skill sync** (`test/skill-usage-sync.test.js`): stays green (CLI Commands block untouched).
- **AC5**: full `npm run check` (lint/format) and `node --test` green.

### Open questions

None blocking. The one genuine decision — `specialty-run` field naming — is settled above (keep `agent`/`model`/`effort`; document the divergence from begin-step).

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-10T12:14:10Z: Ensured git branch local-board/T20260710T1156Z-optionalsteps-accept-agent-profiles-with-model-and-effort-pins-at-the-specialty-step-level (already-current).

- 2026-07-10T12:22:09Z: Completed design via claude-subagent:local-board-designer@opus: Technical Design written by opus designer: shared normalizeAgentProfile via label+allowPrompt param, normalizeOptionalStepAgent (string stays string), specialty-aware profileForAction as the single enforcement seam, scanner reads entry.agent.route. Estimate 2 (basis T20260710T0037Z, designer-recorded).

- 2026-07-10T12:26:03Z: Gate-check dispatch for the design stage was denied by the routing-validator hook (check-dispatch agent-mismatch: no gate-check awareness). Filed B20260710T1225Z. Proceeding via the hook's documented residual: gate dispatch without the Ticket: anchor line; consultation remains verified by gate-complete evidence.

- 2026-07-10T12:27:05Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: none - config schema and CLI JSON surface

- 2026-07-10T12:27:06Z: Ensured git branch local-board/T20260710T1156Z-optionalsteps-accept-agent-profiles-with-model-and-effort-pins-at-the-specialty-step-level (already-current).

- 2026-07-10T12:41:24Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Commit 683a4d3: shared profile grammar (normalizeAgentProfile label+allowPrompt), normalizeOptionalStepAgent + resolveOptionalStepAgent, specialty-aware profileForAction (agents.default denied to specialties), scanner object-form fix, specialty-run model/effort surfacing, skills/docs, 14 new tests. 475 pass + 2 known-baseline PATH failures (B20260710T1232Z); check + validate green.

- 2026-07-10T12:42:44Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: none - internal schema/resolver/CLI surface
