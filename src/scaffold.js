import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { defaultConfigJsonc } from "./config.js";

const TICKET_FOLDERS = ["backlog", "ready", "active", "questions", "blocked", "review", "done", "archive"];

const FILES = new Map([
  [
    ".gitignore",
    `# local-board ticket worktrees (see plans/local-board.config.jsonc: worktrees.location).
# Only used by the "inside" layout, but seeded regardless of the chosen layout so
# switching to it later never needs a manual .gitignore edit.
.worktrees/
`,
  ],
  [
    "plans/README.md",
    `# Plans

\`plans/\` is the file-backed board.

- \`tickets/\` stores work items.
- \`prompts/roles/\` stores durable role instructions.
- \`prompts/steps/\` stores durable step instructions.
- \`templates/\` stores reusable ticket skeletons.

Ticket front matter is canonical. Folder placement is a human convenience.
`,
  ],
  [
    "plans/tickets/README.md",
    `# Tickets

Human-friendly status folders for local-board tickets.

Front matter \`status\` is canonical. Folder placement should match it.
`,
  ],
  [
    "plans/templates/ticket.md",
    `---
id: TYYYYMMDDTHHMMZ
type: task
status: backlog
priority: P2
parent: null
children: []
blockedBy: []
blocks: []
branch: null
estimate: null
estimateBasis: null
workStartedAt: null
workCompletedAt: null
completedSteps: []
routingApprovals: []
created: YYYY-MM-DDTHH:MM:SSZ
updated: YYYY-MM-DDTHH:MM:SSZ
---

# Ticket Title

## Requirement

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
`,
  ],
  [
    "plans/prompts/roles/orchestrator.md",
    `# Orchestrator Role

You are the local-board orchestrator.

Read project instructions, \`memory-bank/\` when present, and \`plans/\` before acting.

Responsibilities:
- validate ticket state before work;
- select work through \`local-board query-next\`;
- load the returned step prompt;
- delegate only bounded work;
- update ticket front matter and sections through local-board commands;
- preserve human approval gates.

Do not hide state transitions in prose. Update front matter.
`,
  ],
  [
    "plans/prompts/roles/implementer.md",
    `# Implementer Role

Implement the current ticket's approved technical design.

Rules:
- keep changes scoped to the ticket;
- update tests with behavior changes;
- record important implementation notes in the ticket;
- stop and ask questions when requirements are ambiguous.
`,
  ],
  [
    "plans/prompts/roles/code_reviewer.md",
    `# Code Reviewer Role

Review the current ticket's changes for correctness, regressions, maintainability, and missing tests.

Lead with findings. If there are no findings, say so clearly and note residual risk.
`,
  ],
  [
    "plans/prompts/steps/decompose.md",
    `# Decompose Step

Decompose the current ticket into child tickets.

Rules:
- epics create stories;
- stories create tasks;
- each child has clear acceptance criteria;
- link parent and children in front matter;
- preserve priority unless there is a clear reason to adjust;
- add dependencies when sequencing matters.
`,
  ],
  [
    "plans/prompts/steps/design.md",
    `# Design Step

Write a technical design for the current ticket.

Include:
- relevant existing code and docs;
- proposed implementation approach;
- risks and edge cases;
- test plan;
- documentation impact.
`,
  ],
  [
    "plans/prompts/steps/test.md",
    `# Test Step

Verify the current ticket.

Include:
- commands run;
- results;
- gaps or risks;
- manual checks when automated tests are insufficient.
`,
  ],
  [
    "plans/prompts/steps/document.md",
    `# Document Step

Update project documentation required by the current ticket.

Rules:
- keep \`memory-bank/\` terse and current when present;
- update \`README.md\` when documentation entry points change;
- update \`docs/\` for human-facing narrative changes;
- record evidence in the ticket's \`## Documentation Updates\` section.
`,
  ],
]);

export async function initProject(root = ".", options = {}) {
  const rootPath = path.resolve(root);
  const overwrite = options.overwrite ?? false;
  const created = [];
  const skipped = [];

  for (const folder of TICKET_FOLDERS) {
    const folderPath = path.join(rootPath, "plans", "tickets", folder);
    await mkdir(folderPath, { recursive: true });
    await writeScaffoldFile(path.join(folderPath, ".gitkeep"), "", overwrite, created, skipped);
  }

  await mkdir(path.join(rootPath, "plans", "templates"), { recursive: true });
  await mkdir(path.join(rootPath, "plans", "prompts", "roles"), { recursive: true });
  await mkdir(path.join(rootPath, "plans", "prompts", "steps"), { recursive: true });

  for (const [relativePath, content] of FILES.entries()) {
    await writeScaffoldFile(path.join(rootPath, relativePath), content, overwrite, created, skipped);
  }

  await writeScaffoldFile(
    path.join(rootPath, "plans", "local-board.config.jsonc"),
    defaultConfigJsonc(),
    overwrite,
    created,
    skipped,
  );

  return { root: rootPath, created, skipped };
}

async function writeScaffoldFile(filePath, content, overwrite, created, skipped) {
  try {
    await writeFile(filePath, content, { encoding: "utf8", flag: overwrite ? "w" : "wx" });
    created.push(filePath);
  } catch (error) {
    if (error.code === "EEXIST") {
      skipped.push(filePath);
      return;
    }
    throw error;
  }
}
