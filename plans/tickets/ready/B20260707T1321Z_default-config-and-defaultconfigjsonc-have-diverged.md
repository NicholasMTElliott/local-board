---
id: B20260707T1321Z
type: bug
status: ready_for_implementation
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: 2
estimateBasis: B20260707T1320Z
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T13:21:54Z
updated: 2026-07-07T19:56:06Z
completedSteps: ["design:claude-subagent:local-board-designer@opus"]
routingApprovals: []
---
# DEFAULT_CONFIG and defaultConfigJsonc have diverged

## Requirement

Two hand-maintained defaults have diverged: `DEFAULT_CONFIG` (`src/config.js:16-259`) has all `optionalSteps` empty and `estimation.enabled: false`, while `defaultConfigJsonc()` (`src/config.js:499-822`) ships populated optionalSteps and `estimation.enabled: true`. A repo running without a config file silently gets different workflow behavior (no estimation gate, no specialty catalogs) than an `init`-scaffolded repo.

Fix: generate the JSONC from `DEFAULT_CONFIG` plus a comment map, or add a test asserting `parseJsonc(defaultConfigJsonc())` deep-equals `DEFAULT_CONFIG`. If the divergence is intentional, make it explicit and documented.

Acceptance: the two defaults are provably in sync (generated or test-asserted), or the intended difference is documented.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Summary

`DEFAULT_CONFIG` (`src/config.js:16-262`) and `defaultConfigJsonc()` (`src/config.js:523-859`)
are two hand-maintained copies of the default config. They agree on `version`,
`workflow`, `agents`, `routing`, `retention`, `git`, and `worktrees`, but differ
in exactly two places:

- `estimation.enabled`: `false` in `DEFAULT_CONFIG`, `true` in the JSONC.
- `optionalSteps`: all stages empty in `DEFAULT_CONFIG`; the JSONC ships 3 design
  and 2 implement specialties (test empty in both).

Investigation shows these two differences are **intentional and load-bearing**,
not drift. The remaining ~250 lines are duplicated verbatim and *should* stay in
lockstep but are protected by nothing today. The recommended fix therefore is
**not** convergence and **not** a naive full deep-equal test (both would break
real behavior). It is: (a) document the two roles loudly to stop the code-reading
confusion that caused the recent incident, and (b) add a guard test that asserts
the two defaults are identical *except* for an explicit allowlist of the two
intentional differences. This locks the shared blocks in sync while codifying
intent as an executable spec.

## Why the divergence is intentional (do not converge)

`DEFAULT_CONFIG` is not "the same thing as the scaffold, minus some values." It
plays two runtime roles that `defaultConfigJsonc()` never plays:

1. **ENOENT fallback** — when no config file exists, `loadConfig` returns
   `structuredClone(DEFAULT_CONFIG)` (`src/config.js:276`).
2. **Merge base** — when a config file *does* exist, every user config is deep-
   merged onto `DEFAULT_CONFIG` (`src/config.js:270`).

Both intentional differences fall out of role 2:

- **`estimation.enabled: false`** is deliberate backward-compat. A pre-estimation
  config file that omits the `estimation` block must not silently start enforcing
  the estimation gate. This is pinned by the test
  `loadConfig defaults estimation when the block is omitted (backward-compat disabled)`
  (`test/config.test.js:429-442`), which asserts `enabled === false`.
- **`optionalSteps` empty** is deliberate merge-base behavior. The loader merges
  `optionalSteps` arrays *wholesale* (the JSONC even documents this at
  `src/config.js:799`). If `DEFAULT_CONFIG` shipped populated catalogs, a user
  config that omitted a stage would silently inherit the built-in specialties.
  Pinned by `loadConfig returns empty optionalSteps catalog when the block is
  omitted` (`test/config.test.js:202-213`).

So flipping `DEFAULT_CONFIG` to match the JSONC (or asserting a full deep-equal)
would break two existing tests and change backward-compat semantics for every
config-less-block board. The `enabled: false` / empty-catalog defaults are the
*correct* values for the fallback+merge-base role.

## What actually caused the incident

The reported confusion was a **code-reading** failure, not a runtime bug. A
subagent read the `DEFAULT_CONFIG` literal, saw `estimation.enabled: false`, and
concluded estimation was off — but this repo ships an actual
`plans/local-board.config.jsonc` (the scaffolded JSONC, estimation on), so the
running board had the gate enabled and `complete-step` correctly demanded an
estimate. Nothing diverged at runtime; the source constant was mistaken for the
effective config. The highest-value fix for *that* failure is a prominent comment
at `DEFAULT_CONFIG`, not a behavioral change.

The genuine latent hazard is the ~250 lines of verbatim duplication in the shared
blocks (`workflow.transitions` alone is large). Someone editing one copy — e.g.
adding a transition, or the recent `worktrees` addition (T1319 era, which did land
identically in both, confirmed) — can silently drift the other. That is what the
guard test defends.

## Recommended approach

**Reject** ticket option 1 (generate the JSONC from `DEFAULT_CONFIG` + comment
map): it reintroduces coupling into the scaffold-write path just hardened in
B1320, the comment-map machinery is non-trivial, and it still cannot express the
two intentional value differences without a special-case layer. Cost/risk exceeds
the benefit.

**Reject** ticket option 2 as written (naive `deepEqual(parseJsonc(jsonc),
DEFAULT_CONFIG)`): it would fail on the two intentional differences and pressure a
maintainer to "fix" them by breaking backward-compat.

**Adopt** a documented-divergence + allowlisted guard test:

1. **Document the two roles and the intentional differences at the source.** Add a
   block comment above `DEFAULT_CONFIG` stating: this is the ENOENT fallback and
   the deep-merge base, it deliberately differs from `defaultConfigJsonc()` in
   `estimation.enabled` (off for backward-compat) and `optionalSteps` (empty so
   omitted stages do not inherit catalogs), and the init scaffold is
   `defaultConfigJsonc()`. Add a one-line pointer comment at
   `defaultConfigJsonc()` back to `DEFAULT_CONFIG`. A light rename to
   `FALLBACK_CONFIG` / `MERGE_BASE_CONFIG` would signal intent even more strongly,
   but `DEFAULT_CONFIG` is an exported symbol; keep the name and rely on the
   comment to avoid churn (rename is optional, see Open Questions).
2. **Add a guard test** (`test/config.test.js`) that parses the scaffold and
   compares it to `DEFAULT_CONFIG` with the two known differences explicitly
   reconciled, so any *other* drift fails:

   ```js
   test("defaultConfigJsonc matches DEFAULT_CONFIG except for documented differences", () => {
     const scaffolded = parseJsonc(defaultConfigJsonc());
     const expected = structuredClone(DEFAULT_CONFIG);
     // Documented, intentional divergences (see comment on DEFAULT_CONFIG):
     expected.estimation.enabled = true;            // scaffold enables the gate
     expected.optionalSteps = scaffolded.optionalSteps; // scaffold ships catalogs
     assert.deepEqual(scaffolded, expected);
   });
   ```

   This requires exporting `DEFAULT_CONFIG` (already exported) into the test. The
   `optionalSteps` *content* of the scaffold is already independently asserted by
   `test/config.test.js:172-200`, so passing it through here is safe — this test's
   job is the shared blocks. Optionally add a companion assertion that the two
   allowlisted keys are in fact the *only* differences (e.g. diff the two objects
   and assert the changed key-paths equal `["estimation.enabled", "optionalSteps"]`)
   to prevent the allowlist from masking new drift; a simple version is fine for a
   first cut.

## Affected files

- `src/config.js` — comment additions only above `DEFAULT_CONFIG` (line 16) and
  `defaultConfigJsonc()` (line 523). No behavioral change. (Optional rename if the
  team wants it — see Open Questions.)
- `test/config.test.js` — one new guard test (~12 lines).
- `memory-bank/systemPatterns.md` and/or `techContext.md` — one terse fact:
  "`DEFAULT_CONFIG` = ENOENT fallback + merge base (estimation off, catalogs
  empty); `defaultConfigJsonc()` = init scaffold (estimation on, catalogs
  populated); a guard test keeps the shared blocks in sync." Confirm which memory
  file already describes config before editing.
- No production behavior changes; no scaffold-path changes (keeps B1320 intact).

## Risks

- **Low.** The change is comment + test + doc. The only executable addition is a
  read-only assertion.
- **Guard-test brittleness (intended):** the test will now fail whenever someone
  edits one default's shared blocks without the other. That is the point, but the
  failure message should name the fix ("update both `DEFAULT_CONFIG` and
  `defaultConfigJsonc()`, or extend the allowlist if the difference is
  intentional"). Put that hint in a comment beside the test.
- **Allowlist rot:** if a future intentional difference is added, the allowlist
  must be extended deliberately; the optional "only these keys differ" assertion
  mitigates silent expansion.
- **Rename blast radius (only if the optional rename is taken):** `DEFAULT_CONFIG`
  is imported in tests and referenced at `src/config.js:270,276`. Grep shows no
  other `src/` importers, but a rename would touch `test/config.test.js` and any
  test importing it. Deferred; not required by acceptance.

## Test strategy

- New guard test as above (shared blocks stay in sync; two intentional
  differences allowlisted).
- Do **not** modify or weaken `test/config.test.js:202` or `:429`; they pin the
  intentional `DEFAULT_CONFIG` values and are the evidence the divergence is by
  design.
- Existing coverage already validates the scaffold's `optionalSteps` and
  `estimation` content (`:172`, `:417`) and that scaffold prompt paths resolve on
  disk (`cli.test.js:1164`); no change needed there.
- Run `node --test` (full suite) to confirm the new assertion passes against the
  current sources and the two pinned tests still hold.

## Documentation impact

- Memory-bank one-liner (above). Keep it to current-state fact, no history.
- If a human-facing config doc exists under `docs/` that describes defaults,
  add a sentence distinguishing the fallback defaults from the scaffolded
  defaults; otherwise no `docs/` change and no README index update needed.

## Open questions

1. **Rename or comment-only?** Recommendation: comment-only now (avoids touching
   the exported symbol and its test importers); rename to `FALLBACK_CONFIG` is a
   nice-to-have that can be a follow-up. Confirm the team does not want the
   stronger rename signal in this ticket.
2. **Strict "only these keys differ" assertion?** Recommendation: include it if
   cheap (a small recursive key-path diff), otherwise ship the reconciled
   `deepEqual` alone. Either satisfies acceptance ("provably in sync or documented
   difference").

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-07T19:55:23Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): divergence is intentional and load-bearing (ENOENT fallback vs blessed init defaults, differing only in estimation.enabled and optionalSteps); design documents both roles at the source and adds an allowlist guard test locking all other keys in sync. Estimate 2 (basis B20260707T1320Z).
