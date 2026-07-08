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

// Working-copy files only pick up the repo's `eol=lf` .gitattributes policy on
// (re)checkout, so a stale checkout can have CRLF on one side while the other
// is LF even though committed content is identical. Normalize \r\n -> \n
// (only) before comparing content. Mirrors normalizeEol in
// test/resources-sync.test.js.
const normalizeEol = (s) => s.replace(/\r\n/g, "\n");

// Extract the fenced ```sh block that follows the "## CLI Commands" heading,
// anchored to that specific heading so unrelated fences elsewhere in the file
// (e.g. the top-of-file `local-board` usage fence) can't be picked up instead.
function extractSkillBlock(source, label) {
  const headingIndex = source.indexOf("## CLI Commands");
  assert.ok(headingIndex >= 0, `${label} is missing a "## CLI Commands" heading`);

  const afterHeading = source.slice(headingIndex);
  const fenceMatch = afterHeading.match(/```sh\n([\s\S]*?)\n```/);
  assert.ok(fenceMatch, `${label} is missing a fenced \`\`\`sh block under "## CLI Commands"`);

  return fenceMatch[1];
}

// Pull the command name (first token after "local-board") off each non-blank
// line of an already-extracted CLI Commands block. Mirrors the tokenizer in
// src/cli.js's usageCommandNames so both sides agree on what counts as a
// "command name".
function extractSkillBlockCommandNames(block, label) {
  const names = [];
  for (const rawLine of block.split("\n")) {
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

  const rootBlock = extractSkillBlock(rootSource, SKILL_FILES[0]);
  const codexBlock = extractSkillBlock(codexSource, SKILL_FILES[1]);

  const rootNames = new Set(extractSkillBlockCommandNames(rootBlock, SKILL_FILES[0]));
  const codexNames = new Set(extractSkillBlockCommandNames(codexBlock, SKILL_FILES[1]));

  assert.deepEqual(
    [...codexNames].sort(),
    [...rootNames].sort(),
    `${SKILL_FILES[1]} CLI Commands block has drifted from ${SKILL_FILES[0]}; update the CLI Commands block in both files to match the sibling skill`,
  );
});

test("SKILL.md and skills/codex/local-board/SKILL.md CLI Commands blocks are byte-identical", async () => {
  const [rootSource, codexSource] = await Promise.all([
    readFile(SKILL_FILES[0], "utf8"),
    readFile(SKILL_FILES[1], "utf8"),
  ]);

  const rootBlock = extractSkillBlock(rootSource, SKILL_FILES[0]);
  const codexBlock = extractSkillBlock(codexSource, SKILL_FILES[1]);

  // A shared command-name set is not sufficient: presentation drift (flag
  // lists, argument order, option syntax) between the two fenced blocks must
  // also fail CI, since both files claim to document the same CLI surface.
  assert.equal(
    normalizeEol(codexBlock),
    normalizeEol(rootBlock),
    `${SKILL_FILES[1]} CLI Commands block text has drifted from ${SKILL_FILES[0]}; treat ${SKILL_FILES[0]} as canonical and copy its CLI Commands block verbatim into ${SKILL_FILES[1]}`,
  );
});

test("each skill's CLI Commands block is a subset of the authoritative CLI usage surface", async () => {
  const usageNames = new Set(usageCommandNames());

  for (const file of SKILL_FILES) {
    const source = await readFile(file, "utf8");
    const block = extractSkillBlock(source, file);
    const blockNames = extractSkillBlockCommandNames(block, file);
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
    const block = extractSkillBlock(source, file);
    const blockNames = extractSkillBlockCommandNames(block, file);
    assert.ok(blockNames.length > 0, `${file} CLI Commands block should list at least one command`);
  }
});
