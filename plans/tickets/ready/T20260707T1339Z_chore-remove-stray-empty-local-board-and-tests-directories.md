---
id: T20260707T1339Z
type: task
status: ready_for_implementation
priority: P4
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: 1
estimateBasis: bootstrap
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T13:39:06Z
updated: 2026-07-08T05:21:53Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
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

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-08T05:21:16Z: Completed design via claude-subagent:local-board-designer@opus: Micro-design: both dirs empty/untracked/unreferenced; rmdir, ticket is durable record; estimate 1 bootstrap

- 2026-07-08T05:21:53Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (filesystem cleanup)
