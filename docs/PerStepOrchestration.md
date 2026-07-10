# Per-Step Orchestration

Status: **implemented** and merged to `mainline`. The
agent-teams teammate layer is replaced by a single top-level orchestrator that
dispatches each pipeline step to an ephemeral, model-specialized executor. The
routing-profile schema, designer self-write, gate-check agent, and the
`SKILL_TEAM.md` orchestrator contract are live; `maxInFlight` reuses
`team-config` (`LOCAL_BOARD_MAX_TEAMMATES`, default 6); the real run (§5)
pinned the recommended working cap at ≈3.

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

| Concern | Team mode (today) | Per-step orchestration |
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
it. For newly scaffolded boards, `worktrees.guardWrongRoot` makes the CLI enforce
this discipline by refusing guarded per-ticket calls from the main root unless
`--allow-main-root` is supplied.

## 1. Execution profile schema

Today `agents` maps an action to a route string. Extend each entry to a profile
object carrying `route`, optional `model`, and optional `prompt`.

The models below (`gpt-5.5`, `claude-opus-4-6`, etc.) are **illustrative** — the
live config does not pin these; they show the shape of a profile object.

```jsonc
{
  "agents": {
    "decompose":  { "route": "claude-subagent:local-board-decomposer", "model": "opus" },
    "gate-check": { "route": "claude-subagent:local-board-gatecheck",   "model": "haiku" },
    "design":     { "route": "claude-subagent:local-board-designer",    "model": "opus" },
    "implement":  { "route": "claude-subagent:local-board-implementer", "model": "sonnet" },
    "review":     { "route": "codex-task:read-only",                    "model": "gpt-5.5" },
    "test":       { "route": "claude-subagent:local-board-tester",      "model": "claude-opus-4-6" },
    "document":   { "route": "codex-task:workspace-write" }
  }
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
- `fallbackModels` (optional): ordered alternate model ids for a pinned `model`,
  accepted by strict routing when the pinned model is unavailable and emitted
  only when configured.
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
  optional at the schema level (route-only tokens still parse), but when strict
  routing is on and the step's route matches the configured route and the
  action's profile pins a model, `complete-step` requires a matching `@<model>`
  suffix, a listed fallback model, `@codex-default` for a Codex-translated run,
  or a `routingApprovals` entry for the full `route@model` token recorded via
  `approve-inline --executor <route>@<model>`. Done-time re-validation stays
  route-only so pre-existing evidence recorded before this rule (or before
  per-step models existed) is never retroactively broken.

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
- `maxInFlight`: concurrency cap (reuse `team-config` / `LOCAL_BOARD_MAX_TEAMMATES`,
  default 6; ≈3 is the recommended working cap)

### Responsibility split

- **Executor** does the actual work and returns a structured result.
  - Self-writing executors (implementer, documenter, and — per the context-budget
    finding in §3 — the **designer**, scoped to its own Technical Design section)
    edit files **in the worktree** with the `Write`/`Edit` tools and return only a
    **terse summary**, keeping large payloads out of the orchestrator window.
  - Return-only executors (reviewer, tester, gate-check, codex read-only) return
    section content / verdict JSON and write nothing; the orchestrator records
    their output via `section --file`. These stay return-only because their
    payloads are small (~300 tokens) and the strict no-mutation guarantee is worth
    keeping for review and test.
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
     The section payload is body-only: omit the target `## Heading`, and fence
     literal top-level `## ` samples.
   - Self-writing result → the executor already committed in the worktree;
     orchestrator records `complete-step` evidence.
   - Choose the next non-terminal status from the `transitions` guidance returned
     by `begin-step`/`query-ticket` and `move`; terminal `done` moves are handled
     by Closeout.
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
6. **Closeout.** On a ticket's terminal step the orchestrator runs `move … done`;
   with `git.autoMerge` on, that command performs the guarded merge and prunes
   the branch when configured and safe, while manual-merge boards perform the
   merge before verification. After the default checkout is reconciled with
   `fast-forward`, run the full suite on the merged default branch and fix
   unexpected failures before freeing the `done` slot for refill.
7. **Refill.** `questions`/`blocked` exits free their slots immediately; `done`
   exits refill only after Closeout has completed its merge, `fast-forward`, full
   suite, and any fix-forward. When `readyQueue` is non-empty and
   `inFlight < maxInFlight`, pull the next ready ticket (`worktree-add` +
   `start-work`) and begin dispatching it. Newly-unblocked dependents and
   `decompose` children appear here on the next `list --ready`.
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

## 3. Context budget

Because every step result funnels into one orchestrator window, context is the
real scaling limit. Measured proxies from a representative rich ticket (~19k
chars) and the live CLI:

| Item | ≈ Tokens | Notes |
|---|---|---|
| `begin-step` / `query-ticket --json` | ~100 | per step, cheap |
| `gate-check --json` input | ~375 | per gate |
| `schema --json` | ~2,680 | once per session |
| **Design** section payload | **~2,580** | the dominant item |
| Implementation Notes | ~370 | |
| Review Findings | ~310 | |
| Test Evidence | ~365 | |
| Documentation | ~155 | |

**The limiter is cumulative session tokens, not concurrency.** Conversation
history persists regardless of how many tickets are concurrent, so the binding
constraint is *total tickets processed per orchestrator session*, while
`maxInFlight` is really a reasoning-clarity / peak-returns cap.

Two levers cut per-ticket cost ~5× (from ~7,100 to ~1,300 retained tokens —
roughly 20 → 100+ tickets before compaction against a ~150k working budget):

1. **Designer self-writes its section** (the ~2,580-token payload) via the
   `Write` tool, scoped to its Technical Design section, returning a terse
   summary. The Bash-redirection escaping bug that motivated the return-only
   contract does not apply to the `Write` tool (implementer/documenter already
   self-write this way). **Decided (hybrid):** apply this to the designer only;
   reviewer and tester stay return-only — their payloads are small and the strict
   no-mutation guarantee is worth keeping.
2. **Prompts by reference.** `begin-step` already returns the prompt *path*; the
   executor `Read`s it instead of the orchestrator inlining the full prompt text
   into the dispatch call. Removes ~2,250 tokens/ticket.

**Compaction.** Plan on periodic `/compact`. Wave-barrier mode is attractive here
because the gaps between waves are natural, safe compaction boundaries — a single
orchestrator juggling N concurrent tickets otherwise has no clean "between
tickets" moment to compact at. Live coordination state (ticketId → status,
branch, worktree, executorId) is small and re-derivable from ticket files, so it
survives compaction cheaply.

These figures are proxies; real section sizes vary widely. The *ratios* and the
*cumulative-not-concurrent* conclusion are the durable findings.

## 4. Open decisions

1. **`maxInFlight` default — resolved, see Resolved below.** The env var stays
   `LOCAL_BOARD_MAX_TEAMMATES`; a `LOCAL_BOARD_MAX_INFLIGHT` rename is a
   possible future follow-up, not current state.
2. **Model in config vs frontmatter.** Config `model` overrides frontmatter at
   dispatch (matches dispatch-param precedence). Keep frontmatter as the default
   for standalone use of an agent.
4. **Loss of live per-session intervention.** Accepted trade (interactivity is
   not typically required). The orchestrator still surfaces every step result.

### Resolved

- **`local-board-gatecheck` agent — yes.** Added now, pinned to `haiku`, so
  gate-check classification runs off the orchestrator model.
- **Worktree-per-ticket isolation — kept.** No evidence justifies changing it.
- **Context-budget spike — done (§3).** Limiter is cumulative session tokens, not
  concurrency. Adopt the hybrid self-write (designer only) + prompt-by-reference
  optimizations; plan periodic compaction at wave boundaries.
- **Designer self-writes its section — yes (hybrid).** Reviewer and tester stay
  return-only.
- **`maxInFlight` default — config default 6; ≈3 recommended working cap (§5
  real run).** The orchestrator real run drove
  2 tickets concurrently and they were trivially manageable; 3 leaves headroom
  before per-wave scheduling/conflict tracking gets hard to hold accurately.
- **Fate of `local-team` + `local-board-teammate` — resolved.** `local-team` is
  rewritten as this orchestrator; the `local-board-teammate` agent and the
  agent-teams teammate flow are removed (`docs/TeamMode.md` kept as history).

## 5. Real-run validation

An end-to-end run drove **2 independent tickets × design/implement/test** through
a throwaway git repo using the real worktree CLI and real subagent dispatch with
per-step models. Confirmed working:

- per-step model dispatch in-loop (designer `opus`, implementer `sonnet`, tester
  `sonnet`), each running on the requested model; fallback models are now a
  configured ordered walk for pinned-model outages;
- wave-barrier concurrency (two executors per wave, in parallel);
- designer **self-write** (its own `Technical Design` section, temp file outside
  the worktree, terse return) and tester **return-only** (orchestrator persists);
- `route@model` completion evidence and gate-check resolution (empty catalog →
  skip the gate agent);
- the **failure/loop-back path**: the tester caught an acceptance violation →
  ticket returned to implementation → `approve-inline` fix → re-verify → advance.
  This exact loop-back carried stale `review`/`test` evidence forward with no
  invalidation (T20260707T1328Z); `routing.invalidateOnLoopBack` (see
  `docs/Workflow.md`) now strips at-or-downstream evidence on such a move so
  the re-run must re-record it before `done`;
- closeout: auto-merge + branch prune + `fast-forward`, and the **Layer-2 rebase
  backstop** firing when the second ticket's branch was behind the advanced
  default, then succeeding after a rebase.

One ordering refinement the run surfaced (now folded into `SKILL_TEAM.md` and
`SKILL.md`):

1. **Commit planning changes before rebasing.** `move`/`complete-step` leave the
   ticket file dirty; `git rebase` refuses a dirty tree, so the orchestrator must
   commit planning state before rebasing in response to the precondition refusal.

(A previously-noted `begin-step`-before-`start-work` ordering constraint was
since removed in the CLI: `resolveStepFromBoard` now resolves an active
status's action through its `ready_*` peer, so `begin-step` works regardless
of ordering around `start-work`.)

## 6. What is unchanged

- Worktree-per-ticket isolation and the `worktree-add` / `worktree-remove` /
  `fast-forward` commands.
- The `move … done` auto-merge + rebase-onto-default precondition + branch prune.
- Ticket front matter as canonical state; the return-only section-content
  contract for reviewer/tester/gate-check/codex-read-only (the designer becomes
  self-writing per §3); `approve-inline` for inline fallback of a delegated route.
- The single-ticket entry point — it becomes the N=1 case of this orchestrator.
