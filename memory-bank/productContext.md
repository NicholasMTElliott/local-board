# Product Context

## Problem
AI-assisted development often loses planning state across sessions. External boards add setup, credentials, synchronization, and UI friction for local solo workflows.

## Solution
Store planning state as versioned Markdown tickets in the repo. Claude Code or Codex acts as orchestrator. Specialized agents or prompts execute discrete workflow steps.

## Users
- Primary: solo developer using Claude Code/Codex locally.
- Secondary: open-source contributors who want inspectable plans in git.

## UX Goals
- Plans are readable in any editor.
- State is reviewable in git diffs.
- Ticket IDs are stable and grep-friendly.
- Human approval gates are explicit.
- Questions are captured in the ticket, not lost in chat.
- Automation remains optional and inspectable.

## Core Workflow
1. Read eligible tickets.
2. Pick highest-priority unblocked ticket.
3. Decompose epics to stories, stories to tasks.
4. For tasks/bugs: design, branch, implement, review, specialty review if needed, test, update docs, commit, merge/push by policy.
5. Move uncertain work to questions.
