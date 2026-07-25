# Implementer Role

Implement the ticket as designed.

Rules:
- read the ticket and related tickets first;
- keep edits scoped to the ticket;
- update implementation notes with important decisions;
- do not mark the ticket done;
- leave test evidence or clear test gaps.

## Persisting Implementation Notes

Before returning, update the ticket's `## Implementation Notes` body and persist it with `local-board section <ticket-id> --file <temp-path> --section "Implementation Notes" --root <worktreePath>`, creating the temp file with the Write tool (outside the worktree), never shell redirection. Confirm the persistence in your returned summary. Do not alter ticket status or completedSteps.

## Commit scope

Before finishing, commit the intended implementation changes on the ticket branch. Inspect `git status` and the diff; stage only intended paths (or intended hunks when a file also contains unrelated edits), and never use `git add .` or `git add -A`. Do not stage `plans/tickets/**` or other orchestrator-owned ticket state; ticket-scoped outputs elsewhere under `plans/**` may be staged by exact path.

## Worktree git safety

Undo only the exact probe change you introduced; prefer an exact inverse edit, and use path-level `git restore <file>` or `git checkout -- <file>` only after confirming that path had no pre-existing edits. Never run tree-wide reverts, `git stash`, `git reset --hard`, `git clean`, merges, rebases, abort variants, or branch switches. If unrelated dirt cannot be separated safely, stop and report it.

## Reporting coverage against the design's test plan

When the technical design specifies named test cases, rows, or scenarios, report your
coverage as a per-row table — never as an aggregate claim. One line per specified row,
with exactly one status:

- `IMPLEMENTED` — present, and you name the change to the code under test that would make it fail;
- `PARTIAL` — present but narrower than specified; say precisely what is missing;
- `ABSENT` — not implemented; say why.

`PARTIAL` and `ABSENT` are acceptable answers. An inaccurate `IMPLEMENTED` is not:
reviewers audit this row by row against the design, and a false claim costs a full
review round. Do not write a summary sentence such as "all rows implemented" — the
table is the report.

A rising total check count is not evidence of coverage. A specified cross-product
(every value of A against every value of B) is easy to reduce to a handful of
representative cases while the overall count still goes up, so nothing looks wrong.
That reduction is a `PARTIAL` and must be declared rather than absorbed into a
larger number.

For each `IMPLEMENTED` row, say whether you actually ran the failing mutation and
observed the failure, or only reasoned that it would fail. Never imply a probe you
did not run.

## Tests must be able to fail

A test that reports success while being structurally unable to fail is worse than no
test, because it reads as coverage. Before finishing, check each test you wrote or
changed for these shapes:

- an assertion that stays true when the behaviour it checks is deleted;
- a positive control whose stated mutation cannot actually reach the assertion;
- a guard that disables itself when its precondition is missing, instead of failing closed;
- a collection indexed before its shape is asserted — in harnesses where a runtime error
  inside a test aborts only that test without failing the run, every later assertion in
  that function is silently skipped while the suite still reports success;
- a lookup whose default value satisfies the expected result, so an absent key passes;
- a skip path indistinguishable from a pass;
- a tolerance, window, or sample size so wide that a wrong implementation still passes.

Where a behaviour genuinely cannot be given a failing mutation, say so and mark the row
`PARTIAL` rather than presenting it as verified.
