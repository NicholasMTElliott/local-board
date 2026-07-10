---
id: B20260710T1532Z
type: bug
status: ready_for_docs
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/B20260710T1532Z-section-file-can-duplicate-the-section-heading-when-the-payload-carries-it
estimate: 2
estimateBasis: B20260708T0459Z
workStartedAt: 2026-07-10T15:40:30Z
workCompletedAt: null
created: 2026-07-10T15:32:22Z
updated: 2026-07-10T16:40:06Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "design-review:codex-task:read-only@gpt-5.6-sol", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", "review:codex-task:read-only@gpt-5.6-terra", "test:claude-subagent:local-board-tester@sonnet", gate:test:skipped-empty-catalog]
routingApprovals: []
---
# section --file can duplicate the section heading when the payload carries it

## Requirement

Retro item from the 2026-07-10 parallel run. Two independent implementer executors produced duplicate section headings when persisting ticket sections: T20260710T1220Z's fix pass reported "manually removed a duplicate ## Implementation Notes heading artifact left over from the section-insert", and T20260710T1222Z's implementer reported "two malformed local-board section --file invocations produced duplicate headers" requiring manual correction.

## Repro hypothesis (to be confirmed at design)

When the --file payload itself begins with the section heading (e.g. the file starts with "## Implementation Notes") and the target section already exists, the replace/insert logic can end up with the heading twice — once from the section boundary and once from the payload. A second suspected path: section insert when the ticket template already contains an empty heading of the same name.

## Scope

1. Reproduce precisely (both suspected paths; also probe a payload with a trailing heading of ANOTHER section name — boundary detection is fence-aware per systemPatterns, but heading-in-payload semantics are unspecified).
2. Fix src/tickets.js section replacement so the operation is idempotent with respect to the section heading: strip a leading duplicate heading from the payload (or reject payloads that start with any H2 heading, with an actionable message — design decides which contract).
3. Regression tests for each reproduced path.
4. One-line contract note in SKILL.md's section usage text if the accepted payload shape changes.

## Acceptance criteria

- The reproduced duplicate-heading scenarios produce a single heading after the fix; repeated identical section calls remain idempotent.
- validate flags any legacy ticket with a duplicated section heading (or design justifies why not).
- npm run check and node --test pass.

## Non-goals

- No change to comment/marker grammar or other section semantics.

## Acceptance Criteria

## Related Tickets

## Technical Design

Confirmed root cause and the chosen fix contract below. All source references are to the worktree copy of `src/tickets.js`.

### Confirmed repro

`section --file` flows: `commandSection` (`src/cli.js:917`) reads the file verbatim and calls `setTicketSection` (`src/tickets.js:1221`), which calls `replaceSection(ticket.body, section, text.trim())` (`src/tickets.js:1230`). `replaceSection` (`src/tickets.js:2753`) splices the payload between the located heading and the next `## ` boundary, prepending `\n\n${text}`. It never inspects the payload for a heading.

- Primary path (confirmed by reading `replaceSection`): a payload whose first non-blank line is the section's own `## Implementation Notes` yields, after splice, the real heading (kept in `before`) immediately followed by the payload's duplicate heading — two identical `## Implementation Notes` lines. This is the exact artifact both retro implementers hit.
- "Empty template heading" path: this is not a distinct mechanism. Sections always exist in the template; whether the target section is empty or already has content, the duplication is produced by the same splice. No separate fix needed.
- Trailing/embedded foreign `## ` probe (confirmed by grammar, not a heading collision): `locateSection` (`src/tickets.js:2666`) treats every unfenced `^## ` line as a real section boundary (`anySectionRe = /^## /`). A payload containing an unfenced `## Documentation Updates` (leading OR trailing) is silently promoted to a real section boundary on the next scan, splitting/relocating content. Fence-aware detection only protects `## ` lines that are inside a ``` / `~~~` fence; an unfenced one in a payload always corrupts structure.

Note on the grammar: `anySectionRe`/`SECTION_HEADING_RE` require exactly `## ` (two hashes + space). `### ` and deeper are NOT boundaries, so legitimate H3 subheadings inside a section body are safe and must remain accepted.

### Chosen contract: reject, do not strip

`setTicketSection` rejects any payload that contains an unfenced top-level `## ` heading line (anywhere, not only the first line), with an actionable error. It does not silently strip.

Justification:

1. Loudness prevents silent corruption. Both retro incidents were silent malformations that reached a commit and needed manual cleanup. A hard error at call time surfaces the mistake before any write, which is the outcome the ticket wants.
2. Completeness. Strip-leading only addresses the primary duplicate. It leaves the trailing/embedded foreign-`## ` corruption (probe 3) silently intact. A single "no unfenced `## ` in the payload" reject covers all three probed modes with one rule.
3. Consistency with the established grammar. `getSectionText` (`src/tickets.js:2744`) never returns the heading, so a correct read/round-trip payload never starts with `## `. The fence-aware boundary work (B20260707T1326Z) already made "fence any literal `## ` sample" the documented contract. Any unfenced `## ` in a payload is therefore always an error, never legitimate content.
4. Smallest, most reversible change; no ambiguity about which/how many headings to strip or how to reconcile a mismatched leading heading name.

Idempotency (acceptance criterion) holds either way, because `getSectionText` output already excludes the heading; a normal read-modify-write round trip never carries a `## ` line. Repeated identical valid calls remain byte-identical.

### Exact changes

1. Reject guard in `src/tickets.js`. Add a small pure helper, e.g. `assertPayloadHasNoSectionHeading(text)`, that scans the trimmed payload with the existing fence-aware `contentLines` walker (`src/tickets.js:1085`) and throws if any yielded line matches `/^## /`. Reusing `contentLines` guarantees the guard is fence-aware for free (fenced `## ` samples pass), and it inherits the same unbalanced-fence limitation as `locateSection` (acceptable, consistent). Call it from `setTicketSection` immediately before `replaceSection` at `src/tickets.js:1230` (operate on `text.trim()`). Placing it in the library layer, not `commandSection`, means the single chokepoint is unit-testable and covers any future programmatic caller; the only callers today are the CLI and tests. Error message, actionable and pointing at the escape hatch, for example: `section payload must not contain a Markdown "## " heading line; pass only the section body (local-board manages the heading). Fence any literal "## " sample lines.`

2. validate duplicate-heading check in `src/tickets.js`. In `validateTicketStructure` alongside the existing missing-section loop (`src/tickets.js:1864`), add a fence-aware pass (reuse `contentLines` + `SECTION_HEADING_RE`, `src/tickets.js:1122`) that counts `## ` heading occurrences and pushes an issue for any `STANDARD_SECTIONS` name that appears more than once, e.g. `${ticket.path}: duplicate ## ${name} section`. This is the "flag legacy tickets" decision below.

3. No CLI signature change. `commandSection` and the usage surface are unchanged, so the byte-identical `## CLI Commands` fenced block stays untouched and `test/skill-usage-sync.test.js` is unaffected.

### Should validate flag legacy duplicated headings? Yes.

The acceptance criteria ask for it, and it is cheap and false-positive-free:

- The reject guard only prevents NEW duplicates. Tickets already corrupted by the two retro incidents (or by any pre-fix `section` call) would remain silently broken; only validate catches those. The two are complementary: reject at write time, detect at validate time.
- Using the fence-aware `contentLines` walker means a fenced `## ` example in a body is not counted, so there are no false positives against legitimate fenced samples.
- Scope the check to duplicated `STANDARD_SECTIONS` headings (the ones that make `locateSection`/`getSectionText` silently ambiguous). Flagging every duplicated arbitrary H2 is a broader option but risks surprising a body that intentionally fences examples of non-standard names; standard-section duplicates are the concrete corruption class from the retro, so keep the check targeted.

### Test plan (add to `test/tickets.test.js`, existing `withBoard` style)

Reject-guard cases (assert `assert.rejects` with a message match, and assert the on-disk file is unchanged / still has exactly one heading):

1. Payload beginning with the section's own heading (`## Implementation Notes\n\nDone.` into Implementation Notes) is rejected — the primary retro repro.
2. Payload beginning with a foreign section heading (`## Test Evidence\n...` into Implementation Notes) is rejected.
3. Payload with a trailing foreign heading (`Real body.\n\n## Documentation Updates\nleak`) is rejected — probe 3.

Accept cases (guard must not over-reach):

4. Payload with a fenced heading-like line is still accepted and round-trips (complements existing fenced tests at `test/tickets.test.js:546`).
5. Payload containing an `### Subsection` H3 (unfenced) is accepted — the guard keys on `## ` only.
6. Idempotency: write valid content, read it back via `getSectionText`, write it again; assert one heading and byte-identical bodies across the two writes (acceptance criterion).

validate case:

7. Construct a ticket file with two `## Implementation Notes` headings (write the file directly, bypassing the guard), run `validate(await discover(root))`, and assert the `duplicate ## Implementation Notes section` issue is present. Confirm a normal board still validates clean (broadly covered already, e.g. `test/tickets.test.js:542`).

Then `npm run check` and `node --test`.

### Docs / SKILL / mirror impact

- Accepted payload shape changes (a `## ` heading in the payload is now rejected), so add a one-line contract note to the `section --file` prose. In `SKILL.md` this is the "Use `section --file` ..." paragraph (around `SKILL.md:409`); mirror the same sentence into the three sibling skill copies for parity: `skills/codex/local-board/SKILL.md` (around line 49), `SKILL_TEAM.md`, and `skills/codex/local-team/SKILL.md`. Suggested sentence: `The payload is the section body only — do not include the section's own "## Heading"; fence any literal "## " sample lines.`
- This note is prose, not part of the `## CLI Commands` fenced block, so the byte-identical constraint enforced by `test/skill-usage-sync.test.js` is not touched. No CLI command signature changes, so that fenced block needs no edit.
- Resources mirror sync (`test/resources-sync.test.js`) is triggered only by `plans/prompts` edits. This ticket changes none, so the mirror sync is not required. Confirmed not applicable.

### Risks

- A production caller that legitimately passes an unfenced `## ` body would now fail. Mitigation: only the CLI calls `setTicketSection`; grep of `plans/prompts` and existing tests shows every intended `## ` sample is already fenced. The reject message names fencing as the escape hatch. Low risk.
- The validate duplicate check runs on every ticket during `discover`; it is a single linear fence-aware pass per ticket (same cost class as the existing missing-section loop). Negligible.

### Open questions

None blocking. One deliberate scoping call recorded above: validate flags duplicates only among `STANDARD_SECTIONS` names, not arbitrary duplicated H2s.

## Implementation Notes

Implemented per design, with the confirmed function-name correction (validateTicketShape, not validateTicketStructure).

1. `src/tickets.js`: added `assertPayloadHasNoSectionHeading(text)`, a pure helper that walks the payload with the existing fence-aware `contentLines` generator and throws on any unfenced `## ` line (reusing `SECTION_HEADING_RE`). Called from `setTicketSection` on `text.trim()`, immediately before `replaceSection`. Error message: `section payload must not contain a Markdown "## " heading line; pass only the section body (local-board manages the heading). Fence any literal "## " sample lines.`
2. `src/tickets.js`: `validateTicketShape` (not `validateTicketStructure`) gained a fence-aware duplicate pass, right after the existing missing-section loop (~line 1864). It counts `## ` heading occurrences via `contentLines` + `SECTION_HEADING_RE`, scoped to `STANDARD_SECTIONS` names only, and pushes `${ticket.path}: duplicate ## ${name} section` for any count > 1.
3. `test/tickets.test.js`: added 7 tests covering the design's full test list — reject own-heading payload, reject foreign leading heading, reject trailing foreign heading, accept an unfenced H3 subheading, idempotent double round-trip for plain content, and a validate test that bypasses the guard (writes the corrupted file directly) to confirm the duplicate-heading issue is flagged. The "accept fenced heading-like line" case is already covered by the pre-existing parametrized fenced round-trip tests (test/tickets.test.js:546), which continue to pass unchanged under the new guard.
4. Prose contract note (`The payload is the section body only — do not include the section's own "## Heading"; fence any literal "## " sample lines.`) added to `SKILL.md`, `skills/codex/local-board/SKILL.md`, `SKILL_TEAM.md`, and `skills/codex/local-team/SKILL.md`. All four edits are outside any fenced `## CLI Commands` block; the `test/skill-usage-sync.test.js` byte-identity check (SKILL.md vs skills/codex/local-board/SKILL.md fenced blocks only) is unaffected. SKILL_TEAM.md and skills/codex/local-team/SKILL.md have no verbatim twin of the SKILL.md sentence, so the note was folded into their existing `section --file` mentions (a return-only-result bullet and an orchestrator-owned-state bullet respectively) rather than duplicating a standalone paragraph that doesn't exist in those files.

No deviations from the chosen contract (reject, not strip). No CLI signature change.

Test results: `npm run check` passes (all `node --check` syntax checks). `node --test` — 532 tests, 531 pass, 1 skipped (pre-existing slow smoke test, gated by `LOCAL_BOARD_SLOW_TESTS`), 0 fail.

Commit: 192d9b9 on branch `local-board/B20260710T1532Z-section-file-can-duplicate-the-section-heading-when-the-payload-carries-it`, files: SKILL.md, SKILL_TEAM.md, skills/codex/local-board/SKILL.md, skills/codex/local-team/SKILL.md, src/tickets.js, test/tickets.test.js.

## Review Findings

Verdict: changes_requested; target: implementation (codex-task:read-only, gpt-5.6-terra @ high, 2026-07-10, commit 192d9b9)

1. test/tickets.test.js:732 — the idempotent re-write test does not implement the design's byte-identical-body assertion. It checks extracted section text, heading count, and validation result, so it could pass even if a repeated valid rewrite changed whitespace or another body region. Fix: capture the ticket body after the first write and assert it equals the body after the second write.

Verified clean: reject guard fence-aware and H2-only with actionable message; duplicate-heading validation correctly in validateTicketShape, scoped to STANDARD_SECTIONS, fence-aware; rejection/fenced/H3/duplicate-validation test paths covered; skill notes outside CLI fences, single-ticket CLI blocks unchanged. Static review only (suite intentionally not run in review sandbox).

## Test Evidence

Verdict: pass (claude-subagent:local-board-tester@sonnet, 2026-07-10)

Full suite: npm run check clean; node --test 532 tests — 531 pass, 0 fail, 1 skip (pre-existing gated slow smoke test). Targeted: test/tickets.test.js + test/skill-usage-sync.test.js — 174 tests, 173 pass, 1 skip, 0 fail; all 6 new guard/idempotence tests and the validate duplicate-heading test pass.

Live CLI acceptance (throwaway probe ticket in worktree): payload starting with its own H2 heading refused with the actionable fencing message (exit 2); trailing foreign H2 refused (exit 2); fenced H2 sample plus unfenced H3 accepted with exactly one section heading in the file; identical repeated write succeeded with byte-identical body (only front-matter updated timestamp changed). Skill diffs vs mainline: one prose clause per skill file, all outside fenced blocks; CLI Commands fences byte-identical (skill-usage-sync green).

Hygiene note: the probe's CLI auto-commits (3 commits, probe file only) were verified probe-only and dropped by the orchestrator via git reset --hard a3cc73d; working tree clean at a3cc73d.

## Documentation Updates

Updated human-facing docs and agent context for the section --file payload contract:

- README, Workflow, and TicketFormat now state that section --file payloads are section bodies only, must omit the target H2 heading, and must fence literal top-level H2 sample lines.
- CodexSupport and PerStepOrchestration now carry the same body-only rule where return-only output is persisted with section --file.
- memory-bank/systemPatterns.md records the current section-write semantics for orchestrators and return-only subagents.

Verification:

- The requested node --test command was attempted but this sandbox blocked Node test-runner worker spawn with spawn EPERM before test code ran.
- node --test with test isolation disabled passed: 9 tests, 9 pass.
- Direct fallback execution also passed both test files: skill usage sync 5 of 5 pass, resources sync 4 of 4 pass.

Commit note: the documentation commit could not be created in this sandbox because Git needs to write the worktree index.lock under the main repository .git directory, which is outside the writable roots and failed with permission denied.

## Questions

## Run Log

- 2026-07-10T15:40:30Z: Ensured git branch local-board/B20260710T1532Z-section-file-can-duplicate-the-section-heading-when-the-payload-carries-it (already-current).

- 2026-07-10T15:48:27Z: Completed design via claude-subagent:local-board-designer@opus: Reject contract: setTicketSection refuses payloads containing an unfenced top-level H2 line, actionable message names fencing escape; validate flags legacy duplicated standard-section headings via fence-aware walker. Repro confirmed at replaceSection. Estimate 2pts basis B20260708T0459Z.

- 2026-07-10T15:50:18Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: none requested (internal CLI fix; no security/UI/UX triggers)

- 2026-07-10T15:54:01Z: Design review (codex-task:read-only gpt-5.6-sol@xhigh): CONCERNS. 1x Low: design cites validateTicketStructure; actual function is validateTicketShape (src/tickets.js:1784, missing-section loop ~1864). All other cited mechanics verified accurate. Disposition: proceed; implementer brief carries the corrected function name.

- 2026-07-10T15:54:02Z: Recorded design review via codex-task:read-only@gpt-5.6-sol: CONCERNS: 1 Low (validateTicketShape naming); proceed

- 2026-07-10T15:54:42Z: Ensured git branch local-board/B20260710T1532Z-section-file-can-duplicate-the-section-heading-when-the-payload-carries-it (already-current).

- 2026-07-10T16:02:29Z: Completed implement via claude-subagent:local-board-implementer@sonnet: assertPayloadHasNoSectionHeading guard in setTicketSection (fence-aware, H2-only); duplicate standard-heading check in validateTicketShape; 7 regression tests; 4-skill prose contract note outside CLI fence. Full suite 531 pass/0 fail/1 skip. Commit 192d9b9.

- 2026-07-10T16:03:16Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: none requested (internal CLI fix; security trigger explicitly excludes CLI parsing; no UI)

- 2026-07-10T16:13:43Z: Completed review via codex-task:read-only@gpt-5.6-terra: changes_requested target implementation: 1 finding - idempotence test lacks byte-identical-body assertion (test/tickets.test.js:732). Guard, validate pass, and skill notes verified clean.

- 2026-07-10T16:13:44Z: Invalidated downstream evidence on loop-back to ready_for_implementation: removed completedSteps [implement:claude-subagent:local-board-implementer@sonnet, gate:implement:claude-subagent:local-board-gatecheck@haiku, review:codex-task:read-only@gpt-5.6-terra].

- 2026-07-10T16:17:17Z: Fix pass for review finding: idempotent re-write test now asserts byte-for-byte body equality across identical writes (parseMarkdownTicket body, excludes updated timestamp). Commit 137620a; suite 531/0/1.

- 2026-07-10T16:17:17Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Review fix: byte-identical-body assertion added to idempotence test (137620a); full suite 531 pass/0 fail/1 skip. Original implementation 192d9b9 unchanged.

- 2026-07-10T16:17:58Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: none requested (re-run after loop-back; test-only fix, no new triggers)

- 2026-07-10T16:26:27Z: Focused re-review (terra@medium): pass. 137620a adds the byte-identical body assertion; no unrelated changes.

- 2026-07-10T16:26:27Z: Completed review via codex-task:read-only@gpt-5.6-terra: pass on focused re-review (terra@medium): byte-identical-body assertion verified in 137620a, no unrelated changes; prior full review (terra@high) verified guard, validate pass, and skill notes clean

- 2026-07-10T16:33:05Z: Completed test via claude-subagent:local-board-tester@sonnet: pass: full suite 531/0/1; targeted 173/0/1; live probe acceptance verified all four guard paths incl. idempotent byte-identical rewrite; probe auto-commits verified probe-only and dropped

- 2026-07-10T16:40:06Z: Docs stage exposed an operational defect: the new validate duplicate-heading check hard-fails ~40 legacy done/archived tickets on this board (exit 1), breaking every preflight/closeout validate once merged. Probe-board test could not see this. Design amendment (within the design's own 'or design justifies why not' latitude): enforce the duplicate check only for tickets whose status is not done/archived - immutable closed history must not force history rewrites; live tickets keep the hard guard. Looping back to implementation for the scoped fix.
