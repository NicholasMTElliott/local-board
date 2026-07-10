---
id: T20260710T0035Z
type: task
status: ready_for_design
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260710T0035Z-validate-install-warn-when-config-routes-to-codex-task-but-codex-task-is-not-installed
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-10T00:35:52Z
updated: 2026-07-10T01:04:34Z
completedSteps: []
routingApprovals: []
---
# validate/install: warn when config routes to codex-task but codex-task is not installed

## Requirement

local-board never checks whether the codex-task skill or the `codex` CLI is actually available, yet the shipped default config routes `review` -> `codex-task:read-only` and `document` -> `codex-task:workspace-write` (src/config.js defaults and the init scaffold). On a machine without codex-task, the failure surfaces mid-workflow as strict-routing friction: every review/document step dead-ends into the approve-inline deviation path. Convert that silent gap into an up-front, actionable warning. Detection only — local-board must NOT take ownership of installing codex-task.

## Scope

Add codex-task availability detection to `validate` (and surface the same check in `install`):

1. **Trigger condition**: the resolved config routes at least one action (in `agents`, including per-entry `optionalSteps[].agent`) to a `codex-task:*` route.
2. **Detection probe** (best-effort, fail-open):
   - `codex` binary resolvable on PATH (the runtime prerequisite), and
   - a codex-task skill install present for at least one harness skills dir (e.g. `~/.claude/skills/codex-task/SKILL.md`), reusing the same home-resolution seam as `install` (`--home` must apply for tests).
3. **`validate` behavior**: emit a WARNING (not an error; exit code unchanged) naming the routed actions and the missing prerequisite(s), with a one-line remedy hint (install codex-task / `codex login`, or reroute the action). No new flags required; a `--quiet`-style suppression is out of scope.
4. **`install` behavior**: after a `claude`-target install, if the project config in cwd routes to `codex-task:*` and detection fails, print the same hint. Purely informational.
5. **Docs**: short note in docs/Install.md and docs/CodexSupport.md that codex-task is a peer install, detected not managed.

## Acceptance criteria

- `validate` on a board whose config has zero `codex-task:*` routes prints no codex-task warning, regardless of whether codex is installed.
- `validate` on a board routing `review` to `codex-task:read-only` with `codex` absent from PATH prints one warning naming `review` and the missing binary; exit code remains 0 when tickets are otherwise valid.
- Detection never hard-fails validate: probe errors (unreadable dirs, spawn failures) degrade to the warning or silence, never a crash.
- Tests cover: no-codex-routes silence, warning content, `--home`-scoped skill-dir detection, and PATH probe stubbing (no dependency on the real machine state, per the LOCAL_BOARD_INSTALL_REQUIRE_HOME testing conventions).
- `npm run check` and `node --test` pass.

## Non-goals

- No npm dependency on codex-task; no chained install (explicitly deferred - see 2026-07-09 discussion of the dependency-plus-chained-install alternative).
- No runtime gate in `begin-step`/`complete-step`; workflow behavior is unchanged.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
