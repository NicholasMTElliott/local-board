---
id: B20260810T2112Z
type: bug
status: backlog
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-08-10T21:12:38Z
updated: 2026-08-10T21:13:17Z
completedSteps: []
routingApprovals: []
---
# auto-merge advances the default ref without refreshing the primary checkout, leaving a staged inverse-merge that a commit there would revert

## Requirement

When the default branch is checked out in the primary worktree — always true in the local-team flow — `autoMergeTicketBranch` (`src/git.js:73`) takes the plumbing path `mergeBranchIntoDefaultRef` (`src/git.js:189-202`):

```js
const mergeCommit = await gitOutput(root, [
  "commit-tree", `${branch}^{tree}`, "-p", oldDefault, "-p", branch, "-m", `Merge ${ticketId}`,
]);
await gitRun(root, ["update-ref", `refs/heads/${defaultBranch}`, mergeCommit, oldDefault]);
```

That is a deliberate and otherwise correct workaround for git's refusal to merge into a branch checked out elsewhere, and the history it writes is right (it even compare-and-swaps the ref against `oldDefault`). But `update-ref` on a **checked-out** branch moves that worktree's HEAD without touching its index or working tree. The primary checkout's HEAD then resolves to the merge commit while its index still holds pre-merge content, so `git status` there reports the difference as *staged* changes — which are exactly the inverse of the merge just performed.

Consequence: in the primary checkout, `git commit -a` (or any `git commit` that picks up the already-staged entries) creates a commit that **deletes every file the merge added and restores every file it removed** — silently reverting the merge while the ticket remains `done` and the branch has been pruned.

The sibling `git switch` + `git merge --no-ff` path (`src/git.js:88-91`) is unaffected, because a real merge updates the tree. The defect is specific to the checked-out-elsewhere path, i.e. specific to the worktree-based flow `SKILL_TEAM.md` mandates.

### Why the existing guard does not catch it

`autoMergeTicketBranch` calls `assertNoNonPlanningChanges(root)` (`src/git.js:64`), but `root` is the **ticket worktree** — the one being merged *from*. Nothing inspects the **primary** worktree, which is the one about to be left inconsistent. So auto-merge silently creates the hazardous state whenever the primary checkout has uncommitted work, and `move <id> done --json` returns `"action": "merged"` with no indication that another checkout is now stale.

`fast-forward` is the intended reconciliation and `SKILL_TEAM.md` does instruct running it before the post-merge suite. But it refuses on a dirty tree — correct and protective — which means the dangerous window stays open in precisely the case where it is dangerous: the primary checkout has uncommitted work, so it cannot be reconciled, and it now holds a staged inverse-merge.

### Observed

Reproduced 2026-08-10 in a consumer repo running the local-team flow. `move S… done` merged at ref level; the primary checkout (which had unrelated uncommitted application work) then reported staged deletions of all six ticket files the merge had added, plus a staged re-add of the story file at its pre-merge path. `local-board fast-forward` refused ("requires a clean working tree"). Recovery was `git restore --source=HEAD --staged --worktree -- plans/`, which is safe because it is path-scoped, but a user who ran `git commit -a` first would have reverted the merge without any warning.

Note this is the same root cause as the staleness `SKILL_TEAM.md` already warns about for test runs ("a textually clean merge can still break tests via a semantic conflict git cannot see" — the instruction to `fast-forward` *before* running the suite). That warning covers stale *results*; nothing covers the destructive-commit risk.

### Reproduction

1. In a repo using the worktree flow, have the default branch checked out in the primary worktree.
2. Make and leave an uncommitted change to a non-planning file there (e.g. `README.md`).
3. In a ticket worktree, take a ticket to its terminal step and run `move <id> done` with `git.autoMerge` on.
4. In the primary checkout, `git status` — the merge's additions appear as staged deletions.
5. `local-board fast-forward` refuses on the dirty tree; `git commit -a` at this point reverts the merge.

### Fix

In order of preference:

1. **Refresh the other worktree after the ref update.** After `update-ref` succeeds, resolve the worktree holding the default branch (`branchCheckedOutElsewhere` already locates it) and run `git -C <thatRoot> reset --keep <mergeCommit>`. `--keep` aborts rather than clobbering local modifications, so it is safe by construction: it fixes the clean case invisibly and refuses the unsafe one instead of silently leaving an inverted index.
2. **Or refuse up front.** Check the primary worktree's cleanliness *before* `update-ref` and fail with an actionable message, so the hazardous state is never created.
3. **At minimum, report it.** Include a warning in the `move … done` result payload naming the stale checkout path and the required `local-board fast-forward`, so an orchestrator can surface it instead of discovering it later.

(1) and (3) compose well: refresh when possible, warn when `--keep` declines.

### Acceptance

- With the default branch checked out in a **clean** primary worktree, `move <id> done` leaves that worktree's index and working tree matching the new merge commit; `git status` there is clean and `git commit -a` is a no-op rather than a revert.
- With a **dirty** primary worktree, auto-merge either refuses before touching the ref, or completes and reports the stale checkout explicitly; in neither case does it silently leave a staged inverse-merge.
- A regression test drives the checked-out-elsewhere path with both a clean and a dirty primary worktree and asserts the index state afterwards. The dirty-case assertion must fail against the current implementation, so the test reproduces the defect rather than restating the fix.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
