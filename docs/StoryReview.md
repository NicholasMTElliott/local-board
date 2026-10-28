# Proposal: a story-review step

**Status: proposed, not implemented.** This document argues for a closing review step on epics and
stories, sets out what it must check, and records the constraints and open questions that came out
of the wave that motivated it.

## Summary

Add a `story_review` action, reached through a new `ready_for_story_review` status, that becomes
eligible once every child of an epic or story is `done`. It reviews the **final merged state** of
the codebase against the story's original objective — explicitly not the diffs, and not the
intermediate steps — and asks one question that no per-ticket review is positioned to ask: *taken
together, do these tickets actually deliver the thing the story described?*

`routing.doneRequires` for `epic` and `story` becomes `["decompose", "story_review"]`.

## The problem

Per-ticket review is working. In the wave that motivated this proposal, three tickets each went
through three design-review rounds and two-to-three code-review rounds. Every finding was real,
convergence was clean, and the production designs held up. The tickets were individually correct.

**The defects that survived were all at the seams between them.** Four distinct instances, in one
story:

### 1. A declared seam that nobody ever connected

Ticket A (an actor) shipped a placeholder gate whose own doc comment stated the contract:

> "Placeholder — the real schedule lands in ticket B, **which replaces only this function's body**."

Ticket B shipped the schedule and exposed a public accessor documented as "the stable seam for the
downstream tickets." It was never wired. The accessor had **zero production callers**; the
placeholder body was never replaced.

Net effect: the schedule computed correctly, persisted correctly to the save file, and influenced
nothing. The feature's central mechanic was inert while every test was green.

Neither ticket was wrong. A correctly declared a seam; B correctly built behind it. The wiring was
in neither ticket's scope, and — critically — **B merged after A**, so by the time "replaces only
this function's body" became actionable, no open ticket owned it.

### 2. A defect that existed only in the combination

Ticket A added an explanatory comment inside a function that *mentioned* another function by name.
Ticket B's ordering guard counted raw occurrences of that name and required exactly one. Each was
correct alone; merged, the guard failed. Git resolved the merge without complaint. Only running the
suite on the combined result exposed it.

### 3. A cross-ticket contract that drifted

Ticket A changed which value it snapshots for a shared call (a freed-object hazard), after ticket B
had already been designed against the older form. This one *was* caught — but only because the
orchestrator happened to read both designs and noticed. Nothing in the process required that.

### 4. Current-state documentation contradicting itself

The final documentation described the same function as an unwired placeholder in one section and as
wired in another, across edits made by two different tickets. A third file still claimed a component
was never instantiated. Each ticket's doc edit was locally accurate; the merged result was not.

## Why per-ticket review structurally cannot catch these

A reviewer working a ticket is given that ticket's requirement, its design, and its diff. Findings
of the above kinds are not visible from any of those:

- The **scope boundary is the blind spot.** "This ticket declares a seam for a future ticket" is a
  correct design and a correct review outcome. Whether that future ticket consumed the seam is,
  by construction, outside the review.
- **Merge order determines ownership.** A instructs B to replace something; if B merges after A,
  B's review has already happened by the time the instruction is live.
- **A diff cannot show absence.** "This accessor has no callers" is a property of the final state.
  It appears in no diff, because nothing was added.
- **Each ticket's tests pass.** Both tickets in defect 1 had green suites, comprehensive coverage,
  and mutation-verified assertions. The tests verified what each ticket built, and nothing verified
  that the pieces met.

## The structural hole this sits in

Today `routing.doneRequires` is:

```jsonc
"doneRequires": {
  "epic":  ["decompose"],
  "story": ["decompose"],
  "task":  ["design", "implement", "review", "test", "document"],
  "bug":   ["design", "implement", "review", "test", "document"]
}
```

**A story is `done` when it has been broken up, not when it works.** In the motivating wave the
parent story sat at `status: done` while six of its children were still `ready_for_design` and a
seam defect sat between two of its completed children. Nothing in the model is wrong about that —
decomposition genuinely is the story's only current work — but it means a story never has a moment
where anyone asks whether it was achieved.

Tasks have a closing verification step. Stories do not.

## Proposed design

### Status and action

- New status `ready_for_story_review`, valid for `epic` and `story`.
- New action `story_review`, mapped in `workflow.statusActions`.
- New prompt `resources/prompts/steps/story_review.md` (and the mirrored `plans/prompts/` copy).
- `agents.story-review` defaults to `codex-task:read-only` at `xhigh`. In the motivating wave the
  codex read-only reviewer at `xhigh` caught every seam issue it was pointed at, including ones the
  orchestrator had missed.

### Eligibility

A story becomes eligible for `story_review` when **every** child is `done` (and, transitively, when
those children's own `doneRequires` are satisfied). Until then the story sits in
`ready_for_story_review` and is not dispatched. This mirrors the existing `blockedByOpen` machinery
and should reuse it rather than introducing a parallel notion of readiness.

An epic whose children are stories reviews once its stories have themselves passed story review.

### Transitions

| From | To | When |
|---|---|---|
| `ready_for_story_review` | `done` | Review passes: the objective is met end to end. |
| `ready_for_story_review` | `ready_for_story_review` | Findings recorded; remediation tickets created as children; story waits for them. |
| `ready_for_story_review` | `questions` | The objective is ambiguous enough that "achieved" cannot be judged. |

## What the review must check

The prompt should direct the reviewer at the final state, in roughly this order. Each item below is
derived from an actual defect, not invented.

1. **Is the delivered behaviour reachable in production?** Trace from the real entry point to the
   behaviour the story describes. This single question would have caught defect 1 immediately: an
   actor that spawns unconditionally, a schedule that decides nothing.
2. **Is every declared seam consumed?** Search the final state for accessors, hooks and interfaces
   introduced by the story's children that have **no production callers**. Search for
   `placeholder` / `TODO` / `stub` / "lands in `<ticket-id>`" comments whose named ticket is now
   `done`. A seam whose consumer never arrived is the signature of this defect class.
3. **Do cross-ticket contracts match?** Where one child publishes a seam and another consumes it,
   compare the two against the final code, not against the designs.
4. **Is current-state documentation self-consistent?** No file may describe a component as
   placeholder/pending while another describes it as complete. Authoritative current-state docs
   (this repo's `memory-bank/` convention, or a project's equivalent) are the priority.
5. **Do the story's own acceptance criteria hold end to end**, independent of whether each child's
   individual criteria passed? A story's criteria are frequently about the *composition*, and are
   the only place composition is written down.
6. **What did the children defer, and did anything catch it?** Children legitimately defer work
   ("the visual pass needs a display host", "this row is `PARTIAL`"). The story review is the
   natural place to collect those and confirm each is either done, ticketed, or knowingly accepted.

## Constraints and nuances

These are the parts most likely to be got wrong, and several were only visible from running the
wave.

### It reviews final state, not diffs

This is the load-bearing distinction and the reason it is not simply "another code review." The
reviewer should be pointed at the merged tree and the story objective, and explicitly instructed
**not** to review the children's diffs or re-litigate their findings. Reviewing diffs again would
find the same things per-ticket review already found, at greater cost.

### It runs after merge, so findings become tickets, not loop-backs

Because children are `done` and merged before the story is eligible, a finding cannot loop a child
back. Findings become **new child tickets** of the story, and the story stays open until they close.
This is a real economic change worth stating plainly: seam defects get found **late and cheaply**
rather than early. It does not replace catching them earlier; it guarantees they are caught at all.

An open question below asks whether a story-review finding should be able to reopen a `done` child
instead. The default proposed here is no — reopening merged work is a bigger change to the model.

### It needs stories to carry a real objective

Against a story whose requirement is a one-line title, the review will produce vague findings. This
raises the value of writing story requirements that state composition explicitly: what the pieces
are, and what it means for them to be wired together. Boards where stories are purely organisational
containers will get less from this step.

### Cost, and how to bound it

A story with ten children spans a large final state. Two mitigations, neither yet decided:

- Scope the review to the union of paths touched by the story's children, computed from their branch
  merges, rather than the whole repository. This keeps the "final state, not diffs" property (it
  reads the merged files, not the patches) while bounding the read.
- Let the story's requirement name the seams it cares about, so the reviewer has an explicit
  checklist rather than an open-ended hunt.

### Verdict semantics should match the existing review contract

Reuse the `PASS` / `CONCERNS` / `FAIL` shape already used by design review and code review, with the
same first-line-token discipline. `CONCERNS` proceeds at orchestrator judgment with findings carried
forward as tickets; `FAIL` keeps the story open. Consistency matters more than a bespoke vocabulary.

### It must not become a second code review

The prompt should be explicit that implementation-quality findings inside a single child are **out
of scope** — those belong to that child's code review, which has already run. If the reviewer starts
filing style or local-correctness findings, the step is miscalibrated and will mostly generate noise.
The calibration language already used in this repo's review prompts ("do not manufacture findings",
"apply a reachability guard") transfers directly.

### Interaction with the existing coverage-reporting contract

`resources/prompts/roles/implementer.md` now requires a per-row `IMPLEMENTED` / `PARTIAL` / `ABSENT`
table, and `roles/code_reviewer.md` requires auditing it row by row. Story review is the natural
place to collect every child's `PARTIAL` and `ABSENT` rows and ask whether the story can honestly be
called complete with those gaps outstanding. That is a cheap, high-signal check that needs no new
machinery.

## Requirements

If this is built, it should satisfy:

- `story_review` is eligible only when all children are `done`; it is never dispatched early.
- The review reads the merged final state; the prompt forbids diff review and re-litigation of
  child findings.
- Findings produce child tickets of the story; the story remains open until they close.
- The step is skippable by configuration for boards that do not want it (an empty `doneRequires`
  entry for `story` should remain valid).
- `validate` understands the new status and does not report a story awaiting review as malformed.
- The existing `blockedByOpen` dependency machinery is reused for eligibility rather than duplicated.
- Verdict format matches the existing review steps.
- The prompt is stack-agnostic, in line with the rest of `resources/prompts/`.

## Open questions

1. **Should a story-review finding be able to reopen a `done` child**, or must it always create a
   new ticket? Reopening preserves the audit trail on the original ticket; creating keeps `done`
   meaning "merged and verified". Proposed default: create.
2. **What happens when a story's children are still being added?** A story that is decomposed
   incrementally may hit "all children done" several times. Should story review run each time, once
   at the end, or only on explicit request?
3. **Do epics review differently from stories?** An epic's children are stories that have each
   already been story-reviewed. The epic review may be a thin "were the stories' objectives jointly
   sufficient" check, or may not be worth running at all.
4. **Should the step be able to demand a fresh full-suite run on the merged default**, or rely on
   the closeout run the orchestrator already performs? In the motivating wave the merged-default run
   caught a genuine cross-ticket semantic conflict that a clean git merge had hidden.
5. **Scoping**: whole repository, or the union of paths the story's children touched? (See *Cost*.)

## Alternatives considered

- **Rely on the orchestrator.** In the motivating wave the orchestrator did catch one of the four
  seam defects (defect 3) — by chance, because it happened to read two designs side by side. It
  missed the other three. An orchestrator holds the most cross-ticket context of any participant and
  still missed 3 of 4; that is the strongest argument that this needs to be a step with a prompt and
  a verdict rather than an expectation of vigilance.
- **Add seam checks to per-ticket code review.** Tried implicitly, and it does not fit: at the time
  a ticket is reviewed, its siblings may not exist yet. The check is only meaningful once the story
  is complete.
- **A final "integration" child ticket, created during decomposition.** Workable, and strictly better
  than nothing, but it depends on the decomposer remembering to create it and on someone writing its
  criteria. Making it a pipeline stage means it cannot be forgotten.
- **Do nothing and accept seam defects as the cost of parallel work.** Defensible for small stories.
  The motivating wave was three tickets and produced four seam defects, one of which left the
  feature's central mechanic inert — so the rate does not appear low enough to accept silently.
