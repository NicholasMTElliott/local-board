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

const REQUIRED_COMMANDS = ["design-review-check", "design-review-complete"];

test("each skill's CLI Commands block documents the required design-review command surface", async () => {
  for (const file of SKILL_FILES) {
    const source = await readFile(file, "utf8");
    const block = extractSkillBlock(source, file);
    const blockNames = new Set(extractSkillBlockCommandNames(block, file));
    for (const required of REQUIRED_COMMANDS) {
      assert.ok(
        blockNames.has(required),
        `${file} CLI Commands block is missing required command "${required}"; add it to the curated CLI Commands block`,
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

// The pinned-retry-then-fallback-walk choreography (T20260710T2050Z): every
// Delegation-equivalent section across the four skill texts (native
// single-ticket, native parallel, codex single-ticket, codex parallel) must
// describe the same operational elements, in each audience's own dialect
// (native `configuredFallbackModels`/`configuredEffort` field names vs codex
// sanitized `codexDispatch.*` field names).
const FALLBACK_WALK_SECTIONS = [
  { file: path.join(ROOT, "SKILL.md"), heading: "## Delegation", audience: "native" },
  { file: path.join(ROOT, "SKILL_TEAM.md"), heading: "## Execution profiles", audience: "native" },
  {
    file: path.join(ROOT, "skills", "codex", "local-board", "SKILL.md"),
    heading: "### Fallback Model Walk",
    audience: "codex",
  },
  {
    file: path.join(ROOT, "skills", "codex", "local-team", "SKILL.md"),
    heading: "## Route Translation",
    audience: "codex",
  },
];

// Slice `source` from `heading` up to (but not including) the next
// TOP-LEVEL "## " heading. A "### " subheading does not end the section —
// e.g. SKILL.md's fallback-walk paragraph lives inside the
// "### Persisting Delegated Output" subsection of "## Delegation".
function extractHeadingSection(source, heading, label) {
  const idx = source.indexOf(heading);
  assert.ok(idx >= 0, `${label} is missing heading "${heading}"`);
  const rest = source.slice(idx + heading.length);
  const nextTopHeading = rest.match(/\n##(?!#) /);
  return nextTopHeading ? rest.slice(0, nextTopHeading.index) : rest;
}

test("all four skill texts document the pinned-retry-then-fallback-walk choreography", async () => {
  for (const { file, heading, audience } of FALLBACK_WALK_SECTIONS) {
    const source = await readFile(file, "utf8");
    const section = extractHeadingSection(source, heading, file);

    assert.match(
      section,
      /retry the pin(?:ned model)? once/i,
      `${file}: missing the pinned-model-retry-once wording in "${heading}"`,
    );

    assert.match(section, /\bin order\b/i, `${file}: missing the ordered-walk "in order" wording in "${heading}"`);
    assert.match(section, /fallback/i, `${file}: "${heading}" does not mention "fallback"`);

    assert.ok(
      section.includes("--model <fallbackModel>"),
      `${file}: missing the actual-model evidence wording "--model <fallbackModel>" in "${heading}"`,
    );

    if (audience === "native") {
      assert.match(
        section,
        /carr(?:y|ying) the configured effort over unchanged/i,
        `${file}: missing the native effort-carry-over wording in "${heading}"`,
      );
    } else {
      assert.match(
        section,
        /carr(?:y|ying)[^.]*codexDispatch\.effort[^.]*unchanged/i,
        `${file}: missing the codex effort-carry-over wording (codexDispatch.effort) in "${heading}"`,
      );
    }

    assert.match(section, /gate-check/, `${file}: "${heading}" is missing "gate-check"`);
    assert.match(section, /specialty-run/, `${file}: "${heading}" is missing "specialty-run"`);
    assert.match(section, /design-review-check/, `${file}: "${heading}" is missing "design-review-check"`);

    assert.match(section, /approve-inline/, `${file}: "${heading}" is missing "approve-inline"`);
    assert.match(section, /questions/, `${file}: "${heading}" is missing "questions"`);

    if (audience === "codex") {
      assert.match(
        section,
        /never\b[^.]*@?codex-default/i,
        `${file}: "${heading}" is missing the never-@codex-default guard for an exhausted fallback walk`,
      );
    }
  }
});
