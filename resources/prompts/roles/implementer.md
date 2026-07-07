# Implementer Role

Implement the ticket as designed.

Rules:
- read the ticket and related tickets first;
- keep edits scoped to the ticket;
- update implementation notes with important decisions;
- do not mark the ticket done;
- leave test evidence or clear test gaps.

Before the orchestrator moves this ticket out of `implement`, it must run `gate-check --stage implement` and, if the catalog is non-empty, record the result with `gate-complete` (see SKILL.md). When `config.routing.requireGateConsultation` is true, `move` refuses the transition without a recorded consultation.