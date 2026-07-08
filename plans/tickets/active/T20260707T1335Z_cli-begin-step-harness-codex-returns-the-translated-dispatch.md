---
id: T20260707T1335Z
type: task
status: implementing
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260707T1335Z-cli-begin-step-harness-codex-returns-the-translated-dispatch
estimate: 2
estimateBasis: T20260707T1329Z
workStartedAt: 2026-07-08T03:26:07Z
workCompletedAt: null
created: 2026-07-07T13:35:55Z
updated: 2026-07-08T03:36:12Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
routingApprovals: []
---
# cli: begin-step --harness codex returns the translated dispatch

## Requirement

The Codex route translation (claude-subagent:local-board-* -> Codex spawned agent + prompt fragment + sanitized model) lives as prose tables in two places that can drift: `skills/codex/local-board/SKILL.md:64-77` (plus the "do not pass Claude aliases" rule at :81) and `docs/CodexSupport.md:36-45`. The codex local-team skill additionally cross-references the other skill's table.

Fix: add `begin-step --harness codex` (or a `harness` config key) that returns the translated dispatch directly — executor agent type, prompt fragment path, sanitized model, and the evidence string to record — one authoritative implementation. Shrink the two markdown tables to a pointer.

Acceptance: a codex orchestrator can dispatch any configured claude-subagent route using only `begin-step --harness codex` output; the translation tables in skill/docs are reduced to references; tests cover alias sanitization and the @codex-default evidence convention.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Overview

Today the Claude-route -> Codex-dispatch translation exists only as prose: the
`Route Translation Contract` table in `skills/codex/local-board/SKILL.md:64-85`
(plus the alias rule at :85) and a duplicate table in `docs/CodexSupport.md:30-79`.
The `local-team` skill cross-references the first table. Two hand-maintained
copies of a mapping that a machine already has everything to compute: drift is
inevitable.

Make `begin-step --harness codex` emit the fully-translated dispatch — executor
agent type, absolute prompt-fragment path, sanitized model, and the exact
`--executor` evidence string — as additive JSON. One authoritative
implementation; the two markdown tables shrink to a pointer plus one
illustrative row.

## Approach

### 1. Flag, not config key (design decision 1)

Add a per-invocation `--harness codex` flag to `begin-step`. Rationale: one board
can serve both a Claude orchestrator and a Codex orchestrator; the harness is a
property of *who is asking*, not of the board. A config key would force a board
into one harness. The default (no flag / `--harness claude`) leaves begin-step's
output byte-for-byte unchanged (back-compat). `gate-check` and `specialty-run`
have the same translation need and should grow the same flag later; that is out
of scope here but the shared pure function below makes it a one-line reuse.

Accept only `claude` (default, no-op) and `codex` as values; reject others with a
clear error.

### 2. One authoritative pure translator

Add a new module `src/codex-dispatch.js` exporting a pure function, roughly:

`translateCodexDispatch({ route, model, prompt, agentsDir }) -> codexDispatch`

It is pure (no fs, no config load): everything it needs is the logical route
string, the configured model, the configured project prompt, and the absolute
`agentsDir`. This is the single source of truth the doc tables will point at, and
it is trivially unit-testable (the acceptance criterion for alias sanitization
and the `@codex-default` convention). Reuse the existing `routeOf`/`modelOf`
helpers' grammar; do not invent a second route parser.

Translation semantics (encode the CURRENT documented contract exactly — design
decision 2):

- Static role map keyed by the seven known `claude-subagent:local-board-<role>`
  roles, giving `agentType` (`worker` | `explorer`). This mirrors the existing
  self-writing (worker) / return-only (explorer) partition already documented in
  SKILL.md "Dispatch Rules":
  - `explorer`: decomposer, reviewer, tester, gatecheck
  - `worker`: designer, implementer, documenter
  Keep it an explicit map (authoritative) rather than deriving it, so a future
  role can be added deliberately.
- Prompt path for a known claude-subagent role:
  `path.join(agentsDir, "local-board-<role>.md")`. The role suffix after
  `claude-subagent:` is already `local-board-<name>`, matching the file names in
  `agents/codex/` one-to-one. Returned absolute (agentsDir is absolute).
- Model sanitization: Claude aliases are not valid Codex ids. Treat
  `model === null`, `model in {opus, sonnet, haiku}`, or a `claude`-prefixed id
  as "no Codex model" -> `model: null` in the dispatch and
  `evidenceExecutor: "<route>@codex-default"`. Any other non-empty model passes
  through unchanged -> `model: "<id>"` and
  `evidenceExecutor: "<route>@<id>"`. `@codex-default` is the existing documented
  wildcard (`modelSatisfies` in `src/tickets.js:2010` already accepts it), so
  translated evidence always passes the strict-routing model pin without knowing
  the real Codex model.
- `inline`: `dispatchKind: "inline"`, `agentType: null`, `promptPath` = the
  configured project prompt (may be null), `model: null`,
  `evidenceExecutor: "inline"` (inline cannot pin a model — consistent with
  `composeExecutor`/`isValidAgentValue`).
- `codex-task:read-only` -> explorer, `codex-task:workspace-write` -> worker;
  `promptPath` = configured project prompt; these are native Codex routes so the
  model passes through only if it is non-alias, else `codex-default`;
  `evidenceExecutor` = the route (with `@model` when a real model is pinned).
  Carry a `passthrough: true`/`note` marker so the orchestrator sees these were
  not table-translated.
- Unknown `claude-subagent:*` role (not one of the seven): do NOT fabricate a
  path. Return `known: false`, `promptPath: null`, and a `note` telling the
  orchestrator to seek approval before inline fallback — exactly the SKILL.md
  "unknown route" rule. This keeps the CLI from inventing a non-existent prompt
  file.

### 3. Output shape (design decision 3)

Additive only. Base begin-step fields (`ticket`, `action`, `status`,
`transitions`, `configuredAgent`, `configuredModel`, `configuredPrompt`,
`strict`, `delegationRequired`, `branch`, `path`) stay identical. When
`--harness codex` is passed, attach one nested key:

```
"codexDispatch": {
  "dispatchKind": "spawn_agent" | "inline",
  "agentType": "worker" | "explorer" | null,
  "promptPath": "<abs path or configured prompt or null>",
  "model": "<codex model or null>",
  "evidenceExecutor": "<route>@codex-default | <route>@<model> | inline",
  "known": true | false,
  "note": "<optional guidance for passthrough/unknown>"
}
```

`evidenceExecutor` is the payload that makes the orchestrator's job mechanical:
it is exactly what to pass to `complete-step --executor`. The logical route stays
in `configuredAgent`, so nothing about strict-routing evidence changes.

Human (non-JSON) mode prints one extra concise line for parity (dispatchKind /
agentType / promptPath / evidenceExecutor), but JSON is the authoritative
contract the skill instructs Codex to parse.

### 4. Wiring (where agentsDir comes from)

`beginStep` in `src/tickets.js` has no package root and should not gain fs
concerns. Resolve `agentsDir` in the CLI (`commandBeginStep` in `src/cli.js`)
via the existing `selfPackageRoot()` + `path.join(packageRoot, "agents", "codex")`
seam that `commandWhere` already uses (`src/cli.js:223`), then call
`translateCodexDispatch` on the fields begin-step already returned and splice
`codexDispatch` into the result before printing. This keeps `beginStep`'s return
shape and its ledger side effect untouched, and centralizes the only fs/layout
knowledge (agentsDir) where it already lives. Factor `agentsDir` resolution into a
tiny shared helper so `commandWhere` and `commandBeginStep` agree.

### 5. Ledger stamp is unchanged (design decision 5)

`beginStep` stamps the active-steps ledger with the CONFIGURED logical route and
model (`route: configuredAgent, model: configuredModel`, `src/tickets.js:943-950`).
`--harness codex` must NOT change that — the logical route is canonical for
`check-dispatch` verification and strict-routing evidence. The translation is
presentation for the caller only. Because the translation is computed as CLI
post-processing after `beginStep` returns, the stamp is inherently untouched.
Note this explicitly in a code comment.

### 6. Shrink the two tables (design decision 4)

- `skills/codex/local-board/SKILL.md`: replace the full `Route Translation
  Contract` mapping table (:70-81) with a pointer: run
  `begin-step <id> --harness codex --json` and dispatch straight from
  `codexDispatch` (agentType -> `spawn_agent`, promptPath, evidenceExecutor). Keep
  ONE illustrative row and keep the surrounding prose rules that are NOT encoded
  by the CLI (unknown-route approval, return-only vs self-writing dispatch
  discipline, the `codex-default` meaning). Keep the alias rule as a one-line
  statement that the CLI now performs sanitization.
- `docs/CodexSupport.md`: same — collapse the :34-45 table to a pointer plus the
  worked `complete-step ... @codex-default` example (already present at :47-51),
  which now doubles as the illustrative row.
- `local-team` skill's cross-reference: point it at the same begin-step output
  instead of the SKILL table.

## Affected Files

- `src/codex-dispatch.js` (new): pure `translateCodexDispatch` + the static
  role->agentType map and the Claude-alias sanitization set. Single authority.
- `src/cli.js`: `commandBeginStep` parses `--harness`, resolves `agentsDir`,
  splices `codexDispatch`; extract shared agentsDir helper; usage/help text.
- `src/tickets.js`: no behavioral change required; optionally export nothing new.
  (If a future gate-check/specialty flag is desired, the same CLI-layer wiring
  applies — out of scope now.)
- `skills/codex/local-board/SKILL.md`: table -> pointer + one row; keep prose
  rules.
- `docs/CodexSupport.md`: table -> pointer + existing example.
- `skills/codex/local-team/SKILL.md` (or wherever local-team cross-references):
  repoint the reference.
- Tests: new `test/` file for `translateCodexDispatch` unit cases; extend the
  begin-step CLI test for the `--harness codex` JSON shape.
- `memory-bank/` if a route-translation fact is recorded there (check
  `techContext.md`/`systemPatterns.md`).

## Risks / Edge Cases

- **Drift not fully eliminated, only reduced.** The residual prose rules
  (unknown-route approval, return-only/self-writing dispatch discipline) still
  live in markdown. Acceptable: those are policy, not the mechanical mapping. The
  mapping — the part that actually drifted — becomes generated.
- **"Valid Codex model id" is under-specified.** The codebase has no positive
  Codex model list, only the documented "reject opus/sonnet/haiku". The chosen
  rule (denylist the three aliases + `claude*` prefix, pass everything else) can
  mislabel a hypothetical non-Claude model that happens to be named `opus`. Low
  risk; the denylist matches exactly what the docs promise today. See open
  question.
- **agentsDir layout skew.** `where`/`agentsDir` resolves against the running CLI
  package (dual layout handled by `selfPackageRoot`), not the flattened
  `~/.local-board` copy. Reusing that exact seam keeps begin-step consistent with
  `where`; do not resolve a second, divergent path.
- **Unknown role must not fabricate a path.** Guard with the known-role set;
  return `known:false` rather than a `local-board-typo.md` that does not exist.
- **Back-compat.** Without `--harness codex` the output must be byte-identical;
  the Claude orchestrator and existing tests must not see `codexDispatch`.
- **Prompt-path portability.** `promptPath` is absolute and machine-local;
  correct for a Codex orchestrator running on the same host (the only consumer).

## Test Strategy

Unit (`translateCodexDispatch`, the acceptance-critical layer):
- Each of the seven claude-subagent roles -> correct agentType and
  `local-board-<role>.md` path under a fixture agentsDir.
- Alias sanitization: `opus`/`sonnet`/`haiku`/null/`claude-...` -> `model:null`
  and `evidenceExecutor` ending `@codex-default`.
- Real Codex model id passes through -> `model` set and
  `evidenceExecutor` = `<route>@<id>` (and assert `modelSatisfies` accepts it).
- `inline` -> `dispatchKind:inline`, no model, `evidenceExecutor:"inline"`.
- `codex-task:read-only`/`workspace-write` -> explorer/worker passthrough with
  project prompt.
- Unknown `claude-subagent:foo` -> `known:false`, `promptPath:null`, note.

CLI / integration:
- `begin-step <id> --harness codex --json` on a designer-routed ticket returns
  base fields unchanged PLUS a correct `codexDispatch`, and the active-steps
  ledger still records the logical route/model (assert stamp unchanged).
- `begin-step <id> --json` (no flag) output is unchanged (no `codexDispatch`).
- `--harness bogus` errors.

Docs: a lightweight guard/test (if the repo has doc-lint) or manual check that
the tables now point at begin-step and no longer duplicate the seven rows.

## Documentation Updates

SKILL.md and CodexSupport.md table shrink (above); README Documentation Index
unaffected (no new doc file). Update the memory-bank route-translation fact if
present. Add a one-line `begin-step` usage note for `--harness codex`.

## Open Questions

1. Exact "valid Codex model id" rule: is denylisting `{opus,sonnet,haiku}` +
   `claude*`-prefix sufficient, or should the sanitizer consult an explicit
   allowlist of Codex model ids? Recommend the denylist for now (matches current
   docs); revisit if Codex model pinning becomes common.
2. Should `--harness codex` also be added to `gate-check` and `specialty-run` in
   this ticket, or a follow-up? Recommend follow-up (keep scope tight); the shared
   pure function makes it cheap later.

## Implementation Notes

Implemented `begin-step --harness codex` per the Technical Design.

New module `src/codex-dispatch.js` (pure): `translateCodexDispatch({ route, model, prompt, agentsDir })` returns a `codexDispatch` block. Static `ROLE_AGENT_TYPES` map for the seven `claude-subagent:local-board-<role>` roles (worker: designer/implementer/documenter, explorer: decomposer/reviewer/tester/gatecheck). Model sanitization (`sanitizeModel`): `null`/`opus`/`sonnet`/`haiku`/`claude*`-prefixed -> `null` (no Codex model); anything else passes through unchanged. `evidenceExecutorFor(route, sanitizedModel)` composes `<route>@codex-default` or `<route>@<model>`. Handles `inline` (dispatchKind `inline`, `evidenceExecutor: "inline"`, no model), the two `codex-task:*` routes (`passthrough: true` marker, same sanitization), known claude-subagent roles (`promptPath = path.join(agentsDir, "local-board-<role>.md")`), and unknown claude-subagent roles / any other route shape (`known: false`, `promptPath: null`, guidance `note`, no fabricated path).

`src/cli.js`: `commandBeginStep` gained `--harness claude|codex` (default `claude`, rejects other values with exit 2). On `--harness codex`, resolves `agentsDir` via a new shared `agentsDirFor(packageRoot)` helper (factored out of `commandWhere`, both now use it against `selfPackageRoot()`), calls `translateCodexDispatch` with the already-computed `configuredAgent`/`configuredModel`/`configuredPrompt`, and splices `codexDispatch` onto the result object before printing. Human (non-JSON) mode prints one extra `codexDispatch: ...` line. `beginStep` in `src/tickets.js` is untouched — the translation is CLI post-processing after the ledger stamp already ran, so the active-steps ledger continues to record the logical route/model unconditionally (verified by a new test reading the ledger directly). Usage text and `package.json`'s `check` script (added `src/codex-dispatch.js`) updated.

Docs: `skills/codex/local-board/SKILL.md`, `docs/CodexSupport.md`, and `skills/codex/local-team/SKILL.md` all had their "Route Translation" table/prose shrunk to a pointer at `begin-step --harness codex --json` / the `codexDispatch` block, keeping exactly one illustrative row (`claude-subagent:local-board-designer`) plus the prose rules that are not mechanically encoded (unknown-route approval, return-only vs self-writing dispatch discipline). `memory-bank/systemPatterns.md`'s Codex-translation paragraph now describes the `begin-step --harness codex` mechanism instead of only prose.

Tests added:
- `test/codex-dispatch.test.js` (new, 6 tests): all seven role mappings; alias/null/claude-prefixed sanitization -> `@codex-default`; a real Codex model id passes through (`modelSatisfies` asserted); `inline` shape; `codex-task:read-only`/`workspace-write` passthrough with `passthrough: true`; unknown `claude-subagent:foo` -> `known:false`, `promptPath:null`, non-empty `note`.
- `test/cli.test.js` (extended, +1 test): `begin-step --harness codex` on a designer-routed ticket returns all base fields byte-identical to the no-flag call plus a correct `codexDispatch`; asserts the active-steps ledger stamp still records the logical route/model; `--harness bogus` exits 2 with a message naming `--harness`.
- `test/install.test.js` (updated 2 pre-existing tests): the old assertions expected the full seven-role table/all nine routes verbatim in `SKILL.md`; since the ticket's explicit goal is shrinking that table to a pointer + one row, these were rewritten to assert the pointer language (`--harness codex`, `codexDispatch`, `evidenceExecutor`) and exactly one remaining illustrative row (`claude-subagent:local-board-designer`), rather than checking for now-removed rows.

Verification: `npm run check` (added `src/codex-dispatch.js` to the check list) clean; `npm test` 381 tests, 380 pass, 1 skipped (pre-existing slow smoke test, unrelated), 0 fail; `npm run validate` -> "Ticket validation OK".

Live check: `node ./bin/local-board.js begin-step T20260707T1335Z --action implement --harness codex --json` returns base fields unchanged plus:
```
"codexDispatch": {
  "dispatchKind": "spawn_agent",
  "agentType": "worker",
  "promptPath": "C:\\Users\\Nicho\\Documents\\local-board\\agents\\codex\\local-board-implementer.md",
  "model": null,
  "evidenceExecutor": "claude-subagent:local-board-implementer@codex-default",
  "known": true
}
```
Matches the ticket's stated expectation exactly (worker, absolute prompt path, sonnet sanitized to null, `@codex-default` evidence). Also confirmed the no-flag call has no `codexDispatch` key, and `--harness bogus` exits 2 with an actionable error.

Deviations / judgment calls (flagging for reviewer):
1. The design's prose for `codex-task:*` passthrough said "evidenceExecutor = the route (with @model when a real model is pinned)", which read literally could mean no `@codex-default` suffix when no model is pinned. I applied the same `sanitizeModel`/`evidenceExecutorFor` helper uniformly across claude-subagent and codex-task branches (so codex-task with an alias/no model also gets `@codex-default`), for internal consistency with the general model-sanitization rule and because `modelSatisfies` already treats `codex-default` as the universal wildcard. Worth a design-review confirmation.
2. For unknown/unrecognized routes (`known: false`), the design only specified `promptPath: null` and a `note`; I additionally compute `model`/`evidenceExecutor` the same way as the known case (rather than nulling them out), since those two fields don't depend on role knowledge. Not explicitly tested by the design's Test Strategy, so flagging as a judgment call.
3. Chose the illustrative table row as `claude-subagent:local-board-designer` in all three docs (SKILL.md, CodexSupport.md, local-team SKILL.md) for consistency with each other and with pre-existing `install.test.js` assertions, rather than `implementer` (this ticket's own action).

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-08T03:25:18Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): begin-step --harness codex emits an additive codexDispatch block from a new pure src/codex-dispatch.js (agentType, absolute prompt path, sanitized model, evidenceExecutor); alias sanitization to @codex-default; tables become pointers; ledger stamp unchanged. Estimate 2 (basis T20260707T1329Z).

- 2026-07-08T03:26:07Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (CLI orchestration)

- 2026-07-08T03:26:07Z: Ensured git branch local-board/T20260707T1335Z-cli-begin-step-harness-codex-returns-the-translated-dispatch (created).
