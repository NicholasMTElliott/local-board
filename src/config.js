import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const CONFIG_PATH = path.join("plans", "local-board.config.jsonc");

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
  git: {
    commitPlanningChanges: true,
    autoMerge: false,
  },
};

export async function loadConfig(root = ".") {
  const configPath = path.resolve(root, CONFIG_PATH);
  try {
    const parsed = parseJsonc(await readFile(configPath, "utf8"));
    return mergeConfig(DEFAULT_CONFIG, parsed);
  } catch (error) {
    if (error.code === "ENOENT") {
      return structuredClone(DEFAULT_CONFIG);
    }
    throw new Error(`${configPath}: ${error.message}`);
  }
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

  // Conservative git policy defaults. The orchestrator may still ask before git operations.
  "git": {
    "commitPlanningChanges": true,
    "autoMerge": false
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
