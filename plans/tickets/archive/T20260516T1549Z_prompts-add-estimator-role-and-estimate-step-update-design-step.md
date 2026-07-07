---
id: T20260516T1549Z
type: task
status: archived
priority: P2
parent: S20260516T1537Z
children: []
blockedBy: [T20260516T1545Z, T20260516T1546Z, T20260516T1547Z]
blocks: []
branch: feature/estimation-and-specialty-steps
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-05-16T15:49:46Z
updated: 2026-07-07T14:07:41Z
completedSteps: [design:claude-subagent:local-board-designer, implement:claude-subagent:local-board-implementer, review:codex-task:read-only, test:claude-subagent:local-board-tester, document:codex-task:workspace-write]
routingApprovals: []
---
# Prompts: add estimator role and estimate step; update design step

## Requirement

Port the estimator role and add the estimate step prompt. Depends on the estimate CLI (T20260516T1545Z), calibration suggest CLI (T20260516T1546Z), and config block (T20260516T1547Z).

Files to add:
- `plans/prompts/roles/estimator.md` — adapt from `task-board/prompts/estimator.md`. Drop the section-update contract. Keep relative-sizing principles, powers-of-2 guidance, and the bootstrap branch ("if calibration is `bootstrap`, size the ticket as if it were a 4 on the configured scale and note that this ticket will become the calibration anchor for its type").
- `plans/prompts/steps/estimate.md` — short step prompt that: reads the ticket, reads the calibration ticket body when basis is non-`bootstrap`, compares scope/complexity/risk/unknowns, outputs a single number on the configured scale, then calls `local-board estimate <id> <n> --basis <basis>`.

File to update:
- The existing `design` step prompt: append the calibration-then-estimator-then-estimate sequence as the final instruction. Reference both new prompts and both new CLI commands.

## Acceptance Criteria

- `plans/prompts/roles/estimator.md` exists, follows local-board prompt conventions, and includes the bootstrap branch.
- `plans/prompts/steps/estimate.md` exists and instructs: read ticket, read calibration if non-bootstrap, output a single point value on the configured scale, call `local-board estimate <id> <n> --basis <basis>`.
- The existing `design` step prompt instructs the agent to run `local-board calibration suggest`, the estimator role/prompt, and `local-board estimate` after writing the design.
- Prompts reference the configured scale and `splitThreshold` (flag for decomposition when estimate >= splitThreshold).
- No managed-section update contract appears in the estimator role (intentionally dropped per parent story).
- A grep/lint check (or equivalent existing prompt-presence test) confirms the new files exist and the design prompt references the new commands.

## Related Tickets

## Technical Design

### Summary

Add two new prompt files and append to one existing step prompt. No source or
config changes. This ticket completes the prompt-port half of the parent
story; T20260516T1554Z handles any orchestrator skill updates.

Three artifacts:

1. `plans/prompts/roles/estimator.md` (new) — trimmed port of
   `c:\Users\Nicho\Documents\task-board\prompts\estimator.md`.
2. `plans/prompts/steps/estimate.md` (new) — short step prompt that walks the
   agent from ticket read through `local-board estimate` call.
3. `plans/prompts/steps/design.md` (update) — append a final-step instruction
   pointing at calibration suggest, the estimator role, and the estimate
   step.

### Files / APIs inspected

- `c:\Users\Nicho\Documents\task-board\prompts\estimator.md` — source for the
  port. Section Update Contract and Git Policy sections are dropped per
  parent story decision.
- `plans/prompts/roles/implementer.md`, `plans/prompts/roles/code_reviewer.md`,
  `plans/prompts/steps/design.md`, `plans/prompts/steps/decompose.md`,
  `plans/prompts/steps/test.md`, `plans/prompts/steps/document.md`,
  `plans/prompts/steps/gate-check.md` — confirmed the local-board prompt
  house style: short, imperative, no preamble, no contracts beyond what the
  CLI needs.
- `plans/local-board.config.jsonc` — the live `estimation` block lists
  `enabled`, `scale: [1, 2, 4, 8]`, `bootstrapDefault: 4`,
  `splitThreshold: 16`.
- `plans/tickets/done/S20260516T1537Z_relative-sized-estimation-with-calibration-and-actuals.md`
  — parent story, especially the Prompts to port and Pipeline placement
  sections.
- `test/cli.test.js` — confirmed `node:fs/promises` `readFile` and
  `node:test` / `node:assert/strict` patterns; tests run from repo root so
  relative `plans/prompts/...` paths resolve cleanly.

### Approach

#### estimator.md (role)

Open with a one-line role declaration. Then the relative-sizing principles:

- Story points measure relative effort, not time.
- Compare scope, complexity, risk, unknowns against the calibration ticket.
- Prefer values on `config.estimation.scale` (powers of 2 by default). Pick
  interim values only when confident the work falls clearly between two
  scale steps; if reasoning lands between steps, snap to the nearest scale
  value rather than inventing one — `local-board estimate` rejects off-scale
  values.
- Flag for decomposition when the estimate meets or exceeds
  `config.estimation.splitThreshold`. Do not silently round down.

Add a Bootstrap branch: when the basis passed in is the literal string
`bootstrap`, size as if the ticket were a `config.estimation.bootstrapDefault`
on the scale (the seeded default is `4`). Note in the rationale that this
ticket will become a calibration anchor for future estimates of its type.

Explicitly omit the task-board Section Update Contract (managed sections do
not exist here) and the Git Policy section (orchestrator-level concern, not
a role concern in local-board).

#### estimate.md (step)

Short imperative step prompt. The agent runs it after the technical design
is written. Steps the prompt instructs:

1. Read the ticket file at the supplied path.
2. Run `local-board calibration suggest <ticket-id> --json` to obtain the
   basis ticket id (or the `bootstrap` sentinel).
3. If basis is a real ticket id, read that ticket file; otherwise apply the
   bootstrap branch.
4. Apply the estimator role guidance (`plans/prompts/roles/estimator.md`).
5. Pick a single point value from `config.estimation.scale`.
6. Run `local-board estimate <ticket-id> <points> --basis <basis>` to
   persist the estimate.
7. Report the chosen estimate and a one-line rationale that names the basis.

Keep the prompt CLI-name-stable so the test can grep for the two command
names.

#### design.md (append)

Append a final paragraph (not a new heading) along the lines of:

> After writing the Technical Design, run the estimate step
> (`plans/prompts/steps/estimate.md`) before completing the design action.
> When `config.estimation.enabled` is true, `complete-step design` refuses
> to close out tasks and bugs without an `estimate`; stories and epics are
> exempt.

The existing six-bullet body stays untouched. One added paragraph only —
keeps the diff tight and the prompt under ~20 lines.

### Risks and edge cases

- T20260516T1548Z reportedly already added the `complete-step design`
  enforcement gate. The design.md append must phrase the enforcement as
  current behaviour, not a forward promise.
- The basis sentinel is the literal string `bootstrap` (lowercase, no
  quotes). Both prompts must use that exact spelling; the estimate CLI from
  T20260516T1545Z stores it verbatim in `estimateBasis`.
- The estimator must not invent scale values. If reasoning lands between
  scale steps (e.g. 3 on a `[1,2,4,8]` scale), the prompt must instruct
  picking the nearest scale value, not the in-between number, otherwise
  `local-board estimate` will reject the call.
- `splitThreshold` of 16 is unreachable on a default `[1,2,4,8]` scale. The
  prompt should read `config.estimation.scale` and
  `config.estimation.splitThreshold` at run time and not hardcode either;
  the splitThreshold guidance still applies for users who extend the scale.
- The grep test must be tolerant of CRLF on Windows checkouts; use
  `assert.match` with a substring-style regex or `includes` on the raw
  string, not a `^...$` regex.
- The append to design.md must read naturally even if accidentally appended
  twice during iteration; do not add a guard, but keep the wording
  self-contained.

### Test plan

Per the brief, one new test in `test/cli.test.js`. It is a pure file-content
assertion — no `withBoard`, no CLI invocation, no temp directory. Suggested
shape:

```js
test("estimation prompts are present and reference the estimate pipeline", async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const roleText = await readFile(
    path.join(repoRoot, "plans", "prompts", "roles", "estimator.md"),
    "utf8",
  );
  assert.ok(roleText.trim().length > 0, "estimator role prompt is non-empty");
  assert.match(roleText, /bootstrap/, "estimator role mentions the bootstrap sentinel");

  const stepText = await readFile(
    path.join(repoRoot, "plans", "prompts", "steps", "estimate.md"),
    "utf8",
  );
  assert.ok(stepText.trim().length > 0, "estimate step prompt is non-empty");
  assert.match(stepText, /local-board calibration suggest/);
  assert.match(stepText, /local-board estimate/);
});
```

The test reads from the repo working tree because the prompts live under
`plans/`, not under temp boards. The seeded copy under
`src/seed/plans/prompts/` is out of scope for this ticket — the parent
story only names the live `plans/prompts/` paths.

Optional second assertion in the same test to literally close the AC about
the design prompt referencing the new commands:

```js
const designText = await readFile(
  path.join(repoRoot, "plans", "prompts", "steps", "design.md"),
  "utf8",
);
assert.match(designText, /local-board calibration suggest/);
assert.match(designText, /local-board estimate/);
```

Recommend including it — two cheap lines that close the AC literally.

### Documentation impact

None for `docs/` or `README.md`. The prompt files are themselves the
documentation. `memory-bank/systemPatterns.md` already references the
prompt directory layout; no update required unless the implementer notices
drift.

### Out of scope

- `src/`, `src/cli.js`, `src/config.js`, `src/tickets.js` — untouched.
- `plans/local-board.config.jsonc` — already carries the `estimation` block
  from T20260516T1547Z.
- `src/seed/plans/prompts/` — seed-copy sync is a separate concern; not
  named in the parent story acceptance criteria.
- Orchestrator skill updates — handled by T20260516T1554Z.

## Implementation Notes

Implemented the design: added plans/prompts/roles/estimator.md (trimmed port — dropped Section Update Contract and Git Policy, added Bootstrap mode section, preserved relative-sizing principles and split-threshold guidance referencing config.estimation.scale / splitThreshold). Added plans/prompts/steps/estimate.md as the 7-step CLI procedure (calibration suggest -> read basis -> apply role -> pick scale value -> local-board estimate -> report). Appended an "Estimate after design" section to plans/prompts/steps/design.md pointing at the new step and noting complete-step design enforcement. Added one test in test/cli.test.js asserting both prompt files exist, are non-empty, that the role mentions "bootstrap", and that the step references both "local-board calibration suggest" and "local-board estimate". npm test (98/98 pass), npm run check, and npm run validate all clean.

## Review Findings

**Verdict:** PASS.

Reviewer: codex-task:read-only (gpt-5.5). Static review.

- estimator.md preserves relative sizing (line 5), powers-of-2 guidance and scale snapping (line 15), split-threshold flagging (line 16). No section_update or Git Policy contracts present.
- Bootstrap mode section (line 7) references config.estimation.bootstrapDefault (line 9).
- estimate.md defines the 7-step flow (lines 6-12): read ticket, calibration suggest, read basis, apply role, choose scale value, local-board estimate, report rationale. Split recommendation at line 14.
- design.md original 6-bullet content preserved at lines 1-13; new Estimate-after-design section appended cleanly at lines 15-17.
- test/cli.test.js:987 adds prompt-surface test asserting non-empty files, bootstrap substring in estimator, and pipeline markers in estimate.

## Test Evidence

Verification by claude-subagent:local-board-tester on 2026-05-16.

Commands run from repo root on branch feature/estimation-and-specialty-steps (commit 9e6f4a6):

- `npm test` -> 98/98 pass, 0 fail, duration ~3.65s. Includes the new "estimation prompts are present and reference the estimate pipeline" test.
- `npm run check` -> clean (node --check passes on every src file).
- `npm run validate` -> "Ticket validation OK".

Prompt content review:

- `plans/prompts/roles/estimator.md` (17 lines): role declaration, relative-sizing principles (line 5), Bootstrap mode section (lines 7-9) referencing `config.estimation.bootstrapDefault` and naming this ticket as the calibration anchor, powers-of-2 guidance with off-scale snap rule (line 15), splitThreshold flagging (line 16). No Section Update Contract, no Git Policy section. Provides enough downstream context to size a ticket.
- `plans/prompts/steps/estimate.md` (14 lines): 7-step procedure - read ticket, call `local-board calibration suggest --json`, read basis if non-bootstrap, apply estimator role, pick value on `config.estimation.scale`, call `local-board estimate ... --basis ...`, report rationale. Split recommendation appended at line 14. Both CLI command names are present verbatim for grep checks.
- `plans/prompts/steps/design.md` (17 lines): original 6-bullet body preserved at lines 1-13. New "Estimate after design" section (lines 15-17) cleanly appended without breaking earlier content; phrases enforcement as current behaviour ("is enforced by local-board ... will refuse otherwise"), per the design risk note.

All acceptance criteria covered. No gaps or flakes observed. Test passed cleanly across 98 tests with no Windows CRLF issues.

## Documentation Updates

Updated in commit b994e08:

- memory-bank/systemPatterns.md - Role/Step Prompts section now lists plans/prompts/roles/estimator.md and plans/prompts/steps/estimate.md.
- docs/Workflow.md - Estimation section gained a Prompts subsection explaining how the estimator role and estimate step fit between Technical Design and complete-step design.
- README.md - layout listing updated to reflect the prompt additions.

Docs author: codex-task:workspace-write (gpt-5.5). Codex sandbox blocked .git writes; orchestrator committed.

## Questions

## Run Log

- 2026-05-16T23:22:36Z: Completed design via claude-subagent:local-board-designer: Design: port estimator role to plans/prompts/roles/estimator.md (trimmed: drops section_update contract, git policy; adds bootstrap branch using config.estimation.bootstrapDefault). New plans/prompts/steps/estimate.md with 7-step CLI flow (read ticket; calibration suggest; read basis; apply estimator role; pick scale value; local-board estimate; report). Append 1 paragraph to plans/prompts/steps/design.md. 1 test asserting prompt presence + content markers.

- 2026-05-16T23:22:36Z: Ensured git branch feature/estimation-and-specialty-steps (already-current).

- 2026-05-16T23:25:37Z: Completed implement via claude-subagent:local-board-implementer: Implemented in commit 9e6f4a6. New plans/prompts/roles/estimator.md (ported, trimmed, bootstrap section added). New plans/prompts/steps/estimate.md (7-step procedure). Appended 'Estimate after design' section to plans/prompts/steps/design.md. 1 new test asserts file presence and substring markers. npm test 98/98; check + validate clean.

- 2026-05-16T23:27:45Z: Completed review via codex-task:read-only: Codex review of commit 9e6f4a6. Verdict: PASS. estimator.md properly trimmed and preserves principles; Bootstrap mode added with config reference. estimate.md 7-step flow correct. design.md cleanly appended. Test asserts file presence and markers.

- 2026-05-16T23:29:08Z: Completed test via claude-subagent:local-board-tester: npm test 98/98; check + validate clean. estimator role prompt complete with bootstrap section. estimate step prompt is procedural and CLI-stable. design.md cleanly appended. Verdict: PASS.

- 2026-05-16T23:30:45Z: Completed document via codex-task:workspace-write: Doc updates in commit b994e08: memory-bank/systemPatterns.md (Role/Step Prompts list), docs/Workflow.md (Estimation Prompts subsection), README.md (repo layout).
