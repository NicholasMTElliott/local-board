---
id: T20260708T2212Z
type: task
status: backlog
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-08T22:10:45Z
updated: 2026-07-08T22:11:52Z
completedSteps: []
routingApprovals: []
---
# install: first-class sandbox seam (--home flag, fail-closed test seam)

## Requirement

Live installer tests currently sandbox via the programmatic `runInstall(args, { home })` seam, which fails OPEN: when `home` is undefined (e.g. an unset env var in a test harness), the installer silently falls through to the real `os.homedir()`. This caused a real incident (2026-07-08): a tester subagent's probe ran a genuine claude-target install against the user's actual home directory, adding the `Bash(local-board *)` allow rule to the real `~/.claude/settings.json` without consent. The current mitigation is prompt-level convention (assert the path contains "scratchpad"), which nothing enforces.

Fix, two layers:
1. CLI: add `local-board install --home <dir>` mapping to the existing seam, so probes can go through the public entrypoint instead of importing internals.
2. Fail closed under test: when `NODE_ENV=test` or a dedicated env guard (e.g. `LOCAL_BOARD_INSTALL_REQUIRE_HOME=1`) is set, `runInstall`/`runUninstall` REFUSE to operate on the real `os.homedir()` unless an explicit `--home`/options.home is supplied. Passing `{ home: undefined }` explicitly should be an error, not a fallback.

## Acceptance Criteria

- `install --home <dir> --target=claude` performs the full install under `<dir>`; `--home` with uninstall works symmetrically.
- With the guard env set and no home override, install/uninstall exit non-zero naming the guard; with an explicit home they proceed.
- `runInstall({ home: undefined, ... })` (key present, value undefined) throws rather than falling back to os.homedir().
- test/install.test.js migrates at least one probe to the CLI `--home` path; docs/Install.md documents the flag as the supported test/sandbox mechanism.
- Existing default behavior (no flag, no guard env) unchanged for real users.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
