---
id: T20260707T1323Z
type: task
status: implementing
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260707T1323Z-npm-evaluate-claude-code-plugin-packaging-for-skills-agents-and-hooks
estimate: 2
estimateBasis: T20260707T1331Z
workStartedAt: 2026-07-08T00:22:34Z
workCompletedAt: null
created: 2026-07-07T13:23:26Z
updated: 2026-07-08T00:24:32Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
routingApprovals: []
---
# npm: evaluate Claude Code plugin packaging for skills, agents, and hooks

## Requirement

Claude Code plugins can bundle skills, agents, hooks, MCP servers, and default settings in one installable unit (git repo, zip archive, marketplace, or local path — npm is not a documented plugin source). This could replace the Claude-side portion of the custom installer entirely and is the natural delivery vehicle for the enforcement hooks (T20260707T1326Z): plugin hooks ship and update atomically with the skills they guard.

Scope: evaluate packaging `skills/` (Claude variants), `agents/claude/`, and the enforcement hooks as a plugin; determine precedence interactions with existing `~/.claude/skills` installs (plugin assets rank below user/project dirs — the installer must not leave stale user-dir copies shadowing plugin copies); decide whether the plugin lives in this repo or a sibling; note that plugin subagents ignore frontmatter `hooks`/`mcpServers`/`permissionMode`.

End-state to evaluate: npm for the CLI, plugin for Claude harness assets, `local-board install` only for Codex/opencode/cline/cursor.

Acceptance: a written decision (docs/) with a spike branch or a rejection rationale.

## Acceptance Criteria

## Related Tickets

## Technical Design

This is an **evaluation** ticket. Acceptance is a written decision under `docs/`
with either a spike branch or a rejection rationale. The design below *is* the
decision; the implement stage writes the doc and README index line and does not
change production code.

## Decision

**Document the plugin path as deliberate future work; keep `local-board install`
canonical for the Claude side now. Do not adopt a plugin at v0.1.0, and do not
open a spike branch yet.** This is a *defer-with-a-concrete-plan* outcome, not a
flat rejection: the plugin layout, migration hazards, and revisit triggers are
recorded so a future adopt is a small, informed step rather than a fresh
investigation.

## Rationale

- **npm is not a plugin source.** Claude Code installs plugins from marketplace,
  git repo, zip (`--plugin-url`), or local path (`--plugin-dir`) — never npm. The
  CLI already ships via npm (`npm install -g local-board`) and the skills/agents
  render an on-`PATH` `local-board` invocation (tickets T20260707T1319Z/1320Z).
  Adopting a plugin therefore adds a *second, differently-sourced distribution
  channel* to maintain in parallel with the npm package, not a replacement for
  it. Two release surfaces at v0.1.0, right after the installer was consolidated,
  is net complexity, not simplification.

- **Precedence footgun is real and load-bearing.** Plugin-delivered skills/agents
  rank **below** user-dir (`~/.claude/skills`, `~/.claude/agents`) and project-dir
  copies. Every current user has installer-written copies in exactly those
  user dirs. Shipping a plugin without first removing those copies means the stale
  user-dir skill *shadows* the plugin skill — the plugin silently does nothing, or
  worse serves an older skill after a plugin update. A correct adopt requires a
  migration path (installer learns a "plugin mode" that deletes its own user-dir
  skills/agents and stops writing them), which is more work than the plugin
  bundling itself. That migration is only worth building once the plugin channel
  is committed to.

- **Hooks: atomic delivery is attractive but the parallel-shape cost is low right
  now.** A plugin's `hooks/hooks.json` would ship the four enforcement hooks
  (T20260707T1326Z) atomically with the skills they guard and remove the need to
  patch `~/.claude/settings.json` (`patchHooks`). That is the strongest single
  argument for a plugin. But the hooks just landed, are opt-in, and the hook
  API + subagent tool naming (`Task|Agent`) are explicitly treated as a moving
  integration surface (see docs/EnforcementHooks.md). Freezing that shape into a
  second `hooks.json` artifact now, while it is still churning, doubles the
  maintenance of an unstable contract. `patchHooks` is already idempotent,
  script-path-matched, and reversible (`--no-hooks`/`--uninstall`); it is not a
  pain point that justifies the plugin today.

- **Plugin subagents ignore frontmatter `hooks`/`mcpServers`/`permissionMode`.**
  local-board's agents in `agents/claude/` rely only on `model`/`tools`
  frontmatter (respected), so agents *could* move cleanly. But the enforcement
  design deliberately uses **settings-level** hooks, not per-agent frontmatter
  hooks, so this restriction is neutral for us — it neither blocks nor motivates a
  move.

- **Do not put the CLI in plugin `bin/`.** A plugin can expose `bin/` executables
  on PATH, so in principle the plugin could carry the CLI. Reject this: it would
  duplicate the npm distribution, fork version/update semantics, and break the
  clean "npm owns the command, skills invoke it on PATH" invariant the recent npm
  tickets established. The CLI stays npm-only.

- **Marketplace discoverability is a genuine but premature upside.** It matters
  once the project wants distribution reach. At v0.1.0 "Early MVP kernel" it does
  not outweigh a second channel plus a migration.

Net: the plugin's real wins (atomic hook delivery, discoverability) are either
premature or cheaply matched by the existing installer, while its costs (second
channel, precedence migration, parallel unstable hook shape) land immediately.
Defer, but record the plan so the revisit is cheap.

## Approach (implement-stage deliverable)

Docs-only. No production source changes, no `settings.json` behavior change, no
new installer flag.

1. **Create `docs/PluginPackaging.md`** containing:
   - **Decision** — one-paragraph statement matching this section: installer
     canonical now, plugin deferred, no spike branch.
   - **Rationale** — condensed from the bullets above (npm-not-a-source second
     channel; precedence/shadowing; unstable hook surface; CLI stays npm).
   - **Layout sketch** — what a future plugin *would* contain, so adopt is
     mechanical:
     ```text
     local-board-plugin/
       .claude-plugin/plugin.json      # manifest (name, version, description)
       skills/local-board/             # Claude SKILL.md variant (rendered)
       skills/local-team/              # Claude SKILL_TEAM.md variant
       agents/                         # the 7 local-board-*.md from agents/claude/
       hooks/hooks.json                # 4 enforcement hooks (PreToolUse Task|Agent,
                                       #   PreToolUse Bash x2, PostToolUse Task|Agent)
       hooks/*.js                      # the 4 scripts from hooks/
     ```
     Note: skills/agents still need the `<<SCRIPT_PATH>>`/`<<VERSION>>` render step
     (or a switch to the on-PATH `local-board` invocation, which is already how
     shipped skills are rendered), and `hooks.json` must mirror `HOOK_SPECS` in
     `src/install.js` (event, matcher, script) — flag this as a duplication risk.
   - **Migration notes** — before any plugin ships, the installer must delete its
     own `~/.claude/skills/local-board`, `~/.claude/skills/local-team`, and
     `~/.claude/agents/local-board-*.md` copies (and stop writing them for the
     Claude target) so plugin assets are not shadowed by higher-precedence
     user-dir copies. `patchHooks` entries in `settings.json` must be removed in
     favor of `hooks.json`. Codex/opencode/cline/cursor/agents targets stay on the
     installer regardless — Claude Code does not honor cross-harness skill dirs and
     those harnesses have no plugin system.
   - **Where the plugin would live** — recommend a **sibling repo / separate
     marketplace entry** rather than this repo's root, because the plugin's
     source-of-truth (marketplace/git/zip) and release cadence differ from the npm
     package; co-locating risks `npm pack` picking up plugin files (the
     `files` allowlist from T20260707T1318Z would need to exclude them). Keep the
     canonical skill/agent/hook *content* in this repo; a plugin, if built, is a
     packaging view over it.
   - **Revisit triggers** (adopt when *any* holds): (a) the Claude hook API and
     subagent tool name stabilize; (b) demand for marketplace discoverability;
     (c) the installer's `settings.json` patching becomes a real maintenance or
     support burden; (d) a supported npm-as-plugin-source path appears.

2. **Add a README Documentation Index line** for `docs/PluginPackaging.md` (the
   AGENTS.md rule requires updating the index when adding a `docs/*.md`).

3. **No spike branch.** The decision is defer, so the acceptance is satisfied by
   the rejection/deferral rationale, not a spike.

## Affected Files

- `docs/PluginPackaging.md` — **new**, the decision record (implement stage).
- `README.md` — Documentation Index gains one line (implement stage).
- Reference-only, unchanged: `src/install.js` (`buildTargets`, `HOOK_SPECS`,
  `patchHooks`, `installClaudeAgents`), `hooks/*.js`, `agents/claude/*.md`,
  `SKILL.md`, `SKILL_TEAM.md`, `docs/EnforcementHooks.md`.

## Related Tickets

- T20260707T1326Z — enforce Claude Code hooks (dispatch ledger, evidence gate,
  routing validator, approve-inline consent). The plugin's main upside is atomic
  delivery of these; this decision explicitly waits for that surface to stabilize.
- T20260707T1319Z — folded `install.mjs` into `local-board install`. The Claude
  side this ticket evaluates replacing is that consolidated installer.
- T20260707T1320Z — npm publish + on-PATH `local-board` invocation. Establishes
  npm as the CLI channel; plugin would be a *second* channel, the core con.
- T20260707T1318Z — `files` allowlist / runtime resources move. Relevant to the
  "where does the plugin live" question (avoid `npm pack` capturing plugin files).
- T20260514T2233Z — original orchestration skill + installer. Baseline install
  surface being weighed against.

## Risks

- **Decision drifts from reality.** `HOOK_SPECS` and the agent set will keep
  evolving; the doc's layout sketch could go stale. Mitigation: keep the sketch
  descriptive (points at `src/install.js` `HOOK_SPECS` and `agents/claude/` as
  sources of truth) rather than copying exact JSON that must be kept in sync.
- **Reader mistakes defer for never.** Mitigation: explicit revisit-triggers
  section so the reopen condition is unambiguous.
- **Under-selling atomic hook delivery.** It is the strongest pro; the doc must
  state it honestly and tie the defer to hook-API instability, not dismiss it.
- Low overall: docs-only, no runtime/behavioral change, fully reversible.

## Test Strategy

- Docs-only change; no unit tests added or changed.
- `test/resources-sync.test.js` (resources drift) and `test/install.test.js` are
  **untouched** and must still pass — the deliverable adds no packaged resource
  and no installer behavior, so neither drift nor install coverage should move.
- Verification: `npm run check && npm test && npm run validate` green; confirm the
  new `docs/PluginPackaging.md` is listed in the README Documentation Index (the
  AGENTS.md rule). No `plans/` resource sync implications.

## Open Questions

None blocking. The plugin facts were pre-verified and the project stage makes the
defer call clear. One item for the doc to name (not a blocker): if/when adopted,
decide whether the plugin re-renders skill placeholders or ships the already
on-PATH `local-board` invocation form — the latter is simpler and matches current
shipped skills.

## Implementation Notes

Docs-only deliverable, implemented exactly per the ticket's Technical Design / Approach section.

- Added `docs/PluginPackaging.md`: the decision (defer plugin adoption, keep
  `local-board install` canonical, no spike branch), condensed rationale
  (npm-not-a-plugin-source second channel; precedence/shadowing footgun vs.
  user-dir skill/agent copies; unstable hook API/subagent-tool-name surface;
  CLI stays npm-only, not plugin `bin/`; premature marketplace upside), a
  layout sketch of what a future plugin would contain (`.claude-plugin/plugin.json`,
  rendered skills, the 7 `agents/claude/*.md`, `hooks/hooks.json` + 4 hook
  scripts, pointing at `src/install.js` `HOOK_SPECS` as source of truth rather
  than duplicating exact JSON), migration notes (installer must stop writing
  and must delete its own `~/.claude/skills/local-board`,
  `~/.claude/skills/local-team`, `~/.claude/agents/local-board-*.md`, and
  remove `patchHooks` settings entries in favor of `hooks.json` before any
  plugin ships; other harness targets stay on the installer), a
  where-it-would-live recommendation (sibling repo/marketplace entry, not
  this repo's root, to avoid `npm pack` capturing plugin files), the open
  render-vs-on-PATH-invocation question for a future adopt, and four revisit
  triggers (hook API/tool-name stabilization; marketplace demand;
  settings.json patching becoming a maintenance burden; a supported
  npm-as-plugin-source path).
- Added one README Documentation Index line for the new doc.

No production code, installer, skill, agent, or hook changes — matches the
ticket's docs-only scope.

Verification: `npm run check` (clean), `npm test` (336 tests, 335 pass, 1
skip — unchanged from baseline, `test/install.test.js` and
`test/resources-sync.test.js` untouched/still pass), `npm run validate`
(Ticket validation OK). No counts moved.

No deviations from the Technical Design.

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-08T00:21:46Z: Completed design via claude-subagent:local-board-designer@opus: Designer (opus): defer-don't-reject — installer stays canonical; plugin documented as future work (second-channel cost, precedence shadowing footgun, unstable hook contract). Deliverable: docs/PluginPackaging.md + README index line, no spike. Estimate 2 (basis T20260707T1331Z).

- 2026-07-08T00:22:34Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (docs-only evaluation)

- 2026-07-08T00:22:34Z: Ensured git branch local-board/T20260707T1323Z-npm-evaluate-claude-code-plugin-packaging-for-skills-agents-and-hooks (created).
