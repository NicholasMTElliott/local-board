---
id: B20260710T1532Z
type: bug
status: ready_for_design
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/B20260710T1532Z-section-file-can-duplicate-the-section-heading-when-the-payload-carries-it
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-10T15:32:22Z
updated: 2026-07-10T15:40:06Z
completedSteps: []
routingApprovals: []
---
# section --file can duplicate the section heading when the payload carries it

## Requirement

Retro item from the 2026-07-10 parallel run. Two independent implementer executors produced duplicate section headings when persisting ticket sections: T20260710T1220Z's fix pass reported "manually removed a duplicate ## Implementation Notes heading artifact left over from the section-insert", and T20260710T1222Z's implementer reported "two malformed local-board section --file invocations produced duplicate headers" requiring manual correction.

## Repro hypothesis (to be confirmed at design)

When the --file payload itself begins with the section heading (e.g. the file starts with "## Implementation Notes") and the target section already exists, the replace/insert logic can end up with the heading twice — once from the section boundary and once from the payload. A second suspected path: section insert when the ticket template already contains an empty heading of the same name.

## Scope

1. Reproduce precisely (both suspected paths; also probe a payload with a trailing heading of ANOTHER section name — boundary detection is fence-aware per systemPatterns, but heading-in-payload semantics are unspecified).
2. Fix src/tickets.js section replacement so the operation is idempotent with respect to the section heading: strip a leading duplicate heading from the payload (or reject payloads that start with any H2 heading, with an actionable message — design decides which contract).
3. Regression tests for each reproduced path.
4. One-line contract note in SKILL.md's section usage text if the accepted payload shape changes.

## Acceptance criteria

- The reproduced duplicate-heading scenarios produce a single heading after the fix; repeated identical section calls remain idempotent.
- validate flags any legacy ticket with a duplicated section heading (or design justifies why not).
- npm run check and node --test pass.

## Non-goals

- No change to comment/marker grammar or other section semantics.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
