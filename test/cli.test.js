import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { main } from "../src/cli.js";
import { createTicket, discover } from "../src/tickets.js";

async function withBoard(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-board-cli-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("CLI command surface supports init, create, query, mutate, relate, report, and validate", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const parentCreate = await runCli([
      "--root",
      root,
      "create",
      "epic",
      "Parent Epic",
      "--status",
      "ready_for_decomposition",
      "--priority",
      "P4",
    ]);
    assert.equal(parentCreate.code, 0);
    const parentId = path.basename(parentCreate.stdout.trim()).split("_", 1)[0];

    const childCreate = await runCli([
      "--root",
      root,
      "create",
      "story",
      "Child Story",
      "--status",
      "ready_for_decomposition",
      "--priority",
      "P0",
      "--parent",
      parentId,
    ]);
    assert.equal(childCreate.code, 0);
    const childPath = childCreate.stdout.trim();
    const childId = path.basename(childPath).split("_", 1)[0];

    assert.equal((await runCli(["--root", root, "link-child", parentId, childId])).code, 0);
    assert.equal((await runCli(["--root", root, "section", childId, "CLI requirement.", "--section", "Requirement"])).code, 0);
    const designPath = path.join(root, "technical-design.md");
    await writeFile(designPath, "Use the existing parser.\n\nAvoid shell quoting for long Markdown.\n", "utf8");
    assert.equal((await runCli(["--root", root, "section", childId, "--file", designPath, "--section", "Technical Design"])).code, 0);
    assert.equal(
      (await runCli(["--root", root, "section", childId, "Inline text", "--file", designPath, "--section", "Technical Design"])).code,
      2,
    );
    assert.equal((await runCli(["--root", root, "comment", childId, "CLI touched this.", "--section", "Run Log"])).code, 0);
    assert.equal((await runCli(["--root", root, "set", childId, "priority", "P2"])).code, 0);
    assert.equal((await runCli(["--root", root, "update-field", childId, "estimate", "2"])).code, 0);
    assert.equal((await runCli(["--root", root, "move", childId, "ready_for_design"])).code, 0);
    assert.equal((await runCli(["--root", root, "block", childId, parentId])).code, 0);
    assert.equal((await runCli(["--root", root, "unblock", childId, parentId])).code, 0);
    assert.equal((await runCli(["--root", root, "unlink-parent", childId, parentId])).code, 0);
    assert.equal((await runCli(["--root", root, "link-parent", childId, parentId])).code, 0);

    const list = await runCli(["--root", root, "list", "--json"]);
    assert.equal(list.code, 0);
    assert.equal(JSON.parse(list.stdout).length, 2);

    const next = await runCli(["--root", root, "next", "--json"]);
    assert.equal(next.code, 0);
    assert.equal(JSON.parse(next.stdout).id, childId);

    const queryTicket = await runCli(["--root", root, "query-ticket", childId, "--json"]);
    assert.equal(queryTicket.code, 0);
    assert.equal(JSON.parse(queryTicket.stdout).action, "design");

    const queryNext = await runCli(["--root", root, "query-next", "--json"]);
    assert.equal(queryNext.code, 0);
    assert.equal(JSON.parse(queryNext.stdout).ticket, childId);

    const report = await runCli(["--root", root, "state-report", "--json"]);
    assert.equal(report.code, 0);
    assert.equal(JSON.parse(report.stdout).eligible, 2);

    const schema = await runCli(["--root", root, "schema", "--json"]);
    assert.equal(schema.code, 0);
    assert.equal(JSON.parse(schema.stdout).statuses.includes("ready_for_implementation"), true);
    assert.equal(JSON.parse(schema.stdout).retention.archiveDoneAfterDays, 30);
    assert.equal(JSON.parse(schema.stdout).workflow.transitions.ready_for_review[0].status, "ready_for_test");

    const beginStep = await runCli(["--root", root, "begin-step", childId, "--json"]);
    assert.equal(beginStep.code, 0);
    assert.equal(JSON.parse(beginStep.stdout).configuredAgent, "claude-subagent:local-board-designer");
    assert.equal((await runCli(["--root", root, "approve-inline", childId, "design", "--reason", "CLI fallback test"])).code, 0);
    assert.equal(
      (await runCli([
        "--root",
        root,
        "complete-step",
        childId,
        "design",
        "--executor",
        "inline",
        "--evidence",
        "CLI design evidence",
      ])).code,
      0,
    );

    const validate = await runCli(["--root", root, "validate", "--json"]);
    assert.equal(validate.code, 0);
    assert.equal(JSON.parse(validate.stdout).ok, true);

    const movedText = await readFile(path.join(root, "plans", "tickets", "ready", path.basename(childPath)), "utf8");
    assert.match(movedText, /^priority: P2$/m);
    assert.match(movedText, /^estimate: 2$/m);
    assert.match(movedText, /CLI requirement\./);
    assert.match(movedText, /Use the existing parser\./);
    assert.match(movedText, /Avoid shell quoting for long Markdown\./);
    assert.match(movedText, /CLI touched this\./);
  });
});

test("move done archives old done tickets but leaves recent and current done tickets", async () => {
  await withBoard(async (root) => {
    const oldDonePath = await createTicket(root, "epic", "Old done ticket", {
      status: "done",
      now: new Date("2026-03-01T12:00:00Z"),
    });
    const recentDonePath = await createTicket(root, "epic", "Recent done ticket", {
      status: "done",
      now: new Date("2026-05-10T12:00:00Z"),
    });
    await recordEpicDecomposition(oldDonePath);
    await recordEpicDecomposition(recentDonePath);
    const currentPath = await createTicket(root, "epic", "Current closeout", {
      status: "ready_for_decomposition",
      now: new Date("2026-05-14T12:00:00Z"),
    });
    const currentId = path.basename(currentPath).split("_", 1)[0];
    const oldDoneId = path.basename(oldDonePath).split("_", 1)[0];
    const recentDoneId = path.basename(recentDonePath).split("_", 1)[0];
    assert.equal(
      (
        await runCli([
          "--root",
          root,
          "complete-step",
          currentId,
          "decompose",
          "--executor",
          "claude-subagent:local-board-decomposer",
          "--evidence",
          "Decomposition not needed.",
        ])
      ).code,
      0,
    );

    const result = await runCli(["--root", root, "move", currentId, "done", "--json"]);

    assert.equal(result.code, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.archived.map((record) => record.ticket), [oldDoneId]);
    const tickets = new Map((await discover(root)).tickets.map((ticket) => [ticket.id, ticket]));
    assert.equal(tickets.get(oldDoneId)?.status, "archived");
    assert.equal(tickets.get(recentDoneId)?.status, "done");
    assert.equal(tickets.get(currentId)?.status, "done");
  });
});

test("read-only commands do not archive old done tickets", async () => {
  await withBoard(async (root) => {
    const oldDonePath = await createTicket(root, "epic", "Old read-only done", {
      status: "done",
      now: new Date("2026-03-01T12:00:00Z"),
    });
    await recordEpicDecomposition(oldDonePath);
    const oldDoneId = path.basename(oldDonePath).split("_", 1)[0];

    assert.equal((await runCli(["--root", root, "validate"])).code, 0);
    assert.equal((await runCli(["--root", root, "list", "--json"])).code, 0);
    assert.equal((await runCli(["--root", root, "query-next", "--json"])).code, 1);
    assert.equal((await runCli(["--root", root, "state-report", "--json"])).code, 0);

    const tickets = new Map((await discover(root)).tickets.map((ticket) => [ticket.id, ticket]));
    assert.equal(tickets.get(oldDoneId)?.status, "done");
    assert.equal(path.relative(root, tickets.get(oldDoneId)?.path), path.join("plans", "tickets", "done", path.basename(oldDonePath)));
  });
});

async function runCli(args) {
  const stdout = [];
  const stderr = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (message = "") => stdout.push(String(message));
  console.error = (message = "") => stderr.push(String(message));
  try {
    const code = await main(args);
    return {
      code,
      stdout: stdout.join("\n"),
      stderr: stderr.join("\n"),
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

async function recordEpicDecomposition(ticketPath) {
  const text = await readFile(ticketPath, "utf8");
  await writeFile(
    ticketPath,
    text.replace("completedSteps: []", "completedSteps: [decompose:claude-subagent:local-board-decomposer]"),
    "utf8",
  );
}
