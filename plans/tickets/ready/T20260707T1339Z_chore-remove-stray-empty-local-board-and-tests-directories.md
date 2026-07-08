---
id: T20260707T1339Z
type: task
status: ready_for_docs
priority: P4
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260707T1339Z-chore-remove-stray-empty-local-board-and-tests-directories
estimate: 1
estimateBasis: bootstrap
workStartedAt: 2026-07-08T05:21:53Z
workCompletedAt: null
created: 2026-07-07T13:39:06Z
updated: 2026-07-08T11:48:47Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", review:codex-task:read-only, "test:claude-subagent:local-board-tester@sonnet", gate:test:skipped-empty-catalog, document:codex-task:workspace-write]
routingApprovals: []
---
# chore: remove stray empty local_board and tests directories

## Requirement

Stray empty directories `local_board/` and `tests/` exist at the repo root alongside the real `test/` directory. They are cruft from earlier layouts and confuse both humans and agents scanning the tree.

Fix: remove both directories (verify they are empty / contain nothing referenced first). Check `.gitignore`/`.gitattributes` and `package.json` scripts for any references.

Acceptance: directories gone; `npm run check` and `npm test` still pass.

## Acceptance Criteria

## Related Tickets

## Technical Design

Micro-design (P4 chore).

### Verified state
- `local_board/` and `tests/` at repo root are both **empty** (only `.`/`..`, mtime May 14 — scaffolding leftovers).
- Both are **untracked**: git does not track empty directories, so neither appears in `git ls-files` nor in `git status --porcelain --ignored`. They exist only on the working filesystem.
- **Unreferenced** by production code/config:
  - `local_board` appears only in ticket markdown (this ticket + a done ticket), never in `src/`, `test/`, `package.json`, or `.github/`.
  - The real test directory is `test/` (singular). The only `tests/` hit is a comment in `src/active-steps.js` (`"tests/tools that"`), not a path reference.
  - `.gitignore` does not reference either directory.

### Action
- Remove both empty directories from the working tree: `rmdir local_board tests` (or `rm -rf` — they are empty).
- No commit will contain the removal because the directories are untracked; `git status` is already clean and stays clean. **This ticket's evidence is the only durable record of the cleanup.**
- No code, config, or `.gitignore` edits required.

### Risk
- None. Directories are empty and untracked; trivially recreate-able if anything unexpectedly needs them (nothing does).

### Test plan
- One line: after removal, both dirs absent, `npm test` green, and no reference breaks (there are none to break).

## Implementation Notes

## Review Findings

Reviewed by codex-task:read-only (gpt-5.5).

No blocking findings.

- Both directories absent (`Test-Path` false for each); root listing shows only `test/` singular.
- No references outside plans/: `rg "local_board"` and root-anchored `tests/` searches clean; `src/active-steps.js:16` "tests/tools that" confirmed as prose, not a path.
- Untracked confirmed: `git log --all -- local_board tests` and `git ls-files` both empty.
- No CI/workflow/package.json/config expects or recreates the dirs; CI runs `npm run check`, `npm test`, `npm run validate` only.
- Caveat: read-only reviewer did not rerun npm test (covered at implement and test stages).

Verdict: pass

## Test Evidence

Verified by claude-subagent:local-board-tester (sonnet).

| Check | Result |
|---|---|
| `local_board/` absent from repo root | Pass |
| `tests/` absent from repo root | Pass |
| `test/` (singular) present and intact (16 files + helpers/) | Pass |
| `npm run check` | Pass |
| `npm test` | Pass — 385 total, 384 pass, 1 skipped, 0 fail |
| `npm run validate` | Pass — Ticket validation OK |
| Grep `local_board` outside plans/ | Pass — none |
| Grep root-anchored `tests/` outside plans/ | Pass — only the known prose comment at `src/active-steps.js:16` |

No gaps or flakes; working tree clean apart from the orchestrator-owned ticket file.

Result: pass

## Documentation Updates

Documented by codex-task:workspace-write (gpt-5.5). Audit only: no doc under docs/, README.md, or memory-bank/ mentions local_board/ or a root tests/ directory; no changes needed.

## Questions

## Run Log

- 2026-07-08T05:21:16Z: Completed design via claude-subagent:local-board-designer@opus: Micro-design: both dirs empty/untracked/unreferenced; rmdir, ticket is durable record; estimate 1 bootstrap

- 2026-07-08T05:21:53Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (filesystem cleanup)

- 2026-07-08T05:21:53Z: Ensured git branch local-board/T20260707T1339Z-chore-remove-stray-empty-local-board-and-tests-directories (created).

- 2026-07-08T05:23:13Z: Completed implement via claude-subagent:local-board-implementer@sonnet: rmdir local_board/ and tests/ (both verified empty first); no references break; 384 pass + 1 skip; untracked so no commit carries the removal

- 2026-07-08T05:23:40Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (filesystem cleanup)

- 2026-07-08T05:25:38Z: Completed review via codex-task:read-only: pass: dirs absent, untracked, unreferenced; no CI/config expectations; recorded post-move per evidence-invalidation ordering

- 2026-07-08T11:47:50Z: Completed test via claude-subagent:local-board-tester@sonnet: dirs absent, test/ intact, 384 pass + 1 skip, grep sweep clean

- 2026-07-08T11:48:47Z: Completed document via codex-task:workspace-write: doc audit: no references to removed dirs; no changes
