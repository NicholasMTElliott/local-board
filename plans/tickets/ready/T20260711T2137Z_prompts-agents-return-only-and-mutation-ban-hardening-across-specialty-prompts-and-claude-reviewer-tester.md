---
id: T20260711T2137Z
type: task
status: ready_for_design
priority: P3
parent: null
children: []
blockedBy: []
blocks: []
branch: local-board/T20260711T2137Z-prompts-agents-return-only-and-mutation-ban-hardening-across-specialty-prompts-and-claude-reviewer-tester
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
created: 2026-07-11T21:36:10Z
updated: 2026-07-11T23:35:29Z
completedSteps: []
routingApprovals: []
---
# prompts/agents: return-only and mutation-ban hardening across specialty prompts and claude reviewer/tester

## Requirement

From the prompt-library review of 2026-07-11 (items 2, 9, 10, 11): return-only and mutation-ban drift across prompts and agent definitions, including one real exposure.

1. [Item 9, the exposure] agents/claude/local-board-reviewer.md L23 and agents/claude/local-board-tester.md L22 ban only the `section` command, while the codex variants ban all local-board mutations. With a session-wide Bash(local-board *) allow rule, a prompt-injected ticket could steer these return-only agents into complete-step/move/comment. Replace with: do not run any mutating local-board command (section, comment, complete-step, move, estimate, gate-complete); read-only queries (query-ticket, list) are fine.
2. [Item 2] The five optional-step specialty prompts have no return-only clause; they run on codex-task:read-only or inline routes. Add under each Output Contract: you are read-only and return-only - return the JSON verdict as your message; do not write files or run any local-board command; the Recording section describes what the orchestrator does afterward.
3. [Item 10] plans/prompts/steps/decompose.md L9 states "link parent and children in front matter" unconditionally, contradicting its own Persistence section which forbids return-only executors from running link commands. Reword: parent/child links are recorded in front matter (by whoever the Persistence section below assigns).
4. [Item 11] agents/codex/local-board-gatecheck.md L30-37 shows a fenced json example directly under an output rule saying "No prose, no code fences". Replace the fenced block with the inline shape the claude variant uses.

### Scope

- Edits per above; npm run sync-resources for the plans/prompts files (specialty prompts + decompose.md); agents/ files need no sync. Full node --test per AGENTS.md.

### Acceptance criteria

- Claude and codex reviewer/tester mutation bans are equivalent in coverage.
- All five specialty prompts carry the return-only clause; decompose.md no longer self-contradicts; codex gatecheck example obeys its own no-fence rule.
- npm run check and node --test pass; resources mirror synced.

### Non-goals

- No permission-rule (settings) changes; no new CLI enforcement — this is prompt/agent-text hardening only.

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
