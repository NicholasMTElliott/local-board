import { createHash } from "node:crypto";
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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { codexTaskWarning } from "./codex-detect.js";
import { parseJsonc } from "./config.js";

// Package root (directory holding package.json, bin/, src/, agents/, skills/,
// resources/). This module lives at <root>/src/install.js, so the root is one
// level up from this file's directory.
const SCRIPT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

// The SINGLE definition of the installer's copy set. It drives (a) what
// performInstall copies into the runtime install dir, (b) what
// collectPayloadEntries/computePayloadHash hash, and (c) what
// isInstallablePath treats as a version-bump trigger — one spec, three
// consumers, so they can never drift apart (ticket T20260712T1415Z Decision
// 3). `source` is always POSIX-style and repo-root-relative; `target`
// (dir entries only) is the renamed install-dir-relative path (currently only
// resources/prompts -> prompts and resources/templates -> templates) and does
// NOT affect the hash, which keys on `source`. `install.mjs` is deliberately
// NOT a member: the installer does not copy it, so it is not installable for
// bump/hash purposes (a change to the 9-line shim alone never bumps).
export const PAYLOAD_SPEC = [
  { type: "file", source: "package.json" },
  { type: "file", source: "README.md" },
  { type: "file", source: "SKILL.md" },
  { type: "file", source: "SKILL_TEAM.md", optional: true },
  { type: "dir", source: "bin" },
  { type: "dir", source: "src" },
  { type: "dir", source: "agents" },
  { type: "dir", source: "skills" },
  { type: "dir", source: "hooks" },
  { type: "dir", source: "resources/prompts", target: "prompts" },
  { type: "dir", source: "resources/templates", target: "templates" },
];

// True when `root` is a SOURCE layout (has resources/prompts) as opposed to a
// flattened runtime snapshot (~/.local-board, which has prompts/ directly and
// no resources/ at all — T20260707T1322Z). computePayloadHash is defined only
// over the source layout; both sides of every comparison in this codebase use
// a source layout (see Decision 3 in the ticket's Technical Design).
export function isSourceLayout(root) {
  return existsSync(join(root, "resources", "prompts"));
}

// Enumerates every file the installer copies (and therefore hashes),
// expanding PAYLOAD_SPEC dir entries recursively. relPath is `source`-relative
// (POSIX separators), NOT the renamed `target` path, and entries are sorted
// by relPath for deterministic hash input ordering. Missing entries (optional
// files not present, or a dir absent in a stripped/packaged tree) contribute
// nothing, mirroring performInstall's own existsSync-gated copy behaviour.
export function collectPayloadEntries(root) {
  const entries = [];
  for (const spec of PAYLOAD_SPEC) {
    const absSource = join(root, ...spec.source.split("/"));
    if (!existsSync(absSource)) {
      continue;
    }
    if (spec.type === "file") {
      entries.push({ relPath: spec.source, absPath: absSource });
    } else {
      collectDirEntries(absSource, spec.source, entries);
    }
  }
  entries.sort((left, right) => (left.relPath < right.relPath ? -1 : left.relPath > right.relPath ? 1 : 0));
  return entries;
}

function collectDirEntries(absDir, relPrefix, entries) {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const absPath = join(absDir, entry.name);
    const relPath = `${relPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      collectDirEntries(absPath, relPath, entries);
    } else if (entry.isFile()) {
      entries.push({ relPath, absPath });
    }
  }
}

// Deterministic SHA-256 over the payload the installer copies from `root`:
// source-layout-only (null on a flattened runtime snapshot — see
// isSourceLayout), sorted POSIX-relPath order, CRLF-normalized content so the
// digest is stable across OS/checkout line-ending representations (the same
// hazard sync-resources.mjs's normalizeEol already handles). Each entry
// contributes `relPath + "\0" + normalize(content) + "\0"` to the digest.
export function computePayloadHash(root) {
  if (!isSourceLayout(root)) {
    return null;
  }
  const hash = createHash("sha256");
  for (const entry of collectPayloadEntries(root)) {
    const normalized = readFileSync(entry.absPath, "utf8").replace(/\r\n/g, "\n");
    hash.update(`${entry.relPath}\0${normalized}\0`);
  }
  return `sha256:${hash.digest("hex")}`;
}

// True when a repo-root-relative relPath (either separator style) falls
// under any PAYLOAD_SPEC source root. The single shared definition of
// "installable" for the copy set, the hash set, and the version-bump trigger
// set (src/version-bump.js imports this) — see Decision 3.
export function isInstallablePath(relPath) {
  const normalized = relPath.replace(/\\/g, "/");
  return PAYLOAD_SPEC.some((spec) => normalized === spec.source || normalized.startsWith(`${spec.source}/`));
}

// The single Claude permission rule the installer manages. Uninstall removes
// an entry from permissions.allow ONLY when it equals this string, so a
// user-narrowed/renamed rule is never silently deleted.
const CLAUDE_ALLOW_RULE = "Bash(local-board *)";

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
 *
 * `options.cwd`, when supplied, overrides `process.cwd()` for the post-install
 * codex-task hint's project-config lookup (`<cwd>/plans/local-board.config.jsonc`).
 * Test-only seam so in-process installer tests can point the lookup at a temp
 * project dir without `chdir`.
 */
export function runInstall(argv, options = {}) {
  // ids are home-independent (only path fields vary by home), so target ids
  // can be enumerated before home is resolved.
  const knownIds = new Set(buildTargets(".").map((target) => target.id));
  const args = parseArgs(argv, knownIds);
  const home = resolveHome(args, options);
  const installDir = join(home, ".local-board");
  const targets = buildTargets(home);
  const homeOverridden = args.home !== null || Object.hasOwn(options, "home");

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
  if (args.status) {
    return performStatus(args, home, installDir);
  }
  performInstall(args, targets, home, installDir, options, homeOverridden);
  return 0;
}

// Resolution order: explicit `options.home === undefined` (fail closed) >
// `--home`/`args.home` (CLI flag) > `options.home` (programmatic override) >
// guard-refusal (LOCAL_BOARD_INSTALL_REQUIRE_HOME=1, no override) >
// os.homedir() (default). See the ticket's Technical Design (D2/D3) for the
// rationale behind this order and the guard env choice.
function resolveHome(args, options) {
  // 1. Explicit programmatic undefined is always a bug -> fail closed.
  if (Object.hasOwn(options, "home") && options.home === undefined) {
    throw new Error(
      "runInstall: options.home was provided but is undefined; pass a directory or omit the key",
    );
  }
  // 2. CLI/argv flag wins. Validated non-empty (same rule as options.home)
  // and resolved to an absolute path so a relative value resolves against
  // the invoker's cwd rather than silently mutating whatever directory the
  // process happens to be running in.
  if (args.home !== null) {
    if (args.home.trim() === "") {
      throw new Error("--home requires a non-empty value");
    }
    return resolve(args.home);
  }
  // 3. Programmatic override (defined; validated non-empty string).
  if (Object.hasOwn(options, "home")) {
    if (typeof options.home !== "string" || options.home.trim() === "") {
      throw new Error("runInstall: options.home must be a non-empty string");
    }
    return options.home;
  }
  // 4. No override. Under the guard, refuse to touch the real home.
  if (process.env.LOCAL_BOARD_INSTALL_REQUIRE_HOME === "1") {
    throw new Error(
      "refusing to run against the real home directory: " +
        "LOCAL_BOARD_INSTALL_REQUIRE_HOME=1 is set and no --home/options.home override was supplied",
    );
  }
  // 5. Default: the real home.
  return homedir();
}

function performInstall(args, targets, home, installDir, options = {}, homeOverridden = false) {
  const nodeVersion = getVersion("node");
  if (nodeVersion === null) {
    throw new Error("node not found on PATH");
  }
  const version = JSON.parse(readFileSync(join(SCRIPT_DIR, "package.json"), "utf8")).version;

  const selected = resolveTargets(args, targets);
  if (selected.length === 0) {
    throw new Error("no install targets selected");
  }
  const hooksEnabled = args.hooks === true;

  const checkResolvesOnPath = options.resolvesOnPath ?? (homeOverridden ? () => true : resolvesOnPath);
  const fromClone = existsSync(join(SCRIPT_DIR, ".git"));
  if (!checkResolvesOnPath("local-board")) {
    throw new Error(
      fromClone
        ? "local-board is not on PATH. From this checkout run: npm install -g . (or: npm link), then re-run local-board install."
        : "local-board is not on PATH. Install it globally: npm install -g local-board, then re-run local-board install.",
    );
  }

  // Read + reconcile BEFORE any of this run's copies/writes land, so the
  // footprint check reflects the world as it stood prior to this install (a
  // target being freshly installed this run has no footprint yet here, and
  // is added explicitly below once its directories actually exist — see
  // Decision 4 in the ticket's Technical Design).
  const existingInfo = readExistingInstallInfo(installDir);
  const baseTargets = reconcileTargets(existingInfo, home);

  mkdirSync(installDir, { recursive: true });
  for (const spec of PAYLOAD_SPEC) {
    const target = spec.target ?? spec.source;
    const absSource = join(SCRIPT_DIR, ...spec.source.split("/"));
    if (spec.type === "file") {
      // Optional files (SKILL_TEAM.md) are skipped when absent, matching the
      // pre-refactor behaviour; required files copy unconditionally and throw
      // naturally (ENOENT) if genuinely missing from the package.
      if (spec.optional && !existsSync(absSource)) {
        continue;
      }
      copyFileSync(absSource, join(installDir, target));
    } else if (existsSync(absSource)) {
      // Dirs are skipped silently when absent (a stripped/packaged tree may
      // omit e.g. hooks/), matching the pre-refactor copyDir behaviour.
      cpSync(absSource, join(installDir, target), { recursive: true, force: true });
    }
  }

  const scriptPath = join(installDir, "bin", "local-board.js").replace(/\\/g, "/");

  console.log(`local-board installer`);
  console.log(`node ${nodeVersion}`);
  console.log(`installed runtime at ${installDir}`);

  for (const target of selected) {
    const skillTemplate = resolveSkillTemplate(target, "skillTemplate", "SKILL.md");
    const teamSkillTemplate = resolveSkillTemplate(target, "teamSkillTemplate", "SKILL_TEAM.md");
    installRenderedSkillDir(skillTemplate, target.skillDir, scriptPath, version);
    console.log(`installed skill for ${target.label}: ${target.skillDir}`);
    if (teamSkillTemplate !== null && target.teamSkillDir) {
      installRenderedSkillDir(teamSkillTemplate, target.teamSkillDir, scriptPath, version);
      console.log(`installed team skill for ${target.label}: ${target.teamSkillDir}`);
    }
    removeLegacyDirs(target, "legacySkillDirs", target.skillDir, "skill");
    removeLegacyDirs(target, "legacyTeamSkillDirs", target.teamSkillDir, "team skill");
    if (target.id === "claude") {
      installClaudeAgents(home);
    }
    if (target.settingsPath !== null) {
      patchSettings(target.settingsPath, CLAUDE_ALLOW_RULE);
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

  // Hash is computed against this run's own source (SCRIPT_DIR, always a
  // source layout), not the just-written flattened installDir snapshot — see
  // isSourceLayout/computePayloadHash. The just-installed targets' entries are
  // overwritten with fresh info unconditionally (their dirs now exist, so
  // they are in the footprint set); every other reconciled target's stored
  // entry is carried through unchanged (Decision 4, step 4).
  const contentHash = computePayloadHash(SCRIPT_DIR);
  const now = new Date().toISOString();
  const finalTargets = { ...baseTargets };
  for (const target of selected) {
    finalTargets[target.id] = { version, contentHash, installedAt: now };
  }
  writeInstallInfo(installDir, {
    existingInfo,
    nodeVersion,
    version,
    scriptPath,
    teamSkillInstalled: existsSync(join(SCRIPT_DIR, "SKILL_TEAM.md")),
    contentHash,
    targets: finalTargets,
    now,
  });

  // Detection-only, informational codex-task hint. Only after a claude-target
  // install; best-effort against the project config in cwd (a config that
  // does not exist, is unreadable, or is malformed silently skips the hint —
  // this is not a project-required config, just a courtesy check).
  if (selected.some((target) => target.id === "claude")) {
    const cwd = options.cwd ?? process.cwd();
    const cfg = readCwdConfigForHint(cwd);
    if (cfg) {
      const warning = codexTaskWarning(cfg, { home, resolvesOnPath: checkResolvesOnPath, buildTargets });
      if (warning) {
        console.log(warning);
      }
    }
  }
}

// Sync, best-effort read of the project config in cwd for the install-time
// codex-task hint. Returns null (no config in cwd, unreadable, or malformed)
// rather than throwing -- install must never fail because of this hint. The
// raw parsed object is passed straight to codexTaskWarning; codexTaskRoutedActions
// already tolerates the raw route-string / { route } shape, so no
// merge/normalize against DEFAULT_CONFIG is needed here.
function readCwdConfigForHint(cwd) {
  try {
    const configPath = join(cwd, "plans", "local-board.config.jsonc");
    return parseJsonc(readFileSync(configPath, "utf8"));
  } catch {
    return null;
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

function installRenderedSkillDir(source, targetDir, scriptPath, version) {
  if (source === null) {
    return;
  }
  mkdirSync(targetDir, { recursive: true });
  if (existsSync(join(source, "SKILL.md"))) {
    cpSync(source, targetDir, { recursive: true, force: true });
    renderFilesInPlace(targetDir, scriptPath, version);
  } else {
    writeFileSync(join(targetDir, "SKILL.md"), renderSkill(source, scriptPath, version));
  }
}

function renderFilesInPlace(dir, scriptPath, version) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      renderFilesInPlace(entryPath, scriptPath, version);
    } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))) {
      writeFileSync(entryPath, renderSkill(entryPath, scriptPath, version));
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

function renderSkill(sourcePath, scriptPath, version) {
  return readFileSync(sourcePath, "utf8")
    .replace(/<<SCRIPT_PATH>>/g, () => scriptPath)
    .replace(/<<VERSION>>/g, () => version);
}

// Reads install-info.json if present and parsable; returns null on ENOENT
// or malformed JSON (never throws) so a first install, or a corrupt file,
// both degrade to "no prior info" rather than failing the install.
function readExistingInstallInfo(installDir) {
  const infoPath = join(installDir, "install-info.json");
  if (!existsSync(infoPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(infoPath, "utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

// Footprint-driven target reconciliation, shared by the install-write path
// (performInstall, via writeInstallInfo's `targets` argument) and the
// install-status read path (performStatus) — Decision 4 in the ticket's
// Technical Design. A target is included ONLY when it has a footprint: any
// of its current-or-legacy skill/team directories exists on disk right now
// (buildTargets legacy dirs included, not just the current skillDir/
// teamSkillDir — r3's fix for legacy-dir-only and team-only installs going
// undiscovered). Every entry is re-validated against disk on EVERY call, so a
// deleted target's stale stored hash is dropped, never reported `current`.
// A target with a footprint but no stored `existingInfo.targets` entry
// (a pre-feature/legacy install-info.json, or a target that has never been
// separately tracked) is seeded with `contentHash: null` — UNKNOWN, never
// `current` — carrying forward only the top-level legacy `version`/
// `installedAt` as a courtesy, never a hash (a null hash never compares equal
// to a current hash, so a legacy record can never read as vacuously current).
export function reconcileTargets(existingInfo, home) {
  const targets = buildTargets(home);
  const existingTargets =
    existingInfo && typeof existingInfo === "object" && typeof existingInfo.targets === "object" && existingInfo.targets !== null
      ? existingInfo.targets
      : null;

  const result = {};
  for (const target of targets) {
    const footprintDirs = [
      target.skillDir,
      target.teamSkillDir,
      ...(Array.isArray(target.legacySkillDirs) ? target.legacySkillDirs : []),
      ...(Array.isArray(target.legacyTeamSkillDirs) ? target.legacyTeamSkillDirs : []),
    ].filter((dir) => typeof dir === "string" && dir !== "");
    const hasFootprint = footprintDirs.some((dir) => existsSync(dir));
    if (!hasFootprint) {
      continue;
    }
    if (existingTargets && existingTargets[target.id] && typeof existingTargets[target.id] === "object") {
      result[target.id] = { ...existingTargets[target.id] };
    } else {
      result[target.id] = {
        version: existingInfo?.version ?? null,
        contentHash: null,
        installedAt: existingInfo?.installedAt ?? null,
      };
    }
  }
  return result;
}

// Merges (never overwrites) install-info.json: unknown existing top-level
// keys survive untouched; the well-known keys below are always refreshed to
// this install's values; `contentHash` and `targets` are additive
// (Decision 4). `targets` is the caller-computed per-target map (reconciled
// base plus this run's freshly-installed target entries).
function writeInstallInfo(installDir, { existingInfo, nodeVersion, version, scriptPath, teamSkillInstalled, contentHash, targets, now }) {
  writeFileSync(
    join(installDir, "install-info.json"),
    `${JSON.stringify(
      {
        ...(existingInfo ?? {}),
        name: "local-board",
        installedAt: now,
        installDir,
        scriptPath,
        nodeVersion,
        version,
        skillName: "local-board",
        teamSkillName: teamSkillInstalled ? "local-team" : null,
        claudeAgents: claudeAgentNames(),
        contentHash,
        targets,
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
      unpatchSettings(target.settingsPath, CLAUDE_ALLOW_RULE);
      patchHooks(target.settingsPath, installDir, { remove: true });
    }
  }
  uninstallClaudeAgents(home);
}

// `local-board install --status [--json]`: recomputes the current source's
// payload hash (SCRIPT_DIR — the running CLI's own root, always a source
// layout for an on-PATH CLI), reconciles stored per-target info against disk
// footprint (reconcileTargets, shared with the install-write path), and
// derives a per-target then a worst-of global verdict. Exit codes: 0 current,
// 3 skewed, 4 not-installed, 5 indeterminate (current hash is null — not a
// source layout); 2 stays reserved for usage/parse errors. --json always
// prints the report regardless of exit code (Decision 5).
function performStatus(args, home, installDir) {
  const currentHash = computePayloadHash(SCRIPT_DIR);
  const currentVersion = JSON.parse(readFileSync(join(SCRIPT_DIR, "package.json"), "utf8")).version;
  const existingInfo = readExistingInstallInfo(installDir);
  const reconciled = reconcileTargets(existingInfo, home);
  const targetIds = Object.keys(reconciled).sort();

  let verdict;
  let exitCode;
  if (targetIds.length === 0) {
    verdict = "not-installed";
    exitCode = 4;
  } else if (currentHash === null) {
    verdict = "indeterminate";
    exitCode = 5;
  } else {
    const anySkewed = targetIds.some((id) => reconciled[id].contentHash !== currentHash);
    verdict = anySkewed ? "skewed" : "current";
    exitCode = anySkewed ? 3 : 0;
  }

  const targetsReport = {};
  for (const id of targetIds) {
    const entry = reconciled[id];
    const isCurrent = currentHash !== null && entry.contentHash === currentHash;
    targetsReport[id] = {
      version: entry.version,
      contentHash: entry.contentHash,
      installedAt: entry.installedAt,
      verdict: isCurrent ? "current" : "skewed",
    };
  }

  const report = {
    verdict,
    skewed: verdict === "skewed",
    current: { version: currentVersion, contentHash: currentHash },
    targets: targetsReport,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`verdict: ${report.verdict}`);
    console.log(`current version: ${report.current.version} contentHash: ${report.current.contentHash}`);
    for (const id of targetIds) {
      const target = targetsReport[id];
      console.log(`${id}: ${target.verdict} version: ${target.version} contentHash: ${target.contentHash}`);
    }
    if (verdict === "indeterminate") {
      console.log("cannot determine current payload hash: not a source layout");
    }
    if (verdict === "not-installed") {
      console.log("not installed: no target has a current or legacy install footprint");
    }
  }

  return exitCode;
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

function parseArgs(argv, knownIds) {
  const parsed = {
    all: false,
    explicit: null,
    excludes: new Set(),
    help: false,
    listTargets: false,
    uninstall: false,
    status: false,
    json: false,
    hooks: undefined,
    home: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--all") parsed.all = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--list-targets") parsed.listTargets = true;
    else if (arg === "--uninstall") parsed.uninstall = true;
    else if (arg === "--status") parsed.status = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--hooks") parsed.hooks = true;
    else if (arg === "--no-hooks") parsed.hooks = false;
    else if (arg === "--home") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--home requires a value");
      }
      parsed.home = value;
      i += 1;
    } else if (arg.startsWith("--target=")) {
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
  node install.mjs --home <dir>
  node install.mjs --status [--json]

--hooks installs Claude Code dispatch-enforcement hooks (dispatch ledger,
routing validator, evidence gate, approve-inline consent) into the Claude
target's settings.json. Off by default; --no-hooks removes them.

--home <dir> installs (or uninstalls) under <dir> instead of the real home
directory (os.homedir()). This is the supported sandbox/testing seam; it also
skips the on-PATH precheck, since a relocated home has no PATH expectation.
<dir> must be non-empty; a relative <dir> is resolved against the current
directory, not against the installer's own location.

--status recomputes a content hash over the current package's payload and
compares it to the hash recorded at install time for each target, reporting
current/skewed/not-installed/indeterminate. Exit codes: 0 current, 3 skewed,
4 not-installed, 5 indeterminate.`);
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

// Symmetric counterpart to patchSettings: removes exactly the managed allow
// rule from permissions.allow. No-op when the file is absent, when it is not
// parsable/well-formed JSON, when permissions/allow are missing or
// non-arrays, or when the rule is not present. Matches by exact string
// equality against the managed constant, so a user-edited rule (e.g.
// "Bash(local-board move *)") is left untouched. Preserves every other allow
// entry and does not touch permissions.deny, hooks, or any other key. Prunes
// an emptied allow array and an emptied permissions object, matching
// patchHooks's prune-when-empty behavior.
function unpatchSettings(settingsPath, allowRule) {
  if (!existsSync(settingsPath)) {
    return;
  }
  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    return;
  }
  if (typeof settings !== "object" || settings === null) {
    return;
  }
  const allow = settings.permissions?.allow;
  if (!Array.isArray(allow) || !allow.includes(allowRule)) {
    return;
  }
  settings.permissions.allow = allow.filter((rule) => rule !== allowRule);
  if (settings.permissions.allow.length === 0) {
    delete settings.permissions.allow;
  }
  if (settings.permissions && Object.keys(settings.permissions).length === 0) {
    delete settings.permissions;
  }
  mkdirSync(dirname(settingsPath), { recursive: true });
  const tmpPath = `${settingsPath}.tmp-${process.pid}`;
  writeFileSync(tmpPath, `${JSON.stringify(settings, null, 2)}\n`);
  renameSync(tmpPath, settingsPath);
  console.log(`removed Claude allow rule from ${settingsPath}`);
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

function hookScriptPath(installDir, script) {
  return join(installDir, "hooks", script).replace(/\\/g, "/");
}

function hookCommand(installDir, script) {
  // Quoted so an install dir under a home directory containing spaces (e.g.
  // "C:\\Users\\Jane Doe\\.local-board") still shells out correctly. Both the
  // add path (patchHooks) and the remove path (uninstall) call this same
  // function to build the command they write, but *matching* an existing
  // entry against this exact string is unsafe -- see isManagedHookCommand.
  return `node "${hookScriptPath(installDir, script)}"`;
}

// Extracts the path token from a `node <path>` hook command, stripping a
// single layer of surrounding quotes (single or double) if present. Returns
// null for commands that aren't `node`-prefixed (e.g. user-authored hooks).
function extractHookCommandPath(command) {
  if (typeof command !== "string") {
    return null;
  }
  const match = command.match(/^node\s+(.*)$/);
  if (!match) {
    return null;
  }
  let token = match[1].trim();
  if (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      token = token.slice(1, -1);
    }
  }
  return token;
}

// Recognizes a managed hook entry by its underlying script path rather than
// by exact command string, so entries written by the pre-rework unquoted
// form (`node <path>`, no quotes) are still recognized as managed after the
// quoting fix -- avoiding duplicate entries on reinstall and stranded
// entries on uninstall.
function isManagedHookCommand(command, scriptPath) {
  return extractHookCommandPath(command) === scriptPath;
}

// Idempotent patcher for `settings.hooks`, mirroring `patchSettings`'s atomic
// tmp+rename write. Managed entries are matched by script path (see
// isManagedHookCommand), not exact command string, so entries from either
// quoting era are recognized. `remove: true` deletes every managed match
// (and prunes now-empty matcher groups / event arrays), leaving any
// user-authored hooks untouched.
function patchHooks(settingsPath, installDir, { remove = false } = {}) {
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch (error) {
      // On the remove path (uninstall), an unparsable settings.json is left
      // untouched -- symmetric with unpatchSettings's no-op behavior. On the
      // add path (install --hooks), a malformed settings file is a real
      // problem the user must fix, so it still throws.
      if (remove) {
        return;
      }
      throw error;
    }
  }
  if (typeof settings !== "object" || settings === null) {
    if (remove) {
      return;
    }
    throw new Error(`${settingsPath} is not a JSON object`);
  }

  settings.hooks ??= {};
  let changed = false;

  for (const spec of HOOK_SPECS) {
    const scriptPath = hookScriptPath(installDir, spec.script);
    const command = hookCommand(installDir, spec.script);
    settings.hooks[spec.event] = Array.isArray(settings.hooks[spec.event]) ? settings.hooks[spec.event] : [];
    const events = settings.hooks[spec.event];
    const group = events.find((entry) => entry && entry.matcher === spec.matcher);

    if (remove) {
      if (group && Array.isArray(group.hooks)) {
        const before = group.hooks.length;
        group.hooks = group.hooks.filter((hook) => !isManagedHookCommand(hook?.command, scriptPath));
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
    const managedMatches = group.hooks.filter((hook) => isManagedHookCommand(hook?.command, scriptPath));
    const alreadyCanonical = managedMatches.length === 1 && managedMatches[0].command === command;
    if (!alreadyCanonical) {
      // Dedupe every managed match for this script (whatever quoting era it
      // came from) down to exactly one, refreshed to the current command form.
      group.hooks = group.hooks.filter((hook) => !isManagedHookCommand(hook?.command, scriptPath));
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

export function resolvesOnPath(command) {
  const resolver = process.platform === "win32" ? "where" : "command -v";
  try {
    execSync(`${resolver} ${command}`, { stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}
