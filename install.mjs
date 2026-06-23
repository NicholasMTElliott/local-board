#!/usr/bin/env node

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

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const HOME = homedir();
const INSTALL_DIR = join(HOME, ".local-board");

const TARGETS = [
  {
    id: "claude",
    label: "Claude Code",
    skillDir: join(HOME, ".claude", "skills", "local-board"),
    legacySkillDirs: [join(HOME, ".claude", "skills", "local-board-orchestrator")],
    teamSkillDir: join(HOME, ".claude", "skills", "local-team"),
    legacyTeamSkillDirs: [join(HOME, ".claude", "skills", "local-board-team")],
    settingsPath: join(HOME, ".claude", "settings.json"),
    detectPath: join(HOME, ".claude"),
    defaultOn: true,
  },
  {
    id: "codex",
    label: "Codex",
    skillDir: join(HOME, ".codex", "skills", "local-board"),
    legacySkillDirs: [],
    teamSkillDir: join(HOME, ".codex", "skills", "local-team"),
    legacyTeamSkillDirs: [],
    settingsPath: null,
    detectPath: join(HOME, ".codex"),
    defaultOn: false,
    skillTemplate: join("skills", "codex", "local-board"),
    teamSkillTemplate: join("skills", "codex", "local-team"),
  },
  {
    id: "opencode",
    label: "opencode",
    skillDir: join(HOME, ".config", "opencode", "skills", "local-board"),
    legacySkillDirs: [join(HOME, ".config", "opencode", "skills", "local-board-orchestrator")],
    teamSkillDir: join(HOME, ".config", "opencode", "skills", "local-team"),
    legacyTeamSkillDirs: [join(HOME, ".config", "opencode", "skills", "local-board-team")],
    settingsPath: null,
    detectPath: join(HOME, ".config", "opencode"),
    defaultOn: false,
  },
  {
    id: "cline",
    label: "Cline",
    skillDir: join(HOME, ".cline", "skills", "local-board"),
    legacySkillDirs: [join(HOME, ".cline", "skills", "local-board-orchestrator")],
    teamSkillDir: join(HOME, ".cline", "skills", "local-team"),
    legacyTeamSkillDirs: [join(HOME, ".cline", "skills", "local-board-team")],
    settingsPath: null,
    detectPath: join(HOME, ".cline"),
    defaultOn: false,
  },
  {
    id: "cursor",
    label: "Cursor",
    skillDir: join(HOME, ".cursor", "skills", "local-board"),
    legacySkillDirs: [join(HOME, ".cursor", "skills", "local-board-orchestrator")],
    teamSkillDir: join(HOME, ".cursor", "skills", "local-team"),
    legacyTeamSkillDirs: [join(HOME, ".cursor", "skills", "local-board-team")],
    settingsPath: null,
    detectPath: join(HOME, ".cursor"),
    defaultOn: false,
  },
  {
    id: "agents",
    label: "Agents (cross-harness)",
    skillDir: join(HOME, ".agents", "skills", "local-board"),
    legacySkillDirs: [join(HOME, ".agents", "skills", "local-board-orchestrator")],
    teamSkillDir: join(HOME, ".agents", "skills", "local-team"),
    legacyTeamSkillDirs: [join(HOME, ".agents", "skills", "local-board-team")],
    settingsPath: null,
    detectPath: join(HOME, ".agents"),
    defaultOn: false,
    explicitOnly: true,
  },
];

const KNOWN_IDS = new Set(TARGETS.map((target) => target.id));
const args = parseArgs(process.argv.slice(2));

try {
  if (args.help) {
    printHelp();
  } else if (args.listTargets) {
    listTargets();
  } else if (args.uninstall) {
    uninstall();
  } else {
    install();
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}

function install() {
  const nodeVersion = getVersion("node");
  if (nodeVersion === null) {
    throw new Error("node not found on PATH");
  }

  const targets = resolveTargets();
  if (targets.length === 0) {
    throw new Error("no install targets selected");
  }

  mkdirSync(INSTALL_DIR, { recursive: true });
  copyFileSync(join(SCRIPT_DIR, "package.json"), join(INSTALL_DIR, "package.json"));
  copyFileSync(join(SCRIPT_DIR, "README.md"), join(INSTALL_DIR, "README.md"));
  copyFileSync(join(SCRIPT_DIR, "SKILL.md"), join(INSTALL_DIR, "SKILL.md"));
  if (existsSync(join(SCRIPT_DIR, "SKILL_TEAM.md"))) {
    copyFileSync(join(SCRIPT_DIR, "SKILL_TEAM.md"), join(INSTALL_DIR, "SKILL_TEAM.md"));
  }
  copyDir("bin");
  copyDir("src");
  copyDir("agents");
  copyDir("skills");
  copyDir(join("plans", "prompts"), "prompts");
  copyDir(join("plans", "templates"), "templates");

  const scriptPath = join(INSTALL_DIR, "bin", "local-board.js").replace(/\\/g, "/");
  const allowRule = `Bash(node ${scriptPath} *)`;
  writeInstallInfo({ nodeVersion, scriptPath, teamSkillInstalled: existsSync(join(SCRIPT_DIR, "SKILL_TEAM.md")) });

  console.log(`local-board installer`);
  console.log(`node ${nodeVersion}`);
  console.log(`installed runtime at ${INSTALL_DIR}`);

  for (const target of targets) {
    const skillTemplate = resolveSkillTemplate(target, "skillTemplate", "SKILL.md");
    const teamSkillTemplate = resolveSkillTemplate(target, "teamSkillTemplate", "SKILL_TEAM.md");
    installRenderedSkillDir(skillTemplate, target.skillDir, scriptPath);
    console.log(`installed skill for ${target.label}: ${target.skillDir}`);
    if (teamSkillTemplate !== null && target.teamSkillDir) {
      installRenderedSkillDir(teamSkillTemplate, target.teamSkillDir, scriptPath);
      console.log(`installed team skill for ${target.label}: ${target.teamSkillDir}`);
    }
    removeLegacyDirs(target, "legacySkillDirs", target.skillDir, "skill");
    removeLegacyDirs(target, "legacyTeamSkillDirs", target.teamSkillDir, "team skill");
    if (target.id === "claude") {
      installClaudeAgents();
    }
    if (target.settingsPath !== null) {
      patchSettings(target.settingsPath, allowRule);
    }
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

function installRenderedSkillDir(source, targetDir, scriptPath) {
  if (source === null) {
    return;
  }
  mkdirSync(targetDir, { recursive: true });
  if (existsSync(join(source, "SKILL.md"))) {
    cpSync(source, targetDir, { recursive: true, force: true });
    renderFilesInPlace(targetDir, scriptPath);
  } else {
    writeFileSync(join(targetDir, "SKILL.md"), renderSkill(source, scriptPath));
  }
}

function renderFilesInPlace(dir, scriptPath) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      renderFilesInPlace(entryPath, scriptPath);
    } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))) {
      writeFileSync(entryPath, renderSkill(entryPath, scriptPath));
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

function renderSkill(sourcePath, scriptPath) {
  return readFileSync(sourcePath, "utf8")
    .replace(/<<INSTALL_PATH>>/g, () => INSTALL_DIR.replace(/\\/g, "/"))
    .replace(/<<SCRIPT_PATH>>/g, () => scriptPath);
}

function writeInstallInfo({ nodeVersion, scriptPath, teamSkillInstalled }) {
  writeFileSync(
    join(INSTALL_DIR, "install-info.json"),
    `${JSON.stringify(
      {
        name: "local-board",
        installedAt: new Date().toISOString(),
        installDir: INSTALL_DIR,
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

function installClaudeAgents() {
  const sourceDir = join(SCRIPT_DIR, "agents", "claude");
  const targetDir = join(HOME, ".claude", "agents");
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

function uninstall() {
  if (existsSync(INSTALL_DIR)) {
    rmSync(INSTALL_DIR, { recursive: true, force: true });
    console.log(`removed ${INSTALL_DIR}`);
  }
  for (const target of TARGETS) {
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
  }
  uninstallClaudeAgents();
}

function uninstallClaudeAgents() {
  const targetDir = join(HOME, ".claude", "agents");
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

function copyDir(sourceRelative, targetRelative = sourceRelative) {
  const source = join(SCRIPT_DIR, sourceRelative);
  if (!existsSync(source)) {
    return;
  }
  cpSync(source, join(INSTALL_DIR, targetRelative), { recursive: true, force: true });
}

function parseArgs(argv) {
  const parsed = {
    all: false,
    explicit: null,
    excludes: new Set(),
    help: false,
    listTargets: false,
    uninstall: false,
  };

  for (const arg of argv) {
    if (arg === "--all") parsed.all = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--list-targets") parsed.listTargets = true;
    else if (arg === "--uninstall") parsed.uninstall = true;
    else if (arg.startsWith("--target=")) {
      parsed.explicit = new Set(arg.slice("--target=".length).split(",").filter(Boolean));
      for (const id of parsed.explicit) {
        if (!KNOWN_IDS.has(id)) {
          throw new Error(`unknown target: ${id}`);
        }
      }
    } else if (arg.startsWith("--no-")) {
      const id = arg.slice("--no-".length);
      if (!KNOWN_IDS.has(id)) {
        throw new Error(`unknown target: ${id}`);
      }
      parsed.excludes.add(id);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function resolveTargets() {
  let selected;
  if (args.explicit !== null) {
    selected = TARGETS.filter((target) => args.explicit.has(target.id));
  } else if (args.all) {
    selected = [...TARGETS];
  } else {
    selected = TARGETS.filter((target) => !target.explicitOnly && (target.defaultOn || existsSync(target.detectPath)));
  }
  return selected.filter((target) => !args.excludes.has(target.id));
}

function listTargets() {
  for (const target of TARGETS) {
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
  node install.mjs --list-targets
  node install.mjs --uninstall`);
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

function getVersion(command) {
  try {
    return execSync(`${command} --version`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}
