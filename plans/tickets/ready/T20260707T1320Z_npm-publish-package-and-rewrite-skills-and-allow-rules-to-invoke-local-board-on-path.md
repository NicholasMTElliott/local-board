---
id: T20260707T1320Z
type: task
status: ready_for_design
priority: P1
parent: null
children: []
blockedBy: [T20260707T1318Z, T20260707T1319Z]
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-07T13:20:26Z
updated: 2026-07-07T13:23:55Z
completedSteps: []
routingApprovals: []
---
# npm: publish package and rewrite skills and allow rules to invoke local-board on PATH

## Requirement

Publish the package to npm and make the PATH command the canonical invocation. `package.json` already declares `"bin": { "local-board": "./bin/local-board.js" }`, so `npm install -g local-board` yields a `local-board` command with Windows shims. This deletes the largest fragility class in the skill texts: all ~60 rendered `node <<SCRIPT_PATH>>` occurrences become a stable `local-board ...`, skill texts become byte-identical across machines, and the Claude allow rule becomes the constant `Bash(local-board *)` — no absolute paths, no quoting, no path-separator mismatch, no per-machine divergence.

Scope: rewrite SKILL.md, SKILL_TEAM.md, and both codex skill templates to invoke `local-board`; change the installer's allow rule to `Bash(local-board *)`; update agents/claude and agents/codex texts; skip the `~/.local-board` runtime copy when running from an npm install (keep it only for git-clone installs); document that npx is NOT supported (first-run npx needs network, which the Codex sandbox denies) — require a prior global install.

Depends on: T20260707T1318Z (files allowlist / resources split) and T20260707T1319Z (install subcommand).

Acceptance: after `npm install -g` and `local-board install`, a fresh Claude Code and Codex session can run the full workflow with no absolute paths in any skill text; version skew between CLI and skills is detectable (see T20260707T1321Z).

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
