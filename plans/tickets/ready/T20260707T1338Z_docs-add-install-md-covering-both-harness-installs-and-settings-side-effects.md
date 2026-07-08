---
id: T20260707T1338Z
type: task
status: ready_for_docs
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260707T1338Z-docs-add-install-md-covering-both-harness-installs-and-settings-side-effects
estimate: 2
estimateBasis: T20260707T1337Z
workStartedAt: 2026-07-08T05:00:10Z
workCompletedAt: null
created: 2026-07-07T13:38:06Z
updated: 2026-07-08T05:18:49Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku", "implement:claude-subagent:local-board-implementer@sonnet", "gate:implement:claude-subagent:local-board-gatecheck@haiku", review:codex-task:read-only, "test:claude-subagent:local-board-tester@sonnet", gate:test:skipped-empty-catalog, document:codex-task:workspace-write]
routingApprovals: []
---
# docs: add Install.md covering both harness installs and settings side effects

## Requirement

The installer has no human-readable documentation. `install.mjs` (409 lines, multi-target) copies the runtime to `~/.local-board`, installs skills to five harness locations, installs seven agents to `~/.claude/agents/`, and patches `~/.claude/settings.json` with a permission allow rule — a consent-sensitive side effect documented nowhere outside memory-bank. Codex install is partially covered by `docs/CodexSupport.md`; the Claude side is not covered at all. AGENTS.md requires new docs pages to be added to the README Documentation Index.

Fix: add `docs/Install.md` covering all targets, what is written where, the settings.json permission side effect, uninstall, and (once available) the npm install story from T20260707T1320Z. Add it to the README Documentation Index.

Acceptance: docs/Install.md exists, is indexed in README, and accurately lists every path the installer touches per target.

## Acceptance Criteria

## Related Tickets

## Technical Design

Docs-only ticket. Add `docs/Install.md` documenting the real installer surface, index it in the README, and cross-reference `docs/CodexSupport.md`. No installer code changes. Installer bugs/gaps found during investigation are recorded as follow-up candidates, not fixed here.

### Verified installer inventory (source of truth: `src/install.js`)

`install.mjs` is a 10-line deprecated shim that forwards to `runInstall` in `src/install.js`. The canonical entrypoint is `local-board install`. The requirement's "five harness locations / seven agents" is stale — the real surface is **six targets**. Document the actual surface below.

**Targets** (`buildTargets`), with selection policy:

| id | Label | Skill dir | Team skill dir | settings.json? | Policy |
|---|---|---|---|---|---|
| `claude` | Claude Code | `~/.claude/skills/local-board` | `~/.claude/skills/local-team` | yes | default-on |
| `codex` | Codex | `~/.codex/skills/local-board` | `~/.codex/skills/local-team` | no | detect-only (`~/.codex`) |
| `opencode` | opencode | `~/.config/opencode/skills/local-board` | `~/.config/opencode/skills/local-team` | no | detect-only |
| `cline` | Cline | `~/.cline/skills/local-board` | `~/.cline/skills/local-team` | no | detect-only |
| `cursor` | Cursor | `~/.cursor/skills/local-board` | `~/.cursor/skills/local-team` | no | detect-only |
| `agents` | Agents (cross-harness) | `~/.agents/skills/local-board` | `~/.agents/skills/local-team` | no | explicit-only |

Selection resolution (`resolveTargets`): no flags → every default-on target plus any detect-only target whose `detectPath` exists (never explicit-only). `--all` → all six. `--target=a,b` → exactly those ids. `--no-<id>` → exclude. `agents` installs only when named explicitly. Codex uses its own templates under `skills/codex/`; the other targets render from repo-root `SKILL.md` / `SKILL_TEAM.md`.

**Runtime dir `~/.local-board/`** (written on every install, regardless of target). Contents copied from the package: `package.json`, `README.md`, `SKILL.md`, `SKILL_TEAM.md` (if present); directories `bin/`, `src/`, `agents/`, `skills/`, `hooks/`; `prompts/` (from `resources/prompts`), `templates/` (from `resources/templates`); and `install-info.json` (provenance: `installedAt`, `installDir`, `scriptPath`, `nodeVersion`, `version`, `skillName`, `teamSkillName`, `claudeAgents[]`). Per memory-bank, this copy exists "only for hooks + provenance"; Codex executor prompts resolve from `local-board where --json` `agentsDir`, not from here.

**Per-target skill dirs**: each selected target gets `skillDir` and `teamSkillDir`, rendered in place (`<<SCRIPT_PATH>>` and `<<VERSION>>` placeholders substituted). Legacy dirs (`local-board-orchestrator`, `local-board-team`) are deleted if present.

**Claude agents** (claude target only): `agents/claude/*.md` → `~/.claude/agents/`. The seven agents: `local-board-decomposer`, `local-board-designer`, `local-board-documenter`, `local-board-gatecheck`, `local-board-implementer`, `local-board-reviewer`, `local-board-tester`.

**settings.json side effects (claude target only — the consent-sensitive surface):**

1. **Always** (`patchSettings`): appends the permission allow rule **`Bash(local-board *)`** to `permissions.allow` in `~/.claude/settings.json` (idempotent; atomic tmp+rename write). This is a coarse grant — it pre-approves *every* local-board subcommand (including mutating ones: `move`, `complete-step`, `create`) for any Bash-capable agent or subagent in that Claude session. Per memory-bank, subagent frontmatter cannot scope Bash patterns, so the rule is session-wide by necessity. The doc must surface this prominently as a consent decision.
2. **`--hooks` (opt-in, off by default)** (`patchHooks`): adds four managed entries to `settings.hooks`, each `node "<~/.local-board/hooks/SCRIPT>"`:
   - `PreToolUse` matcher `Task|Agent` → `routing-validator.js`
   - `PreToolUse` matcher `Bash` → `evidence-gate.js`
   - `PreToolUse` matcher `Bash` → `approve-inline-consent.js`
   - `PostToolUse` matcher `Task|Agent` → `dispatch-ledger.js`

   `--no-hooks` removes exactly these managed entries (matched by script path, either quoting era) and prunes emptied groups; user-authored hooks are left untouched. A default install without `--hooks` prints a hint to enable them. Cross-reference `docs/EnforcementHooks.md` for hook semantics rather than duplicating.

**Uninstall — exists** (`local-board install --uninstall`, also `node install.mjs --uninstall`). Removes: `~/.local-board/`; every target's `skillDir`, `teamSkillDir`, and legacy dirs; the four managed hook entries from `settings.json`; and the seven `~/.claude/agents/local-board-*.md` files.

**Verified gap (follow-up candidate, not fixed here):** uninstall does **not** remove the `Bash(local-board *)` allow rule from `~/.claude/settings.json`. Install adds it; uninstall leaves it. The consent-sensitive grant persists after a full uninstall. `Install.md` must state this and give the manual-removal step (delete the `Bash(local-board *)` entry from `permissions.allow`). See follow-up candidates below.

**Prerequisites**: Node.js 20+; `local-board` must resolve on `PATH` before install (installer fails fast with mode-specific guidance — `npm install -g .` / `npm link` from a checkout, else `npm install -g local-board`). `npx local-board` is unsupported. Other useful commands: `local-board install --list-targets`, `local-board version`, `local-board where --json`.

### Outline: `docs/Install.md`

1. **Overview** — what the installer does (portable skills + agents + runtime copy), and the one-line consent warning that a default Claude install patches `~/.claude/settings.json`.
2. **Prerequisites** — Node 20+, package on `PATH`, PATH-check fail-fast behavior, `npx` unsupported.
3. **Install methods** — `npm install -g local-board` then `local-board install`; from a checkout (`npm install -g .` / `npm link`); deprecated `node install.mjs` and `node ./bin/local-board.js install` aliases; `--list-targets`, `--all`, `--target=`, `--no-<id>` flag reference.
4. **Targets and what is written** — the six-target table above; note default-on vs detect-only vs explicit-only.
5. **Paths written per target** — runtime `~/.local-board/` contents table; per-target skill/team-skill dirs table; Claude agents list. Legacy-dir cleanup note.
6. **settings.json side effects (consent-sensitive)** — called out as its own prominent section: the `Bash(local-board *)` allow rule, why it is coarse and session-wide, and the risk framing from memory-bank.
7. **Hooks (opt-in)** — `--hooks` / `--no-hooks`, the four hook entries table, cross-ref `docs/EnforcementHooks.md`.
8. **Uninstall / manual removal** — `--uninstall` and exactly what it removes; the explicit manual step to delete the `Bash(local-board *)` allow rule (uninstall leaves it); list all paths for manual cleanup.
9. **Per-harness notes** — short Claude section; short Codex section that cross-references `docs/CodexSupport.md` (do not duplicate route-translation/worktree content).
10. **Verification** — `local-board version`, `local-board where --json`, `local-board install --list-targets`.

### README changes

- Add a Documentation Index entry: `- [docs/Install.md](docs/Install.md) — installer targets, paths written per harness, the settings.json permission side effect, opt-in hooks, and uninstall/manual removal.`
- In the Quick start / install prose, add a pointer to `docs/Install.md` for the full path/consent inventory (keep the existing quick commands; do not remove them).

### Memory-bank

Optional, low-cost: add a one-line pointer in `techContext.md` next to the `src/install.js` fact noting `docs/Install.md` is the human-facing install reference. Not required for acceptance; include only if it fits the terse style. No new facts — the install facts already live in `systemPatterns.md`.

### Scope

Docs only: `docs/Install.md` (new), `README.md` Documentation Index + install pointer, optional one-line memory-bank pointer. **No installer code changes.** Optionally refresh the stale `node install.mjs --target=codex` invocation in `docs/CodexSupport.md` to `local-board install --target=codex` — decide during implementation; it is a doc-consistency nicety, not required by acceptance.

### Follow-up ticket candidates (found, not designed here)

1. **Uninstall leaves `Bash(local-board *)` behind** — install/uninstall are asymmetric; the consent-sensitive grant survives uninstall. Consider having `--uninstall` remove the managed allow rule (mirroring hook removal), or document permanently. Behavioral change → separate ticket.
2. **`docs/CodexSupport.md` uses the deprecated `node install.mjs` form** — minor doc drift; fold into this pass or a docs-cleanup ticket.

### Risks / edge cases

- Requirement text is stale (five locations / seven agents / Claude "not covered"). Design corrects to six targets and the real surface; implementer must follow this inventory, not the requirement prose.
- Path tables must use `~/` home-relative notation (installer uses `homedir()`); Windows users see `%USERPROFILE%\.local-board` etc. — note the home-relative convention once.
- Keep hook and Codex detail as cross-references to avoid doc duplication drift (existing tests enforce SKILL byte-sync; Install.md should not restate skill CLI blocks).

### Test / validation plan

Docs-only, so no unit tests. Validation: `npm run validate` (link/format checks if any), confirm `docs/Install.md` is linked from README Documentation Index (AGENTS.md requirement), and manually diff each documented path against `buildTargets`/`performInstall` in `src/install.js` so the table stays accurate. No production behavior to test.

### Documentation impact

This ticket *is* the documentation change. Acceptance: `docs/Install.md` exists, is indexed in README, and accurately lists every path the installer touches per target (all six), including the settings.json allow rule and the opt-in hooks.

## Implementation Notes

## Review Findings

Reviewed by codex-task:read-only (gpt-5.5) on the implement commit.

- [P3] `docs/Install.md:92` — the documented `install-info.json` field list omits `name: "local-board"`, which `src/install.js:272` writes. Add `name` to the generated-fields list.
- [P3] `docs/Install.md:110` and `docs/Install.md:186` — the legacy-dir cleanup wording implies it applies to all six targets, but `src/install.js:39-41` gives the Codex target empty `legacySkillDirs`/`legacyTeamSkillDirs` and uninstall removes only the configured arrays (`src/install.js:331-332`). Rephrase as "configured legacy dirs" or note Codex has none.

Checks that passed: six-target inventory, runtime copy list, seven agent files, exact allow-rule text, four hook entries, uninstall scope and the documented allow-rule gap, README index entry format, CodexSupport invocation form, consent-callout tone (prominent but factual), techContext edit terse.

Verdict: changes_requested

## Test Evidence

Verified by claude-subagent:local-board-tester (sonnet).

### Repo-level checks

| Command | Result |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS — 385 tests, 384 pass, 0 fail, 1 skipped |
| `npm run validate` | PASS — Ticket validation OK |

### Static accuracy audit (docs/Install.md vs src/install.js)

All matched exactly: six targets with skillDir/teamSkillDir/settingsPath/detectPath and selection policy (`buildTargets`); runtime copy list line-for-line (`performInstall`); seven agent filenames; allow-rule text `Bash(local-board *)` verbatim; four HOOK_SPECS entries in order; install-info.json fields including `name`; legacy-dir wording (codex has none, all others one each); uninstall scope and the documented allow-rule gap (`performUninstall` never calls `patchSettings`).

### Live probe (sandboxed HOME via runInstall test seam)

The CLI has no --home/--json on install, and `local-board` is not on PATH here, so the probe called the exported `runInstall()` with a scratchpad-only `home` and a hard sandbox assertion.

- Install (`--target=claude`): full recursive file-set under the sandbox matched the doc's runtime + claude-target tables completely — no undocumented paths, no missing documented paths. `settings.json` written was exactly `{"permissions":{"allow":["Bash(local-board *)"]}}`. install-info.json fields exactly as documented.
- Uninstall: removed runtime dir, both skill dirs, all 7 agent files; the allow rule REMAINED — matching the documented uninstall gap (follow-up B20260708T0459Z).
- Sandbox removed afterward.

### README / CodexSupport

- README line 43 inline pointer + Documentation Index entry (line 133) format-consistent with neighbors.
- `local-board install --target=codex` in CodexSupport.md matches `parseArgs` `--target=` handling.

### Incident (test-harness error, not a doc/code defect)

The tester's FIRST probe attempt passed `home: undefined` (unset env var) so `runInstall` fell through to the real `os.homedir()` and performed a real claude-target install. Runtime/agents/skills re-copies were verified byte-identical to the existing real install (no harm), but the broad allow rule `Bash(local-board *)` was genuinely ADDED to the real `C:\Users\Nicho\.claude\settings.json` (it was not present before; only a script-path-specific rule was). The orchestrator attempted to revert the single entry and was blocked by the permission system; the removal is left to the user (delete the one `"Bash(local-board *)"` line from `permissions.allow`). Incident is a live demonstration of the consent-sensitive side effect docs/Install.md warns about.

Result: pass

## Documentation Updates

Documented by codex-task:workspace-write (gpt-5.5).

- `docs/Install.md` — the ticket's main deliverable, written at the implement stage (six-target path tables, consent callout, hooks opt-in, uninstall + allow-rule gap).
- `memory-bank/systemPatterns.md` — install facts tightened: six targets, allow-rule management, hooks opt-in, uninstall gap tracked by B20260708T0459Z.
- `memory-bank/techContext.md` — terse current-state install constraints.
- `README.md` — Documentation Index entry + install pointer verified, no change needed.
- `docs/CodexSupport.md` — deprecated install.mjs invocation fixed at implement stage.

## Questions

## Run Log

- 2026-07-08T04:59:37Z: Completed design via claude-subagent:local-board-designer@opus: Verified install surface (src/install.js canonical, 6 targets, settings.json allow rule + hooks opt-in, uninstall exists but leaves allow rule); Install.md outline + README index; estimate 2 basis T1337

- 2026-07-08T05:00:09Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (docs-only design)

- 2026-07-08T05:00:10Z: Ensured git branch local-board/T20260707T1338Z-docs-add-install-md-covering-both-harness-installs-and-settings-side-effects (created).

- 2026-07-08T05:03:28Z: Completed implement via claude-subagent:local-board-implementer@sonnet: docs/Install.md created (all 6 targets, path tables verified against src/install.js, consent callout, uninstall gap); README indexed; CodexSupport invocation fixed; 384 pass + 1 skip

- 2026-07-08T05:04:14Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (Markdown only)

- 2026-07-08T05:06:54Z: Invalidated downstream evidence on loop-back to ready_for_implementation: removed completedSteps [implement:claude-subagent:local-board-implementer@sonnet, gate:implement:claude-subagent:local-board-gatecheck@haiku].

- 2026-07-08T05:06:54Z: Ensured git branch local-board/T20260707T1338Z-docs-add-install-md-covering-both-harness-installs-and-settings-side-effects (already-current).

- 2026-07-08T05:08:27Z: Completed implement via claude-subagent:local-board-implementer@sonnet: Rework: name field added to install-info list; legacy-dir wording accurate (codex has none); verified against src/install.js; 384 pass + 1 skip

- 2026-07-08T05:09:02Z: Gate consultation implement via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (Markdown rework)

- 2026-07-08T05:09:03Z: Completed review via codex-task:read-only: changes_requested (2x P3: install-info name field, legacy-dir wording); addressed in rework commit; recorded post-move per evidence-invalidation ordering

- 2026-07-08T05:16:35Z: Completed test via claude-subagent:local-board-tester@sonnet: 384 pass + 1 skip; static audit exact match; live sandboxed install+uninstall file-set matched doc completely; incident: accidental real-HOME install added allow rule, user removal pending

- 2026-07-08T05:18:49Z: Completed document via codex-task:workspace-write: memory-bank install facts tightened (systemPatterns, techContext); README verified; main doc shipped at implement
