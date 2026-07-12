import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { currentBranch, gitOk, gitOutput, gitRawOutput, gitRun, resolveDefaultBranch } from "./git.js";
import { isInstallablePath } from "./install.js";
import { findTicket } from "./tickets.js";

// Single-owner idempotence marker: points at the most recent bump commit
// (auto or manual). "Already processed" is tested by ANCESTRY
// (`git merge-base --is-ancestor <tip> <marker>`), never by equality or
// commit-subject matching — see the ticket's Technical Design, Decision 1.
export const VERSION_BUMP_MARKER_REF = "refs/local-board/version-bump-head";

// Same character class as tickets.js's TICKET_ID_RE (`^[ESBT]\d{8}T\d{4}Z$`),
// so B/S/E merges (present in this repo's history) are matched, not just T.
// NOT derived from TICKET_ID_RE at module-load time: tickets.js imports
// worktrees.js (ticketWorktreeMintOffsetMinutes), and worktrees.js imports
// this module (runVersionBump) — a live top-level read of TICKET_ID_RE here
// would hit that import cycle's temporal-dead-zone. test/version-bump.test.js
// asserts this pattern's character class stays in lockstep with TICKET_ID_RE.
export const MERGE_SUBJECT_RE = /^Merge\s+([ESBT]\d{8}T\d{4}Z)\b/;

const LEVEL_RANK = { patch: 0, minor: 1, major: 2 };
const BUMP_COMMIT_SUBJECT_PREFIX = "chore: bump version";

export function mapBumpLevel(ticketType) {
  if (ticketType === "bug") return "patch";
  if (ticketType === "task" || ticketType === "story") return "minor";
  if (ticketType === "epic") return "major";
  return null;
}

// Reduces a set of levels (nulls/undefined ignored) to the highest-ranked
// one. Empty/all-null input reduces to "patch" — a payload change always
// advances at least a patch; it never skips a bump entirely.
export function maxLevel(levels) {
  let best = "patch";
  for (const level of levels ?? []) {
    if (level !== null && level !== undefined && LEVEL_RANK[level] > LEVEL_RANK[best]) {
      best = level;
    }
  }
  return best;
}

export function nextVersion(current, level) {
  const parts = String(current).split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    throw new Error(`invalid semver version: ${current}`);
  }
  let [major, minor, patch] = parts;
  if (level === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (level === "minor") {
    minor += 1;
    patch = 0;
  } else if (level === "patch") {
    patch += 1;
  } else {
    throw new Error(`invalid bump level: ${level}`);
  }
  return `${major}.${minor}.${patch}`;
}

// Pure trigger + level decision, given a pre-computed changed-paths list and
// per-merge levels: no-op when nothing installable changed; otherwise the
// max of the given levels (see maxLevel).
export function selectBump({ changedPaths, levels }) {
  const changed = (changedPaths ?? []).some((changedPath) => isInstallablePath(changedPath));
  if (!changed) {
    return { bump: false, level: null };
  }
  return { bump: true, level: maxLevel(levels) };
}

// Shared range/dirty/commit/marker contract, reused verbatim by both
// fastForwardDefaultBranch and the manual `version-bump` CLI command. Both
// callers normally omit `range`, letting it resolve internally: marker ->
// last bump commit -> root, tip = current HEAD. An explicit `range` is
// accepted for the manual command's targeted one-off `--range` use only.
// See the ticket's Technical Design, Decisions 1, 2, and 5.
//
// `options`: { range?: { previousHead, newHead }, level?, config, now? }.
// `config` is a loaded local-board config (config.git.autoVersionBump,
// config.git.defaultBranch).
//
// Returns { bumped, from, to, level, reason }, reason one of:
// bumped | not-enabled | not-advanced | no-payload-change | not-on-default |
// dirty-package-json | already-bumped.
export async function runVersionBump(root, options = {}) {
  const config = options.config ?? null;
  const forcedLevel = options.level ?? null;

  if (config?.git?.autoVersionBump !== true) {
    return noop("not-enabled");
  }

  const defaultBranch = await resolveDefaultBranch(root, config.git.defaultBranch ?? null);
  const current = await currentBranch(root);
  if (current !== defaultBranch) {
    return noop("not-on-default");
  }

  const marker = await readVersionBumpMarker(root);
  const range = options.range ?? null;
  const tip = range !== null ? range.newHead : await gitOutput(root, ["rev-parse", "HEAD"]);

  if (marker !== null && (await gitOk(root, ["merge-base", "--is-ancestor", tip, marker]))) {
    return noop("already-bumped");
  }

  let base;
  if (range !== null) {
    base = range.previousHead;
  } else if (marker !== null) {
    base = marker;
  } else {
    base = (await lastBumpCommit(root, defaultBranch)) ?? (await rootCommit(root, tip));
  }

  if (base === tip) {
    return noop("not-advanced");
  }

  const changedPaths = await changedPathsBetween(root, base, tip);
  if (!changedPaths.some((changedPath) => isInstallablePath(changedPath))) {
    return noop("no-payload-change");
  }

  const level = forcedLevel ?? maxLevel(await levelsFromMergeSubjects(root, base, tip));

  if (await isPackageJsonDirty(root)) {
    return { bumped: false, from: null, to: null, level, reason: "dirty-package-json" };
  }

  const pkgPath = path.join(root, "package.json");
  const originalText = await readFile(pkgPath, "utf8");
  const pkg = JSON.parse(originalText);
  const from = pkg.version;
  const to = nextVersion(from, level);
  const updatedText = originalText.replace(/("version"\s*:\s*")[^"]*(")/, `$1${to}$2`);

  await writeFile(pkgPath, updatedText, "utf8");
  try {
    await gitRun(root, ["add", "--", "package.json"]);
    await gitRun(root, ["commit", "-m", `${BUMP_COMMIT_SUBJECT_PREFIX} ${to}`, "--", "package.json"]);
  } catch (error) {
    await writeFile(pkgPath, originalText, "utf8");
    await gitRun(root, ["reset", "--", "package.json"]).catch(() => {});
    throw error;
  }

  const bumpCommit = await gitOutput(root, ["rev-parse", "HEAD"]);
  await advanceVersionBumpMarker(root, bumpCommit, marker ?? "");

  return { bumped: true, from, to, level, reason: "bumped" };
}

function noop(reason) {
  return { bumped: false, from: null, to: null, level: null, reason };
}

export async function readVersionBumpMarker(root) {
  try {
    return await gitOutput(root, ["rev-parse", "--verify", VERSION_BUMP_MARKER_REF]);
  } catch {
    return null;
  }
}

// Single shared compare-and-swap owner for the marker ref: `oldValue === ""`
// asserts the ref does not yet exist (first write); any other value asserts
// the ref currently holds exactly that value. A concurrent mover fails this
// call (git update-ref rejects the CAS), which propagates as a thrown error.
export async function advanceVersionBumpMarker(root, newValue, oldValue) {
  await gitRun(root, ["update-ref", VERSION_BUMP_MARKER_REF, newValue, oldValue ?? ""]);
}

async function isPackageJsonDirty(root) {
  const status = await gitRawOutput(root, ["status", "--porcelain", "--", "package.json"]);
  return status.trim() !== "";
}

async function changedPathsBetween(root, base, tip) {
  const output = await gitRawOutput(root, ["diff", "--name-only", base, tip]);
  return output.split(/\r?\n/).filter((line) => line !== "");
}

async function levelsFromMergeSubjects(root, base, tip) {
  const output = await gitRawOutput(root, ["log", "--merges", "--format=%s", `${base}..${tip}`]);
  const subjects = output.split(/\r?\n/).filter((line) => line !== "");
  const levels = [];
  for (const subject of subjects) {
    const match = subject.match(MERGE_SUBJECT_RE);
    if (!match) {
      continue;
    }
    try {
      const { ticket } = await findTicket(root, match[1]);
      const level = mapBumpLevel(ticket.frontMatter.type);
      if (level !== null) {
        levels.push(level);
      }
    } catch {
      // Unresolved ticket id contributes nothing; maxLevel's empty-input
      // default (patch) applies if nothing else resolves.
    }
  }
  return levels;
}

// Most recent commit on `branch` whose subject starts with the bump-commit
// prefix, or null if none exists. Used only as the no-marker fresh-clone
// fallback base (never for the already-bumped decision, which is ancestry-
// against-the-marker only, so a coincidentally-similar subject on an
// unrelated commit cannot suppress a real bump).
async function lastBumpCommit(root, branch) {
  const output = await gitRawOutput(root, ["log", "--format=%H%x09%s", branch]);
  for (const line of output.split(/\r?\n/)) {
    if (line === "") {
      continue;
    }
    const tabIndex = line.indexOf("\t");
    const hash = tabIndex === -1 ? line : line.slice(0, tabIndex);
    const subject = tabIndex === -1 ? "" : line.slice(tabIndex + 1);
    if (subject.startsWith(BUMP_COMMIT_SUBJECT_PREFIX)) {
      return hash;
    }
  }
  return null;
}

async function rootCommit(root, tip) {
  const output = await gitRawOutput(root, ["rev-list", "--max-parents=0", tip]);
  const lines = output.split(/\r?\n/).filter((line) => line !== "");
  return lines[0] ?? tip;
}
