#!/usr/bin/env node
// Regenerates resources/{prompts,templates} as a mirror of this repo's own
// dogfooded board content (plans/prompts, plans/templates). plans/ is the
// human-edited source of truth; resources/ is packaged runtime content
// shipped to consuming projects via install.mjs. See
// plans/tickets (T20260707T1318Z) for the design rationale.

import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..");

const PAIRS = [
  [join("plans", "prompts"), join("resources", "prompts")],
  [join("plans", "templates"), join("resources", "templates")],
];

for (const [sourceRelative, targetRelative] of PAIRS) {
  const source = join(ROOT, sourceRelative);
  const target = join(ROOT, targetRelative);
  if (!existsSync(source)) {
    throw new Error(`sync-resources: missing source directory ${sourceRelative}`);
  }
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });
  console.log(`synced ${sourceRelative} -> ${targetRelative}`);
}
