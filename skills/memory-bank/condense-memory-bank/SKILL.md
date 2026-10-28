---
name: condense-memory-bank
description: Condense, deduplicate, and fact-check a project's memory-bank/ files in place — a compression refactor that shrinks the bytes loaded into every session while preserving every load-bearing fact. Use when the user asks to condense/compress/shrink/refactor/clean up the memory bank, says it has grown bloated or redundant, or asks to make it more token-efficient. Do NOT use for the routine "update memory bank" trigger, which records new current state after work (that is update-memory-bank); this skill rewrites what is already there.
---

# Condense the memory bank

`memory-bank/*.md` is loaded at the start of **every session** in its repo. Left alone it accretes ticket stamps, change narrative, and cross-file duplication until it costs tens of thousands of tokens per session. This skill is the periodic compression pass.

Target: **the smallest set of files that efficiently, concisely, correctly, accurately, precisely, and completely describes the system.** Usability first — a lost load-bearing fact is a failure; surplus bytes are only a tax. On a bloated bank, past passes have halved the byte count with zero fact loss; treat that as typical of what honest compression yields, not as a quota. The audit in phase 5 is what makes aggressive cutting safe.

## Phase 0 — Project specifics

Read `AGENTS.md` § Memory Bank → Project specifics: verify commands, ticket archive path, human-docs destination (where cut narrative goes if it deserves prose), files not inlined or exempt from compaction, commit policy, formatting gotchas.

## Phase 1 — Baseline

```sh
wc -c memory-bank/*.md
```

Record the numbers; you will report the delta at the end.

**In Claude Code, do not `Read` the core files** — they are already inlined via the `@` imports in `CLAUDE.md`, and re-reading them doubles the cost of the task for no information gain. (This means the `Write` tool will refuse to overwrite them — see phase 4.) In a harness without inlining, read them now, once.

## Phase 2 — Verify before you rewrite

A condensation pass is the natural moment to catch drift, and stale facts are worse than verbose ones. Run the project's verify commands, then extend to whatever the files assert most confidently (flag tables, schema versions, autoload/registration orders, doc pointers). Past passes have caught index numbers that drifted and flag tables missing live keys. Fold every correction into the rewrite and **report it explicitly** — a silent fix looks like an invention.

## Phase 3 — Rewrite rules

Cut:
- **Ticket/bug IDs used as inline stamps.** They are change-log residue; the ticket archive is the real record. A bare short pointer may survive only where the archive genuinely extends a kept invariant.
- **Narrative history**: "was WRONG, corrected by…", "a first attempt used X but review caught…", "the old behaviour did Y". Keep the resulting rule and the generalizable lesson; drop the journey.
- **Emergent counts** (test totals, page counts) and **per-assertion test inventories** (row IDs, checkpoint lists). Keep test *function* names so coverage stays findable.
- **Cross-file duplication.** The same subsystem described at length in two files is the single largest win. Give each fact its canonical home per the file-roles table; other files get a one-line pointer.
- **Narrative the human docs already own.** Replace with a one-line pointer.

Keep, in full:
- Every gotcha, lesson, and "this caused N bugs" rule — the highest-value content in the bank.
- API names, file paths, constant names, and tuning numbers stated as authoritative.
- Flag defaults, schema versions, security caps, invariants — authored contract numbers are facts, not counts.
- Outstanding/unverified work and operator TODO lists — that is current state, not history.

Form: tables and key:value over prose walls; declarative present tense; terse domain vocabulary without re-explanation.

**When unsure whether a detail is load-bearing, keep it.** Bytes are cheap; a fact a future session cannot recover is not.

## Phase 4 — Write

`Write` refuses to overwrite a file this session has not `Read`, and phase 1 deliberately skipped reading. **A quoted bash heredoc is not a reliable workaround** — it has failed with `unexpected EOF` on content of this size and punctuation density. Use the scratchpad:

```
Write  <scratchpad>/<file>.md      # full replacement content
Bash   cp <scratchpad>/<file>.md memory-bank/<file>.md
```

Split a large file into two or three scratchpad parts and `cat` them together — it keeps each tool call within a comfortable output budget and makes a partial failure recoverable.

## Phase 5 — Audit what vanished

This is the step that makes aggressive compression safe. Diff every backticked identifier, old versus new:

```sh
SP=<scratchpad>
for f in memory-bank/*.md; do git show "HEAD:$f" >> "$SP/old_all.md"; done
cat memory-bank/*.md > "$SP/new_all.md"
for s in old new; do
  grep -oE '`[A-Za-z_][A-Za-z0-9_./]*(\(\))?`' "$SP/${s}_all.md" | sort -u > "$SP/${s}_ids.txt"
done
comm -23 "$SP/old_ids.txt" "$SP/new_ids.txt" > "$SP/dropped_ids.txt"
```

Filter out obviously-greppable noise (test/harness/screenshot names), then triage every survivor into: (a) still present in another form — the match is exact, so `` `Foo` `` and `Foo.bar()` read as different strings; (b) a private helper trivially greppable in code; (c) **a genuine loss — restore it.** Expect the (c) bucket to be small (single digits out of hundreds) and worth every minute.

## Phase 6 — Close out

```sh
git diff --stat
```

Check formatting gotchas from Project specifics (EOL pins, generator-owned files) before declaring done. Commit handling per Project specifics — default: **do not commit**; the user controls commit timing.

Report: a before/after byte table including the total loaded per session, the correctness fixes with their evidence, what categories were cut, and what was restored during the audit.
