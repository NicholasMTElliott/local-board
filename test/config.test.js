import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { defaultConfigJsonc, loadConfig, parseJsonc } from "../src/config.js";

async function withRoot(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-board-config-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("parseJsonc accepts comments, trailing commas, and comment-like text in strings", () => {
  const parsed = parseJsonc(`{
    // line comment
    "url": "https://example.test/path",
    "literal": "not /* a comment */",
    "items": [
      "one",
    ],
    /*
      block comment
    */
    "nested": {
      "enabled": true,
    },
  }`);

  assert.deepEqual(parsed, {
    url: "https://example.test/path",
    literal: "not /* a comment */",
    items: ["one"],
    nested: { enabled: true },
  });
});

test("loadConfig reads the commented default config", async () => {
  await withRoot(async (root) => {
    await mkdir(path.join(root, "plans"), { recursive: true });
    await writeFile(path.join(root, "plans", "local-board.config.jsonc"), defaultConfigJsonc(), "utf8");

    const config = await loadConfig(root);

    assert.equal(config.version, 1);
    assert.equal(config.workflow.statusActions.ready_for_design, "design");
    assert.equal(config.agents.implement, "inline");
  });
});
