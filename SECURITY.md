# Security Policy

## Supported Versions

Versions are tagged on GitHub. For this small project, only the latest tagged release line receives security fixes.

| Version | Supported |
| --- | --- |
| Latest GitHub release | Yes |
| Older releases | No |

## Reporting a Vulnerability

Please report vulnerabilities privately through [GitHub Security Advisories](https://github.com/NicholasMTElliott/local-board/security/advisories/new). If that is not possible, email nicholasmtelliott@gmail.com.

Target acknowledgment time: 48 hours.

Do not disclose the issue publicly until a fix is shipped and a maintainer confirms disclosure timing.

## Security Model

local-board's CLI (`bin/`, `src/`) is dependency-free and makes no network calls. It reads and writes Markdown ticket files under `plans/` and performs local git operations (branch creation, worktrees, fast-forward, and — when `git.autoMerge` is enabled — merges into the default branch) within the repository you run it in.

The risk surface is delegation, not the CLI itself:

- The installable skills (`SKILL.md`, `SKILL_TEAM.md`) instruct an AI coding agent to design, implement, review, test, and document tickets, and to run git operations. That agent executes code and commands on your machine.
- Routing entries of the form `codex-task:*` shell out to an external executor; `claude-subagent:*` routes delegate to Claude Code subagents. Both run AI-generated work locally.
- `local-board install` (and the deprecated `node install.mjs` shim) writes skill and agent files into your home-directory agent config and patches the Claude Code settings allow-list.
- For tests or sandboxed audits, run installs with `--home <dir>` and optionally `LOCAL_BOARD_INSTALL_REQUIRE_HOME=1` so consent-sensitive writes cannot fall through to your real home directory.

Use local-board only against repositories and workflows you control and review. Treat agent-proposed changes as untrusted until reviewed, the same as any pull request.

### Orchestrator-authored evidence

Return-only subagents (reviewer, tester, gatecheck, decomposer, and read-only Codex routes) have no Write or Edit tool: they return findings, and the orchestrator persists them to the ticket via `section --file`. The orchestrator could substitute or summarize that content before writing it, and nothing detects the divergence. The dispatch ledger and enforcement hooks prove a matching dispatch happened; they do not prove the persisted content matches what the subagent returned. This is inherent to the return-only architecture, not a bug to be fixed. Mitigation: review ticket diffs like any pull request — evidence sections travel through ordinary git commits.

local-board does not store credentials and ships no secrets. If you find a committed secret, report it as a vulnerability rather than opening a public issue.
