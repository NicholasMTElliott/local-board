import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
    assert.equal(config.workflow.transitions.ready_for_review[0].status, "ready_for_test");
    assert.match(config.workflow.transitions.ready_for_review[1].when, /implementation defects/);
    assert.match(config.workflow.transitions.ready_for_review.at(-1).when, /non-ticket blocker/);
    assert.equal(config.agents.implement, "claude-subagent:local-board-implementer");
    assert.equal(config.agents.review, "codex-task:read-only");
    assert.equal(config.agents.document, "codex-task:workspace-write");
    assert.equal(config.routing.strict, true);
    assert.deepEqual(config.routing.doneRequires.task, ["design", "implement", "review", "test", "document"]);
    assert.equal(config.retention.archiveDoneAfterDays, 30);
    assert.equal(config.retention.archiveOnMoveDone, true);
  });
});

test("default Claude subagent routes have matching agent definitions", async () => {
  const config = await loadConfig(".");
  const agentDir = path.resolve("agents", "claude");
  const fileNames = new Set(await readdir(agentDir));

  for (const value of Object.values(config.agents)) {
    if (!value.startsWith("claude-subagent:")) {
      continue;
    }
    const agentName = value.slice("claude-subagent:".length);
    assert.equal(fileNames.has(`${agentName}.md`), true, `${agentName}.md is missing`);
    const text = await readFile(path.join(agentDir, `${agentName}.md`), "utf8");
    assert.match(text, new RegExp(`^name: ${agentName}$`, "m"));
  }
});
