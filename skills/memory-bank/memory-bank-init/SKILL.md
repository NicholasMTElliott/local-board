---
name: memory-bank-init
description: Initialize a project's memory-bank (scaffold the four core files, AGENTS.md bootstrap, CLAUDE.md adapter, codex prompt pointers) or migrate an existing project from legacy inline memory-bank boilerplate to the centralized structure. Use when the user asks to set up a memory bank in a new repo, migrate/normalize an existing memory-bank setup to the shared skills, or re-sync a project's bootstrap after the canonical template changes.
---

# Memory Bank — initialize or migrate a project

This skill is the **single authority** for the memory-bank architecture shared across projects. The bootstrap template below lands verbatim in each project's `AGENTS.md`; when the template changes, re-run this skill in migrate mode on each project to re-sync.

## Architecture (who owns what)

| Layer | Location | Contents | Why there |
|---|---|---|---|
| Global skills | `~/.claude/skills/memory-bank-init`, `update-memory-bank`, `condense-memory-bank` | Maintenance procedures | One authority; no per-repo copy drift. Installed by `local-board install` (Claude target) from the local-board package's `skills/memory-bank/`; edit there — reinstall overwrites the installed copies |
| Codex prompts | `~/.codex/prompts/*.md` | Two-line pointers to the skill files | Codex can't see Claude skills; pointers prevent a second rule authority |
| Bootstrap | each repo's `AGENTS.md` § Memory Bank | Context-load check, file roles, 4 content rules, trigger→procedure mapping | Must govern EVERY session on EVERY harness; skills only load when invoked and only exist in Claude Code |
| Project specifics | same section, last subsection | Verify commands, ticket archive path, exceptions, commit policy | The per-project facts that made copied skills rot |
| CC adapter | each repo's `CLAUDE.md` | `@` imports + Claude-Code concept mapping | `@` imports are Claude Code-only syntax; keep AGENTS.md pure markdown |

Rules of the split:
- **AGENTS.md carries zero harness-specific syntax.** No `@` imports, no assumption that skills exist. Plain imperative English.
- **Nothing is stated twice.** The bootstrap states the rules; the skills state the procedures; project specifics state the project facts. A project section that restates a bootstrap rule is a migration bug — delete it.
- **Vendored skill copies are an opt-in exception.** A project whose collaborators lack these global skills may check byte-identical copies of `update-memory-bank` / `condense-memory-bank` into `.claude/skills/`. Its Project specifics must declare them as vendored copies with a re-sync rule (re-copy whenever the global version changes). Codex prompts prefer a repo copy when present.
- **No numeric size budgets.** The pressure is: the smallest file that efficiently, concisely, correctly, accurately, precisely, and completely describes the system. Usability first; minimize second.

## Canonical AGENTS.md bootstrap template

Insert as a top-level section. Fill in the Project specifics subsection; everything above it is verbatim.

```markdown
# Memory Bank

`memory-bank/` is the authoritative persistent project context, written **for LLM agents, not humans**. Agents start every session with zero project knowledge; these files carry it forward. Their accuracy directly determines agent effectiveness.

**Context load check (every harness, every session):** before starting any task, ensure the four core files are in context. Some harnesses inline them automatically (Claude Code, via imports in `CLAUDE.md`); if yours does not (e.g. Codex reading this file directly), read them now:
`memory-bank/projectBrief.md` · `memory-bank/productContext.md` · `memory-bank/systemPatterns.md` · `memory-bank/techContext.md`

## File roles

| File | Canonical home for |
|---|---|
| `projectBrief.md` | Purpose, requirements, scope, terse current status |
| `productContext.md` | Problem → solution, functional intent, user-facing behavior |
| `systemPatterns.md` | Architecture, invariants, contracts, component relationships, critical flows |
| `techContext.md` | Stack, constraints, setup, dependencies, tooling, CI/ops |

Additional `memory-bank/` files only for complex features that genuinely outgrow these four.

## Content rules (always in force)

1. **Invariants, not history.** Record the surviving rule/contract/gotcha ("X must be Y because Z breaks otherwise"), never the process that produced it (review rounds, rejected drafts, who caught what). Ticket/bug IDs appear only as short pointers; the narrative lives in the ticket archive.
2. **One canonical home per fact.** A fact appears once, in its role-appropriate file (table above); other files may carry a one-line pointer at most. If a detail lives in code or a doc, point to it rather than copying.
3. **No emergent counts.** Never record numbers that drift as a side effect of work: test totals, line/page/endpoint counts. Write "the X suite". Authored contract numbers (schema versions, enum sizes, tuning constants, security caps) are load-bearing facts — keep those.
4. **Minimal but complete.** The target is the smallest file that efficiently, concisely, correctly, accurately, precisely, and completely describes the system. Usability first: never sacrifice a load-bearing fact for brevity. Then minimize form: tables and key:value over prose walls, declarative present tense, terse domain vocabulary, no filler, no change history — rewrite in place, never append a timeline.

## Maintenance

- After significant work, update the affected file(s): record new invariants in their canonical home, rewrite or delete superseded content.
- Trigger **"update memory bank"** = full review-and-record pass over every file. Claude Code: `/update-memory-bank` skill. Codex: `/update-memory-bank` prompt. Both follow the same canonical procedure.
- When the bank has grown bloated or redundant, run a **condense** pass: `/condense-memory-bank` (skill or prompt).
- The Memory Bank outranks any harness-local auto memory. On conflict, trust the Memory Bank and correct the other store.
- In planning/read-only modes, design against the Memory Bank; write plans to the designated plan file, not to code.

## Project specifics (read by the maintenance passes)

<!-- Fill in per project. Typical entries:
- Human docs: where narrative documentation lives (e.g. docs/ + README index) — the destination for anything cut from the bank that still deserves prose.
- Ticket archive: path holding per-ticket history (e.g. plans/tickets/) — immutable; the reason ticket IDs may be bare pointers.
- Verify commands: shell one-liners mapping the bank's boldest claims to ground truth (config files, schema versions, flag tables, doc listings).
- Not inlined / do not compact: memory-bank files outside the four core files, with their status.
- Commit policy: e.g. "never commit; the user controls commit timing".
- Formatting gotchas: EOL pins, generators, anything a rewrite pass could trip.
-->
```

## Canonical CLAUDE.md adapter template

```markdown
@AGENTS.md
@memory-bank/projectBrief.md
@memory-bank/productContext.md
@memory-bank/systemPatterns.md
@memory-bank/techContext.md

# Claude Code specifics

- The imports above inline AGENTS.md and the full Memory Bank — the context load check in AGENTS.md § Memory Bank is satisfied; do not re-read these files.
- Plan Mode = the planning rule in AGENTS.md § Maintenance: design only, write to the plan file, no code edits.
- Auto memory (`~/.claude/projects/.../memory/`) is subordinate to the Memory Bank; on conflict, update auto memory.
```

If the project's CLAUDE.md carries other content, keep it below the adapter block.

## Mode A — Initialize (no memory-bank yet)

1. Explore the repo: README, build files, entry points, test layout, CI config.
2. Create `memory-bank/` with the four core files, seeded per the file-roles table. Obey the content rules from the first byte — especially rule 4: small and dense beats long and thorough-looking. Mark unverified statements as such rather than guessing.
3. Insert the bootstrap into `AGENTS.md` (create the file if absent). Fill Project specifics — derive verify commands from what the seeded bank asserts most confidently.
4. Write the `CLAUDE.md` adapter (prepend imports if a CLAUDE.md already exists with content).
5. Ensure the codex prompt pointers exist (section below).
6. Report what was scaffolded and which seeded claims need user confirmation.

## Mode B — Migrate (existing bank with legacy boilerplate)

1. Read the project's current `AGENTS.md` and `CLAUDE.md`. Identify: the legacy memory-bank spec block, any `@memory-bank/` imports inside AGENTS.md, local memory-bank skills under `.claude/skills/`, and project rules that duplicate bootstrap content.
2. Replace the legacy spec block with the bootstrap template. Port surviving project-specific residue (verify commands, exceptions, archive paths, commit policy) into Project specifics — this is where the value is; do not drop it.
3. Move the `@memory-bank/` imports out of AGENTS.md into the CLAUDE.md adapter.
4. Deduplicate: any remaining AGENTS.md section restating memory-bank writing principles, file roles, or update routing now covered by the bootstrap gets trimmed to what is genuinely project-specific (e.g. keep a docs/ inventory pointer and task discovery paths; drop restated LLM-writing principles).
5. Delete local `.claude/skills/update-memory-bank` / `condense-memory-bank` copies — the global skills supersede them — unless Project specifics declares them vendored copies (see the exception above); then re-sync them to the global versions instead. First diff them against the global versions and port any project-specific verification steps into Project specifics.
6. Do NOT rewrite the memory-bank content files themselves in this pass; that is `/condense-memory-bank`'s job. Exception: fix references to the moved/renamed rules if any bank file cites them.
7. Report: what was replaced, what residue moved where, what was deleted, and any legacy rule (e.g. numeric size budgets) that was deliberately dropped.

## Codex prompt pointers

Codex cannot see Claude skills; it gets `/name`-invocable prompts in `~/.codex/prompts/`. Each is a pointer, never a copy — the skill file is the only authority. Ensure these three exist:

`~/.codex/prompts/update-memory-bank.md`, `condense-memory-bank.md`, `memory-bank-init.md`, each containing (adjust the name; replace `<home>` with the user's absolute home directory, forward slashes):

```markdown
If the current project has `.claude/skills/update-memory-bank/SKILL.md` (a vendored copy), read and follow that. Otherwise read and follow the canonical procedure at:
<home>/.claude/skills/update-memory-bank/SKILL.md

Skip the YAML frontmatter (Claude Code metadata). The procedure itself is harness-agnostic; where it names Claude Code tools (Write/Edit/scratchpad), use your own equivalents. Start with the project's AGENTS.md § Memory Bank → Project specifics.
```
