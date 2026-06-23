import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

const execFileAsync = promisify(execFile);
const INSTALLER = path.resolve("install.mjs");

async function withHome(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), "local-board-install-"));
  try {
    await fn(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

function installEnv(home) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    HOMEDRIVE: path.parse(home).root.replace(/[\\/]+$/, ""),
    HOMEPATH: home.slice(path.parse(home).root.length),
  };
}

async function runInstall(home, args) {
  return execFileAsync(process.execPath, [INSTALLER, ...args], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: installEnv(home),
  });
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

    const expectedScriptPath = path.join(home, ".local-board", "bin", "local-board.js").replace(/\\/g, "/");
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
    assert.match(skill, new RegExp(escapeRegExp(expectedScriptPath)));
    assert.match(teamSkill, new RegExp(escapeRegExp(expectedScriptPath)));
    assert.doesNotMatch(skill, /<<SCRIPT_PATH>>|<<INSTALL_PATH>>/);
    assert.doesNotMatch(teamSkill, /<<SCRIPT_PATH>>|<<INSTALL_PATH>>/);
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
