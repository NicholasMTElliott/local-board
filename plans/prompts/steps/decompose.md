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

Create child tickets and links only through the local-board CLI (`create`, `link-parent`, `link-child`, `block`). Do not write ticket files or front matter directly. When this step is delegated, the `local-board-decomposer` has no Write tool and does not mutate state — it returns a child-ticket proposal and the orchestrator runs `create`/`link-parent`/`link-child`/`block`.