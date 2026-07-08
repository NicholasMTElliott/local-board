import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { main } from "../src/cli.js";
import {
  appendTicketComment,
  createTicket,
  discover,
  parseCommentLine,
  setTicketSection,
  validate,
} from "../src/tickets.js";
import { removeFixtureDir } from "./helpers/fixtures.js";

async function withBoard(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-board-comment-markers-"));
  try {
    await fn(root);
  } finally {
    await removeFixtureDir(root);
  }
}

// Mirrors the in-process CLI harness used by test/active-steps.test.js: calls
// main() directly (no subprocess spawn) and captures its console output plus
// the numeric exit code main() returns.
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

// --- CLI: --marker flags ---

test("comment --marker: repeated flags land in the rendered bracket block in CLI order", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "CLI marker target", {
      status: "backlog",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const result = await runCli([
      "--root",
      root,
      "comment",
      ticketId,
      "Reviewed via CLI.",
      "--marker",
      "step=implement",
      "--marker",
      "outcome=PASS",
    ]);
    assert.equal(result.code, 0, result.stderr);

    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /## Run Log\n\n- \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z: \[step:implement outcome:PASS\] Reviewed via CLI\./);
    assert.deepEqual(validate(await discover(root)), []);
  });
});

test("comment --marker: malformed flags exit non-zero with a clear message and write nothing", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "CLI marker rejection target", {
      status: "backlog",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    const before = await readFile(ticketPath, "utf8");

    const cases = [
      { args: ["--marker", "nokeyvalue"], expect: /must be in key=value form/ },
      { args: ["--marker", "k=has space"], expect: /--marker value/ },
      { args: ["--marker", "k=P@SS"], expect: /--marker value/ },
      { args: ["--marker", "bad key=value"], expect: /--marker key/ },
      { args: ["--marker", "k=a", "--marker", "k=b"], expect: /repeated/ },
      { args: ["--marker"], expect: /requires a value/ },
    ];

    for (const { args, expect } of cases) {
      const result = await runCli(["--root", root, "comment", ticketId, "text", ...args]);
      assert.equal(result.code, 2, `expected exit 2 for ${JSON.stringify(args)}, got ${result.code}`);
      assert.match(result.stderr, expect, `args ${JSON.stringify(args)} -> stderr "${result.stderr}"`);
    }

    // No malformed attempt should have mutated the ticket file.
    assert.equal(await readFile(ticketPath, "utf8"), before);
  });
});

// --- Rendering ---

test("appendTicketComment renders an ordered marker block between the timestamp prefix and body", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Marker render target", {
      status: "backlog",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await appendTicketComment(root, ticketId, "Run Log", "Reviewed the diff.", {
      now: new Date("2026-05-14T21:02:00Z"),
      markers: [
        { key: "step", value: "implement" },
        { key: "outcome", value: "PASS" },
        { key: "kind", value: "specialty" },
      ],
    });

    const text = await readFile(ticketPath, "utf8");
    assert.match(
      text,
      /## Run Log\n\n- 2026-05-14T21:02:00Z: \[step:implement outcome:PASS kind:specialty\] Reviewed the diff\./,
    );
    assert.deepEqual(validate(await discover(root)), []);
  });
});

test("appendTicketComment with no markers renders byte-identical to the pre-marker format", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "No marker render target", {
      status: "backlog",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await appendTicketComment(root, ticketId, "Run Log", "Checked the ticket.", {
      now: new Date("2026-05-14T21:02:00Z"),
    });

    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /## Run Log\n\n- 2026-05-14T21:02:00Z: Checked the ticket\./);
    assert.doesNotMatch(text, /## Run Log\n\n- 2026-05-14T21:02:00Z: \[/);
    assert.deepEqual(validate(await discover(root)), []);
  });
});

// --- parseCommentLine: round-trip, backward compat, graceful fallback ---

test("parseCommentLine round-trips a marked comment written by appendTicketComment", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Round trip target", {
      status: "backlog",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await appendTicketComment(root, ticketId, "Run Log", "Reviewed the diff.", {
      now: new Date("2026-05-14T21:02:00Z"),
      markers: [
        { key: "step", value: "implement" },
        { key: "outcome", value: "PASS" },
      ],
    });

    const text = await readFile(ticketPath, "utf8");
    const line = text
      .split("\n")
      .find((candidate) => candidate.startsWith("- 2026-05-14T21:02:00Z:"));
    assert.ok(line, "expected to find the rendered comment line");

    const parsed = parseCommentLine(line);
    assert.equal(parsed.timestamp, "2026-05-14T21:02:00Z");
    assert.deepEqual(parsed.markers, [
      { key: "step", value: "implement" },
      { key: "outcome", value: "PASS" },
    ]);
    assert.equal(parsed.body, "Reviewed the diff.");
  });
});

test("parseCommentLine: legacy unmarked comment parses to empty markers and the full body", () => {
  const parsed = parseCommentLine("- 2026-05-14T21:02:00Z: Checked the ticket.");
  assert.deepEqual(parsed, {
    timestamp: "2026-05-14T21:02:00Z",
    markers: [],
    body: "Checked the ticket.",
  });
});

test("parseCommentLine: stray or malformed brackets fall back to body without throwing", () => {
  const unclosed = parseCommentLine("- 2026-05-14T21:02:00Z: [unclosed body");
  assert.deepEqual(unclosed, {
    timestamp: "2026-05-14T21:02:00Z",
    markers: [],
    body: "[unclosed body",
  });

  const notMarkers = parseCommentLine("- 2026-05-14T21:02:00Z: [not markers here]");
  assert.deepEqual(notMarkers, {
    timestamp: "2026-05-14T21:02:00Z",
    markers: [],
    body: "[not markers here]",
  });

  const malformedToken = parseCommentLine("- 2026-05-14T21:02:00Z: [step:x outcome:P@SS] Bad value.");
  assert.deepEqual(malformedToken, {
    timestamp: "2026-05-14T21:02:00Z",
    markers: [],
    body: "[step:x outcome:P@SS] Bad value.",
  });

  const notComment = parseCommentLine("Some unrelated line with a - in it");
  assert.deepEqual(notComment, {
    timestamp: null,
    markers: [],
    body: "Some unrelated line with a - in it",
  });
});

// --- validate: marker syntax rule ---

test("validate flags a synthetically malformed marker line and does not flag a prose bracket aside", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Malformed marker fixture", {
      status: "backlog",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await setTicketSection(
      root,
      ticketId,
      "Run Log",
      [
        "- 2026-01-01T00:00:00Z: [see the notes above] Prose that happens to start with a bracket.",
        "",
        "- 2026-01-01T00:01:00Z: [step:x outcome:P@SS] Bad marker value.",
      ].join("\n"),
      { now: new Date("2026-01-01T00:02:00Z") },
    );

    const issues = validate(await discover(root));
    const markerIssues = issues.filter((issue) => issue.includes("malformed marker block"));
    assert.equal(markerIssues.length, 1, issues.join("\n"));
    assert.match(markerIssues[0], /P@SS/);
  });
});

test("validate ignores a marker-shaped line inside a code fence", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Fenced marker fixture", {
      status: "backlog",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    const fencedBody = [
      "Example transcript:",
      "",
      "```",
      "- 2026-01-01T00:00:00Z: [step:x outcome:P@SS] fake",
      "```",
    ].join("\n");

    await setTicketSection(root, ticketId, "Review Findings", fencedBody, {
      now: new Date("2026-01-01T00:02:00Z"),
    });

    const issues = validate(await discover(root));
    assert.deepEqual(
      issues.filter((issue) => issue.includes("malformed marker block")),
      [],
    );
  });
});

test("validate has no marker-syntax issues on the repo's existing ticket board", async () => {
  const issues = validate(await discover("."));
  assert.deepEqual(
    issues.filter((issue) => issue.includes("malformed marker block")),
    [],
  );
});
