# Codex Handoff Prompt: local-board

You are Codex working in `local-board`.

## Immediate Context

This repo was just created as a new open-source project. It is a sibling of the originating project.

Expected paths:

- Current repo: `C:\Users\Nicho\Documents\local-board`
- Originating/reference repo: `..\aiboard`

If `..\aiboard` is not present, look for the older/source repo nearby. The originating project may also exist as `..\task-board` depending on local naming.

## Why This Exists

The originating project is an AI kanban agent orchestrator. Its premise was:

- integrate with external kanban boards such as GitHub Projects or Trello;
- use an orchestrator application to delegate work to local agents;
- move cards through design, implementation, review, test, documentation, merge, and done states;
- use roles such as senior engineer, implementer, code reviewer, QA, gate checker, estimator, and specialist reviewer;
- isolate implementation work with git branches/worktrees;
- keep humans in control through approval gates and question states.

`local-board` is a parallel experiment. It keeps the planning/control plane in the repo itself instead of using an external board.

## Product Direction

Build a repo-native board system where tickets are Markdown files under `plans/`.

Claude Code is expected to be the first orchestrator. It should:

1. Read tickets from `plans/tickets/**/*.md`.
2. Determine the highest-priority eligible ticket.
3. Decompose epics into stories.
4. Decompose stories into tasks.
5. For tasks and bugs:
   - cross-reference related tickets;
   - write a technical design;
   - ask questions when blocked;
   - create a task branch;
   - implement;
   - commit;
   - code review;
   - run specialty review if needed;
   - test;
   - update docs;
   - commit documentation;
   - merge/push according to policy;
   - mark the ticket done.

The intent is to mimic the kanban workflow while using local files and local agents.

## Important Design Stance

Do not turn every step into a separate skill.

Preferred shape:

- one orchestration entrypoint/skill;
- durable prompt files for roles and steps;
- deterministic scripts for validation and state changes;
- delegated agents for isolated design/implementation/review/test work.

Skills are good entrypoints. Prompt files are better for individual role/step behavior. Scripts should enforce things that must be deterministic.

## Current Repo State

The scaffold exists but no implementation has started.

Created files/directories:

```text
README.md
AGENTS.md
LICENSE
.gitignore
memory-bank/projectBrief.md
memory-bank/productContext.md
memory-bank/systemPatterns.md
memory-bank/techContext.md
docs/LocalBoardConcept.md
docs/TicketFormat.md
docs/Workflow.md
plans/README.md
plans/tickets/README.md
plans/tickets/backlog/.gitkeep
plans/tickets/ready/.gitkeep
plans/tickets/active/.gitkeep
plans/tickets/questions/.gitkeep
plans/tickets/blocked/.gitkeep
plans/tickets/review/.gitkeep
plans/tickets/done/.gitkeep
plans/tickets/archive/.gitkeep
plans/prompts/roles/orchestrator.md
plans/prompts/roles/implementer.md
plans/prompts/roles/code_reviewer.md
plans/prompts/steps/decompose.md
plans/prompts/steps/design.md
plans/prompts/steps/test.md
plans/templates/ticket.md
```

Git repo is initialized. Scaffold files may still be uncommitted.

## Current Ticket Model

Ticket names should use:

```text
{Prefix}{yyyyMMddTHHmmZ}_{slug}.md
```

Examples:

```text
E20260514T1234Z_local-board-mvp.md
S20260514T1235Z_ticket-parser-and-validator.md
T20260514T1236Z_implement-priority-picker.md
B20260514T1237Z_fix-status-folder-mismatch.md
```

Prefixes:

| Prefix | Type |
|---|---|
| E | epic |
| S | story |
| T | task |
| B | bug |

Front matter is canonical. Folder placement is only a human convenience.

Required front matter currently documented:

```yaml
id: T20260514T1234Z
type: task
status: backlog
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: null
created: 2026-05-14T12:34:00-04:00
updated: 2026-05-14T12:34:00-04:00
```

Standard sections:

```md
# Title

## Requirement

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
```

## Status Model

Initial statuses from `memory-bank/systemPatterns.md`:

- `backlog`
- `ready_for_decomposition`
- `ready_for_design`
- `designing`
- `questions`
- `ready_for_implementation`
- `implementing`
- `ready_for_review`
- `reviewing`
- `ready_for_test`
- `testing`
- `ready_for_docs`
- `done`
- `blocked`
- `archived`

Human-friendly folders:

```text
plans/tickets/backlog
plans/tickets/ready
plans/tickets/active
plans/tickets/questions
plans/tickets/blocked
plans/tickets/review
plans/tickets/done
plans/tickets/archive
```

Expect the exact mapping from status to folder to need refinement.

## What To Do Next

Start by reading:

1. `AGENTS.md`
2. `README.md`
3. all `memory-bank/*.md`
4. `docs/TicketFormat.md`
5. `docs/Workflow.md`
6. `plans/templates/ticket.md`

Then propose or implement the smallest useful MVP, depending on the user's instruction.

Good first implementation candidates:

1. Define a machine-readable ticket schema.
2. Add a validator that checks ticket front matter, ID/name consistency, status/folder consistency, parent/child links, and dependencies.
3. Add a priority picker that returns the next eligible ticket.
4. Add an initial CLI command such as `local-board validate` and `local-board next`.
5. Add a first epic ticket describing the MVP.
6. Add tests for parser, validator, and priority selection.

## Guardrails

- Keep v0 simple and file-first.
- Do not add external services.
- Do not build a dashboard yet.
- Do not overfit to the old external-board architecture.
- Borrow concepts from `..\aiboard` only when useful.
- Prefer deterministic code for schema validation and transitions.
- Let agents write content, not silently own canonical state.
- Keep documentation split intact:
  - `memory-bank/` is terse AI context.
  - `docs/` is narrative human documentation.
  - `README.md` indexes human docs.
  - `plans/` contains tickets, prompts, and templates.

## Open Decisions

These are intentionally unresolved:

- CLI runtime/language.
- Whether the first orchestration surface is a Claude Code skill, a CLI, or both.
- Exact state-transition graph.
- Branch/commit/merge policy.
- How much to reuse from the originating C# orchestrator.
- Whether to implement a file-backed board client later.

## Suggested MVP Bias

A practical first milestone:

```text
MVP 0: local ticket kernel

- Parse Markdown tickets with YAML front matter.
- Validate ticket invariants.
- List tickets.
- Pick next eligible ticket by priority and dependency status.
- Create tickets from a template.
- Document the contract.
```

This creates a stable substrate before adding Claude/Codex orchestration.