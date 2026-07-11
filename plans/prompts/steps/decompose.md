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

Persistence is role-conditional — identify which role you are before acting:

- Delegated or return-only executor (the `local-board-decomposer` subagent or any `codex-task:read-only` route): return a child-ticket proposal containing each child's complete `Requirement` section body and acceptance criteria. Do not mutate local-board state, do not run `create`/`link-parent`/`link-child`/`block`/`section`, and do not write files.
- Orchestrator or inline route: create each child with `local-board create ... --parent <parent-id>`, add sibling dependencies with `block`, and persist each complete Requirement body through `section <child-id> --file <temp-path> --section "Requirement"`. Create the temporary file with the Write tool, never shell redirection. Do not write ticket files or front matter directly. In `requirementBody`, use `###` or deeper for internal headings (e.g. `### Acceptance Criteria`) and never include an unfenced `## ` line; the persistence guard rejects it.