# Decompose Step

Decompose the current ticket into child tickets.

Rules:
- epics create stories;
- stories create tasks;
- each child has clear acceptance criteria;
- link parent and children in front matter;
- preserve priority unless there is a clear reason to adjust;
- add dependencies when sequencing matters.

## Persistence

Create child tickets and links only through the local-board CLI (`create`, `link-parent`, `link-child`, `block`). Do not write ticket files or front matter directly. When this step is delegated, the `local-board-decomposer` subagent has no Write tool — it runs those CLI commands or proposes the tickets for the orchestrator to create.