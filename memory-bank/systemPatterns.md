# System Patterns

## Architecture
`plans/` is the local board. Markdown tickets are the source of truth.

```text
Claude Code orchestrator
  -> reads plans/tickets/**/*.md
  -> validates front matter + dependencies with local-board CLI
  -> queries next eligible action with local-board CLI
  -> ensures the ticket branch with local-board start-work before code/doc work
  -> records step routing with begin-step and complete-step
  -> delegates role/step prompts to agents
  -> updates ticket sections/status with local-board CLI mutation commands
  -> performs deterministic git operations by policy
```

## Config
Project workflow config lives at `plans/local-board.config.jsonc`.

It defines:
- `workflow.pipelineOrder`
- `workflow.statusActions`
- `workflow.actionPrompts`
- `workflow.transitions`
- `agents`
- `routing.strict` and `routing.doneRequires`
- retention policy: `archiveDoneAfterDays`, `archiveOnMoveDone`
- git policy: `defaultBranch`, `commitPlanningChanges`, `autoMerge`

## Ticket Types
| Prefix | Type | Children |
|---|---|---|
| E | epic | stories |
| S | story | tasks |
| T | task | none |
| B | bug | none |

## Ticket ID Convention
Preferred: `{Prefix}{yyyyMMddTHHmmZ}_{slug}.md`.
Example: `T20260514T1234Z_implement-leaderboard-feature.md`.

## Canonical State
Front matter is canonical. Folder is secondary.

Required fields:
- `id`
- `type`
- `status`
- `priority`
- `parent`
- `children`
- `blockedBy`
- `blocks`
- `branch`
- `estimate`
- `created`
- `updated`

## Status Folders
```text
backlog -> plans/tickets/backlog
ready_for_decomposition -> plans/tickets/ready
ready_for_design -> plans/tickets/ready
ready_for_implementation -> plans/tickets/ready
ready_for_review -> plans/tickets/review
ready_for_test -> plans/tickets/ready
ready_for_docs -> plans/tickets/ready
designing -> plans/tickets/active
implementing -> plans/tickets/active
reviewing -> plans/tickets/review
testing -> plans/tickets/active
questions -> plans/tickets/questions
blocked -> plans/tickets/blocked
done -> plans/tickets/done
archived -> plans/tickets/archive
```

## Initial Statuses
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

## Role/Step Prompts
Role prompts live in `plans/prompts/roles/`.
Step prompts live in `plans/prompts/steps/`.

Skills should be orchestration entrypoints. Step behavior should live in prompt files and deterministic scripts where possible.

The installable `local-board-orchestrator` skill is the portable entrypoint. Project-local prompts override bundled fallback prompts.
Bundled Claude agents live in `agents/claude/` and are installed to `~/.claude/agents/`.

## Safety Pattern
LLMs write designs, code, reviews, tests, docs, and questions. Deterministic tooling validates ticket schema, dependency eligibility, status transitions, branch names, and commits.
When `git.autoMerge` is true, `move ... done` validates routing, requires the current branch to match ticket `branch`, refuses uncommitted non-planning changes, commits planning-only closeout changes, and merges into the default branch.
When `retention.archiveOnMoveDone` is true, `move ... done` archives other done tickets older than the configured retention window. Archived tickets count as closed dependencies.

## MVP CLI
Use `node ./bin/local-board.js validate`, `list`, `query-next`, `query-ticket`, `state-report`, `schema`, `create`, `start-work`, `begin-step`, `complete-step`, `approve-inline`, `move`, `set`, `section`, `comment`, `link-parent`, `link-child`, `block`, `unblock`, and `init`.

`move` changes status and relocates the ticket. `set` updates mutable front matter fields. `section` replaces section content. `comment` appends timestamped notes to a ticket section.
`section --file <path>` is preferred for generated or multi-line Markdown; inline section text is for short edits.
`query-next`, `query-ticket`, and `begin-step` return advisory transition guidance for the current status. The orchestrator should choose one returned status when moving after an action.
`start-work` creates or switches to a ticket branch, records `branch`, logs the action, and moves `ready_for_implementation` tickets to `implementing`.
`complete-step` records `<action>:<executor>` evidence. Strict routing rejects inline completion for delegated actions unless `approve-inline` has recorded user approval.
Ticket dependencies use `blockedBy`/`blocks` while the dependent ticket stays in its intended ready status. `status: blocked` is for non-ticket blockers.

## Test Coverage
`npm test` covers parser/validator behavior, ticket creation, priority and pipeline selection, null next-ticket state, action queries, schema reports, state reports, strict routing evidence, branch start-work behavior, auto-merge closeout, done-ticket retention, front matter and section rewrites, relationship commands, init idempotency, and CLI command-surface flows.
