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
Use `section --file <path>` for generated or multi-line Markdown. Inline `section <text>` is best for short one-line edits.
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

`plans/local-board.config.jsonc` maps actions to agents. Supported values are conventions interpreted by the orchestration skill and strict routing validator:

- `inline`
- `claude-subagent:<agent-name>`
- `codex-task:<mode>`

Current Codex examples include `codex-task:read-only` and `codex-task:workspace-write`; projects may add more specific modes.

If a configured agent is unavailable, the orchestrator should ask the user before falling back. Inline fallback requires `approve-inline`.

Bundled Claude agents:

- `local-board-decomposer`
- `local-board-designer`
- `local-board-implementer`
- `local-board-reviewer`
- `local-board-tester`
- `local-board-documenter`

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

- `name`: required lowercase snake_case identifier, unique within the stage. It cannot reuse a mandatory action name such as `design`, `implement`, `review`, or `test`.
- `prompt`: required repo-relative path to the specialty prompt, normally under `plans/prompts/optional-steps/<stage>/`. Config loading validates the string but does not require the file to exist.
- `triggers`: required human-readable guidance for deciding when the specialty applies.
- `agent`: optional route override using the same conventions as mandatory action routing: `inline`, `claude-subagent:<agent-name>`, or `codex-task:<mode>`. Omitted entries run inline.

The catalog is config surface only for now. Pending tickets T20260516T1551Z (`gate-check`) and T20260516T1552Z (`specialty-run`) add runtime behavior that reads this catalog from the schema/config output.

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
