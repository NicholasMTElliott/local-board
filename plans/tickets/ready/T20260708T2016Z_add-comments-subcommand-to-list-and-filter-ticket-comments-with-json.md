---
id: T20260708T2016Z
type: task
status: ready_for_design
priority: P3
parent: S20260516T1539Z
children: []
blockedBy: [T20260708T2015Z]
blocks: []
branch: local-board/T20260708T2016Z-add-comments-subcommand-to-list-and-filter-ticket-comments-with-json
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-08T20:15:34Z
updated: 2026-07-08T20:53:57Z
completedSteps: []
routingApprovals: []
---
# Add comments subcommand to list and filter ticket comments with --json

## Requirement

Add a read-only `local-board comments <ticket> [--section <name>] [--marker key=value ...] [--json]` command in src/cli.js (register alongside the existing `comment` dispatch and add its usage line to the help block; note the skill command-block lockstep rule — SKILL.md and skills/codex/local-board/SKILL.md must be updated together if the curated block gains this command, guarded by test/skill-usage-sync.test.js).

It reads the ticket, walks each section, and parses every bullet comment line via the parser exported by T20260708T2015Z. `--section` filters to one section; each `--marker` requires that key present and equal (AND semantics). Human output groups records by section as `<ts> [markers] <body>`; `--json` emits an array of `{ ticket, section, timestamp, markers, body }`. Read-only: no locks, no writes; `state-report` shape untouched.

## Acceptance Criteria

- `comments <ticket>` lists all parsed comments grouped by section; unmarked comments appear with no marker segment.
- `--section <name>` restricts to that section; unknown section yields empty result, exit 0.
- `--marker step=x --marker outcome=PASS` returns only comments matching all supplied markers (AND).
- `--json` returns records with exactly `{ ticket, section, timestamp, markers, body }`; values match what T20260708T2015Z wrote.
- `state-report --json` output unchanged (regression assertion or explicit test note).
- `npm test` adds filter-by-marker and section-filter tests.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
