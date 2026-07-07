#!/usr/bin/env node
// Regenerates resources/{prompts,templates} as a mirror of this repo's own
// dogfooded board content (plans/prompts, plans/templates). plans/ is the
// human-edited source of truth; resources/ is packaged runtime content
// shipped to consuming projects via install.mjs. See
// plans/tickets (T20260707T1318Z) for the design rationale.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..");

const PAIRS = [
  [join("plans", "prompts"), join("resources", "prompts")],
  [join("plans", "templates"), join("resources", "templates")],
];

// All mirrored assets are text .md files. Write LF-normalized output so a
// freshly generated mirror always matches the repo's `* text=auto eol=lf`
// .gitattributes policy, even when this script is run from a stale CRLF
// plans/ working copy (Windows checkouts commonly get CRLF until
// re-checked-out). If a working copy stays persistently CRLF/LF-mismatched
// against its own git index, run `git add --renormalize .` (or re-checkout
// plans/resources) to fix it at the source.
function copyNormalized(source, target) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      copyNormalized(sourcePath, targetPath);
    } else if (entry.isFile()) {
      const content = readFileSync(sourcePath, "utf8").replace(/\r\n/g, "\n");
      writeFileSync(targetPath, content);
    }
  }
}

for (const [sourceRelative, targetRelative] of PAIRS) {
  const source = join(ROOT, sourceRelative);
  const target = join(ROOT, targetRelative);
  if (!existsSync(source)) {
    throw new Error(`sync-resources: missing source directory ${sourceRelative}`);
  }
  rmSync(target, { recursive: true, force: true });
  copyNormalized(source, target);
  console.log(`synced ${sourceRelative} -> ${targetRelative}`);
}
