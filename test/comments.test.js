import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { main } from "../src/cli.js";
import {
  appendTicketComment,
  collectComments,
  createTicket,
  findTicket,
  setTicketSection,
  stateReport,
} from "../src/tickets.js";
import { removeFixtureDir } from "./helpers/fixtures.js";

async function withBoard(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-board-comments-"));
  try {
    await fn(root);
  } finally {
    await removeFixtureDir(root);
  }
}

// Mirrors the in-process CLI harness used by test/comment-markers.test.js.
async function runCli(args) {
  const stdout = [];
  const stderr = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (message = "") => stdout.push(String(message));
  console.error = (message = "") => stderr.push(String(message));
  try {
    const code = await main(args);
    return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

async function makeTicket(root) {
  const ticketPath = await createTicket(root, "task", "Comments target", {
    status: "backlog",
    now: new Date("2026-07-08T20:00:00Z"),
  });
  return path.basename(ticketPath).split("_", 1)[0];
}

// --- collectComments: pure helper ---

test("collectComments: lists all comments, grouped by section, in document order; unmarked have empty markers", async () => {
  await withBoard(async (root) => {
    const ticketId = await makeTicket(root);

    await appendTicketComment(root, ticketId, "Run Log", "Reviewed the diff.", {
      now: new Date("2026-07-08T20:01:00Z"),
      markers: [{ key: "step", value: "design" }],
    });
    await appendTicketComment(root, ticketId, "Run Log", "Plain note.", {
      now: new Date("2026-07-08T20:02:00Z"),
    });
    await appendTicketComment(root, ticketId, "Test Evidence", "Ran tests.", {
      now: new Date("2026-07-08T20:03:00Z"),
      markers: [{ key: "outcome", value: "PASS" }],
    });

    const { ticket } = await findTicket(root, ticketId);
    const records = collectComments(ticket);

    // Document order, not insertion order: "Test Evidence" precedes "Run Log"
    // in the standard ticket template body.
    assert.deepEqual(
      records.map((r) => [r.section, r.timestamp, r.markers, r.body]),
      [
        ["Test Evidence", "2026-07-08T20:03:00Z", [{ key: "outcome", value: "PASS" }], "Ran tests."],
        ["Run Log", "2026-07-08T20:01:00Z", [{ key: "step", value: "design" }], "Reviewed the diff."],
        ["Run Log", "2026-07-08T20:02:00Z", [], "Plain note."],
      ],
    );
    for (const record of records) {
      assert.equal(record.ticket, ticketId);
    }
  });
});

test("collectComments: --section restricts to the exact heading; unknown section returns []", async () => {
  await withBoard(async (root) => {
    const ticketId = await makeTicket(root);

    await appendTicketComment(root, ticketId, "Run Log", "Reviewed the diff.", {
      now: new Date("2026-07-08T20:01:00Z"),
    });
    await appendTicketComment(root, ticketId, "Test Evidence", "Ran tests.", {
      now: new Date("2026-07-08T20:02:00Z"),
    });

    const { ticket } = await findTicket(root, ticketId);

    const runLog = collectComments(ticket, { section: "Run Log" });
    assert.equal(runLog.length, 1);
    assert.equal(runLog[0].section, "Run Log");

    const unknown = collectComments(ticket, { section: "Nope" });
    assert.deepEqual(unknown, []);
  });
});

test("collectComments: --marker AND semantics (single key, key pair, mismatched value excluded)", async () => {
  await withBoard(async (root) => {
    const ticketId = await makeTicket(root);

    await appendTicketComment(root, ticketId, "Run Log", "First.", {
      now: new Date("2026-07-08T20:01:00Z"),
      markers: [
        { key: "step", value: "x" },
        { key: "outcome", value: "PASS" },
      ],
    });
    await appendTicketComment(root, ticketId, "Run Log", "Second.", {
      now: new Date("2026-07-08T20:02:00Z"),
      markers: [
        { key: "step", value: "x" },
        { key: "outcome", value: "FAIL" },
      ],
    });
    await appendTicketComment(root, ticketId, "Run Log", "Third.", {
      now: new Date("2026-07-08T20:03:00Z"),
      markers: [{ key: "step", value: "y" }],
    });

    const { ticket } = await findTicket(root, ticketId);

    const stepXAndPass = collectComments(ticket, {
      markers: [
        { key: "step", value: "x" },
        { key: "outcome", value: "PASS" },
      ],
    });
    assert.deepEqual(stepXAndPass.map((r) => r.body), ["First."]);

    const stepXOnly = collectComments(ticket, { markers: [{ key: "step", value: "x" }] });
    assert.deepEqual(
      stepXOnly.map((r) => r.body).sort(),
      ["First.", "Second."],
    );

    const mismatchedValue = collectComments(ticket, {
      markers: [{ key: "step", value: "z" }],
    });
    assert.deepEqual(mismatchedValue, []);

    const noMarkerFilter = collectComments(ticket, { markers: [] });
    assert.equal(noMarkerFilter.length, 3);
  });
});

test("collectComments: a marker-shaped line inside a fenced code block is not returned", async () => {
  await withBoard(async (root) => {
    const ticketId = await makeTicket(root);
    const fencedBody = [
      "Example transcript:",
      "",
      "```",
      "- 2026-01-01T00:00:00Z: [step:x outcome:PASS] fake",
      "```",
    ].join("\n");

    await setTicketSection(root, ticketId, "Review Findings", fencedBody, {
      now: new Date("2026-07-08T20:01:00Z"),
    });

    const { ticket } = await findTicket(root, ticketId);
    const records = collectComments(ticket);
    assert.deepEqual(records, []);
  });
});

// --- CLI: comments ---

test("comments CLI: --json exact key shape; values match the writer", async () => {
  await withBoard(async (root) => {
    const ticketId = await makeTicket(root);

    await appendTicketComment(root, ticketId, "Run Log", "Reviewed the diff.", {
      now: new Date("2026-07-08T20:01:00Z"),
      markers: [
        { key: "step", value: "implement" },
        { key: "outcome", value: "PASS" },
      ],
    });

    const result = await runCli(["--root", root, "comments", ticketId, "--json"]);
    assert.equal(result.code, 0, result.stderr);

    const records = JSON.parse(result.stdout);
    assert.equal(records.length, 1);
    assert.deepEqual(Object.keys(records[0]), ["ticket", "section", "timestamp", "markers", "body"]);
    assert.deepEqual(records[0], {
      ticket: ticketId,
      section: "Run Log",
      timestamp: "2026-07-08T20:01:00Z",
      markers: [
        { key: "step", value: "implement" },
        { key: "outcome", value: "PASS" },
      ],
      body: "Reviewed the diff.",
    });
  });
});

test("comments CLI: unmarked comments appear with empty markers in --json and no bracket segment in human output", async () => {
  await withBoard(async (root) => {
    const ticketId = await makeTicket(root);

    await appendTicketComment(root, ticketId, "Run Log", "Marked one.", {
      now: new Date("2026-07-08T20:01:00Z"),
      markers: [{ key: "step", value: "design" }],
    });
    await appendTicketComment(root, ticketId, "Run Log", "Unmarked one.", {
      now: new Date("2026-07-08T20:02:00Z"),
    });

    const jsonResult = await runCli(["--root", root, "comments", ticketId, "--json"]);
    assert.equal(jsonResult.code, 0, jsonResult.stderr);
    const records = JSON.parse(jsonResult.stdout);
    const unmarked = records.find((r) => r.body === "Unmarked one.");
    assert.deepEqual(unmarked.markers, []);

    const humanResult = await runCli(["--root", root, "comments", ticketId]);
    assert.equal(humanResult.code, 0, humanResult.stderr);
    assert.match(humanResult.stdout, /Run Log/);
    assert.match(humanResult.stdout, /- 2026-07-08T20:01:00Z \[step:design\] Marked one\./);
    assert.match(humanResult.stdout, /- 2026-07-08T20:02:00Z Unmarked one\./);
    assert.doesNotMatch(humanResult.stdout, /2026-07-08T20:02:00Z \[/);
  });
});

test("comments CLI: --section restricts to that section; unknown section yields empty output, exit 0", async () => {
  await withBoard(async (root) => {
    const ticketId = await makeTicket(root);

    await appendTicketComment(root, ticketId, "Run Log", "Reviewed the diff.", {
      now: new Date("2026-07-08T20:01:00Z"),
    });
    await appendTicketComment(root, ticketId, "Test Evidence", "Ran tests.", {
      now: new Date("2026-07-08T20:02:00Z"),
    });

    const runLogOnly = await runCli(["--root", root, "comments", ticketId, "--section", "Run Log", "--json"]);
    assert.equal(runLogOnly.code, 0, runLogOnly.stderr);
    const runLogRecords = JSON.parse(runLogOnly.stdout);
    assert.equal(runLogRecords.length, 1);
    assert.equal(runLogRecords[0].section, "Run Log");

    const unknownJson = await runCli(["--root", root, "comments", ticketId, "--section", "Nope", "--json"]);
    assert.equal(unknownJson.code, 0, unknownJson.stderr);
    assert.deepEqual(JSON.parse(unknownJson.stdout), []);

    const unknownHuman = await runCli(["--root", root, "comments", ticketId, "--section", "Nope"]);
    assert.equal(unknownHuman.code, 0, unknownHuman.stderr);
    assert.equal(unknownHuman.stdout, "");
  });
});

test("comments CLI: --marker step=x --marker outcome=PASS returns only the fully-matching comment (AND)", async () => {
  await withBoard(async (root) => {
    const ticketId = await makeTicket(root);

    await appendTicketComment(root, ticketId, "Run Log", "First.", {
      now: new Date("2026-07-08T20:01:00Z"),
      markers: [
        { key: "step", value: "x" },
        { key: "outcome", value: "PASS" },
      ],
    });
    await appendTicketComment(root, ticketId, "Run Log", "Second.", {
      now: new Date("2026-07-08T20:02:00Z"),
      markers: [
        { key: "step", value: "x" },
        { key: "outcome", value: "FAIL" },
      ],
    });
    await appendTicketComment(root, ticketId, "Run Log", "Third.", {
      now: new Date("2026-07-08T20:03:00Z"),
      markers: [{ key: "step", value: "y" }],
    });

    const both = await runCli([
      "--root",
      root,
      "comments",
      ticketId,
      "--marker",
      "step=x",
      "--marker",
      "outcome=PASS",
      "--json",
    ]);
    assert.equal(both.code, 0, both.stderr);
    assert.deepEqual(JSON.parse(both.stdout).map((r) => r.body), ["First."]);

    const stepOnly = await runCli(["--root", root, "comments", ticketId, "--marker", "step=x", "--json"]);
    assert.equal(stepOnly.code, 0, stepOnly.stderr);
    assert.deepEqual(
      JSON.parse(stepOnly.stdout)
        .map((r) => r.body)
        .sort(),
      ["First.", "Second."],
    );
  });
});

test("comments CLI: a malformed --marker exits 2 with the same message as comment, and reads nothing", async () => {
  await withBoard(async (root) => {
    const ticketId = await makeTicket(root);

    const result = await runCli(["--root", root, "comments", ticketId, "--marker", "k=P@SS"]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /--marker value/);
  });
});

test("comments CLI: missing ticket id exits 2 with a usage message", async () => {
  await withBoard(async (root) => {
    const result = await runCli(["--root", root, "comments"]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /comments requires/);
  });
});

// --- state-report regression: comments/markers must not change its shape ---

test("state-report --json is unchanged by the comments feature (no new comment/marker keys)", async () => {
  await withBoard(async (root) => {
    const ticketId = await makeTicket(root);
    await appendTicketComment(root, ticketId, "Run Log", "Marked.", {
      now: new Date("2026-07-08T20:01:00Z"),
      markers: [{ key: "step", value: "design" }],
    });
    await appendTicketComment(root, ticketId, "Run Log", "Unmarked.", {
      now: new Date("2026-07-08T20:02:00Z"),
    });

    const report = await stateReport(root);
    assert.deepEqual(
      Object.keys(report).sort(),
      ["byAction", "byStatus", "byType", "eligible", "issues", "next", "ok", "total"],
    );

    const cliResult = await runCli(["--root", root, "state-report", "--json"]);
    assert.ok(cliResult.code === 0 || cliResult.code === 1, `unexpected exit code ${cliResult.code}`);
    const cliReport = JSON.parse(cliResult.stdout);
    assert.deepEqual(
      Object.keys(cliReport).sort(),
      ["byAction", "byStatus", "byType", "eligible", "issues", "next", "ok", "total"],
    );
  });
});
