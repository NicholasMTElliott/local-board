# Project Brief: local-board

## Purpose
Create a repo-native planning and orchestration system where tickets are Markdown files in `plans/`, and Claude Code acts as the primary orchestrator for local agent workflows.

## Product Thesis
External kanban boards are useful shared control planes, but solo/local AI development benefits from keeping planning state inside the repository.

## Success Target
A developer can ask Claude Code to run the local board. Claude reads `plans/`, picks the highest-priority eligible ticket, delegates workflow steps to agents/prompts, updates the ticket, commits useful work, and pauses for human input when needed.

## Current Scope
- Markdown ticket schema for epics, stories, tasks, bugs.
- Dependency-free Node.js ESM CLI for validate/list/query/schema/create/start-work/begin-step/complete-step/approve-inline/move/set/section/comment/link/block/init.
- Front matter rewrite support with canonical field ordering.
- JSONC-configured local status model with dependency blocking, action dispatch, and strict routing evidence.
- Prompt/role structure for delegated steps.
- Installable orchestration skill, Claude subagents, and cross-harness installer.
- Human-readable docs for the workflow.
- Memory Bank for persistent AI context.

## Deferred
- Full orchestration implementation.
- Metrics dashboard.
- External board provider integrations.
- Multi-repo orchestration.
- Autonomous production deployment.
