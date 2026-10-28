---
name: update-memory-bank
description: Full review-and-record pass over a project's memory-bank/ — verify every claim against the repo, record current state, route new facts to their canonical homes, delete superseded content. Use when the user says "update memory bank", after landing a significant feature or milestone, or when memory-bank content is caught contradicting the repo. For a pure compression refactor of existing content, use condense-memory-bank instead.
---

# /update-memory-bank — verify, then record

The memory bank is loaded into every session, and a stale entry actively misleads every future session — worse than a missing one. Its steps: **ReviewAllFiles → RecordCurrentState → ClarifyNextSteps → CaptureInsights**. Verify against the repo, never against your memory of the session.

The content rules live in the project's `AGENTS.md` § Memory Bank and are law here: invariants not history; one canonical home per fact; no emergent counts; minimal but complete (the smallest file that efficiently, concisely, correctly, accurately, precisely, and completely describes the system — usability first, then minimize).

## 0. Project specifics

Read `AGENTS.md` § Memory Bank → Project specifics: verify commands, ticket archive path, human-docs destination, files not inlined, commit policy, formatting gotchas. Everything below consults it.

## 1. ReviewAllFiles — get everything in context, cheaply

- In Claude Code the four core files are already inlined via `CLAUDE.md` — do not re-`Read` them. In a harness without inlining, read all four now.
- `ls memory-bank/` for non-core files; read any that Project specifics doesn't exempt.
- Note: the `Write`/`Edit` tools refuse files this session hasn't `Read`. For targeted edits, a scoped `Read` (offset/limit) of the region is fine; for full-file rewrites use the scratchpad + `cp` mechanic described in the condense skill.

## 2. Verify — every claim type has a ground truth

Run the project's verify commands first, then check whatever the recent work touched:

| Claim type | Verify with |
|---|---|
| File/dir/scene layout claims | `ls` the actual paths; compare entry by entry |
| "Implemented" vs "planned" labels | `rg` for the type/method/flag — design intent is not a feature |
| Status lines, versions, flag defaults | `git log --oneline -10`, the actual config/manifest files |
| Schedules, CI behavior | the actual workflow/cron files, not recollection |
| Doc pointers | `ls` the docs dir; a pointer to a deleted file is a stale claim |
| Tool paths/versions | run `--version` / check the install dir |

Resolve disagreements toward the repo. If two bank files disagree with each other, that is a contradiction to resolve against ground truth — never merge the two wordings.

## 3. RecordCurrentState

- Rewrite stale sections declaratively — current state only. **Delete obsolete content; never append a correction next to the stale claim.**
- Route each new fact to its canonical home per the file-roles table; other files get at most a one-line pointer.
- Keep implemented/planned splits explicit wherever a list mixes them.
- Hunt duplicates: for each topic touched, `grep -ci <keyword> memory-bank/*.md`; a fact in 2+ files keeps only the canonical copy.
- Apply the minimality pressure sentence by sentence: "would an agent make a wrong edit without this sentence?" If no, cut it.

## 4. ClarifyNextSteps

Open questions, outstanding/unverified work, and operator TODOs are current state, not history — keep them, and make each point at a living location (a doc section, a ticket file), never "see chat".

## 5. CaptureInsights

New gotchas and "this caused N bugs" rules are the highest-value content in the bank — record them in full, in their canonical home. Rationale and narrative walkthroughs go to the project's human docs (plus its index), not the bank.

## Exit checklist

- [ ] No claim contradicts the filesystem, config, test run, or git history.
- [ ] Every "implemented" claim has a verified code anchor.
- [ ] No fact appears in two files; no emergent counts introduced.
- [ ] Nothing was appended where a rewrite/delete was called for.
- [ ] Commit handling per Project specifics (default: do not commit; the user controls timing).

Report: what changed per file, contradictions resolved (with evidence), facts moved/merged, anything deliberately kept verbose and why.

## What NOT to do

- Do not delete an invariant because it looks old — age is not staleness. Staleness = contradicted by current code, or describes something removed.
- Do not touch the ticket archive — it is the immutable history that lets the bank stay terse.
- Do not move bank content into human docs verbatim — human docs are narrative; write them separately if needed.
- Do not reintroduce numeric size budgets; the standard is minimal-but-complete, enforced by judgment, not thresholds.
