---
id: T20260710T2050Z
type: task
status: designing
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260710T2050Z-skills-document-the-pinned-retry-then-fallback-walk-choreography-in-all-four-delegation-texts
estimate: 2
estimateBasis: T20260710T1533Z
workStartedAt: null
workCompletedAt: null
created: 2026-07-10T20:50:02Z
updated: 2026-07-11T20:07:43Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
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

#### 2. `skills/codex/local-team/SKILL.md` (codex parallel; Codex parallel-orchestrator audience)

Anchor: `## Route Translation`, immediately **after the first paragraph (current
line 81)** that describes dispatching from the `codexDispatch` block, before the
`Preserve the configured logical route...` paragraph (current line 83). Uses the
codex field names (`codexDispatch.fallbackModels`, `codexDispatch.effort`,
`codexDispatch.promptPath`) and cross-references the single-ticket Codex skill's
authoritative subsection.

Proposed text (3 sentences + 1 cross-reference):

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
> `questions` path; never record `@codex-default` for an exhausted walk. See the
> Codex `local-board` skill's `### Fallback Model Walk` for the full contract
> (including the fallback-free `claude-subagent:` design-review limitation).

Both insertions are audience-correct: native field names + native
`complete-step`/`*-complete` recording for `SKILL_TEAM.md`; sanitized
`codexDispatch.*` fields + the "never `@codex-default`" guard for the codex
parallel skill.

#### 3-4. `SKILL.md` and `skills/codex/local-board/SKILL.md`

**No change recommended.** Both already document all five acceptance elements
(see audit above: `SKILL.md` line 373; codex single-ticket lines 87-93). Editing
them would be redundant and risks prose drift. If the reviewer insists on a
literal touch, the only defensible micro-edit is a clarifying clause, but it is
not needed to pass the "all four texts describe ..." acceptance test.

### Affected files

- `SKILL_TEAM.md` — one paragraph inserted (optional second bullet).
- `skills/codex/local-team/SKILL.md` — one paragraph inserted.
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

- `test/skill-usage-sync.test.js` — only extracts and compares the ` ```sh `
  block under the `## CLI Commands` heading of **two** files (`SKILL.md` and
  `skills/codex/local-board/SKILL.md`) for byte-identity and command-name parity.
  It does NOT read `SKILL_TEAM.md` or the codex parallel skill, and it does NOT
  read Delegation/Route-Translation prose. Our insertions touch none of those
  fenced blocks, so this suite is unaffected. (Brief note: the byte-identity check
  spans two copies, not four.)
- `test/cli.test.js` — the `fallbackModels` assertions (T20260710T1532Z, D5/D6/D7)
  assert CLI JSON behavior (`configuredFallbackModels`,
  `codexDispatch.fallbackModels`, stamp shape), not skill markdown. No change.
- `test/resources-sync.test.js` — mirrors prompts/templates only. No change.

Optional new assertion (the brief calls it "desirable"). Add a test in
`test/skill-usage-sync.test.js` (it already imports `readFile` and knows the
skill paths) that, for **all four** skill files, asserts the dispatch/Delegation
prose documents the retry-then-walk contract — e.g. each file matches
`/retry the pin(ned model)? once/i` AND mentions an ordered walk AND mentions
the `approve-inline`/`questions` exhaustion path. This pins the choreography
sentence against future drift across all four audiences (today only two files
carry it; after this ticket all four do). Keep the matcher tolerant of the two
prose dialects (native vs `codexDispatch.*`). Marked optional, not blocking
acceptance.

Acceptance verification commands (run at the end): `npm run check` and
`node --test` (full suite, per AGENTS.md, since agent/skill artifacts are
content-asserted). No `sync-resources` needed.

### Risks

- **Scope-accuracy risk (low):** the ticket names all four files, but two already
  satisfy acceptance. Editing them redundantly is the main way to introduce
  needless drift. Mitigation: leave the two single-ticket skills unchanged;
  document why (this design).
- **Prose-dialect risk (low):** an over-strict new content assertion could fail
  on the legitimate native-vs-codex wording difference. Mitigation: match on
  audience-agnostic phrases (retry once / ordered walk / approve-inline).
- **Fence-integrity risk (very low):** insertions are plain paragraphs outside any
  ` ```sh ` block; `skill-usage-sync` byte-identity is not at risk.

### Open questions

- Scope confirmation (non-blocking): design proceeds on the reading that
  `SKILL.md` and `skills/codex/local-board/SKILL.md` need no edit because they
  already describe the full choreography (line 373; lines 87-93). If the intent
  was instead to reword/relocate that existing prose in the single-ticket skills,
  say so; otherwise implementation touches only the two parallel skills.

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-11T20:00:53Z: Completed design via claude-subagent:local-board-designer@opus: Docs-only design: SKILL.md and codex local-board skill already document retry-then-walk (compliant as-is); insert 3-sentence native paragraph in SKILL_TEAM.md Execution profiles and sanitized codexDispatch variant in codex local-team Route Translation; no sync-resources needed (skills ship verbatim); optional new content assertion in skill-usage-sync.test.js.

- 2026-07-11T20:01:36Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: none (docs-only skill-text change)

- 2026-07-11T20:07:43Z: Design review r1 (codex-task:read-only@gpt-5.6-sol, xhigh): FAIL. 1) [High] insertion 2 contradicts skills/codex/local-team/SKILL.md line 46, which unconditionally says claude-subagent design review returns no codexDispatch block and directs begin-step instead; cli.test.js L1884-1919 proves fallback-configured Claude reviewers DO get fallbackModels+codexDispatch. Must also revise line 46 to qualify the begin-step workaround as fallback-free only (match codex local-board L269). 2) [Med] insertion 2 is 4 sentences vs the 1-3 requirement. 3) [Low] skill-usage-sync.test.js characterization incomplete (also checks usage surface, both design-review commands, non-empty parser). 4) [Low] optional prose-regex test wording-sensitive and misses actual-model/effort/consultation/codex-default elements. Looping design rework.
