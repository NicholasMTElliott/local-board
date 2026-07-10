import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { codexTaskSkillInstalled, codexTaskWarning } from "../src/codex-detect.js";
import { removeFixtureDir } from "./helpers/fixtures.js";

async function withHome(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), "local-board-codex-detect-"));
  try {
    await fn(home);
  } finally {
    await removeFixtureDir(home);
  }
}

function fakeBuildTargets(home) {
  return [
    {
      id: "claude",
      skillDir: path.join(home, ".claude", "skills", "local-board"),
    },
    {
      id: "codex",
      skillDir: path.join(home, ".codex", "skills", "local-board"),
    },
  ];
}

async function writeCodexTaskSkill(home, harnessDir = ".claude") {
  const dir = path.join(home, harnessDir, "skills", "codex-task");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), "# codex-task\n", "utf8");
}

const noCodexRoutesConfig = {
  agents: {
    design: { route: "claude-subagent:local-board-designer", model: "opus" },
    implement: { route: "inline" },
  },
  optionalSteps: {
    design: [{ name: "security_threat_model", agent: "claude-subagent:local-board-reviewer" }],
  },
};

const reviewRoutedConfig = {
  agents: {
    review: "codex-task:read-only",
  },
};

test("codexTaskWarning: no codex-task routes returns null and never probes PATH", () => {
  const throwingResolvesOnPath = () => {
    throw new Error("resolvesOnPath must not be called when there are no codex-task routes");
  };
  const result = codexTaskWarning(noCodexRoutesConfig, {
    home: "unused",
    resolvesOnPath: throwingResolvesOnPath,
    buildTargets: () => {
      throw new Error("buildTargets must not be called either");
    },
  });
  assert.equal(result, null);
});

test("codexTaskWarning: codex absent from PATH names the routed action and the missing binary", () => {
  const result = codexTaskWarning(reviewRoutedConfig, {
    home: "unused",
    resolvesOnPath: () => false,
    buildTargets: () => [],
  });
  assert.match(result, /^WARNING:/);
  assert.match(result, /review/);
  assert.match(result, /`codex` CLI not found on PATH/);
});

test("codexTaskWarning: both prerequisites present returns null", async () => {
  await withHome(async (home) => {
    await writeCodexTaskSkill(home);
    const result = codexTaskWarning(reviewRoutedConfig, {
      home,
      resolvesOnPath: () => true,
      buildTargets: fakeBuildTargets,
    });
    assert.equal(result, null);
  });
});

test("codexTaskWarning: skill missing only names the skill clause, not the binary clause", async () => {
  await withHome(async (home) => {
    const result = codexTaskWarning(reviewRoutedConfig, {
      home,
      resolvesOnPath: () => true,
      buildTargets: fakeBuildTargets,
    });
    assert.match(result, /codex-task skill not installed in any harness skills dir/);
    assert.doesNotMatch(result, /`codex` CLI not found on PATH/);
  });
});

test("codexTaskWarning: skill detection follows the injected home (--home-style seam)", async () => {
  await withHome(async (homeWithSkill) => {
    await writeCodexTaskSkill(homeWithSkill);
    await withHome(async (homeWithoutSkill) => {
      const withSkill = codexTaskWarning(reviewRoutedConfig, {
        home: homeWithSkill,
        resolvesOnPath: () => false,
        buildTargets: fakeBuildTargets,
      });
      assert.doesNotMatch(withSkill, /codex-task skill not installed/);

      const withoutSkill = codexTaskWarning(reviewRoutedConfig, {
        home: homeWithoutSkill,
        resolvesOnPath: () => false,
        buildTargets: fakeBuildTargets,
      });
      assert.match(withoutSkill, /codex-task skill not installed/);
    });
  });
});

test("codexTaskWarning: optionalSteps[].agent routed to codex-task names '<name> (<stage>)'", () => {
  const config = {
    agents: {},
    optionalSteps: {
      design: [
        {
          name: "security_threat_model",
          agent: "codex-task:read-only",
        },
      ],
    },
  };
  const result = codexTaskWarning(config, {
    home: "unused",
    resolvesOnPath: () => false,
    buildTargets: () => [],
  });
  assert.match(result, /security_threat_model \(design\)/);
});

test("codexTaskWarning: fails open when resolvesOnPath or buildTargets throw", () => {
  const throwingResolvesOnPath = () => {
    throw new Error("boom: resolvesOnPath");
  };
  const throwingBuildTargets = () => {
    throw new Error("boom: buildTargets");
  };
  assert.doesNotThrow(() => {
    const result = codexTaskWarning(reviewRoutedConfig, {
      home: "unused",
      resolvesOnPath: throwingResolvesOnPath,
      buildTargets: throwingBuildTargets,
    });
    assert.match(result, /^WARNING:/);
  });
});

test("codexTaskSkillInstalled: false on error (fail-open), never throws", () => {
  const result = codexTaskSkillInstalled("unused", () => {
    throw new Error("boom");
  });
  assert.equal(result, false);
});
