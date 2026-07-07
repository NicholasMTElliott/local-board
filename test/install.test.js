import { execFile } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

import { buildTargets, runInstall as runInstallInProcess } from "../src/install.js";

const execFileAsync = promisify(execFile);
const INSTALLER = path.resolve("install.mjs");
const CLI = path.resolve("bin", "local-board.js");

// A stub `local-board` executable on PATH so installer tests can exercise the
// PATH-verification success path without a real global install. Tests that
// exercise the *failure* path pass `{ includeLocalBoardStub: false }` to
// `installEnv`, which relies on the ambient test PATH genuinely lacking
// `local-board`.
const STUB_BIN_DIR = createStubBinDir();

function createStubBinDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "local-board-stub-bin-"));
  if (process.platform === "win32") {
    writeFileSync(path.join(dir, "local-board.cmd"), "@echo off\r\n");
  } else {
    const shimPath = path.join(dir, "local-board");
    writeFileSync(shimPath, "#!/bin/sh\nexit 0\n");
    chmodSync(shimPath, 0o755);
  }
  return dir;
}

async function withHome(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), "local-board-install-"));
  try {
    await fn(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

function findPathKey(env) {
  return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
}

function installEnv(home, { includeLocalBoardStub = true } = {}) {
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    HOMEDRIVE: path.parse(home).root.replace(/[\\/]+$/, ""),
    HOMEPATH: home.slice(path.parse(home).root.length),
  };
  if (includeLocalBoardStub) {
    const pathKey = findPathKey(env);
    env[pathKey] = `${STUB_BIN_DIR}${path.delimiter}${env[pathKey] ?? ""}`;
  }
  return env;
}

async function runInstall(home, args, envOptions = {}) {
  return execFileAsync(process.execPath, [INSTALLER, ...args], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: installEnv(home, envOptions),
  });
}

async function runInstallCli(home, args, envOptions = {}) {
  return execFileAsync(process.execPath, [CLI, "install", ...args], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: installEnv(home, envOptions),
  });
}

function errorOutput(error) {
  return `${error.stderr ?? ""}\n${error.stdout ?? ""}\n${error.message ?? ""}`;
}

// Copies just the npm `files` allowlist into a fresh temp directory with no
// `.git` entry, simulating a packaged/npm install (as opposed to this
// repo's own git checkout, which is always "clone mode" for `.git`-presence
// detection).
function createPackagedCopy() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "local-board-packaged-"));
  const entries = [
    "package.json",
    "README.md",
    "SKILL.md",
    "SKILL_TEAM.md",
    "install.mjs",
    "bin",
    "src",
    "resources",
    "agents",
    "skills",
  ];
  for (const entry of entries) {
    const source = path.resolve(entry);
    if (existsSync(source)) {
      cpSync(source, path.join(dir, entry), { recursive: true });
    }
  }
  return dir;
}

test("installer lists the Codex target", async () => {
  await withHome(async (home) => {
    const { stdout } = await runInstall(home, ["--list-targets"]);

    assert.match(stdout, /^codex\tCodex\t/m);
    assert.match(stdout, /\.codex[\\/]skills[\\/]local-board/);
    assert.match(stdout, /\.codex[\\/]skills[\\/]local-team/);
  });
});

test("installer writes rendered Codex skills and uninstall removes them", async () => {
  await withHome(async (home) => {
    const { stdout } = await runInstall(home, ["--target=codex"]);
    assert.match(stdout, /installed skill for Codex/);
    assert.match(stdout, /installed team skill for Codex/);

    const expectedInstallDir = path.join(home, ".local-board").replace(/\\/g, "/");
    const skillDir = path.join(home, ".codex", "skills", "local-board");
    const teamSkillDir = path.join(home, ".codex", "skills", "local-team");
    const skillPath = path.join(skillDir, "SKILL.md");
    const teamSkillPath = path.join(teamSkillDir, "SKILL.md");

    assert.equal(existsSync(skillPath), true);
    assert.equal(existsSync(path.join(skillDir, "agents", "openai.yaml")), true);
    assert.equal(existsSync(teamSkillPath), true);
    assert.equal(existsSync(path.join(teamSkillDir, "agents", "openai.yaml")), true);
    assert.equal(existsSync(path.join(home, ".local-board", "agents", "codex", "local-board-reviewer.md")), true);

    const skill = await readFile(skillPath, "utf8");
    const teamSkill = await readFile(teamSkillPath, "utf8");
    assert.match(skill, new RegExp(escapeRegExp(expectedInstallDir)));
    assert.match(teamSkill, new RegExp(escapeRegExp(expectedInstallDir)));
    assert.doesNotMatch(skill, /<<SCRIPT_PATH>>|<<INSTALL_PATH>>/);
    assert.doesNotMatch(teamSkill, /<<SCRIPT_PATH>>|<<INSTALL_PATH>>/);
    assert.doesNotMatch(skill, /node\s+\S*local-board\.js/i);
    assert.doesNotMatch(teamSkill, /node\s+\S*local-board\.js/i);
    assert.match(skill, /\blocal-board /);
    assert.match(teamSkill, /\blocal-board /);
    assert.match(skill, /claude-subagent:local-board-designer/);
    assert.match(skill, /codex-task:workspace-write/);
    assert.match(skill, /@codex-default/);

    await runInstall(home, ["--target=codex", "--uninstall"]);
    assert.equal(existsSync(skillDir), false);
    assert.equal(existsSync(teamSkillDir), false);
  });
});

test("Codex skill templates have valid frontmatter and route translation guidance", async () => {
  const skill = await readFile(path.resolve("skills", "codex", "local-board", "SKILL.md"), "utf8");
  const teamSkill = await readFile(path.resolve("skills", "codex", "local-team", "SKILL.md"), "utf8");

  for (const text of [skill, teamSkill]) {
    assert.match(text, /^---\nname: [a-z0-9-]+\ndescription: .+\n---\n/s);
    assert.doesNotMatch(text, /allowed-tools:/);
    assert.doesNotMatch(text, /<<SCRIPT_PATH>>/);
    assert.doesNotMatch(text, /node\s+\S*local-board\.js/i);
    assert.match(text, /\blocal-board /);
  }

  for (const route of [
    "claude-subagent:local-board-decomposer",
    "claude-subagent:local-board-designer",
    "claude-subagent:local-board-implementer",
    "claude-subagent:local-board-reviewer",
    "claude-subagent:local-board-tester",
    "claude-subagent:local-board-documenter",
    "claude-subagent:local-board-gatecheck",
    "codex-task:read-only",
    "codex-task:workspace-write",
  ]) {
    assert.match(skill, new RegExp(escapeRegExp(route)));
  }
}
);

test("CLI install subcommand installs the same tree as install.mjs", async () => {
  await withHome(async (home) => {
    const { stdout } = await runInstallCli(home, ["--target=codex"]);
    assert.match(stdout, /installed skill for Codex/);
    assert.match(stdout, /installed team skill for Codex/);

    const expectedInstallDir = path.join(home, ".local-board").replace(/\\/g, "/");
    const skillDir = path.join(home, ".codex", "skills", "local-board");
    const teamSkillDir = path.join(home, ".codex", "skills", "local-team");
    const skillPath = path.join(skillDir, "SKILL.md");
    const teamSkillPath = path.join(teamSkillDir, "SKILL.md");

    assert.equal(existsSync(skillPath), true);
    assert.equal(existsSync(path.join(skillDir, "agents", "openai.yaml")), true);
    assert.equal(existsSync(teamSkillPath), true);
    assert.equal(existsSync(path.join(teamSkillDir, "agents", "openai.yaml")), true);
    assert.equal(existsSync(path.join(home, ".local-board", "agents", "codex", "local-board-reviewer.md")), true);
    assert.equal(existsSync(path.join(home, ".local-board", "bin", "local-board.js")), true);
    assert.equal(existsSync(path.join(home, ".local-board", "prompts")), true);
    assert.equal(existsSync(path.join(home, ".local-board", "templates")), true);
    assert.equal(existsSync(path.join(home, ".local-board", "install-info.json")), true);

    const skill = await readFile(skillPath, "utf8");
    const teamSkill = await readFile(teamSkillPath, "utf8");
    assert.match(skill, new RegExp(escapeRegExp(expectedInstallDir)));
    assert.match(teamSkill, new RegExp(escapeRegExp(expectedInstallDir)));
    assert.doesNotMatch(skill, /<<SCRIPT_PATH>>|<<INSTALL_PATH>>/);
    assert.doesNotMatch(teamSkill, /<<SCRIPT_PATH>>|<<INSTALL_PATH>>/);
    assert.doesNotMatch(skill, /node\s+\S*local-board\.js/i);
    assert.doesNotMatch(teamSkill, /node\s+\S*local-board\.js/i);
  });
});

test("CLI install --list-targets matches install.mjs --list-targets output shape", async () => {
  await withHome(async (home) => {
    const cliResult = await runInstallCli(home, ["--list-targets"]);
    const shimResult = await runInstall(home, ["--list-targets"]);

    assert.equal(cliResult.stdout, shimResult.stdout);
    assert.match(cliResult.stdout, /^codex\tCodex\t/m);
  });
});

test("CLI install --uninstall removes what install created", async () => {
  await withHome(async (home) => {
    await runInstallCli(home, ["--target=codex"]);
    const skillDir = path.join(home, ".codex", "skills", "local-board");
    const teamSkillDir = path.join(home, ".codex", "skills", "local-team");
    const installDir = path.join(home, ".local-board");
    assert.equal(existsSync(skillDir), true);
    assert.equal(existsSync(installDir), true);

    await runInstallCli(home, ["--target=codex", "--uninstall"]);
    assert.equal(existsSync(skillDir), false);
    assert.equal(existsSync(teamSkillDir), false);
    assert.equal(existsSync(installDir), false);
  });
});

test("settings.json allow-rule patch is idempotent, uses the constant local-board rule, and preserves existing settings", async () => {
  await withHome(async (home) => {
    const settingsPath = path.join(home, ".claude", "settings.json");
    await runInstallCli(home, ["--target=claude"]);

    const firstRun = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.deepEqual(firstRun.permissions.allow, ["Bash(local-board *)"]);

    // Run again; the rule must not be duplicated and unrelated content must
    // survive.
    await runInstallCli(home, ["--target=claude"]);
    const secondRun = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.deepEqual(secondRun.permissions.allow, ["Bash(local-board *)"]);
    assert.deepEqual(secondRun.permissions.allow, firstRun.permissions.allow);
  });
});

test("install --root is ignored; installs under redirected HOME", async () => {
  await withHome(async (home) => {
    const bogusRoot = path.join(home, "not-the-board-root");
    const { stdout } = await runInstallCli(home, ["--root", bogusRoot, "--target=codex"]);
    assert.match(stdout, new RegExp(escapeRegExp(path.join(home, ".local-board"))));

    const skillDir = path.join(home, ".codex", "skills", "local-board");
    assert.equal(existsSync(skillDir), true);
    assert.equal(existsSync(bogusRoot), false);
  });
});

test("in-process runInstall option seam installs and uninstalls without a subprocess", async () => {
  await withHome(async (home) => {
    const installCode = runInstallInProcess(["--target=codex"], { home, resolvesOnPath: () => true });
    assert.equal(installCode, 0);

    const skillDir = path.join(home, ".codex", "skills", "local-board");
    assert.equal(existsSync(skillDir), true);

    const uninstallCode = runInstallInProcess(["--target=codex", "--uninstall"], { home, resolvesOnPath: () => true });
    assert.equal(uninstallCode, 0);
    assert.equal(existsSync(skillDir), false);
  });
});

test("buildTargets(home) anchors every target under the supplied home", () => {
  const home = path.join(os.tmpdir(), "local-board-buildtargets-example");
  const targets = buildTargets(home);
  const codex = targets.find((target) => target.id === "codex");

  assert.ok(codex);
  assert.equal(codex.skillDir, path.join(home, ".codex", "skills", "local-board"));
  assert.equal(codex.detectPath, path.join(home, ".codex"));
});

test("PATH verification (in-process option seam): resolvesOnPath false throws a guidance error", async () => {
  await withHome(async (home) => {
    assert.throws(
      () => runInstallInProcess(["--target=codex"], { home, resolvesOnPath: () => false }),
      /local-board is not on PATH/,
    );
  });
});

test("PATH verification failure (real PATH, clone/git-checkout mode): guidance recommends npm link", async () => {
  await withHome(async (home) => {
    await assert.rejects(
      runInstallCli(home, ["--target=codex"], { includeLocalBoardStub: false }),
      (error) => {
        const output = errorOutput(error);
        assert.match(output, /local-board is not on PATH/);
        assert.match(output, /npm install -g \./);
        assert.match(output, /npm link/);
        return true;
      },
    );
  });
});

test("PATH verification failure (packaged/no-.git tree): guidance omits npm link", async () => {
  await withHome(async (home) => {
    const packagedDir = createPackagedCopy();
    try {
      assert.equal(existsSync(path.join(packagedDir, ".git")), false);
      await assert.rejects(
        execFileAsync(process.execPath, [path.join(packagedDir, "bin", "local-board.js"), "install", "--target=codex"], {
          cwd: packagedDir,
          encoding: "utf8",
          env: installEnv(home, { includeLocalBoardStub: false }),
        }),
        (error) => {
          const output = errorOutput(error);
          assert.match(output, /local-board is not on PATH/);
          assert.match(output, /npm install -g local-board/);
          assert.doesNotMatch(output, /npm link/);
          return true;
        },
      );
    } finally {
      await rm(packagedDir, { recursive: true, force: true });
    }
  });
});

test("PATH verification success (stub local-board on PATH): install proceeds", async () => {
  await withHome(async (home) => {
    // The default installEnv already prepends STUB_BIN_DIR; a successful
    // install here proves the positive PATH-resolution path works end to end
    // through the real `where`/`command -v` resolver, not just the in-process
    // option seam.
    const { stdout } = await runInstallCli(home, ["--target=codex"]);
    assert.match(stdout, /installed skill for Codex/);
  });
});

test("rendered SKILL.md CLI-invocation lines are byte-identical across install homes", async () => {
  await withHome(async (homeA) => {
    await withHome(async (homeB) => {
      await runInstallCli(homeA, ["--target=codex"]);
      await runInstallCli(homeB, ["--target=codex"]);

      const skillA = await readFile(path.join(homeA, ".codex", "skills", "local-board", "SKILL.md"), "utf8");
      const skillB = await readFile(path.join(homeB, ".codex", "skills", "local-board", "SKILL.md"), "utf8");

      const invocationLines = (text) => text.split(/\r?\n/).filter((line) => line.includes("local-board "));

      const linesA = invocationLines(skillA);
      const linesB = invocationLines(skillB);

      assert.ok(linesA.length > 0);
      assert.deepEqual(linesA, linesB);
    });
  });
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
