---
id: T20260712T1415Z
type: task
status: designing
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260712T1415Z-installer-automatic-semver-version-bump-and-content-hash-skew-detection
estimate: 4
estimateBasis: T20260710T1532Z
workStartedAt: null
workCompletedAt: null
created: 2026-07-12T14:15:09Z
updated: 2026-07-12T14:15:35Z
completedSteps: []
routingApprovals: []
---
# installer: automatic semver version bump and content-hash skew detection

## Requirement

From the 2026-07-12 install-process test: package.json has been pinned at 0.1.0 since scaffold, so the skills' version-skew advisory (compare installed-from version vs local-board --version) can never fire on this setup, and install-info.json carries no content fingerprint - a stale install is undetectable except by manually diffing artifacts. Meanwhile the installable payload changed materially across the last two run batches (skills, agents, prompts, hooks).

### Scope

1. Automatic semver version bump. Design decides the mechanism and mapping; candidates to evaluate: (a) bump wired into the merge/closeout flow (e.g. a bump script the orchestrator or a git hook runs when mainline advances with installable-content changes); (b) CI-driven bump via the existing .github/workflows/ci.yml; (c) npm version invoked by a release script. Semver mapping candidate: bug ticket merged -> patch, task/story -> minor, epic or an explicit breaking marker -> major - evaluate viability against the board's merge flow (merges are manual --no-ff by the orchestrator; commitPlanningOnTransition auto-commits are noise that must not trigger bumps). A plain patch-bump-per-installable-merge is an acceptable fallback if type-mapped semver proves brittle. The bump must be automatic in the normal workflow, not a manual release chore, and must not bump when nothing installable changed.
2. Content hash for skew detection. The installer computes a deterministic hash over the installed payload (the exact source set it copies: skills, agents, hooks, prompts, templates, src/bin runtime files), records it in install-info.json alongside version and installedAt. Add a CLI surface - install --status (or an extension of where --json; design decides) - that recomputes the hash from the current package source and reports current/installed version + hash and a clear skewed/current verdict. Exit code should distinguish skew (non-zero or a JSON field; design decides, but scriptable).
3. Skill advisory alignment: update the version-skew advisory paragraph in the skills (SKILL.md + codex mirror at minimum; all four if the team skills carry it) to mention the hash-based check as the reliable path. Skills/prompts are production artifacts: content-assertion + sync suites apply; plans/prompts edits need npm run sync-resources (skills ship verbatim, no mirror).
4. Tests: hash determinism (stable across runs; changes when any payload file changes; insensitive to line-ending/platform noise - decide and document CRLF handling since install copies can be checked out either way); bump logic unit tests (mapping, no-op when no installable diff); --status skew/current paths incl. missing install-info; existing installer tests extended if present (design enumerates the current install test surface).
5. Docs: README install section, docs/ page that covers install (CodexSupport.md or wherever install is documented - design locates), memory-bank/techContext.md.

### Acceptance criteria

- After a merge that changes installable content, either the version differs or (for unbumped dev checkouts) install --status reports skew; both version and contentHash appear in install-info.json.
- A fresh install followed by install --status reports current; touching any installed-payload source file flips it to skewed.
- Auto-commits of plans/tickets alone do not trigger a bump.
- npm run check and node --test pass.

### Non-goals

- No npm-registry publishing or release automation beyond the version field.
- No breaking changes to existing CLI commands or install layout; install-info.json gains keys only.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
