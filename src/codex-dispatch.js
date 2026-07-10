import path from "node:path";

// Single authoritative translation from a resolved logical local-board route
// (as returned by `begin-step`) to a Codex dispatch. Pure: no fs, no config
// load. Everything the caller needs comes in via the `agentsDir`/`prompt`
// arguments (see src/cli.js commandBeginStep, which resolves agentsDir via
// the same selfPackageRoot() seam commandWhere uses).
//
// This is the machine-checkable half of the "Route Translation Contract"
// documented in skills/codex/local-board/SKILL.md and docs/CodexSupport.md;
// those files now point here instead of hand-maintaining the mapping table.

// Static role -> agentType map for the seven known
// `claude-subagent:local-board-<role>` roles. Mirrors the self-writing
// (worker) / return-only (explorer) partition already documented in
// SKILL.md "Dispatch Rules". Kept explicit (not derived) so a future role is
// added deliberately.
const ROLE_AGENT_TYPES = {
  decomposer: "explorer",
  reviewer: "explorer",
  tester: "explorer",
  gatecheck: "explorer",
  designer: "worker",
  implementer: "worker",
  documenter: "worker",
};

// Claude model aliases are not valid Codex model ids. A `claude`-prefixed id
// (e.g. a full "claude-*" model string) is denylisted the same way. Anything
// else, including null/empty (no model configured), sanitizes to null -> the
// dispatch omits a model override and evidence uses the documented
// `@codex-default` wildcard (see modelSatisfies in src/tickets.js).
const CLAUDE_MODEL_ALIASES = new Set(["opus", "sonnet", "haiku"]);

function sanitizeModel(model) {
  if (model === null || model === undefined) {
    return null;
  }
  const trimmed = model.trim();
  if (trimmed === "") {
    return null;
  }
  if (CLAUDE_MODEL_ALIASES.has(trimmed) || trimmed.startsWith("claude")) {
    return null;
  }
  return trimmed;
}

// `evidenceExecutor` is exactly what the orchestrator should pass to
// `complete-step --executor`: `<route>@<model>` when a real Codex model was
// pinned, else `<route>@codex-default` (always accepted by modelSatisfies).
function evidenceExecutorFor(route, sanitizedModel) {
  return sanitizedModel ? `${route}@${sanitizedModel}` : `${route}@codex-default`;
}

// translateCodexDispatch({ route, model, prompt, effort, agentsDir }) -> codexDispatch
//
// - `route`: the configured logical route (begin-step's `configuredAgent`),
//   e.g. "inline", "codex-task:workspace-write", "claude-subagent:local-board-designer".
// - `model`: the configured logical model (begin-step's `configuredModel`),
//   a Claude alias, a real id, or null.
// - `prompt`: the configured project prompt (begin-step's `configuredPrompt`),
//   may be null.
// - `effort`: the configured reasoning-effort token (begin-step's
//   `configuredEffort`), or null. Passed through verbatim -- unlike `model`,
//   effort is not Claude/Codex-partitioned, so there is no sanitization
//   denylist. Config already rejects effort on inline routes, so the inline
//   branch's effort is null in practice; the field is still included on
//   every branch for shape uniformity.
// - `agentsDir`: absolute directory containing the Codex executor prompt
//   fragments (one file per known claude-subagent role), resolved by the
//   caller (CLI layer) via the same seam `where` uses. Never resolved here.
export function translateCodexDispatch({ route, model, prompt, effort, agentsDir }) {
  if (route === "inline") {
    // inline runs on the orchestrator's own model and cannot pin one
    // (consistent with composeExecutor/isValidAgentValue).
    return {
      dispatchKind: "inline",
      agentType: null,
      promptPath: prompt ?? null,
      model: null,
      effort: effort ?? null,
      evidenceExecutor: "inline",
      known: true,
    };
  }

  if (route.startsWith("claude-subagent:")) {
    const suffix = route.slice("claude-subagent:".length);
    const roleMatch = /^local-board-(.+)$/.exec(suffix);
    const roleName = roleMatch ? roleMatch[1] : null;
    const agentType = roleName ? (ROLE_AGENT_TYPES[roleName] ?? null) : null;
    const sanitizedModel = sanitizeModel(model);

    if (agentType) {
      return {
        dispatchKind: "spawn_agent",
        agentType,
        promptPath: path.join(agentsDir, `local-board-${roleName}.md`),
        model: sanitizedModel,
        effort: effort ?? null,
        evidenceExecutor: evidenceExecutorFor(route, sanitizedModel),
        known: true,
      };
    }

    // Unknown claude-subagent role: do NOT fabricate a prompt path. Mirrors
    // the SKILL.md "unknown route" rule -- ask before falling back to inline.
    return {
      dispatchKind: "spawn_agent",
      agentType: null,
      promptPath: null,
      model: sanitizedModel,
      effort: effort ?? null,
      evidenceExecutor: evidenceExecutorFor(route, sanitizedModel),
      known: false,
      note: `unknown claude-subagent route "${route}"; ask the user for approval before falling back to inline, or move the ticket to questions`,
    };
  }

  if (route === "codex-task:read-only" || route === "codex-task:workspace-write") {
    // Native Codex routes: not table-translated, just carried through with
    // the same model sanitization rule. Flagged with `passthrough` so the
    // orchestrator can tell this apart from a claude-subagent translation.
    const agentType = route === "codex-task:read-only" ? "explorer" : "worker";
    const sanitizedModel = sanitizeModel(model);
    return {
      dispatchKind: "spawn_agent",
      agentType,
      promptPath: prompt ?? null,
      model: sanitizedModel,
      effort: effort ?? null,
      evidenceExecutor: evidenceExecutorFor(route, sanitizedModel),
      known: true,
      passthrough: true,
      note: "native Codex route; not table-translated",
    };
  }

  // Any other route shape (malformed, or a codex-task mode outside the two
  // documented ones): do not guess agentType or promptPath.
  const sanitizedModel = sanitizeModel(model);
  return {
    dispatchKind: "spawn_agent",
    agentType: null,
    promptPath: null,
    model: sanitizedModel,
    effort: effort ?? null,
    evidenceExecutor: evidenceExecutorFor(route, sanitizedModel),
    known: false,
    note: `unrecognized route "${route}"; ask the user for approval before falling back to inline, or move the ticket to questions`,
  };
}
