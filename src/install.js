import { execSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Package root (directory holding package.json, bin/, src/, agents/, skills/,
// resources/). This module lives at <root>/src/install.js, so the root is one
// level up from this file's directory.
const SCRIPT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

export function buildTargets(home) {
  return [
    {
      id: "claude",
      label: "Claude Code",
      skillDir: join(home, ".claude", "skills", "local-board"),
      legacySkillDirs: [join(home, ".claude", "skills", "local-board-orchestrator")],
      teamSkillDir: join(home, ".claude", "skills", "local-team"),
      legacyTeamSkillDirs: [join(home, ".claude", "skills", "local-board-team")],
      settingsPath: join(home, ".claude", "settings.json"),
      detectPath: join(home, ".claude"),
      defaultOn: true,
    },
    {
      id: "codex",
      label: "Codex",
      skillDir: join(home, ".codex", "skills", "local-board"),
      legacySkillDirs: [],
      teamSkillDir: join(home, ".codex", "skills", "local-team"),
      legacyTeamSkillDirs: [],
      settingsPath: null,
      detectPath: join(home, ".codex"),
      defaultOn: false,
      skillTemplate: join("skills", "codex", "local-board"),
      teamSkillTemplate: join("skills", "codex", "local-team"),
    },
    {
      id: "opencode",
      label: "opencode",
      skillDir: join(home, ".config", "opencode", "skills", "local-board"),
      legacySkillDirs: [join(home, ".config", "opencode", "skills", "local-board-orchestrator")],
      teamSkillDir: join(home, ".config", "opencode", "skills", "local-team"),
      legacyTeamSkillDirs: [join(home, ".config", "opencode", "skills", "local-board-team")],
      settingsPath: null,
      detectPath: join(home, ".config", "opencode"),
      defaultOn: false,
    },
    {
      id: "cline",
      label: "Cline",
      skillDir: join(home, ".cline", "skills", "local-board"),
      legacySkillDirs: [join(home, ".cline", "skills", "local-board-orchestrator")],
      teamSkillDir: join(home, ".cline", "skills", "local-team"),
      legacyTeamSkillDirs: [join(home, ".cline", "skills", "local-board-team")],
      settingsPath: null,
      detectPath: join(home, ".cline"),
      defaultOn: false,
    },
    {
      id: "cursor",
      label: "Cursor",
      skillDir: join(home, ".cursor", "skills", "local-board"),
      legacySkillDirs: [join(home, ".cursor", "skills", "local-board-orchestrator")],
      teamSkillDir: join(home, ".cursor", "skills", "local-team"),
      legacyTeamSkillDirs: [join(home, ".cursor", "skills", "local-board-team")],
      settingsPath: null,
      detectPath: join(home, ".cursor"),
      defaultOn: false,
    },
    {
      id: "agents",
      label: "Agents (cross-harness)",
      skillDir: join(home, ".agents", "skills", "local-board"),
      legacySkillDirs: [join(home, ".agents", "skills", "local-board-orchestrator")],
      teamSkillDir: join(home, ".agents", "skills", "local-team"),
      legacyTeamSkillDirs: [join(home, ".agents", "skills", "local-board-team")],
      settingsPath: null,
      detectPath: join(home, ".agents"),
      defaultOn: false,
      explicitOnly: true,
    },
  ];
}

/**
 * Run the local-board installer. Returns a numeric exit code (0 on success).
 * Errors propagate (throw) rather than calling process.exit, so callers
 * (the CLI dispatcher or the install.mjs shim) control process exit
 * behaviour.
 *
 * `options.resolvesOnPath`, when supplied, overrides the real PATH-resolution
 * check (a `(command: string) => boolean` predicate). This is a test seam for
 * exercising the PATH-verification failure/success paths in-process without
 * mutating the real process PATH.
 */
export function runInstall(argv, options = {}) {
  const home = options.home ?? homedir();
  const installDir = join(home, ".local-board");
  const targets = buildTargets(home);
  const knownIds = new Set(targets.map((target) => target.id));
  const args = parseArgs(argv, knownIds);

  if (args.help) {
    printHelp();
    return 0;
  }
  if (args.listTargets) {
    listTargets(targets);
    return 0;
  }
  if (args.uninstall) {
    performUninstall(targets, home, installDir);
    return 0;
  }
  performInstall(args, targets, home, installDir, options);
  return 0;
}

function performInstall(args, targets, home, installDir, options = {}) {
  const nodeVersion = getVersion("node");
  if (nodeVersion === null) {
    throw new Error("node not found on PATH");
  }

  const selected = resolveTargets(args, targets);
  if (selected.length === 0) {
    throw new Error("no install targets selected");
  }
  const hooksEnabled = args.hooks === true;

  const checkResolvesOnPath = options.resolvesOnPath ?? resolvesOnPath;
  const fromClone = existsSync(join(SCRIPT_DIR, ".git"));
  if (!checkResolvesOnPath("local-board")) {
    throw new Error(
      fromClone
        ? "local-board is not on PATH. From this checkout run: npm install -g . (or: npm link), then re-run local-board install."
        : "local-board is not on PATH. Install it globally: npm install -g local-board, then re-run local-board install.",
    );
  }

  mkdirSync(installDir, { recursive: true });
  copyFileSync(join(SCRIPT_DIR, "package.json"), join(installDir, "package.json"));
  copyFileSync(join(SCRIPT_DIR, "README.md"), join(installDir, "README.md"));
  copyFileSync(join(SCRIPT_DIR, "SKILL.md"), join(installDir, "SKILL.md"));
  if (existsSync(join(SCRIPT_DIR, "SKILL_TEAM.md"))) {
    copyFileSync(join(SCRIPT_DIR, "SKILL_TEAM.md"), join(installDir, "SKILL_TEAM.md"));
  }
  copyDir("bin", "bin", installDir);
  copyDir("src", "src", installDir);
  copyDir("agents", "agents", installDir);
  copyDir("skills", "skills", installDir);
  copyDir("hooks", "hooks", installDir);
  copyDir(join("resources", "prompts"), "prompts", installDir);
  copyDir(join("resources", "templates"), "templates", installDir);

  const scriptPath = join(installDir, "bin", "local-board.js").replace(/\\/g, "/");
  const allowRule = "Bash(local-board *)";
  writeInstallInfo(installDir, {
    nodeVersion,
    scriptPath,
    teamSkillInstalled: existsSync(join(SCRIPT_DIR, "SKILL_TEAM.md")),
  });

  console.log(`local-board installer`);
  console.log(`node ${nodeVersion}`);
  console.log(`installed runtime at ${installDir}`);

  for (const target of selected) {
    const skillTemplate = resolveSkillTemplate(target, "skillTemplate", "SKILL.md");
    const teamSkillTemplate = resolveSkillTemplate(target, "teamSkillTemplate", "SKILL_TEAM.md");
    installRenderedSkillDir(skillTemplate, target.skillDir, scriptPath, installDir);
    console.log(`installed skill for ${target.label}: ${target.skillDir}`);
    if (teamSkillTemplate !== null && target.teamSkillDir) {
      installRenderedSkillDir(teamSkillTemplate, target.teamSkillDir, scriptPath, installDir);
      console.log(`installed team skill for ${target.label}: ${target.teamSkillDir}`);
    }
    removeLegacyDirs(target, "legacySkillDirs", target.skillDir, "skill");
    removeLegacyDirs(target, "legacyTeamSkillDirs", target.teamSkillDir, "team skill");
    if (target.id === "claude") {
      installClaudeAgents(home);
    }
    if (target.settingsPath !== null) {
      patchSettings(target.settingsPath, allowRule);
      if (hooksEnabled) {
        patchHooks(target.settingsPath, installDir);
      } else if (args.hooks === false) {
        patchHooks(target.settingsPath, installDir, { remove: true });
      }
    }
  }

  if (!hooksEnabled && selected.some((target) => target.settingsPath !== null)) {
    console.log(`Run 'local-board install --hooks' to enable Claude Code dispatch-enforcement hooks`);
  }
}

function resolveSkillTemplate(target, field, fallbackFile) {
  if (target[field]) {
    const source = join(SCRIPT_DIR, target[field]);
    if (!existsSync(source)) {
      throw new Error(`${target.id} ${field} not found: ${source}`);
    }
    return source;
  }
  const fallback = join(SCRIPT_DIR, fallbackFile);
  return existsSync(fallback) ? fallback : null;
}

function installRenderedSkillDir(source, targetDir, scriptPath, installDir) {
  if (source === null) {
    return;
  }
  mkdirSync(targetDir, { recursive: true });
  if (existsSync(join(source, "SKILL.md"))) {
    cpSync(source, targetDir, { recursive: true, force: true });
    renderFilesInPlace(targetDir, scriptPath, installDir);
  } else {
    writeFileSync(join(targetDir, "SKILL.md"), renderSkill(source, scriptPath, installDir));
  }
}

function renderFilesInPlace(dir, scriptPath, installDir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      renderFilesInPlace(entryPath, scriptPath, installDir);
    } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))) {
      writeFileSync(entryPath, renderSkill(entryPath, scriptPath, installDir));
    }
  }
}

function removeLegacyDirs(target, field, currentDir, label) {
  const dirs = target[field];
  if (!Array.isArray(dirs)) {
    return;
  }
  for (const legacyDir of dirs) {
    if (legacyDir === currentDir) {
      continue;
    }
    if (existsSync(legacyDir)) {
      rmSync(legacyDir, { recursive: true, force: true });
      console.log(`removed legacy ${label} for ${target.label}: ${legacyDir}`);
    }
  }
}

function renderSkill(sourcePath, scriptPath, installDir) {
  return readFileSync(sourcePath, "utf8")
    .replace(/<<INSTALL_PATH>>/g, () => installDir.replace(/\\/g, "/"))
    .replace(/<<SCRIPT_PATH>>/g, () => scriptPath);
}

function writeInstallInfo(installDir, { nodeVersion, scriptPath, teamSkillInstalled }) {
  writeFileSync(
    join(installDir, "install-info.json"),
    `${JSON.stringify(
      {
        name: "local-board",
        installedAt: new Date().toISOString(),
        installDir,
        scriptPath,
        nodeVersion,
        skillName: "local-board",
        teamSkillName: teamSkillInstalled ? "local-team" : null,
        claudeAgents: claudeAgentNames(),
      },
      null,
      2,
    )}\n`,
  );
}

function installClaudeAgents(home) {
  const sourceDir = join(SCRIPT_DIR, "agents", "claude");
  const targetDir = join(home, ".claude", "agents");
  if (!existsSync(sourceDir)) {
    return;
  }
  mkdirSync(targetDir, { recursive: true });
  for (const fileName of readdirSync(sourceDir)) {
    if (!fileName.endsWith(".md")) {
      continue;
    }
    const targetPath = join(targetDir, fileName);
    copyFileSync(join(sourceDir, fileName), targetPath);
    console.log(`installed Claude agent: ${targetPath}`);
  }
}

function claudeAgentNames() {
  const sourceDir = join(SCRIPT_DIR, "agents", "claude");
  if (!existsSync(sourceDir)) {
    return [];
  }
  return readdirSync(sourceDir)
    .filter((fileName) => fileName.endsWith(".md"))
    .map((fileName) => fileName.slice(0, -".md".length))
    .sort();
}

function performUninstall(targets, home, installDir) {
  if (existsSync(installDir)) {
    rmSync(installDir, { recursive: true, force: true });
    console.log(`removed ${installDir}`);
  }
  for (const target of targets) {
    if (existsSync(target.skillDir)) {
      rmSync(target.skillDir, { recursive: true, force: true });
      console.log(`removed ${target.skillDir}`);
    }
    if (target.teamSkillDir && existsSync(target.teamSkillDir)) {
      rmSync(target.teamSkillDir, { recursive: true, force: true });
      console.log(`removed ${target.teamSkillDir}`);
    }
    removeLegacyDirs(target, "legacySkillDirs", target.skillDir, "skill");
    removeLegacyDirs(target, "legacyTeamSkillDirs", target.teamSkillDir, "team skill");
    if (target.settingsPath !== null && existsSync(target.settingsPath)) {
      patchHooks(target.settingsPath, installDir, { remove: true });
    }
  }
  uninstallClaudeAgents(home);
}

function uninstallClaudeAgents(home) {
  const targetDir = join(home, ".claude", "agents");
  if (!existsSync(targetDir)) {
    return;
  }
  for (const agentName of claudeAgentNames()) {
    const agentPath = join(targetDir, `${agentName}.md`);
    if (existsSync(agentPath)) {
      rmSync(agentPath, { force: true });
      console.log(`removed ${agentPath}`);
    }
  }
}

function copyDir(sourceRelative, targetRelative, installDir) {
  const source = join(SCRIPT_DIR, sourceRelative);
  if (!existsSync(source)) {
    return;
  }
  cpSync(source, join(installDir, targetRelative), { recursive: true, force: true });
}

function parseArgs(argv, knownIds) {
  const parsed = {
    all: false,
    explicit: null,
    excludes: new Set(),
    help: false,
    listTargets: false,
    uninstall: false,
    hooks: undefined,
  };

  for (const arg of argv) {
    if (arg === "--all") parsed.all = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--list-targets") parsed.listTargets = true;
    else if (arg === "--uninstall") parsed.uninstall = true;
    else if (arg === "--hooks") parsed.hooks = true;
    else if (arg === "--no-hooks") parsed.hooks = false;
    else if (arg.startsWith("--target=")) {
      parsed.explicit = new Set(arg.slice("--target=".length).split(",").filter(Boolean));
      for (const id of parsed.explicit) {
        if (!knownIds.has(id)) {
          throw new Error(`unknown target: ${id}`);
        }
      }
    } else if (arg.startsWith("--no-")) {
      const id = arg.slice("--no-".length);
      if (!knownIds.has(id)) {
        throw new Error(`unknown target: ${id}`);
      }
      parsed.excludes.add(id);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function resolveTargets(args, targets) {
  let selected;
  if (args.explicit !== null) {
    selected = targets.filter((target) => args.explicit.has(target.id));
  } else if (args.all) {
    selected = [...targets];
  } else {
    selected = targets.filter((target) => !target.explicitOnly && (target.defaultOn || existsSync(target.detectPath)));
  }
  return selected.filter((target) => !args.excludes.has(target.id));
}

function listTargets(targets) {
  for (const target of targets) {
    const state = existsSync(target.detectPath) ? "detected" : "not detected";
    const policy = target.explicitOnly ? "explicit-only" : target.defaultOn ? "default-on" : "detect-only";
    const teamPath = target.teamSkillDir ?? "(no team skill)";
    console.log(`${target.id}\t${target.label}\t${state}\t${policy}\t${target.skillDir}\t${teamPath}`);
  }
}

function printHelp() {
  console.log(`local-board installer

Usage:
  node install.mjs
  node install.mjs --target=claude,codex,opencode,cline,cursor
  node install.mjs --all
  node install.mjs --no-opencode
  node install.mjs --hooks
  node install.mjs --no-hooks
  node install.mjs --list-targets
  node install.mjs --uninstall

--hooks installs Claude Code dispatch-enforcement hooks (dispatch ledger,
routing validator, evidence gate, approve-inline consent) into the Claude
target's settings.json. Off by default; --no-hooks removes them.`);
}

function patchSettings(settingsPath, allowRule) {
  let settings = {};
  if (existsSync(settingsPath)) {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  }
  if (typeof settings !== "object" || settings === null) {
    throw new Error(`${settingsPath} is not a JSON object`);
  }
  settings.permissions ??= {};
  settings.permissions.allow = Array.isArray(settings.permissions.allow) ? settings.permissions.allow : [];
  if (!settings.permissions.allow.includes(allowRule)) {
    settings.permissions.allow.push(allowRule);
    mkdirSync(dirname(settingsPath), { recursive: true });
    const tmpPath = `${settingsPath}.tmp-${process.pid}`;
    writeFileSync(tmpPath, `${JSON.stringify(settings, null, 2)}\n`);
    renameSync(tmpPath, settingsPath);
    console.log(`added Claude allow rule to ${settingsPath}`);
  }
}

// Managed Claude Code hook entries. `matcher` "Task|Agent" covers both the
// current and (per Claude Code release notes) possibly-renamed subagent
// dispatch tool name -- see T20260707T1326Z's open question. `evidence-gate`
// and `approve-inline-consent` share the `Bash` matcher but are registered as
// two separate hook commands under it (not merged into one script) so a crash
// in one cannot disable the other.
const HOOK_SPECS = [
  { event: "PreToolUse", matcher: "Task|Agent", script: "routing-validator.js" },
  { event: "PreToolUse", matcher: "Bash", script: "evidence-gate.js" },
  { event: "PreToolUse", matcher: "Bash", script: "approve-inline-consent.js" },
  { event: "PostToolUse", matcher: "Task|Agent", script: "dispatch-ledger.js" },
];

function hookCommand(installDir, script) {
  const scriptPath = join(installDir, "hooks", script).replace(/\\/g, "/");
  // Quoted so an install dir under a home directory containing spaces (e.g.
  // "C:\\Users\\Jane Doe\\.local-board") still shells out correctly. Both the
  // add path (patchHooks) and the remove path (uninstall) call this same
  // function to build the command they match against, so idempotency and
  // removal stay consistent with the quoted form.
  return `node "${scriptPath}"`;
}

// Idempotent, dedup-by-exact-command-string patcher for `settings.hooks`,
// mirroring `patchSettings`'s atomic tmp+rename write. `remove: true` deletes
// only the managed command entries (and prunes now-empty matcher groups /
// event arrays), leaving any user-authored hooks untouched.
function patchHooks(settingsPath, installDir, { remove = false } = {}) {
  let settings = {};
  if (existsSync(settingsPath)) {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  }
  if (typeof settings !== "object" || settings === null) {
    throw new Error(`${settingsPath} is not a JSON object`);
  }

  settings.hooks ??= {};
  let changed = false;

  for (const spec of HOOK_SPECS) {
    const command = hookCommand(installDir, spec.script);
    settings.hooks[spec.event] = Array.isArray(settings.hooks[spec.event]) ? settings.hooks[spec.event] : [];
    const events = settings.hooks[spec.event];
    const group = events.find((entry) => entry && entry.matcher === spec.matcher);

    if (remove) {
      if (group && Array.isArray(group.hooks)) {
        const before = group.hooks.length;
        group.hooks = group.hooks.filter((hook) => hook?.command !== command);
        if (group.hooks.length !== before) {
          changed = true;
        }
      }
      continue;
    }

    if (!group) {
      events.push({ matcher: spec.matcher, hooks: [{ type: "command", command }] });
      changed = true;
      continue;
    }
    group.hooks = Array.isArray(group.hooks) ? group.hooks : [];
    if (!group.hooks.some((hook) => hook?.command === command)) {
      group.hooks.push({ type: "command", command });
      changed = true;
    }
  }

  // Prune matcher groups left with no hooks, then event arrays left empty.
  for (const event of Object.keys(settings.hooks)) {
    if (!Array.isArray(settings.hooks[event])) {
      continue;
    }
    const before = settings.hooks[event].length;
    settings.hooks[event] = settings.hooks[event].filter((entry) => Array.isArray(entry?.hooks) && entry.hooks.length > 0);
    if (settings.hooks[event].length !== before) {
      changed = true;
    }
    if (settings.hooks[event].length === 0) {
      delete settings.hooks[event];
    }
  }
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  if (changed) {
    mkdirSync(dirname(settingsPath), { recursive: true });
    const tmpPath = `${settingsPath}.tmp-${process.pid}`;
    writeFileSync(tmpPath, `${JSON.stringify(settings, null, 2)}\n`);
    renameSync(tmpPath, settingsPath);
    console.log(`${remove ? "removed" : "added"} Claude Code dispatch-enforcement hooks in ${settingsPath}`);
  }
}

function getVersion(command) {
  try {
    return execSync(`${command} --version`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

function resolvesOnPath(command) {
  const resolver = process.platform === "win32" ? "where" : "command -v";
  try {
    execSync(`${resolver} ${command}`, { stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}
