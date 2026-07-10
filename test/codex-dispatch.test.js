import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { translateCodexDispatch } from "../src/codex-dispatch.js";
import { modelSatisfies } from "../src/tickets.js";

const AGENTS_DIR = path.join("C:", "fixture", "agents", "codex");

const ROLE_AGENT_TYPES = {
  decomposer: "explorer",
  reviewer: "explorer",
  tester: "explorer",
  gatecheck: "explorer",
  designer: "worker",
  implementer: "worker",
  documenter: "worker",
};

test("translateCodexDispatch maps each of the seven claude-subagent roles to the correct agentType and prompt path", () => {
  for (const [role, agentType] of Object.entries(ROLE_AGENT_TYPES)) {
    const dispatch = translateCodexDispatch({
      route: `claude-subagent:local-board-${role}`,
      model: null,
      prompt: null,
      agentsDir: AGENTS_DIR,
    });
    assert.equal(dispatch.known, true);
    assert.equal(dispatch.dispatchKind, "spawn_agent");
    assert.equal(dispatch.agentType, agentType);
    assert.equal(dispatch.promptPath, path.join(AGENTS_DIR, `local-board-${role}.md`));
  }
});

test("translateCodexDispatch sanitizes Claude aliases and null to no Codex model, with @codex-default evidence", () => {
  for (const model of [null, "opus", "sonnet", "haiku", "claude-3-5-sonnet-20241022"]) {
    const dispatch = translateCodexDispatch({
      route: "claude-subagent:local-board-implementer",
      model,
      prompt: null,
      agentsDir: AGENTS_DIR,
    });
    assert.equal(dispatch.model, null);
    assert.equal(dispatch.evidenceExecutor, "claude-subagent:local-board-implementer@codex-default");
    assert.equal(modelSatisfies("sonnet", "codex-default"), true);
  }
});

test("translateCodexDispatch passes a real Codex model id through unchanged", () => {
  const dispatch = translateCodexDispatch({
    route: "claude-subagent:local-board-implementer",
    model: "gpt-5-codex",
    prompt: null,
    agentsDir: AGENTS_DIR,
  });
  assert.equal(dispatch.model, "gpt-5-codex");
  assert.equal(dispatch.evidenceExecutor, "claude-subagent:local-board-implementer@gpt-5-codex");
  assert.equal(modelSatisfies("gpt-5-codex", "gpt-5-codex"), true);
});

test("translateCodexDispatch handles inline: no model, evidenceExecutor inline, promptPath is the project prompt", () => {
  const dispatch = translateCodexDispatch({
    route: "inline",
    model: null,
    prompt: "resources/prompts/steps/implement.md",
    agentsDir: AGENTS_DIR,
  });
  assert.deepEqual(dispatch, {
    dispatchKind: "inline",
    agentType: null,
    promptPath: "resources/prompts/steps/implement.md",
    model: null,
    effort: null,
    evidenceExecutor: "inline",
    known: true,
  });
});

test("translateCodexDispatch threads effort onto every branch: null when unset, verbatim when set, no sanitization", () => {
  const claudeSubagentUnset = translateCodexDispatch({
    route: "claude-subagent:local-board-implementer",
    model: null,
    prompt: null,
    agentsDir: AGENTS_DIR,
  });
  assert.equal(claudeSubagentUnset.effort, null);

  const claudeSubagentSet = translateCodexDispatch({
    route: "claude-subagent:local-board-implementer",
    model: null,
    prompt: null,
    effort: "xhigh",
    agentsDir: AGENTS_DIR,
  });
  assert.equal(claudeSubagentSet.effort, "xhigh");

  const codexTaskUnset = translateCodexDispatch({
    route: "codex-task:read-only",
    model: null,
    prompt: null,
    agentsDir: AGENTS_DIR,
  });
  assert.equal(codexTaskUnset.effort, null);

  const codexTaskSet = translateCodexDispatch({
    route: "codex-task:read-only",
    model: null,
    prompt: null,
    effort: "medium",
    agentsDir: AGENTS_DIR,
  });
  assert.equal(codexTaskSet.effort, "medium");

  const inlineDispatch = translateCodexDispatch({
    route: "inline",
    model: null,
    prompt: null,
    agentsDir: AGENTS_DIR,
  });
  assert.equal(inlineDispatch.effort, null);

  // No sanitization: an arbitrary token passes through verbatim, unlike model.
  const arbitraryEffort = translateCodexDispatch({
    route: "claude-subagent:local-board-implementer",
    model: null,
    prompt: null,
    effort: "some-arbitrary-token",
    agentsDir: AGENTS_DIR,
  });
  assert.equal(arbitraryEffort.effort, "some-arbitrary-token");
});

test("translateCodexDispatch passes through native codex-task routes with a passthrough marker", () => {
  const readOnly = translateCodexDispatch({
    route: "codex-task:read-only",
    model: null,
    prompt: "resources/prompts/steps/review.md",
    agentsDir: AGENTS_DIR,
  });
  assert.equal(readOnly.dispatchKind, "spawn_agent");
  assert.equal(readOnly.agentType, "explorer");
  assert.equal(readOnly.promptPath, "resources/prompts/steps/review.md");
  assert.equal(readOnly.passthrough, true);
  assert.equal(readOnly.evidenceExecutor, "codex-task:read-only@codex-default");

  const workspaceWrite = translateCodexDispatch({
    route: "codex-task:workspace-write",
    model: "gpt-5-codex",
    prompt: "resources/prompts/steps/implement.md",
    agentsDir: AGENTS_DIR,
  });
  assert.equal(workspaceWrite.agentType, "worker");
  assert.equal(workspaceWrite.passthrough, true);
  assert.equal(workspaceWrite.evidenceExecutor, "codex-task:workspace-write@gpt-5-codex");
});

test("translateCodexDispatch flags an unknown claude-subagent role as known:false without fabricating a path", () => {
  const dispatch = translateCodexDispatch({
    route: "claude-subagent:local-board-nonexistent",
    model: null,
    prompt: null,
    effort: "high",
    agentsDir: AGENTS_DIR,
  });
  assert.equal(dispatch.known, false);
  assert.equal(dispatch.promptPath, null);
  assert.equal(typeof dispatch.note, "string");
  assert.ok(dispatch.note.length > 0);
  assert.equal(dispatch.effort, "high");
});

test("translateCodexDispatch threads effort unchanged onto the unrecognized-route fallback", () => {
  const dispatch = translateCodexDispatch({
    route: "some-unrecognized-route",
    model: null,
    prompt: null,
    effort: "medium",
    agentsDir: AGENTS_DIR,
  });
  assert.equal(dispatch.known, false);
  assert.equal(dispatch.promptPath, null);
  assert.equal(typeof dispatch.note, "string");
  assert.ok(dispatch.note.length > 0);
  assert.equal(dispatch.effort, "medium");
});

test("translateCodexDispatch (T20260710T1532Z, D6): omits fallbackModels entirely when null/undefined -- byte-identical to before this feature", () => {
  const undefinedCase = translateCodexDispatch({
    route: "claude-subagent:local-board-implementer",
    model: "gpt-5-codex",
    prompt: null,
    agentsDir: AGENTS_DIR,
  });
  assert.equal(Object.hasOwn(undefinedCase, "fallbackModels"), false);

  const nullCase = translateCodexDispatch({
    route: "codex-task:read-only",
    model: null,
    prompt: null,
    fallbackModels: null,
    agentsDir: AGENTS_DIR,
  });
  assert.equal(Object.hasOwn(nullCase, "fallbackModels"), false);
});

test("translateCodexDispatch (T20260710T1532Z): sanitizes an alias-containing fallbackModels list (Claude aliases dropped) while effort carries through unchanged", () => {
  const dispatch = translateCodexDispatch({
    route: "codex-task:read-only",
    model: "gpt-5.6-terra",
    prompt: null,
    effort: "high",
    fallbackModels: ["gpt-5.5", "sonnet"],
    agentsDir: AGENTS_DIR,
  });
  assert.deepEqual(dispatch.fallbackModels, ["gpt-5.5"]);
  assert.equal(dispatch.effort, "high");
});

test("translateCodexDispatch (T20260710T1532Z): a claude-subagent route whose fallbacks are all aliases sanitizes to an empty array (not omitted)", () => {
  const dispatch = translateCodexDispatch({
    route: "claude-subagent:local-board-implementer",
    model: "sonnet",
    prompt: null,
    fallbackModels: ["opus", "haiku"],
    agentsDir: AGENTS_DIR,
  });
  assert.deepEqual(dispatch.fallbackModels, []);
});

test("translateCodexDispatch (T20260710T1532Z, finding 5): prompt: promptPath populates codexDispatch.promptPath on a codex-task route", () => {
  const dispatch = translateCodexDispatch({
    route: "codex-task:read-only",
    model: "gpt-5.6-sol",
    prompt: "plans/prompts/steps/gate-check.md",
    effort: "xhigh",
    fallbackModels: ["gpt-5.5"],
    agentsDir: AGENTS_DIR,
  });
  assert.equal(dispatch.promptPath, "plans/prompts/steps/gate-check.md");
  assert.deepEqual(dispatch.fallbackModels, ["gpt-5.5"]);
});
