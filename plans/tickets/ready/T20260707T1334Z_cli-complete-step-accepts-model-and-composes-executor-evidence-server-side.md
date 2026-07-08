---
id: T20260707T1334Z
type: task
status: ready_for_implementation
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: 2
estimateBasis: T20260707T1329Z
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T13:34:55Z
updated: 2026-07-08T03:09:31Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
routingApprovals: []
---
# cli: complete-step accepts --model and composes executor evidence server-side

## Requirement

The executor evidence string `<route>@<model>` is composed by the orchestrating model from prose rules (`SKILL.md:36, 219`) — a compliance point that can drift (wrong suffix, missing suffix), and which T20260707T1324Z will start validating strictly.

Fix: accept `--model <model>` on `complete-step` and compose the `<route>@<model>` token server-side; keep the combined form accepted for backward compatibility. Update skill texts to pass `--executor <configuredAgent> --model <configuredModel>` verbatim from `begin-step` output.

Acceptance: `complete-step --executor <route> --model <m>` records `<route>@<m>`; both forms validate identically; skills updated.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Approach

Add an optional `--model <model>` flag to `complete-step` and compose the
`<route>@<model>` executor token server-side, so orchestrators no longer hand-splice
the suffix that T20260707T1324Z now validates strictly. The combined
`--executor <route>@<model>` form keeps working unchanged for back-compat.

Composition lives in one shared, exported helper in `src/tickets.js` (co-located with
`routeOf`/`modelOf`/`isValidAgentValue`, which already own executor grammar). The CLI
stays a thin arg parser and calls the helper; `completeStep`/`recordGateConsultation`
keep their current `(…, executor, …)` signatures and receive an already-composed
executor string. This avoids threading a new `model` parameter through the lock/validate
path and keeps a single source of truth for the grammar.

### Helper contract

`composeExecutor(executor, model)` -> string (or throws):

- `model` absent/empty -> return `executor` verbatim (today's behavior; combined form
  still flows through unchanged and is validated downstream by `isValidAgentValue`).
- `executor` already contains `@` and `model` given:
  - suffix equals `model` -> no-op, return `executor` (idempotent; supports skills that
    pass both).
  - suffix differs from `model` -> throw a clear error naming **both** values, e.g.
    `--executor pins @<a> but --model says <b>; pass only one or make them agree`.
- `executor` is `inline` and `model` given -> throw a clear, specific error: inline runs
  on the orchestrator's own model and cannot pin one (mirror the T1324 rule that
  `isValidAgentValue` already enforces for `inline@x`). Fail here with an actionable
  message rather than letting the generic `executor must be one of …` fire.
- otherwise return `` `${executor}@${model}` ``.

Downstream, the composed string still passes through the existing
`isValidAgentValue` and `validateStepRouting(..., { enforceModel: true })` checks, so
malformed models and route/model mismatches keep their current rejection behavior. No
change to `modelSatisfies`, `stepToken`, or the `codex-default` sentinel path.

### gate-complete parity (decision 3: adopt)

`gate-complete` takes `--executor` with the same grammar. Add `--model` there too via the
same helper. It is cheap, keeps the two evidence-recording commands symmetric, and lets
the codex/skill guidance describe one rule. Gate-check consultations do not currently run
`enforceModel` model matching, but recording the pinned model in the `gate:<stage>:<executor>`
token is still consistent and future-proof. If the reviewer judges scope creep, this is the
one deferrable piece; the `complete-step` change is the acceptance-bearing core.

## Affected files

- `src/cli.js`
  - `commandCompleteStep` (~L548): read `--model` via `takeOption`; call
    `composeExecutor(executor, model)` before `completeStep`. Update the usage/throw string
    and the `--help` line (~L1207).
  - `commandGateComplete` (~L1021): same `--model` plumbing + usage/help (~L1222) if parity
    is adopted.
- `src/tickets.js`
  - Add and export `composeExecutor(executor, model)` near `routeOf`/`modelOf` (~L1993).
    Reuse `routeOf`/`modelOf` for the `@`-conflict branch. No signature change to
    `completeStep` or `recordGateConsultation`.
- `SKILL.md`
  - Step 10 (L38) and the completion-evidence note (L235): show the two-flag form
    `--executor <configuredAgent> --model <configuredModel>` copied verbatim from
    `begin-step` output as the primary; keep the `@<model>` combined form documented as
    equivalent/back-compat.
- `skills/codex/local-board/SKILL.md` (L56, L66, L85, L179) and
  `skills/codex/local-team/SKILL.md` (L74): update evidence guidance to the two-flag form;
  keep `@codex-default` semantics (now expressible as `--model codex-default`).
- `test/cli.test.js` and/or `test/tickets.test.js`: new cases (below).
- Memory Bank: no change expected (grammar unchanged, only an input convenience). Docs
  index unaffected (no new `docs/*.md`).

## Risks / edge cases

- **Double-pin divergence**: both flags supplied with different models is the main new
  failure mode. Handled by the explicit conflict error; without it the `--model` value
  would be silently ignored. Cover with a test.
- **`--model` on inline**: must produce a targeted error, not the opaque
  `executor must be one of …`. The current combined form already rejects `inline@x`; keep
  the message specific.
- **Empty/whitespace `--model`**: treat empty string as "not supplied" (return executor
  verbatim) so a stray `--model ""` does not compose `route@`. `takeOption` already rejects
  a following `--flag` as the value.
- **codex-default**: `--model codex-default` must compose `route@codex-default` and keep
  satisfying `modelSatisfies`. Verify no regression.
- **Back-compat**: every existing call site passing only `--executor <route>@<model>` must
  behave identically (helper is a no-op when `--model` absent). This is the compatibility
  guarantee in the acceptance criteria.
- **gate-complete scope**: adding `--model` slightly widens the diff; low risk since the
  gate token grammar already tolerates `@model` executors.

## Test strategy

Extend the existing CLI/tickets suites (no new harness):

1. `complete-step --executor <route> --model <m>` records `<route>@<m>` in `completedSteps`
   and the Run Log — the acceptance case.
2. Equivalence: two-flag form and combined `--executor <route>@<m>` form produce identical
   ticket state (token + validation outcome).
3. Conflict: `--executor <route>@<a> --model <b>` (a != b) throws naming both; identical
   suffix is accepted as a no-op.
4. `--model` with `--executor inline` throws the specific inline error.
5. `--model codex-default` on a model-pinned route composes `route@codex-default` and passes
   `enforceModel` validation.
6. Back-compat regression: existing combined-form tests still pass unchanged.
7. If parity adopted: mirror cases 1-4 for `gate-complete --model`.

Run `node --test` and `local-board validate` before reporting.

## Open questions

None blocking. Decisions 1-4 resolved as: error on `@`/`--model` disagreement (no-op when
equal); specific error for `--model` on inline; adopt `gate-complete --model` parity;
skills lead with the two-flag form and keep the `@` form documented as equivalent. Flagged
for reviewer judgment only: whether to defer the `gate-complete` parity to keep the ticket
minimal.

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-08T03:08:39Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): shared composeExecutor helper, --model on complete-step and gate-complete, disagreement errors, inline rejection, back-compat passthrough, skills lead with the two-flag form. Estimate 2 (basis T20260707T1329Z).

- 2026-07-08T03:09:31Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (CLI ergonomics)
