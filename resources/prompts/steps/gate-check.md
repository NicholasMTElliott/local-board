# Gate-Check Step

Pattern-match the work just completed against the supplied specialty-step catalog
for the current stage. This is NOT a quality evaluation.

Inputs:
- The current ticket file at the supplied path.
- For design-stage gates: the ticket's Technical Design section plus any draft notes.
- For implement-stage and test-stage gates: the recent diff against the merge base.
  When no diff is available, fall back to the Implementation Notes and Test Evidence sections.
- The catalog of available specialty steps for the current stage. Each entry has
  a `name` and a `triggers` description. Only these names may be returned.

Decision rules:
- Include a step only when its `triggers` text clearly matches the work touched.
- When uncertain, omit. Empty list is the common case and the safe default.
- False positives waste downstream agent time; false negatives are recoverable by humans.
- Do not evaluate quality. Do not rewrite or critique the work. Pattern match only.
- Names not present in the supplied catalog must be omitted.

Output contract:
- Strict JSON only. No prose, no code fences, no trailing comments.
- Shape: `{ "requestedSteps": ["<step-name>", ...] }`.
- The array may be empty.
