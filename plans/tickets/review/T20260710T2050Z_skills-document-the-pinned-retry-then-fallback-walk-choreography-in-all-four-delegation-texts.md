---
id: T20260710T2050Z
type: task
status: ready_for_review
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260710T2050Z-skills-document-the-pinned-retry-then-fallback-walk-choreography-in-all-four-delegation-texts
estimate: 2
estimateBasis: T20260710T1533Z
workStartedAt: 2026-07-11T20:13:50Z
workCompletedAt: null
created: 2026-07-10T20:50:02Z
updated: 2026-07-11T20:21:30Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "design-review:codex-task:read-only@gpt-5.6-sol", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku"]
routingApprovals: []
---
# skills: document the pinned-retry-then-fallback-walk choreography in all four Delegation texts

## Requirement

Follow-up from T20260710T1532Z (fallbackModels shipped 2026-07-10) and T20260710T1534Z round-1 design note. The Delegation prose in the two board skills documents the fallback walk for begin-step dispatches (native walks configuredFallbackModels, codex skill walks codexDispatch.fallbackModels; exhausted/empty walks go to approve-inline/questions, never codex-default). What is NOT yet documented is the operational retry choreography the orchestrator should follow: retry the pinned model once on a capacity/unavailability failure BEFORE walking fallbacks, record the actually-used model in evidence, carry effort unchanged, and treat consultation dispatches (gate-check, specialty-run, design-review) with the same walk using their payload fallback fields.

### Scope

1. Add the retry-then-walk guidance to the Delegation section of SKILL.md and skills/codex/local-board/SKILL.md, and the parallel-mode equivalent to SKILL_TEAM.md and skills/codex/local-team/SKILL.md (executor/orchestrator audience-correct; 1-3 sentences per insertion; CLI Commands fences untouched).
2. Mention the consultation-payload walk explicitly (the payloads carry the fallback fields only when configured).
3. Keep byte-identical fenced blocks across the four copies; skill-usage-sync suite green.

### Acceptance criteria

- All four skill texts describe: one pinned-model retry, then the ordered walk, evidence records the actual model, effort carries over, exhaustion goes to approve-inline/questions.
- npm run check and node --test pass (content-assertion and sync suites included).

### Non-goals

- No CLI behavior changes; no automatic in-CLI retry (dispatch remains the orchestrator's job).

## Acceptance Criteria

## Related Tickets

## Technical Design

Docs-only change to the four board skill texts. Add the operational
retry-then-fallback-walk choreography so every skill audience (native/codex,
single-ticket/parallel) documents: retry the pinned model once on a
capacity/unavailability failure, then walk the ordered fallback list, record the
actually-used model in evidence, carry effort over unchanged, and route
exhaustion to approve-inline/questions — including the consultation dispatches.

### Current-state audit (verified line-by-line)

The premise that "all four Delegation texts already carry a fallback walk but no
retry choreography" is only half true. Actual state in the worktree:

- `SKILL.md` (native single-ticket) — the `Delegation` section paragraph at
  **line 373** ALREADY documents the full choreography: "Retry the pinned model
  once; if it still fails, dispatch each fallback entry **in order**, keeping the
  same route and carrying the configured effort over unchanged. On the first
  success, record complete-step/gate-complete/design-review-complete with
  `--model <fallbackModel>` ... Only if the pin and every fallback are exhausted,
  fall back to the approve-inline / questions path". It also covers the
  consultation-payload walk (`gate-check` / `specialty-run` /
  `design-review-check` top-level `fallbackModels`). All five acceptance elements
  are present.
- `skills/codex/local-board/SKILL.md` (codex single-ticket) — the
  `### Fallback Model Walk` subsection at **lines 87-93** ALREADY documents the
  full choreography for the sanitized `codexDispatch.fallbackModels` (retry once,
  ordered walk, effort carry-over via `codexDispatch.effort`, record actual model,
  exhaustion -> approve-inline/questions with the "never `@codex-default`" guard,
  and the consultation-payload walk). All five acceptance elements are present.
- `SKILL_TEAM.md` (native parallel) — has **no** fallback/retry prose at all.
  `grep -i fallback` matches only the unrelated "main-checkout Fallback"
  narrative elsewhere; the `Execution profiles` section (lines 51-68) never
  mentions `configuredFallbackModels` or any retry walk.
- `skills/codex/local-team/SKILL.md` (codex parallel) — has **no**
  model-fallback-walk prose. The only `fallback` hit (line 81) is "inline
  fallback when `codexDispatch.known` is false", which is unrelated. The
  `Route Translation` section never mentions `codexDispatch.fallbackModels`.
  Separately, its **line 46** carries an inaccuracy this ticket must fix (see
  insertion 2b).

Conclusion: the real gap is the two **parallel** skills. The two single-ticket
skills already satisfy the acceptance criteria as written. See the scope note in
Open Questions.

### Related tickets

- T20260710T1532Z — shipped `fallbackModels` (CLI: `configuredFallbackModels`,
  `codexDispatch.fallbackModels`, consultation-payload `fallbackModels`, D5/D6/D7)
  and added the single-ticket-skill walk prose. This ticket is the parallel-skill
  follow-up.
- T20260710T1534Z — round-1 design note referenced by the requirement.
- B20260710T2050Z — separate bug on the fallback-free `claude-subagent:`
  design-review hook limitation (D7 carve-out); this ticket only documents that
  known limitation, it does not fix it.

### Implementation approach — exact insertions

Two files change. Insertions are prose only; no fenced ` ```sh ` block is touched.

#### 1. `SKILL_TEAM.md` (native parallel; Claude parallel-orchestrator audience)

Anchor: the `Dispatch the step accordingly:` bullet list in `## Execution
profiles`. Insert a new paragraph **immediately after the `codex-task:<mode>`
bullet (current line 62) and before the blank line preceding the "If the
routing-validator hook denies..." paragraph** (current line 64). Uses the native
field names (`configuredFallbackModels`, `configuredEffort`), since this
orchestrator dispatches native Claude subagents, not codex translations.

Proposed text (3 sentences):

> When `begin-step` (or a `gate-check` / `specialty-run` / `design-review-check`
> consultation payload) returns a non-empty ordered `fallbackModels`
> (`configuredFallbackModels` on `begin-step`), a capacity/unavailability failure
> of the pinned model needs no user approval: retry the pinned model once, then
> dispatch each fallback entry **in order** on the same route, carrying the
> configured effort over unchanged. On the first success, record the model that
> actually ran — `complete-step` (or the consultation's `*-complete`) with
> `--model <fallbackModel>` — and strict routing accepts it as a sanctioned
> fallback with no `approve-inline`. Only if the pin and every fallback are
> exhausted, take the `approve-inline` / `questions` path; never dispatch an
> unconfigured model.

Optional parity touch (not required for acceptance): add a
`- \`configuredFallbackModels\`: the ordered fallback list, present only when the
resolved profile lists a non-empty \`fallbackModels\`.` bullet to the
`begin-step ... returns:` list (after current line 56) to mirror `SKILL.md`
line 37. Recommended for completeness but can be folded — the paragraph above
already names the field.

#### 2a. `skills/codex/local-team/SKILL.md` — new Route-Translation walk paragraph (codex parallel; Codex parallel-orchestrator audience)

Anchor: `## Route Translation`, immediately **after the first paragraph (current
line 81)** that describes dispatching from the `codexDispatch` block, before the
`Preserve the configured logical route...` paragraph (current line 83). Uses the
codex field names (`codexDispatch.fallbackModels`, `codexDispatch.effort`,
`codexDispatch.promptPath`).

Proposed text (3 sentences — cross-reference sentence dropped to honor the
1-3-sentence cap, per review finding 2):

> When the resolved `codexDispatch` block carries a non-empty `fallbackModels`
> array (the **sanitized** list, present on `begin-step` and on a `gate-check` /
> `specialty-run` / `design-review-check` payload only when the profile lists
> one), a capacity/unavailability failure of the pinned model needs no user
> approval: retry the pin once, then dispatch each `codexDispatch.fallbackModels`
> entry **in order** via the same `codexDispatch.promptPath`, carrying
> `codexDispatch.effort` over unchanged. On the first success, record completion
> with `--model <fallbackModel>` for the model that actually ran — strict routing
> accepts a sanctioned fallback. Only if `codexDispatch.fallbackModels` is empty
> or the pin plus every entry is exhausted, take the `approve-inline` /
> `questions` path; never record `@codex-default` for an exhausted walk.

#### 2b. `skills/codex/local-team/SKILL.md` — fix the inaccurate design-review clause on line 46 (review finding 1)

Line 46's design-review sub-clause states **unconditionally** that a
`claude-subagent:` design-review route returns no `codexDispatch` block and
directs the orchestrator to fall back to `begin-step --action design-review`.
`test/cli.test.js` lines 1884-1919 prove the opposite for the fallback-CONFIGURED
case: a `claude-subagent:local-board-reviewer` design-review profile with
`fallbackModels: ["gpt-5.5-fallback"]` returns a payload whose
`out.codexDispatch.fallbackModels` and top-level `out.fallbackModels` are both
populated and stamps an `action`/`design-review` ledger record. So the
`begin-step` workaround applies only to the fallback-FREE case, exactly as the
sibling single-ticket skill `skills/codex/local-board/SKILL.md` line 269 already
qualifies it ("For a `claude-subagent:*` reviewer route with **no**
`fallbackModels` configured ...").

Exact replacement — within line 46, replace the clause:

> for a `claude-subagent:` route, `design-review-check` alone returns no
> `codexDispatch` block — run `begin-step <ticket-id> --action design-review
> --harness codex --json` to obtain the sanitized dispatch `model` and
> `evidenceExecutor`, `@codex-default` when no valid Codex id exists

with:

> for a `claude-subagent:` route with **no** `fallbackModels` configured,
> `design-review-check` alone returns no `codexDispatch` block — run `begin-step
> <ticket-id> --action design-review --harness codex --json` to obtain the
> sanitized dispatch `model` and `evidenceExecutor`, `@codex-default` when no
> valid Codex id exists (with `fallbackModels` configured, the
> `design-review-check` payload already carries `fallbackModels` + a
> `codexDispatch` block — walk it per Route Translation above)

This mirrors line 269's fallback-free qualification and keeps the sentence a
single clause (no new sentence added, so the 1-3-sentence guidance is unaffected;
this is a correction, not a fresh insertion). It also makes 2a's fallback walk
actually reachable for a fallback-configured Claude reviewer instead of being
contradicted two paragraphs above.

Both 2a and 2b are audience-correct: sanitized `codexDispatch.*` fields, the
"never `@codex-default`" guard, and the fallback-free-only qualification of the
`begin-step` workaround.

#### 3-4. `SKILL.md` and `skills/codex/local-board/SKILL.md`

**No change recommended.** Both already document all five acceptance elements
(see audit above: `SKILL.md` line 373; codex single-ticket lines 87-93). Editing
them would be redundant and risks prose drift. If the reviewer insists on a
literal touch, the only defensible micro-edit is a clarifying clause, but it is
not needed to pass the "all four texts describe ..." acceptance test.

### Affected files

- `SKILL_TEAM.md` — one paragraph inserted (optional second bullet).
- `skills/codex/local-team/SKILL.md` — one paragraph inserted (2a) + one clause
  corrected on line 46 (2b).
- `test/skill-usage-sync.test.js` — optional new content assertion (see Test
  strategy).
- No production `src/` change. No `plans/prompts/` or `agents/` change.

### Sync-resources implication

`npm run sync-resources` mirrors **only** `plans/prompts` -> `resources/prompts`
and `plans/templates` -> `resources/templates` (`scripts/sync-resources.mjs`
lines 16-17; asserted by `test/resources-sync.test.js`). It does **not** mirror
any `SKILL*.md` or `skills/codex/**` file — there is no `resources/skills`. The
four skill texts are shipped verbatim (packaged directly; `test/pack.test.js`
lists `SKILL.md`/`SKILL_TEAM.md` as exact-included files, `test/install.test.js`
copies them). Therefore **this change does NOT require `npm run sync-resources`**,
and `resources-sync.test.js` is unaffected. `sync-resources` would only be
mandatory if we edited `plans/prompts/**` (per AGENTS.md), which we do not.

### Test strategy

Existing suites — all remain green without modification:

- `test/skill-usage-sync.test.js` — this suite operates only on the two
  single-ticket board skills (`SKILL.md`, `skills/codex/local-board/SKILL.md`),
  via `SKILL_FILES`, and does five things: (1) extracts the ` ```sh ` block under
  each file's `## CLI Commands` heading and asserts the two blocks list the same
  command-name set; (2) asserts the two blocks are byte-identical (EOL-normalized);
  (3) asserts every command name in each block is a subset of the authoritative
  usage surface returned by `usageCommandNames()` from `src/cli.js`; (4) asserts
  both blocks contain the required `design-review-check` and
  `design-review-complete` commands; (5) guards against a silently-broken parser
  by asserting `usageCommandNames()` and each extracted block are non-empty. It
  does NOT read `SKILL_TEAM.md` or the codex **parallel** skill, and it reads only
  the `## CLI Commands` fence, never Delegation/Route-Translation prose. Our
  edits touch none of those fenced blocks and add no CLI command, so all five
  assertions stay green.
- `test/cli.test.js` — the `fallbackModels` assertions (T20260710T1532Z, D5/D6/D7,
  including lines 1884-1919) assert CLI JSON behavior
  (`configuredFallbackModels`, `codexDispatch.fallbackModels`, stamp shape), not
  skill markdown. Our prose edits do not change CLI behavior. No change; these are
  the assertions cited as ground truth for the line-46 correction (2b).
- `test/resources-sync.test.js` — mirrors prompts/templates only. No change.

Optional new assertion (the brief calls it "desirable"). If added, put it in
`test/skill-usage-sync.test.js` (it already imports `readFile` and knows the
skill paths) and assert **every** choreography element separately, with
audience-partitioned stable markers so the two prose dialects both pass. Suggested
markers, applied per file against the Delegation / Execution-profiles /
Route-Translation prose (case-insensitive), split into a native set and a codex
set:

- pinned retry — `/retry the pin(ned model)? once/`;
- ordered walk — `/\bin order\b/` co-occurring with `/fallback/`;
- actual-model evidence — `/--model <fallbackModel>/` (literal; identical across
  all four dialects);
- effort carry-over — native files: `/carry(ing)? the configured effort over
  unchanged/`; codex files: `/carry(ing)?[^.]*codexDispatch\.effort[^.]*unchanged/`;
- consultation payloads — `/gate-check/` AND `/specialty-run/` AND
  `/design-review-check/` all present in the walk paragraph;
- exhaustion path — `/approve-inline/` AND `/questions/` in the walk paragraph;
- never-codex-default — **codex files only** (`skills/codex/local-board/SKILL.md`,
  `skills/codex/local-team/SKILL.md`): `/never\b[^.]*@?codex-default/`; the two
  native files never mention `codex-default`, so this element is deliberately NOT
  asserted against them.

Run the native-file element set against `SKILL.md` and `SKILL_TEAM.md`, and the
native set PLUS never-codex-default against the two codex skills, so no marker is
applied to an audience that legitimately omits it. This is optional and does not
block acceptance; if the implementer prefers not to maintain seven regexes across
four files, drop it — rationale: the choreography is already indirectly protected
by the CLI-behavior assertions in `cli.test.js`, and the prose carries no
machine-consumed contract, so a brittle multi-regex guard may cost more than it
saves.

Acceptance verification commands (run at the end): `npm run check` and
`node --test` (full suite, per AGENTS.md, since agent/skill artifacts are
content-asserted). No `sync-resources` needed.

### Risks

- **Scope-accuracy risk (low):** the ticket names all four files, but two already
  satisfy acceptance. Editing them redundantly is the main way to introduce
  needless drift. Mitigation: leave the two single-ticket skills unchanged;
  document why (this design).
- **Contradiction risk (addressed by 2b):** without 2b, the new 2a walk paragraph
  would directly contradict line 46's unconditional "no `codexDispatch` for a
  claude-subagent design review" claim. 2b resolves it and aligns the file with
  `cli.test.js` 1884-1919 and sibling line 269.
- **Prose-dialect risk (low):** an over-strict new content assertion could fail
  on the legitimate native-vs-codex wording difference. Mitigation: audience-
  partitioned markers as specified above.
- **Fence-integrity risk (very low):** insertions are plain paragraphs outside any
  ` ```sh ` block; `skill-usage-sync` byte-identity is not at risk.

### Open questions

- Scope confirmation (non-blocking): design proceeds on the reading that
  `SKILL.md` and `skills/codex/local-board/SKILL.md` need no edit because they
  already describe the full choreography (line 373; lines 87-93). If the intent
  was instead to reword/relocate that existing prose in the single-ticket skills,
  say so; otherwise implementation touches only the two parallel skills (plus the
  line-46 correction in the codex parallel skill).

## Implementation Notes

Implemented the r2 design exactly (docs-only):

1. `SKILL_TEAM.md` — inserted the 3-sentence native retry-then-walk paragraph
   in `## Execution profiles`, immediately after the `codex-task:<mode>`
   bullet and before the routing-validator-hook paragraph. Uses native field
   names (`configuredFallbackModels`, configured effort).
2. `skills/codex/local-team/SKILL.md`:
   - Inserted the 3-sentence codex retry-then-walk paragraph in
     `## Route Translation`, after the `codexDispatch` dispatch paragraph and
     before the "Preserve the configured logical route..." paragraph. Uses
     sanitized `codexDispatch.fallbackModels` / `.effort` / `.promptPath`.
   - Applied the line-46 replacement qualifying the `begin-step` design-review
     workaround as fallback-FREE only (mirrors codex local-board L269; cited
     by `cli.test.js` L1884-1919), with the one design-review-r2 correction:
     "per Route Translation below" (not "above" — Route Translation begins
     later in the file).
3. `SKILL.md` and `skills/codex/local-board/SKILL.md` — no changes (design
   confirmed both already document the full choreography).
4. `test/skill-usage-sync.test.js` — added one new content-assertion test,
   "all four skill texts document the pinned-retry-then-fallback-walk
   choreography". It extracts each file's Delegation-equivalent section
   (heading-scoped, honoring `### ` subheadings within a `## ` section, e.g.
   SKILL.md's paragraph lives inside `### Persisting Delegated Output`) and
   asserts, per audience: pinned-retry-once wording; ordered-walk
   ("in order" + "fallback"); actual-model evidence
   (`--model <fallbackModel>`, literal); effort carry-over (native vs
   `codexDispatch.effort` dialect); all three consultation names
   (`gate-check`, `specialty-run`, `design-review-check`); the exhaustion
   path (`approve-inline`, `questions`); and, codex files only, the
   never-`@codex-default` guard. No existing assertion in the suite was
   weakened.

No `sync-resources` needed — skills ship verbatim, not mirrored via
`plans/prompts`/`plans/templates` (confirmed by design; unaffected by
`test/resources-sync.test.js`).

Verification: `npm run check` — clean. `node --test` (full suite) — 572
tests, 571 pass, 1 skip (pre-existing `smoke (slow)` skip, unrelated to this
change).

No deviations from the r2 design.

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-11T20:00:53Z: Completed design via claude-subagent:local-board-designer@opus: Docs-only design: SKILL.md and codex local-board skill already document retry-then-walk (compliant as-is); insert 3-sentence native paragraph in SKILL_TEAM.md Execution profiles and sanitized codexDispatch variant in codex local-team Route Translation; no sync-resources needed (skills ship verbatim); optional new content assertion in skill-usage-sync.test.js.

- 2026-07-11T20:01:36Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: none (docs-only skill-text change)

- 2026-07-11T20:07:43Z: Design review r1 (codex-task:read-only@gpt-5.6-sol, xhigh): FAIL. 1) [High] insertion 2 contradicts skills/codex/local-team/SKILL.md line 46, which unconditionally says claude-subagent design review returns no codexDispatch block and directs begin-step instead; cli.test.js L1884-1919 proves fallback-configured Claude reviewers DO get fallbackModels+codexDispatch. Must also revise line 46 to qualify the begin-step workaround as fallback-free only (match codex local-board L269). 2) [Med] insertion 2 is 4 sentences vs the 1-3 requirement. 3) [Low] skill-usage-sync.test.js characterization incomplete (also checks usage surface, both design-review commands, non-empty parser). 4) [Low] optional prose-regex test wording-sensitive and misses actual-model/effort/consultation/codex-default elements. Looping design rework.

- 2026-07-11T20:11:30Z: Completed design via claude-subagent:local-board-designer@opus: Rework r2: added insertion 2b with exact line-46 replacement (fallback-free-only qualification, mirrors codex local-board L269, cited cli.test.js 1884-1919); insertion 2a trimmed to 3 sentences; skill-usage-sync characterization corrected to all five assertions; optional content assertion respecified with audience-partitioned per-element markers.

- 2026-07-11T20:13:49Z: Design review r2 (codex-task:read-only@gpt-5.6-sol, xhigh): CONCERNS. 1) [Low] insertion 2b line-46 replacement says walk the payload 'per Route Translation above' but Route Translation begins at line 79, below line 46 - change 'above' to 'below'. All four r1 findings resolved. Proceeding to implementation with the Low folded into the implement brief.

- 2026-07-11T20:13:49Z: Recorded design review via codex-task:read-only@gpt-5.6-sol: r2 CONCERNS: single Low (directional cross-ref above->below in insertion 2b); r1 High/Med/Low all resolved; proceed with Low carried to implementation

- 2026-07-11T20:13:50Z: Ensured git branch local-board/T20260710T2050Z-skills-document-the-pinned-retry-then-fallback-walk-choreography-in-all-four-delegation-texts (already-current).

- 2026-07-11T20:20:40Z: Completed implement via claude-subagent:local-board-implementer@sonnet: SKILL_TEAM.md +3-sentence retry-then-walk paragraph (Execution profiles); codex local-team SKILL.md +3-sentence Route Translation insertion + line-46 fallback-free-only replacement (with below correction); skill-usage-sync.test.js +1 test (6 native / 7 codex markers); SKILL.md + codex local-board untouched per design. npm run check clean; node --test 571/572 pass 1 pre-existing skip. Commit 725c68d.

- 2026-07-11T20:21:30Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: none (prose-only skill docs + content-assertion test)
