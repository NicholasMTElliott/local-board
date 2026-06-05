# Per-Step Orchestration (Design Proposal)

Status: **draft / brainstorming.** This proposes replacing the agent-teams
teammate layer with a single top-level orchestrator that dispatches each
pipeline step to an ephemeral, model-specialized executor. It is not yet
implemented and the schema below is provisional.

## Motivation

Team mode today assigns one teammate per ticket. A teammate is a Claude Code
subagent, and the harness forbids a subagent from spawning further subagents.
Consequences:

- Every step of a ticket runs on the teammate's single session model. Per-step
  model selection is impossible; `claude-subagent:*` routes degrade to inline.
- The per-agent `model:` frontmatter on the bundled agents has no effect in team
  mode, because those agents are never spawned.

The goal is **parallel ticket work with full per-step variety**: each step may
use a distinct model, prompt, and route (including a whole step delegated to an
external agent such as codex).

### Validated hinge

A spike confirmed the load-bearing assumption: from a top-level (non-subagent)
session, three subagents dispatched in one message on `haiku`, `opus`, and
`sonnet` each ran on the requested model (self-confirmed by exact model id),
executed independently, and reported back via interleaved completion
notifications (one foreground, two backgrounded). Per-step model override and
background-dispatch concurrency both work. See the run log in the design ticket.

## Core idea

| Concern | Team mode (today) | Per-step orchestration (proposed) |
|---|---|---|
| Who owns a ticket | one teammate, end to end | the orchestrator; no per-ticket session |
| Model boundary | the ticket (one model) | the step (any model) |
| Executors | persistent teammate subagents | ephemeral per-(ticket, step) executors |
| Durable state between steps | teammate context | the ticket file + worktree (the baton) |
| Concurrency | many teammate sessions | one orchestrator, background-dispatched steps |
| Conflict avoidance | peer `BRANCH-READY` broadcasts | centralized pre-merge by the orchestrator |
| Spawn power | none (teammate is a subagent) | full (orchestrator is top-level) |

Because local-board state is durable on disk, an executor only needs to switch
into the ticket's worktree (`--root`), do its one step, and report. No session
must stay warm between steps. This also **unifies single-ticket and team mode**:
"team" is just concurrency > 1 on the same orchestrator.

Worktree-per-ticket isolation is **retained** — each executor `--root`s into the
ticket worktree exactly as teammates do today. Nothing here justifies changing
it.

## 1. Execution profile schema

Today `agents` maps an action to a route string. Extend each entry to a profile
object carrying `route`, optional `model`, and optional `prompt`.

```jsonc
"agents": {
  "decompose":  { "route": "claude-subagent:local-board-decomposer", "model": "opus" },
  "gate-check": { "route": "claude-subagent:local-board-gatecheck",   "model": "haiku" },
  "design":     { "route": "claude-subagent:local-board-designer",    "model": "opus" },
  "implement":  { "route": "claude-subagent:local-board-implementer", "model": "sonnet" },
  "review":     { "route": "codex-task:read-only",                    "model": "gpt-5.5" },
  "test":       { "route": "claude-subagent:local-board-tester",      "model": "claude-opus-4-6" },
  "document":   { "route": "codex-task:workspace-write" }
}
```

### Fields

- `route` (required): existing vocabulary — `inline`, `claude-subagent:<name>`,
  or `codex-task:<mode>`.
- `model` (optional): the per-step model.
  - For `claude-subagent:*`: an alias (`opus`/`sonnet`/`haiku`) or a full id
    (`claude-opus-4-6`). Passed to the dispatch `model` parameter, overriding the
    agent's frontmatter default.
  - For `codex-task:*`: a codex model selector, a **separate namespace**. The
    validator must not check it against Claude aliases.
  - For `inline`: meaningless and **rejected** by the validator (see below).
- `prompt` (optional): repo-relative override of the action's default step
  prompt. Omitted → the existing `workflow.actionPrompts[action]` is used.

### Backward compatibility

A plain string value is sugar for `{ "route": "<string>" }` with the model taken
from the named agent's frontmatter. Existing configs load unchanged. No config
`version` bump required as long as the loader accepts both forms.

### Key consequence: `inline` cannot carry a per-step model

`inline` means "the orchestrator does it in its own context," so it is fixed to
the orchestrator's model. **Any step that needs a specific model must use a
subagent route.** Practical fallouts:

- Gate-check was inline (the orchestrator pattern-matched the catalog).
  **Decided:** a return-only `local-board-gatecheck` agent now owns it, pinned to
  `haiku`, emitting the `{ "requestedSteps": [...] }` JSON. The agent ships in
  `agents/claude/` alongside the other bundled agents.
- `inline` stays valid and cheap for steps that are fine on the lead model.

### Evidence and CLI surface

- `begin-step` returns the **full resolved profile** (`route`, `model`, `prompt`
  path, plus the existing ticket context) so the orchestrator has everything it
  needs to dispatch deterministically.
- `complete-step` evidence extends from `<action>:<route>` to an optional
  `<action>:<route>@<model>` form (e.g.
  `design:claude-subagent:local-board-designer@opus`). The `@<model>` suffix is
  optional so existing evidence parses unchanged; strict-routing validation
  ignores the suffix when matching the configured route.

### Deferred: conditional profiles

A single action may eventually want different models by ticket type or size
(e.g. large design → opus, small → sonnet). That is a profile **selector** layer
on top of this static schema and is explicitly out of scope for v1.

## 2. Orchestrator control loop

The orchestrator is the top-level Claude session. It performs **no step work
itself** except `inline` steps; it owns all ticket-state mutations and all
cross-ticket coordination.

### State held in context (small N)

- `inFlight`: `ticketId -> { action, status, branch, worktreePath, executorId | null, profile, touchedFiles }`
- `readyQueue`: ready tickets not yet picked up (from `list --ready`)
- `branchReady`: `ticketId -> changedFiles[]` for tickets at/after `ready_for_review`
- `assignedLog`: every ticket processed this session (for the final summary)
- `maxInFlight`: concurrency cap (reuse `team-config` / `LOCAL_BOARD_MAX_TEAMMATES`)

### Responsibility split

- **Executor** does the actual work and returns a structured result. Self-writing
  executors (implementer, documenter) edit files and commit **in the worktree**.
  Return-only executors (designer, reviewer, tester, gate-check, codex read-only)
  return section content / verdict JSON and write nothing.
- **Orchestrator** owns every CLI state mutation — `start-work`, `begin-step`,
  `complete-step`, `move`, `section` (for return-only output), `approve-inline`,
  closeout — plus conflict pre-merge decisions and worktree lifecycle.

This is cleaner than today: the lead becomes the single transition authority,
executors are pure work units.

### Loop

1. **Seed.** `validate`; resolve config and `maxInFlight`; `list --ready`. For
   each of up to `maxInFlight` ready tickets: `worktree-add`, `start-work`, add
   to `inFlight`.
2. **Dispatch.** For each in-flight ticket with no outstanding executor and not
   gated on a pending peer-merge: `begin-step` to get the action + profile, then:
   - `inline` → the orchestrator performs the step itself.
   - `claude-subagent:<name>` → dispatch a background executor with
     `model = profile.model` and the rendered step prompt, scoped to the
     worktree via `--root`.
   - `codex-task:<mode>` → shell out to codex via Bash (optionally backgrounded);
     the return-only contract applies to `read-only`.
   Record `executorId`.
3. **Await.** Yield. Process completion notifications as they arrive (event
   loop). Inline/foreground steps return immediately.
4. **On completion** for ticket T:
   - Return-only result → orchestrator writes a temp file, `section --file`,
     then `complete-step <action> --executor <route>@<model> --evidence ...`
     (with `approve-inline` first when an executor had to run inline in a pinch).
   - Self-writing result → the executor already committed in the worktree;
     orchestrator records `complete-step` evidence.
   - Choose the next status from `complete-step` transition guidance and `move`.
   - If T continues to another ready step, leave it in-flight and dispatch its
     next step. If T reaches `questions`/`blocked`, surface it, drop from
     in-flight, keep in `assignedLog`.
5. **Conflict handling — two layers.** Centralized pre-merge replaces the
   `BRANCH-READY` broadcasts. It is *not* claimed to be better than peer
   negotiation, only adequate; the mandatory backstop is what guarantees
   correctness.
   - **Layer 1 — best-effort early absorption.** When a ticket enters
     `ready_for_review`, record its `git diff --name-only` in `branchReady`.
     Before dispatching an `implement` step for ticket T, if any `branchReady`
     peer's changed files overlap T's scope, instruct T's implement executor to
     merge those peer branches first (pass the branch list in the prompt). This
     only catches peers that have *already* reached review.
   - **Layer 2 — mandatory closeout rebase (the backstop).** The CLI's
     rebase-onto-default precondition on `move … done` is what makes concurrency
     safe regardless of Layer 1. See the dedicated path below.

### Unexpected concurrent-implement conflicts

The case Layer 1 cannot prevent: tickets A and B are **both implementing at the
same time**, touching overlapping files. Neither is in `branchReady` yet, so
neither absorbs the other; their branches diverge in parallel. The resolution is
ordered and deterministic:

1. Whichever ticket reaches closeout first (say A) runs `move … done`,
   auto-merges to the default branch, and advances the default ref.
2. When B later runs `move … done`, the CLI's rebase-onto-default precondition
   **refuses** because B's branch does not yet contain A's merge. This refusal is
   the guarantee — B can never silently clobber A.
3. The orchestrator responds by dispatching a **rebase/merge step** for B: rebase
   B onto the new default (or merge default into B) inside B's worktree.
   - Clean → retry `move … done`; B closes out on top of A.
   - Conflicted → the executor attempts resolution within B's scope; if the
     resolution is mechanical it continues, and if it requires a semantic choice
     the orchestrator moves B to `questions` with the conflicting paths named.
4. Because a single orchestrator serializes the `move … done` calls, only one
   ticket is ever mid-closeout, so step 1/2 cannot interleave into a lost-update
   race. The orchestrator should also avoid dispatching two implement steps it
   *already knows* overlap (from design scope) concurrently — serialize those —
   but the backstop covers the unknown-overlap case it cannot predict.
6. **Refill.** When an in-flight ticket terminates and `readyQueue` is non-empty
   and `inFlight < maxInFlight`, pull the next ready ticket (`worktree-add` +
   `start-work`) and begin dispatching it. Newly-unblocked dependents and
   `decompose` children appear here on the next `list --ready`.
7. **Closeout.** On a ticket's terminal step the orchestrator runs `move … done`
   (auto-merge + rebase-onto-default precondition + branch prune). Because one
   orchestrator serializes transitions, merge races are minimal; the CLI
   precondition still guards. After each auto-merge, run `fast-forward` to
   reconcile the orchestrator's own checkout (executors do code work in
   worktrees, so the main checkout only tracks the default branch).
8. **Terminate.** When `readyQueue` is empty and `inFlight` is empty, emit the
   final per-ticket summary (ticket, model(s) used per step, final status,
   branch, one-line evidence, questions/blockers).

### Concurrency mode

- **Wave-barrier (recommended first):** dispatch every in-flight ticket's next
  step as one parallel batch, await all, then advance + conflict-check + refill.
  Deterministic and easy to keep correct; slightly less pipelined.
- **Event loop (optimization):** dispatch the next step for a ticket as soon as
  its previous step's notification arrives, never waiting for a barrier. Maximal
  pipelining; the spike confirms the mechanism. Adopt once wave-barrier is solid.

## 3. Open decisions

1. **`maxInFlight` semantics.** The real limiter is the orchestrator's context
   budget (all step results flow into one window), not session count. Pick a
   conservative default and document that it caps WIP. Reuse
   `LOCAL_BOARD_MAX_TEAMMATES` or rename to `LOCAL_BOARD_MAX_INFLIGHT`.
2. **Fate of `local-team` + `local-board-teammate`.** Deprecate/remove once the
   unified orchestrator lands, or keep as a thin compatibility wrapper.
3. **Model in config vs frontmatter.** Config `model` overrides frontmatter at
   dispatch (matches dispatch-param precedence). Keep frontmatter as the default
   for standalone use of an agent.
4. **Loss of live per-session intervention.** Accepted trade (interactivity is
   not typically required). The orchestrator still surfaces every step result.
5. **Context-budget spike.** Validate a real run (e.g. 2 tickets × 3 steps
   through the worktree CLI) before committing, to size `maxInFlight`.

### Resolved

- **`local-board-gatecheck` agent — yes.** Added now, pinned to `haiku`, so
  gate-check classification runs off the orchestrator model.
- **Worktree-per-ticket isolation — kept.** No evidence justifies changing it.

## 4. What is unchanged

- Worktree-per-ticket isolation and the `worktree-add` / `worktree-remove` /
  `fast-forward` commands.
- The `move … done` auto-merge + rebase-onto-default precondition + branch prune.
- Ticket front matter as canonical state; the return-only section-content
  contract; `approve-inline` for inline fallback of a delegated route.
- The single-ticket entry point — it becomes the N=1 case of this orchestrator.
