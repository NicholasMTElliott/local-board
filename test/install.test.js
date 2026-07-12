import { execFile } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

import { buildTargets, computePayloadHash, isSourceLayout, runInstall as runInstallInProcess } from "../src/install.js";
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

// Monkey-patches console.log around a synchronous call (runInstallInProcess
// is synchronous) and returns both its exit code and the captured log lines.
// Used by the codex-task install-hint tests, which assert on printed content
// rather than the exit code alone.
function captureConsoleLog(fn) {
  const lines = [];
  const original = console.log;
  console.log = (message = "") => lines.push(String(message));
  try {
    const code = fn();
    return { code, lines };
  } finally {
    console.log = original;
  }
}

function installEnv(home, { includeLocalBoardStub = true, sanitizePath = false, requireHome = false } = {}) {
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
  if (requireHome) {
    env.LOCAL_BOARD_INSTALL_REQUIRE_HOME = "1";
  } else {
    delete env.LOCAL_BOARD_INSTALL_REQUIRE_HOME;
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

async function runInstallCli(home, args, envOptions = {}, cwd = path.resolve(".")) {
  return execFileAsync(process.execPath, [CLI, "install", ...args], {
    cwd,
    encoding: "utf8",
    env: installEnv(home, envOptions),
  });
}

// Non-zero-tolerant variant for `install --status`, whose verdicts are
// scriptable via exit code (0/3/4/5) rather than always signalling failure.
async function runInstallCliExit(home, args, envOptions = {}, cwd = path.resolve(".")) {
  try {
    const result = await execFileAsync(process.execPath, [CLI, "install", ...args], {
      cwd,
      encoding: "utf8",
      env: installEnv(home, envOptions),
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
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

test("claude-target install prints the codex-task hint when the cwd project config routes to codex-task", async () => {
  await withHome(async (home) => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "local-board-install-cwd-"));
    try {
      mkdirSync(path.join(cwd, "plans"), { recursive: true });
      writeFileSync(
        path.join(cwd, "plans", "local-board.config.jsonc"),
        JSON.stringify({ agents: { review: "codex-task:read-only" } }),
      );

      // Differentiates by command so the installer's own "local-board on
      // PATH" precheck still passes (true) while the codex-task detection
      // probe specifically reports `codex` as absent (false).
      const logs = captureConsoleLog(() =>
        runInstallInProcess(["--target=claude"], {
          home,
          cwd,
          resolvesOnPath: (command) => command !== "codex",
        }),
      );

      assert.equal(logs.code, 0);
      assert.ok(
        logs.lines.some((line) => /WARNING:.*codex-task/.test(line)),
        logs.lines.join("\n"),
      );
      assert.ok(logs.lines.some((line) => /review/.test(line)));
    } finally {
      await removeFixtureDir(cwd);
    }
  });
});

test("claude-target install prints no codex-task hint when the cwd project config has zero codex-task routes", async () => {
  await withHome(async (home) => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "local-board-install-cwd-"));
    try {
      mkdirSync(path.join(cwd, "plans"), { recursive: true });
      writeFileSync(
        path.join(cwd, "plans", "local-board.config.jsonc"),
        JSON.stringify({ agents: { review: "inline" } }),
      );

      const logs = captureConsoleLog(() =>
        runInstallInProcess(["--target=claude"], { home, cwd, resolvesOnPath: () => true }),
      );

      assert.equal(logs.code, 0);
      assert.equal(
        logs.lines.some((line) => /codex-task/.test(line)),
        false,
        logs.lines.join("\n"),
      );
    } finally {
      await removeFixtureDir(cwd);
    }
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

test("CLI install subcommand installs the same tree as install.mjs, driven by --home (not env HOME); --home also skips the PATH precheck", async () => {
  await withHome(async (envHome) => {
    await withHome(async (altHome) => {
      // includeLocalBoardStub: false + sanitizePath: true would normally
      // trip the "local-board is not on PATH" failure path (see the
      // PATH-verification tests below); this migrated probe proves --home
      // skips that precheck entirely (D4), so it still succeeds.
      const { stdout } = await runInstallCli(envHome, ["--home", altHome, "--target=codex"], {
        includeLocalBoardStub: false,
        sanitizePath: true,
      });
      assert.match(stdout, /installed skill for Codex/);
      assert.match(stdout, /installed team skill for Codex/);

      const skillDir = path.join(altHome, ".codex", "skills", "local-board");
      const teamSkillDir = path.join(altHome, ".codex", "skills", "local-team");
      const skillPath = path.join(skillDir, "SKILL.md");
      const teamSkillPath = path.join(teamSkillDir, "SKILL.md");

      assert.equal(existsSync(skillPath), true);
      assert.equal(existsSync(path.join(skillDir, "agents", "openai.yaml")), true);
      assert.equal(existsSync(teamSkillPath), true);
      assert.equal(existsSync(path.join(teamSkillDir, "agents", "openai.yaml")), true);
      assert.equal(existsSync(path.join(altHome, ".local-board", "agents", "codex", "local-board-reviewer.md")), true);
      assert.equal(existsSync(path.join(altHome, ".local-board", "bin", "local-board.js")), true);
      assert.equal(existsSync(path.join(altHome, ".local-board", "prompts")), true);
      assert.equal(existsSync(path.join(altHome, ".local-board", "templates")), true);
      assert.equal(existsSync(path.join(altHome, ".local-board", "install-info.json")), true);

      // --home, not the env-redirected HOME, selects the install location.
      assert.equal(existsSync(path.join(envHome, ".codex")), false);
      assert.equal(existsSync(path.join(envHome, ".local-board")), false);

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
});

test("install --home <dir> (CLI) drives full install and uninstall symmetrically, distinct from env HOME", async () => {
  await withHome(async (envHome) => {
    await withHome(async (altHome) => {
      await runInstallCli(envHome, ["--home", altHome, "--target=claude"]);

      const skillDir = path.join(altHome, ".claude", "skills", "local-board");
      assert.equal(existsSync(skillDir), true);
      assert.equal(existsSync(path.join(altHome, ".local-board")), true);
      assert.equal(existsSync(path.join(envHome, ".claude")), false);
      assert.equal(existsSync(path.join(envHome, ".local-board")), false);

      await runInstallCli(envHome, ["--home", altHome, "--target=claude", "--uninstall"]);
      assert.equal(existsSync(skillDir), false);
      assert.equal(existsSync(path.join(altHome, ".local-board")), false);
    });
  });
});

test("LOCAL_BOARD_INSTALL_REQUIRE_HOME=1 refuses to touch the real home without --home (install and uninstall); proceeds when --home is supplied", async () => {
  await withHome(async (home) => {
    await assert.rejects(
      runInstallCli(home, ["--target=claude"], { requireHome: true }),
      (error) => {
        const output = errorOutput(error);
        assert.match(output, /LOCAL_BOARD_INSTALL_REQUIRE_HOME/);
        return true;
      },
    );

    await assert.rejects(
      runInstallCli(home, ["--target=claude", "--uninstall"], { requireHome: true }),
      (error) => {
        const output = errorOutput(error);
        assert.match(output, /LOCAL_BOARD_INSTALL_REQUIRE_HOME/);
        return true;
      },
    );

    await withHome(async (altHome) => {
      const { stdout } = await runInstallCli(home, ["--home", altHome, "--target=claude"], { requireHome: true });
      assert.match(stdout, /installed skill for Claude Code/);
      assert.equal(existsSync(path.join(altHome, ".claude", "skills", "local-board")), true);
    });
  });
});

test("runInstall({ home: undefined, ... }) (key present, value undefined) throws instead of falling back to os.homedir(); a defined home still succeeds", async () => {
  await withHome(async (home) => {
    assert.throws(
      () => runInstallInProcess(["--target=codex"], { home: undefined, resolvesOnPath: () => true }),
      /options\.home was provided but is undefined/,
    );

    // Complementary: only the undefined *value* trips it, not the key itself.
    const code = runInstallInProcess(["--target=codex"], { home, resolvesOnPath: () => true });
    assert.equal(code, 0);
    assert.equal(existsSync(path.join(home, ".codex", "skills", "local-board")), true);
  });
});

test("--home \"\" and --home \"   \" are rejected before any install path is touched (fail closed, not a silent cwd install)", async () => {
  await withHome(async (envHome) => {
    const scratchCwd = await mkdtemp(path.join(os.tmpdir(), "local-board-blankhome-cwd-"));
    try {
      for (const blankHome of ["", "   "]) {
        await assert.rejects(
          runInstallCli(envHome, ["--home", blankHome, "--target=claude"], {}, scratchCwd),
          (error) => {
            const output = errorOutput(error);
            assert.match(output, /--home requires a non-empty value/);
            return true;
          },
        );
      }
      // Confirms the flag never fell through to resolving against the
      // installer's cwd (the exact bug this guards against).
      assert.equal(existsSync(path.join(scratchCwd, ".local-board")), false);
      assert.equal(existsSync(path.join(scratchCwd, ".claude", "skills", "local-board")), false);
    } finally {
      await removeFixtureDir(scratchCwd);
    }
  });
});

test("relative --home resolves against the invoker's current directory, not the installer's own location", async () => {
  await withHome(async (envHome) => {
    const scratchCwd = await mkdtemp(path.join(os.tmpdir(), "local-board-relhome-cwd-"));
    try {
      await runInstallCli(envHome, ["--home", "./sandbox-home", "--target=claude"], {}, scratchCwd);

      const resolvedHome = path.join(scratchCwd, "sandbox-home");
      assert.equal(existsSync(path.join(resolvedHome, ".claude", "skills", "local-board")), true);
      assert.equal(existsSync(path.join(resolvedHome, ".local-board")), true);
      // Never wrote under the repo's own install.mjs directory or envHome.
      assert.equal(existsSync(path.join(path.resolve("."), "sandbox-home")), false);
      assert.equal(existsSync(path.join(envHome, ".claude")), false);
    } finally {
      await removeFixtureDir(scratchCwd);
    }
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

test("install --uninstall removes the allow rule and prunes settings.json back to an empty object", async () => {
  await withHome(async (home) => {
    const settingsPath = path.join(home, ".claude", "settings.json");
    await runInstallCli(home, ["--target=claude"]);

    const afterInstall = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.deepEqual(afterInstall.permissions.allow, ["Bash(local-board *)"]);

    await runInstallCli(home, ["--target=claude", "--uninstall"]);
    const afterUninstall = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(afterUninstall.permissions, undefined);
  });
});

test("install --uninstall leaves a hand-narrowed allow rule untouched", async () => {
  await withHome(async (home) => {
    const settingsPath = path.join(home, ".claude", "settings.json");
    await runInstallCli(home, ["--target=claude"]);

    const before = JSON.parse(await readFile(settingsPath, "utf8"));
    before.permissions.allow = ["Bash(local-board move *)"];
    await writeFile(settingsPath, `${JSON.stringify(before, null, 2)}\n`, "utf8");

    await runInstallCli(home, ["--target=claude", "--uninstall"]);
    const after = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.deepEqual(after.permissions.allow, ["Bash(local-board move *)"]);
  });
});

test("install --uninstall with no settings.json is a no-op: no file is created", async () => {
  await withHome(async (home) => {
    const settingsPath = path.join(home, ".claude", "settings.json");
    assert.equal(existsSync(settingsPath), false);

    const { stdout } = await runInstallCli(home, ["--target=claude", "--uninstall"]);
    assert.doesNotMatch(stdout, /removed Claude allow rule/);
    assert.equal(existsSync(settingsPath), false);
  });
});

test("install --uninstall with malformed settings.json is a no-op: file is left untouched byte-for-byte", async () => {
  await withHome(async (home) => {
    const settingsPath = path.join(home, ".claude", "settings.json");
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    const malformed = "{ this is not valid JSON ";
    await writeFile(settingsPath, malformed, "utf8");
    const before = await stat(settingsPath);

    const { stdout } = await runInstallCli(home, ["--target=claude", "--uninstall"]);
    assert.doesNotMatch(stdout, /removed Claude allow rule/);

    const afterContent = await readFile(settingsPath, "utf8");
    assert.equal(afterContent, malformed);
    const after = await stat(settingsPath);
    assert.equal(after.mtimeMs, before.mtimeMs);
  });
});

test("install --uninstall with settings.json containing unrelated rules but not ours performs no write", async () => {
  await withHome(async (home) => {
    const settingsPath = path.join(home, ".claude", "settings.json");
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    const untouched = { permissions: { allow: ["Bash(git status)"] } };
    const untouchedContent = `${JSON.stringify(untouched, null, 2)}\n`;
    await writeFile(settingsPath, untouchedContent, "utf8");
    const before = await stat(settingsPath);

    const { stdout } = await runInstallCli(home, ["--target=claude", "--uninstall"]);
    assert.doesNotMatch(stdout, /removed Claude allow rule/);

    const afterContent = await readFile(settingsPath, "utf8");
    assert.equal(afterContent, untouchedContent);
    const after = await stat(settingsPath);
    assert.equal(after.mtimeMs, before.mtimeMs);
  });
});

test("install --uninstall preserves unrelated allow entries and unrelated top-level settings keys", async () => {
  await withHome(async (home) => {
    const settingsPath = path.join(home, ".claude", "settings.json");
    await runInstallCli(home, ["--target=claude"]);

    const before = JSON.parse(await readFile(settingsPath, "utf8"));
    before.permissions.allow.push("Bash(git status)");
    before.someUserSetting = { keep: true };
    await writeFile(settingsPath, `${JSON.stringify(before, null, 2)}\n`, "utf8");

    await runInstallCli(home, ["--target=claude", "--uninstall"]);
    const after = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.deepEqual(after.permissions.allow, ["Bash(git status)"]);
    assert.deepEqual(after.someUserSetting, { keep: true });
  });
});

test("install --uninstall removes both the allow rule and wired hook entries in one pass", async () => {
  await withHome(async (home) => {
    const settingsPath = path.join(home, ".claude", "settings.json");
    await runInstallCli(home, ["--target=claude", "--hooks"]);

    await runInstallCli(home, ["--target=claude", "--uninstall"]);
    const after = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(after.hooks, undefined);
    assert.equal(after.permissions, undefined);
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

test("PATH verification failure (injected PATH miss, clone/git-checkout mode): guidance recommends npm link", async () => {
  await withHome(async (home) => {
    assert.throws(
      () =>
        runInstallInProcess(["--target=codex"], {
          home,
          resolvesOnPath: (command) => command !== "local-board",
        }),
      (error) => {
        assert.match(error.message, /local-board is not on PATH/);
        assert.match(error.message, /npm install -g \./);
        assert.match(error.message, /npm link/);
        return true;
      },
    );
  });
});

test("PATH verification failure (injected PATH miss, packaged/no-.git tree): guidance omits npm link", async () => {
  await withHome(async (home) => {
    const packagedDir = createPackagedCopy();
    try {
      assert.equal(existsSync(path.join(packagedDir, ".git")), false);
      const packaged = await import(
        pathToFileURL(path.join(packagedDir, "src", "install.js")).href
      );
      assert.throws(
        () =>
          packaged.runInstall(["--target=codex"], {
            home,
            resolvesOnPath: (command) => command !== "local-board",
          }),
        (error) => {
          assert.match(error.message, /local-board is not on PATH/);
          assert.match(error.message, /npm install -g local-board/);
          assert.doesNotMatch(error.message, /npm link/);
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

// ---------------------------------------------------------------------------
// Content hash + install --status (ticket T20260712T1415Z)
// ---------------------------------------------------------------------------

test("install-info.json carries a contentHash matching the sha256 shape and a per-target targets map", async () => {
  await withHome(async (home) => {
    await runInstallCli(home, ["--target=claude"]);
    const info = JSON.parse(await readFile(path.join(home, ".local-board", "install-info.json"), "utf8"));
    assert.match(info.contentHash, /^sha256:[0-9a-f]{64}$/);
    assert.ok(info.targets && typeof info.targets === "object");
    assert.match(info.targets.claude.contentHash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(info.targets.claude.contentHash, info.contentHash);
    assert.equal(typeof info.targets.claude.installedAt, "string");
  });
});

test("computePayloadHash is deterministic: two installs from the same source produce the same hash", async () => {
  await withHome(async (homeA) => {
    await withHome(async (homeB) => {
      await runInstallCli(homeA, ["--target=claude"]);
      await runInstallCli(homeB, ["--target=claude"]);
      const infoA = JSON.parse(await readFile(path.join(homeA, ".local-board", "install-info.json"), "utf8"));
      const infoB = JSON.parse(await readFile(path.join(homeB, ".local-board", "install-info.json"), "utf8"));
      assert.equal(infoA.contentHash, infoB.contentHash);
    });
  });
});

test("computePayloadHash is insensitive to CRLF vs LF line endings in a payload file", async () => {
  const packagedDir = createPackagedCopy();
  try {
    const before = computePayloadHash(packagedDir);
    const readmePath = path.join(packagedDir, "README.md");
    const original = await readFile(readmePath, "utf8");
    await writeFile(readmePath, original.replace(/\n/g, "\r\n"), "utf8");
    const after = computePayloadHash(packagedDir);
    assert.equal(before, after);
  } finally {
    await removeFixtureDir(packagedDir);
  }
});

test("computePayloadHash returns null on a flattened (non-source) layout", async () => {
  const flatRoot = await mkdtemp(path.join(os.tmpdir(), "local-board-flat-"));
  try {
    mkdirSync(path.join(flatRoot, "prompts"), { recursive: true });
    mkdirSync(path.join(flatRoot, "templates"), { recursive: true });
    assert.equal(isSourceLayout(flatRoot), false);
    assert.equal(computePayloadHash(flatRoot), null);
  } finally {
    await removeFixtureDir(flatRoot);
  }
});

test("writeInstallInfo merges: an unrelated pre-existing top-level key survives a re-install untouched", async () => {
  await withHome(async (home) => {
    await runInstallCli(home, ["--target=claude"]);
    const infoPath = path.join(home, ".local-board", "install-info.json");
    const before = JSON.parse(await readFile(infoPath, "utf8"));
    before.someFutureKey = { keep: true };
    await writeFile(infoPath, `${JSON.stringify(before, null, 2)}\n`, "utf8");

    await runInstallCli(home, ["--target=claude"]);
    const after = JSON.parse(await readFile(infoPath, "utf8"));
    assert.deepEqual(after.someFutureKey, { keep: true });
  });
});

test("install --status with nothing installed reports not-installed, exit 4", async () => {
  await withHome(async (home) => {
    const result = await runInstallCliExit(home, ["--status", "--json"]);
    assert.equal(result.code, 4);
    const report = JSON.parse(result.stdout);
    assert.equal(report.verdict, "not-installed");
    assert.deepEqual(report.targets, {});
  });
});

test("install --status on a fresh single-target install reports current, exit 0", async () => {
  await withHome(async (home) => {
    const packagedDir = createPackagedCopy();
    try {
      const packaged = await import(pathToFileURL(path.join(packagedDir, "src", "install.js")).href);
      const install = (argv) => packaged.runInstall(argv, { home, resolvesOnPath: () => true });

      assert.equal(install(["--target=claude"]), 0);
      const logs = captureConsoleLog(() => install(["--status", "--json"]));
      assert.equal(logs.code, 0);
      const report = JSON.parse(logs.lines.join("\n"));
      assert.equal(report.verdict, "current");
      assert.equal(report.targets.claude.verdict, "current");
    } finally {
      await removeFixtureDir(packagedDir);
    }
  });
});

test("install --status is indeterminate (exit 5) on the flattened runtime layout, never reporting a target current", async () => {
  await withHome(async (home) => {
    await runInstallCli(home, ["--target=claude"]);
    const flattened = await import(pathToFileURL(path.join(home, ".local-board", "src", "install.js")).href);

    const logs = captureConsoleLog(() =>
      flattened.runInstall(["--status", "--json"], { home, resolvesOnPath: () => true }),
    );
    assert.equal(logs.code, 5);
    const report = JSON.parse(logs.lines.join("\n"));
    assert.equal(report.verdict, "indeterminate");
    assert.equal(report.current.contentHash, null);
    assert.ok(Object.values(report.targets).every((target) => target.verdict !== "current"));
  });
});

test("install --status: multi-target staleness (install claude, mutate source, install --target=codex) reports claude skewed, codex current, global skewed/exit 3", async () => {
  await withHome(async (home) => {
    const packagedDir = createPackagedCopy();
    try {
      const packaged = await import(pathToFileURL(path.join(packagedDir, "src", "install.js")).href);
      const install = (argv) => packaged.runInstall(argv, { home, resolvesOnPath: () => true });

      assert.equal(install(["--target=claude"]), 0);

      const readmePath = path.join(packagedDir, "README.md");
      await writeFile(readmePath, `${await readFile(readmePath, "utf8")}\nmutated payload\n`, "utf8");

      assert.equal(install(["--target=codex"]), 0);

      const logs = captureConsoleLog(() => install(["--status", "--json"]));
      assert.equal(logs.code, 3);
      const report = JSON.parse(logs.lines.join("\n"));
      assert.equal(report.verdict, "skewed");
      assert.equal(report.targets.claude.verdict, "skewed");
      assert.equal(report.targets.codex.verdict, "current");
    } finally {
      await removeFixtureDir(packagedDir);
    }
  });
});

test("install --status: legacy pre-feature install-info.json migrates via footprint discovery (targets.claude seeded contentHash null), reports claude skewed / codex current / global skewed", async () => {
  await withHome(async (home) => {
    const packagedDir = createPackagedCopy();
    try {
      const packaged = await import(pathToFileURL(path.join(packagedDir, "src", "install.js")).href);
      const install = (argv) => packaged.runInstall(argv, { home, resolvesOnPath: () => true });

      const installDir = path.join(home, ".local-board");
      mkdirSync(installDir, { recursive: true });
      writeFileSync(
        path.join(installDir, "install-info.json"),
        `${JSON.stringify({ name: "local-board", installedAt: "2020-01-01T00:00:00.000Z", version: "0.1.0" }, null, 2)}\n`,
      );
      const claudeSkillDir = path.join(home, ".claude", "skills", "local-board");
      mkdirSync(claudeSkillDir, { recursive: true });
      writeFileSync(path.join(claudeSkillDir, "SKILL.md"), "legacy skill\n", "utf8");

      assert.equal(install(["--target=codex"]), 0);

      const logs = captureConsoleLog(() => install(["--status", "--json"]));
      assert.equal(logs.code, 3);
      const report = JSON.parse(logs.lines.join("\n"));
      assert.equal(report.verdict, "skewed");
      assert.equal(report.targets.claude.verdict, "skewed");
      assert.equal(report.targets.claude.contentHash, null);
      assert.equal(report.targets.claude.version, "0.1.0");
      assert.equal(report.targets.codex.verdict, "current");
    } finally {
      await removeFixtureDir(packagedDir);
    }
  });
});

test("install --status: footprint reconciliation discovers a legacy-directory-only install (no current skillDir) and reports it skewed", async () => {
  await withHome(async (home) => {
    const packagedDir = createPackagedCopy();
    try {
      const packaged = await import(pathToFileURL(path.join(packagedDir, "src", "install.js")).href);
      const install = (argv) => packaged.runInstall(argv, { home, resolvesOnPath: () => true });

      const legacyDir = path.join(home, ".claude", "skills", "local-board-orchestrator");
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(path.join(legacyDir, "SKILL.md"), "legacy\n", "utf8");

      const logs = captureConsoleLog(() => install(["--status", "--json"]));
      assert.equal(logs.code, 3);
      const report = JSON.parse(logs.lines.join("\n"));
      assert.equal(report.targets.claude.verdict, "skewed");
      assert.equal(report.targets.claude.contentHash, null);
    } finally {
      await removeFixtureDir(packagedDir);
    }
  });
});

test("install --status: footprint reconciliation discovers a team-only install (teamSkillDir with no current skillDir)", async () => {
  await withHome(async (home) => {
    const packagedDir = createPackagedCopy();
    try {
      const packaged = await import(pathToFileURL(path.join(packagedDir, "src", "install.js")).href);
      const install = (argv) => packaged.runInstall(argv, { home, resolvesOnPath: () => true });

      const teamDir = path.join(home, ".claude", "skills", "local-team");
      mkdirSync(teamDir, { recursive: true });
      writeFileSync(path.join(teamDir, "SKILL.md"), "team only\n", "utf8");

      const logs = captureConsoleLog(() => install(["--status", "--json"]));
      assert.equal(logs.code, 3);
      const report = JSON.parse(logs.lines.join("\n"));
      assert.equal(report.targets.claude.verdict, "skewed");
      assert.equal(report.targets.claude.contentHash, null);
    } finally {
      await removeFixtureDir(packagedDir);
    }
  });
});

test("install --status: a target whose directories were all deleted after being recorded is dropped from the reconciled map, never reported current", async () => {
  await withHome(async (home) => {
    const packagedDir = createPackagedCopy();
    try {
      const packaged = await import(pathToFileURL(path.join(packagedDir, "src", "install.js")).href);
      const install = (argv) => packaged.runInstall(argv, { home, resolvesOnPath: () => true });

      assert.equal(install(["--target=claude"]), 0);
      assert.equal(install(["--target=codex"]), 0);

      await removeFixtureDir(path.join(home, ".claude", "skills", "local-board"));
      await removeFixtureDir(path.join(home, ".claude", "skills", "local-team"));

      const logs = captureConsoleLog(() => install(["--status", "--json"]));
      const report = JSON.parse(logs.lines.join("\n"));
      assert.equal(report.targets.claude, undefined);
      assert.equal(report.targets.codex.verdict, "current");
      assert.equal(logs.code, 0);
    } finally {
      await removeFixtureDir(packagedDir);
    }
  });
});

test("install --status: install-info.json present but zero target footprints -> not-installed (never a vacuous current)", async () => {
  await withHome(async (home) => {
    const packagedDir = createPackagedCopy();
    try {
      const packaged = await import(pathToFileURL(path.join(packagedDir, "src", "install.js")).href);
      const install = (argv) => packaged.runInstall(argv, { home, resolvesOnPath: () => true });

      const installDir = path.join(home, ".local-board");
      mkdirSync(installDir, { recursive: true });
      writeFileSync(
        path.join(installDir, "install-info.json"),
        `${JSON.stringify(
          {
            name: "local-board",
            version: "1.0.0",
            contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            targets: {
              claude: {
                version: "1.0.0",
                contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                installedAt: "2020-01-01T00:00:00.000Z",
              },
            },
          },
          null,
          2,
        )}\n`,
      );

      const logs = captureConsoleLog(() => install(["--status", "--json"]));
      assert.equal(logs.code, 4);
      const report = JSON.parse(logs.lines.join("\n"));
      assert.equal(report.verdict, "not-installed");
      assert.deepEqual(report.targets, {});
    } finally {
      await removeFixtureDir(packagedDir);
    }
  });
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
