---
id: T20260516T1547Z
type: task
status: backlog
priority: P2
parent: S20260516T1537Z
children: []
blockedBy: [T20260516T1543Z]
blocks: [T20260516T1548Z, T20260516T1549Z]
branch: null
estimate: null
created: 2026-05-16T15:47:43Z
updated: 2026-05-16T15:45:32Z
completedSteps: []
routingApprovals: []
---
# Config: add estimation block to plans/local-board.config.jsonc

## Requirement

Add the `estimation` block to `plans/local-board.config.jsonc` and teach the config loader to recognize it. Pure configuration surface — no behavior change in this task.

Block shape:

```jsonc
"estimation": {
  "enabled": true,
  "scale": [1, 2, 4, 8],
  "bootstrapDefault": 4,
  "splitThreshold": 16,
  "runAfter": "design"
}
```

The config loader should expose these values through whatever struct other tasks (estimate CLI, enforcement gate, prompts) read from. Defaults must apply when keys are missing.

## Acceptance Criteria

- `plans/local-board.config.jsonc` contains an `estimation` block with the documented keys and defaults.
- The config loader parses the block and exposes the values to the rest of the codebase.
- Missing keys fall back to documented defaults (`scale: [1,2,4,8]`, `bootstrapDefault: 4`, `splitThreshold: 16`, `runAfter: "design"`, `enabled: true`).
- `validate` does not regress on the new config shape.
- Tests cover: default fill-in when block is absent, full block parses, partial block fills missing defaults, malformed `scale` (non-array or non-numeric) is rejected.

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
