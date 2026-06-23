import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { main } from "../src/cli.js";
import { loadConfig } from "../src/config.js";
import { createTicket, discover, queryNext } from "../src/tickets.js";

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

test("list --ready uses config-aware eligibility, ordering, JSON shape, status filter, and limit", async () => {
  await withBoard(async (root) => {
    const readyImpl = await createTicket(root, "task", "Ready implementation", {
      status: "ready_for_implementation",
      priority: "P0",
      now: new Date("2026-05-14T20:50:00Z"),
    });
    const readyDesign = await createTicket(root, "task", "Ready design", {
      status: "ready_for_design",
      priority: "P1",
      now: new Date("2026-05-14T20:51:00Z"),
    });
    const implementing = await createTicket(root, "task", "Already implementing", {
      status: "implementing",
      priority: "P0",
      now: new Date("2026-05-14T20:52:00Z"),
    });
    const done = await createTicket(root, "epic", "Already done", {
      status: "done",
      priority: "P0",
      now: new Date("2026-05-14T20:53:00Z"),
    });
    await recordEpicDecomposition(done);
    const dependency = await createTicket(root, "task", "Open dependency", {
      status: "ready_for_design",
      priority: "P3",
      now: new Date("2026-05-14T20:54:00Z"),
    });
    const blocked = await createTicket(root, "task", "Blocked trigger status", {
      status: "ready_for_implementation",
      priority: "P0",
      now: new Date("2026-05-14T20:55:00Z"),
    });

    const readyImplId = path.basename(readyImpl).split("_", 1)[0];
    const readyDesignId = path.basename(readyDesign).split("_", 1)[0];
    const implementingId = path.basename(implementing).split("_", 1)[0];
    const doneId = path.basename(done).split("_", 1)[0];
    const dependencyId = path.basename(dependency).split("_", 1)[0];
    const blockedId = path.basename(blocked).split("_", 1)[0];
    await replaceText(blocked, "blockedBy: []", `blockedBy: [${dependencyId}]`);
    await replaceText(dependency, "blocks: []", `blocks: [${blockedId}]`);

    const result = await runCli(["--root", root, "list", "--ready", "--json"]);

    assert.equal(result.code, 0, result.stderr);
    const rows = JSON.parse(result.stdout);
    const ids = rows.map((row) => row.id);
    assert.equal(ids.includes(readyImplId), true);
    assert.equal(ids.includes(readyDesignId), true);
    assert.equal(ids.includes(implementingId), false);
    assert.equal(ids.includes(doneId), false);
    assert.equal(ids.includes(blockedId), false);
    assert.deepEqual(Object.keys(rows[0]), ["id", "type", "status", "priority", "branch", "title", "path", "action"]);
    assert.equal(rows[0].id, (await queryNext(root))?.ticket);

    const filtered = await runCli(["--root", root, "list", "--ready", "--status", "ready_for_design", "--json"]);
    assert.equal(filtered.code, 0, filtered.stderr);
    assert.deepEqual(JSON.parse(filtered.stdout).map((row) => row.id), [readyDesignId, dependencyId]);

    const limited = await runCli(["--root", root, "list", "--ready", "--limit", "1", "--json"]);
    assert.equal(limited.code, 0, limited.stderr);
    assert.deepEqual(JSON.parse(limited.stdout).map((row) => row.id), [rows[0].id]);
  });
});

test("list --limit caps default output and rejects non-positive values", async () => {
  await withBoard(async (root) => {
    await createTicket(root, "task", "First", {
      status: "backlog",
      now: new Date("2026-05-14T20:50:00Z"),
    });
    await createTicket(root, "task", "Second", {
      status: "ready_for_design",
      now: new Date("2026-05-14T20:51:00Z"),
    });
    await createTicket(root, "task", "Third", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:52:00Z"),
    });

    const limited = await runCli(["--root", root, "list", "--limit", "2", "--json"]);
    assert.equal(limited.code, 0, limited.stderr);
    assert.equal(JSON.parse(limited.stdout).length, 2);

    for (const value of ["0", "-1"]) {
      const result = await runCli(["--root", root, "list", "--limit", value]);
      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /--limit must be a positive integer/);
    }
  });
});

test("move done archives old done tickets but leaves recent and current done tickets", async () => {
  await withBoard(async (root) => {
    const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const oldDonePath = await createTicket(root, "epic", "Old done ticket", {
      status: "done",
      now: daysAgo(60),
    });
    const recentDonePath = await createTicket(root, "epic", "Recent done ticket", {
      status: "done",
      now: daysAgo(1),
    });
    await recordEpicDecomposition(oldDonePath);
    await recordEpicDecomposition(recentDonePath);
    const currentPath = await createTicket(root, "epic", "Current closeout", {
      status: "ready_for_decomposition",
      now: new Date(),
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

test("CLI estimate command writes estimate and basis with validation, force, and config override", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const ticketCreate = await runCli([
      "--root",
      root,
      "create",
      "task",
      "Estimate target",
      "--status",
      "ready_for_design",
      "--priority",
      "P2",
    ]);
    assert.equal(ticketCreate.code, 0);
    const ticketPath = ticketCreate.stdout.trim();
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    // Happy path: default basis bootstrap
    const happy = await runCli(["--root", root, "estimate", ticketId, "4"]);
    assert.equal(happy.code, 0, happy.stderr);
    const happyText = await readFile(ticketPath, "utf8");
    assert.match(happyText, /^estimate: 4$/m);
    assert.match(happyText, /^estimateBasis: bootstrap$/m);

    // Out-of-scale rejection
    const outOfScale = await runCli(["--root", root, "estimate", ticketId, "3", "--force"]);
    assert.equal(outOfScale.code, 2);
    assert.match(outOfScale.stderr, /not in estimation\.scale/);

    // Non-integer rejection (2.5)
    const decimal = await runCli(["--root", root, "estimate", ticketId, "2.5", "--force"]);
    assert.equal(decimal.code, 2);
    assert.match(decimal.stderr, /must be an integer/);

    // Non-integer rejection (abc)
    const alpha = await runCli(["--root", root, "estimate", ticketId, "abc", "--force"]);
    assert.equal(alpha.code, 2);
    assert.match(alpha.stderr, /must be an integer/);

    // Overwrite refusal without --force
    const overwriteFail = await runCli(["--root", root, "estimate", ticketId, "2"]);
    assert.equal(overwriteFail.code, 2);
    assert.match(overwriteFail.stderr, /pass --force to overwrite/);
    const stillFour = await readFile(ticketPath, "utf8");
    assert.match(stillFour, /^estimate: 4$/m);

    // Overwrite with --force, --basis bootstrap
    const forceOverwrite = await runCli([
      "--root",
      root,
      "estimate",
      ticketId,
      "2",
      "--basis",
      "bootstrap",
      "--force",
    ]);
    assert.equal(forceOverwrite.code, 0, forceOverwrite.stderr);
    const afterForce = await readFile(ticketPath, "utf8");
    assert.match(afterForce, /^estimate: 2$/m);
    assert.match(afterForce, /^estimateBasis: bootstrap$/m);

    // --basis valid ticket id
    const basisCreate = await runCli([
      "--root",
      root,
      "create",
      "task",
      "Basis ticket",
      "--status",
      "ready_for_design",
      "--priority",
      "P2",
    ]);
    assert.equal(basisCreate.code, 0);
    const basisId = path.basename(basisCreate.stdout.trim()).split("_", 1)[0];

    const validBasis = await runCli([
      "--root",
      root,
      "estimate",
      ticketId,
      "8",
      "--basis",
      basisId,
      "--force",
    ]);
    assert.equal(validBasis.code, 0, validBasis.stderr);
    const afterBasis = await readFile(ticketPath, "utf8");
    assert.match(afterBasis, /^estimate: 8$/m);
    assert.match(afterBasis, new RegExp(`^estimateBasis: ${basisId}$`, "m"));

    // --basis malformed (not a ticket id)
    const malformed = await runCli([
      "--root",
      root,
      "estimate",
      ticketId,
      "1",
      "--basis",
      "not-a-ticket",
      "--force",
    ]);
    assert.equal(malformed.code, 2);
    assert.match(malformed.stderr, /--basis must be "bootstrap" or a ticket id/);

    // --basis non-existent ticket id
    const missingBasis = await runCli([
      "--root",
      root,
      "estimate",
      ticketId,
      "1",
      "--basis",
      "T20990101T0000Z",
      "--force",
    ]);
    assert.equal(missingBasis.code, 2);
    assert.match(missingBasis.stderr, /ticket T20990101T0000Z not found/);

    // Validate after writes still ok
    const validateAfter = await runCli(["--root", root, "validate", "--json"]);
    assert.equal(validateAfter.code, 0, validateAfter.stderr);
    assert.equal(JSON.parse(validateAfter.stdout).ok, true);
  });
});

test("CLI estimate honors a config override scale", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      JSON.stringify({
        estimation: { enabled: true, scale: [1, 3, 5], bootstrapDefault: 3, splitThreshold: 16 },
      }),
      "utf8",
    );

    const ticketCreate = await runCli([
      "--root",
      root,
      "create",
      "task",
      "Override scale target",
      "--status",
      "ready_for_design",
      "--priority",
      "P2",
    ]);
    assert.equal(ticketCreate.code, 0);
    const ticketPath = ticketCreate.stdout.trim();
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    // Default 4 is no longer in scale -> rejected
    const rejected = await runCli(["--root", root, "estimate", ticketId, "4"]);
    assert.equal(rejected.code, 2);
    assert.match(rejected.stderr, /not in estimation\.scale \[1, 3, 5\]/);

    // 3 is in the override scale -> accepted
    const accepted = await runCli(["--root", root, "estimate", ticketId, "3"]);
    assert.equal(accepted.code, 0, accepted.stderr);
    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /^estimate: 3$/m);
    assert.match(text, /^estimateBasis: bootstrap$/m);
  });
});

test("CLI calibration suggest prints calibration id or bootstrap", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const targetCreate = await runCli([
      "--root",
      root,
      "create",
      "task",
      "Calibration target",
      "--status",
      "ready_for_implementation",
      "--priority",
      "P2",
    ]);
    assert.equal(targetCreate.code, 0);
    const targetId = path.basename(targetCreate.stdout.trim()).split("_", 1)[0];

    // Empty pool -> bootstrap, both plain and JSON.
    const bootstrap = await runCli(["--root", root, "calibration", "suggest", targetId]);
    assert.equal(bootstrap.code, 0, bootstrap.stderr);
    assert.equal(bootstrap.stdout.trim(), "bootstrap");

    const bootstrapJson = await runCli(["--root", root, "calibration", "suggest", targetId, "--json"]);
    assert.equal(bootstrapJson.code, 0, bootstrapJson.stderr);
    const bootstrapRecord = JSON.parse(bootstrapJson.stdout);
    assert.equal(bootstrapRecord.calibration, "bootstrap");
    assert.equal(bootstrapRecord.poolSize, 0);
    assert.equal(bootstrapRecord.median, null);
    assert.equal(bootstrapRecord.ticket, targetId);
    assert.match(bootstrapRecord.reason, /No prior calibrated tickets of type task/);

    // Seed a populated pool: three done tasks (estimates 1, 2, 4) and one done bug as a foil.
    const seed = async (title, type, estimate, completedAt, status = "done") => {
      const create = await runCli([
        "--root",
        root,
        "create",
        type,
        title,
        "--status",
        status,
        "--priority",
        "P2",
      ]);
      assert.equal(create.code, 0, create.stderr);
      const ticketPath = create.stdout.trim();
      const text = await readFile(ticketPath, "utf8");
      const rewritten = text
        .replace("estimate: null", `estimate: ${estimate}`)
        .replace("estimateBasis: null", "estimateBasis: bootstrap")
        .replace("workStartedAt: null", "workStartedAt: 2026-05-14T21:00:00Z")
        .replace("workCompletedAt: null", `workCompletedAt: ${completedAt}`);
      await writeFile(ticketPath, rewritten, "utf8");
      return path.basename(ticketPath).split("_", 1)[0];
    };
    await seed("Done task 1", "task", 1, "2026-05-14T22:00:00Z");
    const mid = await seed("Done task 2", "task", 2, "2026-05-14T22:01:00Z");
    await seed("Done task 4", "task", 4, "2026-05-14T22:02:00Z");
    await seed("Done bug foil", "bug", 8, "2026-05-14T22:03:00Z");

    const populated = await runCli(["--root", root, "calibration", "suggest", targetId]);
    assert.equal(populated.code, 0, populated.stderr);
    // Lower-median of [1, 2, 4] is 2; the estimate-2 ticket is the pick.
    assert.equal(populated.stdout.trim(), mid);

    const populatedJson = await runCli(["--root", root, "calibration", "suggest", targetId, "--json"]);
    assert.equal(populatedJson.code, 0, populatedJson.stderr);
    const record = JSON.parse(populatedJson.stdout);
    assert.equal(record.ticket, targetId);
    assert.equal(record.calibration, mid);
    assert.equal(record.poolSize, 3);
    assert.equal(record.median, 2);
    assert.equal(typeof record.reason, "string");
  });
});

test("CLI calibration suggest exits 2 for unknown ticket id and missing argument", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const unknown = await runCli(["--root", root, "calibration", "suggest", "T20990101T0000Z"]);
    assert.equal(unknown.code, 2);
    assert.match(unknown.stderr, /not found/);

    const missing = await runCli(["--root", root, "calibration", "suggest"]);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /requires.*<ticket-id>/);
  });
});

test("CLI gate-check resolves catalog, prompt path, and ticket context per stage", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const create = await runCli([
      "--root",
      root,
      "create",
      "task",
      "Gate-check target",
      "--status",
      "ready_for_design",
      "--priority",
      "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketPath = create.stdout.trim();
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    // Happy path: design stage
    const design = await runCli(["--root", root, "gate-check", ticketId, "--stage", "design", "--json"]);
    assert.equal(design.code, 0, design.stderr);
    const designOut = JSON.parse(design.stdout);
    assert.equal(designOut.ticket, ticketId);
    assert.equal(designOut.stage, "design");
    assert.equal(designOut.prompt.endsWith(path.join("plans", "prompts", "steps", "gate-check.md")), true);
    // gate-check resolves its configured agent profile (haiku in the default config).
    assert.equal(designOut.agent, "claude-subagent:local-board-gatecheck");
    assert.equal(designOut.model, "haiku");
    assert.equal(designOut.ticketContext.id, ticketId);
    assert.equal(designOut.ticketContext.status, "ready_for_design");
    assert.equal(designOut.ticketContext.currentAction, "design");
    assert.equal(Array.isArray(designOut.catalog), true);
    assert.equal(designOut.catalog.length, 3);
    assert.deepEqual(
      designOut.catalog.map((entry) => entry.name),
      ["security_threat_model", "ui_component_review", "ux_interaction_review"],
    );
    // Default catalog entries omit agent field
    for (const entry of designOut.catalog) {
      assert.equal(Object.hasOwn(entry, "agent"), false, `entry ${entry.name} should omit agent when absent in config`);
    }

    // Happy path: implement stage
    const implement = await runCli(["--root", root, "gate-check", ticketId, "--stage", "implement", "--json"]);
    assert.equal(implement.code, 0, implement.stderr);
    const implementOut = JSON.parse(implement.stdout);
    assert.equal(implementOut.stage, "implement");
    assert.deepEqual(
      implementOut.catalog.map((entry) => entry.name),
      ["security_audit", "ui_visual_review"],
    );
    // No design names leak in
    for (const entry of implementOut.catalog) {
      assert.ok(!["security_threat_model", "ui_component_review", "ux_interaction_review"].includes(entry.name));
    }

    // Empty-catalog stage (test) returns success with empty array
    const testStage = await runCli(["--root", root, "gate-check", ticketId, "--stage", "test", "--json"]);
    assert.equal(testStage.code, 0, testStage.stderr);
    const testOut = JSON.parse(testStage.stdout);
    assert.deepEqual(testOut.catalog, []);
    assert.equal(typeof testOut.prompt, "string");
    assert.equal(testOut.prompt.length > 0, true);

    // Plain (non-JSON) output smoke
    const plain = await runCli(["--root", root, "gate-check", ticketId, "--stage", "design"]);
    assert.equal(plain.code, 0, plain.stderr);
    const plainLines = plain.stdout.split("\n");
    assert.match(plainLines[0], /^gate-check .* stage=design agent=\S+ catalog=3$/);
    assert.equal(plainLines[1].endsWith(path.join("plans", "prompts", "steps", "gate-check.md")), true);
  });
});

test("CLI gate-check returns empty catalog when optionalSteps is omitted from config", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    // Overwrite the config with a minimal one that drops optionalSteps entirely.
    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      JSON.stringify({ version: 1 }),
      "utf8",
    );

    const create = await runCli([
      "--root",
      root,
      "create",
      "task",
      "Gate-check empty catalog",
      "--status",
      "ready_for_design",
      "--priority",
      "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const result = await runCli(["--root", root, "gate-check", ticketId, "--stage", "design", "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.deepEqual(out.catalog, []);
  });
});

test("CLI gate-check rejects invalid stage, missing stage, and unknown ticket", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const create = await runCli([
      "--root",
      root,
      "create",
      "task",
      "Gate-check errors",
      "--status",
      "ready_for_design",
      "--priority",
      "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const invalidStage = await runCli(["--root", root, "gate-check", ticketId, "--stage", "docs"]);
    assert.equal(invalidStage.code, 2);
    assert.match(invalidStage.stderr, /--stage must be one of design, implement, test/);

    const missingStage = await runCli(["--root", root, "gate-check", ticketId]);
    assert.equal(missingStage.code, 2);
    assert.match(missingStage.stderr, /gate-check requires/);

    const unknown = await runCli(["--root", root, "gate-check", "T20990101T0000Z", "--stage", "design"]);
    assert.equal(unknown.code, 2);
    assert.match(unknown.stderr, /ticket T20990101T0000Z not found/);
  });
});

test("CLI completes an optional specialty step and the board still validates", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    const create = await runCli([
      "--root", root, "create", "task", "Specialty completion",
      "--status", "ready_for_implementation", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const id = path.basename(create.stdout.trim()).split("_", 1)[0];

    // security_audit is in the default optionalSteps.implement catalog and routes inline.
    const done = await runCli([
      "--root", root, "complete-step", id, "security_audit",
      "--executor", "inline", "--evidence", "PASS: no findings",
    ]);
    assert.equal(done.code, 0, done.stderr);

    const val = await runCli(["--root", root, "validate"]);
    assert.equal(val.code, 0, val.stderr);
  });
});

test("CLI complete-step rejects a model on an inline executor", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    const create = await runCli([
      "--root", root, "create", "task", "Inline model rejection",
      "--status", "ready_for_review", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const id = path.basename(create.stdout.trim()).split("_", 1)[0];

    const res = await runCli([
      "--root", root, "complete-step", id, "review",
      "--executor", "inline@opus", "--evidence", "x",
    ]);
    assert.notEqual(res.code, 0);
    assert.match(res.stderr, /executor must be/);
  });
});

test("CLI specialty-run dispatches to optionalSteps catalog by status-derived stage", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    // Case 1: implementing status -> implement stage, step security_audit, agent default inline.
    const implCreate = await runCli([
      "--root",
      root,
      "create",
      "task",
      "Specialty implementing target",
      "--status",
      "implementing",
      "--priority",
      "P2",
    ]);
    assert.equal(implCreate.code, 0, implCreate.stderr);
    const implId = path.basename(implCreate.stdout.trim()).split("_", 1)[0];

    const impl = await runCli(["--root", root, "specialty-run", implId, "security_audit", "--json"]);
    assert.equal(impl.code, 0, impl.stderr);
    const implOut = JSON.parse(impl.stdout);
    assert.equal(implOut.ticket, implId);
    assert.equal(implOut.stage, "implement");
    assert.equal(implOut.step, "security_audit");
    assert.equal(implOut.agent, "inline");
    assert.equal(typeof implOut.ticketPath, "string");
    assert.equal(
      implOut.prompt.endsWith(path.join("plans", "prompts", "optional-steps", "impl", "security_audit.md")),
      true,
    );
    // ticketContext shape mirrors gate-check
    assert.deepEqual(
      Object.keys(implOut.ticketContext).sort(),
      [
        "acceptanceCriteria",
        "currentAction",
        "id",
        "path",
        "priority",
        "requirement",
        "status",
        "title",
        "type",
      ],
    );
    assert.equal(implOut.ticketContext.id, implId);
    assert.equal(implOut.ticketContext.status, "implementing");
    assert.equal(implOut.ticketContext.currentAction, null);

    // Case 10: re-run case 1 and deep-equal the parsed outputs to pin stability.
    const implAgain = await runCli(["--root", root, "specialty-run", implId, "security_audit", "--json"]);
    assert.equal(implAgain.code, 0, implAgain.stderr);
    assert.deepEqual(JSON.parse(implAgain.stdout), implOut);

    // Case 9: plain (non-JSON) output smoke test
    const plain = await runCli(["--root", root, "specialty-run", implId, "security_audit"]);
    assert.equal(plain.code, 0, plain.stderr);
    const plainLines = plain.stdout.split("\n");
    assert.match(plainLines[0], /^specialty-run .* step=security_audit stage=implement agent=inline$/);
    assert.equal(
      plainLines[1].endsWith(path.join("plans", "prompts", "optional-steps", "impl", "security_audit.md")),
      true,
    );

    // Case 2: ready_for_design status -> design stage, step ui_component_review
    const designCreate = await runCli([
      "--root",
      root,
      "create",
      "task",
      "Specialty design target",
      "--status",
      "ready_for_design",
      "--priority",
      "P2",
    ]);
    assert.equal(designCreate.code, 0, designCreate.stderr);
    const designId = path.basename(designCreate.stdout.trim()).split("_", 1)[0];

    const design = await runCli(["--root", root, "specialty-run", designId, "ui_component_review", "--json"]);
    assert.equal(design.code, 0, design.stderr);
    const designOut = JSON.parse(design.stdout);
    assert.equal(designOut.stage, "design");
    assert.equal(designOut.step, "ui_component_review");
    assert.equal(designOut.agent, "inline");
    assert.equal(designOut.ticketContext.currentAction, "design");
    assert.equal(
      designOut.prompt.endsWith(path.join("plans", "prompts", "optional-steps", "design", "ui_component_review.md")),
      true,
    );

    // Case 5: unknown step name rejected; error lists available names.
    const unknownStep = await runCli(["--root", root, "specialty-run", designId, "nope_step"]);
    assert.equal(unknownStep.code, 2);
    assert.match(unknownStep.stderr, /step nope_step not found in optionalSteps\.design/);
    assert.match(unknownStep.stderr, /security_threat_model/);
    assert.match(unknownStep.stderr, /ui_component_review/);
    assert.match(unknownStep.stderr, /ux_interaction_review/);

    // Case 6: unmapped statuses rejected (ready_for_review, done, backlog, questions).
    const reviewCreate = await runCli([
      "--root",
      root,
      "create",
      "task",
      "Specialty review target",
      "--status",
      "ready_for_review",
      "--priority",
      "P2",
    ]);
    assert.equal(reviewCreate.code, 0, reviewCreate.stderr);
    const reviewId = path.basename(reviewCreate.stdout.trim()).split("_", 1)[0];

    const unmappedReview = await runCli(["--root", root, "specialty-run", reviewId, "security_audit"]);
    assert.equal(unmappedReview.code, 2);
    assert.match(unmappedReview.stderr, /status ready_for_review has no specialty stage/);

    for (const status of ["done", "backlog", "questions"]) {
      const c = await runCli([
        "--root",
        root,
        "create",
        "task",
        `Specialty unmapped ${status}`,
        "--status",
        status,
        "--priority",
        "P2",
      ]);
      assert.equal(c.code, 0, c.stderr);
      const tid = path.basename(c.stdout.trim()).split("_", 1)[0];
      const result = await runCli(["--root", root, "specialty-run", tid, "security_audit"]);
      assert.equal(result.code, 2);
      assert.match(result.stderr, new RegExp(`status ${status} has no specialty stage`));
    }

    // Case 7: unknown ticket rejected.
    const unknownTicket = await runCli(["--root", root, "specialty-run", "T20990101T0000Z", "security_audit"]);
    assert.equal(unknownTicket.code, 2);
    assert.match(unknownTicket.stderr, /ticket T20990101T0000Z not found/);

    // Case 11: missing positional arguments rejected.
    const noArgs = await runCli(["--root", root, "specialty-run"]);
    assert.equal(noArgs.code, 2);
    assert.match(noArgs.stderr, /specialty-run requires/);
    const oneArg = await runCli(["--root", root, "specialty-run", implId]);
    assert.equal(oneArg.code, 2);
    assert.match(oneArg.stderr, /specialty-run requires/);
  });
});

test("CLI specialty-run rejects when stage catalog is empty", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    // Default config has empty optionalSteps.test, so any step name lookup must fail.
    const testCreate = await runCli([
      "--root",
      root,
      "create",
      "task",
      "Specialty empty-test target",
      "--status",
      "ready_for_test",
      "--priority",
      "P2",
    ]);
    assert.equal(testCreate.code, 0, testCreate.stderr);
    const testId = path.basename(testCreate.stdout.trim()).split("_", 1)[0];

    const emptyResult = await runCli(["--root", root, "specialty-run", testId, "anything"]);
    assert.equal(emptyResult.code, 2);
    assert.match(emptyResult.stderr, /optionalSteps\.test \(available: none\)/);
  });
});

test("CLI specialty-run returns per-entry agent override when configured", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    // Overwrite the seeded config with a minimal catalog that has a single design entry with an agent override.
    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      JSON.stringify({
        version: 1,
        optionalSteps: {
          design: [
            {
              name: "custom_review",
              prompt: "plans/prompts/optional-steps/design/custom_review.md",
              triggers: "Anything touched by the custom review.",
              agent: "codex-task:read-only",
            },
          ],
          implement: [],
          test: [],
        },
      }),
      "utf8",
    );

    const create = await runCli([
      "--root",
      root,
      "create",
      "task",
      "Specialty override target",
      "--status",
      "ready_for_design",
      "--priority",
      "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const result = await runCli(["--root", root, "specialty-run", ticketId, "custom_review", "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.equal(out.agent, "codex-task:read-only");
    assert.equal(out.step, "custom_review");
    assert.equal(out.stage, "design");
  });
});

test("CLI specialty-run status-to-stage mapping covers every status", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    // Overwrite the seeded config with a non-empty test catalog so that
    // testing/ready_for_test can be exercised against a populated stage. The
    // empty-test rejection branch is then asserted afterward against the
    // default seed (which has optionalSteps.test = []).
    const fullConfigPath = path.join(root, "plans", "local-board.config.jsonc");
    await writeFile(
      fullConfigPath,
      JSON.stringify({
        version: 1,
        optionalSteps: {
          design: [
            {
              name: "security_threat_model",
              prompt: "plans/prompts/optional-steps/design/security_threat_model.md",
              triggers: "Auth, authorization, cryptography, external API integrations, PII handling, new attack surface.",
            },
          ],
          implement: [
            {
              name: "security_audit",
              prompt: "plans/prompts/optional-steps/impl/security_audit.md",
              triggers: "Changes to auth code, input validation, external API calls, credential handling.",
            },
          ],
          test: [
            {
              name: "perf_smoke",
              prompt: "plans/prompts/optional-steps/test/perf_smoke.md",
              triggers: "Hot paths, query plans, large input fixtures.",
            },
          ],
        },
      }),
      "utf8",
    );

    // Table-driven coverage of statusToStage. Success cases exit 0 with the
    // expected resolved stage; reject-unmapped cases exit 2 with the
    // unmapped-status error; the empty-catalog branch is asserted afterward.
    const successCases = [
      { status: "designing", stage: "design", step: "security_threat_model" },
      { status: "ready_for_design", stage: "design", step: "security_threat_model" },
      { status: "implementing", stage: "implement", step: "security_audit" },
      { status: "ready_for_implementation", stage: "implement", step: "security_audit" },
      { status: "testing", stage: "test", step: "perf_smoke" },
      { status: "ready_for_test", stage: "test", step: "perf_smoke" },
    ];

    for (const { status, stage, step } of successCases) {
      const c = await runCli([
        "--root",
        root,
        "create",
        "task",
        `Specialty success ${status}`,
        "--status",
        status,
        "--priority",
        "P2",
      ]);
      assert.equal(c.code, 0, c.stderr);
      const tid = path.basename(c.stdout.trim()).split("_", 1)[0];
      const r = await runCli(["--root", root, "specialty-run", tid, step, "--json"]);
      assert.equal(r.code, 0, `${status}: ${r.stderr}`);
      const out = JSON.parse(r.stdout);
      assert.equal(out.ticket, tid, `${status}: ticket id`);
      assert.equal(out.stage, stage, `${status}: resolved stage`);
      assert.equal(out.step, step, `${status}: resolved step`);
      assert.equal(out.agent, "inline", `${status}: default agent`);
      assert.equal(out.ticketContext.status, status, `${status}: ticketContext.status`);
    }

    const rejectUnmappedCases = [
      "ready_for_review",
      "reviewing",
      "ready_for_docs",
      "backlog",
      "questions",
      "blocked",
      "done",
      "archived",
    ];

    for (const status of rejectUnmappedCases) {
      const c = await runCli([
        "--root",
        root,
        "create",
        "task",
        `Specialty reject ${status}`,
        "--status",
        status,
        "--priority",
        "P2",
      ]);
      assert.equal(c.code, 0, c.stderr);
      const tid = path.basename(c.stdout.trim()).split("_", 1)[0];
      const r = await runCli(["--root", root, "specialty-run", tid, "security_audit"]);
      assert.equal(r.code, 2, `${status} should reject; stderr=${r.stderr}`);
      assert.match(
        r.stderr,
        new RegExp(`status ${status} has no specialty stage`),
        `${status} unmapped error message`,
      );
    }

    // Empty-catalog branch for testing/ready_for_test against the default seed.
    // The brief explicitly requires asserting that the seeded test=[] catalog
    // rejects with the "(available: none)" suffix.
    await rm(fullConfigPath, { force: true });
    for (const status of ["testing", "ready_for_test"]) {
      const c = await runCli([
        "--root",
        root,
        "create",
        "task",
        `Specialty empty-test ${status}`,
        "--status",
        status,
        "--priority",
        "P2",
      ]);
      assert.equal(c.code, 0, c.stderr);
      const tid = path.basename(c.stdout.trim()).split("_", 1)[0];
      const r = await runCli(["--root", root, "specialty-run", tid, "anything"]);
      assert.equal(r.code, 2, `${status} empty-test: ${r.stderr}`);
      assert.match(
        r.stderr,
        /optionalSteps\.test \(available: none\)/,
        `${status}: empty test catalog error`,
      );
    }
  });
});

test("optionalSteps catalog prompt paths resolve to existing non-empty files on disk", async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const config = await loadConfig(repoRoot);
  const stages = Object.keys(config.optionalSteps || {});
  assert.ok(stages.length > 0, "optionalSteps must define at least one stage");

  let entryCount = 0;
  for (const stage of stages) {
    const entries = config.optionalSteps[stage];
    assert.ok(Array.isArray(entries), `optionalSteps.${stage} must be an array`);
    for (const entry of entries) {
      assert.ok(
        typeof entry.prompt === "string" && entry.prompt.length > 0,
        `optionalSteps.${stage}[${entry.name}] missing prompt path`,
      );
      const absolute = path.resolve(repoRoot, entry.prompt);
      const stat = statSync(absolute);
      assert.ok(stat.isFile(), `${entry.prompt} is not a file`);
      assert.ok(stat.size > 0, `${entry.prompt} is empty`);
      entryCount += 1;
    }
  }

  assert.ok(entryCount >= 5, `expected at least 5 v1 prompt entries, saw ${entryCount}`);
});

test("estimation prompts are present and reference the estimate pipeline", async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const roleText = await readFile(
    path.join(repoRoot, "plans", "prompts", "roles", "estimator.md"),
    "utf8",
  );
  assert.ok(roleText.trim().length > 0, "estimator role prompt is non-empty");
  assert.ok(roleText.includes("bootstrap"), "estimator role mentions the bootstrap sentinel");

  const stepText = await readFile(
    path.join(repoRoot, "plans", "prompts", "steps", "estimate.md"),
    "utf8",
  );
  assert.ok(stepText.trim().length > 0, "estimate step prompt is non-empty");
  assert.ok(stepText.includes("local-board calibration suggest"), "estimate step references local-board calibration suggest");
  assert.ok(stepText.includes("local-board estimate"), "estimate step references local-board estimate");
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

async function replaceText(filePath, search, replacement) {
  const text = await readFile(filePath, "utf8");
  await writeFile(filePath, text.replace(search, replacement), "utf8");
}
