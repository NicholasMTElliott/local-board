---
id: B20260707T1437Z
type: bug
status: ready_for_implementation
priority: P1
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: 2
estimateBasis: B20260707T1317Z
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T14:37:50Z
updated: 2026-07-07T14:41:37Z
completedSteps: ["design:claude-subagent:local-board-designer@opus"]
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

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-07T14:40:51Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): normalizeEol on both sides of content assertion only; file-list equality stays exact; sync script writes LF; renormalize guidance in comment. Estimate 2 (basis B20260707T1317Z). Live failure reproduced.
