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
    decompose: "claude-subagent:local-board-decomposer",
    design: "claude-subagent:local-board-designer",
    implement: "claude-subagent:local-board-implementer",
    review: "codex-task:read-only",
    test: "claude-subagent:local-board-tester",
    document: "codex-task:workspace-write",
  },
  routing: {
    strict: true,
    doneRequires: {
      epic: ["decompose"],
      story: ["decompose"],
      task: ["design", "implement", "review", "test", "document"],
      bug: ["design", "implement", "review", "test", "document"],
    },
  },
  retention: {
    archiveDoneAfterDays: 30,
    archiveOnMoveDone: true,
  },
  git: {
    defaultBranch: null,
    commitPlanningChanges: true,
    autoMerge: false,
  },
  optionalSteps: {
    design: [],
    implement: [],
    test: [],
  },
};

export async function loadConfig(root = ".") {
  const configPath = path.resolve(root, CONFIG_PATH);
  try {
    const parsed = parseJsonc(await readFile(configPath, "utf8"));
    const merged = mergeConfig(DEFAULT_CONFIG, parsed);
    normalizeOptionalSteps(merged, configPath);
    return merged;
  } catch (error) {
    if (error.code === "ENOENT") {
      return structuredClone(DEFAULT_CONFIG);
    }
    throw new Error(`${configPath}: ${error.message}`);
  }
}

function normalizeOptionalSteps(merged, configPath) {
  if (!isObject(merged.optionalSteps)) {
    merged.optionalSteps = { design: [], implement: [], test: [] };
    return;
  }

  const normalized = {};
  for (const stage of OPTIONAL_STEP_STAGES) {
    const value = merged.optionalSteps[stage];
    if (value === undefined || value === null) {
      normalized[stage] = [];
      continue;
    }
    if (!Array.isArray(value)) {
      throw new Error(`optionalSteps.${stage} must be an array`);
    }
    const seenNames = new Set();
    normalized[stage] = value.map((entry) => validateOptionalStepEntry(entry, stage, seenNames));
  }

  for (const key of Object.keys(merged.optionalSteps)) {
    if (!OPTIONAL_STEP_STAGES.includes(key)) {
      console.warn(`${configPath}: ignoring unknown optionalSteps stage "${key}"`);
    }
  }

  merged.optionalSteps = normalized;
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
    throw new Error(`optionalSteps.${stage} has duplicate name "${name}"`);
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
  return (
    value === "inline" ||
    /^claude-subagent:[a-z0-9][a-z0-9-]*$/.test(value) ||
    /^codex-task:[a-z0-9][a-z0-9-]*$/.test(value)
  );
}

export async function writeDefaultConfig(root = ".", overwrite = false) {
  const configPath = path.resolve(root, CONFIG_PATH);
  const flag = overwrite ? "w" : "wx";
  await writeFile(configPath, defaultConfigJsonc(), { encoding: "utf8", flag });
  return configPath;
}

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

    // Advisory status outcomes for each workflow decision point.
    // Use exact status values with "move <ticket-id> <status>".
    // This is guidance for orchestrators, not a hard transition validator yet.
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
  // Available values: inline, claude-subagent:<agent-name>, codex-task:<mode>.
  // Current Codex examples: codex-task:read-only, codex-task:workspace-write.
  "agents": {
    "decompose": "claude-subagent:local-board-decomposer",
    "design": "claude-subagent:local-board-designer",
    "implement": "claude-subagent:local-board-implementer",
    "review": "codex-task:read-only",
    "test": "claude-subagent:local-board-tester",
    "document": "codex-task:workspace-write"
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
    }
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
  "git": {
    "defaultBranch": null,
    "commitPlanningChanges": true,
    "autoMerge": false
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
        "triggers": "Changes to auth code, input validation, external API calls, credential handling."
      },
      {
        "name": "ui_visual_review",
        "prompt": "plans/prompts/optional-steps/impl/ui_visual_review.md",
        "triggers": "Visible UI changes - styles, layouts, components, accessibility-relevant markup."
      }
    ],
    "test": []
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
