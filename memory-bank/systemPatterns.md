# System Patterns

## Architecture
`plans/` is the local board. Markdown tickets are the source of truth.

```text
Claude Code or Codex orchestrator
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
- `routing.strict`, `routing.doneRequires`, `routing.requireGateConsultation`, and `routing.invalidateOnLoopBack`
- retention policy: `archiveDoneAfterDays`, `archiveOnMoveDone`
- git policy: `defaultBranch`, `commitPlanningChanges`, `autoMerge`
- `optionalSteps`: per-stage specialty review catalogs (`design`/`implement`/`test`)
- `estimation`: relative-sized story points config (`enabled`, `scale`, `bootstrapDefault`, `splitThreshold`)

V1 specialty prompts ship at `plans/prompts/optional-steps/{design,impl}/`.

In `src/config.js`, `DEFAULT_CONFIG` = ENOENT fallback + deep-merge base
(`estimation.enabled: false`, `optionalSteps` empty, `routing.requireGateConsultation:
false`, `routing.invalidateOnLoopBack: false`, all four intentional for backward
compat); `defaultConfigJsonc()` = the `init` scaffold (estimation on, catalogs
populated, gate consultation required, loop-back invalidation on).
A guard test (`test/config.test.js`) keeps the rest of the two defaults in sync.

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

## Atomic Writes
Existing ticket rewrites go through `writeTicketFile` (`src/tickets.js`): same-directory temp file (name never ends in `.md`), then `rename()` over the target with bounded retry on Windows `EPERM`/`EBUSY`/`EACCES`; `createTicket` uses exclusive `wx` create; same-folder `moveTicket` rewrites in place, while cross-folder `moveTicket` renames first with `renameWithRetry`, rewrites in place, and rolls back on rewrite failure. Ticket mutations serialize read-modify-write spans with mkdir sentinel locks under the main root's `.local-board/locks`; the active-step ledger uses the same lock primitive for stamps/clears. Lock acquisition has bounded retry and breaks holders older than 30s with a pid/timestamp/hostname diagnostic. Residuals: this is mutual exclusion, not fsync durability; two-file link/dependency pairs still lack crash atomicity and rely on validation/retry self-healing; a live holder running longer than 30s can theoretically be broken.

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

Fresh `init` scaffolds the full packaged prompt tree into `plans/prompts/`:
- role prompts: `code_reviewer.md`, `estimator.md`, `implementer.md`, `orchestrator.md`
- step prompts: `decompose.md`, `design.md`, `document.md`, `estimate.md`, `gate-check.md`, `test.md`
- optional-step prompts: design `security_threat_model.md`, `ui_component_review.md`, `ux_interaction_review.md`; impl `security_audit.md`, `ui_visual_review.md`

Skills should be orchestration entrypoints. Step behavior should live in prompt files and deterministic scripts where possible.

The installable `local-board` skill is the portable entrypoint. Project-local prompts are runtime inputs; missing configured prompts are loud CLI errors, not silent fallback behavior.
`init` restores missing packaged prompts/templates but never overwrites existing prompt files, even with `--overwrite`.
For design/implement/test stages with a non-empty specialty catalog, the orchestrator skill runs `gate-check` + `specialty-run` between mandatory action completion and stage transition.
`gate-check` records that the consultation happened: on an empty stage catalog it auto-stamps `gate:<stage>:skipped-empty-catalog` in `completedSteps` (idempotent, no dispatch); on a non-empty catalog it stays a pure read and the orchestrator calls `gate-complete <ticket-id> --stage <stage> --executor <executor> [--evidence <text>]` after the gate agent answers. `gate:` tokens are excluded from routing evidence (`completedStepRecords`/`validateStepRouting`/`doneRequires`) via a dedicated parser (`gateConsultationRecords`) so they never trip done-time "unknown action" validation. When `routing.requireGateConsultation` is true, `moveTicket` refuses the three forward transitions out of a gated stage (`ready_for_design`/`designing`→`ready_for_implementation`, `ready_for_implementation`/`implementing`→`ready_for_review`, `ready_for_test`/`testing`→`ready_for_docs`) unless the matching `gate:` token is present; backward, lateral, and archive/done moves are never gated.

When `routing.invalidateOnLoopBack` is true, `moveTicket` strips stale evidence on a loop-back: moving to any of the six `ready_*` pipeline statuses removes `completedSteps` (action/`gate:`/specialty) and `routingApprovals` tokens whose producing stage ranks at or downstream of the target in `workflow.pipelineOrder` (target-inclusive), and appends one Run Log line enumerating what was removed. `questions`/`blocked`/`done`/`archived`/active-status targets are never affected; a forward move with no downstream evidence yet is a no-op. Pure core: `invalidateDownstreamEvidence(frontMatter, config, targetStatus)` in `src/tickets.js`.
Bundled Claude agents live in `agents/claude/` and are installed to `~/.claude/agents/`.
Codex skill templates live in `skills/codex/` and install to `~/.codex/skills/local-board` and `~/.codex/skills/local-team`. Codex executor prompts resolve from `local-board where --json` `agentsDir`.
The `~/.local-board` runtime copy remains only for hooks + provenance.

## Delegation and Subagent Tools

| Subagent | Tools | Persistence |
|---|---|---|
| `local-board-decomposer` | Read, Glob, Grep, Bash | Return-only; proposes child tickets, orchestrator creates them via CLI |
| `local-board-designer` | Read, Glob, Grep, Bash, Write, Edit | Self-writes its own `Technical Design` section via scoped Write (keeps the large design payload out of the orchestrator window); returns a terse summary. Does not edit production source. |
| `local-board-reviewer` | Read, Glob, Grep, Bash | Return-only |
| `local-board-tester` | Read, Glob, Grep, Bash | Return-only |
| `local-board-implementer` | Read, Glob, Grep, Bash, Edit, MultiEdit, Write | Writes its own file changes |
| `local-board-documenter` | Read, Glob, Grep, Bash, Edit, MultiEdit, Write | Writes its own file changes |
| `local-board-gatecheck` | Read, Glob, Grep, Bash | Return-only; pattern-matches stage work against the specialty catalog and returns `{ requestedSteps }` JSON. Pattern match, not quality eval. |

Each bundled agent pins a model in frontmatter: decomposer/designer `opus`,
documenter/implementer/reviewer/tester `sonnet`, gatecheck `haiku`. The model
applies whenever the orchestrator dispatches the agent (single-ticket or parallel
mode); config `agents.<action>.model` overrides the frontmatter default.

Codex translates known `claude-subagent:local-board-*` routes to Codex spawned
agents while preserving the configured logical route in `complete-step` evidence
(`@codex-default` suffix when no valid Codex model id is used). This keeps
Claude-first configs compatible without a schema migration. `codex-default` is a
wildcard that satisfies any pinned model in strict-routing model enforcement
(see below).

Strict routing enforces the per-step pinned model at `complete-step` write time:
when the executor route matches the configured route and the action's profile
pins a model, the executor's `@model` suffix must equal `configuredModel`, equal
`codex-default`, or be covered by a `routingApprovals` entry for the full
`route@model` token (`approve-inline --executor <route>@<model>`). Done-time
re-validation (`validateRouting`) stays route-only for back-compat with evidence
recorded before this rule.

Dispatch verification uses `.local-board/active-steps.json` as the deterministic in-flight ledger, anchored at the main checkout's git common dir so linked worktrees share one record. `begin-step` stamps the ticket's resolved action/route/model there and is no longer a pure query; `complete-step` and `approve-inline` clear the ticket's entry. `check-dispatch --agent [--model] [--ticket]` reads the ledger for hook use, always emits JSON on stdout, and exits 0 allow / 1 deny / 2 error while passing through non-local-board agents and unverifiable models. Claude Code enforcement hooks are opt-in via `local-board install --hooks`: routing-validator, dispatch-ledger, evidence-gate, and approve-inline-consent. Hooks fail open on errors/timeouts; CLI strict routing remains the backstop.

Return-only subagents (reviewer, tester, decomposer, gatecheck) have no Write or Edit tool. They return section content (Review Findings, Test Evidence) or JSON as Markdown in their final message; the orchestrator writes the temp file with the Write tool and runs `section --file`. Never instruct a return-only subagent to create a file — it falls back to Bash redirection (`echo`, heredoc, `Set-Content`), which breaks on backticks and code fences. The same return-only contract applies to `codex-task:read-only` routes. The designer is the exception: it has a scoped Write tool and self-writes its `Technical Design` section, returning only a terse summary, because that payload is the largest and the Write tool avoids the redirection bug.

## Subagent CLI Permission
Subagent frontmatter cannot carry Bash command-pattern permissions (only the `tools` list). Subagents inherit the session's `permissions.allow`, so the local-board CLI allow rule belongs in project `.claude/settings.json`. The installer adds the constant command rule `Bash(local-board *)` to `~/.claude/settings.json` (rendered skills invoke the `local-board` command on PATH, not an absolute script path — `src/install.js` verifies `local-board` resolves on PATH before installing and fails fast with mode-specific guidance otherwise). Projects running from source keep the separate project-level rule `Bash(node ./bin/local-board.js *)` in the repo's own `.claude/settings.json` for repo-local dev.

Risk: that grant is coarse — it pre-approves every local-board subcommand, including mutating ones (`move`, `complete-step`, `create`), for any Bash-capable subagent. The decomposer is propose-only (it returns child proposals; it never calls `create`, `move`, or `complete-step` itself), so the coarse-grant risk rests on the orchestrator and other Bash-capable agents that do mutate state. A prompt-injected ticket could still try to steer a return-only agent (reviewer/tester/gatecheck/decomposer) into invoking mutating commands directly via Bash, since settings are session-wide and cannot be scoped per-agent, so narrowing is impractical. Mitigations: the orchestrator owns all transitions and re-runs `validate`/strict routing (a stray `complete-step` still needs matching config + approval to pass), ticket content is treated as untrusted input, and opt-in PreToolUse hooks (`local-board install --hooks`) now gate routing/evidence/inline approval for Claude Code sessions that enable them, tightening the coarse grant further.

## Safety Pattern
LLMs write designs, code, reviews, tests, docs, and questions. Deterministic tooling validates ticket schema, dependency eligibility, status transitions, branch names, and commits.
When `git.autoMerge` is true, `move ... done` validates routing, requires the current branch to match ticket `branch`, refuses uncommitted non-planning changes, commits planning-only closeout changes, and merges into the default branch. When `git.pruneMergedBranches` is true (default), the merged ticket branch is then deleted with `git branch -d`; the worktree HEAD is detached first when the merge took the ref-only path so the branch is deletable.
When `retention.archiveOnMoveDone` is true, `move ... done` archives other done tickets older than the configured retention window. Archived tickets count as closed dependencies.
`start-work` stamps `workStartedAt` once. `move ... done` stamps `workCompletedAt` only when `workStartedAt` is set. Archive does not touch wall-clock fields.
When estimation is enabled, `complete-step design` refuses tasks and bugs without an estimate.
`create` derives a per-worktree minute offset when invoked from inside a registered ticket worktree (sorted-index position among ticket worktrees under the configured root) and shifts the starting timestamp by that many minutes. Peer worktree workers therefore mint distinct child IDs without coordinating. Test-mode invocations that pass `now` skip the offset to keep timestamps deterministic.

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
See `SKILL_TEAM.md`, `skills/codex/local-team/SKILL.md`, and `docs/PerStepOrchestration.md`. The old agent-teams teammate
flow and its `local-board-teammate` agent have been removed; `docs/TeamMode.md` is
retained only as historical context.

## MVP CLI
Use `node ./bin/local-board.js version`, `where [--json]`, `validate`, `list`, `query-next`, `query-ticket`, `state-report`, `schema`, `create`, `estimate`, `calibration suggest`, `gate-check`, `gate-complete`, `specialty-run`, `start-work`, `begin-step`, `check-dispatch`, `complete-step`, `approve-inline`, `move`, `set`, `section`, `comment`, `link-parent`, `link-child`, `block`, `unblock`, `team-config`, and `init`.

`move` changes status and relocates the ticket; when `routing.requireGateConsultation` is true it also refuses the three forward gated transitions above without a recorded consultation, and when `routing.invalidateOnLoopBack` is true a move to a `ready_*` status strips at-or-downstream evidence (see Delegation and Subagent Tools above). `set` updates mutable front matter fields (routes through `move` for `status`, so it is gated and invalidated too). `section` replaces section content. `comment` appends timestamped notes to a ticket section.
`estimate` records story points and an estimate basis, validates points against the configured scale, and requires `--force` to overwrite.
`gate-check` returns the gate-check prompt path, stage specialty catalog, and narrow ticket context; the orchestrator dispatches the prompt and consumes its `requestedSteps` JSON. It also self-records the consultation on the empty-catalog branch (see Config above).
`gate-complete <ticket-id> --stage <stage> --executor <executor> [--evidence <text>]` records a non-empty-catalog gate consultation after the gate agent answers.
`specialty-run` resolves one configured optional step for the current stage without invoking an agent.
`section --file <path>` is preferred for generated or multi-line Markdown; inline section text is for short edits. Create the `--file` target with the Write tool, never with shell redirection.
`query-next`, `query-ticket`, and `begin-step` return advisory transition guidance for the current status. The orchestrator should choose one returned status when moving after an action.
`start-work` creates or switches to a ticket branch, records `branch`, logs the action, and moves `ready_for_implementation` tickets to `implementing`.
`complete-step` records `<action>:<executor>` evidence. Strict routing rejects inline completion for delegated actions unless `approve-inline` has recorded user approval.
Ticket dependencies use `blockedBy`/`blocks` while the dependent ticket stays in its intended ready status. `status: blocked` is for non-ticket blockers.

## Test Coverage
`npm test` covers parser/validator behavior, ticket creation, priority and pipeline selection, null next-ticket state, action queries, schema reports, state reports, strict routing evidence, branch start-work behavior, auto-merge closeout, done-ticket retention, front matter and section rewrites, relationship commands, init idempotency, and CLI command-surface flows.
