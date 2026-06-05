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
- `optionalSteps`: per-stage specialty review catalogs (`design`/`implement`/`test`)
- `estimation`: relative-sized story points config (`enabled`, `scale`, `bootstrapDefault`, `splitThreshold`)

V1 specialty prompts ship at `plans/prompts/optional-steps/{design,impl}/`.

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
- `estimateBasis`
- `workStartedAt`
- `workCompletedAt`
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

Current required role prompts:
- `plans/prompts/roles/estimator.md`: relative story point estimator guidance.

Current required step prompts:
- `plans/prompts/steps/estimate.md`: design-adjacent estimate procedure using `calibration suggest` and `estimate`.

Skills should be orchestration entrypoints. Step behavior should live in prompt files and deterministic scripts where possible.

The installable `local-board` skill is the portable entrypoint. Project-local prompts override bundled fallback prompts.
For design/implement/test stages, the orchestrator skill runs `gate-check` + `specialty-run` between mandatory action completion and stage transition.
Bundled Claude agents live in `agents/claude/` and are installed to `~/.claude/agents/`.

## Delegation and Subagent Tools

| Subagent | Tools | Persistence |
|---|---|---|
| `local-board-decomposer` | Read, Glob, Grep, Bash | Return-only; creates tickets via CLI |
| `local-board-designer` | Read, Glob, Grep, Bash, Write, Edit | Self-writes its own `Technical Design` section via scoped Write (keeps the large design payload out of the orchestrator window); returns a terse summary. Does not edit production source. |
| `local-board-reviewer` | Read, Glob, Grep, Bash | Return-only |
| `local-board-tester` | Read, Glob, Grep, Bash | Return-only |
| `local-board-implementer` | Read, Glob, Grep, Bash, Edit, MultiEdit, Write | Writes its own file changes |
| `local-board-documenter` | Read, Glob, Grep, Bash, Edit, MultiEdit, Write | Writes its own file changes |
| `local-board-gatecheck` | Read, Glob, Grep, Bash | Return-only; pattern-matches stage work against the specialty catalog and returns `{ requestedSteps }` JSON. Pattern match, not quality eval. |
| `local-board-teammate` | Read, Glob, Grep, Bash, Edit, MultiEdit, Write | Team-mode orchestrator; works one ticket at a time and accepts `WORK <id>` reassignments from the lead until the queue empties. Runs `/compact` between tickets. No `Task`: a teammate is itself a subagent and the harness forbids nested subagents, so `claude-subagent:*` steps run inline (`approve-inline` + `--executor inline`); `codex-task:*` routes still work. |

Each bundled agent pins a model in frontmatter: decomposer/designer `opus`,
documenter/implementer/reviewer/tester `sonnet`, gatecheck `haiku`. The model
applies when the orchestrator dispatches the agent from a top-level session;
team-mode teammates ignore it because they run those steps inline.

Return-only subagents (reviewer, tester, decomposer, gatecheck) have no Write or Edit tool. They return section content (Review Findings, Test Evidence) or JSON as Markdown in their final message; the orchestrator writes the temp file with the Write tool and runs `section --file`. Never instruct a return-only subagent to create a file — it falls back to Bash redirection (`echo`, heredoc, `Set-Content`), which breaks on backticks and code fences. The same return-only contract applies to `codex-task:read-only` routes. The designer is the exception: it has a scoped Write tool and self-writes its `Technical Design` section, returning only a terse summary, because that payload is the largest and the Write tool avoids the redirection bug.

## Subagent CLI Permission
Subagent frontmatter cannot carry Bash command-pattern permissions (only the `tools` list). Subagents inherit the session's `permissions.allow`, so the local-board CLI allow rule belongs in project `.claude/settings.json` (e.g. `Bash(node ./bin/local-board.js *)`). The installer adds the installed-path rule to `~/.claude/settings.json`; projects running from source need the project-level rule.

Risk: that grant is coarse — it pre-approves every local-board subcommand, including mutating ones (`move`, `complete-step`, `create`), for any Bash-capable subagent. A prompt-injected ticket could try to steer a return-only agent (reviewer/tester/gatecheck) into mutating state. Settings are session-wide and cannot be scoped per-agent, and the decomposer legitimately needs mutating commands, so narrowing is impractical. Mitigations: the orchestrator owns all transitions and re-runs `validate`/strict routing (a stray `complete-step` still needs matching config + approval to pass), and ticket content is treated as untrusted input. A tighter per-agent policy would need PreToolUse hooks, not settings.

## Safety Pattern
LLMs write designs, code, reviews, tests, docs, and questions. Deterministic tooling validates ticket schema, dependency eligibility, status transitions, branch names, and commits.
When `git.autoMerge` is true, `move ... done` validates routing, requires the current branch to match ticket `branch`, refuses uncommitted non-planning changes, commits planning-only closeout changes, and merges into the default branch. When `git.pruneMergedBranches` is true (default), the merged ticket branch is then deleted with `git branch -d`; the worktree HEAD is detached first when the merge took the ref-only path so the branch is deletable.
When `retention.archiveOnMoveDone` is true, `move ... done` archives other done tickets older than the configured retention window. Archived tickets count as closed dependencies.
`start-work` stamps `workStartedAt` once. `move ... done` stamps `workCompletedAt` only when `workStartedAt` is set. Archive does not touch wall-clock fields.
When estimation is enabled, `complete-step design` refuses tasks and bugs without an estimate.
`create` derives a per-worktree minute offset when invoked from inside a registered ticket worktree (sorted-index position among sibling worktrees) and shifts the starting timestamp by that many minutes. Sibling teammates therefore mint distinct child IDs without coordinating. Test-mode invocations that pass `now` skip the offset to keep timestamps deterministic.

## Parallel Mode (per-step orchestrator)
The `local-team` skill is a single top-level orchestrator (the main session), not an
agent-team. It works up to `maxInFlight` tickets concurrently and dispatches each
pipeline step to an ephemeral, model-specialized executor (subagent or codex),
pinning the per-step model from the routing profile. The ticket file + per-ticket
worktree are the durable baton; the orchestrator owns all state mutations
(`start-work`, `begin-step`, `complete-step`, `move`, gate-check/specialty,
closeout), executors only do the work and return. Concurrency cap comes from
`team-config` (`LOCAL_BOARD_MAX_TEAMMATES`, default 6), reinterpreted as
`maxInFlight`; the real limiter is the orchestrator's context budget, so a low cap
(≈3) plus `/compact` at wave boundaries is sensible. Conflicts: best-effort
pre-merge of `branchReady` peers before an overlapping `implement`, with the
`move … done` rebase-onto-default precondition as the mandatory backstop. This
unifies single-ticket and parallel mode as the N=1 and N>1 cases of one orchestrator.
See `SKILL_TEAM.md` and `docs/PerStepOrchestration.md`. The old agent-teams teammate
flow (`local-board-teammate`) is deprecated; `docs/TeamMode.md` is historical.

## MVP CLI
Use `node ./bin/local-board.js validate`, `list`, `query-next`, `query-ticket`, `state-report`, `schema`, `create`, `estimate`, `calibration suggest`, `gate-check`, `specialty-run`, `start-work`, `begin-step`, `complete-step`, `approve-inline`, `move`, `set`, `section`, `comment`, `link-parent`, `link-child`, `block`, `unblock`, `team-config`, and `init`.

`move` changes status and relocates the ticket. `set` updates mutable front matter fields. `section` replaces section content. `comment` appends timestamped notes to a ticket section.
`estimate` records story points and an estimate basis, validates points against the configured scale, and requires `--force` to overwrite.
`gate-check` returns the gate-check prompt path, stage specialty catalog, and narrow ticket context; the orchestrator dispatches the prompt and consumes its `requestedSteps` JSON.
`specialty-run` resolves one configured optional step for the current stage without invoking an agent.
`section --file <path>` is preferred for generated or multi-line Markdown; inline section text is for short edits. Create the `--file` target with the Write tool, never with shell redirection.
`query-next`, `query-ticket`, and `begin-step` return advisory transition guidance for the current status. The orchestrator should choose one returned status when moving after an action.
`start-work` creates or switches to a ticket branch, records `branch`, logs the action, and moves `ready_for_implementation` tickets to `implementing`.
`complete-step` records `<action>:<executor>` evidence. Strict routing rejects inline completion for delegated actions unless `approve-inline` has recorded user approval.
Ticket dependencies use `blockedBy`/`blocks` while the dependent ticket stays in its intended ready status. `status: blocked` is for non-ticket blockers.

## Test Coverage
`npm test` covers parser/validator behavior, ticket creation, priority and pipeline selection, null next-ticket state, action queries, schema reports, state reports, strict routing evidence, branch start-work behavior, auto-merge closeout, done-ticket retention, front matter and section rewrites, relationship commands, init idempotency, and CLI command-surface flows.
