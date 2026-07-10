import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_CONFIG, codexTaskRoutedActions, defaultConfigJsonc, loadConfig, parseJsonc } from "../src/config.js";
import { removeFixtureDir } from "./helpers/fixtures.js";

async function withRoot(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-board-config-"));
  try {
    await fn(root);
  } finally {
    await removeFixtureDir(root);
  }
}

test("parseJsonc accepts comments, trailing commas, and comment-like text in strings", () => {
  const parsed = parseJsonc(`{
    // line comment
    "url": "https://example.test/path",
    "literal": "not /* a comment */",
    "items": [
      "one",
    ],
    /*
      block comment
    */
    "nested": {
      "enabled": true,
    },
  }`);

  assert.deepEqual(parsed, {
    url: "https://example.test/path",
    literal: "not /* a comment */",
    items: ["one"],
    nested: { enabled: true },
  });
});

test("loadConfig reads the commented default config", async () => {
  await withRoot(async (root) => {
    await mkdir(path.join(root, "plans"), { recursive: true });
    await writeFile(path.join(root, "plans", "local-board.config.jsonc"), defaultConfigJsonc(), "utf8");

    const config = await loadConfig(root);

    assert.equal(config.version, 1);
    assert.equal(config.workflow.statusActions.ready_for_design, "design");
    assert.equal(config.workflow.transitions.ready_for_review[0].status, "ready_for_test");
    assert.match(config.workflow.transitions.ready_for_review[1].when, /implementation defects/);
    assert.match(config.workflow.transitions.ready_for_review.at(-1).when, /non-ticket blocker/);
    assert.deepEqual(config.agents.implement, {
      route: "claude-subagent:local-board-implementer",
      model: "sonnet",
    });
    assert.deepEqual(config.agents.review, { route: "codex-task:read-only" });
    assert.deepEqual(config.agents.document, { route: "codex-task:workspace-write" });
    assert.equal(config.routing.strict, true);
    assert.deepEqual(config.routing.doneRequires.task, ["design", "implement", "review", "test", "document"]);
    assert.equal(config.retention.archiveDoneAfterDays, 30);
    assert.equal(config.retention.archiveOnMoveDone, true);
  });
});

test("default Claude subagent routes have matching agent definitions", async () => {
  const config = await loadConfig(".");
  const agentDir = path.resolve("agents", "claude");
  const fileNames = new Set(await readdir(agentDir));

  for (const profile of Object.values(config.agents)) {
    const route = profile.route;
    if (!route.startsWith("claude-subagent:")) {
      continue;
    }
    const agentName = route.slice("claude-subagent:".length);
    assert.equal(fileNames.has(`${agentName}.md`), true, `${agentName}.md is missing`);
    const text = await readFile(path.join(agentDir, `${agentName}.md`), "utf8");
    assert.match(text, new RegExp(`^name: ${agentName}$`, "m"));
  }
});

async function writeConfig(root, body) {
  await mkdir(path.join(root, "plans"), { recursive: true });
  await writeFile(path.join(root, "plans", "local-board.config.jsonc"), body, "utf8");
}

test("loadConfig normalizes a bare string agent route to a profile object", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, JSON.stringify({
      version: 1,
      agents: { design: "claude-subagent:local-board-designer" },
    }));
    const config = await loadConfig(root);
    assert.deepEqual(config.agents.design, { route: "claude-subagent:local-board-designer" });
  });
});

test("loadConfig accepts { route, model, prompt } agent profiles", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, JSON.stringify({
      version: 1,
      agents: {
        design: {
          route: "claude-subagent:local-board-designer",
          model: "claude-opus-4-6",
          prompt: "plans/prompts/steps/design.md",
        },
        review: { route: "codex-task:read-only", model: "gpt-5.5" },
      },
    }));
    const config = await loadConfig(root);
    assert.deepEqual(config.agents.design, {
      route: "claude-subagent:local-board-designer",
      model: "claude-opus-4-6",
      prompt: "plans/prompts/steps/design.md",
    });
    assert.deepEqual(config.agents.review, { route: "codex-task:read-only", model: "gpt-5.5" });
  });
});

test("loadConfig rejects a model on an inline route", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, JSON.stringify({
      version: 1,
      agents: { design: { route: "inline", model: "opus" } },
    }));
    await assert.rejects(loadConfig(root), /inline.*cannot carry a model/);
  });
});

test("loadConfig accepts { route, model, effort } agent profiles", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, JSON.stringify({
      version: 1,
      agents: {
        review: { route: "codex-task:read-only", model: "gpt-5.6-sol", effort: "xhigh" },
      },
    }));
    const config = await loadConfig(root);
    assert.deepEqual(config.agents.review, {
      route: "codex-task:read-only",
      model: "gpt-5.6-sol",
      effort: "xhigh",
    });
  });
});

test("loadConfig accepts effort without model, and model without effort (independence)", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, JSON.stringify({
      version: 1,
      agents: {
        design: { route: "codex-task:read-only", effort: "medium" },
        review: { route: "codex-task:read-only", model: "gpt-5.6-terra" },
      },
    }));
    const config = await loadConfig(root);
    assert.deepEqual(config.agents.design, { route: "codex-task:read-only", effort: "medium" });
    assert.deepEqual(config.agents.review, { route: "codex-task:read-only", model: "gpt-5.6-terra" });
  });
});

test("loadConfig rejects an effort on an inline route", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, JSON.stringify({
      version: 1,
      agents: { design: { route: "inline", effort: "high" } },
    }));
    await assert.rejects(loadConfig(root), /inline.*cannot carry an effort/);
  });
});

test("loadConfig rejects a shape-invalid effort", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, JSON.stringify({
      version: 1,
      agents: { design: { route: "codex-task:read-only", effort: "x high" } },
    }));
    await assert.rejects(loadConfig(root), /effort must be/);
  });
  await withRoot(async (root) => {
    await writeConfig(root, JSON.stringify({
      version: 1,
      agents: { design: { route: "codex-task:read-only", effort: "" } },
    }));
    await assert.rejects(loadConfig(root), /effort must be/);
  });
  await withRoot(async (root) => {
    await writeConfig(root, JSON.stringify({
      version: 1,
      agents: { design: { route: "codex-task:read-only", effort: 5 } },
    }));
    await assert.rejects(loadConfig(root), /effort must be/);
  });
});

test("loadConfig omits effort from a profile when no effort key is present (backward-compat)", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, JSON.stringify({
      version: 1,
      agents: { design: { route: "codex-task:read-only", model: "gpt-5.6-luna" } },
    }));
    const config = await loadConfig(root);
    assert.equal(Object.hasOwn(config.agents.design, "effort"), false);
  });
});

test("loadConfig rejects an invalid agent route", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, JSON.stringify({
      version: 1,
      agents: { design: { route: "wizard:cast" } },
    }));
    await assert.rejects(loadConfig(root), /valid route/);
  });
});

test("loadConfig replaces agent profiles wholesale (no inherited model)", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, JSON.stringify({
      version: 1,
      agents: {
        // default design profile carries model: opus — a route-only inline
        // override must NOT inherit it (inline cannot carry a model).
        design: { route: "inline" },
        // default review profile has no model — a codex route-only override
        // must NOT inherit a Claude model from anywhere.
        implement: { route: "codex-task:read-only" },
      },
    }));
    const config = await loadConfig(root);
    assert.deepEqual(config.agents.design, { route: "inline" });
    assert.deepEqual(config.agents.implement, { route: "codex-task:read-only" });
  });
});

test("loadConfig rejects an agent object without a route", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, JSON.stringify({
      version: 1,
      agents: { design: { model: "sonnet" } },
    }));
    await assert.rejects(loadConfig(root), /requires a valid route/);
  });
});

test("loadConfig parses the v1 optionalSteps catalog from the default config", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, defaultConfigJsonc());
    const config = await loadConfig(root);

    assert.equal(config.optionalSteps.design.length, 3);
    assert.equal(config.optionalSteps.design[0].name, "security_threat_model");
    assert.equal(
      config.optionalSteps.design[0].prompt,
      "plans/prompts/optional-steps/design/security_threat_model.md",
    );
    assert.match(config.optionalSteps.design[0].triggers, /Auth/);
    assert.equal(config.optionalSteps.design[1].name, "ui_component_review");
    assert.equal(config.optionalSteps.design[2].name, "ux_interaction_review");

    assert.equal(config.optionalSteps.implement.length, 2);
    assert.equal(config.optionalSteps.implement[0].name, "security_audit");
    assert.equal(config.optionalSteps.implement[1].name, "ui_visual_review");

    assert.deepEqual(config.optionalSteps.test, []);

    // None of the v1 entries set agent.
    for (const stage of ["design", "implement", "test"]) {
      for (const entry of config.optionalSteps[stage]) {
        assert.equal(Object.hasOwn(entry, "agent"), false);
      }
    }
  });
});

test("loadConfig returns empty optionalSteps catalog when the block is omitted", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, `{
  "version": 1
}
`);
    const config = await loadConfig(root);
    assert.deepEqual(config.optionalSteps.design, []);
    assert.deepEqual(config.optionalSteps.implement, []);
    assert.deepEqual(config.optionalSteps.test, []);
  });
});

// Recursively collects leaf-level key paths where `a` and `b` differ. Arrays
// are traversed like objects (numeric indices), so an element-level or
// length difference surfaces as e.g. "optionalSteps.design.0.name".
function leafDiffPaths(a, b, prefix = "") {
  if (Object.is(a, b)) return [];
  const aIsObj = a !== null && typeof a === "object";
  const bIsObj = b !== null && typeof b === "object";
  if (!aIsObj || !bIsObj) return [prefix];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const paths = [];
  for (const key of keys) {
    paths.push(...leafDiffPaths(a[key], b[key], prefix ? `${prefix}.${key}` : key));
  }
  return paths;
}

test("defaultConfigJsonc matches DEFAULT_CONFIG except for documented differences", () => {
  const scaffolded = parseJsonc(defaultConfigJsonc());
  const expected = structuredClone(DEFAULT_CONFIG);

  // Documented, intentional divergences (see the comment on DEFAULT_CONFIG in
  // src/config.js):
  //   - estimation.enabled: DEFAULT_CONFIG is the ENOENT fallback / merge base
  //     and keeps the estimation gate off for backward compat; the scaffold
  //     enables it for new repos.
  //   - optionalSteps: DEFAULT_CONFIG ships empty catalogs (arrays merge
  //     wholesale, so an empty default lets a user config omit a stage
  //     without inheriting built-ins); the scaffold ships the v1 catalogs.
  //   - routing.requireGateConsultation: DEFAULT_CONFIG keeps it off for
  //     backward compat with configs that omit the key; the scaffold enables
  //     it for new repos.
  //   - routing.invalidateOnLoopBack: DEFAULT_CONFIG keeps it off for
  //     backward compat with configs that omit the key; the scaffold enables
  //     it for new repos.
  //   - worktrees.guardWrongRoot: DEFAULT_CONFIG keeps it off for backward
  //     compat with boards that omit the key; the scaffold enables it for new
  //     repos (a no-op without a matching ticket worktree).
  //   - routing.enforceTransitions: DEFAULT_CONFIG keeps it off for backward
  //     compat with configs that omit the key; the scaffold enables it for
  //     new repos.
  //   - routing.guardPrematureEvidence: DEFAULT_CONFIG keeps it off for
  //     backward compat with configs that omit the key; the scaffold enables
  //     it for new repos.
  //   - git.commitPlanningOnTransition: DEFAULT_CONFIG keeps it off for
  //     backward compat with boards that omit the key; the scaffold enables
  //     it for new repos (commits planning-only changes after every mutating
  //     command).
  // Any OTHER difference here means someone edited one copy's shared blocks
  // (workflow, agents, routing, retention, git, worktrees) without updating
  // the other. Fix by updating both DEFAULT_CONFIG and defaultConfigJsonc(),
  // or extend this allowlist (and the one below) if the new difference is
  // genuinely intentional.
  expected.estimation.enabled = true;
  expected.optionalSteps = scaffolded.optionalSteps;
  expected.routing.requireGateConsultation = true;
  expected.routing.invalidateOnLoopBack = true;
  expected.worktrees.guardWrongRoot = true;
  expected.routing.enforceTransitions = true;
  expected.routing.guardPrematureEvidence = true;
  expected.git.commitPlanningOnTransition = true;
  assert.deepEqual(scaffolded, expected);

  // Guard against the allowlist above silently growing to mask unrelated
  // drift: confirm these eight paths are the *only* places DEFAULT_CONFIG and
  // the scaffold differ.
  const rawDiffs = leafDiffPaths(DEFAULT_CONFIG, parseJsonc(defaultConfigJsonc()));
  const collapsed = [...new Set(
    rawDiffs.map((diffPath) => (diffPath.startsWith("optionalSteps") ? "optionalSteps" : diffPath)),
  )].sort();
  assert.deepEqual(collapsed, [
    "estimation.enabled",
    "git.commitPlanningOnTransition",
    "optionalSteps",
    "routing.enforceTransitions",
    "routing.guardPrematureEvidence",
    "routing.invalidateOnLoopBack",
    "routing.requireGateConsultation",
    "worktrees.guardWrongRoot",
  ]);
});

test("loadConfig defaults routing.enforceTransitions to false when omitted (backward-compat disabled)", async () => {
  await withRoot(async (root) => {
    // No config file at all: DEFAULT_CONFIG fallback keeps it off.
    assert.equal((await loadConfig(root)).routing.enforceTransitions, false);

    // Config file present but omits the key: deep-merge onto DEFAULT_CONFIG
    // must not silently turn it on.
    await writeConfig(root, `{ "version": 1 }`);
    assert.equal((await loadConfig(root)).routing.enforceTransitions, false);

    // Explicit false stays off; explicit true turns it on.
    await writeConfig(root, JSON.stringify({ routing: { enforceTransitions: false } }));
    assert.equal((await loadConfig(root)).routing.enforceTransitions, false);
    await writeConfig(root, JSON.stringify({ routing: { enforceTransitions: true } }));
    assert.equal((await loadConfig(root)).routing.enforceTransitions, true);

    // The shipped scaffold enables it for new repos.
    await writeConfig(root, defaultConfigJsonc());
    assert.equal((await loadConfig(root)).routing.enforceTransitions, true);
  });
});

test("loadConfig defaults routing.invalidateOnLoopBack to false when omitted (backward-compat disabled)", async () => {
  await withRoot(async (root) => {
    // No config file at all: DEFAULT_CONFIG fallback keeps it off.
    assert.equal((await loadConfig(root)).routing.invalidateOnLoopBack, false);

    // Config file present but omits the key: deep-merge onto DEFAULT_CONFIG
    // must not silently turn it on.
    await writeConfig(root, `{ "version": 1 }`);
    assert.equal((await loadConfig(root)).routing.invalidateOnLoopBack, false);

    // Explicit false stays off; explicit true turns it on.
    await writeConfig(root, JSON.stringify({ routing: { invalidateOnLoopBack: false } }));
    assert.equal((await loadConfig(root)).routing.invalidateOnLoopBack, false);
    await writeConfig(root, JSON.stringify({ routing: { invalidateOnLoopBack: true } }));
    assert.equal((await loadConfig(root)).routing.invalidateOnLoopBack, true);

    // The shipped scaffold enables it for new repos.
    await writeConfig(root, defaultConfigJsonc());
    assert.equal((await loadConfig(root)).routing.invalidateOnLoopBack, true);
  });
});

test("loadConfig defaults routing.guardPrematureEvidence to false when omitted (backward-compat disabled)", async () => {
  await withRoot(async (root) => {
    // No config file at all: DEFAULT_CONFIG fallback keeps it off.
    assert.equal((await loadConfig(root)).routing.guardPrematureEvidence, false);

    // Config file present but omits the key: deep-merge onto DEFAULT_CONFIG
    // must not silently turn it on.
    await writeConfig(root, `{ "version": 1 }`);
    assert.equal((await loadConfig(root)).routing.guardPrematureEvidence, false);

    // Explicit false stays off; explicit true turns it on.
    await writeConfig(root, JSON.stringify({ routing: { guardPrematureEvidence: false } }));
    assert.equal((await loadConfig(root)).routing.guardPrematureEvidence, false);
    await writeConfig(root, JSON.stringify({ routing: { guardPrematureEvidence: true } }));
    assert.equal((await loadConfig(root)).routing.guardPrematureEvidence, true);

    // The shipped scaffold enables it for new repos.
    await writeConfig(root, defaultConfigJsonc());
    assert.equal((await loadConfig(root)).routing.guardPrematureEvidence, true);
  });
});

test("loadConfig defaults git.commitPlanningOnTransition to false when omitted (backward-compat disabled)", async () => {
  await withRoot(async (root) => {
    // No config file at all: DEFAULT_CONFIG fallback keeps it off.
    assert.equal((await loadConfig(root)).git.commitPlanningOnTransition, false);

    // Config file present but omits the key: deep-merge onto DEFAULT_CONFIG
    // must not silently turn it on.
    await writeConfig(root, `{ "version": 1 }`);
    assert.equal((await loadConfig(root)).git.commitPlanningOnTransition, false);

    // Explicit false stays off; explicit true turns it on.
    await writeConfig(root, JSON.stringify({ git: { commitPlanningOnTransition: false } }));
    assert.equal((await loadConfig(root)).git.commitPlanningOnTransition, false);
    await writeConfig(root, JSON.stringify({ git: { commitPlanningOnTransition: true } }));
    assert.equal((await loadConfig(root)).git.commitPlanningOnTransition, true);

    // The shipped scaffold enables it for new repos.
    await writeConfig(root, defaultConfigJsonc());
    assert.equal((await loadConfig(root)).git.commitPlanningOnTransition, true);
  });
});

test("loadConfig preserves an optional agent override on optionalSteps entries", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, `{
  "version": 1,
  "optionalSteps": {
    "design": [
      {
        "name": "custom_review",
        "prompt": "plans/prompts/optional-steps/design/custom_review.md",
        "triggers": "Anything",
        "agent": "claude-subagent:local-board-reviewer"
      }
    ]
  }
}
`);
    const config = await loadConfig(root);
    assert.equal(config.optionalSteps.design.length, 1);
    assert.equal(config.optionalSteps.design[0].agent, "claude-subagent:local-board-reviewer");
    assert.equal(typeof config.optionalSteps.design[0].agent, "string");
  });
});

test("loadConfig accepts a { route, model, effort } profile object for optionalSteps[].agent", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, JSON.stringify({
      version: 1,
      optionalSteps: {
        implement: [
          {
            name: "security_audit",
            prompt: "plans/prompts/optional-steps/impl/security_audit.md",
            triggers: "Anything",
            agent: { route: "codex-task:read-only", model: "gpt-5.6-sol", effort: "xhigh" },
          },
        ],
      },
    }));
    const config = await loadConfig(root);
    assert.deepEqual(config.optionalSteps.implement[0].agent, {
      route: "codex-task:read-only",
      model: "gpt-5.6-sol",
      effort: "xhigh",
    });
  });
});

test("loadConfig rejects a prompt field inside an optionalSteps[].agent profile", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, JSON.stringify({
      version: 1,
      optionalSteps: {
        implement: [
          {
            name: "security_audit",
            prompt: "plans/prompts/optional-steps/impl/security_audit.md",
            triggers: "Anything",
            agent: { route: "codex-task:read-only", prompt: "some/other.md" },
          },
        ],
      },
    }));
    await assert.rejects(
      loadConfig(root),
      /optionalSteps\.implement entry "security_audit" agent cannot carry a prompt; set the entry-level "prompt" field instead/,
    );
  });
});

test("loadConfig rejects an inline route with a model or effort on optionalSteps[].agent", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, JSON.stringify({
      version: 1,
      optionalSteps: {
        implement: [
          {
            name: "security_audit",
            prompt: "plans/prompts/optional-steps/impl/security_audit.md",
            triggers: "Anything",
            agent: { route: "inline", model: "opus" },
          },
        ],
      },
    }));
    await assert.rejects(loadConfig(root), /cannot carry a model/);
  });

  await withRoot(async (root) => {
    await writeConfig(root, JSON.stringify({
      version: 1,
      optionalSteps: {
        implement: [
          {
            name: "security_audit",
            prompt: "plans/prompts/optional-steps/impl/security_audit.md",
            triggers: "Anything",
            agent: { route: "inline", effort: "high" },
          },
        ],
      },
    }));
    await assert.rejects(loadConfig(root), /cannot carry an effort/);
  });
});

test("loadConfig rejects a malformed optionalSteps[].agent object (non-object, bad route)", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, JSON.stringify({
      version: 1,
      optionalSteps: {
        implement: [
          {
            name: "security_audit",
            prompt: "plans/prompts/optional-steps/impl/security_audit.md",
            triggers: "Anything",
            agent: 42,
          },
        ],
      },
    }));
    await assert.rejects(loadConfig(root), /agent must be a route string or a \{ route, model\?, effort\? \} object/);
  });

  await withRoot(async (root) => {
    await writeConfig(root, JSON.stringify({
      version: 1,
      optionalSteps: {
        implement: [
          {
            name: "security_audit",
            prompt: "plans/prompts/optional-steps/impl/security_audit.md",
            triggers: "Anything",
            agent: { route: "wizard:cast" },
          },
        ],
      },
    }));
    await assert.rejects(loadConfig(root), /requires a valid route string/);
  });
});

test("codexTaskRoutedActions detects an object-form optionalSteps agent routed to codex-task", () => {
  const config = {
    agents: {},
    optionalSteps: {
      implement: [
        {
          name: "security_audit",
          agent: { route: "codex-task:read-only", model: "gpt-5.6-sol" },
        },
      ],
    },
  };
  assert.deepEqual(codexTaskRoutedActions(config), ["security_audit (implement)"]);
});

test("codexTaskRoutedActions detects a raw (un-normalized) object-form optionalSteps agent routed to codex-task", () => {
  // codexTaskRoutedActions is documented to run over raw parseJsonc output
  // too (e.g. install's config hint), not just post-loadConfig normalized
  // shapes. A raw object literal has no normalization guarantees beyond
  // being a plain object with a route key.
  const raw = parseJsonc(`{
  "optionalSteps": {
    "design": [
      { "name": "security_threat_model", "agent": { "route": "codex-task:read-only" } }
    ]
  }
}`);
  assert.deepEqual(codexTaskRoutedActions(raw), ["security_threat_model (design)"]);
});

test("loadConfig rejects duplicate optionalSteps names within a stage", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, `{
  "version": 1,
  "optionalSteps": {
    "design": [
      {
        "name": "duplicate_name",
        "prompt": "a.md",
        "triggers": "first"
      },
      {
        "name": "duplicate_name",
        "prompt": "b.md",
        "triggers": "second"
      }
    ]
  }
}
`);
    await assert.rejects(loadConfig(root), /duplicate name "duplicate_name"/);
  });
});

test("loadConfig rejects duplicate optionalSteps names across stages", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, `{
  "version": 1,
  "optionalSteps": {
    "design": [
      {
        "name": "shared_step",
        "prompt": "a.md",
        "triggers": "design"
      }
    ],
    "implement": [
      {
        "name": "shared_step",
        "prompt": "b.md",
        "triggers": "implement"
      }
    ]
  }
}
`);
    // Routing resolves a specialty step by name across stages, so names must be
    // globally unique or completion validation could pick the wrong entry.
    await assert.rejects(loadConfig(root), /unique across all stages/);
  });
});

test("loadConfig rejects malformed optionalSteps entries", async () => {
  const cases = [
    {
      label: "missing name",
      body: `{
  "optionalSteps": {
    "design": [
      { "prompt": "a.md", "triggers": "t" }
    ]
  }
}`,
      expected: /missing a non-empty name/,
    },
    {
      label: "missing prompt",
      body: `{
  "optionalSteps": {
    "design": [
      { "name": "foo", "triggers": "t" }
    ]
  }
}`,
      expected: /missing a non-empty prompt/,
    },
    {
      label: "missing triggers",
      body: `{
  "optionalSteps": {
    "design": [
      { "name": "foo", "prompt": "a.md" }
    ]
  }
}`,
      expected: /missing a non-empty triggers/,
    },
    {
      label: "entry is a string",
      body: `{
  "optionalSteps": {
    "design": [ "not_an_object" ]
  }
}`,
      expected: /entries must be objects/,
    },
    {
      label: "design is an object",
      body: `{
  "optionalSteps": {
    "design": { "name": "foo" }
  }
}`,
      expected: /optionalSteps\.design must be an array/,
    },
    {
      label: "name collides with mandatory action",
      body: `{
  "optionalSteps": {
    "design": [
      { "name": "review", "prompt": "a.md", "triggers": "t" }
    ]
  }
}`,
      expected: /collides with a mandatory action/,
    },
    {
      label: "agent fails prefix validation",
      body: `{
  "optionalSteps": {
    "design": [
      { "name": "foo", "prompt": "a.md", "triggers": "t", "agent": "bogus" }
    ]
  }
}`,
      expected: /invalid agent "bogus"/,
    },
    {
      label: "name is not snake_case (spaces + capitals)",
      body: `{
  "optionalSteps": {
    "design": [
      { "name": "Bad Name", "prompt": "a.md", "triggers": "t" }
    ]
  }
}`,
      expected: /must be lowercase snake_case/,
    },
    {
      label: "name uses hyphens instead of underscores",
      body: `{
  "optionalSteps": {
    "design": [
      { "name": "not-snake", "prompt": "a.md", "triggers": "t" }
    ]
  }
}`,
      expected: /must be lowercase snake_case/,
    },
  ];

  for (const testCase of cases) {
    await withRoot(async (root) => {
      await writeConfig(root, testCase.body);
      await assert.rejects(loadConfig(root), testCase.expected, `case ${testCase.label}`);
    });
  }
});

test("loadConfig accepts valid lowercase snake_case names for optionalSteps entries", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, `{
  "version": 1,
  "optionalSteps": {
    "design": [
      {
        "name": "valid_snake_case_name_v2",
        "prompt": "plans/prompts/optional-steps/design/valid_snake_case_name_v2.md",
        "triggers": "Any trigger description."
      }
    ]
  }
}
`);
    const config = await loadConfig(root);
    assert.equal(config.optionalSteps.design.length, 1);
    assert.equal(config.optionalSteps.design[0].name, "valid_snake_case_name_v2");
  });
});

test("loadConfig parses the shipped estimation block", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, defaultConfigJsonc());
    const config = await loadConfig(root);

    assert.equal(config.estimation.enabled, true);
    assert.deepEqual(config.estimation.scale, [1, 2, 4, 8]);
    assert.equal(config.estimation.bootstrapDefault, 4);
    assert.equal(config.estimation.splitThreshold, 16);
  });
});

test("loadConfig defaults estimation when the block is omitted (backward-compat disabled)", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, `{
  "version": 1
}
`);
    const config = await loadConfig(root);

    assert.equal(config.estimation.enabled, false);
    assert.deepEqual(config.estimation.scale, [1, 2, 4, 8]);
    assert.equal(config.estimation.bootstrapDefault, 4);
    assert.equal(config.estimation.splitThreshold, 16);
  });
});

test("loadConfig fills missing estimation keys from defaults on partial overlay", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, `{
  "version": 1,
  "estimation": {
    "enabled": true
  }
}
`);
    const config = await loadConfig(root);

    assert.equal(config.estimation.enabled, true);
    assert.deepEqual(config.estimation.scale, [1, 2, 4, 8]);
    assert.equal(config.estimation.bootstrapDefault, 4);
    assert.equal(config.estimation.splitThreshold, 16);
  });
});

test("loadConfig rejects invalid estimation.scale values", async () => {
  const cases = [
    {
      label: "scale is not an array",
      body: `{ "estimation": { "enabled": true, "scale": "x", "bootstrapDefault": 4, "splitThreshold": 16 } }`,
      expected: /estimation\.scale must be a non-empty array/,
    },
    {
      label: "scale is empty",
      body: `{ "estimation": { "enabled": true, "scale": [], "bootstrapDefault": 4, "splitThreshold": 16 } }`,
      expected: /estimation\.scale must be a non-empty array/,
    },
    {
      label: "scale contains zero",
      body: `{ "estimation": { "enabled": true, "scale": [0, 1, 2], "bootstrapDefault": 1, "splitThreshold": 16 } }`,
      expected: /must contain only positive integers/,
    },
    {
      label: "scale contains a non-integer",
      body: `{ "estimation": { "enabled": true, "scale": [1, 2.5, 4], "bootstrapDefault": 4, "splitThreshold": 16 } }`,
      expected: /must contain only positive integers/,
    },
    {
      label: "scale is unsorted",
      body: `{ "estimation": { "enabled": true, "scale": [4, 2, 1], "bootstrapDefault": 4, "splitThreshold": 16 } }`,
      expected: /strictly ascending/,
    },
    {
      label: "scale contains duplicates",
      body: `{ "estimation": { "enabled": true, "scale": [1, 2, 2, 4], "bootstrapDefault": 4, "splitThreshold": 16 } }`,
      expected: /strictly ascending/,
    },
  ];

  for (const testCase of cases) {
    await withRoot(async (root) => {
      await writeConfig(root, testCase.body);
      await assert.rejects(loadConfig(root), testCase.expected, `case ${testCase.label}`);
    });
  }
});

test("loadConfig rejects estimation.bootstrapDefault not in scale", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, `{
  "estimation": {
    "enabled": true,
    "scale": [1, 2, 3],
    "bootstrapDefault": 4,
    "splitThreshold": 16
  }
}
`);
    await assert.rejects(loadConfig(root), /bootstrapDefault 4 is not a member of/);
  });
});

test("loadConfig rejects invalid estimation.enabled types", async () => {
  const cases = [
    `{ "estimation": { "enabled": "true", "scale": [1, 2, 4, 8], "bootstrapDefault": 4, "splitThreshold": 16 } }`,
    `{ "estimation": { "enabled": 1, "scale": [1, 2, 4, 8], "bootstrapDefault": 4, "splitThreshold": 16 } }`,
  ];
  for (const body of cases) {
    await withRoot(async (root) => {
      await writeConfig(root, body);
      await assert.rejects(loadConfig(root), /estimation\.enabled must be a boolean/);
    });
  }
});

test("loadConfig rejects invalid estimation.splitThreshold values", async () => {
  const cases = [
    `{ "estimation": { "enabled": true, "scale": [1, 2, 4, 8], "bootstrapDefault": 4, "splitThreshold": 0 } }`,
    `{ "estimation": { "enabled": true, "scale": [1, 2, 4, 8], "bootstrapDefault": 4, "splitThreshold": -1 } }`,
    `{ "estimation": { "enabled": true, "scale": [1, 2, 4, 8], "bootstrapDefault": 4, "splitThreshold": 1.5 } }`,
  ];
  for (const body of cases) {
    await withRoot(async (root) => {
      await writeConfig(root, body);
      await assert.rejects(loadConfig(root), /estimation\.splitThreshold must be a positive integer/);
    });
  }
});

test("loadConfig defaults worktrees.location to sibling and guardWrongRoot to false", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, `{
  "version": 1
}
`);
    const config = await loadConfig(root);
    assert.deepEqual(config.worktrees, { location: "sibling", guardWrongRoot: false });
  });

  // No config file at all: same ENOENT-fallback default as every other block.
  await withRoot(async (root) => {
    assert.deepEqual((await loadConfig(root)).worktrees, { location: "sibling", guardWrongRoot: false });
  });
});

test("loadConfig parses the shipped worktrees block (guardWrongRoot true by default for new boards)", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, defaultConfigJsonc());
    const config = await loadConfig(root);
    assert.deepEqual(config.worktrees, { location: "sibling", guardWrongRoot: true });
  });
});

test("loadConfig accepts worktrees.location \"inside\" and explicit paths", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, `{
  "worktrees": { "location": "inside" }
}
`);
    assert.deepEqual((await loadConfig(root)).worktrees, { location: "inside", guardWrongRoot: false });
  });

  await withRoot(async (root) => {
    await writeConfig(root, `{
  "worktrees": { "location": "../custom-worktrees" }
}
`);
    assert.deepEqual((await loadConfig(root)).worktrees, { location: "../custom-worktrees", guardWrongRoot: false });
  });
});

test("loadConfig rejects invalid worktrees.location values", async () => {
  const cases = [
    { label: "empty string", body: `{ "worktrees": { "location": "" } }` },
    { label: "whitespace only", body: `{ "worktrees": { "location": "   " } }` },
    { label: "non-string", body: `{ "worktrees": { "location": 1 } }` },
  ];
  for (const testCase of cases) {
    await withRoot(async (root) => {
      await writeConfig(root, testCase.body);
      await assert.rejects(loadConfig(root), /worktrees\.location must be a non-empty string/, `case ${testCase.label}`);
    });
  }
});

test("loadConfig rejects worktrees as a non-object", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, `{ "worktrees": "sibling" }`);
    await assert.rejects(loadConfig(root), /worktrees must be an object/);
  });
});

test("loadConfig preserves an explicit boolean worktrees.guardWrongRoot", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, `{
  "worktrees": { "location": "sibling", "guardWrongRoot": true }
}
`);
    assert.deepEqual((await loadConfig(root)).worktrees, { location: "sibling", guardWrongRoot: true });
  });

  await withRoot(async (root) => {
    await writeConfig(root, `{
  "worktrees": { "location": "sibling", "guardWrongRoot": false }
}
`);
    assert.deepEqual((await loadConfig(root)).worktrees, { location: "sibling", guardWrongRoot: false });
  });
});

test("loadConfig rejects a non-boolean worktrees.guardWrongRoot", async () => {
  const cases = [`"true"`, `1`, `null`, `{}`];
  for (const rawValue of cases) {
    await withRoot(async (root) => {
      await writeConfig(root, `{ "worktrees": { "location": "sibling", "guardWrongRoot": ${rawValue} } }`);
      await assert.rejects(loadConfig(root), /worktrees\.guardWrongRoot must be a boolean/, `case ${rawValue}`);
    });
  }
});

test("loadConfig warns about unknown optionalSteps stage keys without throwing", async () => {
  await withRoot(async (root) => {
    await writeConfig(root, `{
  "optionalSteps": {
    "docs": [
      { "name": "doc_review", "prompt": "a.md", "triggers": "t" }
    ]
  }
}
`);

    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      const config = await loadConfig(root);
      assert.equal(Object.hasOwn(config.optionalSteps, "docs"), false);
      assert.deepEqual(config.optionalSteps.design, []);
      assert.deepEqual(config.optionalSteps.implement, []);
      assert.deepEqual(config.optionalSteps.test, []);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /unknown optionalSteps stage "docs"/);
    } finally {
      console.warn = originalWarn;
    }
  });
});
