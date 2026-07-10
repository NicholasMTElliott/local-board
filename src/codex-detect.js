import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { codexTaskRoutedActions } from "./config.js";

// Detection only — this module never installs or manages codex-task. It
// deliberately imports only node:os/node:fs/node:path plus
// codexTaskRoutedActions from config.js: the PATH probe and the harness
// target list are injected by callers (cli.js / install.js), so there is no
// codex-detect.js <-> install.js import cycle and the fs/PATH seams stay
// trivially stubbable in unit tests.

// For each target from the injected buildTargets(home), derive the harness
// skills root as dirname(target.skillDir) (e.g.
// <home>/.claude/skills/local-board -> <home>/.claude/skills) and test for
// <skillsRoot>/codex-task/SKILL.md. Any one hit counts as installed (a
// shared codex login/skill serves all harnesses). Requiring the SKILL.md
// file (not just the codex-task/ directory) avoids a false positive on an
// empty dir. Never throws; returns false on any error (fail-open).
export function codexTaskSkillInstalled(home, buildTargets) {
  try {
    const targets = buildTargets(home);
    for (const target of targets) {
      if (!target || typeof target.skillDir !== "string") {
        continue;
      }
      const skillsRoot = dirname(target.skillDir);
      if (existsSync(join(skillsRoot, "codex-task", "SKILL.md"))) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// Fail-open orchestrator: returns a single-line WARNING string when the
// config routes at least one action to codex-task and a codex-task
// prerequisite is missing, otherwise null. Never throws — probe errors
// (unreadable dirs, spawn failures) degrade to null/warning, never a crash.
export function codexTaskWarning(config, { home = homedir(), resolvesOnPath, buildTargets } = {}) {
  try {
    const actions = codexTaskRoutedActions(config);
    if (actions.length === 0) {
      // Zero cost for the common (no codex-task routes) case: no PATH probe.
      return null;
    }

    let codexOnPath = false;
    try {
      codexOnPath = Boolean(resolvesOnPath("codex"));
    } catch {
      codexOnPath = false;
    }

    const skillInstalled = codexTaskSkillInstalled(home, buildTargets);

    const missing = [];
    if (!codexOnPath) {
      missing.push("`codex` CLI not found on PATH");
    }
    if (!skillInstalled) {
      missing.push("codex-task skill not installed in any harness skills dir");
    }
    if (missing.length === 0) {
      return null;
    }

    return (
      `WARNING: config routes ${actions.join(", ")} to codex-task, but ${missing.join("; ")}. ` +
      "Install the codex-task skill and run `codex login`, or reroute these actions to another agent. " +
      "local-board detects codex-task; it does not install or manage it."
    );
  } catch {
    return null;
  }
}
