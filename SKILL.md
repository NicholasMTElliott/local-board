---
name: local-board
description: Operate a repo-native local-board planning system where tickets are Markdown files under plans/tickets. Use when the user asks to run local-board, work the next ticket, work a specific ticket, decompose an epic/story, initialize local-board in a repo, or continue a file-backed planning workflow. The skill validates tickets, queries deterministic workflow state through the local-board CLI, loads project prompts/config, delegates bounded steps when configured, and updates canonical ticket state through CLI commands.
allowed-tools:
  - Bash(local-board *)
---

# local-board orchestrator

Use the `local-board` command on PATH:

```sh
local-board
```

Installation metadata:

- Installed from local-board v<<VERSION>>
- Run `local-board where --json` for packaged asset locations (prompts, templates, Codex executor prompts).

Do not search the filesystem for local-board source or scripts. Use the `local-board` command on PATH.

Operate in the user's current project unless they specify another root. Pass `--root <path>` for non-current projects.

Version-skew check (advisory): this skill was installed from local-board `v<<VERSION>>`. Two signals indicate the runtime drifted from what these skills were built against: (1) `local-board --version` prints a version different from `v<<VERSION>>`, and (2) more reliably, `local-board install --status` reports `skewed` — it recomputes a content hash over the installed payload and compares it to the hash recorded at install time, so it catches drift even when the version number was not bumped (common on dev checkouts). If either fires, warn the user and suggest re-running `local-board install` to refresh the skills. This is advisory: warn and continue; never treat it as a hard gate or block the ticket.

## Core Loop

1. Read project instructions: `AGENTS.md`, `CLAUDE.md`, and `memory-bank/` when present.
2. If `plans/` is absent and the user asked to initialize, run `local-board init`.
3. Run `local-board schema --json` when you need accepted statuses, priorities, actions, or agent values.
4. Run `local-board validate`.
5. For whole-project work, run `local-board query-next --json`.
6. For a specific ticket, run `local-board query-ticket <id> --json`.
7. Read the returned ticket `path`, returned `prompt`, `branch`, `transitions`, and relevant project context.
8. For `implement`/`review`/`test`/`document`, the default is to create a per-ticket worktree first (`worktree-add`) and pass `--root <worktreePath>` on subsequent per-ticket calls — see `## Worktrees`.
9. Run `local-board begin-step <ticket-id> --root <worktreePath> --json`. It returns `configuredAgent` (the route), `configuredModel` (the per-step model, or null), `configuredPrompt`, and — only when the resolved profile lists a non-empty ordered `fallbackModels` — `configuredFallbackModels`, and records the in-flight step for dispatch verification.
10. Execute the returned `action` through the configured route. For `claude-subagent:<agent-name>`, dispatch the named Claude subagent after the colon and, when `configuredModel` is non-null, pin that subagent's model to `configuredModel` at dispatch. For `codex-task:<mode>`, shell out to codex in that mode. For `inline`, do the work yourself on your own model. Per-step models only take effect on subagent/codex routes — `inline` always runs on the orchestrator's model. **Every Claude subagent dispatch prompt must begin with a first line of the exact form `Ticket: <id>`** — this is the machine-readable anchor the optional dispatch-ledger/routing-validator hooks (`local-board install --hooks`) parse to verify the dispatch actually happened.
11. Run `local-board complete-step <ticket-id> <action> --root <worktreePath> --executor <configuredAgent> --model <configuredModel> --evidence "<evidence>"`, passing `--executor` and `--model` verbatim from `begin-step` output; omit `--model` when `configuredModel` is null. `complete-step` composes the `<route>@<model>` evidence token server-side — do not hand-splice `@<model>` yourself. (The combined `--executor <route>@<model>` form is still accepted for back-compat and is equivalent.) Under strict routing, when the route matches the configured route and a model is pinned, `complete-step` requires the recorded model to match `configuredModel` (or `codex-default` for a Codex-translated run, or an `approve-inline --executor <route>@<model>` approval) — otherwise it is rejected.
12. Mutate ticket state only through CLI commands.
13. After the action, choose the next status from the returned `transitions` list and run `local-board move <ticket-id> <status> --root <worktreePath> --json`.
14. Choose `done` only when all required stages are complete.
15. Run `validate` again before reporting completion.

Do not infer the workflow state when `query-next` or `query-ticket` can answer it.
Do not invent next statuses. Use the returned `transitions` list or `schema --json`.
Do not inspect local-board source files to discover statuses or command contracts. Use `schema --json`.
Do not bypass configured routing. Strict routing is policy, not preference.
Do not move ticket-dependency blockers to `blocked`. Use `block <ticket-id> <dependency-id>` and leave or return the ticket to its intended ready status so it becomes eligible when the dependency is `done` or `archived`.
When `routing.enforceTransitions` is `true` (the `init` scaffold default), `move`/`set <id> status` refuse a target status outside `workflow.transitions[fromStatus]` and a fixed structural allow-set (same-status re-save, backlog promote, ready->active start-work, active->own-ready revert, questions/blocked resume, any->archived/questions/blocked); the refusal error names the allowed targets. Only pass `--override --reason <text>` when a legitimate move is genuinely outside that set (e.g. an explicit user-directed skip) — it forces the move and records `Transition override: <from> -> <to>: <reason>` in the Run Log. Prefer a legal transition over `--override` whenever one exists.

## Process Contract

Ticket types: `epic`, `story`, `task`, `bug`.

Statuses:

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

Eligible trigger statuses:

- `ready_for_decomposition`
- `ready_for_design`
- `ready_for_implementation`
- `ready_for_review`
- `ready_for_test`
- `ready_for_docs`

Priorities: `P0`, `P1`, `P2`, `P3`, `P4`.

## Actions

- `decompose`: propose child tickets and dependency ordering; the orchestrator creates them, links them with `link-parent` or `link-child`, and for each child persists the decomposer's proposed `## Requirement` body (with acceptance criteria) via `section <child-id> --file <temp-path> --section "Requirement"`. Child authoring ends committed too — with `git.commitPlanningOnTransition` on this happens automatically per command; on flag-off boards commit `plans/` before seeding a worktree for the child.
- `design`: write or update `## Technical Design`; move to the next configured status only when the design is complete.
- `implement`: make scoped code changes, test them, and record notes/evidence.
- `review`: inspect changes and write `## Review Findings`.
- `test`: run appropriate tests and write `## Test Evidence`.
- `document`: update docs and write `## Documentation Updates`.

Project-local prompts in `plans/prompts/` are authoritative; `local-board init` scaffolds the full set (including `gate-check.md` and every `optionalSteps` prompt) from the packaged prompt tree. `gate-check` and `specialty-run` verify the resolved prompt file exists and fail with an actionable error naming the missing path if it does not — if you see that error, run `local-board init` in the repo to restore the missing prompts (or copy it from the `promptsDir` reported by `local-board where --json`).

## Transition Guidance

`query-next --json`, `query-ticket <id> --json`, and `begin-step <id> --json` return a `transitions` array for the ticket's current status. Each item has:

- `status`: exact value to pass to `move`;
- `when`: the condition for choosing that status.

Use those statuses after completing the action. Examples:

- review passes: move to `ready_for_test`;
- review finds implementation gaps: move to `ready_for_implementation`;
- review finds a fundamental design flaw: move to `ready_for_design`;
- any stage needs user input: move to `questions` and write the question;
- ticket dependency blocks progress: use `block <ticket-id> <dependency-id>` and keep or return the ticket to its intended ready status;
- non-ticket blocker stops progress: move to `blocked` and record the blocker.

`begin-step` also stamps the active dispatch ledger, so do not treat it as a side-effect-free query.

## Worktrees

Single-ticket work runs in a per-ticket git worktree by default — the same
lifecycle `local-team` uses, at N=1 — because a worktree structurally isolates
the ticket's branch from the orchestrator's checkout and prevents the
branch-stacking hazard (see Fallback below). Do not call `git worktree`
directly.

Ticket authoring ends committed. With `git.commitPlanningOnTransition` on
(scaffold default), `create`/`section`/`link`/`block` each auto-commit
`plans/`, so just verify `git status` is clean before `worktree-add` or
dispatch. On flag-off boards, run `git add plans && git commit` yourself
first — `worktree-add` branches from HEAD and refuses an untracked or dirty
ticket file.

Before the ticket's first step, create the worktree from the project root and
capture `worktreePath`:

```sh
local-board worktree-add <ticket-id> --json
```

`worktree-add` also creates and records the ticket branch (it commits the
branch stamp), so a separate branch-creating `start-work` is not needed first.

Pass `--root <worktreePath>` on **every** later per-ticket call: `begin-step`,
`start-work`, `complete-step`, `gate-check`, `gate-complete`, `specialty-run`,
`section`, `comment`, and `move`. If you dispatch a step executor, give it the
`worktreePath` and instruct it to `cd` there and use `--root <worktreePath>`.

Recommended ordering: `worktree-add` (once, up front) ->
`begin-step --root <worktreePath>` -> `start-work --root <worktreePath>`
(still moves `ready_for_implementation` -> `implementing`; inside the worktree
it is already on the ticket branch and the tree is clean, so no
`--allow-dirty` is needed) -> dispatch -> `complete-step --root <worktreePath>`.

Closeout: run `move <ticket-id> done --root <worktreePath> --json` (auto-merge
runs in the worktree, which is on the ticket branch). Then reconcile the main
checkout:

```sh
local-board fast-forward --json
```

(run from the project root), then remove the worktree:

```sh
local-board worktree-remove <ticket-id> --json
```

`worktree-remove` resolves the repo's main root itself, so it works from
either the project root or `--root <worktreePath>`.

If `move ... done` refuses because the branch lacks the latest default, commit
planning-only ticket edits in the worktree, rebase the ticket branch onto the
default, then retry (same as the parallel skill's closeout).

### Fallback: main-checkout mode

For environments where worktrees are unavailable, you may instead work on the
main checkout, switching branches with `start-work` (see Branch Discipline)
and passing no `--root` override. Omitting `--root` is the fallback-mode
form of every per-ticket command below; the default worktree flow always
passes `--root <worktreePath>`.

**Hazard (branch stacking):** on the main checkout, after a ticket's commits
are on its branch, running `start-work` for the *next* ticket branches off the
**previous ticket's branch** instead of the default branch. Symptom: divergent
board state and stacked branches that require manual reconciliation merges
(exactly what happened in the 2026-07 run, T20260707T1335Z / T20260707T1336Z).
Worktrees avoid this structurally.

**Mitigation:** before `start-work` on each new ticket, return to the default
branch with a clean tree and run `local-board fast-forward --json`, so the new
branch forks from the up-to-date default rather than from the prior ticket's
tip. This mitigates but does not eliminate the hazard; the worktree default is
preferred.

## Branch Discipline

In the default worktree mode, `start-work` runs inside the worktree with
`--root <worktreePath>` (see Worktrees). The main-checkout use of `start-work`
below is the fallback path.

Before `implement`, `review`, `test`, or `document`, run:

```sh
local-board start-work <ticket-id> --json
```

`start-work` creates a branch when the ticket has no `branch`, switches to a recorded existing branch when it exists, records the selected branch in front matter, appends a run-log entry, and moves `ready_for_implementation` tickets to `implementing`.

`begin-step` resolves the action whether the ticket is still `ready_for_implementation` or already `implementing`, so it may run before or after `start-work`.

If the user pre-seeded work on a branch that is not yet recorded in the ticket, run:

```sh
local-board start-work <ticket-id> --branch <branch-name> --json
```

When switching to an existing branch, `start-work` refuses a dirty worktree unless `--allow-dirty` is supplied. Do not use plain `git switch` for ticket work unless the CLI command is unavailable or the user explicitly asks for manual git control.

## Done and Auto-Merge

Use `move <ticket-id> done --json` only after required design, implementation, review, test, and documentation evidence is recorded.

When `git.autoMerge` is `true`, `move ... done` also:

- verifies the current branch is the ticket's recorded `branch`;
- refuses uncommitted non-planning changes;
- commits planning-only ticket updates when `git.commitPlanningChanges` is `true`;
- switches to `git.defaultBranch` or the detected default branch;
- merges the ticket branch into the default branch;
- deletes the merged ticket branch when `git.pruneMergedBranches` is `true` (default).

When `retention.archiveOnMoveDone` is `true`, `move ... done` also archives other `done` tickets whose `updated` timestamp is older than `retention.archiveDoneAfterDays`. Archived tickets remain closed and still satisfy dependencies.

If auto-merge refuses to proceed, fix the reported git state or ask the user. Do not mark the ticket done by manual front matter edits.

## Specialty Steps

After the mandatory action for a `design`, `implement`, or `test` stage completes (evidence recorded via `complete-step`) and before running `move <ticket-id> <next-status>`, run gate-check to ask the gate agent which specialty reviews apply.

Gate-check is not run after `decompose` or `document`.

```sh
local-board gate-check <ticket-id> --stage <stage> --json
```

`<stage>` must be one of `design`, `implement`, or `test`. The CLI returns the gate-check `prompt` path, the configured gate-check `agent` (route) and `model`, a narrow `ticketContext`, the stage `catalog` of available specialty entries, and an explicit `skip` boolean (`true` when `catalog` is empty). The CLI does not invoke an agent. Dispatch the gate agent only when `skip` is `false`.

Dispatch the gate-check prompt through the returned `agent` route, pinning the subagent's model to the returned `model` when non-null (the bundled `local-board-gatecheck` agent runs on `haiku` by default). Parse the agent's strict JSON response:

```json
{ "requestedSteps": ["security_audit"] }
```

An empty `requestedSteps` array is the normal case; skip the specialty pass and proceed to `move`.

`gate-check` itself records that the consultation happened: on an **empty** stage catalog it auto-stamps a `gate:<stage>:skipped-empty-catalog` token in `completedSteps` and dispatches no agent. On a **non-empty** catalog, `gate-check` stays a pure read — after the gate agent answers (per the JSON above), record the consultation yourself:

```sh
local-board gate-complete <ticket-id> --stage <stage> --executor <agent> --model <model> --evidence "<requestedSteps summary>"
```

Use the resolved gate-check `agent` and `model` fields verbatim as `--executor` and `--model` (omit `--model` when `model` is null), and summarize the answer (which specialties, or `none`) as `--evidence`. `gate-complete` composes the same `<route>@<model>` token server-side as `complete-step` (the combined `--executor <route>@<model>` form still works). This records `gate:<stage>:<executor>` and a Run Log line.

For each name in `requestedSteps`, resolve the specialty:

```sh
local-board specialty-run <ticket-id> <step-name> --json
```

`specialty-run` derives the stage automatically from ticket status; do not pass `--stage`. It returns the resolved `prompt`, the `agent` route (defaulting to `inline`), `model` and `effort` (both `null` when unset — a catalog entry's `agent` may be a bare route string or a `{ route, model?, effort? }` profile object, same grammar as `Delegation` below), and a narrow `ticketContext`. Dispatch the prompt through the returned `agent` route with the returned pins: for `claude-subagent:` pin the subagent's model to `model` at dispatch (effort via frontmatter, static today); for `codex-task:` pass `--model <model>` / `--reasoning-effort <effort>` when non-null. Parse the specialty agent's `verdict` (`PASS` / `CONCERNS` / `FAIL`) plus `findings`, then record evidence:

```sh
local-board complete-step <ticket-id> <step-name> --executor <agent> --model <model> --evidence "<VERDICT>: <short summary>"
```

Use the exact `<step-name>` returned by gate-check. `specialty-run` rejects unknown names. Pass `--model` (omit when `model` is null) so `complete-step` composes `<step-name>:<agent>@<model>` server-side and enforces a pinned specialty model exactly like a mandatory action; effort is a dispatch hint only and never appears in the evidence token.

Only after every requested specialty has recorded completion evidence does the orchestrator run `move <ticket-id> <next-status>`.

Specialty evidence is never gated by `routing.doneRequires`; it lives in `completedSteps` for traceability but never blocks closeout. Tickets that run zero specialties still pass `validate` and `move ... done`.

The gate **consultation** is a separate, stricter concern from specialty evidence. When `routing.requireGateConsultation` is `true` (the `init` scaffold default), `move` refuses the three forward transitions out of a gated stage — `ready_for_design`/`designing` → `ready_for_implementation`, `ready_for_implementation`/`implementing` → `ready_for_review`, `ready_for_test`/`testing` → `ready_for_docs` — unless a `gate:<stage>:...` token is recorded for that stage. Backward, lateral (`questions`/`blocked`), and archive/done moves are never gated. If `move` refuses with a "no recorded gate consultation" error, run `gate-check` (and `gate-complete` if the catalog was non-empty) for the named stage, then retry the move.

## Design Review

On a board with `routing.requireDesignReview` on (the `init` scaffold default), a design-review step runs between the design-stage gate-check and the move to `ready_for_implementation`.

Resolve the reviewer:

```sh
local-board design-review-check <ticket-id> --json
```

It returns the `agent` route (default `codex-task:read-only`), `model` (`gpt-5.6-sol`), `effort` (`xhigh`), the resolved `prompt` (`plans/prompts/steps/design_review.md`), and a narrow `ticketContext`. It performs no dispatch and stamps nothing.

Dispatch the reviewer through the returned `agent` route, pinning `model` and passing `effort` (`--reasoning-effort <effort>` for a `codex-task:*` route; the subagent's effort dispatch option for a `claude-subagent:*` route). The reviewer is read-only and return-only.

Parse the **first line** of the reviewer's reply — exactly one verdict token, `PASS` / `CONCERNS` / `FAIL`, followed by any numbered findings. Do not `JSON.parse`; the design-review verdict contract is first-line TEXT, unlike gate-check's JSON.

Record the verdict, using the resolved `agent`/`model` verbatim:

```sh
local-board design-review-complete <ticket-id> --executor <agent> --model <model> --evidence "<VERDICT>: <summary>" --json
```

This records `design-review:<agent>@<model>` and unblocks the forward move (omit `--model` only when the resolver returned a null model).

- **PASS / CONCERNS**: proceed with `move <ticket-id> ready_for_implementation`. CONCERNS are advisory; the orchestrator may proceed at its judgment.
- **FAIL**: `move <ticket-id> ready_for_design` and re-run the design with the findings as input. The loop-back strips the `design-review` token and, with `invalidateOnLoopBack` on (scaffold default), the `design` token too, so the redesigned ticket must re-record both `design` and `design-review` evidence before it can advance again.

On a board with `routing.requireDesignReview` off, skip this step entirely — `design-review-check` refuses with a flag-naming message, and the design→implementation move is not gated.

## Delegation

Use `plans/local-board.config.jsonc` to decide how each action is handled. Comments and trailing commas are valid:

Each entry is a route string or a `{ route, model?, effort?, prompt?, fallbackModels? }` profile. `begin-step` resolves it to `configuredAgent` (route), `configuredModel`, `configuredEffort`, `configuredPrompt`, and — only when the profile lists a non-empty ordered `fallbackModels` — `configuredFallbackModels`, and records the active step for dispatch verification (effort is a dispatch hint only and is not part of the ledger stamp).

- `inline`: do the work in the current agent, on the orchestrator's model. `inline` cannot carry a per-step model or effort.
- `claude-subagent:<agent-name>`: dispatch the named Claude subagent. When `configuredModel` is set, pin the subagent's model to it at dispatch — this is how per-step models (haiku gate-check, opus design, sonnet implement, etc.) take effect. When `configuredEffort` is set, pass it as the subagent dispatch's effort option (the Claude harness's per-agent reasoning-effort control).
- `codex-task:<mode>`: use codex-task in the configured mode, such as `codex-task:read-only` or `codex-task:workspace-write`. `codex-task` dispatches are serial-by-design: never background one with a shell `&` (concurrent `CODEX_HOME` use corrupts session state) — use the harness's own background/spawn dispatch when you need concurrency. When `configuredEffort` is set, pass `--reasoning-effort <effort>` to the codex-task wrapper.

If the routing-validator hook denies a dispatch with an agent-mismatch reason, first
confirm you ran `begin-step` for the ticket's CURRENT stage before dispatching — the
active begin-step ledger stamp is the hook's primary evidence, and a stale or missing
stamp (e.g. dispatching a stage you never began, or re-dispatching after a loop-back) is
the usual cause. Re-run `begin-step` for the current action, then retry the dispatch.

Bundled Claude subagent names:

- `local-board-decomposer`
- `local-board-designer`
- `local-board-gatecheck`
- `local-board-implementer`
- `local-board-reviewer`
- `local-board-tester`
- `local-board-documenter`

### Persisting Delegated Output

The `local-board-reviewer`, `local-board-tester`, `local-board-decomposer`, and `local-board-gatecheck` subagents have only Read, Glob, Grep, and Bash. They have no Write or Edit tool and are return-only:

- They return their section content — Review Findings, Test Evidence — or strict JSON (gate-check `requestedSteps`) in their final message.
- They do not create files and do not run `section` themselves.
- The orchestrator takes that returned content, writes it to a temp file with the Write tool, and runs `section <ticket-id> --file <temp-path> --section "<Section>"` itself.
- For decomposition, the decomposer returns a child-ticket proposal; the orchestrator runs `create`, `link-parent`, `link-child`, and dependency commands, then persists each child's proposed `Requirement` (with acceptance criteria) via `section --file`.

Never instruct a return-only subagent to "write a temp file" or "use the Write tool". It cannot, and it falls back to Bash `echo`/heredoc/`Set-Content`, which loops endlessly on backtick and code-fence escaping. The same return-only contract applies to any `codex-task:read-only` route.

The `local-board-designer`, `local-board-implementer`, and `local-board-documenter` subagents have Write and Edit. They persist their own output — the designer writes its own `Technical Design` section and returns a terse summary; the implementer and documenter write their file changes. All three use Write and Edit, never Bash redirection.

Whenever a CLI command needs a file argument (such as `section --file`), create that file with the Write tool. Never build it with `echo`, heredoc, `Set-Content`, or `Out-File`.

The orchestrator remains responsible for canonical ticket state unless a delegated worker was explicitly assigned write scope.

Every dispatched executor works in a ticket worktree that may hold uncommitted, orchestrator-owned ticket state: instruct it to revert probe edits by targeted path only (`git checkout -- <file>` / `git restore <file>`) and to never run tree-wide or branch/history-mutating git inside the worktree — no tree-wide reverts, cleans, stashes, resets, merges, rebases, or branch switches.

When recording completion evidence, pass `--executor <configuredAgent> --model <configuredModel>` verbatim from `begin-step` (omit `--model` when `configuredModel` is null); `complete-step`/`gate-complete` compose the `<route>@<model>` token server-side — for example `claude-subagent:local-board-designer` + `--model opus` records `claude-subagent:local-board-designer@opus`. The combined `--executor <route>@<model>` form remains equivalent and accepted for back-compat. Strict routing matches the route, and when the route matches and a model is pinned, also requires the recorded model to match (or `codex-default`, or an approved deviation — see below).

If the configured agent is unavailable, do not continue inline by default. Ask the user for approval. If approved, run:

```sh
local-board approve-inline <ticket-id> <action> --reason "<user-approved reason>"
```

Then run `complete-step` with `--executor inline`. If the user does not approve the deviation, move the ticket to `questions` and record the blocker.

If instead the route is fine but the pinned model is unavailable (e.g. `opus` unavailable, running `sonnet`), approve the model deviation while keeping the route:

```sh
local-board approve-inline <ticket-id> <action> --executor <configuredAgent>@<actualModel> --reason "<user-approved reason>"
```

Then run `complete-step` with `--executor <configuredAgent> --model <actualModel>`.

When the action's (or consultation's) profile surfaces a raw fallback list, a capacity/unavailability failure of the pinned model does not require user approval. Retry the pinned model once; if it still fails, dispatch each fallback entry **in order**, keeping the same route and carrying the configured effort over unchanged. On the first success, record `complete-step`/`gate-complete`/`design-review-complete` with `--model <fallbackModel>` — strict routing accepts it because the model is a sanctioned fallback (no `approve-inline`). Only if the pin and every fallback are exhausted, fall back to the approve-inline / `questions` path above — never invent an unconfigured model. This walk applies to all four dispatch commands: `begin-step`'s `configuredFallbackModels`, and the `gate-check` / `specialty-run` / `design-review-check` payloads' top-level `fallbackModels` (present only when the resolved profile lists one). `design-review-check` stamps the ledger for a `claude-subagent:` reviewer route **only when the reviewer profile lists fallbacks**, so the hook authorizes the reviewer (and any configured fallback) dispatch on that path — a fallback-free `claude-subagent:` design-review route is a known, separately-tracked limitation (the hook rejects it; `codex-task:` design-review, the default, is unaffected).

## CLI Commands

```sh
local-board --version
local-board where [--json]
local-board validate
local-board query-next --json
local-board query-ticket <ticket-id> --json
local-board state-report --json
local-board schema --json
local-board create <epic|story|task|bug> "<title>" --status <status> --priority <priority> [--parent <id>]
local-board start-work <ticket-id> [--branch <branch>] [--allow-dirty] [--json]
local-board worktree-add <ticket-id> [--json]
local-board worktree-remove <ticket-id> [--force] [--json]
local-board fast-forward [--json]
local-board begin-step <ticket-id> [--action <action>] [--harness claude|codex] [--json]
local-board check-dispatch --agent <subagent-type> [--model <model>] [--ticket <ticket-id>] [--json]
local-board complete-step <ticket-id> <action> --executor <executor> [--model <model>] --evidence "<evidence>" [--json]
local-board approve-inline <ticket-id> <action> --reason "<reason>" [--executor <executor>] [--json]
local-board gate-check <ticket-id> --stage <stage> [--json]
local-board gate-complete <ticket-id> --stage <stage> --executor <executor> [--model <model>] [--evidence "<evidence>"] [--json]
local-board specialty-run <ticket-id> <step-name> [--json]
local-board design-review-check <ticket-id> [--json]
local-board design-review-complete <ticket-id> --executor <executor> [--model <model>] --evidence "<evidence>" [--json]
local-board calibration suggest <ticket-id> [--json]
local-board estimate <ticket-id> <points> [--basis <ticket-id-or-bootstrap>] [--force] [--json]
local-board move <ticket-id> <status> [--override] [--reason "<text>"] [--json]
local-board promote <ticket-id> [--to <status>] [--json]
local-board set <ticket-id> <field> <value> [--override] [--reason "<text>"]
local-board section <ticket-id> "<text>" --section "<section>"
local-board section <ticket-id> --file <path> --section "<section>"
local-board comment <ticket-id> "<text>" [--section "<section>"]
local-board comments <ticket-id> [--section "<section>"] [--marker key=value ...] [--json]
local-board link-parent <child-id> <parent-id>
local-board link-child <parent-id> <child-id>
local-board unlink-parent <child-id> <parent-id>
local-board block <ticket-id> <dependency-id>
local-board unblock <ticket-id> <dependency-id>
```

This block is the single-ticket command surface, not the full CLI. Run `local-board` with no arguments for complete usage, `schema --json` for accepted enums, and `where --json` for asset paths. `worktree-list`, `team-config`, and `list` live in the parallel (`local-team`) skill. Do not inspect source to discover commands.

Use `comment` for run-log style notes. Use `move` for status transitions. Use relationship commands for parent/child and dependency state.
Use `section --file <path>` for generated or multi-line Markdown. Inline `section <text>` is only for short edits. Create the `--file` target with the Write tool; never build it with `echo`, heredoc, `Set-Content`, or `Out-File`. The payload is the section body only — do not include the section's own `## Heading`; fence any literal `## ` sample lines.
Use `blockedBy` for ticket dependencies without moving the dependent ticket to `blocked`.
