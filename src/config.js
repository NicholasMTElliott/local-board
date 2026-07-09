import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const CONFIG_PATH = path.join("plans", "local-board.config.jsonc");

export const OPTIONAL_STEP_STAGES = ["design", "implement", "test"];
const MANDATORY_ACTION_NAMES = new Set([
  "decompose",
  "design",
  "implement",
  "review",
  "test",
  "document",
]);

// DEFAULT_CONFIG plays two runtime roles — it is NOT the same thing as the
// scaffolded config below it, minus some values:
//   1. ENOENT fallback: when no config file exists, loadConfig returns
//      structuredClone(DEFAULT_CONFIG) as the entire effective config.
//   2. Deep-merge base: when a config file DOES exist, it is deep-merged onto
//      DEFAULT_CONFIG, so every key here is a backward-compat default for
//      configs that omit that block.
// It deliberately differs from defaultConfigJsonc() (the blessed `init`
// scaffold, below) in the documented places below, all required by role 2:
//   - estimation.enabled: false here (vs true in the scaffold) so a
//     pre-estimation config that omits the `estimation` block does not
//     silently start enforcing the estimation gate.
//   - optionalSteps: all stages empty here (vs populated in the scaffold)
//     because optionalSteps arrays are merged wholesale per stage; a
//     populated default here would make a user config that omits a stage
//     silently inherit built-in specialties.
//   - routing.requireGateConsultation: false here (vs true in the scaffold)
//     so a pre-gate-consultation config that omits the key does not suddenly
//     start refusing forward moves out of design/implement/test on upgrade.
//   - routing.invalidateOnLoopBack: false here (vs true in the scaffold) so a
//     pre-existing config that omits the key does not silently start
//     stripping completedSteps/routingApprovals tokens on loop-back moves.
//   - worktrees.guardWrongRoot: false here (vs true in the scaffold) so a
//     pre-existing board that omits the key does not silently start refusing
//     per-ticket mutations invoked from the wrong root.
//   - routing.enforceTransitions: false here (vs true in the scaffold) so a
//     pre-existing config that omits the key does not silently start
//     refusing moves whose target status is outside workflow.transitions +
//     the structural allow-set (see isTransitionAllowed in src/tickets.js).
//   - routing.guardPrematureEvidence: false here (vs true in the scaffold) so
//     a pre-existing config that omits the key does not silently start
//     refusing complete-step calls whose evidence a still-pending forward
//     move would strip (see evidenceStrippedByPendingForwardMove in
//     src/tickets.js).
//   - git.commitPlanningOnTransition: false here (vs true in the scaffold) so
//     a pre-existing board that omits the key does not silently start
//     committing planning-only changes after every mutating command.
// These differences are pinned by tests in test/config.test.js (search
// "backward-compat disabled" and "empty optionalSteps catalog"). Do NOT
// converge them to match the scaffold — see the guard test
// "defaultConfigJsonc matches DEFAULT_CONFIG except for documented
// differences" in test/config.test.js, which locks the remaining shared
// blocks (workflow, agents, routing, retention, git, worktrees) in sync
// while allowlisting only these intentional differences.
export const DEFAULT_CONFIG = {
  version: 1,
  workflow: {
    pipelineOrder: [
      "ready_for_docs",
      "ready_for_test",
      "ready_for_review",
      "ready_for_implementation",
      "ready_for_design",
      "ready_for_decomposition",
    ],
    statusActions: {
      ready_for_decomposition: "decompose",
      ready_for_design: "design",
      ready_for_implementation: "implement",
      ready_for_review: "review",
      ready_for_test: "test",
      ready_for_docs: "document",
    },
    actionPrompts: {
      decompose: "plans/prompts/steps/decompose.md",
      design: "plans/prompts/steps/design.md",
      implement: "plans/prompts/roles/implementer.md",
      review: "plans/prompts/roles/code_reviewer.md",
      test: "plans/prompts/steps/test.md",
      document: "plans/prompts/steps/document.md",
    },
    transitions: {
      ready_for_decomposition: [
        {
          status: "done",
          when: "Use after decomposition is complete, child tickets are linked, and decomposition evidence is recorded.",
        },
        {
          status: "questions",
          when: "Use when decomposition needs user input before it can continue.",
        },
        {
          status: "blocked",
          when: "Use only when a non-ticket blocker stops decomposition.",
        },
      ],
      ready_for_design: [
        {
          status: "ready_for_implementation",
          when: "Use after the technical design is complete and design evidence is recorded.",
        },
        {
          status: "questions",
          when: "Use when design needs user input before it can continue.",
        },
        {
          status: "blocked",
          when: "Use only when a non-ticket blocker stops design.",
        },
      ],
      designing: [
        {
          status: "ready_for_implementation",
          when: "Use after the technical design is complete and design evidence is recorded.",
        },
        {
          status: "questions",
          when: "Use when design needs user input before it can continue.",
        },
        {
          status: "blocked",
          when: "Use only when a non-ticket blocker stops design.",
        },
      ],
      ready_for_implementation: [
        {
          status: "ready_for_review",
          when: "Use after implementation is complete, committed, and implementation evidence is recorded.",
        },
        {
          status: "ready_for_design",
          when: "Use when implementation reveals a design gap or contradiction.",
        },
        {
          status: "questions",
          when: "Use when implementation needs user input before it can continue.",
        },
        {
          status: "blocked",
          when: "Use only when a non-ticket blocker stops implementation.",
        },
      ],
      implementing: [
        {
          status: "ready_for_review",
          when: "Use after implementation is complete, committed, and implementation evidence is recorded.",
        },
        {
          status: "ready_for_design",
          when: "Use when implementation reveals a design gap or contradiction.",
        },
        {
          status: "questions",
          when: "Use when implementation needs user input before it can continue.",
        },
        {
          status: "blocked",
          when: "Use only when a non-ticket blocker stops implementation.",
        },
      ],
      ready_for_review: [
        {
          status: "ready_for_test",
          when: "Use when review finds no blocking issues and review evidence is recorded.",
        },
        {
          status: "ready_for_implementation",
          when: "Use when review finds implementation defects or gaps.",
        },
        {
          status: "ready_for_design",
          when: "Use when review finds a fundamental design issue, contradiction, or flaw.",
        },
        {
          status: "questions",
          when: "Use when review needs user input before it can continue.",
        },
        {
          status: "blocked",
          when: "Use only when a non-ticket blocker stops review.",
        },
      ],
      reviewing: [
        {
          status: "ready_for_test",
          when: "Use when review finds no blocking issues and review evidence is recorded.",
        },
        {
          status: "ready_for_implementation",
          when: "Use when review finds implementation defects or gaps.",
        },
        {
          status: "ready_for_design",
          when: "Use when review finds a fundamental design issue, contradiction, or flaw.",
        },
        {
          status: "questions",
          when: "Use when review needs user input before it can continue.",
        },
        {
          status: "blocked",
          when: "Use only when a non-ticket blocker stops review.",
        },
      ],
      ready_for_test: [
        {
          status: "ready_for_docs",
          when: "Use when tests pass, relevant evidence is recorded, and no blocking failures remain.",
        },
        {
          status: "ready_for_implementation",
          when: "Use when tests fail because implementation changes are required.",
        },
        {
          status: "ready_for_design",
          when: "Use when tests expose a fundamental design issue.",
        },
        {
          status: "questions",
          when: "Use when testing needs user input before it can continue.",
        },
        {
          status: "blocked",
          when: "Use only when a non-ticket blocker stops testing.",
        },
      ],
      testing: [
        {
          status: "ready_for_docs",
          when: "Use when tests pass, relevant evidence is recorded, and no blocking failures remain.",
        },
        {
          status: "ready_for_implementation",
          when: "Use when tests fail because implementation changes are required.",
        },
        {
          status: "ready_for_design",
          when: "Use when tests expose a fundamental design issue.",
        },
        {
          status: "questions",
          when: "Use when testing needs user input before it can continue.",
        },
        {
          status: "blocked",
          when: "Use only when a non-ticket blocker stops testing.",
        },
      ],
      ready_for_docs: [
        {
          status: "done",
          when: "Use after documentation is complete, documentation evidence is recorded, and all required stages are complete.",
        },
        {
          status: "ready_for_implementation",
          when: "Use when documentation work exposes an implementation gap.",
        },
        {
          status: "ready_for_design",
          when: "Use when documentation work exposes a design contradiction or flaw.",
        },
        {
          status: "questions",
          when: "Use when documentation needs user input before it can continue.",
        },
        {
          status: "blocked",
          when: "Use only when a non-ticket blocker stops documentation.",
        },
      ],
    },
  },
  agents: {
    decompose: { route: "claude-subagent:local-board-decomposer", model: "opus" },
    "gate-check": { route: "claude-subagent:local-board-gatecheck", model: "haiku" },
    design: { route: "claude-subagent:local-board-designer", model: "opus" },
    implement: { route: "claude-subagent:local-board-implementer", model: "sonnet" },
    review: { route: "codex-task:read-only" },
    test: { route: "claude-subagent:local-board-tester", model: "sonnet" },
    document: { route: "codex-task:workspace-write" },
  },
  routing: {
    strict: true,
    doneRequires: {
      epic: ["decompose"],
      story: ["decompose"],
      task: ["design", "implement", "review", "test", "document"],
      bug: ["design", "implement", "review", "test", "document"],
    },
    requireGateConsultation: false,
    invalidateOnLoopBack: false,
    enforceTransitions: false,
    guardPrematureEvidence: false,
  },
  retention: {
    archiveDoneAfterDays: 30,
    archiveOnMoveDone: true,
  },
  git: {
    defaultBranch: null,
    commitPlanningChanges: true,
    autoMerge: false,
    pruneMergedBranches: true,
    commitPlanningOnTransition: false,
  },
  optionalSteps: {
    design: [],
    implement: [],
    test: [],
  },
  worktrees: {
    location: "sibling",
    guardWrongRoot: false,
  },
  estimation: {
    enabled: false,
    scale: [1, 2, 4, 8],
    bootstrapDefault: 4,
    splitThreshold: 16,
  },
};

export async function loadConfig(root = ".") {
  const configPath = path.resolve(root, CONFIG_PATH);
  let merged;
  let rawAgents = null;
  try {
    const parsed = parseJsonc(await readFile(configPath, "utf8"));
    merged = mergeConfig(DEFAULT_CONFIG, parsed);
    if (isObject(parsed) && isObject(parsed.agents)) {
      rawAgents = parsed.agents;
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      merged = structuredClone(DEFAULT_CONFIG);
    } else {
      throw new Error(`${configPath}: ${error.message}`);
    }
  }

  // Agent profiles are replaced wholesale per action, not deep-merged. A user
  // override like { design: { route: "inline" } } must NOT inherit the default
  // profile's model (which would be invalid on inline) or carry a Claude model
  // onto a codex route. mergeConfig deep-merged them; restore the raw entries.
  if (rawAgents !== null) {
    for (const key of Object.keys(rawAgents)) {
      merged.agents[key] = structuredClone(rawAgents[key]);
    }
  }

  try {
    normalizeOptionalSteps(merged, configPath);
    normalizeEstimation(merged);
    normalizeWorktrees(merged);
    normalizeAgents(merged);
  } catch (error) {
    throw new Error(`${configPath}: ${error.message}`);
  }
  return merged;
}

// Normalize the agents map so every entry is a profile object
// { route, model?, prompt? }. A bare string is sugar for { route }, so legacy
// configs and DEFAULT_CONFIG (which use route strings) load unchanged.
function normalizeAgents(merged) {
  if (!isObject(merged.agents)) {
    throw new Error("agents must be an object");
  }
  const normalized = {};
  for (const [key, value] of Object.entries(merged.agents)) {
    normalized[key] = normalizeAgentProfile(value, key);
  }
  merged.agents = normalized;
}

function normalizeAgentProfile(value, key) {
  if (typeof value === "string") {
    if (!isValidAgentRoute(value)) {
      throw new Error(`agents.${key} route "${value}" is not a valid route`);
    }
    return { route: value };
  }
  if (!isObject(value)) {
    throw new Error(
      `agents.${key} must be a route string or a { route, model?, prompt? } object`,
    );
  }

  const { route, model, prompt } = value;
  if (typeof route !== "string" || !isValidAgentRoute(route)) {
    throw new Error(
      `agents.${key} requires a valid route string; got ${JSON.stringify(route)}`,
    );
  }
  const profile = { route };

  if (model !== undefined && model !== null) {
    if (typeof model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(model)) {
      throw new Error(
        `agents.${key} model must be a model alias or id; got ${JSON.stringify(model)}`,
      );
    }
    if (route === "inline") {
      throw new Error(
        `agents.${key} route "inline" cannot carry a model; route the step to a subagent to pin a model`,
      );
    }
    profile.model = model;
  }

  if (prompt !== undefined && prompt !== null) {
    if (typeof prompt !== "string" || prompt.trim() === "") {
      throw new Error(`agents.${key} prompt must be a non-empty string path`);
    }
    profile.prompt = prompt;
  }

  return profile;
}

export function isValidAgentRoute(value) {
  return (
    value === "inline" ||
    /^claude-subagent:[a-z0-9][a-z0-9-]*$/.test(value) ||
    /^codex-task:[a-z0-9][a-z0-9-]*$/.test(value)
  );
}

function normalizeOptionalSteps(merged, configPath) {
  if (!isObject(merged.optionalSteps)) {
    merged.optionalSteps = { design: [], implement: [], test: [] };
    return;
  }

  const normalized = {};
  // Names must be unique across ALL stages, not just within one: routing
  // resolves a specialty step by name across stages and uses the first match,
  // so a cross-stage duplicate would route validation to the wrong entry.
  const seenNames = new Set();
  for (const stage of OPTIONAL_STEP_STAGES) {
    const value = merged.optionalSteps[stage];
    if (value === undefined || value === null) {
      normalized[stage] = [];
      continue;
    }
    if (!Array.isArray(value)) {
      throw new Error(`optionalSteps.${stage} must be an array`);
    }
    normalized[stage] = value.map((entry) => validateOptionalStepEntry(entry, stage, seenNames));
  }

  for (const key of Object.keys(merged.optionalSteps)) {
    if (!OPTIONAL_STEP_STAGES.includes(key)) {
      console.warn(`${configPath}: ignoring unknown optionalSteps stage "${key}"`);
    }
  }

  merged.optionalSteps = normalized;
}

function normalizeEstimation(merged) {
  if (!isObject(merged.estimation)) {
    throw new Error("estimation must be an object");
  }

  const { enabled, scale, bootstrapDefault, splitThreshold } = merged.estimation;

  if (typeof enabled !== "boolean") {
    throw new Error("estimation.enabled must be a boolean");
  }

  if (!Array.isArray(scale) || scale.length === 0) {
    throw new Error("estimation.scale must be a non-empty array of positive integers");
  }
  for (const value of scale) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(
        `estimation.scale must contain only positive integers; got ${JSON.stringify(value)}`,
      );
    }
  }
  for (let index = 1; index < scale.length; index += 1) {
    if (scale[index] <= scale[index - 1]) {
      throw new Error(
        `estimation.scale must be strictly ascending; got ${JSON.stringify(scale)}`,
      );
    }
  }

  if (!Number.isInteger(bootstrapDefault) || bootstrapDefault <= 0) {
    throw new Error(
      `estimation.bootstrapDefault must be a positive integer; got ${JSON.stringify(bootstrapDefault)}`,
    );
  }
  if (!scale.includes(bootstrapDefault)) {
    throw new Error(
      `estimation.bootstrapDefault ${bootstrapDefault} is not a member of estimation.scale ${JSON.stringify(
        scale,
      )}; set bootstrapDefault explicitly when overriding scale`,
    );
  }

  if (!Number.isInteger(splitThreshold) || splitThreshold <= 0) {
    throw new Error(
      `estimation.splitThreshold must be a positive integer; got ${JSON.stringify(splitThreshold)}`,
    );
  }
}

// Type/emptiness only. The plans/-interior guard needs repoRoot, which is not
// known at config-load time; it is enforced in worktreesRootFor (src/worktrees.js)
// once repoRoot is resolved.
function normalizeWorktrees(merged) {
  if (merged.worktrees === undefined || merged.worktrees === null) {
    merged.worktrees = { location: "sibling", guardWrongRoot: false };
    return;
  }
  if (!isObject(merged.worktrees)) {
    throw new Error("worktrees must be an object");
  }
  const { location, guardWrongRoot } = merged.worktrees;
  if (typeof location !== "string" || location.trim() === "") {
    throw new Error(
      `worktrees.location must be a non-empty string; got ${JSON.stringify(location)}`,
    );
  }
  if (typeof guardWrongRoot !== "boolean") {
    throw new Error(
      `worktrees.guardWrongRoot must be a boolean; got ${JSON.stringify(guardWrongRoot)}`,
    );
  }
  merged.worktrees = { location, guardWrongRoot };
}

function validateOptionalStepEntry(entry, stage, seenNames) {
  if (!isObject(entry)) {
    throw new Error(`optionalSteps.${stage} entries must be objects`);
  }
  const { name, prompt, triggers, agent } = entry;
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error(`optionalSteps.${stage} entry is missing a non-empty name`);
  }
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`optionalSteps.${stage} entry name "${name}" must be lowercase snake_case (matching /^[a-z][a-z0-9_]*$/)`);
  }
  if (typeof prompt !== "string" || prompt.trim() === "") {
    throw new Error(`optionalSteps.${stage} entry "${name}" is missing a non-empty prompt`);
  }
  if (typeof triggers !== "string" || triggers.trim() === "") {
    throw new Error(`optionalSteps.${stage} entry "${name}" is missing a non-empty triggers`);
  }
  if (MANDATORY_ACTION_NAMES.has(name)) {
    throw new Error(
      `optionalSteps.${stage} entry name "${name}" collides with a mandatory action`,
    );
  }
  if (seenNames.has(name)) {
    throw new Error(
      `optionalSteps has duplicate name "${name}"; optional step names must be unique across all stages`,
    );
  }
  seenNames.add(name);

  const normalized = { name, prompt, triggers };
  if (agent !== undefined) {
    if (typeof agent !== "string" || !isValidOptionalStepAgent(agent)) {
      throw new Error(
        `optionalSteps.${stage} entry "${name}" has invalid agent "${String(agent)}"`,
      );
    }
    normalized.agent = agent;
  }
  return normalized;
}

function isValidOptionalStepAgent(value) {
  return isValidAgentRoute(value);
}

export async function writeDefaultConfig(root = ".", overwrite = false) {
  const configPath = path.resolve(root, CONFIG_PATH);
  const flag = overwrite ? "w" : "wx";
  await writeFile(configPath, defaultConfigJsonc(), { encoding: "utf8", flag });
  return configPath;
}

// This is the blessed `init` scaffold written to a new repo's config file —
// distinct from DEFAULT_CONFIG above (the ENOENT fallback / deep-merge base),
// which intentionally differs in estimation.enabled and optionalSteps. See
// the comment on DEFAULT_CONFIG for why.
export function defaultConfigJsonc() {
  return `{
  // Config schema version. Keep this at 1 until a future migration says otherwise.
  "version": 1,

  // Workflow dispatch controls which ready statuses are eligible and what action they request.
  "workflow": {
    // Tie-break order after priority. Earlier entries are considered closer to completion.
    // Available statuses: ready_for_decomposition, ready_for_design, ready_for_implementation,
    // ready_for_review, ready_for_test, ready_for_docs.
    "pipelineOrder": [
      "ready_for_docs",
      "ready_for_test",
      "ready_for_review",
      "ready_for_implementation",
      "ready_for_design",
      "ready_for_decomposition"
    ],

    // Maps ticket status to the action returned by query-next/query-ticket.
    // Available actions: decompose, design, implement, review, test, document.
    "statusActions": {
      "ready_for_decomposition": "decompose",
      "ready_for_design": "design",
      "ready_for_implementation": "implement",
      "ready_for_review": "review",
      "ready_for_test": "test",
      "ready_for_docs": "document"
    },

    // Prompt file loaded for each action. Project-local paths are preferred by the skill.
    "actionPrompts": {
      "decompose": "plans/prompts/steps/decompose.md",
      "design": "plans/prompts/steps/design.md",
      "implement": "plans/prompts/roles/implementer.md",
      "review": "plans/prompts/roles/code_reviewer.md",
      "test": "plans/prompts/steps/test.md",
      "document": "plans/prompts/steps/document.md"
    },

    // Status outcomes for each workflow decision point.
    // Use exact status values with "move <ticket-id> <status>".
    // This map is the pipeline-ordering authority when routing.enforceTransitions
    // (below) is true: "move"/"set <id> status" refuse a target status not
    // listed here for the ticket's current status, unless the move is in the
    // fixed structural allow-set (same-status re-save, backlog promote,
    // ready->active start-work, active->own-ready revert, questions/blocked
    // resume, any->archived/questions/blocked) or --override is used. It is
    // advisory-only guidance when enforceTransitions is false.
    // Ticket dependencies should use blockedBy and stay in the intended ready status.
    // status: blocked is reserved for non-ticket blockers.
    "transitions": {
      "ready_for_decomposition": [
        {
          "status": "done",
          "when": "Use after decomposition is complete, child tickets are linked, and decomposition evidence is recorded."
        },
        {
          "status": "questions",
          "when": "Use when decomposition needs user input before it can continue."
        },
        {
          "status": "blocked",
          "when": "Use only when a non-ticket blocker stops decomposition."
        }
      ],
      "ready_for_design": [
        {
          "status": "ready_for_implementation",
          "when": "Use after the technical design is complete and design evidence is recorded."
        },
        {
          "status": "questions",
          "when": "Use when design needs user input before it can continue."
        },
        {
          "status": "blocked",
          "when": "Use only when a non-ticket blocker stops design."
        }
      ],
      "designing": [
        {
          "status": "ready_for_implementation",
          "when": "Use after the technical design is complete and design evidence is recorded."
        },
        {
          "status": "questions",
          "when": "Use when design needs user input before it can continue."
        },
        {
          "status": "blocked",
          "when": "Use only when a non-ticket blocker stops design."
        }
      ],
      "ready_for_implementation": [
        {
          "status": "ready_for_review",
          "when": "Use after implementation is complete, committed, and implementation evidence is recorded."
        },
        {
          "status": "ready_for_design",
          "when": "Use when implementation reveals a design gap or contradiction."
        },
        {
          "status": "questions",
          "when": "Use when implementation needs user input before it can continue."
        },
        {
          "status": "blocked",
          "when": "Use only when a non-ticket blocker stops implementation."
        }
      ],
      "implementing": [
        {
          "status": "ready_for_review",
          "when": "Use after implementation is complete, committed, and implementation evidence is recorded."
        },
        {
          "status": "ready_for_design",
          "when": "Use when implementation reveals a design gap or contradiction."
        },
        {
          "status": "questions",
          "when": "Use when implementation needs user input before it can continue."
        },
        {
          "status": "blocked",
          "when": "Use only when a non-ticket blocker stops implementation."
        }
      ],
      "ready_for_review": [
        {
          "status": "ready_for_test",
          "when": "Use when review finds no blocking issues and review evidence is recorded."
        },
        {
          "status": "ready_for_implementation",
          "when": "Use when review finds implementation defects or gaps."
        },
        {
          "status": "ready_for_design",
          "when": "Use when review finds a fundamental design issue, contradiction, or flaw."
        },
        {
          "status": "questions",
          "when": "Use when review needs user input before it can continue."
        },
        {
          "status": "blocked",
          "when": "Use only when a non-ticket blocker stops review."
        }
      ],
      "reviewing": [
        {
          "status": "ready_for_test",
          "when": "Use when review finds no blocking issues and review evidence is recorded."
        },
        {
          "status": "ready_for_implementation",
          "when": "Use when review finds implementation defects or gaps."
        },
        {
          "status": "ready_for_design",
          "when": "Use when review finds a fundamental design issue, contradiction, or flaw."
        },
        {
          "status": "questions",
          "when": "Use when review needs user input before it can continue."
        },
        {
          "status": "blocked",
          "when": "Use only when a non-ticket blocker stops review."
        }
      ],
      "ready_for_test": [
        {
          "status": "ready_for_docs",
          "when": "Use when tests pass, relevant evidence is recorded, and no blocking failures remain."
        },
        {
          "status": "ready_for_implementation",
          "when": "Use when tests fail because implementation changes are required."
        },
        {
          "status": "ready_for_design",
          "when": "Use when tests expose a fundamental design issue."
        },
        {
          "status": "questions",
          "when": "Use when testing needs user input before it can continue."
        },
        {
          "status": "blocked",
          "when": "Use only when a non-ticket blocker stops testing."
        }
      ],
      "testing": [
        {
          "status": "ready_for_docs",
          "when": "Use when tests pass, relevant evidence is recorded, and no blocking failures remain."
        },
        {
          "status": "ready_for_implementation",
          "when": "Use when tests fail because implementation changes are required."
        },
        {
          "status": "ready_for_design",
          "when": "Use when tests expose a fundamental design issue."
        },
        {
          "status": "questions",
          "when": "Use when testing needs user input before it can continue."
        },
        {
          "status": "blocked",
          "when": "Use only when a non-ticket blocker stops testing."
        }
      ],
      "ready_for_docs": [
        {
          "status": "done",
          "when": "Use after documentation is complete, documentation evidence is recorded, and all required stages are complete."
        },
        {
          "status": "ready_for_implementation",
          "when": "Use when documentation work exposes an implementation gap."
        },
        {
          "status": "ready_for_design",
          "when": "Use when documentation work exposes a design contradiction or flaw."
        },
        {
          "status": "questions",
          "when": "Use when documentation needs user input before it can continue."
        },
        {
          "status": "blocked",
          "when": "Use only when a non-ticket blocker stops documentation."
        }
      ]
    }
  },

  // Agent routing is enforced by strict routing commands and validation.
  // Each entry is a route string or a { route, model?, prompt? } profile.
  // A bare string is sugar for { route }. route values: inline,
  // claude-subagent:<agent-name>, codex-task:<mode>. model pins the per-step
  // model for subagent/codex routes (alias like opus/sonnet/haiku or a full id);
  // it is rejected on inline routes. prompt overrides workflow.actionPrompts.
  // Codex examples: codex-task:read-only, codex-task:workspace-write.
  "agents": {
    "decompose": { "route": "claude-subagent:local-board-decomposer", "model": "opus" },
    "gate-check": { "route": "claude-subagent:local-board-gatecheck", "model": "haiku" },
    "design": { "route": "claude-subagent:local-board-designer", "model": "opus" },
    "implement": { "route": "claude-subagent:local-board-implementer", "model": "sonnet" },
    "review": { "route": "codex-task:read-only" },
    "test": { "route": "claude-subagent:local-board-tester", "model": "sonnet" },
    "document": { "route": "codex-task:workspace-write" }
  },

  // Routing policy is enforced by validate, complete-step, and move-to-done.
  // strict: true means configured non-inline routes require matching completion evidence
  // or an explicit routing approval.
  "routing": {
    "strict": true,
    "doneRequires": {
      "epic": ["decompose"],
      "story": ["decompose"],
      "task": ["design", "implement", "review", "test", "document"],
      "bug": ["design", "implement", "review", "test", "document"]
    },
    // requireGateConsultation: true refuses "move" out of design/implement/test
    // (the ready_for_* or active variant) toward the next stage unless a
    // gate:<stage>:<executor> consultation token is recorded in completedSteps
    // (via gate-check's empty-catalog auto-stamp or the gate-complete verb).
    // Backward, lateral (questions/blocked), and archive/done moves are never
    // gated. Set to false to opt out.
    "requireGateConsultation": true,
    // invalidateOnLoopBack: true strips stale completedSteps (action, gate:,
    // and specialty tokens) and matching routingApprovals when a "move"
    // targets a ready_* pipeline status and evidence at or downstream of that
    // status already exists (a loop-back, e.g. ready_for_test back to
    // ready_for_implementation after a test failure). Forces the re-run
    // steps to re-record their evidence before the ticket can reach done.
    // Ordinary forward moves strip nothing themselves: at that point downstream
    // evidence simply does not exist yet. Evidence recorded PREMATURELY (e.g.
    // while sitting at questions/blocked/backlog, ahead of its producing
    // ready_* status) is exactly what a later forward move strips — which is
    // why routing.guardPrematureEvidence exists, to refuse that recording up
    // front instead of silently losing it here. One Run Log line enumerates
    // exactly what was removed.
    // Set to false to opt out (pre-existing boards must opt in explicitly:
    // this key predates DEFAULT_CONFIG's fallback, so an omitted key keeps
    // old behavior). Migration note: invalidation only applies to *future*
    // loop-back moves; evidence already stale from a loop-back before this
    // key was enabled is not retroactively cleaned.
    "invalidateOnLoopBack": true,
    // enforceTransitions: true promotes workflow.transitions above from
    // advisory guidance to a hard validator: "move"/"set <id> status" refuse
    // a target status not listed in workflow.transitions[fromStatus] for the
    // ticket's current status, unless the move is in a fixed structural
    // allow-set (start-work's ready_*->active move, reverting an active
    // status to its ready_*, resuming from questions/blocked, promoting out
    // of backlog, or any move to archived) or --override --reason <text> is
    // passed (recorded in the Run Log). The refusal error names the allowed
    // targets. Set to false for advisory-only mode (nothing is ever refused;
    // pre-existing boards that omit this key keep that behavior via
    // DEFAULT_CONFIG's fallback).
    "enforceTransitions": true,
    // guardPrematureEvidence: true refuses "complete-step" when recording a
    // mandatory-action or specialty-step token now would be stripped by a
    // still-pending forward move (the same relation invalidateOnLoopBack's
    // stripper uses: the token's producing ready_* status ranks upstream of
    // the ticket's current pipeline position). For example, recording
    // "review" evidence while the ticket sits at ready_for_implementation
    // (e.g. after a changes_requested loop-back) is refused, because the
    // later forward move into ready_for_review would strip it, only
    // surfacing at "move done" as a missing-evidence failure. The refusal
    // names the earliest status where the evidence survives. Gate-consultation
    // tokens (gate-complete) are out of scope. Re-run with --override
    // --reason <text> to record anyway (appended to the Run Log), or set to
    // false to disable (pre-existing boards that omit this key keep that
    // behavior via DEFAULT_CONFIG's fallback).
    "guardPrematureEvidence": true
  },

  // Done tickets are recent closeout history. Older done tickets are retained
  // by moving them to archived, never by deleting them automatically.
  "retention": {
    "archiveDoneAfterDays": 30,
    "archiveOnMoveDone": true
  },

  // Conservative git policy defaults. The orchestrator may still ask before git operations.
  // defaultBranch: null auto-detects origin/HEAD, main, then master.
  // autoMerge: true makes "move <ticket-id> done" commit planning-only ticket updates,
  // switch to the default branch, and merge the recorded ticket branch.
  // commitPlanningOnTransition: true makes every mutating command (move, complete-step,
  // gate-complete, section, etc.) commit planning-only changes (plans/**) immediately
  // after a successful mutation, when the root is a git checkout. Field-reported
  // motivation: executors run with full Bash access and sometimes issue destructive git
  // operations (an aborted merge, a tester's 'git checkout -- .' probe) against a worktree
  // whose only uncommitted state is the ticket's own stage transitions; committing at each
  // transition makes that state recoverable. No-op when the working tree's planning paths
  // are already clean, so back-to-back CLI calls stay cheap.
  "git": {
    "defaultBranch": null,
    "commitPlanningChanges": true,
    "autoMerge": false,
    "pruneMergedBranches": true,
    "commitPlanningOnTransition": true
  },

  // Optional specialty review steps per stage. Each entry is shaped
  // { name, prompt, triggers, agent? }. The gate-check action picks zero or more
  // entries from the relevant stage catalog based on the work just completed.
  // Per-entry agent overrides the default routing for that specialty;
  // when omitted the specialty runs inline. Setting a stage to an empty array
  // wipes the default catalog for that stage; the loader's array merge is wholesale.
  "optionalSteps": {
    "design": [
      {
        "name": "security_threat_model",
        "prompt": "plans/prompts/optional-steps/design/security_threat_model.md",
        "triggers": "Auth, authorization, cryptography, external API integrations, PII handling, new attack surface."
      },
      {
        "name": "ui_component_review",
        "prompt": "plans/prompts/optional-steps/design/ui_component_review.md",
        "triggers": "New or substantially modified user-facing UI components, layout changes, design-system additions."
      },
      {
        "name": "ux_interaction_review",
        "prompt": "plans/prompts/optional-steps/design/ux_interaction_review.md",
        "triggers": "New user-facing flows, interaction patterns, or significant changes to existing flows."
      }
    ],
    "implement": [
      {
        "name": "security_audit",
        "prompt": "plans/prompts/optional-steps/impl/security_audit.md",
        "triggers": "Changes to authentication/authorization code; permission grants, consent state, or settings files that gate tool execution (e.g. Claude settings.json allow rules, hooks entries, approved-command lists); credential, token, or secret handling; external API calls; validation of untrusted input crossing a trust boundary (network payloads, uploaded files, third-party responses) - not internal CLI flag or argument parsing."
      },
      {
        "name": "ui_visual_review",
        "prompt": "plans/prompts/optional-steps/impl/ui_visual_review.md",
        "triggers": "Visible UI changes - styles, layouts, components, accessibility-relevant markup."
      }
    ],
    "test": []
  },

  // Placement for ticket worktrees created by worktree-add.
  // location: "sibling" (default) places worktrees at
  // <dirname(repoRoot)>/<basename(repoRoot)>-worktrees, outside the repo. Under a Codex
  // workspace-write sandbox this directory is outside the writable workspace root and
  // needs an additional writable root (see docs/CodexSupport.md).
  // "inside" places worktrees at <repoRoot>/.worktrees (git-ignored), which is under the
  // workspace root and needs no extra sandbox config — recommended for Codex parallel runs.
  // Any other non-empty string is an explicit path (absolute, or relative to repoRoot);
  // it is rejected if it resolves inside plans/.
  // guardWrongRoot: refuse per-ticket mutation commands invoked from a root other than
  // a ticket's registered worktree (override with --allow-main-root). No-op when the
  // ticket has no worktree, so this costs solo/single-ticket users nothing.
  "worktrees": {
    "location": "sibling",
    "guardWrongRoot": true
  },

  // Relative-sized estimation. Sized after design; enforced on complete-step
  // design for tasks and bugs when enabled is true. Stories and epics are exempt.
  // scale: allowed point values, must be a sorted-ascending array of positive integers.
  // bootstrapDefault: anchor value when no calibration exists; must be in scale.
  // splitThreshold: estimator flags tickets at or above this for decomposition.
  "estimation": {
    "enabled": true,
    "scale": [1, 2, 4, 8],
    "bootstrapDefault": 4,
    "splitThreshold": 16
  }
}
`;
}

export function parseJsonc(text) {
  return JSON.parse(stripTrailingCommas(stripJsonComments(text)));
}

export function stripJsonComments(text) {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      index += 2;
      while (index < text.length && text[index] !== "\n") {
        index += 1;
      }
      if (index < text.length) {
        output += "\n";
      }
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
        if (text[index] === "\n") {
          output += "\n";
        }
        index += 1;
      }
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}

export function stripTrailingCommas(text) {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === ",") {
      let lookahead = index + 1;
      while (/\s/.test(text[lookahead] ?? "")) {
        lookahead += 1;
      }
      if (text[lookahead] === "}" || text[lookahead] === "]") {
        continue;
      }
    }

    output += char;
  }

  return output;
}

function mergeConfig(base, overlay) {
  if (!isObject(overlay)) {
    return structuredClone(base);
  }

  const merged = structuredClone(base);
  for (const [key, value] of Object.entries(overlay)) {
    if (isObject(value) && isObject(merged[key])) {
      merged[key] = mergeConfig(merged[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
