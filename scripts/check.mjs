#!/usr/bin/env node
// `npm run check`: syntax-check every source file with `node --check`.
// Walks the source directories instead of listing files by hand, so a new
// file is checked without editing package.json. Tests are covered by
// `node --test`, which fails on a syntax error anyway.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["bin", "src", "hooks", "scripts"];
const FILES = ["install.mjs"];
const SOURCE = /\.(?:js|mjs)$/;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      return entry.isFile() && SOURCE.test(entry.name) ? [path] : [];
    });
}

const files = [
  ...DIRS.map((dir) => join(ROOT, dir)).filter((dir) => existsSync(dir)).flatMap(walk),
  ...FILES.map((file) => join(ROOT, file)),
];

let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed += 1;
    process.stderr.write(`FAIL ${relative(ROOT, file)}\n${result.stderr}${result.error ? `${result.error.message}\n` : ""}`);
  }
}

if (failed > 0) {
  process.stderr.write(`check: ${failed} of ${files.length} files failed\n`);
  process.exitCode = 1;
} else {
  console.log(`check: ${files.length} files OK`);
}
