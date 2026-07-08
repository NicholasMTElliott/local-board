---
id: B20260708T0459Z
type: bug
status: implementing
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/B20260708T0459Z-install-uninstall-leaves-the-bash-local-board-allow-rule-in-settings-json
estimate: 2
estimateBasis: B20260707T1330Z
workStartedAt: 2026-07-08T20:13:56Z
workCompletedAt: null
created: 2026-07-08T04:59:37Z
updated: 2026-07-08T20:18:15Z
completedSteps: ["design:claude-subagent:local-board-designer@opus", "gate:design:claude-subagent:local-board-gatecheck@haiku"]
routingApprovals: []
---
# install: --uninstall leaves the Bash(local-board *) allow rule in settings.json

## Requirement

## Acceptance Criteria

## Related Tickets

## Technical Design

Make `--uninstall` symmetric with install: remove the `Bash(local-board *)`
allow rule that `patchSettings` added, but only when it matches the installer's
exact constant so user-customized rules survive.

## Root cause

`performInstall` (src/install.js:196) calls `patchSettings(target.settingsPath,
allowRule)` with `allowRule = "Bash(local-board *)"` (src/install.js:169), which
appends that string to `permissions.allow`. `performUninstall`
(src/install.js:317-338) removes the runtime dir, skill/team/legacy dirs, managed
hooks (via `patchHooks(..., { remove: true })`), and Claude agents — but has no
counterpart that removes the allow rule. The consent-sensitive grant therefore
survives a full uninstall.

## Exact change (src/install.js only)

1. Hoist the rule string to a module-level constant so install and uninstall
   share one source of truth. Today `allowRule` is a `const` local to
   `performInstall`. Add near the top of the file (alongside `HOOK_SPECS`):

   ```js
   // The single Claude permission rule the installer manages. Uninstall removes
   // an entry from permissions.allow ONLY when it equals this string, so a
   // user-narrowed/renamed rule is never silently deleted.
   const CLAUDE_ALLOW_RULE = "Bash(local-board *)";
   ```

   Replace the local `const allowRule = "Bash(local-board *)"` with a reference
   to `CLAUDE_ALLOW_RULE` (pass it to `patchSettings` as today). This keeps the
   existing idempotent-write test — which asserts the literal `Bash(local-board *)`
   — green.

2. Add an `unpatchSettings(settingsPath, allowRule)` helper mirroring
   `patchHooks`'s remove path and reusing `patchSettings`'s read/write idiom:

   ```js
   // Symmetric counterpart to patchSettings: removes exactly the managed allow
   // rule from permissions.allow. No-op when the file is absent, when
   // permissions/allow are missing or non-arrays, or when the rule is not
   // present. Matches by exact string equality against the managed constant, so
   // a user-edited rule (e.g. "Bash(local-board move *)") is left untouched.
   // Preserves every other allow entry and does not touch permissions.deny,
   // hooks, or any other key. Prunes an emptied allow array and an emptied
   // permissions object, matching patchHooks's prune-when-empty behavior.
   function unpatchSettings(settingsPath, allowRule) {
     if (!existsSync(settingsPath)) {
       return;
     }
     const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
     if (typeof settings !== "object" || settings === null) {
       throw new Error(`${settingsPath} is not a JSON object`);
     }
     const allow = settings.permissions?.allow;
     if (!Array.isArray(allow) || !allow.includes(allowRule)) {
       return;
     }
     settings.permissions.allow = allow.filter((rule) => rule !== allowRule);
     if (settings.permissions.allow.length === 0) {
       delete settings.permissions.allow;
     }
     if (settings.permissions && Object.keys(settings.permissions).length === 0) {
       delete settings.permissions;
     }
     mkdirSync(dirname(settingsPath), { recursive: true });
     const tmpPath = `${settingsPath}.tmp-${process.pid}`;
     writeFileSync(tmpPath, `${JSON.stringify(settings, null, 2)}\n`);
     renameSync(tmpPath, settingsPath);
     console.log(`removed Claude allow rule from ${settingsPath}`);
   }
   ```

3. Wire it into `performUninstall`. In the per-target loop the hooks removal
   already guards on `target.settingsPath !== null && existsSync(...)`
   (src/install.js:333-335). Add the allow-rule removal in the same block so
   both settings mutations share one guard:

   ```js
   if (target.settingsPath !== null && existsSync(target.settingsPath)) {
     unpatchSettings(target.settingsPath, CLAUDE_ALLOW_RULE);
     patchHooks(target.settingsPath, installDir, { remove: true });
   }
   ```

   Only the `claude` target has a non-null `settingsPath`, so scope is unchanged.

### Design decisions / rationale

- **Exact-match-only removal.** The ticket calls for removing the rule "ONLY
  when it exactly matches the rule text the installer writes." String equality
  against `CLAUDE_ALLOW_RULE` does this. A user who narrowed the grant to, e.g.,
  `Bash(local-board move *)` or renamed it keeps their entry. This mirrors the
  spirit of `isManagedHookCommand` (recognize only what we manage) while being
  simpler — the allow rule is a fixed literal, not a path with quoting eras, so
  no path-token normalization is needed.
- **Prune-when-empty.** Deleting an emptied `allow` array and an emptied
  `permissions` object matches `patchHooks`'s existing prune behavior, so a
  settings.json that contained only our rule returns to a clean state rather than
  leaving `{"permissions":{"allow":[]}}` behind. `permissions.deny` or any other
  sub-key blocks the `permissions` prune, as intended.
- **JSON round-trip formatting is acceptable.** `patchSettings` and `patchHooks`
  already rewrite the whole file via `JSON.stringify(settings, null, 2)` + `\n`,
  atomic tmp+rename. `unpatchSettings` uses the identical serialization, so it
  introduces no new formatting concern: any file our installer wrote is already
  2-space-pretty-printed, and a file a user hand-edited is normalized to the same
  shape only when we actually change it (guarded by the `includes` check — we
  return early and write nothing when the rule is absent). Comments/JSONC are not
  a concern: `patchSettings` already assumes strict JSON (`JSON.parse`).
- **No new options flag.** Removal is unconditional on uninstall (symmetric with
  hooks removal), matching the ticket intent; the exact-match guard is the only
  safety valve, consistent with how uninstall already deletes managed dirs and
  hooks without a confirmation prompt.

## Edge cases

- Missing settings.json → early return (no-op).
- `permissions` absent, or `permissions.allow` absent/non-array → early return.
- Rule not present (already removed, or never added) → early return, no write,
  no console line.
- settings.json is valid JSON but not an object → same `is not a JSON object`
  throw as `patchSettings`/`patchHooks`, for consistency.
- Other allow entries present → preserved; only the managed literal is filtered.
- User-edited/renamed rule (non-exact match) → preserved.

## Test plan (test/install.test.js, sandboxed-home seam)

Use the existing `withHome` + `runInstallCli` (or the in-process
`runInstallInProcess` seam) patterns. Read/parse `~/.claude/settings.json`.

1. **install then uninstall removes the rule.** `--target=claude`, assert
   `permissions.allow` deep-equals `["Bash(local-board *)"]`; then
   `--target=claude --uninstall`; assert the rule is gone. Because pruning
   removes the emptied array/object, assert `settings.permissions` is `undefined`
   (settings.json becoming `{}` after a plain, hookless install+uninstall).
2. **hand-edited (non-matching) rule survives uninstall.** Install, then rewrite
   settings.json replacing the entry with a narrowed rule
   `"Bash(local-board move *)"`; uninstall; assert that entry is still present
   and the managed literal is absent.
3. **no settings.json is a no-op.** Uninstall for a home where the claude target
   was never installed (or delete settings.json first); assert no throw and no
   file created. The in-process seam with `--target=claude --uninstall` on a
   fresh home covers this; `performUninstall`'s existing `existsSync` guard plus
   `unpatchSettings`'s own guard both protect it.
4. **other allow entries preserved.** Install, then push an unrelated entry
   (e.g. `"Bash(git status)"`) into `permissions.allow` and write it back;
   uninstall; assert `permissions.allow` deep-equals `["Bash(git status)"]`
   (managed rule removed, unrelated rule kept, array not pruned because non-empty).
5. **coexistence with hooks removal (optional, strengthens regression cover).**
   Extend or add alongside the existing "install --uninstall removes wired hook
   entries" test: `--target=claude --hooks`, then `--uninstall`, assert both
   `settings.hooks` is `undefined` AND the allow rule is gone in one pass.

Run: `node --test test/install.test.js` (or the project's `npm test`).

## Documentation deltas (docs stage)

- **docs/Install.md** — "Uninstall / manual removal" section (lines ~179-201):
  add "The `Bash(local-board *)` allow rule from `permissions.allow` in
  `~/.claude/settings.json`, when it exactly matches the installer's rule (a
  user-narrowed or renamed rule is left in place)" to the "Removes:" bullet list,
  and delete the entire "**Uninstall does not remove the `Bash(local-board *)`
  allow rule.**" paragraph (lines ~194-201) including the B20260708T0459Z
  follow-up pointer. Consider a one-line note in the "settings.json side effects"
  section (~line 153) that uninstall now reverses this write.
- **memory-bank/systemPatterns.md** (lines 187-189): replace the "does not yet
  remove `Bash(local-board *)`; follow-up B20260708T0459Z tracks..." sentence
  with current state — uninstall now removes the managed allow rule (exact-match
  only).
- **memory-bank/techContext.md** (lines 43-45): update the "uninstall currently
  leaves that allow rule in place (`B20260708T0459Z`)" clause to state uninstall
  removes the managed rule.

## Scope / risk

- Files: `src/install.js` (one constant hoist + one helper + one call site),
  `test/install.test.js` (4-5 cases), `docs/Install.md`,
  `memory-bank/{systemPatterns,techContext}.md`. Small, reversible.
- No production behavior change to install; uninstall gains one guarded write.
- Risk: over-broad deletion of a user's customized rule — mitigated by
  exact-string match. Risk: reformatting a hand-edited settings.json — bounded to
  cases where we actually change the file, and identical to the existing
  install-time behavior.
- No new dependencies, no API/flag surface change.

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log

- 2026-07-08T04:59:46Z: Found during T20260707T1338Z design. src/install.js --uninstall removes runtime, skill dirs, hooks entries, and agents, but never removes the Bash(local-board *) allow rule it added to ~/.claude/settings.json — the consent grant persists after uninstall. Fix: remove the rule on uninstall when present (and consider removing only if it matches the exact rule text the installer writes). docs/Install.md (T1338) documents manual removal in the meantime.

- 2026-07-08T20:13:56Z: Ensured git branch local-board/B20260708T0459Z-install-uninstall-leaves-the-bash-local-board-allow-rule-in-settings-json (already-current).

- 2026-07-08T20:17:16Z: Completed design via claude-subagent:local-board-designer@opus: unpatchSettings helper symmetric to patchHooks remove; exact-match on hoisted CLAUDE_ALLOW_RULE constant; atomic write; estimate 2 basis B1330

- 2026-07-08T20:18:14Z: Gate consultation design via claude-subagent:local-board-gatecheck@haiku: requestedSteps: [] (permission-state file management, not auth/credential code; exact-match safety covered by tests+review)

- 2026-07-08T20:18:15Z: Ensured git branch local-board/B20260708T0459Z-install-uninstall-leaves-the-bash-local-board-allow-rule-in-settings-json (already-current).
