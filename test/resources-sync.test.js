import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const ROOT = path.resolve(".");

async function listFiles(dir) {
  const results = [];
  async function walk(current, relative) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      const entryRelative = relative ? path.join(relative, entry.name) : entry.name;
      if (entry.isDirectory()) {
        await walk(entryPath, entryRelative);
      } else if (entry.isFile()) {
        results.push(entryRelative);
      }
    }
  }
  await walk(dir, "");
  return results.sort();
}

async function assertMirrored(sourceDir, targetDir) {
  const [sourceFiles, targetFiles] = await Promise.all([listFiles(sourceDir), listFiles(targetDir)]);

  assert.deepEqual(
    targetFiles,
    sourceFiles,
    `${targetDir} file set has drifted from ${sourceDir}; run "npm run sync-resources"`,
  );

  for (const relativeFile of sourceFiles) {
    const [sourceContent, targetContent] = await Promise.all([
      readFile(path.join(sourceDir, relativeFile), "utf8"),
      readFile(path.join(targetDir, relativeFile), "utf8"),
    ]);
    assert.equal(
      targetContent,
      sourceContent,
      `${path.join(targetDir, relativeFile)} content has drifted from ${path.join(sourceDir, relativeFile)}; run "npm run sync-resources"`,
    );
  }
}

test("resources/prompts mirrors plans/prompts byte-for-byte", async () => {
  await assertMirrored(path.join(ROOT, "plans", "prompts"), path.join(ROOT, "resources", "prompts"));
});

test("resources/templates mirrors plans/templates byte-for-byte", async () => {
  await assertMirrored(path.join(ROOT, "plans", "templates"), path.join(ROOT, "resources", "templates"));
});

test("resources directories are not empty (guards against a silently-broken walk)", async () => {
  const promptFiles = await listFiles(path.join(ROOT, "resources", "prompts"));
  const templateFiles = await listFiles(path.join(ROOT, "resources", "templates"));
  assert.ok(promptFiles.length > 0, "resources/prompts should contain files");
  assert.ok(templateFiles.length > 0, "resources/templates should contain files");
});
