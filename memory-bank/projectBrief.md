# Project Brief: local-board

## Purpose
Create a repo-native planning and orchestration system where tickets are Markdown files in `plans/`, and Claude Code or Codex can act as the primary orchestrator for local agent workflows.

## Product Thesis
External kanban boards are useful shared control planes, but solo/local AI development benefits from keeping planning state inside the repository.

## Success Target
A developer can ask Claude Code or Codex to run the local board. The orchestrator reads `plans/`, picks the highest-priority eligible ticket, delegates workflow steps to agents/prompts, updates the ticket, commits useful work, and pauses for human input when needed.

## Current Scope
- Markdown ticket schema for epics, stories, tasks, bugs.
- Dependency-free Node.js ESM CLI for validate/list/query/schema/create/start-work/begin-step/complete-step/approve-inline/move/set/section/comment/link/block/init.
- Section rewrites support `--file` for generated or multi-line Markdown.
- Front matter rewrite support with canonical field ordering.
- JSONC-configured local status model with dependency blocking, action dispatch, transition guidance, and strict routing evidence.
- Done-ticket retention that archives old closed tickets without deleting history.
- Prompt/role structure for delegated steps.
- Installable orchestration skills for Claude Code and Codex, Claude subagents, Codex executor prompts, and cross-harness installer.
- Human-readable docs for the workflow.
- Memory Bank for persistent AI context.

## Deferred
- Full orchestration implementation.
- Metrics dashboard.
- External board provider integrations.
- Multi-repo orchestration.
- Autonomous production deployment.
