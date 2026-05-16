---
id: S20260516T1539Z
type: story
status: backlog
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: null
created: 2026-05-16T15:39:38Z
updated: 2026-05-16T15:41:18Z
completedSteps: []
routingApprovals: []
---
# Structured comment markers for step history

## Requirement

Add structured marker metadata to ticket comments so step history is grep-friendly and machine-parseable.

The older task-board project tags each comment with markers like `kind:optional`, `step:security_audit`, `outcome:CONCERNS`. local-board's `comment` command currently appends a timestamp and free text into a section, which is fine for human reading but loses the ability to filter by step, outcome, or comment kind. As specialty steps and estimation generate more agent-written comments, structured markers become useful for state reports and future tooling.

## Acceptance Criteria

- `local-board comment <ticket> <text>` gains optional `--marker <key>=<value>` flags, repeatable. Examples: `--marker step=security_audit --marker outcome=CONCERNS --marker kind=specialty`.
- Comments with markers render with a single-line marker prefix on the timestamp line. Format: `- 2026-05-16T15:37:00Z [step:security_audit outcome:CONCERNS kind:specialty] Comment body here.`
- Comments without markers render exactly as today. No breaking change to existing tickets.
- A reserved marker vocabulary is documented in `docs/`: `kind` (mandatory|specialty|gate|human|orchestrator), `step` (any action or specialty name), `outcome` (PASS|CONCERNS|FAIL|INFO), `executor` (agent route string). Other keys are permitted but not validated.
- `validate` parses marker syntax and surfaces a clear error on malformed markers (unbalanced brackets, missing `:`, whitespace inside keys).
- A new `local-board comments <ticket> [--section <name>] [--marker <key>=<value>...] [--json]` command lists comments on a ticket, optionally filtered by section and/or marker matches. Default output is human-readable; `--json` returns structured records `{ timestamp, section, markers: {...}, body }`.
- `state-report` does not change shape. Marker tooling is opt-in via the new `comments` subcommand.
- `npm test` covers: marker round-trip (write then read parses correctly), filter-by-marker selection, malformed marker rejection, backward compatibility with existing unmarked comments.

## Related Tickets

- S20260516T1537Z (estimation) — estimator-written comments could carry `kind:orchestrator step:design outcome:INFO` markers, but the feature is not a dependency.
- S20260516T1538Z (specialty steps) — primary motivator. Gate-check and specialty step comments benefit from `kind:gate`/`kind:specialty` and `step:<name>` markers. Ship comment markers before specialty steps if both are queued.

Source material in the sibling `task-board` project:
- `prompts/gate_checker.md` and various optional-step prompts — emit marker-tagged comments via the runner.
- `lambda/src/TaskBoard.Worker/Processing/AgentRunner.cs` — comment-posting code that attaches `kind:`, `step:`, `outcome:` markers.

## Technical Design

### Comment line format

Existing format (kept for unmarked comments):
```
- 2026-05-16T15:37:00Z Comment body text here.
```

New format (when markers are supplied):
```
- 2026-05-16T15:37:00Z [step:security_audit outcome:CONCERNS kind:specialty] Comment body text here.
```

The marker block is a single bracketed segment immediately after the timestamp and before the body. Markers inside are space-separated `key:value` pairs. Values are restricted to `[A-Za-z0-9_./-]+`; values containing spaces or other characters need to be quoted: `executor:"codex-task:read-only"`. Keep this strict to keep grep simple.

### Parsing

Add a parser in `src/tickets.js` that recognizes the bracketed prefix on a comment line. Returns `{ timestamp, markers: { key: value, ... }, body }`. If the bracket parse fails, fall back to treating the whole post-timestamp content as body — this preserves backward compatibility with any handwritten comments that happen to use brackets.

The parser is also useful for the new `comments` subcommand and for future state-report extensions.

### CLI surface

`local-board comment <ticket> <text> --marker key=value [--marker key=value...]`:
- Multiple `--marker` flags are accumulated.
- Validates each marker against the key/value regex.
- Writes the comment with the marker block.

`local-board comments <ticket> [--section <name>] [--marker key=value...] [--json]`:
- Reads the ticket, walks each section, parses each comment line.
- Filters by section if `--section` is supplied. Filters by marker matches (all supplied markers must be present and equal) if any `--marker` flags are present.
- Default output: `<timestamp> [markers] body` per line, grouped by section.
- `--json` output: array of `{ ticket, section, timestamp, markers, body }` records.

### Reserved vocabulary

Documented in a new `docs/comment-markers.md` (and indexed in README):

| Key | Reserved values | Meaning |
|---|---|---|
| `kind` | `mandatory`, `specialty`, `gate`, `human`, `orchestrator` | Who/what produced the comment. |
| `step` | any action or specialty name | The action this comment relates to. |
| `outcome` | `PASS`, `CONCERNS`, `FAIL`, `INFO` | Result classification. |
| `executor` | agent-route string | Which agent or human produced this. |

Other keys are permitted (forward-compatible). Only the reserved keys have constrained values.

### Migration

No migration. Existing comments continue to parse as before. Marker support is purely additive.

### Out of scope (future)

- A `local-board outcomes <ticket>` rollup that groups markers by step+outcome. Trivial follow-up once the parser lands.
- Marker editing/removal commands. Comments are append-only by convention; we should keep that property.
- Markers on `section` content. Sections are agent-managed bodies, not history; markers there would muddy the model.

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
