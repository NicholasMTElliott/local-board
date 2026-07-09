---
id: T20260708T2211Z
type: task
status: done
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260708T2211Z-config-add-permission-consent-state-changes-to-the-security-audit-triggers
estimate: 1
estimateBasis: T20260708T2016Z
workStartedAt: 2026-07-09T00:44:52Z
workCompletedAt: 2026-07-09T01:18:22Z
created: 2026-07-08T22:10:44Z
updated: 2026-07-09T01:18:22Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", review:codex-task:read-only, "test:claude-subagent:local-board-tester@sonnet", gate:test:skipped-empty-catalog, document:codex-task:workspace-write]
routingApprovals: []
---
# config: add permission/consent state changes to the security_audit triggers

## Requirement

The `security_audit` specialty-step triggers ("Changes to auth code, input validation, external API calls, credential handling") are miscalibrated, demonstrated in production: the gate requested an audit for T20260708T2015Z's marker-flag parsing (harmless CLI string validation) but NOT for B20260708T0459Z (mutating `~/.claude/settings.json` permission grants — the most consent-sensitive surface in the project). "Input validation" over-matches on benign flag parsing; permission/consent state management is not in the trigger text at all.

Fix: reword the `security_audit` triggers in the specialty catalog (plans/local-board.config.jsonc, and the scaffold defaults in resources/ so new boards inherit it) to add "changes to permission grants, consent state, or settings files that gate tool execution (e.g. Claude settings.json allow rules, hooks entries)" and narrow the input-validation trigger to "validation of untrusted external input (network, file uploads, cross-trust-boundary data) — not internal CLI flag parsing".

## Acceptance Criteria

- Repo board catalog and the scaffold/resources default both carry the reworded triggers.
- The gate-check prompt/catalog wording change only — no gate-check machinery changes.
- resources drift test stays green (mirror updated in lockstep).
- A short note in docs (wherever the specialty catalog is documented) explains the trigger philosophy: match on consequence surface (what the change can grant or leak), not on technique keywords.

## Acceptance Criteria

## Related Tickets

## Technical Design

Docs-and-config-only change. Reword the `security_audit` specialty-step
`triggers` string so the gate-check haiku classifier fires on
permission/consent-state mutations (the B20260708T0459Z miss) and stops
over-firing on benign internal flag parsing (the T20260708T2015Z false
positive). No gate-check machinery, CLI, or routing code changes.

### Root-cause of the miscalibration

The current implement-stage trigger is:

> `Changes to auth code, input validation, external API calls, credential handling.`

Two defects:

- **"input validation" over-matches.** It reads as any string/argument
  validation, so the classifier fired `security_audit` on
  T20260708T2015Z's marker-flag parser (internal CLI strings, no trust
  boundary). The phrase names a *technique*, not a *consequence surface*.
- **No consent/permission surface at all.** Mutating
  `~/.claude/settings.json` permission grants (B20260708T0459Z) is the most
  consent-sensitive change in the project, yet nothing in the trigger text
  describes settings files that gate tool execution, allow rules, or hooks
  entries. The classifier had no noun to match on, so it stayed silent.

The fix follows one principle, recorded as the philosophy note below: the
trigger text must name the **consequence surface** — what the change can
grant, leak, or execute — using concrete nouns, not technique keywords.

### Exact new trigger wording

Replace the `security_audit` entry's `triggers` value with (single JSON
string, verbatim):

```
Changes to authentication/authorization code; permission grants, consent state, or settings files that gate tool execution (e.g. Claude settings.json allow rules, hooks entries, approved-command lists); credential, token, or secret handling; external API calls; validation of untrusted input crossing a trust boundary (network payloads, uploaded files, third-party responses) - not internal CLI flag or argument parsing.
```

Wording choices, tuned for a haiku pattern-matcher:

- Leads with concrete nouns the classifier can anchor on
  (`settings.json`, `allow rules`, `hooks entries`, `token`, `secret`).
- Narrows the old "input validation" clause to `untrusted input crossing a
  trust boundary` with three concrete examples, then adds an explicit
  negative carve-out: `- not internal CLI flag or argument parsing`. The
  negative clause is what suppresses the T2015 false positive.
- ASCII-only punctuation (`-` not an em dash, `e.g.` spelled out). Keeps the
  JSON string clean and avoids the CRLF/encoding traps the drift test guards.

### Files to change (two authoritative copies + one doc)

There is **no config file under `resources/`.** `resources/` mirrors only
`plans/prompts` and `plans/templates` (see `test/resources-sync.test.js`);
the trigger text is not in any prompt body. New boards inherit the catalog
from the blessed scaffold string `defaultConfigJsonc()` in `src/config.js`,
not from `resources/`. So "scaffold/resources copy" resolves to
`src/config.js`. The two authoritative copies are:

1. **`plans/local-board.config.jsonc`** (repo board's own catalog) —
   `optionalSteps.implement[0].triggers`, currently at line ~308.
2. **`src/config.js`** — the `defaultConfigJsonc()` template literal,
   `optionalSteps.implement[0].triggers`, currently at line ~938. This is
   what `local-board init` writes into every new board, so this is the
   "new boards inherit it" path.

   (Note: `DEFAULT_CONFIG` in the same file keeps `optionalSteps` all-empty
   by design — the ENOENT/deep-merge fallback — so it carries no trigger
   text and needs no edit.)

3. **`docs/specialty-steps.md`** — add the philosophy note (below) and one
   worked example in the existing "Trigger guidance" section.

Both copies must be edited to the identical string.

### Philosophy note (add to docs/specialty-steps.md)

Add a short subsection under "Trigger guidance" (before or after the example
list), verbatim:

> **Write triggers as consequence surfaces, not technique keywords.** A
> `triggers` string should name *what a change can grant, leak, or execute*
> — concrete nouns a classifier can match — not the coding technique
> involved. "Input validation" is a technique and over-fires on harmless
> internal parsing; "settings files that gate tool execution" and
> "validation of untrusted cross-trust-boundary input" are consequence
> surfaces that fire only when something can actually be granted or leaked.
> When a trigger both over-fires and misses (as `security_audit` did on
> internal flag parsing vs. `settings.json` permission grants), rewrite it
> around the surface and add an explicit negative carve-out for the benign
> look-alike.

Also add one row/bullet to the concrete-examples list, e.g.:

> - Change that mutates `~/.claude/settings.json` permission grants, allow
>   rules, or hooks entries: gate recommends `security_audit` at implement.

### Optional, recommended follow-up (out of the mandatory scope)

The audit prompt body `plans/prompts/optional-steps/impl/security_audit.md`
"Review Scope" list does not mention permission/consent state. Adding a
bullet there would make the audit actually inspect the surface the trigger
now fires on. This is **out of this ticket's docs-and-config scope** and is
called out only as a follow-up, because that prompt IS mirrored to
`resources/prompts/...`: editing it would require running
`npm run sync-resources` to keep `test/resources-sync.test.js` green. Do not
touch the prompt body under this ticket unless the orchestrator widens scope.

### Risks and edge cases

- **Two-copy drift.** The repo catalog and `defaultConfigJsonc()` are not
  cross-checked by any test, so they can silently diverge. Edit both in the
  same change; the guard test `defaultConfigJsonc matches DEFAULT_CONFIG`
  substitutes `optionalSteps` wholesale and will NOT catch a wording-only
  divergence between them. Reviewer should diff the two strings by eye.
- **Classifier regression risk is low but real.** Broadening the surface
  could re-introduce false positives on non-security settings edits. The
  negative carve-out and the "gate tool execution" qualifier keep it narrow;
  the design-stage `security_threat_model` trigger is intentionally left
  unchanged (see below) to limit blast radius.
- **Design-stage parallel.** B20260708T0459Z was a *design*-stage miss, and
  the design-stage `security_threat_model` trigger has the same
  technique-keyword shape. This ticket scopes to `security_audit` only (per
  Requirement). Recalibrating `security_threat_model` the same way is a
  sensible follow-up but is deliberately NOT done here. Flag for the
  orchestrator.
- **Encoding.** Keep the string ASCII to avoid tripping EOL/byte comparisons
  elsewhere; use `- not` rather than a Unicode dash.

### Test plan

- **No test asserts `security_audit` shipped trigger content**, so the
  reword breaks nothing. Verified:
  - `test/config.test.js:184` asserts only `design[0].triggers` matches
    `/Auth/` (that is `security_threat_model`, untouched).
  - `test/cli.test.js` lines ~1588/1595/1602 are a **self-owned synthetic
    fixture** the test writes itself; they do not assert against shipped
    config and need no update.
- **`test/resources-sync.test.js` stays green trivially** because
  `plans/prompts` and `plans/templates` are untouched (the triggers live in
  config, not in a prompt body).
- Run the full suite: `npm test`. Expect all green with only the two config
  edits and the doc edit.
- Manual smoke (optional): `node ./bin/local-board.js gate-check <id>
  --stage implement --json` on a scratch board seeded from
  `defaultConfigJsonc()` and confirm the reworded `security_audit` entry
  appears in the returned `catalog`.
- If a reviewer *chooses* to add a content assertion pinning the new
  permission-surface wording (e.g. `assert.match(implement[0].triggers,
  /settings\.json/)`), that is a welcome hardening but not required by the
  AC.

### Documentation impact

- `docs/specialty-steps.md`: philosophy note + one example (above). This is
  the only human-facing catalog doc; `SKILL.md` and the Codex skill do not
  quote the trigger text, so no lockstep skill-sync update is needed
  (verified: no `triggers` string in either SKILL file).
- No README Documentation Index change (no new doc file).

## Implementation Notes

## Review Findings

Reviewed by codex-task:read-only (gpt-5.5). No findings. Verified: both trigger copies byte-identical (420 UTF-8 bytes, parsed strings equal, JSONC parses); classifier-fit confirmed for both calibration cases (B0459 matches via permission grants / settings files / allow rules / hooks entries; T2015 excluded via the trust-boundary narrowing + explicit CLI flag-parsing carve-out); consent state bracketed by tool-execution context, not an over-match risk; docs additions accurate without overclaiming catalog-wide rewrite. Verdict: pass

## Test Evidence

Verified by claude-subagent:local-board-tester (sonnet), in the ticket worktree.

| Command | Result |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS — 416 tests, 415 pass, 0 fail, 1 skipped |
| `npm run validate` | PASS — Ticket validation OK |

- Byte-identity: `security_audit.triggers` extracted programmatically from `defaultConfigJsonc()` and from the parsed `plans/local-board.config.jsonc` — EQUAL: true.
- Scaffold propagation: fresh `init` on a throwaway scratchpad board carries the new trigger text verbatim (generated config line 352); cleaned up.
- Gate-check plumbing: `gate-check --stage implement --json` returns the new consequence-surface text in `catalog[0].triggers`.
- Docs: philosophy paragraph (specialty-steps.md:67) and settings.json example bullet (line 63) present; scoped as guidance + the one fixed entry, no catalog-wide overclaim.
- Calibration sanity: settings.json permission-grant mutation matches unambiguously ("permission grants, consent state, or settings files that gate tool execution (e.g. Claude settings.json allow rules, hooks entries, approved-command lists)"); internal CLI flag parsing is explicitly carved out ("- not internal CLI flag or argument parsing"). Both read cleanly for a small classifier.

No gaps.

Result: pass

## Documentation Updates

Documented by codex-task:workspace-write (gpt-5.5). Primary doc (specialty-steps.md philosophy + example) shipped at implement. Closing audit: memory-bank/systemPatterns.md gained one terse current-state line for the consequence-surface security_audit trigger; grep confirmed no doc or README quotes the old trigger text.

## Questions

## Run Log

- 2026-07-09T00:44:52Z: Ensured git branch local-board/T20260708T2211Z-config-add-permission-consent-state-changes-to-the-security-audit-triggers (already-current).

- 2026-07-09T00:51:22Z: Completed design via claude-subagent:local-board-designer@opus: Reword in plans config + src/config.js defaultConfigJsonc (no resources config copy exists); philosophy note in catalog doc; no trigger-content test breaks; security_threat_model recalibration flagged as follow-up; estimate 1 basis T2016

- 2026-07-09T00:51:22Z: Designer flagged: the design-stage security_threat_model trigger shares the technique-keyword shape and was the actual miss surface for B20260708T0459Z (its gate ran at design stage). Deliberately out of scope here; candidate follow-up ticket.

- 2026-07-09T00:53:30Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (config/docs text)

- 2026-07-09T00:53:31Z: Ensured git branch local-board/T20260708T2211Z-config-add-permission-consent-state-changes-to-the-security-audit-triggers (already-current).

- 2026-07-09T00:57:25Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Trigger reworded verbatim in plans config + defaultConfigJsonc; consequence-surface bullet + philosophy paragraph in specialty-steps doc; 415 pass + 1 skip

- 2026-07-09T00:58:42Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (text-only)

- 2026-07-09T01:06:18Z: Completed review via codex-task:read-only: pass, no findings; recorded post-move per evidence-invalidation ordering

- 2026-07-09T01:10:38Z: Completed test via claude-subagent:local-board-tester@sonnet: 415 pass + 1 skip; byte-identity EQUAL; scaffold init carries new text; gate-check payload verbatim; calibration both cases unambiguous

- 2026-07-09T01:18:22Z: Completed document via codex-task:workspace-write: systemPatterns line added; no stale trigger quotes in docs/README
