import { execFile } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

import { buildTargets, runInstall as runInstallInProcess } from "../src/install.js";
import { removeFixtureDir } from "./helpers/fixtures.js";

const execFileAsync = promisify(execFile);
const INSTALLER = path.resolve("install.mjs");
const CLI = path.resolve("bin", "local-board.js");

// A stub `local-board` executable on PATH so installer tests can exercise the
// PATH-verification success path without a real global install. Tests that
// exercise the *failure* path pass `{ includeLocalBoardStub: false,
// sanitizePath: true }` to `installEnv`, which replaces the child process's
// PATH with a minimal, constructed set of directories (just enough for
// `node`/`where`/`command -v` to run) instead of relying on the ambient host
// PATH to genuinely lack `local-board`. This keeps the suite hermetic: it
// passes identically whether or not `local-board` is globally installed on
// the machine running the tests.
const STUB_BIN_DIR = createStubBinDir();

// A minimal PATH for the child process containing only the directory of the
// current Node executable plus the OS-minimum directories needed for `where`
// (win32) / `command -v` (posix) and `node` itself to resolve. Deliberately
// excludes any ambient PATH entries, so tests using it are unaffected by
// whatever is globally installed on the host running the suite.
function sanitizedSystemPath() {
  const nodeDir = path.dirname(process.execPath);
  if (process.platform === "win32") {
    const windir = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
    return [
      nodeDir,
      windir,
      path.join(windir, "System32"),
      path.join(windir, "System32", "Wbem"),
      path.join(windir, "System32", "WindowsPowerShell", "v1.0"),
    ].join(path.delimiter);
  }
  // Deliberately excludes /usr/local/bin (and other global npm bin dirs):
  // a real local-board install there would make the failure-path tests
  // host-dependent. /usr/bin and /bin suffice for sh builtins and `command -v`.
  return [nodeDir, "/usr/bin", "/bin"].join(path.delimiter);
}

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
    await removeFixtureDir(home);
  }
}

// Regression seam for the hook-command quoting fix: the prefix deliberately
// contains a space so the resulting HOME (and therefore the install dir
// nested under it) reproduces "home dir with spaces" installs.
async function withHomeContainingSpace(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), "local board install "));
  try {
    await fn(home);
  } finally {
    await removeFixtureDir(home);
  }
}

function findPathKey(env) {
  return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
}

function installEnv(home, { includeLocalBoardStub = true, sanitizePath = false } = {}) {
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    HOMEDRIVE: path.parse(home).root.replace(/[\\/]+$/, ""),
    HOMEPATH: home.slice(path.parse(home).root.length),
  };
  const pathKey = findPathKey(env);
  if (sanitizePath) {
    env[pathKey] = sanitizedSystemPath();
  }
  if (includeLocalBoardStub) {
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
    "hooks",
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
    assert.doesNotMatch(skill, /<<SCRIPT_PATH>>|<<INSTALL_PATH>>/);
    assert.doesNotMatch(teamSkill, /<<SCRIPT_PATH>>|<<INSTALL_PATH>>/);
    assert.doesNotMatch(skill, /Runtime directory:/);
    assert.doesNotMatch(teamSkill, /Runtime directory:/);
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

test("installer stamps the package version into rendered skills, install-info.json, and the runtime --version output", async () => {
  await withHome(async (home) => {
    const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));

    await runInstallCli(home, ["--target=claude"]);

    const skillPath = path.join(home, ".claude", "skills", "local-board", "SKILL.md");
    const skill = await readFile(skillPath, "utf8");
    assert.match(skill, new RegExp(escapeRegExp(`local-board v${packageJson.version}`)));
    assert.doesNotMatch(skill, /<<VERSION>>/);
    // The command-invocation lines stay byte-identical across versions; only
    // the metadata/preflight stamp lines vary.
    assert.match(skill, /\blocal-board /);

    const installInfo = JSON.parse(await readFile(path.join(home, ".local-board", "install-info.json"), "utf8"));
    assert.equal(installInfo.version, packageJson.version);

    const { stdout } = await execFileAsync(
      process.execPath,
      [path.join(home, ".local-board", "bin", "local-board.js"), "--version"],
      { encoding: "utf8" },
    );
    assert.equal(stdout.trim(), packageJson.version);
  });
});

test("installer stamps the package version into the Codex skill render and preflight", async () => {
  await withHome(async (home) => {
    const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));

    await runInstallCli(home, ["--target=codex"]);

    const skillPath = path.join(home, ".codex", "skills", "local-board", "SKILL.md");
    const skill = await readFile(skillPath, "utf8");
    assert.match(skill, new RegExp(escapeRegExp(`local-board v${packageJson.version}`)));
    assert.doesNotMatch(skill, /<<VERSION>>/);
    assert.match(skill, /Version-skew check \(advisory\)/);
  });
});

test("Codex skill templates have valid frontmatter and point route translation at begin-step --harness codex", async () => {
  const skill = await readFile(path.resolve("skills", "codex", "local-board", "SKILL.md"), "utf8");
  const teamSkill = await readFile(path.resolve("skills", "codex", "local-team", "SKILL.md"), "utf8");

  for (const text of [skill, teamSkill]) {
    assert.match(text, /^---\nname: [a-z0-9-]+\ndescription: .+\n---\n/s);
    assert.doesNotMatch(text, /allowed-tools:/);
    assert.doesNotMatch(text, /<<SCRIPT_PATH>>/);
    assert.doesNotMatch(text, /node\s+\S*local-board\.js/i);
    assert.match(text, /\blocal-board /);
    // Route Translation Contract table is now generated by begin-step
    // --harness codex, not hand-maintained per-repo; both skills must point
    // there instead of duplicating the seven-role mapping (T20260707T1335Z).
    assert.match(text, /--harness codex/);
    assert.match(text, /codexDispatch/);
  }

  // Only ONE illustrative row remains -- the full seven-role table is gone.
  assert.equal((skill.match(/\| `claude-subagent:local-board-/g) ?? []).length, 1);
  assert.match(skill, /claude-subagent:local-board-designer/);
  assert.match(skill, /evidenceExecutor/);
});

test("no live skill template contains the retired <<INSTALL_PATH>> placeholder", async () => {
  const templatePaths = [
    path.resolve("SKILL.md"),
    path.resolve("SKILL_TEAM.md"),
    path.resolve("skills", "codex", "local-board", "SKILL.md"),
    path.resolve("skills", "codex", "local-team", "SKILL.md"),
  ];

  for (const templatePath of templatePaths) {
    const text = await readFile(templatePath, "utf8");
    assert.doesNotMatch(text, /<<INSTALL_PATH>>/, `${templatePath} still references <<INSTALL_PATH>>`);
    assert.doesNotMatch(text, /Runtime directory:/, `${templatePath} still has a Runtime directory: line`);
  }
});

test("renderSkill no longer replaces <<INSTALL_PATH>>; the token survives verbatim if a template reintroduces it", async () => {
  await withHome(async (home) => {
    const packagedDir = createPackagedCopy();
    try {
      const skillPath = path.join(packagedDir, "skills", "codex", "local-board", "SKILL.md");
      const original = await readFile(skillPath, "utf8");
      await writeFile(skillPath, `${original}\n\nLegacy runtime marker: <<INSTALL_PATH>>/agents/codex/\n`, "utf8");

      await execFileAsync(
        process.execPath,
        [path.join(packagedDir, "bin", "local-board.js"), "install", "--target=codex"],
        { cwd: packagedDir, encoding: "utf8", env: installEnv(home) },
      );

      const rendered = await readFile(path.join(home, ".codex", "skills", "local-board", "SKILL.md"), "utf8");
      assert.match(rendered, /Legacy runtime marker: <<INSTALL_PATH>>\/agents\/codex\//);
    } finally {
      await removeFixtureDir(packagedDir);
    }
  });
});

test("CLI install subcommand installs the same tree as install.mjs", async () => {
  await withHome(async (home) => {
    const { stdout } = await runInstallCli(home, ["--target=codex"]);
    assert.match(stdout, /installed skill for Codex/);
    assert.match(stdout, /installed team skill for Codex/);

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
    assert.doesNotMatch(skill, /<<SCRIPT_PATH>>|<<INSTALL_PATH>>/);
    assert.doesNotMatch(teamSkill, /<<SCRIPT_PATH>>|<<INSTALL_PATH>>/);
    assert.doesNotMatch(skill, /Runtime directory:/);
    assert.doesNotMatch(teamSkill, /Runtime directory:/);
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

test("install --hooks is opt-in: plain install writes no hooks and prints the enable hint", async () => {
  await withHome(async (home) => {
    const settingsPath = path.join(home, ".claude", "settings.json");
    const { stdout } = await runInstallCli(home, ["--target=claude"]);

    assert.match(stdout, /Run 'local-board install --hooks' to enable Claude Code dispatch-enforcement hooks/);
    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(settings.hooks, undefined);
  });
});

test("install --hooks writes all four managed hook entries and is idempotent", async () => {
  await withHome(async (home) => {
    const settingsPath = path.join(home, ".claude", "settings.json");
    const installDir = path.join(home, ".local-board").replace(/\\/g, "/");
    const { stdout } = await runInstallCli(home, ["--target=claude", "--hooks"]);
    assert.doesNotMatch(stdout, /Run 'local-board install --hooks'/);

    const firstRun = JSON.parse(await readFile(settingsPath, "utf8"));
    const preToolMatchers = firstRun.hooks.PreToolUse.map((entry) => entry.matcher).sort();
    assert.deepEqual(preToolMatchers, ["Bash", "Task|Agent"]);
    assert.deepEqual(
      firstRun.hooks.PostToolUse.map((entry) => entry.matcher),
      ["Task|Agent"],
    );

    const bashGroup = firstRun.hooks.PreToolUse.find((entry) => entry.matcher === "Bash");
    const bashCommands = bashGroup.hooks.map((hook) => hook.command).sort();
    assert.deepEqual(bashCommands, [
      `node "${installDir}/hooks/approve-inline-consent.js"`,
      `node "${installDir}/hooks/evidence-gate.js"`,
    ]);

    const taskGroupPre = firstRun.hooks.PreToolUse.find((entry) => entry.matcher === "Task|Agent");
    assert.deepEqual(
      taskGroupPre.hooks.map((hook) => hook.command),
      [`node "${installDir}/hooks/routing-validator.js"`],
    );
    const taskGroupPost = firstRun.hooks.PostToolUse.find((entry) => entry.matcher === "Task|Agent");
    assert.deepEqual(
      taskGroupPost.hooks.map((hook) => hook.command),
      [`node "${installDir}/hooks/dispatch-ledger.js"`],
    );

    // Existing allow-rule patch must coexist untouched.
    assert.deepEqual(firstRun.permissions.allow, ["Bash(local-board *)"]);

    // Re-run --hooks: no duplicate entries.
    await runInstallCli(home, ["--target=claude", "--hooks"]);
    const secondRun = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.deepEqual(secondRun.hooks, firstRun.hooks);
  });
});

test("install --no-hooks removes the managed hook entries and leaves the allow rule and other settings alone", async () => {
  await withHome(async (home) => {
    const settingsPath = path.join(home, ".claude", "settings.json");
    await runInstallCli(home, ["--target=claude", "--hooks"]);

    // Simulate a user-authored hook entry that must survive removal.
    const before = JSON.parse(await readFile(settingsPath, "utf8"));
    before.hooks.PreToolUse.push({ matcher: "WebFetch", hooks: [{ type: "command", command: "node user-hook.js" }] });
    await writeFile(settingsPath, `${JSON.stringify(before, null, 2)}\n`, "utf8");

    await runInstallCli(home, ["--target=claude", "--no-hooks"]);
    const after = JSON.parse(await readFile(settingsPath, "utf8"));

    assert.equal(after.hooks.PostToolUse, undefined);
    const remainingPreMatchers = after.hooks.PreToolUse.map((entry) => entry.matcher);
    assert.deepEqual(remainingPreMatchers, ["WebFetch"]);
    assert.deepEqual(after.permissions.allow, ["Bash(local-board *)"]);
  });
});

test("install --hooks on a non-Claude-only target leaves settings untouched (no settingsPath)", async () => {
  await withHome(async (home) => {
    await runInstallCli(home, ["--target=codex", "--hooks"]);
    assert.equal(existsSync(path.join(home, ".claude", "settings.json")), false);
    // hooks/ still ships to the install dir regardless of wiring.
    assert.equal(existsSync(path.join(home, ".local-board", "hooks", "dispatch-ledger.js")), true);
  });
});

test("install --uninstall removes wired hook entries from settings.json", async () => {
  await withHome(async (home) => {
    const settingsPath = path.join(home, ".claude", "settings.json");
    await runInstallCli(home, ["--target=claude", "--hooks"]);
    assert.ok((await readFile(settingsPath, "utf8")).includes("dispatch-ledger.js"));

    await runInstallCli(home, ["--target=claude", "--uninstall"]);
    const after = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(after.hooks, undefined);
  });
});

test("install --hooks quotes the hook command path when the home dir contains spaces, and --uninstall still removes it", async () => {
  await withHomeContainingSpace(async (home) => {
    assert.match(home, / /); // sanity: the fixture actually reproduces a space in the path

    const settingsPath = path.join(home, ".claude", "settings.json");
    const installDir = path.join(home, ".local-board").replace(/\\/g, "/");
    await runInstallCli(home, ["--target=claude", "--hooks"]);

    const afterInstall = JSON.parse(await readFile(settingsPath, "utf8"));
    const taskGroupPost = afterInstall.hooks.PostToolUse.find((entry) => entry.matcher === "Task|Agent");
    assert.deepEqual(
      taskGroupPost.hooks.map((hook) => hook.command),
      [`node "${installDir}/hooks/dispatch-ledger.js"`],
    );

    // Re-running --hooks must not duplicate the (quoted) entry.
    await runInstallCli(home, ["--target=claude", "--hooks"]);
    const afterSecondRun = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.deepEqual(afterSecondRun.hooks, afterInstall.hooks);

    // Uninstall must match and remove the quoted command form.
    await runInstallCli(home, ["--target=claude", "--uninstall"]);
    const afterUninstall = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(afterUninstall.hooks, undefined);
  });
});

test("install --hooks recognizes a hand-seeded unquoted (pre-rework) entry as managed: reinstall yields exactly one quoted entry per script, no duplicate", async () => {
  await withHome(async (home) => {
    const settingsPath = path.join(home, ".claude", "settings.json");
    const installDir = path.join(home, ".local-board").replace(/\\/g, "/");

    // First install (creates settings.json + install dir), then hand-seed an
    // old-form unquoted managed entry alongside whatever the install wrote,
    // simulating a settings.json produced by the pre-rework installer.
    await runInstallCli(home, ["--target=claude", "--hooks"]);
    const before = JSON.parse(await readFile(settingsPath, "utf8"));
    const postTaskGroup = before.hooks.PostToolUse.find((entry) => entry.matcher === "Task|Agent");
    postTaskGroup.hooks = [{ type: "command", command: `node ${installDir}/hooks/dispatch-ledger.js` }];
    await writeFile(settingsPath, `${JSON.stringify(before, null, 2)}\n`, "utf8");

    await runInstallCli(home, ["--target=claude", "--hooks"]);
    const after = JSON.parse(await readFile(settingsPath, "utf8"));
    const afterTaskGroup = after.hooks.PostToolUse.find((entry) => entry.matcher === "Task|Agent");
    assert.deepEqual(
      afterTaskGroup.hooks.map((hook) => hook.command),
      [`node "${installDir}/hooks/dispatch-ledger.js"`],
    );
  });
});

test("install --uninstall removes a hand-seeded unquoted (pre-rework) entry too", async () => {
  await withHome(async (home) => {
    const settingsPath = path.join(home, ".claude", "settings.json");
    const installDir = path.join(home, ".local-board").replace(/\\/g, "/");

    await runInstallCli(home, ["--target=claude", "--hooks"]);
    const before = JSON.parse(await readFile(settingsPath, "utf8"));
    const postTaskGroup = before.hooks.PostToolUse.find((entry) => entry.matcher === "Task|Agent");
    // Replace the (quoted) installed entry with an unquoted pre-rework form,
    // so uninstall must recognize it purely by script path.
    postTaskGroup.hooks = [{ type: "command", command: `node ${installDir}/hooks/dispatch-ledger.js` }];
    await writeFile(settingsPath, `${JSON.stringify(before, null, 2)}\n`, "utf8");

    await runInstallCli(home, ["--target=claude", "--uninstall"]);
    const after = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(after.hooks, undefined);
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
      runInstallCli(home, ["--target=codex"], { includeLocalBoardStub: false, sanitizePath: true }),
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
          env: installEnv(home, { includeLocalBoardStub: false, sanitizePath: true }),
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
      await removeFixtureDir(packagedDir);
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
