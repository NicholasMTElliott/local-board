import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { defaultConfigJsonc, loadConfig, parseJsonc } from "../src/config.js";

async function withRoot(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-board-config-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
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
    assert.equal(config.agents.implement, "claude-subagent:local-board-implementer");
    assert.equal(config.agents.review, "codex-task:read-only");
    assert.equal(config.agents.document, "codex-task:workspace-write");
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

  for (const value of Object.values(config.agents)) {
    if (!value.startsWith("claude-subagent:")) {
      continue;
    }
    const agentName = value.slice("claude-subagent:".length);
    assert.equal(fileNames.has(`${agentName}.md`), true, `${agentName}.md is missing`);
    const text = await readFile(path.join(agentDir, `${agentName}.md`), "utf8");
    assert.match(text, new RegExp(`^name: ${agentName}$`, "m"));
  }
});

async function writeConfig(root, body) {
  await mkdir(path.join(root, "plans"), { recursive: true });
  await writeFile(path.join(root, "plans", "local-board.config.jsonc"), body, "utf8");
}

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
  });
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
