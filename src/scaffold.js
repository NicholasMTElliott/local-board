import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defaultConfigJsonc } from "./config.js";

// Package root (directory holding package.json, resources/, src/, ...). This
// module lives at <root>/src/scaffold.js, so the root is one level up from
// this file's directory. Mirrors the same pattern in src/install.js.
const SCRIPT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const TICKET_FOLDERS = ["backlog", "ready", "active", "questions", "blocked", "review", "done", "archive"];

const GITIGNORE_WORKTREE_ENTRY = ".worktrees/";
const GITIGNORE_LOCAL_BOARD_ENTRY = ".local-board/";
const GITIGNORE_TEMPLATE = `# local-board ticket worktrees (see plans/local-board.config.jsonc: worktrees.location).
# Only used by the "inside" layout, but seeded regardless of the chosen layout so
# switching to it later never needs a manual .gitignore edit.
${GITIGNORE_WORKTREE_ENTRY}

# local-board per-machine runtime state (active-step ledger, dispatch ledger, locks).
# Unversioned by design; never commit it and never package it.
${GITIGNORE_LOCAL_BOARD_ENTRY}
`;

const FILES = new Map([
  [
    "plans/README.md",
    `# Plans

\`plans/\` is the file-backed board.

- \`tickets/\` stores work items.
- \`prompts/roles/\` stores durable role instructions.
- \`prompts/steps/\` stores durable step instructions.
- \`templates/\` stores reusable ticket skeletons.

Ticket front matter is canonical. Folder placement is a human convenience.
`,
  ],
  [
    "plans/tickets/README.md",
    `# Tickets

Human-friendly status folders for local-board tickets.

Front matter \`status\` is canonical. Folder placement should match it.
`,
  ],
]);

export async function initProject(root = ".", options = {}) {
  const rootPath = path.resolve(root);
  const overwrite = options.overwrite ?? false;
  const created = [];
  const skipped = [];

  for (const folder of TICKET_FOLDERS) {
    const folderPath = path.join(rootPath, "plans", "tickets", folder);
    await mkdir(folderPath, { recursive: true });
    await writeScaffoldFile(path.join(folderPath, ".gitkeep"), "", overwrite, created, skipped);
  }

  for (const [relativePath, content] of FILES.entries()) {
    await writeScaffoldFile(path.join(rootPath, relativePath), content, overwrite, created, skipped);
  }

  // Copy the maintained, dogfooded prompt/template tree from packaged
  // resources rather than inlining a third, drifting copy. Every file is
  // routed through writeScaffoldFile so the existing wx-vs-w idempotency
  // applies. Unlike the other FILES above, this tree is always add-missing-only
  // (overwrite: false) regardless of the caller's --overwrite flag: users are
  // expected to customize plans/prompts/** and plans/templates/** in place, and
  // `init --overwrite` must restore any packaged file the user deleted without
  // clobbering ones they've edited.
  await copyResourceTree(
    packagedResourceDir("prompts"),
    path.join(rootPath, "plans", "prompts"),
    false,
    created,
    skipped,
  );
  await copyResourceTree(
    packagedResourceDir("templates"),
    path.join(rootPath, "plans", "templates"),
    false,
    created,
    skipped,
  );

  await writeGitignore(path.join(rootPath, ".gitignore"), created, skipped);

  await writeScaffoldFile(
    path.join(rootPath, "plans", "local-board.config.jsonc"),
    defaultConfigJsonc(),
    overwrite,
    created,
    skipped,
  );

  return { root: rootPath, created, skipped };
}

// Resolves a packaged resource directory (e.g. "prompts", "templates") across
// the two layouts local-board can run from: a dev clone / global npm install,
// where the packaged tree lives at <packageRoot>/resources/<name>, and the
// flattened ~/.local-board runtime layout that src/install.js produces
// (resources/prompts -> <installDir>/prompts), where it lives directly at
// <packageRoot>/<name>. `packageRoot` defaults to this package's root and is
// overridable for tests that simulate one layout or the other with a fixture
// directory. Throws a clear error if neither layout resolves so a packaging
// regression fails loudly rather than silently scaffolding an empty tree.
export function packagedResourceDir(name, packageRoot = SCRIPT_DIR) {
  const layered = path.join(packageRoot, "resources", name);
  if (existsSync(layered)) {
    return layered;
  }
  const flattened = path.join(packageRoot, name);
  if (existsSync(flattened)) {
    return flattened;
  }
  throw new Error(
    `local-board: could not locate packaged "${name}" resources at "${layered}" or "${flattened}". ` +
      `This indicates a broken installation or packaging regression; reinstall local-board.`,
  );
}

// Recursively mirrors sourceDir into targetDir, routing every file through
// writeScaffoldFile so idempotency (skip-if-exists unless --overwrite) is
// preserved. Directories are created as needed.
async function copyResourceTree(sourceDir, targetDir, overwrite, created, skipped) {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyResourceTree(sourcePath, targetPath, overwrite, created, skipped);
    } else if (entry.isFile()) {
      const content = await readFile(sourcePath, "utf8");
      await writeScaffoldFile(targetPath, content, overwrite, created, skipped);
    }
  }
}

async function writeScaffoldFile(filePath, content, overwrite, created, skipped) {
  try {
    await writeFile(filePath, content, { encoding: "utf8", flag: overwrite ? "w" : "wx" });
    created.push(filePath);
  } catch (error) {
    if (error.code === "EEXIST") {
      skipped.push(filePath);
      return;
    }
    throw error;
  }
}

// .gitignore is handled outside the generic FILES scaffold path (which writes
// with flag "w" under --overwrite and would replace a user's existing file
// wholesale). A user's root .gitignore may carry unrelated project rules that
// must survive `init --overwrite`. So regardless of the overwrite flag: if the
// file is absent, seed it with the full template; if present, append the
// .worktrees/ ignore line idempotently and never touch any other line.
async function writeGitignore(filePath, created, skipped) {
  let current = null;
  try {
    current = await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  if (current === null) {
    await writeFile(filePath, GITIGNORE_TEMPLATE, "utf8");
    created.push(filePath);
    return;
  }

  const missingEntries = [GITIGNORE_WORKTREE_ENTRY, GITIGNORE_LOCAL_BOARD_ENTRY].filter(
    (entry) => !hasGitignoreEntry(current, entry),
  );
  if (missingEntries.length === 0) {
    skipped.push(filePath);
    return;
  }

  const needsNewlineBefore = current.length > 0 && !current.endsWith("\n");
  const prefix = needsNewlineBefore ? "\n" : "";
  const appended = missingEntries.map((entry) => `${entry}\n`).join("");
  await writeFile(filePath, `${current}${prefix}${appended}`, "utf8");
  created.push(filePath);
}

// A pre-existing line matches whether or not it carries the trailing slash we
// always append for new entries (".worktrees" and ".worktrees/", ".local-board"
// and ".local-board/" are equivalent gitignore patterns), so idempotency checks
// must accept either form.
function hasGitignoreEntry(content, entry) {
  const bareEntry = entry.replace(/\/$/, "");
  const lines = content.split(/\r?\n/);
  return lines.some((line) => line.trim() === entry || line.trim() === bareEntry);
}
