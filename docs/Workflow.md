# Workflow

The local board mimics a kanban pipeline using ticket status and folders.

## Priority Selection

The orchestrator asks the CLI for deterministic dispatch:

```sh
node ./bin/local-board.js query-next --json
```

For a specific ticket:

```sh
node ./bin/local-board.js query-ticket T20260514T1234Z --json
```

The result includes the ticket path, action, prompt, configured agent, transition guidance, and eligibility.

For a board-level state summary:

```sh
node ./bin/local-board.js state-report --json
```

For the machine-readable workflow contract:

```sh
node ./bin/local-board.js schema --json
```

A ticket is eligible when:

- its status is a trigger status;
- all `blockedBy` tickets are done or archived;
- it is not waiting on user questions;
- it is not already active.

Current trigger statuses are:

- `ready_for_decomposition`
- `ready_for_design`
- `ready_for_implementation`
- `ready_for_review`
- `ready_for_test`
- `ready_for_docs`

`backlog` is not selected by `next`; move a ticket to a ready status when it should enter the automation queue.

Ticket dependencies should not use `status: blocked`. Keep the dependent ticket in its intended ready status and record the dependency with `block <ticket-id> <dependency-id>`. The ticket will become eligible automatically when every `blockedBy` ticket is `done` or `archived`.

Priority order is `P0`, `P1`, `P2`, `P3`, then `P4`. Ties use configured pipeline order, then oldest `created`, then ticket ID.

Pipeline order and action dispatch live in `plans/local-board.config.jsonc`. Comments and trailing commas are allowed.

## Transition Guidance

`plans/local-board.config.jsonc` includes `workflow.transitions`.

The CLI returns the relevant transition list from `query-next --json`, `query-ticket <id> --json`, and `begin-step <id> --json`. Each transition includes:

- `status`: exact status to pass to `move`;
- `when`: the condition for choosing it.

This is advisory guidance for the orchestrator. It keeps normal decisions explicit while preserving manual recovery moves.

Typical review outcomes:

- no blocking findings: move to `ready_for_test`;
- implementation defects or gaps: move to `ready_for_implementation`;
- fundamental design issue: move to `ready_for_design`;
- user input needed: move to `questions`;
- ticket dependency: use `block` and keep or return to the intended ready status;
- non-ticket blocker: move to `blocked`.

## Decomposition

Epics decompose into stories.

Stories decompose into tasks.

Generated child tickets should link back to the parent and should be committed as planning changes.

## Task and Bug Flow

1. Cross-reference related tickets.
2. Write technical design.
3. Ask questions if blocked by ambiguity.
4. Create or switch to the ticket branch with `start-work`.
5. Run `begin-step` for the current action.
6. Execute the action through the configured agent route.
7. Run `complete-step` with executor and evidence.
8. Move to the next status using the returned transition guidance.
9. Repeat the query/begin/execute/complete/move loop for review, test, and docs.
10. Commit non-planning changes.
11. Mark ticket done with `move <ticket-id> done`.
12. Merge and push according to policy.

## Wall-Clock Work Tracking

`start-work` sets `workStartedAt` the first time it is called for a ticket. Later `start-work` calls leave the original timestamp unchanged, including after a ticket returns from `questions` or `blocked`.

`move <ticket-id> done` sets `workCompletedAt` when the field is null and `workStartedAt` is already set. Later moves to `done` preserve the original completion timestamp. A direct move to `done` without prior `start-work` leaves both `workStartedAt` and `workCompletedAt` null to preserve the validator invariant that completion requires a start timestamp.

Wall-clock actual is `workCompletedAt - workStartedAt`. It intentionally includes time spent in intermediate statuses such as `questions` and `blocked`. Archiving done tickets does not change either wall-clock field.

## Human Questions

When work needs user input, set `status: questions` and write the questions in the `## Questions` section.

The user answers in the ticket or chat, then moves the ticket back to an eligible status.

## MVP Commands

```sh
node ./bin/local-board.js validate
node ./bin/local-board.js list
node ./bin/local-board.js next
node ./bin/local-board.js schema --json
node ./bin/local-board.js create story "Ticket parser" --status backlog --priority P2
node ./bin/local-board.js start-work T20260514T1234Z --json
node ./bin/local-board.js start-work T20260514T1234Z --branch preseeded/ticket-parser --json
node ./bin/local-board.js begin-step T20260514T1234Z --json
node ./bin/local-board.js check-dispatch --agent local-board-implementer --model sonnet --ticket T20260514T1234Z
node ./bin/local-board.js complete-step T20260514T1234Z review --executor codex-task:read-only --evidence "Review findings recorded."
node ./bin/local-board.js approve-inline T20260514T1234Z review --reason "User approved fallback."
node ./bin/local-board.js move T20260514T1234Z ready_for_design
node ./bin/local-board.js move T20260514T1234Z done --json
node ./bin/local-board.js set T20260514T1234Z branch feature/T20260514T1234Z-ticket-parser
node ./bin/local-board.js section T20260514T1234Z "Use the existing parser." --section "Technical Design"
node ./bin/local-board.js section T20260514T1234Z --file /tmp/design.md --section "Technical Design"
node ./bin/local-board.js comment T20260514T1234Z "Design pass complete." --section "Run Log"
node ./bin/local-board.js link-child E20260514T1234Z S20260514T1235Z
node ./bin/local-board.js block T20260514T1237Z T20260514T1236Z
```

Use `move` for status transitions. Do not use `set status`; it delegates to the same move behavior so folder placement stays consistent.
Use `section --file <path>` for generated or multi-line Markdown. Inline `section <text>` is best for short one-line edits. Create the `--file` target with the Write tool; never build it with `echo`, heredoc, `Set-Content`, or `Out-File`.
Use `block` and `unblock` for ticket dependencies. Do not move dependency-blocked tickets to `blocked`; that status is reserved for non-ticket blockers.

## Branch Handling

Use `start-work` before implementation and before review/test/docs work that must inspect or edit ticket changes.

`start-work`:

- uses the ticket's recorded `branch` when present;
- accepts `--branch <branch>` for pre-seeded work;
- creates the branch when it does not exist;
- switches to an existing local branch when it does exist;
- records the branch in front matter;
- appends a `## Run Log` entry;
- moves `ready_for_implementation` tickets to `implementing`;
- refuses to switch to an existing branch with a dirty worktree unless `--allow-dirty` is supplied.

## Agent Routing

`plans/local-board.config.jsonc` maps actions to agents. Each entry is a route
string or a `{ route, model?, prompt? }` profile; a bare string is sugar for
`{ route }`. Supported `route` values are conventions interpreted by the
orchestration skill and strict routing validator:

- `inline`
- `claude-subagent:<agent-name>`
- `codex-task:<mode>`

`model` pins the per-step model for subagent and codex routes — a model alias
(`opus`/`sonnet`/`haiku`) or a full id (`claude-opus-4-6`); for codex routes it is
a codex model selector. A model on an `inline` route is rejected, because inline
runs on the orchestrator's own model — route a step to a subagent to pin its
model. `prompt` overrides `workflow.actionPrompts` for that action.

`begin-step --json` resolves the entry to `configuredAgent` (route),
`configuredModel`, and `configuredPrompt`. When the orchestrator dispatches a
subagent route it pins the subagent to `configuredModel`; per-step models only
take effect on subagent/codex routes. Completion evidence may record the model
that ran as `<route>@<model>` (for example
`design:claude-subagent:local-board-designer@opus`). Strict routing matches the
route, and — at `complete-step` write time, when the route matches and the
action's profile pins a model — also requires the `@model` suffix to match
`configuredModel` (or `@codex-default`, or an approved deviation recorded via
`approve-inline --executor <route>@<model>`). Done-time re-validation stays
route-only for back-compat with evidence recorded before this rule.

For dispatch verification, `begin-step` also records the ticket's active action,
route, and model in `.local-board/active-steps.json` in the main checkout, so
linked worktrees share one ledger. `check-dispatch --agent [--model] [--ticket]`
reads that ledger for hook callers, prints a JSON verdict to stdout, and exits
0 for allow, 1 for deny, or 2 for error. `complete-step` and `approve-inline`
clear the ticket's active ledger entry.

Current Codex examples include `codex-task:read-only` and `codex-task:workspace-write`; projects may add more specific modes.

If a configured agent is unavailable, the orchestrator should ask the user before falling back. Inline fallback requires `approve-inline`.

Bundled Claude agents (each pins a default model in its frontmatter; config
`model` overrides it at dispatch):

- `local-board-decomposer` (opus)
- `local-board-designer` (opus; self-writes its `Technical Design` section)
- `local-board-gatecheck` (haiku; returns specialty `requestedSteps` JSON)
- `local-board-implementer` (sonnet)
- `local-board-reviewer` (sonnet)
- `local-board-tester` (sonnet)
- `local-board-documenter` (sonnet)

### Dispatch enforcement hooks

`local-board install --hooks` (opt-in; off by default) wires four Claude Code
hooks into the user's `~/.claude/settings.json`, installed alongside the
runtime at `~/.local-board/hooks/`:

- **`dispatch-ledger.js`** (`PostToolUse`, matcher `Task|Agent`) appends
  `{ts, subagent_type, model, ticketId, session_id}` to
  `.local-board/dispatch-ledger.jsonl` for every subagent dispatch, keyed off a
  `Ticket: <id>` first line in the dispatch prompt (see Agent Routing above).
- **`routing-validator.js`** (`PreToolUse`, matcher `Task|Agent`) runs
  `check-dispatch` before a `local-board-*` subagent dispatch and denies a
  computed route/model mismatch.
- **`evidence-gate.js`** (`PreToolUse`, matcher `Bash`) denies a `complete-step`
  call claiming a `claude-subagent:*` executor with no matching dispatch-ledger
  entry in the current session.
- **`approve-inline-consent.js`** (`PreToolUse`, matcher `Bash`) turns
  `approve-inline` into a `permissionDecision: "ask"`, making the Claude Code
  permission prompt the deterministic human approval for that routing
  deviation.

All four hooks fail open: an unexpected error, a missing/unreachable CLI, or
an ambiguous `check-dispatch` exit code (2) allows the dispatch rather than
blocking it, with a warning reason surfaced to the model where applicable.
`complete-step`'s own strict-routing validation remains the authoritative,
CLI-side backstop regardless of hook state.

Documented limits: inline work produces no tool call, so hooks cannot see it;
a skipped step produces no event; a same-session loop-back through a step can
still satisfy the evidence gate from an earlier iteration's ledger entry
(CLI-side loop-back invalidation is a separate concern); Codex has no
deny-hook equivalent, so Codex enforcement stays CLI-side. The ledger file is
append-only JSONL with no rotation or write-locking in v1 — entries are small
and unlocked concurrent writes are a known, low-impact race.

## Optional Steps

`plans/local-board.config.jsonc` may include an `optionalSteps` catalog keyed by stage:

```jsonc
{
  "optionalSteps": {
    "design": [
      {
        "name": "security_threat_model",
        "prompt": "plans/prompts/optional-steps/design/security_threat_model.md",
        "triggers": "Auth, authorization, cryptography, external API integrations, PII handling, new attack surface."
      }
    ],
    "implement": [],
    "test": []
  }
}
```

Each stage contains entries shaped `{ name, prompt, triggers, agent? }`.

- `name`: required lowercase snake_case identifier, unique across all stages (routing resolves a specialty step by name across stages). It cannot reuse a mandatory action name such as `design`, `implement`, `review`, or `test`.
- `prompt`: required repo-relative path to the specialty prompt, normally under `plans/prompts/optional-steps/<stage>/`. Fresh `init` scaffolds the packaged prompts, and `specialty-run` reports an actionable error if a configured prompt file is missing.
- `triggers`: required human-readable guidance for deciding when the specialty applies.
- `agent`: optional route override using the same conventions as mandatory action routing: `inline`, `claude-subagent:<agent-name>`, or `codex-task:<mode>`. Omitted entries run inline.

### Catalog

The v1 specialty prompt catalog is a snapshot ported from the task-board project.

- `plans/prompts/optional-steps/design/security_threat_model.md`: design-stage threat model review for auth, authorization, cryptography, external integrations, PII, and new attack surface.
- `plans/prompts/optional-steps/design/ui_component_review.md`: design-stage UI component review for component APIs, state, accessibility, reusability, and design-system fit.
- `plans/prompts/optional-steps/design/ux_interaction_review.md`: design-stage interaction review for user flows, edge states, feedback, keyboard behavior, and workflow ergonomics.
- `plans/prompts/optional-steps/impl/security_audit.md`: implementation-stage security audit for concrete code risks and severity-ranked findings.
- `plans/prompts/optional-steps/impl/ui_visual_review.md`: implementation-stage visual review for rendered UI polish, layout, responsive behavior, accessibility, and regressions.

### Gate-check

Resolve the gate-check prompt and stage catalog with:

```sh
local-board gate-check <ticket-id> --stage <stage> [--json]
```

`<stage>` must be one of `design`, `implement`, or `test`.

With `--json`, the command returns:

```json
{
  "ticket": "<ticket-id>",
  "stage": "implement",
  "prompt": "<absolute-path-to-plans/prompts/steps/gate-check.md>",
  "agent": "claude-subagent:local-board-gatecheck",
  "model": "haiku",
  "ticketPath": "plans/tickets/ready/<ticket-file>.md",
  "ticketContext": {
    "id": "<ticket-id>",
    "type": "task",
    "status": "ready_for_test",
    "priority": "P2",
    "path": "plans/tickets/ready/<ticket-file>.md",
    "title": "<title>",
    "currentAction": "test",
    "requirement": "<Requirement section text>",
    "acceptanceCriteria": "<Acceptance Criteria section text>"
  },
  "catalog": [
    {
      "name": "security_audit",
      "prompt": "plans/prompts/optional-steps/implement/security_audit.md",
      "triggers": "Auth, authorization, cryptography, external API integrations, PII handling, new attack surface."
    }
  ]
}
```

The CLI is a read-only resolver. It does not invoke an agent and does not decide which optional steps are required. If `catalog` is empty, the orchestrator skips gate-agent dispatch. Otherwise it dispatches the returned `prompt`, `catalog`, and narrow `ticketContext` to the configured gate-check `agent`, pinning its `model` (the bundled `local-board-gatecheck` agent on `haiku` by default). That agent pattern-matches the completed work against the catalog trigger criteria and returns strict JSON shaped:

```json
{ "requestedSteps": ["security_audit"] }
```

An empty `requestedSteps` array means no specialty step is needed. T20260516T1552Z (`specialty-run` dispatcher) consumes each requested step name to resolve the specialty prompt/agent. T20260516T1554Z (`orchestrator wiring`) consumes the whole gate-check handoff pattern in the local-board orchestration flow.

### Specialty-run

Resolve one requested optional step with:

```sh
local-board specialty-run <ticket-id> <step-name> [--json]
```

The command derives the specialty stage from the ticket status:

| Ticket status | Stage |
|---|---|
| `designing` | `design` |
| `ready_for_design` | `design` |
| `implementing` | `implement` |
| `ready_for_implementation` | `implement` |
| `testing` | `test` |
| `ready_for_test` | `test` |

Other statuses are rejected. `<step-name>` must match an entry in `config.optionalSteps[stage]`.

With `--json`, the command returns:

```json
{
  "ticket": "<ticket-id>",
  "stage": "implement",
  "step": "security_audit",
  "prompt": "<absolute-path-to-specialty-prompt>",
  "agent": "inline",
  "ticketPath": "plans/tickets/ready/<ticket-file>.md",
  "ticketContext": {
    "id": "<ticket-id>",
    "type": "task",
    "status": "ready_for_implementation",
    "priority": "P2",
    "path": "plans/tickets/ready/<ticket-file>.md",
    "title": "<title>",
    "currentAction": "implement",
    "requirement": "<Requirement section text>",
    "acceptanceCriteria": "<Acceptance Criteria section text>"
  }
}
```

`agent` defaults to `inline` when the optional step entry has no override. The CLI is a read-only dispatcher: it does not invoke any agent. The orchestrator hands the returned `prompt`, `agent`, and `ticketContext` to the resolved execution route, then records completion with the normal step evidence flow. T20260516T1554Z (`orchestrator wiring`) will connect this resolver to the gate-check `requestedSteps` loop.

## Estimation

`plans/local-board.config.jsonc` may include an `estimation` block:

```jsonc
{
  "estimation": {
    "enabled": true,
    "scale": [1, 2, 4, 8],
    "bootstrapDefault": 4,
    "splitThreshold": 16
  }
}
```

- `enabled`: turns estimation behavior on for projects that opt in.
- `scale`: allowed relative story point values, as a strictly ascending array of positive integers.
- `bootstrapDefault`: first-ticket anchor value when no calibration ticket exists. It must be a member of `scale`.
- `splitThreshold`: value at or above which estimation should flag the ticket for decomposition.

Legacy configs that omit `estimation` load with `enabled: false` so existing projects do not silently turn on estimation behavior during upgrade. Freshly initialized projects include the block with `enabled: true`.

### Design-step enforcement

`complete-step` enforces estimates at design completion. It refuses the call only when all four conditions are true:

- the action is `design`;
- the ticket type is `task` or `bug`;
- `estimation.enabled` is `true`;
- the ticket `estimate` is `null`.

Stories and epics are exempt because they feed decomposition and planning decisions differently. Projects with `estimation.enabled: false` bypass the gate, and non-design actions continue through the normal routing evidence flow.

When the gate refuses completion, it leaves the ticket unchanged and prints a clear message naming `local-board estimate` as the command to record the missing estimate. After recording an estimate, rerun `complete-step` with the same design evidence.

### Prompts

The estimator role prompt lives at `plans/prompts/roles/estimator.md`. It defines relative story point sizing against a calibration ticket or the `bootstrap` anchor.

The estimate step prompt lives at `plans/prompts/steps/estimate.md`. The design prompt calls this step after writing the Technical Design and before the orchestrator runs `complete-step design`, so task and bug designs record an estimate before the enforcement gate.

### CLI

Record an estimate with:

```sh
local-board estimate <ticket-id> <points> [--basis <ticket-id-or-bootstrap>] [--force] [--json]
```

- `<ticket-id>` is the ticket to estimate.
- `<points>` must be a value from `estimation.scale`.
- `--basis <ticket-id-or-bootstrap>` records the calibration basis. It defaults to `bootstrap`.
- `--force` overwrites an existing estimate and estimate basis.
- `--json` prints the result as JSON.

The command refuses to overwrite an existing estimate unless `--force` is supplied. It writes `estimate` first and `estimateBasis` second so the front matter remains in canonical field order.

Example:

```sh
local-board estimate T20260516T1545Z 4 --basis bootstrap --json
```

### Calibration auto-pick

Suggest a calibration basis with:

```sh
local-board calibration suggest <ticket-id> [--json]
```

The command builds a pool of `done` tickets with the same `type` as the target ticket. Pool tickets must have non-null `estimate`, `workStartedAt`, and `workCompletedAt` fields. It sorts the pool estimates and uses the lower median as the target value. For an even-sized pool, this means the lower of the two middle estimates.

It returns the pool ticket whose estimate has the smallest absolute difference from the lower median. If multiple tickets tie, it picks the one with the most recent `workCompletedAt`. If the pool is empty, it returns the `bootstrap` sentinel so the estimator can use `estimation.bootstrapDefault`.

Without `--json`, the command prints only the recommended calibration ticket ID or `bootstrap`.

JSON output is shaped:

```json
{ "ticket": "<ticket-id>", "calibration": "<ticket-id-or-bootstrap>", "poolSize": 0, "median": null, "reason": "<reason>" }
```

Example:

```sh
local-board calibration suggest T20260516T1546Z --json
```

```json
{
  "ticket": "T20260516T1546Z",
  "calibration": "T20260516T1545Z",
  "poolSize": 5,
  "median": 4,
  "reason": "selected same-type done ticket nearest the lower median"
}
```

## Strict Routing

`routing.strict: true` makes configured routing mandatory.

Before each action, use `begin-step` to read the configured executor. After the action, use `complete-step` to record `<action>:<executor>` evidence in front matter. A non-inline configured route cannot be completed as `inline` unless `approve-inline` has first recorded explicit user approval.

`move <ticket-id> done` validates required completion evidence for new tickets that include `completedSteps`/`routingApprovals`.

## Auto-Merge Policy

`plans/local-board.config.jsonc` controls closeout behavior:

- `git.defaultBranch`: `null` auto-detects `origin/HEAD`, `main`, then `master`; a string pins the branch name.
- `git.commitPlanningChanges`: when `true`, auto-merge commits planning-only ticket updates before merging.
- `git.autoMerge`: when `true`, `move <ticket-id> done` merges the recorded ticket branch into the default branch.

Auto-merge only runs after `move ... done` passes strict routing validation. It must be run from the ticket's recorded branch. It refuses uncommitted non-planning changes, because implementation work should already be committed before closeout.

## Done Retention

`done` is the recent closeout lane. `archived` is retained closed history.

`plans/local-board.config.jsonc` controls retention:

- `retention.archiveDoneAfterDays`: default `30`.
- `retention.archiveOnMoveDone`: default `true`.

When enabled, `move <ticket-id> done` archives other done tickets whose `updated` timestamp is older than the retention window. Read-only commands do not archive tickets. Archived tickets still count as complete for dependency checks.
