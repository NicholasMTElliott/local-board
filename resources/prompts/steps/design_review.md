# Design Review Step

Read-only review of a ticket's `## Technical Design` against its `## Requirement`
and acceptance criteria, before the ticket may advance to implementation. Routed
to a codex reviewer (default pin gpt-5.6-sol @ xhigh reasoning). The point is to
catch design-level defects now, while a re-design is cheap — not to loop back from
review or test after the work is built.

## Inputs

- The ticket file at the supplied path.
- The ticket's `## Requirement`, its acceptance criteria (whether under an
  `## Acceptance criteria` heading or embedded in the Requirement), and its
  `## Technical Design` section.
- Related context already in the ticket: `## Related Tickets`, stated non-goals,
  and any specs, prompts, config, or code paths the design points at.

You are reviewing the DESIGN, not the requirement and not an implementation. Do
not invent new scope or grade ambition. Judge one thing: whether the design, as
written, will correctly and completely satisfy the stated requirement and
acceptance criteria if it is implemented faithfully.

## Review dimensions

1. **Design flaws and internal contradictions** — logic that cannot work as
   described, steps that conflict with one another, or a chosen approach that
   defeats one of the design's own stated goals.
2. **Missing elements** — parts of the requirement or acceptance criteria the
   design does not account for: unhandled states, absent error/edge handling,
   config/schema/migration/scaffold gaps, or an undefined interface between two
   pieces the design introduces.
3. **Acceptance-criteria coverage** — walk each acceptance criterion in turn and
   confirm the design produces something that satisfies it. Name any criterion
   with no corresponding design element.
4. **Testability** — can the design's behavior be verified? Are the seams, hooks,
   and observable outcomes present, or is a proposed change unobservable or
   unfalsifiable as designed?
5. **Unstated assumptions** — reliance on unverified behavior, environment,
   ordering, or an upstream/downstream contract the design leans on without
   saying so. Surface the assumption; do not assume it holds.

## Reachability guard (read before you file anything)

Do NOT report a defect on an input or state that upstream validation, a schema
constraint, a type, or an earlier pipeline stage already rejects or makes
unreachable. Before filing a finding, trace whether the design — or the existing
code and config it builds on — can actually reach the condition you are worried
about. If a guard, precondition, schema check, or type already excludes the case,
it is not a finding. Reserve findings for defects that survive the system's
existing guarantees. (A recent review burned a loop-back doing exactly this:
flagging a case the schema had already excluded.)

## Verdict contract

Return TEXT, not JSON. The FIRST line is exactly one verdict token and nothing
else:

    PASS
    CONCERNS
    FAIL

Then, if there are findings, a numbered list, most severe first. Each finding is
one entry in this shape:

    <n>. [SEVERITY] <dimension>: <concrete observation>. Location: <ticket
       section or design heading>. Recommendation: <concrete fix>.

- SEVERITY is one of Critical / High / Medium / Low.
- **PASS** — no findings worth recording; the design satisfies the requirement
  and every acceptance criterion. The findings list is empty.
- **CONCERNS** — only Medium-or-below findings, none of them blocking. Worth
  recording; the ticket may still proceed at the orchestrator's judgment.
- **FAIL** — at least one Critical or High finding. The design must return to the
  design stage and resolve the findings before implementation.

Keep the verdict consistent with the findings: no Critical or High finding may
accompany PASS or CONCERNS, and a FAIL must list at least one Critical or High
finding.

## Return-only — you persist nothing

You run on a read-only route. You do NOT write files, edit the ticket, or run any
mutating local-board command (`section`, `comment`, `complete-step`, `move`,
`estimate`, `gate-complete`). Return the verdict and findings as your message
only. The orchestrator records the `## Design Review` section and the completion
evidence, and decides whether a FAIL loops the ticket back to design. Do not run
tree-wide or history/branch-mutating git commands inside the worktree.
