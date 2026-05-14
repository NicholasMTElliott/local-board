import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { createTicket, discover, nextTicket, validate } from "../src/tickets.js";

async function withBoard(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-board-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("create and validate ticket", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Implement validator", {
      status: "ready_for_design",
      priority: "P1",
      now: new Date("2026-05-14T20:56:00Z"),
    });

    assert.equal(path.basename(ticketPath), "T20260514T2056Z_implement-validator.md");
    assert.deepEqual(validate(await discover(root)), []);
  });
});

test("status folder mismatch is invalid", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "bug", "Fix folder mismatch", {
      status: "ready_for_test",
      now: new Date("2026-05-14T20:57:00Z"),
    });
    const moved = path.join(root, "plans", "tickets", "active", path.basename(ticketPath));
    await mkdir(path.dirname(moved), { recursive: true });
    await writeFile(moved, await readFile(ticketPath, "utf8"), "utf8");
    await rm(ticketPath);

    const issues = validate(await discover(root));
    assert.equal(issues.some((issue) => issue.includes("belongs in plans/tickets/ready/")), true);
  });
});

test("next ticket uses priority then created and allows done dependencies", async () => {
  await withBoard(async (root) => {
    const done = await createTicket(root, "task", "Completed dependency", {
      status: "done",
      priority: "P0",
      now: new Date("2026-05-14T20:50:00Z"),
    });
    const blocked = await createTicket(root, "task", "Blocked implementation", {
      status: "ready_for_implementation",
      priority: "P0",
      now: new Date("2026-05-14T20:51:00Z"),
    });
    await createTicket(root, "task", "Ready implementation", {
      status: "ready_for_implementation",
      priority: "P1",
      now: new Date("2026-05-14T20:52:00Z"),
    });

    const doneId = path.basename(done).split("_", 1)[0];
    const blockedId = path.basename(blocked).split("_", 1)[0];
    await replaceText(blocked, "blockedBy: []", `blockedBy: [${doneId}]`);
    await replaceText(done, "blocks: []", `blocks: [${blockedId}]`);

    const selected = nextTicket(await discover(root));

    assert.equal(selected?.path, path.resolve(blocked));
  });
});

test("next ticket skips open dependencies", async () => {
  await withBoard(async (root) => {
    const dependency = await createTicket(root, "task", "Open dependency", {
      status: "ready_for_design",
      priority: "P2",
      now: new Date("2026-05-14T20:53:00Z"),
    });
    const candidate = await createTicket(root, "task", "Candidate", {
      status: "ready_for_design",
      priority: "P0",
      now: new Date("2026-05-14T20:54:00Z"),
    });
    const fallback = await createTicket(root, "task", "Fallback", {
      status: "ready_for_design",
      priority: "P1",
      now: new Date("2026-05-14T20:55:00Z"),
    });

    const dependencyId = path.basename(dependency).split("_", 1)[0];
    const candidateId = path.basename(candidate).split("_", 1)[0];
    await replaceText(candidate, "blockedBy: []", `blockedBy: [${dependencyId}]`);
    await replaceText(dependency, "blocks: []", `blocks: [${candidateId}]`);

    const selected = nextTicket(await discover(root));

    assert.equal(selected?.path, path.resolve(fallback));
  });
});

async function replaceText(filePath, search, replacement) {
  const text = await readFile(filePath, "utf8");
  await writeFile(filePath, text.replace(search, replacement), "utf8");
}
