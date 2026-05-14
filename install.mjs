#!/usr/bin/env node

import { execSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
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
    skillDir: join(HOME, ".claude", "skills", "local-board-orchestrator"),
    settingsPath: join(HOME, ".claude", "settings.json"),
    detectPath: join(HOME, ".claude"),
    defaultOn: true,
  },
  {
    id: "opencode",
    label: "opencode",
    skillDir: join(HOME, ".config", "opencode", "skills", "local-board-orchestrator"),
    settingsPath: null,
    detectPath: join(HOME, ".config", "opencode"),
    defaultOn: false,
  },
  {
    id: "cline",
    label: "Cline",
    skillDir: join(HOME, ".cline", "skills", "local-board-orchestrator"),
    settingsPath: null,
    detectPath: join(HOME, ".cline"),
    defaultOn: false,
  },
  {
    id: "cursor",
    label: "Cursor",
    skillDir: join(HOME, ".cursor", "skills", "local-board-orchestrator"),
    settingsPath: null,
    detectPath: join(HOME, ".cursor"),
    defaultOn: false,
  },
  {
    id: "agents",
    label: "Agents (cross-harness)",
    skillDir: join(HOME, ".agents", "skills", "local-board-orchestrator"),
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
  copyDir("bin");
  copyDir("src");
  copyDir(join("plans", "prompts"), "prompts");
  copyDir(join("plans", "templates"), "templates");

  const scriptPath = join(INSTALL_DIR, "bin", "local-board.js").replace(/\\/g, "/");
  const renderedSkill = readFileSync(join(SCRIPT_DIR, "SKILL.md"), "utf8")
    .replace(/<<INSTALL_PATH>>/g, () => INSTALL_DIR.replace(/\\/g, "/"))
    .replace(/<<SCRIPT_PATH>>/g, () => scriptPath);
  const allowRule = `Bash(node ${scriptPath} *)`;

  console.log(`local-board installer`);
  console.log(`node ${nodeVersion}`);
  console.log(`installed runtime at ${INSTALL_DIR}`);

  for (const target of targets) {
    mkdirSync(target.skillDir, { recursive: true });
    writeFileSync(join(target.skillDir, "SKILL.md"), renderedSkill);
    console.log(`installed skill for ${target.label}: ${target.skillDir}`);
    if (target.settingsPath !== null) {
      patchSettings(target.settingsPath, allowRule);
    }
  }
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
    console.log(`${target.id}\t${target.label}\t${state}\t${policy}\t${target.skillDir}`);
  }
}

function printHelp() {
  console.log(`local-board installer

Usage:
  node install.mjs
  node install.mjs --target=claude,opencode,cline,cursor
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
