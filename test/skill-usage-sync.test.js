import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { usageCommandNames } from "../src/cli.js";

const ROOT = path.resolve(".");

const SKILL_FILES = [
  path.join(ROOT, "SKILL.md"),
  path.join(ROOT, "skills", "codex", "local-board", "SKILL.md"),
];

// Extract the fenced ```sh block that follows the "## CLI Commands" heading,
// then pull the command name (first token after "local-board") off each
// non-blank line. Mirrors the tokenizer in src/cli.js's usageCommandNames so
// both sides agree on what counts as a "command name".
function extractSkillBlockCommandNames(source, label) {
  const headingIndex = source.indexOf("## CLI Commands");
  assert.ok(headingIndex >= 0, `${label} is missing a "## CLI Commands" heading`);

  const afterHeading = source.slice(headingIndex);
  const fenceMatch = afterHeading.match(/```sh\n([\s\S]*?)\n```/);
  assert.ok(fenceMatch, `${label} is missing a fenced \`\`\`sh block under "## CLI Commands"`);

  const names = [];
  for (const rawLine of fenceMatch[1].split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    assert.ok(line.startsWith("local-board "), `${label}: unexpected non-command line "${line}" in CLI Commands block`);
    const rest = line.slice("local-board".length).trim();
    const match = rest.match(/^(--version|calibration suggest|[a-z][a-z-]*)/);
    assert.ok(match, `${label}: could not extract a command name from "${line}"`);
    names.push(match[1]);
  }
  return names;
}

test("SKILL.md and skills/codex/local-board/SKILL.md CLI Commands blocks list the same commands", async () => {
  const [rootSource, codexSource] = await Promise.all([
    readFile(SKILL_FILES[0], "utf8"),
    readFile(SKILL_FILES[1], "utf8"),
  ]);

  const rootNames = new Set(extractSkillBlockCommandNames(rootSource, SKILL_FILES[0]));
  const codexNames = new Set(extractSkillBlockCommandNames(codexSource, SKILL_FILES[1]));

  assert.deepEqual(
    [...codexNames].sort(),
    [...rootNames].sort(),
    `${SKILL_FILES[1]} CLI Commands block has drifted from ${SKILL_FILES[0]}; update the CLI Commands block in both files to match the sibling skill`,
  );
});

test("each skill's CLI Commands block is a subset of the authoritative CLI usage surface", async () => {
  const usageNames = new Set(usageCommandNames());

  for (const file of SKILL_FILES) {
    const source = await readFile(file, "utf8");
    const blockNames = extractSkillBlockCommandNames(source, file);
    for (const name of blockNames) {
      assert.ok(
        usageNames.has(name),
        `${file} lists "${name}" in its CLI Commands block, but it is not in local-board's usage output; update the CLI Commands block in ${file} to match printUsage / the sibling skill`,
      );
    }
  }
});

test("usage names and skill block names are non-empty (guards against a silently-broken parser)", async () => {
  const usageNames = usageCommandNames();
  assert.ok(usageNames.length > 0, "usageCommandNames() should return at least one command name");

  for (const file of SKILL_FILES) {
    const source = await readFile(file, "utf8");
    const blockNames = extractSkillBlockCommandNames(source, file);
    assert.ok(blockNames.length > 0, `${file} CLI Commands block should list at least one command`);
  }
});
