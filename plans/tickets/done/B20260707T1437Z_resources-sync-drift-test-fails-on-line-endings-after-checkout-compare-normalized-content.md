---
id: B20260707T1437Z
type: bug
status: done
priority: P1
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/B20260707T1437Z-resources-sync-drift-test-fails-on-line-endings-after-checkout-compare-normalized-content
estimate: 2
estimateBasis: B20260707T1317Z
workStartedAt: 2026-07-07T14:41:38Z
workCompletedAt: 2026-07-07T14:53:11Z
created: 2026-07-07T14:37:50Z
updated: 2026-07-07T14:53:11Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "implement:claude-subagent:local-board-implementer@sonnet", review:codex-task:read-only, "test:claude-subagent:local-board-tester@sonnet", document:codex-task:workspace-write]
routingApprovals: []
---
# resources-sync drift test fails on line endings after checkout; compare normalized content

## Requirement

Regression introduced by T20260707T1318Z: `test/resources-sync.test.js` compares `plans/prompts|templates` against `resources/` byte-for-byte from the working tree. `.gitattributes` forces `* text=auto eol=lf`, but working-copy files only pick up normalization when (re)checked out. On the current Windows checkout the older `plans/` files still contain CRLF while the freshly checked-out `resources/` mirror is LF, so `npm test` fails 2/146 on mainline (confirmed 2026-07-07 after merge 4f99a37). Any contributor with a stale working copy hits the same flake; the branch was green only because the mirror files were fresh byte copies at the time.

Fix: make the drift comparison line-ending-insensitive — normalize `\r\n` to `\n` on both sides before comparing in `assertMirrored` (content check only; the file-list set equality stays exact). Optionally have `scripts/sync-resources.mjs` write LF-normalized output so fresh mirrors match the repo policy, and note `git add --renormalize` guidance for stale working copies in a comment. No behavior change to the packaged assets.

Acceptance: `npm test` passes on a working copy where `plans/` files are CRLF and `resources/` are LF (and vice versa); genuine content drift (a changed word) still fails; full suite green on mainline.

## Acceptance Criteria

## Related Tickets

## Technical Design

Small P1 test-robustness fix. The `resources-sync` mirror tests compare
`plans/{prompts,templates}` against `resources/` byte-for-byte from the working
tree. `.gitattributes` enforces `* text=auto eol=lf`, but working-copy files only
get normalized on (re)checkout. On the current mainline Windows checkout the older
`plans/` files still carry CRLF while the freshly checked-out `resources/` mirror
is LF, so the per-file content assertion fails. Confirmed live: `node --test
test/resources-sync.test.js` reports `pass 1 / fail 2` on
`resources/prompts/optional-steps/design/security_threat_model.md` and
`resources/templates/ticket.md`. Committed content is LF either way (git
normalizes on commit); the flake is purely a working-tree eol mismatch, so the
correct fix is to make the drift comparison line-ending-insensitive rather than to
touch any packaged asset.

### Related Tickets

- **T20260707T1318Z** (done) — introduced `scripts/sync-resources.mjs` and this
  byte-for-byte mirror test as part of the npm files-allowlist / resources move.
  Root cause of this regression.
- **B20260707T1318Z** (ready) — in flight; touches `moveTicket` cross-folder
  rename, unrelated files. No overlap; no coordination needed.

### Approach

Primary fix (required, sufficient for acceptance): normalize CRLF to LF on both
sides of the *content* comparison in `assertMirrored`, in
`test/resources-sync.test.js`. Add a tiny pure helper and apply it to both reads
before `assert.equal`:

```js
const normalizeEol = (s) => s.replace(/\r\n/g, "\n");
// ...
assert.equal(
  normalizeEol(targetContent),
  normalizeEol(sourceContent),
  `${path.join(targetDir, relativeFile)} content has drifted from `
    + `${path.join(sourceDir, relativeFile)}; run "npm run sync-resources"`,
);
```

The file-list set-equality assertion (`assert.deepEqual(targetFiles,
sourceFiles, ...)`) stays exact — eol has no effect on file names, and we still
want an added/removed/renamed file to fail loudly.

Secondary hardening (recommended, still tiny): have
`scripts/sync-resources.mjs` write LF-normalized output so a fresh mirror always
matches repo `eol=lf` policy even when generated from a stale CRLF `plans/`
working copy. All mirrored assets are text `.md`, so this is low risk. Replace the
`cpSync` byte copy with a small recursive walk that reads each file, applies
`replace(/\r\n/g, "\n")`, and writes LF. Add a one-line comment pointing stale
working copies at `git add --renormalize .` (or `git checkout -- plans resources`)
as the durable cure. If we prefer to keep this ticket strictly minimal, the
secondary change can be deferred — the test fix alone satisfies the acceptance
criteria — but doing both closes the loop between the mirror generator and the
mirror test under one eol policy.

Recommendation: ship both in this ticket; they are a few lines each and share the
same `normalizeEol` intent. Keep the helper duplicated per file rather than
introducing a shared util module — matches the project's small-surface style.

### Risks / Edge Cases

- **Masking real drift.** Normalizing only `\r\n` -> `\n` cannot hide a changed
  word, added/removed line, or trailing-newline difference — those still fail.
  Confirm with the drift test below. Do not additionally strip whitespace or
  collapse blank lines; that would erode genuine-drift detection.
- **Bare CR (old-Mac `\r`).** Not produced by git eol handling; out of scope. The
  `\r\n` -> `\n` order is safe (no lone `\r` introduced). Handling bare `\r` is
  unnecessary and would slightly widen tolerance — leave it out.
- **sync-resources normalization touching non-text.** `plans/{prompts,templates}`
  are all `.md` today. If the walk is added, either normalize unconditionally
  (safe for current tree) or guard to text extensions to future-proof against a
  binary asset landing in these dirs. No binaries exist there now.
- **No packaged-behavior change.** Committed `resources/` bytes are already LF via
  `.gitattributes`; install/runtime output is unchanged. This is a test + build
  robustness change only.

### Test Strategy

Prove both directions:

1. **CRLF/LF mismatch passes (the live repro).** Current mainline working copy
   already has CRLF `plans/` vs LF `resources/`. After the fix, `node --test
   test/resources-sync.test.js` goes `pass 3 / fail 0` and `npm test` returns to
   146/146. This is the primary acceptance proof and needs no synthetic setup.
2. **Genuine drift still fails.** Temporarily change one word in a
   `resources/*.md` file (not committed) and confirm the content assertion fails
   with the "content has drifted" message; revert. This demonstrates the
   normalization did not blunt real drift detection.
3. **Optional regression guard.** If we want an automated proof independent of the
   working-copy state, export `normalizeEol` and add a focused unit test:
   `normalizeEol("a\r\nb") === "a\nb"` and `normalizeEol("a\nb") === "a\nb"`.
   Cheap, deterministic, documents intent. A fuller variant (temp dirs with CRLF
   vs LF identical content asserting `assertMirrored` resolves, then drifted
   content asserting it rejects) is possible but requires exporting
   `assertMirrored`; recommend the pure-helper unit test as the tiny option.

Regression command: `npm test` (full 146-test suite) must be green on mainline
after the change.

### Documentation Updates

None required. Optionally, the `git add --renormalize .` guidance lives as an
inline comment in `sync-resources.mjs` (and/or beside the test helper) rather than
in `docs/` or `memory-bank/`, since it is a contributor-hygiene note, not a
project-state fact.

### Open Questions

1. Include the secondary `sync-resources.mjs` LF-normalization in this ticket, or
   defer it and keep the change to the test only? (Design recommends including
   it.)
2. Add the exported-helper unit test as a permanent regression guard, or rely on
   the live-repro `npm test` pass as sufficient proof?

## Implementation Notes

Implemented per Technical Design, both primary and secondary changes.

**test/resources-sync.test.js**
- Added exported `normalizeEol = (s) => s.replace(/\r\n/g, "\n")` with a comment
  explaining the working-copy eol-drift rationale and pointing stale copies at
  `git add --renormalize .`.
- Applied `normalizeEol` to both sides of the per-file content `assert.equal` in
  `assertMirrored`. The file-list `assert.deepEqual` (set equality) is untouched
  — still exact.
- Added a small unit test: `normalizeEol("a\r\nb") === "a\nb"` and
  `normalizeEol("a\nb") === "a\nb"` (regression guard per design's optional
  Test Strategy item 3).

**scripts/sync-resources.mjs**
- Replaced the `cpSync` byte copy with a recursive `copyNormalized` walk that
  reads each file as utf8, replaces `\r\n` with `\n`, and writes it back, so a
  freshly generated mirror always matches the repo's `eol=lf` policy regardless
  of the source working copy's line endings.
- Added a comment above the walk with the same `git add --renormalize .`
  guidance for persistently mismatched working copies.

**Verification**
- `npm run check`: clean, no syntax errors.
- `npm test`: 143/143 pass, 0 fail (was failing 2 before the fix, confirmed live
  via `node --test test/resources-sync.test.js` going from `pass 1 / fail 2` to
  `pass 4 / fail 0` — the file gained one test, the new `normalizeEol` unit
  test).
- `npm run validate`: `Ticket validation OK`.
- `npm run sync-resources`: regenerated resources/prompts and resources/templates;
  `git status --porcelain plans/ resources/` showed zero diff in those trees
  afterward, confirming the LF-normalized writer output is byte-identical to
  what's committed (no drift introduced).

**Perturbation probe (drift-detection still works)**
- Changed `id: TYYYYMMDDTHHMMZ` to `id: TYYYYMMDDTHHMMZDRIFTPROBE` in
  `resources/templates/ticket.md` only (not `plans/templates/ticket.md`).
- Re-ran `node --test test/resources-sync.test.js`: 1 of 4 tests failed
  (`resources/templates mirrors plans/templates byte-for-byte`) with the
  expected "content has drifted" assertion message and a word-level diff
  showing the injected difference. Confirms normalizeEol only tolerates eol
  differences, not genuine content changes.
- Restored via `git checkout -- resources/templates/ticket.md`;
  `git status --porcelain resources/` showed no diff (exact restore).
- Re-ran both the single test file and the full suite: 4/4 and 143/143 pass, 0
  fail — back to green.

**Deviations from design**
- None on the required primary fix or the recommended secondary hardening.
  Both were included per the design's recommendation ("ship both in this
  ticket").
- Included the optional exported-helper unit test (design's Test Strategy item
  3) since it was cheap and deterministic, as the design suggested.
- Did not touch the file-list set-equality assertion, `plans/`, or `resources/`
  content, matching the design's explicit constraint.

## Review Findings

Reviewed by codex-task:read-only (gpt-5.5) against commit 70924c1.

No blocking findings.

Non-blocking observations:
- test/resources-sync.test.js:58,62 still name the mirror assertions "byte-for-byte" while :50 normalizes CRLF/LF before comparing — names overstate the assertion; rename during a later pass.
- scripts/sync-resources.mjs:20,35 assume text-only assets (UTF-8 read + CRLF replace). All mirrored assets are .md today and .gitattributes enforces LF; a future binary asset in those trees would be corrupted — extension/content guard needed before allowing binaries.
- Test gap: normalizeEol unit test covers CRLF->LF and LF-unchanged but not lone \r or an automated negative drift fixture (the changed-word probe was manual).

Correctness: file-list set equality stays exact (:39); normalization applies to content comparison only (:50). A CRLF-only difference is now invisible — acceptable under repo policy (.gitattributes text=auto eol=lf makes such differences checkout noise, not packaged content).
Recursive copy: nested dirs handled, empty dirs recreated, special entries ignored, Node path/fs APIs only — Windows-safe.
Scope: no material creep; sync LF writer and comments were in the design.
Verification caveat: reviewer ran the test file in-process (4/4) since the sandbox blocks child-process spawn.

Verdict: pass

## Test Evidence

Tested by claude-subagent:local-board-tester (sonnet) on branch local-board/B20260707T1437Z-..., commit 70924c1.

**Precondition verified (read-only byte check):** plans/templates/ticket.md contains CR bytes (true), resources/templates/ticket.md does not (false) — the exact regression state is live on this working copy.

**Suite:** `npm run check` pass; `npm test` 143/143 pass, 0 fail; `npm run validate` OK. Re-ran the full suite after probes: identical 143/143 — green and stable on a CRLF/LF-mismatched working copy (the primary acceptance).

**Independent drift probe:** perturbed one word in resources/templates/ticket.md -> exactly one test failed (`resources/templates mirrors plans/templates`, "content has drifted" with word diff); all other tests unaffected; restored via git checkout -- (status clean); back to 4/4 and 143/143.

**Line-ending-only reasoning (no writes):** normalizeEol at test/resources-sync.test.js:34 (`\r\n` -> `\n` only) is applied to both sides at :50-53; file-list equality at :39 operates on names only. The live green suite on the mismatched working copy is the empirical proof of this path.

**Gaps / caveats:**
- The vice-versa direction (LF plans/ vs CRLF resources/) proven by symmetry, not a live probe — matches the ticket's own test strategy.
- Reviewer's non-blocking notes stand: "byte-for-byte" test names overstate, no lone-\r coverage, negative-drift check is manual. None block acceptance.

Result: pass

## Documentation Updates

Documented by codex-task:workspace-write (gpt-5.5).

- `memory-bank/techContext.md` — clarified that `sync-resources` writes LF output and the mirror drift comparison is line-ending-insensitive, so CRLF working-copy state cannot mislead maintainers investigating drift.
- No docs/ or README changes needed (no entry points changed; test-tooling fix).

## Questions

## Run Log

- 2026-07-07T14:40:51Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): normalizeEol on both sides of content assertion only; file-list equality stays exact; sync script writes LF; renormalize guidance in comment. Estimate 2 (basis B20260707T1317Z). Live failure reproduced.

- 2026-07-07T14:41:38Z: Ensured git branch local-board/B20260707T1437Z-resources-sync-drift-test-fails-on-line-endings-after-checkout-compare-normalized-content (created).

- 2026-07-07T14:45:39Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Implementer (sonnet): normalizeEol both sides of content assertion, LF-writing sync script, renormalize guidance, unit test; suite 143/143 green from 2 failures; perturbation probe confirmed real drift still fails.

- 2026-07-07T14:48:40Z: Completed review via codex-task:read-only: Codex (gpt-5.5, read-only) verdict pass: normalization scoped to content comparison only, file-list equality exact, sync walk Windows-safe; three non-blocking observations (assertion naming, binary-asset guard, lone-CR coverage) recorded.

- 2026-07-07T14:51:37Z: Completed test via claude-subagent:local-board-tester@sonnet: Tester (sonnet): 143/143 green on a live CRLF/LF-mismatched working copy (precondition byte-verified); drift probe failed exactly one test then restored clean. Result: pass.

- 2026-07-07T14:53:11Z: Completed document via codex-task:workspace-write: Codex (workspace-write): techContext clarified LF-writing sync + eol-insensitive comparison; no docs/README changes needed.
