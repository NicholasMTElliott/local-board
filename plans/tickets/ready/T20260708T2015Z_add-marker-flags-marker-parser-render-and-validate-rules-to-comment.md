---
id: T20260708T2015Z
type: task
status: ready_for_design
priority: P3
parent: S20260516T1539Z
children: []
blockedBy: []
blocks: [T20260708T2016Z]
branch: local-board/T20260708T2015Z-add-marker-flags-marker-parser-render-and-validate-rules-to-comment
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-08T20:15:33Z
updated: 2026-07-08T20:16:32Z
completedSteps: []
routingApprovals: []
---
# Add --marker flags, marker parser, render, and validate rules to comment

## Requirement

Add structured markers to the comment write path.

Extend `commandComment` (src/cli.js ~L760) with a repeatable `--marker key=value` flag, accumulated into an ordered map; validate each key/value (values `[A-Za-z0-9_./-]+`, keys no whitespace) and reject malformed input with a clear CLI error. Extend `appendTicketComment` (src/tickets.js ~L830) to accept a markers option and render the bracketed block. Add an exported pure parser in src/tickets.js returning `{ timestamp, markers, body }` for a single comment line, with graceful fallback to whole-body when the bracket parse fails (backward compatibility). Add `validate` rules that surface malformed marker syntax. Create `docs/comment-markers.md` documenting the reserved vocabulary (`kind`, `step`, `outcome`, `executor`; other keys allowed but unvalidated) and index it in README.md.

Format decisions (corrections to the parent story, agreed at decomposition):
- Marked lines render `- <ts>: [step:x outcome:PASS kind:specialty] <body>` — the existing `- <ts>: <body>` colon form is preserved; the marker block is inserted between the `: ` separator and the body. Unmarked comments render byte-identical to today.
- CLI accepts `key=value`; the on-disk/rendered form is `key:value`. Document this mapping.
- Markers are run-log annotations / grep aids only. They are NOT routing or gate evidence: completedSteps and gate tokens remain the only evidence ledger, and `state-report` does not read markers. Say this explicitly in docs/comment-markers.md.

## Acceptance Criteria

- `local-board comment <ticket> <text> --marker step=x --marker outcome=PASS` accepts repeated flags; malformed markers produce a clear non-zero error.
- Marked comments render as `- <ts>: [step:x outcome:PASS kind:specialty] <body>`; unmarked comments render byte-identical to today.
- Exported parser round-trips (write-then-parse recovers markers and body); legacy unmarked comment parses to empty markers + full body; stray brackets fall back to body without throwing.
- `validate` flags a synthetically malformed marker line and passes clean on all existing tickets.
- `docs/comment-markers.md` documents the reserved keys and the not-evidence rule; README index updated.
- `npm test` adds: marker round-trip, malformed rejection, backward-compat parse.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
