import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

import {
  appendTicketComment,
  approveInline,
  archiveDoneTickets,
  beginStep,
  blockTicket,
  completeStep,
  composeExecutor,
  createTicket,
  discover,
  findTicket,
  gateConsultationRecords,
  gateStageForForwardMove,
  getSectionText,
  invalidateDownstreamEvidence,
  isTransitionAllowed,
  linkParent,
  moveTicket,
  nextTicket,
  parseFrontMatter,
  queryNext,
  queryTicket,
  recordGateConsultation,
  recordGateSkippedEmptyCatalog,
  renderMarkdownTicket,
  resolveExpectedStep,
  serializeFrontMatter,
  setTicketField,
  setTicketSection,
  stateReport,
  suggestCalibration,
  unblockTicket,
  unlinkParent,
  validate,
  writeTicketFile,
} from "../src/tickets.js";
import { initProject } from "../src/scaffold.js";
import { defaultConfigJsonc, loadConfig } from "../src/config.js";
import { readActiveSteps } from "../src/active-steps.js";
import { removeFixtureDir } from "./helpers/fixtures.js";

const execFileAsync = promisify(execFile);
const CLI_PATH = path.resolve("bin", "local-board.js");
const RUN_SLOW_TESTS = process.env.LOCAL_BOARD_SLOW_TESTS === "1";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withBoard(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-board-"));
  try {
    await fn(root);
  } finally {
    await removeFixtureDir(root);
  }
}

async function writeConfig(root, body) {
  await mkdir(path.join(root, "plans"), { recursive: true });
  await writeFile(path.join(root, "plans", "local-board.config.jsonc"), body, "utf8");
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

test("create advances timestamp to keep ticket ids unique", async () => {
  await withBoard(async (root) => {
    const first = await createTicket(root, "story", "First story", {
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const second = await createTicket(root, "story", "Second story", {
      now: new Date("2026-05-14T20:56:00Z"),
    });

    assert.equal(path.basename(first), "S20260514T2056Z_first-story.md");
    assert.equal(path.basename(second), "S20260514T2057Z_second-story.md");
    assert.deepEqual(validate(await discover(root)), []);
  });
});

test("collision-bumped id keeps a truthful created/updated stamp, not the bumped minute", async () => {
  await withBoard(async (root) => {
    const now = new Date("2026-05-14T20:56:00Z");
    await createTicket(root, "story", "First story", { now });
    const secondPath = await createTicket(root, "story", "Second story", { now });
    const secondId = path.basename(secondPath).split("_", 1)[0];

    // The id bumps a minute past `now` to stay unique...
    assert.equal(path.basename(secondPath), "S20260514T2057Z_second-story.md");

    // ...but created/updated must stay bound to the real `now`, not the bumped minute.
    const { ticket: second } = await findTicket(root, secondId);
    assert.equal(second.frontMatter.created, "2026-05-14T20:56:00Z");
    assert.equal(second.frontMatter.updated, "2026-05-14T20:56:00Z");
    assert.ok(
      new Date(second.frontMatter.updated).getTime() >= new Date(second.frontMatter.created).getTime(),
      "updated must never be earlier than created",
    );
  });
});

test("create with parent propagates truthful now through linkParent on collision-bumped ids", async () => {
  await withBoard(async (root) => {
    const now = new Date("2026-05-14T20:56:00Z");
    // Parent and child share a type (same id prefix) so the child's mint
    // collides with the parent's minute and must bump.
    const parentPath = await createTicket(root, "story", "Parent story", {
      status: "ready_for_decomposition",
      now,
    });
    const parentId = path.basename(parentPath).split("_", 1)[0];

    const childPath = await createTicket(root, "story", "Child story", {
      status: "ready_for_decomposition",
      parent: parentId,
      now,
    });
    const childId = path.basename(childPath).split("_", 1)[0];

    assert.notEqual(childId.slice(1), parentId.slice(1), "child id minute must have bumped past the parent's");

    const { ticket: child } = await findTicket(root, childId);
    assert.equal(child.frontMatter.created, "2026-05-14T20:56:00Z");
    assert.equal(child.frontMatter.updated, "2026-05-14T20:56:00Z");
    assert.ok(new Date(child.frontMatter.updated).getTime() >= new Date(child.frontMatter.created).getTime());

    const { ticket: parent } = await findTicket(root, parentId);
    assert.equal(parent.frontMatter.updated, "2026-05-14T20:56:00Z");
    assert.ok(new Date(parent.frontMatter.updated).getTime() >= new Date(parent.frontMatter.created).getTime());
  });
});

test("create with parent updates reciprocal parent and child fields", async () => {
  await withBoard(async (root) => {
    const parent = await createTicket(root, "epic", "Parent epic", {
      status: "ready_for_decomposition",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const parentId = path.basename(parent).split("_", 1)[0];

    const child = await createTicket(root, "story", "Child story", {
      status: "ready_for_decomposition",
      parent: parentId,
      now: new Date("2026-05-14T20:57:00Z"),
    });
    const childId = path.basename(child).split("_", 1)[0];

    assert.match(await readFile(parent, "utf8"), new RegExp(`^children: \\[${childId}\\]$`, "m"));
    assert.match(await readFile(child, "utf8"), new RegExp(`^parent: ${parentId}$`, "m"));
    assert.deepEqual(validate(await discover(root)), []);
  });
});

test("create with unknown parent fails before writing a child ticket", async () => {
  await withBoard(async (root) => {
    await assert.rejects(
      createTicket(root, "story", "Orphan story", {
        parent: "E20260514T2056Z",
        now: new Date("2026-05-14T20:56:00Z"),
      }),
      /parent E20260514T2056Z does not exist/,
    );

    assert.equal((await discover(root)).tickets.length, 0);
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

test("next ticket treats archived dependencies as closed", async () => {
  await withBoard(async (root) => {
    const archived = await createTicket(root, "task", "Archived dependency", {
      status: "archived",
      priority: "P0",
      now: new Date("2026-05-14T20:50:00Z"),
    });
    const blocked = await createTicket(root, "task", "Blocked by archive", {
      status: "ready_for_implementation",
      priority: "P0",
      now: new Date("2026-05-14T20:51:00Z"),
    });
    await createTicket(root, "task", "Fallback implementation", {
      status: "ready_for_implementation",
      priority: "P1",
      now: new Date("2026-05-14T20:52:00Z"),
    });

    const archivedId = path.basename(archived).split("_", 1)[0];
    const blockedId = path.basename(blocked).split("_", 1)[0];
    await replaceText(blocked, "blockedBy: []", `blockedBy: [${archivedId}]`);
    await replaceText(archived, "blocks: []", `blocks: [${blockedId}]`);

    assert.equal(nextTicket(await discover(root))?.path, path.resolve(blocked));
    assert.equal((await queryNext(root))?.ticket, blockedId);
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

test("validate rejects dependency-blocked tickets in blocked status", async () => {
  await withBoard(async (root) => {
    const dependency = await createTicket(root, "task", "Open dependency", {
      status: "ready_for_design",
      now: new Date("2026-05-14T20:53:00Z"),
    });
    const candidate = await createTicket(root, "task", "Misfiled dependency block", {
      status: "blocked",
      now: new Date("2026-05-14T20:54:00Z"),
    });
    const dependencyId = path.basename(dependency).split("_", 1)[0];
    const candidateId = path.basename(candidate).split("_", 1)[0];
    await replaceText(candidate, "blockedBy: []", `blockedBy: [${dependencyId}]`);
    await replaceText(dependency, "blocks: []", `blocks: [${candidateId}]`);

    const issues = validate(await discover(root));

    assert.equal(
      issues.some((issue) => issue.includes("dependency-blocked tickets must stay in their intended ready status")),
      true,
    );
  });
});

test("move rewrites status and relocates ticket", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Move me", {
      status: "ready_for_design",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const movedPath = await moveTicket(root, ticketId, "implementing", {
      now: new Date("2026-05-14T21:00:00Z"),
    });

    assert.equal(path.relative(root, movedPath), path.join("plans", "tickets", "active", path.basename(ticketPath)));
    const movedText = await readFile(movedPath, "utf8");
    assert.match(movedText, /^status: implementing$/m);
    assert.match(movedText, /^updated: 2026-05-14T21:00:00Z$/m);
    assert.deepEqual(validate(await discover(root)), []);
  });
});

test("moveTicket cross-folder rename failure leaves the ticket consistent at exactly one path", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Rename fails", {
      status: "ready_for_design",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const failingRename = async () => {
      const error = new Error("simulated disk full");
      error.code = "ENOSPC";
      throw error;
    };

    await assert.rejects(
      moveTicket(root, ticketId, "implementing", {
        now: new Date("2026-05-14T21:00:00Z"),
        renameFn: failingRename,
      }),
      /simulated disk full/,
    );

    const readyDir = path.join(root, "plans", "tickets", "ready");
    const activeDir = path.join(root, "plans", "tickets", "active");
    assert.deepEqual(await readdir(readyDir), [path.basename(ticketPath)]);
    // moveTicket pre-creates the target folder (mkdir recursive) before attempting the
    // rename, so it may exist; it must not contain the ticket (or anything else).
    assert.deepEqual(await readdir(activeDir), []);

    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /^status: ready_for_design$/m);

    const board = await discover(root);
    assert.deepEqual(validate(board, await loadConfig(root)), []);
  });
});

test("moveTicket cross-folder rename retries a transient Windows error and succeeds", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Rename retries", {
      status: "ready_for_design",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    let attempts = 0;
    const flakyRename = async (source, destination) => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("transient lock");
        error.code = "EPERM";
        throw error;
      }
      await rename(source, destination);
    };

    const movedPath = await moveTicket(root, ticketId, "implementing", {
      now: new Date("2026-05-14T21:00:00Z"),
      renameFn: flakyRename,
    });

    assert.ok(attempts >= 2);
    assert.equal(path.relative(root, movedPath), path.join("plans", "tickets", "active", path.basename(ticketPath)));

    const readyDir = path.join(root, "plans", "tickets", "ready");
    const activeDir = path.join(root, "plans", "tickets", "active");
    assert.deepEqual(await readdir(readyDir), []);
    assert.deepEqual(await readdir(activeDir), [path.basename(ticketPath)]);

    const text = await readFile(movedPath, "utf8");
    assert.match(text, /^status: implementing$/m);
    assert.deepEqual(validate(await discover(root)), []);
  });
});

test("moveTicket rolls back the rename when the in-place rewrite fails", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Rewrite fails after rename", {
      status: "ready_for_design",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    const originalText = await readFile(ticketPath, "utf8");

    let callCount = 0;
    const statefulRename = async (source, destination) => {
      callCount += 1;
      if (callCount === 2) {
        const error = new Error("simulated disk full");
        error.code = "ENOSPC";
        throw error;
      }
      await rename(source, destination);
    };

    await assert.rejects(
      moveTicket(root, ticketId, "implementing", {
        now: new Date("2026-05-14T21:00:00Z"),
        renameFn: statefulRename,
      }),
      /simulated disk full/,
    );

    const readyDir = path.join(root, "plans", "tickets", "ready");
    const activeDir = path.join(root, "plans", "tickets", "active");
    assert.deepEqual(await readdir(readyDir), [path.basename(ticketPath)]);
    assert.deepEqual(await readdir(activeDir), []);

    // File rolled back to the old path with its original (untouched) content.
    assert.equal(await readFile(ticketPath, "utf8"), originalText);

    const board = await discover(root);
    assert.deepEqual(validate(board, await loadConfig(root)), []);
  });
});

test("moveTicket within the same status folder rewrites in place without a cross-folder rename", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Same folder move", {
      status: "ready_for_review",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const calls = [];
    const trackingRename = async (source, destination) => {
      calls.push({ source: path.dirname(source), destination: path.dirname(destination) });
      await rename(source, destination);
    };

    const movedPath = await moveTicket(root, ticketId, "reviewing", {
      now: new Date("2026-05-14T21:00:00Z"),
      renameFn: trackingRename,
    });

    assert.equal(path.resolve(movedPath), path.resolve(ticketPath));
    // Only the in-place temp-file rename happens: source and destination directories
    // are identical for every recorded call (no cross-folder rename attempted).
    assert.ok(calls.length >= 1);
    for (const call of calls) {
      assert.equal(call.source, call.destination);
    }

    const text = await readFile(movedPath, "utf8");
    assert.match(text, /^status: reviewing$/m);
    const reviewDir = path.join(root, "plans", "tickets", "review");
    assert.deepEqual(await readdir(reviewDir), [path.basename(ticketPath)]);
    assert.deepEqual(validate(await discover(root)), []);
  });
});

test("setTicketField rewrites front matter without replacing the body", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Set field", {
      status: "backlog",
      priority: "P3",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    await replaceText(ticketPath, "## Implementation Notes\n", "## Implementation Notes\n\nKeep this note.\n");

    await setTicketField(root, ticketId, "priority", "P1", {
      now: new Date("2026-05-14T21:01:00Z"),
    });

    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /^priority: P1$/m);
    assert.match(text, /^updated: 2026-05-14T21:01:00Z$/m);
    assert.match(text, /Keep this note\./);
    assert.deepEqual(validate(await discover(root)), []);
  });
});

test("appendTicketComment adds timestamped section entry and updates front matter", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Comment target", {
      status: "backlog",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await appendTicketComment(root, ticketId, "Run Log", "Checked the ticket.", {
      now: new Date("2026-05-14T21:02:00Z"),
    });

    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /^updated: 2026-05-14T21:02:00Z$/m);
    assert.match(text, /## Run Log\n\n- 2026-05-14T21:02:00Z: Checked the ticket\./);
    assert.deepEqual(validate(await discover(root)), []);
  });
});

test("setTicketSection replaces section content and updates front matter", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Section target", {
      status: "backlog",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await setTicketSection(root, ticketId, "Requirement", "A clear requirement.", {
      now: new Date("2026-05-14T21:06:00Z"),
    });

    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /^updated: 2026-05-14T21:06:00Z$/m);
    assert.match(text, /## Requirement\n\nA clear requirement\.\n\n## Acceptance Criteria/);
    assert.deepEqual(validate(await discover(root)), []);
  });
});

for (const fence of ["```", "```md", "~~~"]) {
  test(`getSectionText round-trips a fenced heading-like line (fence: ${fence})`, async () => {
    await withBoard(async (root) => {
      const ticketPath = await createTicket(root, "task", "Fenced section target", {
        status: "backlog",
        now: new Date("2026-05-14T20:56:00Z"),
      });
      const ticketId = path.basename(ticketPath).split("_", 1)[0];
      const closer = fence.startsWith("~") ? "~~~" : "```";
      const fencedBody = `Sample template:\n\n${fence}\n## Fake Heading\nsome body text\n${closer}\n\nTrailing note.`;

      await setTicketSection(root, ticketId, "Review Findings", fencedBody, {
        now: new Date("2026-05-14T21:06:00Z"),
      });

      const text = await readFile(ticketPath, "utf8");
      assert.equal(getSectionText(text, "Review Findings"), fencedBody);
      // The fenced fake heading must not have been mistaken for the real
      // "Test Evidence" heading that follows it.
      assert.equal(getSectionText(text, "Test Evidence"), "");
      assert.deepEqual(validate(await discover(root)), []);
    });
  });
}

test("appendTicketComment lands in the true last section past a fenced heading in an earlier section", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Fenced append target", {
      status: "backlog",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    const fencedEvidence = "Ticket template sample:\n\n```\n## Documentation Updates\nfake content\n```";

    await setTicketSection(root, ticketId, "Test Evidence", fencedEvidence, {
      now: new Date("2026-05-14T21:00:00Z"),
    });
    await appendTicketComment(root, ticketId, "Run Log", "Checked past the fence.", {
      now: new Date("2026-05-14T21:02:00Z"),
    });

    const text = await readFile(ticketPath, "utf8");
    assert.equal(getSectionText(text, "Test Evidence"), fencedEvidence);
    assert.match(getSectionText(text, "Run Log"), /- 2026-05-14T21:02:00Z: Checked past the fence\./);
    assert.equal(getSectionText(text, "Documentation Updates"), "");
    assert.deepEqual(validate(await discover(root)), []);
  });
});

test("setTicketSection is idempotent across a double round-trip through a fenced heading-like line", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Idempotent fenced target", {
      status: "backlog",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    const fencedBody = "```\n## Fake Heading\n```";

    await setTicketSection(root, ticketId, "Review Findings", fencedBody, {
      now: new Date("2026-05-14T21:06:00Z"),
    });
    const firstRead = getSectionText(await readFile(ticketPath, "utf8"), "Review Findings");

    await setTicketSection(root, ticketId, "Review Findings", firstRead, {
      now: new Date("2026-05-14T21:07:00Z"),
    });
    const secondRead = getSectionText(await readFile(ticketPath, "utf8"), "Review Findings");

    assert.equal(firstRead, fencedBody);
    assert.equal(secondRead, fencedBody);
    assert.deepEqual(validate(await discover(root)), []);
  });
});

test("a genuine non-fenced heading still boundaries sections correctly (regression)", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Plain section target", {
      status: "backlog",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await setTicketSection(root, ticketId, "Test Evidence", "Plain evidence, no fences.", {
      now: new Date("2026-05-14T21:00:00Z"),
    });
    await setTicketSection(root, ticketId, "Documentation Updates", "Docs note.", {
      now: new Date("2026-05-14T21:01:00Z"),
    });

    const text = await readFile(ticketPath, "utf8");
    assert.equal(getSectionText(text, "Test Evidence"), "Plain evidence, no fences.");
    assert.equal(getSectionText(text, "Documentation Updates"), "Docs note.");
    assert.deepEqual(validate(await discover(root)), []);
  });
});

test("appendTicketComment into a non-last section preserves the blank-line separator before the next heading", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Non-last append target", {
      status: "backlog",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await appendTicketComment(root, ticketId, "Questions", "Is this in scope?", {
      now: new Date("2026-05-14T21:02:00Z"),
    });

    const text = await readFile(ticketPath, "utf8");
    assert.match(
      text,
      /- 2026-05-14T21:02:00Z: Is this in scope\?\n\n## Run Log/,
    );
    assert.deepEqual(validate(await discover(root)), []);
  });
});

test("appendTicketComment into a non-last section with a fenced heading-like line still preserves the separator", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Non-last fenced append target", {
      status: "backlog",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    const fencedQuestion = "Example prompt:\n\n```\n## Run Log\nfake content\n```";

    await setTicketSection(root, ticketId, "Questions", fencedQuestion, {
      now: new Date("2026-05-14T21:00:00Z"),
    });
    await appendTicketComment(root, ticketId, "Questions", "Follow-up after the fence.", {
      now: new Date("2026-05-14T21:02:00Z"),
    });

    const text = await readFile(ticketPath, "utf8");
    assert.match(
      text,
      /- 2026-05-14T21:02:00Z: Follow-up after the fence\.\n\n## Run Log/,
    );
    assert.equal(getSectionText(text, "Run Log"), "");
    assert.deepEqual(validate(await discover(root)), []);
  });
});

test("queryNext returns configured action and prefers closest pipeline phase after priority", async () => {
  await withBoard(async (root) => {
    await createTicket(root, "task", "Needs design", {
      status: "ready_for_design",
      priority: "P1",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const docs = await createTicket(root, "task", "Needs docs", {
      status: "ready_for_docs",
      priority: "P1",
      now: new Date("2026-05-14T20:57:00Z"),
    });

    const result = await queryNext(root);

    assert.equal(result?.ticket, path.basename(docs).split("_", 1)[0]);
    assert.equal(result?.action, "document");
    assert.equal(result?.prompt, "plans/prompts/steps/document.md");
    assert.equal(result?.agent, "codex-task:workspace-write");
    assert.equal(result?.transitions[0].status, "done");
  });
});

test("queryNext prioritizes priority before pipeline closeness", async () => {
  await withBoard(async (root) => {
    const design = await createTicket(root, "task", "Higher priority design", {
      status: "ready_for_design",
      priority: "P0",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    await createTicket(root, "task", "Lower priority docs", {
      status: "ready_for_docs",
      priority: "P1",
      now: new Date("2026-05-14T20:57:00Z"),
    });

    const result = await queryNext(root);

    assert.equal(result?.ticket, path.basename(design).split("_", 1)[0]);
    assert.equal(result?.action, "design");
  });
});

test("queryNext reports null when no actionable tickets remain", async () => {
  await withBoard(async (root) => {
    await createTicket(root, "task", "Not ready", {
      status: "backlog",
      priority: "P0",
      now: new Date("2026-05-14T20:56:00Z"),
    });

    assert.equal(await queryNext(root), null);
  });
});

test("queryTicket returns action bundle for a specific ticket", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Specific ticket", {
      status: "ready_for_review",
      priority: "P2",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const result = await queryTicket(root, ticketId);

    assert.equal(result.ticket, ticketId);
    assert.equal(result.action, "review");
    assert.equal(result.prompt, "plans/prompts/roles/code_reviewer.md");
    assert.equal(result.eligible, true);
    assert.deepEqual(
      result.transitions.slice(0, 3).map((transition) => transition.status),
      ["ready_for_test", "ready_for_implementation", "ready_for_design"],
    );
  });
});

test("beginStep reports strict configured routing for a ticket action", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Needs review", {
      status: "ready_for_review",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const result = await beginStep(root, ticketId);

    assert.equal(result.action, "review");
    assert.equal(result.configuredAgent, "codex-task:read-only");
    assert.equal(result.strict, true);
    assert.equal(result.delegationRequired, true);
    assert.equal(result.transitions[0].status, "ready_for_test");
  });
});

test("beginStep exposes the configured per-step model and prompt", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Needs design", {
      status: "ready_for_design",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const result = await beginStep(root, ticketId);

    assert.equal(result.action, "design");
    assert.equal(result.configuredAgent, "claude-subagent:local-board-designer");
    assert.equal(result.configuredModel, "opus");
    assert.equal(result.configuredPrompt, "plans/prompts/steps/design.md");
  });
});

test("beginStep resolves an implementing-status ticket via the ready_for_implementation fallback (the ordering footgun fix)", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Already implementing", {
      status: "implementing",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const result = await beginStep(root, ticketId);

    assert.equal(result.action, "implement");
    assert.equal(result.configuredAgent, "claude-subagent:local-board-implementer");
    assert.equal(result.configuredModel, "sonnet");
    assert.equal(result.status, "implementing");

    // Additive side effect: the active-step ledger is stamped exactly as it
    // would be for a resolve-before-start-work call.
    const steps = await readActiveSteps(root);
    assert.deepEqual(steps[ticketId], {
      ticket: ticketId,
      kind: "action",
      action: "implement",
      route: "claude-subagent:local-board-implementer",
      model: "sonnet",
      root: path.resolve(root),
      ts: steps[ticketId].ts,
    });
  });
});

test("beginStep resolves the other three active statuses via their ready_* fallback", async () => {
  await withBoard(async (root) => {
    const cases = [
      { status: "designing", action: "design", agent: "claude-subagent:local-board-designer", model: "opus" },
      { status: "reviewing", action: "review", agent: "codex-task:read-only", model: null },
      { status: "testing", action: "test", agent: "claude-subagent:local-board-tester", model: "sonnet" },
    ];

    for (const { status, action, agent, model } of cases) {
      const ticketPath = await createTicket(root, "task", `Already ${status}`, { status });
      const ticketId = path.basename(ticketPath).split("_", 1)[0];

      const result = await beginStep(root, ticketId);

      assert.equal(result.action, action, `${status} should resolve action ${action}`);
      assert.equal(result.configuredAgent, agent, `${status} should resolve agent ${agent}`);
      assert.equal(result.configuredModel, model, `${status} should resolve model ${model}`);
    }
  });
});

test("resolveExpectedStep (the check-dispatch path) resolves an active-status ticket the same way as beginStep", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Active for check-dispatch", {
      status: "implementing",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const resolved = await resolveExpectedStep(root, ticketId);

    assert.equal(resolved.action, "implement");
    assert.equal(resolved.status, "implementing");
    assert.equal(resolved.route, "claude-subagent:local-board-implementer");
    assert.equal(resolved.model, "sonnet");
  });
});

test("beginStep prefers an explicit statusActions entry for an active status over the ready_* fallback", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({ workflow: { statusActions: { implementing: "review" } } }));

    const ticketPath = await createTicket(root, "task", "Explicit active-status override", {
      status: "implementing",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const result = await beginStep(root, ticketId);

    assert.equal(result.action, "review", "an explicit statusActions entry must win over the ready_* fallback");
    assert.equal(result.configuredAgent, "codex-task:read-only");
  });
});

test("beginStep still throws for a genuinely action-less status (questions/blocked)", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Needs input", {
      status: "questions",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await assert.rejects(beginStep(root, ticketId), new RegExp(`${ticketId} has no configured action for status questions`));
  });
});

test("beginStep --action override still wins over the active-status fallback", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Override wins", {
      status: "implementing",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const result = await beginStep(root, ticketId, "review");

    assert.equal(result.action, "review");
    assert.equal(result.configuredAgent, "codex-task:read-only");
  });
});

test("beginStep on an implementing-status ticket is idempotent when re-run (ledger re-stamp)", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Re-run begin-step", {
      status: "implementing",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const first = await beginStep(root, ticketId);
    const second = await beginStep(root, ticketId);

    assert.deepEqual(first, second);

    const steps = await readActiveSteps(root);
    assert.equal(Object.keys(steps).length, 1);
    assert.equal(steps[ticketId].action, "implement");
  });
});

test("completeStep accepts a route@model executor and validates by route only", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Review with pinned model", {
      status: "ready_for_review",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    // Configured route is codex-task:read-only; the @model suffix records the
    // model that ran and must not trigger a routing-deviation error.
    await completeStep(root, ticketId, "review", "codex-task:read-only@gpt-5.5", "Review evidence.", {
      now: new Date("2026-05-14T21:00:00Z"),
    });

    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /^completedSteps: \["review:codex-task:read-only@gpt-5\.5"\]$/m);
    // Round-trips and passes validation (route comparison ignores the @model suffix).
    assert.deepEqual(validate(await discover(root)), []);
  });
});

test("completeStep enforces configured routing unless inline is approved", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Review with approval", {
      status: "ready_for_review",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await assert.rejects(
      completeStep(root, ticketId, "review", "inline", "Self-review evidence."),
      /configured agent is codex-task:read-only/,
    );

    await approveInline(root, ticketId, "review", "User approved a local fallback.", {
      now: new Date("2026-05-14T21:00:00Z"),
    });
    await completeStep(root, ticketId, "review", "inline", "Approved self-review evidence.", {
      now: new Date("2026-05-14T21:01:00Z"),
    });

    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /^routingApprovals: \[review:inline\]$/m);
    assert.match(text, /^completedSteps: \[review:inline\]$/m);
    assert.deepEqual(validate(await discover(root), await loadConfig(root)), []);
  });
});

test("completeStep enforces the configured model suffix when the route matches (match, mismatch, missing)", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Model-pinned design", {
      status: "ready_for_design",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    // missing: no @model suffix on an opus-pinned action.
    await assert.rejects(
      completeStep(root, ticketId, "design", "claude-subagent:local-board-designer", "Design evidence."),
      /completed on model \(none\), but configured model is opus/,
    );

    // mismatch: wrong @model suffix.
    await assert.rejects(
      completeStep(root, ticketId, "design", "claude-subagent:local-board-designer@sonnet", "Design evidence."),
      /completed on model sonnet, but configured model is opus/,
    );

    const textBeforeMatch = await readFile(ticketPath, "utf8");
    assert.match(textBeforeMatch, /^completedSteps: \[\]$/m);

    // match: exact configured model.
    await completeStep(root, ticketId, "design", "claude-subagent:local-board-designer@opus", "Design evidence.");

    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /^completedSteps: \["design:claude-subagent:local-board-designer@opus"\]$/m);
    assert.deepEqual(validate(await discover(root), await loadConfig(root)), []);
  });
});

test("completeStep accepts @codex-default as satisfying any pinned model", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Codex-translated design", {
      status: "ready_for_design",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await completeStep(
      root,
      ticketId,
      "design",
      "claude-subagent:local-board-designer@codex-default",
      "Codex-translated design evidence.",
    );

    const text = await readFile(ticketPath, "utf8");
    assert.match(
      text,
      /^completedSteps: \["design:claude-subagent:local-board-designer@codex-default"\]$/m,
    );
    assert.deepEqual(validate(await discover(root), await loadConfig(root)), []);
  });
});

test("completeStep enforces a pinned model on a specialty step (optionalSteps[].agent object form), codex-default wildcard accepted, no effort in the token", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({
      optionalSteps: {
        implement: [
          {
            name: "security_audit",
            prompt: "p.md",
            triggers: "t",
            agent: { route: "codex-task:read-only", model: "gpt-5.6-sol", effort: "xhigh" },
          },
        ],
      },
    }));
    const ticketPath = await createTicket(root, "task", "Pinned specialty target", {
      status: "implementing",
      now: new Date("2026-07-10T12:00:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    // missing: route-only executor, no @model suffix.
    await assert.rejects(
      completeStep(root, ticketId, "security_audit", "codex-task:read-only", "Security audit evidence."),
      /completed on model \(none\), but configured model is gpt-5\.6-sol/,
    );

    // mismatch: wrong @model suffix.
    await assert.rejects(
      completeStep(root, ticketId, "security_audit", "codex-task:read-only@gpt-5.6-terra", "Security audit evidence."),
      /completed on model gpt-5\.6-terra, but configured model is gpt-5\.6-sol/,
    );

    const textBeforeMatch = await readFile(ticketPath, "utf8");
    assert.match(textBeforeMatch, /^completedSteps: \[\]$/m);

    // match: exact configured model.
    await completeStep(
      root,
      ticketId,
      "security_audit",
      "codex-task:read-only@gpt-5.6-sol",
      "Security audit evidence.",
    );

    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /^completedSteps: \["security_audit:codex-task:read-only@gpt-5\.6-sol"\]$/m);
    // Effort ("xhigh") is a dispatch hint only; it never enters the evidence token.
    assert.equal(text.includes("xhigh"), false);
    assert.deepEqual(validate(await discover(root), await loadConfig(root)), []);
  });
});

test("completeStep accepts @codex-default as satisfying a pinned specialty model", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({
      optionalSteps: {
        implement: [
          {
            name: "security_audit",
            prompt: "p.md",
            triggers: "t",
            agent: { route: "codex-task:read-only", model: "gpt-5.6-sol" },
          },
        ],
      },
    }));
    const ticketPath = await createTicket(root, "task", "Codex-translated specialty", {
      status: "implementing",
      now: new Date("2026-07-10T12:00:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await completeStep(
      root,
      ticketId,
      "security_audit",
      "codex-task:read-only@codex-default",
      "Codex-translated security audit evidence.",
    );

    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /^completedSteps: \["security_audit:codex-task:read-only@codex-default"\]$/m);
    assert.deepEqual(validate(await discover(root), await loadConfig(root)), []);
  });
});

test("completeStep leaves a specialty step with a string-only agent unpinned (no model enforcement, agents.default not consulted)", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({
      // agents.default, if it existed, must NOT leak onto a specialty step
      // that carries no agent override (or a bare-string override).
      agents: { default: { route: "claude-subagent:local-board-designer", model: "opus" } },
      optionalSteps: {
        implement: [
          { name: "security_audit", prompt: "p.md", triggers: "t", agent: "codex-task:read-only" },
        ],
      },
    }));
    const ticketPath = await createTicket(root, "task", "Unpinned specialty target", {
      status: "implementing",
      now: new Date("2026-07-10T12:00:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    // No model configured on the specialty: any executor model (or none) on the correct route is accepted.
    await completeStep(root, ticketId, "security_audit", "codex-task:read-only", "Security audit evidence.");

    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /^completedSteps: \[security_audit:codex-task:read-only\]$/m);
    assert.deepEqual(validate(await discover(root), await loadConfig(root)), []);
  });
});

test("completeStep preserves the agents.default fallback for a mandatory action with no dedicated agents entry", async () => {
  await withBoard(async (root) => {
    // Introduce a mandatory action name (via workflow.statusActions) with no
    // matching agents.<action> entry, so profileForAction's mandatory branch
    // must fall through to agents.default (unchanged behavior — see the
    // companion "denied to specialties" test above).
    await writeConfig(root, JSON.stringify({
      workflow: { statusActions: { ready_for_implementation: "custom_gate" } },
      agents: { default: { route: "codex-task:read-only", model: "gpt-5.6-terra" } },
    }));
    const ticketPath = await createTicket(root, "task", "Custom-action fallback target", {
      status: "implementing",
      now: new Date("2026-07-10T12:00:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await assert.rejects(
      completeStep(root, ticketId, "custom_gate", "codex-task:read-only", "Custom action evidence."),
      /completed on model \(none\), but configured model is gpt-5\.6-terra/,
    );

    await completeStep(
      root,
      ticketId,
      "custom_gate",
      "codex-task:read-only@gpt-5.6-terra",
      "Custom action evidence.",
    );

    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /^completedSteps: \["custom_gate:codex-task:read-only@gpt-5\.6-terra"\]$/m);
  });
});

test("composeExecutor: no model given returns the executor verbatim (bare or already-combined)", () => {
  assert.equal(composeExecutor("claude-subagent:local-board-designer", undefined), "claude-subagent:local-board-designer");
  assert.equal(composeExecutor("claude-subagent:local-board-designer", null), "claude-subagent:local-board-designer");
  assert.equal(composeExecutor("claude-subagent:local-board-designer", ""), "claude-subagent:local-board-designer");
  assert.equal(composeExecutor("claude-subagent:local-board-designer", "   "), "claude-subagent:local-board-designer");
  assert.equal(
    composeExecutor("claude-subagent:local-board-designer@opus", undefined),
    "claude-subagent:local-board-designer@opus",
  );
});

test("composeExecutor: composes route@model when the executor is bare", () => {
  assert.equal(
    composeExecutor("claude-subagent:local-board-designer", "opus"),
    "claude-subagent:local-board-designer@opus",
  );
  assert.equal(
    composeExecutor("codex-task:read-only", "codex-default"),
    "codex-task:read-only@codex-default",
  );
});

test("composeExecutor: identical @suffix and --model is a no-op; disagreement throws naming both values", () => {
  assert.equal(
    composeExecutor("claude-subagent:local-board-designer@opus", "opus"),
    "claude-subagent:local-board-designer@opus",
  );
  assert.throws(
    () => composeExecutor("claude-subagent:local-board-designer@opus", "sonnet"),
    /--executor pins @opus but --model says sonnet; pass only one or make them agree/,
  );
});

test("composeExecutor: --model with --executor inline throws a specific, actionable error", () => {
  assert.throws(
    () => composeExecutor("inline", "opus"),
    /--model cannot be used with --executor inline/,
  );
});

test("approve-inline --executor approves a model deviation while keeping the configured route", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Approved model deviation", {
      status: "ready_for_design",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await assert.rejects(
      completeStep(root, ticketId, "design", "claude-subagent:local-board-designer@sonnet", "Design evidence."),
      /configured model is opus/,
    );

    await approveInline(root, ticketId, "design", "Opus unavailable; running sonnet.", {
      executor: "claude-subagent:local-board-designer@sonnet",
      now: new Date("2026-05-14T21:00:00Z"),
    });
    await completeStep(root, ticketId, "design", "claude-subagent:local-board-designer@sonnet", "Design evidence.", {
      now: new Date("2026-05-14T21:01:00Z"),
    });

    const text = await readFile(ticketPath, "utf8");
    assert.match(
      text,
      /^routingApprovals: \["design:claude-subagent:local-board-designer@sonnet"\]$/m,
    );
    assert.match(
      text,
      /^completedSteps: \["design:claude-subagent:local-board-designer@sonnet"\]$/m,
    );
    assert.match(
      text,
      /Approved routing deviation for design: claude-subagent:local-board-designer@sonnet: Opus unavailable; running sonnet\./,
    );
    assert.deepEqual(validate(await discover(root), await loadConfig(root)), []);
  });
});

test("done-time validation stays route-only: a legacy suffix-less token on a model-pinned action still validates", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Legacy suffix-less evidence", {
      status: "ready_for_docs",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    // Hand-write completedSteps as if recorded before per-step model pinning existed
    // (or before this rule shipped): no @model suffix on now-pinned design/implement/test.
    await replaceText(
      ticketPath,
      "completedSteps: []",
      "completedSteps: [design:claude-subagent:local-board-designer, implement:claude-subagent:local-board-implementer, review:codex-task:read-only, test:claude-subagent:local-board-tester, document:codex-task:workspace-write]",
    );

    const moved = await moveTicket(root, ticketId, "done");

    assert.match(await readFile(moved, "utf8"), /^status: done$/m);
    assert.deepEqual(validate(await discover(root), await loadConfig(root)), []);
  });
});

test("approve-inline without --executor still records :inline (regression)", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Default approve-inline", {
      status: "ready_for_review",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const result = await approveInline(root, ticketId, "review", "No --executor supplied.", {
      now: new Date("2026-05-14T21:00:00Z"),
    });

    assert.equal(result.approvedExecutor, "inline");
    assert.match(await readFile(ticketPath, "utf8"), /^routingApprovals: \[review:inline\]$/m);
    assert.match(await readFile(ticketPath, "utf8"), /Approved inline review: No --executor supplied\./);
  });
});

test("strict routing blocks done until required steps have completion evidence", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Strict done", {
      status: "ready_for_docs",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await assert.rejects(moveTicket(root, ticketId, "done"), /missing completedSteps entry for design/);

    await completeStep(root, ticketId, "design", "claude-subagent:local-board-designer@opus", "Design evidence.");
    await completeStep(root, ticketId, "implement", "claude-subagent:local-board-implementer@sonnet", "Implementation evidence.");
    await completeStep(root, ticketId, "review", "codex-task:read-only", "Review evidence.");
    await completeStep(root, ticketId, "test", "claude-subagent:local-board-tester@sonnet", "Test evidence.");
    await completeStep(root, ticketId, "document", "codex-task:workspace-write", "Documentation evidence.");

    const moved = await moveTicket(root, ticketId, "done");

    assert.match(await readFile(moved, "utf8"), /^status: done$/m);
    assert.deepEqual(validate(await discover(root), await loadConfig(root)), []);
  });
});

test("moveTicket to done stamps workCompletedAt when null", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Stamp completion", {
      status: "ready_for_docs",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    await replaceText(ticketPath, "workStartedAt: null", "workStartedAt: 2026-05-14T21:00:00Z");

    await completeStep(root, ticketId, "design", "claude-subagent:local-board-designer@opus", "Design evidence.");
    await completeStep(root, ticketId, "implement", "claude-subagent:local-board-implementer@sonnet", "Implementation evidence.");
    await completeStep(root, ticketId, "review", "codex-task:read-only", "Review evidence.");
    await completeStep(root, ticketId, "test", "claude-subagent:local-board-tester@sonnet", "Test evidence.");
    await completeStep(root, ticketId, "document", "codex-task:workspace-write", "Documentation evidence.");

    const moved = await moveTicket(root, ticketId, "done", { now: new Date("2026-05-16T15:37:00Z") });

    const text = await readFile(moved, "utf8");
    assert.match(text, /^workCompletedAt: 2026-05-16T15:37:00Z$/m);
    assert.match(text, /^updated: 2026-05-16T15:37:00Z$/m);
    assert.deepEqual(validate(await discover(root), await loadConfig(root)), []);
  });
});

test("moveTicket re-opening and returning to done preserves the original workCompletedAt", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Reopen preserve completion", {
      status: "ready_for_docs",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    await replaceText(ticketPath, "workStartedAt: null", "workStartedAt: 2026-05-14T21:00:00Z");

    await completeStep(root, ticketId, "design", "claude-subagent:local-board-designer@opus", "Design evidence.");
    await completeStep(root, ticketId, "implement", "claude-subagent:local-board-implementer@sonnet", "Implementation evidence.");
    await completeStep(root, ticketId, "review", "codex-task:read-only", "Review evidence.");
    await completeStep(root, ticketId, "test", "claude-subagent:local-board-tester@sonnet", "Test evidence.");
    await completeStep(root, ticketId, "document", "codex-task:workspace-write", "Documentation evidence.");

    await moveTicket(root, ticketId, "done", { now: new Date("2026-05-16T15:37:00Z") });
    await moveTicket(root, ticketId, "ready_for_review", { now: new Date("2026-05-16T16:00:00Z") });
    const reclosed = await moveTicket(root, ticketId, "done", { now: new Date("2026-05-16T17:00:00Z") });

    const text = await readFile(reclosed, "utf8");
    assert.match(text, /^workCompletedAt: 2026-05-16T15:37:00Z$/m);
  });
});

test("moveTicket to done preserves a pre-existing workCompletedAt", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Preserve completion", {
      status: "ready_for_docs",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    await replaceText(ticketPath, "workStartedAt: null", "workStartedAt: 2026-05-14T21:00:00Z");
    await replaceText(ticketPath, "workCompletedAt: null", "workCompletedAt: 2026-05-14T22:00:00Z");

    await completeStep(root, ticketId, "design", "claude-subagent:local-board-designer@opus", "Design evidence.");
    await completeStep(root, ticketId, "implement", "claude-subagent:local-board-implementer@sonnet", "Implementation evidence.");
    await completeStep(root, ticketId, "review", "codex-task:read-only", "Review evidence.");
    await completeStep(root, ticketId, "test", "claude-subagent:local-board-tester@sonnet", "Test evidence.");
    await completeStep(root, ticketId, "document", "codex-task:workspace-write", "Documentation evidence.");

    const moved = await moveTicket(root, ticketId, "done", { now: new Date("2026-05-16T15:37:00Z") });

    const text = await readFile(moved, "utf8");
    assert.match(text, /^workCompletedAt: 2026-05-14T22:00:00Z$/m);
  });
});

test("archiveDoneTickets preserves workStartedAt and workCompletedAt", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Archive preserves timestamps", {
      status: "done",
      now: new Date("2026-01-01T00:00:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    await replaceText(ticketPath, "workStartedAt: null", "workStartedAt: 2026-01-01T01:00:00Z");
    await replaceText(ticketPath, "workCompletedAt: null", "workCompletedAt: 2026-01-01T02:00:00Z");
    await replaceText(ticketPath, "updated: 2026-01-01T00:00:00Z", "updated: 2026-01-01T03:00:00Z");

    const archived = await archiveDoneTickets(root, {
      archiveDoneAfterDays: 0,
      now: new Date("2026-05-16T15:37:00Z"),
    });

    assert.equal(archived.length, 1);
    const archivedPath = path.join(root, "plans", "tickets", "archive", path.basename(ticketPath));
    const text = await readFile(archivedPath, "utf8");
    assert.match(text, /^status: archived$/m);
    assert.match(text, /^workStartedAt: 2026-01-01T01:00:00Z$/m);
    assert.match(text, /^workCompletedAt: 2026-01-01T02:00:00Z$/m);
    assert.equal(archived[0].ticket, ticketId);
  });
});

test("moveTicket directly to done with workStartedAt null leaves both timestamps null", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Direct move to done", {
      status: "ready_for_docs",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await completeStep(root, ticketId, "design", "claude-subagent:local-board-designer@opus", "Design evidence.");
    await completeStep(root, ticketId, "implement", "claude-subagent:local-board-implementer@sonnet", "Implementation evidence.");
    await completeStep(root, ticketId, "review", "codex-task:read-only", "Review evidence.");
    await completeStep(root, ticketId, "test", "claude-subagent:local-board-tester@sonnet", "Test evidence.");
    await completeStep(root, ticketId, "document", "codex-task:workspace-write", "Documentation evidence.");

    // Sanity-check: workStartedAt was never stamped (no startTicketWork call was made).
    const before = await readFile(ticketPath, "utf8");
    assert.match(before, /^workStartedAt: null$/m);
    assert.match(before, /^workCompletedAt: null$/m);

    const moved = await moveTicket(root, ticketId, "done", { now: new Date("2026-05-16T15:37:00Z") });

    const text = await readFile(moved, "utf8");
    // Documented behavior: moveTicket only stamps workCompletedAt when workStartedAt is
    // already set, to preserve the validator invariant that workCompletedAt requires
    // workStartedAt. A direct move-to-done without prior start-work leaves both null.
    assert.match(text, /^workStartedAt: null$/m);
    assert.match(text, /^workCompletedAt: null$/m);
    assert.deepEqual(validate(await discover(root), await loadConfig(root)), []);
  });
});

test("strict routing blocks done when optional routing fields are absent", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Strict legacy done", {
      status: "ready_for_docs",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    await replaceText(ticketPath, "completedSteps: []\nroutingApprovals: []\n", "");

    await assert.rejects(moveTicket(root, ticketId, "done"), /missing completedSteps entry for design/);
  });
});

test("strict routing accepts custom codex-task modes", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Custom codex mode", {
      status: "ready_for_review",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    await mkdir(path.join(root, "plans"), { recursive: true });
    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      `{
        "agents": {
          "review": "codex-task:xhigh-review"
        }
      }
      `,
      "utf8",
    );

    const begin = await beginStep(root, ticketId);
    assert.equal(begin.configuredAgent, "codex-task:xhigh-review");

    await completeStep(root, ticketId, "review", "codex-task:xhigh-review", "Custom Codex review evidence.");

    assert.match(await readFile(ticketPath, "utf8"), /^completedSteps: \[review:codex-task:xhigh-review\]$/m);
    assert.deepEqual(validate(await discover(root), await loadConfig(root)), []);
  });
});

test("linkParent updates reciprocal parent and child fields", async () => {
  await withBoard(async (root) => {
    const parent = await createTicket(root, "epic", "Parent", {
      status: "ready_for_decomposition",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const child = await createTicket(root, "story", "Child", {
      status: "ready_for_decomposition",
      now: new Date("2026-05-14T20:57:00Z"),
    });
    const parentId = path.basename(parent).split("_", 1)[0];
    const childId = path.basename(child).split("_", 1)[0];

    await linkParent(root, childId, parentId, { now: new Date("2026-05-14T21:03:00Z") });

    const parentText = await readFile(parent, "utf8");
    const childText = await readFile(child, "utf8");
    assert.match(parentText, new RegExp(`^children: \\[${childId}\\]$`, "m"));
    assert.match(childText, new RegExp(`^parent: ${parentId}$`, "m"));
    assert.deepEqual(validate(await discover(root)), []);
  });
});

test("linkParent rejects reparenting without unlinking first", async () => {
  await withBoard(async (root) => {
    const firstParent = await createTicket(root, "epic", "First parent", {
      status: "ready_for_decomposition",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const secondParent = await createTicket(root, "epic", "Second parent", {
      status: "ready_for_decomposition",
      now: new Date("2026-05-14T20:57:00Z"),
    });
    const child = await createTicket(root, "story", "Child", {
      status: "ready_for_decomposition",
      now: new Date("2026-05-14T20:58:00Z"),
    });
    const firstParentId = path.basename(firstParent).split("_", 1)[0];
    const secondParentId = path.basename(secondParent).split("_", 1)[0];
    const childId = path.basename(child).split("_", 1)[0];

    await linkParent(root, childId, firstParentId, { now: new Date("2026-05-14T21:03:00Z") });
    await assert.rejects(
      linkParent(root, childId, secondParentId, { now: new Date("2026-05-14T21:04:00Z") }),
      new RegExp(`ticket ${childId} already has parent ${firstParentId}`),
    );

    assert.match(await readFile(firstParent, "utf8"), new RegExp(`^children: \\[${childId}\\]$`, "m"));
    assert.match(await readFile(secondParent, "utf8"), /^children: \[\]$/m);
    assert.match(await readFile(child, "utf8"), new RegExp(`^parent: ${firstParentId}$`, "m"));
    assert.deepEqual(validate(await discover(root)), []);
  });
});

test("block and unblock update reciprocal dependency fields", async () => {
  await withBoard(async (root) => {
    const dependency = await createTicket(root, "task", "Dependency", {
      status: "ready_for_design",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticket = await createTicket(root, "task", "Blocked ticket", {
      status: "ready_for_design",
      now: new Date("2026-05-14T20:57:00Z"),
    });
    const dependencyId = path.basename(dependency).split("_", 1)[0];
    const ticketId = path.basename(ticket).split("_", 1)[0];

    await blockTicket(root, ticketId, dependencyId, { now: new Date("2026-05-14T21:04:00Z") });
    assert.match(await readFile(ticket, "utf8"), new RegExp(`^blockedBy: \\[${dependencyId}\\]$`, "m"));
    assert.match(await readFile(dependency, "utf8"), new RegExp(`^blocks: \\[${ticketId}\\]$`, "m"));

    await unblockTicket(root, ticketId, dependencyId, { now: new Date("2026-05-14T21:05:00Z") });
    assert.match(await readFile(ticket, "utf8"), /^blockedBy: \[\]$/m);
    assert.match(await readFile(dependency, "utf8"), /^blocks: \[\]$/m);
    assert.deepEqual(validate(await discover(root)), []);
  });
});

// --- Per-ticket RMW locking (B20260707T1322Z) ---

test("control: an unlocked find+write RMW on the same ticket loses an update (reproduces the pre-lock bug)", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Racing unlocked mutation", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    // Hand-rolled analog of the OLD (unlocked) setTicketField/completeStep
    // body: findTicket (read), hold, mutate frontMatter, writeTicketFile.
    // Deliberately bypasses withTicketLock entirely to prove the seam
    // reproduces a real lost update.
    async function unsafeSetField(field, value, holdMs) {
      const { ticket } = await findTicket(root, ticketId);
      await delay(holdMs);
      const frontMatter = { ...ticket.frontMatter, [field]: value };
      await writeTicketFile(ticket.path, renderMarkdownTicket(frontMatter, ticket.body));
    }

    await Promise.all([unsafeSetField("priority", "P0", 60), unsafeSetField("estimate", "3", 5)]);

    const { ticket } = await findTicket(root, ticketId);
    // The "estimate" writer read before "priority" wrote and finishes first,
    // then "priority" writes last with a frontMatter copy that never saw the
    // estimate change, clobbering it back to null.
    assert.equal(ticket.frontMatter.priority, "P0");
    assert.equal(ticket.frontMatter.estimate, null, "the concurrent estimate update must be lost by the naive unlocked RMW");
  });
});

test("appendTicketComment racing completeStep on the same ticket: the per-ticket lock serializes the RMW so neither update is lost", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Racing locked mutations", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    // completeStep reads first and is forced to hold the ticket lock for a
    // while between its read and its write; appendTicketComment starts
    // concurrently and must block on the same lock (retrying) until
    // completeStep releases, then read completeStep's already-written state.
    await Promise.all([
      completeStep(
        root,
        ticketId,
        "implement",
        "claude-subagent:local-board-implementer@sonnet",
        "Implemented and tested.",
        { __afterRead: () => delay(60) },
      ),
      appendTicketComment(root, ticketId, "Run Log", "Concurrent Run Log comment."),
    ]);

    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /^completedSteps: \["implement:claude-subagent:local-board-implementer@sonnet"\]$/m);
    assert.match(text, /Concurrent Run Log comment\./);
    assert.deepEqual(validate(await discover(root), await loadConfig(root)), []);
  });
});

test("linkParent/unlinkParent ordered dual-lock: reversed argument order across concurrent calls never deadlocks", async () => {
  await withBoard(async (root) => {
    const parentPath = await createTicket(root, "epic", "Parent", {
      status: "ready_for_decomposition",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const childPath = await createTicket(root, "story", "Child", {
      status: "ready_for_decomposition",
      now: new Date("2026-05-14T20:57:00Z"),
    });
    const parentId = path.basename(parentPath).split("_", 1)[0];
    const childId = path.basename(childPath).split("_", 1)[0];

    await linkParent(root, childId, parentId, { now: new Date("2026-05-14T21:03:00Z") });

    // Concurrently unlink (child, parent) and re-link (parent, child) -- one
    // call's sorted-lock order is the reverse of the other's argument order.
    // Sorted-id acquisition means both actually contend for the same lock
    // first regardless of argument order, so this must serialize rather than
    // deadlock (a bounded test timeout would otherwise catch a real deadlock).
    await Promise.all([
      unlinkParent(root, childId, parentId, { now: new Date("2026-05-14T21:04:00Z") }),
      linkParent(root, childId, parentId, { now: new Date("2026-05-14T21:04:30Z") }).catch(() => {}),
    ]);

    // Whichever order the two operations actually serialized in, the board
    // must remain internally consistent (no dangling/mismatched half-link).
    assert.deepEqual(validate(await discover(root)), []);
  });
});

test("stateReport summarizes ticket state and next action", async () => {
  await withBoard(async (root) => {
    await createTicket(root, "task", "Ready design", {
      status: "ready_for_design",
      priority: "P2",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    await createTicket(root, "bug", "Backlog bug", {
      status: "backlog",
      priority: "P0",
      now: new Date("2026-05-14T20:57:00Z"),
    });

    const report = await stateReport(root);

    assert.equal(report.ok, true);
    assert.equal(report.total, 2);
    assert.equal(report.eligible, 1);
    assert.equal(report.byStatus.ready_for_design, 1);
    assert.equal(report.byStatus.backlog, 1);
    assert.equal(report.byType.task, 1);
    assert.equal(report.byType.bug, 1);
    assert.equal(report.byAction.design, 1);
    assert.equal(report.byAction.none, 1);
    assert.equal(report.next?.action, "design");
  });
});

test("createTicket scaffolds estimateBasis, workStartedAt, workCompletedAt as null in canonical order", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Estimation fields scaffold", {
      status: "ready_for_design",
      now: new Date("2026-05-14T20:56:00Z"),
    });

    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /^estimateBasis: null$/m);
    assert.match(text, /^workStartedAt: null$/m);
    assert.match(text, /^workCompletedAt: null$/m);

    const lines = text.split("\n");
    const estimateIdx = lines.findIndex((line) => line === "estimate: null");
    const basisIdx = lines.findIndex((line) => line === "estimateBasis: null");
    const startedIdx = lines.findIndex((line) => line === "workStartedAt: null");
    const completedIdx = lines.findIndex((line) => line === "workCompletedAt: null");
    const createdIdx = lines.findIndex((line) => line.startsWith("created: "));

    assert.ok(estimateIdx >= 0 && basisIdx > estimateIdx, "estimateBasis follows estimate");
    assert.ok(startedIdx > basisIdx, "workStartedAt follows estimateBasis");
    assert.ok(completedIdx > startedIdx, "workCompletedAt follows workStartedAt");
    assert.ok(createdIdx > completedIdx, "created follows workCompletedAt");

    assert.deepEqual(validate(await discover(root)), []);
  });
});

test("populated estimateBasis with ticket id round-trips through write and validates clean", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Populated estimation", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await replaceText(ticketPath, "estimate: null", "estimate: 4");
    await replaceText(ticketPath, "estimateBasis: null", "estimateBasis: T20260514T2056Z");
    await replaceText(ticketPath, "workStartedAt: null", "workStartedAt: 2026-05-14T21:00:00Z");
    await replaceText(ticketPath, "workCompletedAt: null", "workCompletedAt: 2026-05-14T22:00:00Z");

    assert.deepEqual(validate(await discover(root)), []);

    await setTicketField(root, ticketId, "priority", "P1", {
      now: new Date("2026-05-14T22:30:00Z"),
    });
    const rewritten = await readFile(ticketPath, "utf8");
    assert.match(rewritten, /^estimate: 4$/m);
    assert.match(rewritten, /^estimateBasis: T20260514T2056Z$/m);
    assert.match(rewritten, /^workStartedAt: 2026-05-14T21:00:00Z$/m);
    assert.match(rewritten, /^workCompletedAt: 2026-05-14T22:00:00Z$/m);

    const lines = rewritten.split("\n");
    const estimateIdx = lines.findIndex((line) => line === "estimate: 4");
    const basisIdx = lines.findIndex((line) => line === "estimateBasis: T20260514T2056Z");
    const startedIdx = lines.findIndex((line) => line === "workStartedAt: 2026-05-14T21:00:00Z");
    const completedIdx = lines.findIndex((line) => line === "workCompletedAt: 2026-05-14T22:00:00Z");
    assert.ok(estimateIdx < basisIdx && basisIdx < startedIdx && startedIdx < completedIdx, "canonical order preserved");
  });
});

test("estimateBasis accepts the literal bootstrap", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Bootstrap basis", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    await replaceText(ticketPath, "estimate: null", "estimate: 2");
    await replaceText(ticketPath, "estimateBasis: null", "estimateBasis: bootstrap");

    assert.deepEqual(validate(await discover(root)), []);
  });
});

test("validate rejects malformed estimateBasis", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Malformed basis", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    await replaceText(ticketPath, "estimate: null", "estimate: 3");
    await replaceText(ticketPath, "estimateBasis: null", "estimateBasis: nonsense-string");

    const issues = validate(await discover(root));
    assert.equal(
      issues.some((issue) => issue.includes("estimateBasis must be a ticket id or the literal bootstrap")),
      true,
    );
  });
});

test("validate rejects estimateBasis when estimate is null", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Basis without estimate", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    await replaceText(ticketPath, "estimateBasis: null", "estimateBasis: T20260514T2056Z");

    const issues = validate(await discover(root));
    assert.equal(
      issues.some((issue) => issue.includes("estimateBasis must be null when estimate is null")),
      true,
    );
  });
});

test("validate rejects malformed workStartedAt and workCompletedAt timestamps", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Malformed timestamps", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    await replaceText(ticketPath, "workStartedAt: null", "workStartedAt: not-a-timestamp");

    let issues = validate(await discover(root));
    assert.equal(
      issues.some((issue) => issue.includes("workStartedAt must be an ISO-8601 datetime with a timezone offset or Z")),
      true,
    );

    await replaceText(ticketPath, "workStartedAt: not-a-timestamp", "workStartedAt: 2026-05-14T21:00:00Z");
    await replaceText(ticketPath, "workCompletedAt: null", "workCompletedAt: not-a-timestamp");

    issues = validate(await discover(root));
    assert.equal(
      issues.some((issue) =>
        issue.includes("workCompletedAt must be an ISO-8601 datetime with a timezone offset or Z"),
      ),
      true,
    );
  });
});

test("validate rejects workCompletedAt without workStartedAt", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Completed without started", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    await replaceText(ticketPath, "workCompletedAt: null", "workCompletedAt: 2026-05-14T22:00:00Z");

    const issues = validate(await discover(root));
    assert.equal(
      issues.some((issue) => issue.includes("workCompletedAt requires workStartedAt to be set")),
      true,
    );
  });
});

test("legacy ticket without new estimation fields parses and validates via read-time defaulting", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Legacy ticket shape", {
      status: "ready_for_design",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    await replaceText(ticketPath, "estimateBasis: null\n", "");
    await replaceText(ticketPath, "workStartedAt: null\n", "");
    await replaceText(ticketPath, "workCompletedAt: null\n", "");

    const text = await readFile(ticketPath, "utf8");
    assert.equal(text.includes("estimateBasis"), false);
    assert.equal(text.includes("workStartedAt"), false);
    assert.equal(text.includes("workCompletedAt"), false);

    const board = await discover(root);
    const ticket = board.tickets[0];
    assert.equal(ticket.frontMatter.estimateBasis, null);
    assert.equal(ticket.frontMatter.workStartedAt, null);
    assert.equal(ticket.frontMatter.workCompletedAt, null);

    assert.deepEqual(validate(board), []);
  });
});

test("freshly-scaffolded ticket exposes new estimation fields as null in parsed front matter", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "All-null parsed front matter", {
      status: "ready_for_design",
      now: new Date("2026-05-14T20:56:00Z"),
    });

    const board = await discover(root);
    const ticket = board.tickets.find((entry) => entry.path === path.resolve(ticketPath));
    assert.ok(ticket, "ticket discovered");
    assert.equal(Object.hasOwn(ticket.frontMatter, "estimateBasis"), true);
    assert.equal(Object.hasOwn(ticket.frontMatter, "workStartedAt"), true);
    assert.equal(Object.hasOwn(ticket.frontMatter, "workCompletedAt"), true);
    assert.equal(ticket.frontMatter.estimateBasis, null);
    assert.equal(ticket.frontMatter.workStartedAt, null);
    assert.equal(ticket.frontMatter.workCompletedAt, null);
  });
});

test("validate rejects non-string YAML estimateBasis", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Non-string basis", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    await replaceText(ticketPath, "estimate: null", "estimate: 2");
    await replaceText(ticketPath, "estimateBasis: null", "estimateBasis: []");

    const issues = validate(await discover(root));
    assert.equal(
      issues.some((issue) => issue.includes("estimateBasis must be null or a string")),
      true,
    );
  });
});

test("initProject scaffolds a new local-board project idempotently", async () => {
  await withBoard(async (root) => {
    const first = await initProject(root);
    const second = await initProject(root);

    assert.equal(first.created.includes(path.join(root, "plans", "local-board.config.jsonc")), true);
    assert.equal(second.created.length, 0);
    assert.equal(second.skipped.length > 0, true);
    assert.deepEqual((await loadConfig(root)).agents.implement, {
      route: "claude-subagent:local-board-implementer",
      model: "sonnet",
    });
    assert.deepEqual(validate(await discover(root)), []);
  });
});

test("initProject --overwrite never clobbers an existing root .gitignore", async () => {
  await withBoard(async (root) => {
    const gitignorePath = path.join(root, ".gitignore");
    const customContent = "# my custom rules\nnode_modules/\n*.log\n";
    await writeFile(gitignorePath, customContent, "utf8");

    await initProject(root, { overwrite: true });
    const afterFirst = await readFile(gitignorePath, "utf8");
    assert.match(afterFirst, /^# my custom rules$/m);
    assert.match(afterFirst, /^node_modules\/$/m);
    assert.match(afterFirst, /^\*\.log$/m);
    const occurrencesFirst = afterFirst.split(/\r?\n/).filter((line) => line.trim() === ".worktrees/").length;
    assert.equal(occurrencesFirst, 1, ".worktrees/ must be appended exactly once");
    const localBoardOccurrencesFirst = afterFirst.split(/\r?\n/).filter((line) => line.trim() === ".local-board/").length;
    assert.equal(localBoardOccurrencesFirst, 1, ".local-board/ must be appended exactly once");

    await initProject(root, { overwrite: true });
    const afterSecond = await readFile(gitignorePath, "utf8");
    assert.equal(afterSecond, afterFirst, "a second --overwrite run must not change the file further");
    const occurrencesSecond = afterSecond.split(/\r?\n/).filter((line) => line.trim() === ".worktrees/").length;
    assert.equal(occurrencesSecond, 1, ".worktrees/ must not be duplicated across repeated --overwrite runs");
    const localBoardOccurrencesSecond = afterSecond.split(/\r?\n/).filter((line) => line.trim() === ".local-board/").length;
    assert.equal(localBoardOccurrencesSecond, 1, ".local-board/ must not be duplicated across repeated --overwrite runs");
  });
});

test("initProject --overwrite treats an existing .worktrees line without a trailing slash as already present", async () => {
  await withBoard(async (root) => {
    const gitignorePath = path.join(root, ".gitignore");
    const customContent = "# my custom rules\nnode_modules/\n.worktrees\n.local-board\n";
    await writeFile(gitignorePath, customContent, "utf8");

    await initProject(root, { overwrite: true });
    const after = await readFile(gitignorePath, "utf8");
    assert.equal(after, customContent, "bare .worktrees/.local-board entries must be recognized and nothing appended");
  });
});

async function stampCalibrated(filePath, estimate, workStartedAt, workCompletedAt) {
  await replaceText(filePath, "estimate: null", `estimate: ${estimate}`);
  await replaceText(filePath, "estimateBasis: null", "estimateBasis: bootstrap");
  await replaceText(filePath, "workStartedAt: null", `workStartedAt: ${workStartedAt}`);
  await replaceText(filePath, "workCompletedAt: null", `workCompletedAt: ${workCompletedAt}`);
}

test("suggestCalibration returns bootstrap for an empty pool", async () => {
  await withBoard(async (root) => {
    const targetPath = await createTicket(root, "task", "Target with no pool", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const targetId = path.basename(targetPath).split("_", 1)[0];

    const result = await suggestCalibration(root, targetId);

    assert.equal(result.ticket, targetId);
    assert.equal(result.calibration, "bootstrap");
    assert.equal(result.poolSize, 0);
    assert.equal(result.median, null);
    assert.match(result.reason, /No prior calibrated tickets of type task/);
  });
});

test("suggestCalibration picks the lower-median estimate for odd-count pools", async () => {
  await withBoard(async (root) => {
    const targetPath = await createTicket(root, "task", "Odd pool target", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:50:00Z"),
    });
    const targetId = path.basename(targetPath).split("_", 1)[0];

    const a = await createTicket(root, "task", "Done 1", {
      status: "done",
      now: new Date("2026-05-14T20:51:00Z"),
    });
    const b = await createTicket(root, "task", "Done 2", {
      status: "done",
      now: new Date("2026-05-14T20:52:00Z"),
    });
    const c = await createTicket(root, "task", "Done 4a", {
      status: "done",
      now: new Date("2026-05-14T20:53:00Z"),
    });
    const d = await createTicket(root, "task", "Done 4b", {
      status: "done",
      now: new Date("2026-05-14T20:54:00Z"),
    });
    const e = await createTicket(root, "task", "Done 8", {
      status: "done",
      now: new Date("2026-05-14T20:55:00Z"),
    });

    await stampCalibrated(a, 1, "2026-05-14T21:00:00Z", "2026-05-14T22:00:00Z");
    await stampCalibrated(b, 2, "2026-05-14T21:00:00Z", "2026-05-14T22:01:00Z");
    await stampCalibrated(c, 4, "2026-05-14T21:00:00Z", "2026-05-14T22:02:00Z");
    await stampCalibrated(d, 4, "2026-05-14T21:00:00Z", "2026-05-14T22:03:00Z");
    await stampCalibrated(e, 8, "2026-05-14T21:00:00Z", "2026-05-14T22:04:00Z");

    const dId = path.basename(d).split("_", 1)[0];
    const result = await suggestCalibration(root, targetId);

    assert.equal(result.poolSize, 5);
    assert.equal(result.median, 4);
    // Both estimate-4 entries tie on absDiff; the later workCompletedAt wins.
    assert.equal(result.calibration, dId);
  });
});

test("suggestCalibration uses the lower of two middles for even-count pools", async () => {
  await withBoard(async (root) => {
    const targetPath = await createTicket(root, "task", "Even pool target", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:50:00Z"),
    });
    const targetId = path.basename(targetPath).split("_", 1)[0];

    const a = await createTicket(root, "task", "Done 1", {
      status: "done",
      now: new Date("2026-05-14T20:51:00Z"),
    });
    const b = await createTicket(root, "task", "Done 2", {
      status: "done",
      now: new Date("2026-05-14T20:52:00Z"),
    });
    const c = await createTicket(root, "task", "Done 4", {
      status: "done",
      now: new Date("2026-05-14T20:53:00Z"),
    });
    const d = await createTicket(root, "task", "Done 8", {
      status: "done",
      now: new Date("2026-05-14T20:54:00Z"),
    });
    await stampCalibrated(a, 1, "2026-05-14T21:00:00Z", "2026-05-14T22:00:00Z");
    await stampCalibrated(b, 2, "2026-05-14T21:00:00Z", "2026-05-14T22:01:00Z");
    await stampCalibrated(c, 4, "2026-05-14T21:00:00Z", "2026-05-14T22:02:00Z");
    await stampCalibrated(d, 8, "2026-05-14T21:00:00Z", "2026-05-14T22:03:00Z");

    const bId = path.basename(b).split("_", 1)[0];
    const result = await suggestCalibration(root, targetId);

    assert.equal(result.poolSize, 4);
    assert.equal(result.median, 2);
    assert.equal(result.calibration, bId);
  });
});

test("suggestCalibration breaks absDiff ties by most-recent workCompletedAt", async () => {
  await withBoard(async (root) => {
    const targetPath = await createTicket(root, "task", "Tie-break target", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:50:00Z"),
    });
    const targetId = path.basename(targetPath).split("_", 1)[0];

    const early = await createTicket(root, "task", "Early completed", {
      status: "done",
      now: new Date("2026-05-14T20:51:00Z"),
    });
    const late = await createTicket(root, "task", "Late completed", {
      status: "done",
      now: new Date("2026-05-14T20:52:00Z"),
    });
    await stampCalibrated(early, 4, "2026-05-14T21:00:00Z", "2026-05-14T22:00:00Z");
    await stampCalibrated(late, 4, "2026-05-14T21:00:00Z", "2026-05-15T22:00:00Z");

    const earlyId = path.basename(early).split("_", 1)[0];
    const lateId = path.basename(late).split("_", 1)[0];

    const result = await suggestCalibration(root, targetId);
    assert.equal(result.poolSize, 2);
    assert.equal(result.calibration, lateId);

    // Swap timestamps; selection should flip.
    await replaceText(early, "workCompletedAt: 2026-05-14T22:00:00Z", "workCompletedAt: 2026-05-16T22:00:00Z");
    const swapped = await suggestCalibration(root, targetId);
    assert.equal(swapped.calibration, earlyId);
  });
});

test("suggestCalibration filters pool by ticket type", async () => {
  await withBoard(async (root) => {
    const taskTargetPath = await createTicket(root, "task", "Task target", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:50:00Z"),
    });
    const bugTargetPath = await createTicket(root, "bug", "Bug target", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:51:00Z"),
    });
    const taskTargetId = path.basename(taskTargetPath).split("_", 1)[0];
    const bugTargetId = path.basename(bugTargetPath).split("_", 1)[0];

    const doneTask1 = await createTicket(root, "task", "Done task 1", {
      status: "done",
      now: new Date("2026-05-14T20:52:00Z"),
    });
    const doneTask2 = await createTicket(root, "task", "Done task 2", {
      status: "done",
      now: new Date("2026-05-14T20:53:00Z"),
    });
    const doneTask3 = await createTicket(root, "task", "Done task 4", {
      status: "done",
      now: new Date("2026-05-14T20:54:00Z"),
    });
    const doneBug = await createTicket(root, "bug", "Done bug", {
      status: "done",
      now: new Date("2026-05-14T20:55:00Z"),
    });
    await stampCalibrated(doneTask1, 1, "2026-05-14T21:00:00Z", "2026-05-14T22:00:00Z");
    await stampCalibrated(doneTask2, 2, "2026-05-14T21:00:00Z", "2026-05-14T22:01:00Z");
    await stampCalibrated(doneTask3, 4, "2026-05-14T21:00:00Z", "2026-05-14T22:02:00Z");
    await stampCalibrated(doneBug, 8, "2026-05-14T21:00:00Z", "2026-05-14T22:03:00Z");

    const doneBugId = path.basename(doneBug).split("_", 1)[0];
    const doneTask2Id = path.basename(doneTask2).split("_", 1)[0];

    const bugResult = await suggestCalibration(root, bugTargetId);
    assert.equal(bugResult.poolSize, 1);
    assert.equal(bugResult.calibration, doneBugId);

    const taskResult = await suggestCalibration(root, taskTargetId);
    assert.equal(taskResult.poolSize, 3);
    // Lower-median of [1, 2, 4] is 2.
    assert.equal(taskResult.median, 2);
    assert.equal(taskResult.calibration, doneTask2Id);
  });
});

test("suggestCalibration excludes tickets missing estimate or work timestamps", async () => {
  await withBoard(async (root) => {
    const targetPath = await createTicket(root, "task", "Field-missing target", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:50:00Z"),
    });
    const targetId = path.basename(targetPath).split("_", 1)[0];

    const missingEstimate = await createTicket(root, "task", "Missing estimate", {
      status: "done",
      now: new Date("2026-05-14T20:51:00Z"),
    });
    const missingStart = await createTicket(root, "task", "Missing start", {
      status: "done",
      now: new Date("2026-05-14T20:52:00Z"),
    });
    const full = await createTicket(root, "task", "Fully populated", {
      status: "done",
      now: new Date("2026-05-14T20:53:00Z"),
    });
    // missingEstimate: no estimate, but has timestamps
    await replaceText(missingEstimate, "workStartedAt: null", "workStartedAt: 2026-05-14T21:00:00Z");
    await replaceText(missingEstimate, "workCompletedAt: null", "workCompletedAt: 2026-05-14T22:00:00Z");
    // missingStart: has estimate, but no workStartedAt
    await replaceText(missingStart, "estimate: null", "estimate: 4");
    await replaceText(missingStart, "estimateBasis: null", "estimateBasis: bootstrap");
    // (and no work timestamps; workCompletedAt without workStartedAt would be a validate error,
    //  so we leave both null here.)
    await stampCalibrated(full, 2, "2026-05-14T21:00:00Z", "2026-05-14T22:00:00Z");

    const fullId = path.basename(full).split("_", 1)[0];
    const result = await suggestCalibration(root, targetId);

    assert.equal(result.poolSize, 1);
    assert.equal(result.calibration, fullId);
  });
});

test("suggestCalibration excludes non-done statuses even when other fields are stamped", async () => {
  await withBoard(async (root) => {
    const targetPath = await createTicket(root, "task", "Status-filtered target", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:50:00Z"),
    });
    const targetId = path.basename(targetPath).split("_", 1)[0];

    const notDone = await createTicket(root, "task", "Not done yet", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:51:00Z"),
    });
    await stampCalibrated(notDone, 4, "2026-05-14T21:00:00Z", "2026-05-14T22:00:00Z");

    const result = await suggestCalibration(root, targetId);
    assert.equal(result.calibration, "bootstrap");
    assert.equal(result.poolSize, 0);
  });
});

test("suggestCalibration excludes the target ticket from its own pool", async () => {
  await withBoard(async (root) => {
    const targetPath = await createTicket(root, "task", "Self-exclusion target", {
      status: "done",
      now: new Date("2026-05-14T20:50:00Z"),
    });
    const targetId = path.basename(targetPath).split("_", 1)[0];
    await stampCalibrated(targetPath, 4, "2026-05-14T21:00:00Z", "2026-05-14T22:00:00Z");

    const other = await createTicket(root, "task", "Other done", {
      status: "done",
      now: new Date("2026-05-14T20:51:00Z"),
    });
    await stampCalibrated(other, 2, "2026-05-14T21:00:00Z", "2026-05-14T22:01:00Z");

    const otherId = path.basename(other).split("_", 1)[0];
    const result = await suggestCalibration(root, targetId);

    assert.equal(result.poolSize, 1);
    assert.equal(result.calibration, otherId);
  });
});

test("suggestCalibration throws for an unknown ticket id", async () => {
  await withBoard(async (root) => {
    // Seed at least one ticket so the ticket directory exists; the lookup itself should miss.
    await createTicket(root, "task", "Existing ticket", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    await assert.rejects(
      suggestCalibration(root, "T20990101T0000Z"),
      /ticket T20990101T0000Z not found/,
    );
  });
});

async function writeEstimationConfig(root, enabled) {
  await mkdir(path.join(root, "plans"), { recursive: true });
  await writeFile(
    path.join(root, "plans", "local-board.config.jsonc"),
    JSON.stringify({
      estimation: { enabled, scale: [1, 2, 4, 8], bootstrapDefault: 4, splitThreshold: 16 },
    }),
    "utf8",
  );
}

test("completeStep design refuses a task with null estimate when estimation is enabled", async () => {
  await withBoard(async (root) => {
    await writeEstimationConfig(root, true);
    const ticketPath = await createTicket(root, "task", "Needs estimate", {
      status: "ready_for_design",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await assert.rejects(
      completeStep(root, ticketId, "design", "claude-subagent:local-board-designer@opus", "Design evidence."),
      new RegExp(
        `^Error: complete-step design refused: ticket has no estimate\\. Run local-board estimate ${ticketId} POINTS \\[--basis ID\\] before completing design \\(config\\.estimation\\.enabled is true\\)\\.$`,
      ),
    );

    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /^completedSteps: \[\]$/m);
    assert.doesNotMatch(text, /Completed design via/);
  });
});

test("completeStep design refuses a bug with null estimate when estimation is enabled", async () => {
  await withBoard(async (root) => {
    await writeEstimationConfig(root, true);
    const ticketPath = await createTicket(root, "bug", "Needs estimate bug", {
      status: "ready_for_design",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await assert.rejects(
      completeStep(root, ticketId, "design", "claude-subagent:local-board-designer@opus", "Design evidence."),
      /complete-step design refused: ticket has no estimate/,
    );

    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /^completedSteps: \[\]$/m);
  });
});

test("completeStep design accepts a story with null estimate when estimation is enabled", async () => {
  await withBoard(async (root) => {
    await writeEstimationConfig(root, true);
    const ticketPath = await createTicket(root, "story", "Story design exempt", {
      status: "ready_for_design",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await completeStep(root, ticketId, "design", "claude-subagent:local-board-designer@opus", "Story design evidence.");

    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /^completedSteps: \["design:claude-subagent:local-board-designer@opus"\]$/m);
    assert.deepEqual(validate(await discover(root), await loadConfig(root)), []);
  });
});

test("completeStep design accepts an epic with null estimate when estimation is enabled", async () => {
  await withBoard(async (root) => {
    await writeEstimationConfig(root, true);
    const ticketPath = await createTicket(root, "epic", "Epic design exempt", {
      status: "ready_for_design",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await completeStep(root, ticketId, "design", "claude-subagent:local-board-designer@opus", "Epic design evidence.");

    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /^completedSteps: \["design:claude-subagent:local-board-designer@opus"\]$/m);
    assert.deepEqual(validate(await discover(root), await loadConfig(root)), []);
  });
});

test("completeStep design accepts a task with a non-null estimate when estimation is enabled", async () => {
  await withBoard(async (root) => {
    await writeEstimationConfig(root, true);
    const ticketPath = await createTicket(root, "task", "Task with estimate", {
      status: "ready_for_design",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    await setTicketField(root, ticketId, "estimate", "4");

    await completeStep(root, ticketId, "design", "claude-subagent:local-board-designer@opus", "Design evidence.");

    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /^completedSteps: \["design:claude-subagent:local-board-designer@opus"\]$/m);
    assert.match(text, /^estimate: 4$/m);
    assert.deepEqual(validate(await discover(root), await loadConfig(root)), []);
  });
});

test("completeStep design accepts a task with null estimate when estimation is disabled", async () => {
  await withBoard(async (root) => {
    await writeEstimationConfig(root, false);
    const ticketPath = await createTicket(root, "task", "Estimation disabled", {
      status: "ready_for_design",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await completeStep(root, ticketId, "design", "claude-subagent:local-board-designer@opus", "Design evidence.");

    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /^completedSteps: \["design:claude-subagent:local-board-designer@opus"\]$/m);
    assert.deepEqual(validate(await discover(root), await loadConfig(root)), []);
  });
});

test("completeStep implement is not gated by the design estimate check", async () => {
  await withBoard(async (root) => {
    await writeEstimationConfig(root, true);
    const ticketPath = await createTicket(root, "task", "Implement without estimate", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await completeStep(root, ticketId, "implement", "claude-subagent:local-board-implementer@sonnet", "Implementation evidence.");

    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /^completedSteps: \["implement:claude-subagent:local-board-implementer@sonnet"\]$/m);
    assert.deepEqual(validate(await discover(root), await loadConfig(root)), []);
  });
});

test("writeTicketFile leaves the original file byte-identical when the rename fails", async () => {
  await withBoard(async (root) => {
    const dir = path.join(root, "plans", "tickets", "active");
    await mkdir(dir, { recursive: true });
    const targetPath = path.join(dir, "T20260707T0000Z_sample.md");
    const original = "---\nid: T20260707T0000Z\n---\n\n# Sample\n";
    await writeFile(targetPath, original, "utf8");

    const failingRename = async () => {
      const error = new Error("simulated disk full");
      error.code = "ENOSPC";
      throw error;
    };

    await assert.rejects(
      writeTicketFile(targetPath, "corrupted replacement content", { renameFn: failingRename }),
      /simulated disk full/,
    );

    assert.equal(await readFile(targetPath, "utf8"), original);

    // No orphaned temp file: writeTicketFile cleans up on the caught-error path.
    assert.deepEqual(await readdir(dir), ["T20260707T0000Z_sample.md"]);
  });
});

test("writeTicketFile retries the rename after a transient Windows error", async () => {
  await withBoard(async (root) => {
    const dir = path.join(root, "plans", "tickets", "active");
    await mkdir(dir, { recursive: true });
    const targetPath = path.join(dir, "T20260707T0000Z_sample.md");
    await writeFile(targetPath, "original content\n", "utf8");

    let attempts = 0;
    const flakyRename = async (source, destination) => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("transient lock");
        error.code = "EPERM";
        throw error;
      }
      await rename(source, destination);
    };

    await writeTicketFile(targetPath, "updated content\n", { renameFn: flakyRename });

    assert.equal(attempts, 2);
    assert.equal(await readFile(targetPath, "utf8"), "updated content\n");
    assert.deepEqual(await readdir(dir), ["T20260707T0000Z_sample.md"]);
  });
});

test("successful ticket mutations leave no temp files and discover reports zero load errors", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Atomic write check", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await setTicketSection(root, ticketId, "Implementation Notes", "Done.");
    await appendTicketComment(root, ticketId, "Run Log", "did a thing");
    await completeStep(root, ticketId, "implement", "claude-subagent:local-board-implementer@sonnet", "Implementation evidence.");

    const siblings = await readdir(path.dirname(ticketPath));
    assert.deepEqual(siblings, [path.basename(ticketPath)]);

    const board = await discover(root);
    assert.deepEqual(board.loadErrors, []);
  });
});

test("an orphaned non-.md temp sibling is invisible to discover and validate", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Temp sibling check", {
      status: "ready_for_implementation",
      now: new Date("2026-05-14T20:56:00Z"),
    });

    const tmpSiblingPath = `${ticketPath}.tmp-99999-1`;
    await writeFile(tmpSiblingPath, "not a real ticket", "utf8");

    const board = await discover(root);
    assert.deepEqual(board.loadErrors, []);
    assert.equal(board.tickets.length, 1);
    assert.deepEqual(validate(board), []);
  });
});

// --- Gate-check consultation recording and move-time enforcement (T20260707T1327Z) ---

test("gateConsultationRecords parses gate: tokens; unrelated completedSteps tokens are ignored", () => {
  const ticket = {
    frontMatter: {
      completedSteps: [
        "gate:design:skipped-empty-catalog",
        "gate:implement:claude-subagent:local-board-gatecheck@haiku",
        "design:claude-subagent:local-board-designer@opus",
      ],
    },
  };

  assert.deepEqual(gateConsultationRecords(ticket), [
    { stage: "design", executor: "skipped-empty-catalog" },
    { stage: "implement", executor: "claude-subagent:local-board-gatecheck@haiku" },
  ]);
});

test("gateStageForForwardMove identifies only the three forward gated pairs", () => {
  assert.equal(gateStageForForwardMove("ready_for_design", "ready_for_implementation"), "design");
  assert.equal(gateStageForForwardMove("designing", "ready_for_implementation"), "design");
  assert.equal(gateStageForForwardMove("ready_for_implementation", "ready_for_review"), "implement");
  assert.equal(gateStageForForwardMove("implementing", "ready_for_review"), "implement");
  assert.equal(gateStageForForwardMove("ready_for_test", "ready_for_docs"), "test");
  assert.equal(gateStageForForwardMove("testing", "ready_for_docs"), "test");

  // Backward, lateral, and archive/done moves are never gated.
  assert.equal(gateStageForForwardMove("ready_for_implementation", "ready_for_design"), null);
  assert.equal(gateStageForForwardMove("ready_for_design", "questions"), null);
  assert.equal(gateStageForForwardMove("ready_for_test", "blocked"), null);
  assert.equal(gateStageForForwardMove("done", "archived"), null);
  assert.equal(gateStageForForwardMove("ready_for_docs", "done"), null);
  // Wrong from/to pairing does not accidentally match a different stage.
  assert.equal(gateStageForForwardMove("testing", "ready_for_implementation"), null);
});

test("recordGateSkippedEmptyCatalog stamps gate:<stage>:skipped-empty-catalog idempotently without a Run Log entry", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Empty catalog gate", {
      status: "testing",
      now: new Date("2026-07-07T10:00:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await recordGateSkippedEmptyCatalog(root, ticketId, "test", { now: new Date("2026-07-07T10:05:00Z") });
    const { ticket: afterFirst } = await findTicket(root, ticketId);
    assert.deepEqual(afterFirst.frontMatter.completedSteps, ["gate:test:skipped-empty-catalog"]);
    // No Run Log entry: this is a deterministic CLI self-certification, not a
    // recorded agent verdict.
    assert.doesNotMatch(afterFirst.body, /Gate consultation/);

    // Idempotent re-run (e.g. gate-check called twice) must not duplicate the token.
    await recordGateSkippedEmptyCatalog(root, ticketId, "test", { now: new Date("2026-07-07T10:06:00Z") });
    const { ticket: afterSecond } = await findTicket(root, ticketId);
    assert.deepEqual(afterSecond.frontMatter.completedSteps, ["gate:test:skipped-empty-catalog"]);
  });
});

test("recordGateSkippedEmptyCatalog rejects an unknown stage", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Bad stage", { status: "testing" });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    await assert.rejects(recordGateSkippedEmptyCatalog(root, ticketId, "docs"), /stage must be one of/);
  });
});

test("recordGateConsultation stamps gate:<stage>:<executor>, appends a Run Log line, and accepts route or route@model executor forms", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Gate consultation recorded", {
      status: "designing",
      now: new Date("2026-07-07T11:00:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const result = await recordGateConsultation(
      root,
      ticketId,
      "design",
      "claude-subagent:local-board-gatecheck@haiku",
      "security_threat_model",
      { now: new Date("2026-07-07T11:05:00Z") },
    );

    assert.equal(result.ticket, ticketId);
    assert.equal(result.stage, "design");
    assert.equal(result.executor, "claude-subagent:local-board-gatecheck@haiku");

    const text = await readFile(ticketPath, "utf8");
    assert.match(
      text,
      /^completedSteps: \["gate:design:claude-subagent:local-board-gatecheck@haiku"\]$/m,
    );
    assert.match(
      text,
      /Gate consultation design via claude-subagent:local-board-gatecheck@haiku: security_threat_model/,
    );

    // Route-only executor form (no @model suffix) is also accepted.
    const ticketPath2 = await createTicket(root, "task", "Gate consultation route only", {
      status: "designing",
      now: new Date("2026-07-07T11:10:00Z"),
    });
    const ticketId2 = path.basename(ticketPath2).split("_", 1)[0];
    await recordGateConsultation(root, ticketId2, "design", "claude-subagent:local-board-gatecheck", "none");
    assert.match(
      await readFile(ticketPath2, "utf8"),
      // No "@model" suffix means the token's characters are all unreserved
      // YAML-scalar-safe (see formatString), so it serializes unquoted.
      /^completedSteps: \[gate:design:claude-subagent:local-board-gatecheck\]$/m,
    );
  });
});

test("recordGateConsultation rejects a bad stage, an invalid executor, and empty evidence", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Gate consultation rejections", { status: "designing" });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await assert.rejects(
      recordGateConsultation(root, ticketId, "docs", "claude-subagent:local-board-gatecheck", "none"),
      /stage must be one of/,
    );
    await assert.rejects(
      recordGateConsultation(root, ticketId, "design", "not-a-route", "none"),
      /executor must be one of/,
    );
    await assert.rejects(
      recordGateConsultation(root, ticketId, "design", "claude-subagent:local-board-gatecheck", "  "),
      /non-empty evidence/,
    );
  });
});

test("gate: tokens never trip done-time routing validation (top regression risk: token-collision)", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Gate token collision guard", {
      status: "ready_for_docs",
      now: new Date("2026-07-07T12:00:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    // Hand-write gate tokens for all three stages alongside the mandatory
    // action evidence: `gate:design:skipped-empty-catalog` splits on the
    // FIRST ":" as action="gate", executor="design:skipped-empty-catalog"
    // unless completedStepRecords filters it out first.
    await replaceText(
      ticketPath,
      "completedSteps: []",
      "completedSteps: [gate:design:skipped-empty-catalog, gate:implement:claude-subagent:local-board-gatecheck@haiku, gate:test:skipped-empty-catalog, design:claude-subagent:local-board-designer@opus, implement:claude-subagent:local-board-implementer@sonnet, review:codex-task:read-only, test:claude-subagent:local-board-tester@sonnet, document:codex-task:workspace-write]",
    );

    assert.deepEqual(validate(await discover(root), await loadConfig(root)), []);

    const moved = await moveTicket(root, ticketId, "done");
    assert.match(await readFile(moved, "utf8"), /^status: done$/m);
    assert.deepEqual(validate(await discover(root), await loadConfig(root)), []);
  });
});

test("moveTicket refuses each of the three forward gated transitions without a recorded consultation, and allows it once recorded", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({ routing: { requireGateConsultation: true } }));

    const cases = [
      { from: "ready_for_design", to: "ready_for_implementation", stage: "design" },
      { from: "designing", to: "ready_for_implementation", stage: "design" },
      { from: "ready_for_implementation", to: "ready_for_review", stage: "implement" },
      { from: "implementing", to: "ready_for_review", stage: "implement" },
      { from: "ready_for_test", to: "ready_for_docs", stage: "test" },
      { from: "testing", to: "ready_for_docs", stage: "test" },
    ];

    for (const { from, to, stage } of cases) {
      const ticketPath = await createTicket(root, "task", `Gated ${from} to ${to}`, { status: from });
      const ticketId = path.basename(ticketPath).split("_", 1)[0];

      await assert.rejects(
        moveTicket(root, ticketId, to),
        new RegExp(`no recorded gate consultation for stage "${stage}".*gate-check.*gate-complete`, "s"),
        `${from} -> ${to} must be refused without a recorded consultation`,
      );

      await recordGateSkippedEmptyCatalog(root, ticketId, stage);
      const moved = await moveTicket(root, ticketId, to);
      assert.match(await readFile(moved, "utf8"), new RegExp(`^status: ${to}$`, "m"));
    }
  });
});

test("moveTicket gating never blocks backward, lateral, or archive/done moves, even with the switch on", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({ routing: { requireGateConsultation: true } }));

    const backward = await createTicket(root, "task", "Backward loop-back", { status: "ready_for_implementation" });
    const backwardId = path.basename(backward).split("_", 1)[0];
    await moveTicket(root, backwardId, "ready_for_design");

    const questions = await createTicket(root, "task", "Needs questions", { status: "ready_for_design" });
    const questionsId = path.basename(questions).split("_", 1)[0];
    await moveTicket(root, questionsId, "questions");

    const blocked = await createTicket(root, "task", "Non-ticket blocker", { status: "ready_for_test" });
    const blockedId = path.basename(blocked).split("_", 1)[0];
    await moveTicket(root, blockedId, "blocked");

    const doneTicket = await createTicket(root, "task", "Already done", { status: "done" });
    const doneId = path.basename(doneTicket).split("_", 1)[0];
    await moveTicket(root, doneId, "archived");
  });
});

test("moveTicket gating is disabled by default (switch off) and via explicit false", async () => {
  await withBoard(async (root) => {
    // No config file at all: DEFAULT_CONFIG fallback keeps requireGateConsultation false.
    const noConfig = await createTicket(root, "task", "No config gate", { status: "ready_for_design" });
    const noConfigId = path.basename(noConfig).split("_", 1)[0];
    await moveTicket(root, noConfigId, "ready_for_implementation");

    await writeConfig(root, JSON.stringify({ routing: { requireGateConsultation: false } }));
    const explicitOff = await createTicket(root, "task", "Explicit switch off", { status: "ready_for_implementation" });
    const explicitOffId = path.basename(explicitOff).split("_", 1)[0];
    await moveTicket(root, explicitOffId, "ready_for_review");
  });
});

test("set <id> status routes through moveTicket and is gated too", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({ routing: { requireGateConsultation: true } }));
    const ticketPath = await createTicket(root, "task", "Gated via setTicketField", { status: "ready_for_test" });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await assert.rejects(
      setTicketField(root, ticketId, "status", "ready_for_docs"),
      /no recorded gate consultation for stage "test"/,
    );

    await recordGateSkippedEmptyCatalog(root, ticketId, "test");
    await setTicketField(root, ticketId, "status", "ready_for_docs");
    assert.match(await readFile(ticketPath, "utf8"), /^status: ready_for_docs$/m);
  });
});

test("back-compat: a ticket already at ready_for_docs with no gate tokens still moves to done (switch on)", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({ routing: { requireGateConsultation: true } }));
    const ticketPath = await createTicket(root, "task", "Pre-existing ready_for_docs ticket", {
      status: "ready_for_docs",
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await completeStep(root, ticketId, "design", "claude-subagent:local-board-designer@opus", "Design evidence.");
    await completeStep(root, ticketId, "implement", "claude-subagent:local-board-implementer@sonnet", "Implementation evidence.");
    await completeStep(root, ticketId, "review", "codex-task:read-only", "Review evidence.");
    await completeStep(root, ticketId, "test", "claude-subagent:local-board-tester@sonnet", "Test evidence.");
    await completeStep(root, ticketId, "document", "codex-task:workspace-write", "Documentation evidence.");

    // ready_for_docs -> done is not one of the three gated forward pairs, so
    // no gate token is required even with the switch on.
    const moved = await moveTicket(root, ticketId, "done");
    assert.match(await readFile(moved, "utf8"), /^status: done$/m);
  });
});

// ---------------------------------------------------------------------------
// invalidateOnLoopBack (T20260707T1328Z): strip stale downstream evidence on
// a loop-back move.
// ---------------------------------------------------------------------------

const OPTIONAL_STEPS_FOR_INVALIDATION_TESTS = {
  design: [
    { name: "security_threat_model", prompt: "p.md", triggers: "t" },
  ],
  implement: [
    { name: "security_audit", prompt: "p.md", triggers: "t" },
  ],
  test: [
    { name: "perf_probe", prompt: "p.md", triggers: "t" },
  ],
};

const FULL_EVIDENCE_FRONT_MATTER = {
  completedSteps: [
    "decompose:claude-subagent:local-board-decomposer@opus",
    "design:claude-subagent:local-board-designer@opus",
    "gate:design:skipped-empty-catalog",
    "security_threat_model:inline",
    "implement:claude-subagent:local-board-implementer@sonnet",
    "gate:implement:skipped-empty-catalog",
    "security_audit:inline",
    "review:codex-task:read-only",
    "test:claude-subagent:local-board-tester@sonnet",
    "gate:test:skipped-empty-catalog",
    "perf_probe:inline",
    "document:codex-task:workspace-write",
  ],
  routingApprovals: [
    "implement:claude-subagent:local-board-implementer@sonnet",
    "security_audit:inline",
    "design:claude-subagent:local-board-designer@opus",
  ],
};

test("invalidateDownstreamEvidence: target ready_for_implementation strips implement/review/test/document + their gate tokens + implement/test specialties + matching approvals; design-stage evidence and approval survive", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({ optionalSteps: OPTIONAL_STEPS_FOR_INVALIDATION_TESTS }));
    const config = await loadConfig(root);

    const result = invalidateDownstreamEvidence(FULL_EVIDENCE_FRONT_MATTER, config, "ready_for_implementation");

    assert.deepEqual(result.completedSteps, [
      "decompose:claude-subagent:local-board-decomposer@opus",
      "design:claude-subagent:local-board-designer@opus",
      "gate:design:skipped-empty-catalog",
      "security_threat_model:inline",
    ]);
    assert.deepEqual(result.routingApprovals, ["design:claude-subagent:local-board-designer@opus"]);
    assert.deepEqual(result.removed.completedSteps, [
      "implement:claude-subagent:local-board-implementer@sonnet",
      "gate:implement:skipped-empty-catalog",
      "security_audit:inline",
      "review:codex-task:read-only",
      "test:claude-subagent:local-board-tester@sonnet",
      "gate:test:skipped-empty-catalog",
      "perf_probe:inline",
      "document:codex-task:workspace-write",
    ]);
    assert.deepEqual(result.removed.routingApprovals, [
      "implement:claude-subagent:local-board-implementer@sonnet",
      "security_audit:inline",
    ]);
  });
});

test("invalidateDownstreamEvidence: target ready_for_design strips everything except decompose", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({ optionalSteps: OPTIONAL_STEPS_FOR_INVALIDATION_TESTS }));
    const config = await loadConfig(root);

    const result = invalidateDownstreamEvidence(FULL_EVIDENCE_FRONT_MATTER, config, "ready_for_design");

    assert.deepEqual(result.completedSteps, ["decompose:claude-subagent:local-board-decomposer@opus"]);
    assert.deepEqual(result.routingApprovals, []);
  });
});

test("invalidateDownstreamEvidence: target ready_for_docs strips only document", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({ optionalSteps: OPTIONAL_STEPS_FOR_INVALIDATION_TESTS }));
    const config = await loadConfig(root);

    const result = invalidateDownstreamEvidence(FULL_EVIDENCE_FRONT_MATTER, config, "ready_for_docs");

    assert.deepEqual(result.removed.completedSteps, ["document:codex-task:workspace-write"]);
    assert.deepEqual(result.removed.routingApprovals, []);
    assert.equal(result.completedSteps.includes("document:codex-task:workspace-write"), false);
    assert.equal(result.completedSteps.length, FULL_EVIDENCE_FRONT_MATTER.completedSteps.length - 1);
  });
});

test("invalidateDownstreamEvidence: forward move with no downstream evidence yet is a no-op", async () => {
  await withBoard(async (root) => {
    const config = await loadConfig(root);
    const frontMatter = { completedSteps: ["decompose:claude-subagent:local-board-decomposer@opus"], routingApprovals: [] };

    const result = invalidateDownstreamEvidence(frontMatter, config, "ready_for_implementation");

    assert.deepEqual(result.completedSteps, frontMatter.completedSteps);
    assert.deepEqual(result.routingApprovals, []);
    assert.deepEqual(result.removed, { completedSteps: [], routingApprovals: [] });
  });
});

test("invalidateDownstreamEvidence: a model-suffixed token is stripped wholesale, not split on @", async () => {
  await withBoard(async (root) => {
    const config = await loadConfig(root);
    const frontMatter = {
      completedSteps: ["implement:claude-subagent:local-board-implementer@sonnet"],
      routingApprovals: [],
    };

    const result = invalidateDownstreamEvidence(frontMatter, config, "ready_for_implementation");

    assert.deepEqual(result.removed.completedSteps, ["implement:claude-subagent:local-board-implementer@sonnet"]);
    assert.deepEqual(result.completedSteps, []);
  });
});

test("invalidateDownstreamEvidence: optional specialty is stripped for its own stage, kept when its stage is upstream of the target", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({ optionalSteps: OPTIONAL_STEPS_FOR_INVALIDATION_TESTS }));
    const config = await loadConfig(root);

    // Target ready_for_test (rank 1): the test-stage specialty is at-or-downstream
    // and must be stripped; the design- and implement-stage specialties are
    // upstream (ranks 4 and 3) and must survive.
    const result = invalidateDownstreamEvidence(FULL_EVIDENCE_FRONT_MATTER, config, "ready_for_test");

    assert.equal(result.completedSteps.includes("perf_probe:inline"), false);
    assert.equal(result.completedSteps.includes("security_audit:inline"), true);
    assert.equal(result.completedSteps.includes("security_threat_model:inline"), true);
  });
});

test("invalidateDownstreamEvidence: a target status with no pipeline rank (e.g. questions) is a defensive no-op", async () => {
  await withBoard(async (root) => {
    const config = await loadConfig(root);
    const result = invalidateDownstreamEvidence(FULL_EVIDENCE_FRONT_MATTER, config, "questions");

    assert.deepEqual(result.completedSteps, FULL_EVIDENCE_FRONT_MATTER.completedSteps);
    assert.deepEqual(result.routingApprovals, FULL_EVIDENCE_FRONT_MATTER.routingApprovals);
    assert.deepEqual(result.removed, { completedSteps: [], routingApprovals: [] });
  });
});

test("moveTicket loop-back invalidation: acceptance path — test-fail loop-back strips implement/review/test/document and their gate tokens, design survives, done is refused until the stripped steps are re-recorded", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({ routing: { invalidateOnLoopBack: true } }));

    const ticketPath = await createTicket(root, "task", "Loop-back invalidation acceptance", {
      status: "ready_for_design",
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    // Set an estimate before design, to assert it survives the loop-back untouched.
    await setTicketField(root, ticketId, "estimate", "4");

    await completeStep(root, ticketId, "design", "claude-subagent:local-board-designer@opus", "Design evidence.");
    await recordGateSkippedEmptyCatalog(root, ticketId, "design");
    await moveTicket(root, ticketId, "ready_for_implementation");

    await completeStep(root, ticketId, "implement", "claude-subagent:local-board-implementer@sonnet", "Implementation evidence.");
    await recordGateSkippedEmptyCatalog(root, ticketId, "implement");
    await moveTicket(root, ticketId, "ready_for_review");

    await completeStep(root, ticketId, "review", "codex-task:read-only", "Review evidence.");
    await moveTicket(root, ticketId, "ready_for_test");

    await completeStep(root, ticketId, "test", "claude-subagent:local-board-tester@sonnet", "Test evidence.");
    await recordGateSkippedEmptyCatalog(root, ticketId, "test");
    await moveTicket(root, ticketId, "ready_for_docs");

    await completeStep(root, ticketId, "document", "codex-task:workspace-write", "Documentation evidence.");

    const { ticket: beforeLoopBack } = await findTicket(root, ticketId);
    assert.deepEqual(beforeLoopBack.frontMatter.completedSteps, [
      "design:claude-subagent:local-board-designer@opus",
      "gate:design:skipped-empty-catalog",
      "implement:claude-subagent:local-board-implementer@sonnet",
      "gate:implement:skipped-empty-catalog",
      "review:codex-task:read-only",
      "test:claude-subagent:local-board-tester@sonnet",
      "gate:test:skipped-empty-catalog",
      "document:codex-task:workspace-write",
    ]);

    // Test failure: loop back to ready_for_implementation.
    await moveTicket(root, ticketId, "ready_for_implementation");

    const { ticket: afterLoopBack } = await findTicket(root, ticketId);
    assert.deepEqual(afterLoopBack.frontMatter.completedSteps, [
      "design:claude-subagent:local-board-designer@opus",
      "gate:design:skipped-empty-catalog",
    ]);
    assert.equal(afterLoopBack.frontMatter.estimate, "4");
    assert.equal(afterLoopBack.frontMatter.estimateBasis, null);

    // Run Log enumerates exactly what was stripped.
    assert.match(afterLoopBack.body, /Invalidated downstream evidence on loop-back to ready_for_implementation/);
    assert.match(afterLoopBack.body, /implement:claude-subagent:local-board-implementer@sonnet/);
    assert.match(afterLoopBack.body, /gate:implement:skipped-empty-catalog/);
    assert.match(afterLoopBack.body, /review:codex-task:read-only/);
    assert.match(afterLoopBack.body, /test:claude-subagent:local-board-tester@sonnet/);
    assert.match(afterLoopBack.body, /gate:test:skipped-empty-catalog/);
    assert.match(afterLoopBack.body, /document:codex-task:workspace-write/);

    // Premature move straight to done now fails: implement/review/test/document evidence is gone.
    await assert.rejects(moveTicket(root, ticketId, "done"), /missing completedSteps entry for (implement|review|test|document)/);

    // Re-running the stripped steps re-records evidence; done now succeeds.
    await completeStep(root, ticketId, "implement", "claude-subagent:local-board-implementer@sonnet", "Re-implemented after test failure.");
    await completeStep(root, ticketId, "review", "codex-task:read-only", "Re-reviewed.");
    await completeStep(root, ticketId, "test", "claude-subagent:local-board-tester@sonnet", "Re-tested; passes now.");
    await completeStep(root, ticketId, "document", "codex-task:workspace-write", "Docs updated.");

    const moved = await moveTicket(root, ticketId, "done");
    assert.match(await readFile(moved, "utf8"), /^status: done$/m);
    assert.deepEqual(validate(await discover(root), await loadConfig(root)), []);
  });
});

test("moveTicket loop-back invalidation: moves to questions/blocked never strip, even with the switch on", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({ routing: { invalidateOnLoopBack: true } }));

    const ticketPath = await createTicket(root, "task", "Questions/blocked no-strip", { status: "ready_for_test" });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    await completeStep(root, ticketId, "design", "claude-subagent:local-board-designer@opus", "Design evidence.");
    await completeStep(root, ticketId, "implement", "claude-subagent:local-board-implementer@sonnet", "Implementation evidence.");
    await completeStep(root, ticketId, "review", "codex-task:read-only", "Review evidence.");

    await moveTicket(root, ticketId, "questions");
    const { ticket: afterQuestions } = await findTicket(root, ticketId);
    assert.deepEqual(afterQuestions.frontMatter.completedSteps, [
      "design:claude-subagent:local-board-designer@opus",
      "implement:claude-subagent:local-board-implementer@sonnet",
      "review:codex-task:read-only",
    ]);

    await setTicketField(root, ticketId, "status", "ready_for_test");
    await moveTicket(root, ticketId, "blocked");
    const { ticket: afterBlocked } = await findTicket(root, ticketId);
    assert.deepEqual(afterBlocked.frontMatter.completedSteps, [
      "design:claude-subagent:local-board-designer@opus",
      "implement:claude-subagent:local-board-implementer@sonnet",
      "review:codex-task:read-only",
    ]);
  });
});

test("moveTicket loop-back invalidation: switch off (default and explicit false) preserves old behavior; switch on strips", async () => {
  await withBoard(async (root) => {
    // Switch off by default (no config file): stale review/test-stage evidence
    // survives a loop-back.
    const noConfig = await createTicket(root, "task", "Switch off default", { status: "ready_for_test" });
    const noConfigId = path.basename(noConfig).split("_", 1)[0];
    await completeStep(root, noConfigId, "implement", "claude-subagent:local-board-implementer@sonnet", "Impl.");
    await completeStep(root, noConfigId, "review", "codex-task:read-only", "Review.");
    await moveTicket(root, noConfigId, "ready_for_implementation");
    const { ticket: noConfigAfter } = await findTicket(root, noConfigId);
    assert.deepEqual(noConfigAfter.frontMatter.completedSteps, [
      "implement:claude-subagent:local-board-implementer@sonnet",
      "review:codex-task:read-only",
    ]);

    // Explicit false behaves the same.
    await writeConfig(root, JSON.stringify({ routing: { invalidateOnLoopBack: false } }));
    const explicitOff = await createTicket(root, "task", "Switch off explicit", { status: "ready_for_test" });
    const explicitOffId = path.basename(explicitOff).split("_", 1)[0];
    await completeStep(root, explicitOffId, "implement", "claude-subagent:local-board-implementer@sonnet", "Impl.");
    await completeStep(root, explicitOffId, "review", "codex-task:read-only", "Review.");
    await moveTicket(root, explicitOffId, "ready_for_implementation");
    const { ticket: explicitOffAfter } = await findTicket(root, explicitOffId);
    assert.deepEqual(explicitOffAfter.frontMatter.completedSteps, [
      "implement:claude-subagent:local-board-implementer@sonnet",
      "review:codex-task:read-only",
    ]);

    // Switch on: the same loop-back now strips.
    await writeConfig(root, JSON.stringify({ routing: { invalidateOnLoopBack: true } }));
    const on = await createTicket(root, "task", "Switch on", { status: "ready_for_test" });
    const onId = path.basename(on).split("_", 1)[0];
    await completeStep(root, onId, "implement", "claude-subagent:local-board-implementer@sonnet", "Impl.");
    await completeStep(root, onId, "review", "codex-task:read-only", "Review.");
    await moveTicket(root, onId, "ready_for_implementation");
    const { ticket: onAfter } = await findTicket(root, onId);
    assert.deepEqual(onAfter.frontMatter.completedSteps, []);
    assert.match(onAfter.body, /Invalidated downstream evidence on loop-back to ready_for_implementation/);
  });
});

// ---------------------------------------------------------------------------
// guardPrematureEvidence (T20260708T2210Z): refuse completeStep when the
// recorded evidence would be silently stripped by a still-pending forward
// move (the same relation invalidateDownstreamEvidence uses), instead of
// surfacing much later as a "move done" failure.
// ---------------------------------------------------------------------------

test("completeStep guardPrematureEvidence refuses review recorded upstream of ready_for_review (ready_for_implementation and implementing), naming the earliest safe status; zero side effects", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({ routing: { guardPrematureEvidence: true } }));

    for (const status of ["ready_for_implementation", "implementing"]) {
      const ticketPath = await createTicket(root, "task", `Premature review at ${status}`, { status });
      const ticketId = path.basename(ticketPath).split("_", 1)[0];

      const { ticket: before } = await findTicket(root, ticketId);

      await assert.rejects(
        completeStep(root, ticketId, "review", "codex-task:read-only", "Review evidence."),
        /complete-step review refused:.*would be stripped by the forward move into ready_for_review.*routing\.invalidateOnLoopBack/s,
      );

      const { ticket: after } = await findTicket(root, ticketId);
      assert.deepEqual(after.frontMatter.completedSteps, before.frontMatter.completedSteps);
      assert.equal(after.body, before.body);
    }
  });
});

test("completeStep guardPrematureEvidence generalizes to test recorded at ready_for_review and to an optional specialty step recorded upstream of its stage", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({
      routing: { guardPrematureEvidence: true },
      optionalSteps: OPTIONAL_STEPS_FOR_INVALIDATION_TESTS,
    }));

    const testTicketPath = await createTicket(root, "task", "Premature test", { status: "ready_for_review" });
    const testTicketId = path.basename(testTicketPath).split("_", 1)[0];
    await assert.rejects(
      completeStep(root, testTicketId, "test", "claude-subagent:local-board-tester@sonnet", "Test evidence."),
      /complete-step test refused:.*would be stripped by the forward move into ready_for_test/s,
    );

    // security_audit is an implement-stage specialty (producing status
    // ready_for_implementation); recording it at ready_for_design (upstream)
    // is refused the same way.
    const specialtyTicketPath = await createTicket(root, "task", "Premature specialty", { status: "ready_for_design" });
    const specialtyTicketId = path.basename(specialtyTicketPath).split("_", 1)[0];
    await assert.rejects(
      completeStep(root, specialtyTicketId, "security_audit", "inline", "PASS: no findings"),
      /complete-step security_audit refused:.*would be stripped by the forward move into ready_for_implementation/s,
    );
  });
});

test("completeStep guardPrematureEvidence: --override records the token and appends both the Completed and Premature-evidence override Run Log lines", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({ routing: { guardPrematureEvidence: true } }));

    const ticketPath = await createTicket(root, "task", "Override premature review", { status: "ready_for_implementation" });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const result = await completeStep(root, ticketId, "review", "codex-task:read-only", "Review evidence.", {
      override: true,
      overrideReason: "Recording early per orchestrator instruction",
    });
    assert.equal(result.action, "review");

    const { ticket } = await findTicket(root, ticketId);
    assert.deepEqual(ticket.frontMatter.completedSteps, ["review:codex-task:read-only"]);
    assert.match(ticket.body, /Completed review via codex-task:read-only: Review evidence\./);
    assert.match(
      ticket.body,
      /Premature-evidence override: recorded review at ready_for_implementation ahead of its producing status ready_for_review: Recording early per orchestrator instruction/,
    );
  });
});

test("completeStep guardPrematureEvidence: legal orderings are unaffected (review at ready_for_review/reviewing/ready_for_test; implement at ready_for_implementation)", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({ routing: { guardPrematureEvidence: true } }));

    for (const status of ["ready_for_review", "reviewing", "ready_for_test"]) {
      const ticketPath = await createTicket(root, "task", `Legal review at ${status}`, { status });
      const ticketId = path.basename(ticketPath).split("_", 1)[0];

      const result = await completeStep(root, ticketId, "review", "codex-task:read-only", "Review evidence.");
      assert.equal(result.action, "review");

      const { ticket } = await findTicket(root, ticketId);
      assert.deepEqual(ticket.frontMatter.completedSteps, ["review:codex-task:read-only"]);
      assert.doesNotMatch(ticket.body, /Premature-evidence override/);
    }

    const implTicketPath = await createTicket(root, "task", "Legal implement", { status: "ready_for_implementation" });
    const implTicketId = path.basename(implTicketPath).split("_", 1)[0];
    const implResult = await completeStep(
      root,
      implTicketId,
      "implement",
      "claude-subagent:local-board-implementer@sonnet",
      "Implementation evidence.",
    );
    assert.equal(implResult.action, "implement");
  });
});

test("completeStep guardPrematureEvidence: switch off (default and explicit false) preserves old behavior — the refusal case from the guard test now records normally", async () => {
  await withBoard(async (root) => {
    // No config file at all: DEFAULT_CONFIG fallback keeps the guard off.
    const noConfigPath = await createTicket(root, "task", "Guard off default", { status: "ready_for_implementation" });
    const noConfigId = path.basename(noConfigPath).split("_", 1)[0];
    const noConfigResult = await completeStep(root, noConfigId, "review", "codex-task:read-only", "Review evidence.");
    assert.equal(noConfigResult.action, "review");

    // Explicit false behaves the same.
    await writeConfig(root, JSON.stringify({ routing: { guardPrematureEvidence: false } }));
    const explicitOffPath = await createTicket(root, "task", "Guard off explicit", { status: "ready_for_implementation" });
    const explicitOffId = path.basename(explicitOffPath).split("_", 1)[0];
    const explicitOffResult = await completeStep(root, explicitOffId, "review", "codex-task:read-only", "Review evidence.");
    assert.equal(explicitOffResult.action, "review");
  });
});

test("completeStep guardPrematureEvidence: a refusal leaves the active-step ledger untouched (no clearActiveStep on throw)", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({ routing: { guardPrematureEvidence: true } }));

    const ticketPath = await createTicket(root, "task", "Guard refusal preserves active step", {
      status: "ready_for_implementation",
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await beginStep(root, ticketId, "review");
    const before = await readActiveSteps(root);
    assert.equal(before[ticketId].action, "review");

    await assert.rejects(completeStep(root, ticketId, "review", "codex-task:read-only", "Review evidence."));

    const after = await readActiveSteps(root);
    assert.deepEqual(after[ticketId], before[ticketId]);
  });
});

test("completeStep guardPrematureEvidence refuses review recorded at the rankless non-terminal statuses questions and backlog (both are upstream of every pipeline status); --override still records it", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({ routing: { guardPrematureEvidence: true } }));

    for (const status of ["questions", "backlog"]) {
      const ticketPath = await createTicket(root, "task", `Premature review at ${status}`, { status });
      const ticketId = path.basename(ticketPath).split("_", 1)[0];

      const { ticket: before } = await findTicket(root, ticketId);
      await assert.rejects(
        completeStep(root, ticketId, "review", "codex-task:read-only", "Review evidence."),
        /complete-step review refused:.*would be stripped by the forward move into ready_for_review.*routing\.invalidateOnLoopBack/s,
      );
      const { ticket: afterRefusal } = await findTicket(root, ticketId);
      assert.deepEqual(afterRefusal.frontMatter.completedSteps, before.frontMatter.completedSteps);
      assert.equal(afterRefusal.body, before.body);

      const result = await completeStep(root, ticketId, "review", "codex-task:read-only", "Review evidence.", {
        override: true,
        overrideReason: `Recording early while ${status}`,
      });
      assert.equal(result.action, "review");
      const { ticket: afterOverride } = await findTicket(root, ticketId);
      assert.deepEqual(afterOverride.frontMatter.completedSteps, ["review:codex-task:read-only"]);
    }
  });
});

test("completeStep guardPrematureEvidence at done/archived is unaffected (rankless terminal statuses; out of normal flow): records normally, no refusal", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({ routing: { guardPrematureEvidence: true } }));

    for (const status of ["done", "archived"]) {
      const ticketPath = await createTicket(root, "task", `Review at ${status}`, { status });
      const ticketId = path.basename(ticketPath).split("_", 1)[0];

      const result = await completeStep(root, ticketId, "review", "codex-task:read-only", "Review evidence.");
      assert.equal(result.action, "review");
      const { ticket } = await findTicket(root, ticketId);
      assert.deepEqual(ticket.frontMatter.completedSteps, ["review:codex-task:read-only"]);
      assert.doesNotMatch(ticket.body, /Premature-evidence override/);
    }
  });
});

test("completeStep --override with an empty or missing overrideReason throws even when called directly (not just via the CLI)", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({ routing: { guardPrematureEvidence: true } }));

    const ticketPath = await createTicket(root, "task", "Override missing reason", { status: "ready_for_implementation" });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await assert.rejects(
      completeStep(root, ticketId, "review", "codex-task:read-only", "Review evidence.", { override: true }),
      /complete-step --override requires a non-empty overrideReason/,
    );
    await assert.rejects(
      completeStep(root, ticketId, "review", "codex-task:read-only", "Review evidence.", {
        override: true,
        overrideReason: "   ",
      }),
      /complete-step --override requires a non-empty overrideReason/,
    );

    const { ticket } = await findTicket(root, ticketId);
    assert.deepEqual(ticket.frontMatter.completedSteps, []);
  });
});

// ---------------------------------------------------------------------------
// enforceTransitions (T20260707T1329Z): promote workflow.transitions to a
// hard validator, with a fixed structural allow-set for administrative moves
// and an --override escape.
// ---------------------------------------------------------------------------

test("isTransitionAllowed: map targets, the full structural allow-set, and self-transition", () => {
  const config = { workflow: { transitions: { ready_for_implementation: [
    { status: "ready_for_review" },
    { status: "ready_for_design" },
    { status: "questions" },
    { status: "blocked" },
  ] } } };

  // Map-governed pipeline ordering.
  assert.equal(isTransitionAllowed(config, "ready_for_implementation", "ready_for_review"), true);
  assert.equal(isTransitionAllowed(config, "ready_for_implementation", "ready_for_design"), true);
  // Not in the map and not structural: the headline refusal case.
  assert.equal(isTransitionAllowed(config, "ready_for_implementation", "ready_for_test"), false);

  // Structural rule 1: self-transition.
  assert.equal(isTransitionAllowed(config, "ready_for_implementation", "ready_for_implementation"), true);
  // Structural rule 2: backlog -> any trigger status.
  assert.equal(isTransitionAllowed(config, "backlog", "ready_for_design"), true);
  assert.equal(isTransitionAllowed(config, "backlog", "done"), false);
  // Structural rule 3: ready_* -> its paired active status.
  assert.equal(isTransitionAllowed(config, "ready_for_implementation", "implementing"), true);
  assert.equal(isTransitionAllowed(config, "ready_for_design", "designing"), true);
  // Structural rule 4: active -> its own ready_* (revert).
  assert.equal(isTransitionAllowed(config, "implementing", "ready_for_implementation"), true);
  // Wrong pairing is not structurally allowed.
  assert.equal(isTransitionAllowed(config, "ready_for_implementation", "designing"), false);
  // Structural rule 5: questions/blocked -> any trigger status (resume).
  assert.equal(isTransitionAllowed(config, "questions", "ready_for_test"), true);
  assert.equal(isTransitionAllowed(config, "blocked", "ready_for_implementation"), true);
  // Structural rule 6: any -> archived.
  assert.equal(isTransitionAllowed(config, "done", "archived"), true);
  assert.equal(isTransitionAllowed(config, "ready_for_design", "archived"), true);
  // Structural rule 7: any -> questions/blocked.
  assert.equal(isTransitionAllowed(config, "designing", "questions"), true);
  assert.equal(isTransitionAllowed(config, "backlog", "blocked"), true);
});

test("moveTicket refuses an illegal transition with an actionable allowed-targets error and zero side effects (switch on)", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({ routing: { enforceTransitions: true } }));
    const ticketPath = await createTicket(root, "task", "Skip review", { status: "ready_for_implementation" });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    const before = await readFile(ticketPath, "utf8");

    await assert.rejects(
      moveTicket(root, ticketId, "ready_for_test"),
      /move refused: transition ready_for_implementation -> ready_for_test is not allowed\. Allowed targets: .*--override --reason/s,
    );

    const after = await readFile(ticketPath, "utf8");
    assert.equal(after, before, "a refused move must leave the ticket file byte-unchanged");
    const { ticket } = await findTicket(root, ticketId);
    assert.equal(ticket.status, "ready_for_implementation");
  });
});

test("moveTicket refusal error names the allowed targets (map union structural)", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({ routing: { enforceTransitions: true } }));
    const ticketPath = await createTicket(root, "task", "Allowed targets", { status: "ready_for_implementation" });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await assert.rejects(moveTicket(root, ticketId, "ready_for_test"), (error) => {
      assert.match(error.message, /Allowed targets:/);
      for (const target of ["ready_for_review", "ready_for_design", "questions", "blocked", "implementing", "archived"]) {
        assert.match(error.message, new RegExp(`\\b${target}\\b`), `expected allowed targets to list ${target}`);
      }
      return true;
    });
  });
});

test("moveTicket allows a legal pipeline forward move unchanged (switch on)", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({ routing: { enforceTransitions: true } }));
    const ticketPath = await createTicket(root, "task", "Review to test", { status: "ready_for_review" });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const moved = await moveTicket(root, ticketId, "ready_for_test");
    assert.match(await readFile(moved, "utf8"), /^status: ready_for_test$/m);
  });
});

test("moveTicket allows every structural allow-set category under enforcement (switch on)", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({ routing: { enforceTransitions: true } }));

    // 1. Same-status re-save.
    const same = await createTicket(root, "task", "Re-save", { status: "ready_for_implementation" });
    const sameId = path.basename(same).split("_", 1)[0];
    await moveTicket(root, sameId, "ready_for_implementation");

    // 2. backlog -> ready_* (promote out of backlog).
    const backlog = await createTicket(root, "task", "Promote from backlog", { status: "backlog" });
    const backlogId = path.basename(backlog).split("_", 1)[0];
    await moveTicket(root, backlogId, "ready_for_design");

    // 3. ready_* -> paired active (start-work).
    const startWork = await createTicket(root, "task", "Start work", { status: "ready_for_implementation" });
    const startWorkId = path.basename(startWork).split("_", 1)[0];
    await moveTicket(root, startWorkId, "implementing");

    // 4. active -> its own ready_* (revert).
    const revert = await createTicket(root, "task", "Revert active", { status: "implementing" });
    const revertId = path.basename(revert).split("_", 1)[0];
    await moveTicket(root, revertId, "ready_for_implementation");

    // 5. questions/blocked -> ready_* (resume).
    const questions = await createTicket(root, "task", "Resume from questions", { status: "questions" });
    const questionsId = path.basename(questions).split("_", 1)[0];
    await moveTicket(root, questionsId, "ready_for_implementation");

    const blocked = await createTicket(root, "task", "Resume from blocked", { status: "blocked" });
    const blockedId = path.basename(blocked).split("_", 1)[0];
    await moveTicket(root, blockedId, "ready_for_test");

    // 6. any -> archived (supersede).
    const supersede = await createTicket(root, "task", "Supersede", { status: "ready_for_design" });
    const supersedeId = path.basename(supersede).split("_", 1)[0];
    await moveTicket(root, supersedeId, "archived");

    // 6. any -> archived (retention, via archiveDoneTickets -> moveTicket).
    const retire = await createTicket(root, "task", "Retention", {
      status: "done",
      now: new Date("2026-03-01T12:00:00Z"),
    });
    const retireId = path.basename(retire).split("_", 1)[0];
    const archived = await archiveDoneTickets(root, { archiveDoneAfterDays: 30, now: new Date("2026-06-01T12:00:00Z") });
    assert.deepEqual(archived.map((record) => record.ticket), [retireId]);

    // 7. any -> questions/blocked (escape hatch), from a status the map does
    // not cover (designing has no map entry other than its own three exits;
    // backlog has none at all).
    const backlogQuestions = await createTicket(root, "task", "Backlog to questions", { status: "backlog" });
    const backlogQuestionsId = path.basename(backlogQuestions).split("_", 1)[0];
    await moveTicket(root, backlogQuestionsId, "questions");

    for (const id of [sameId, backlogId, startWorkId, revertId, questionsId, blockedId, supersedeId, backlogQuestionsId]) {
      const { ticket } = await findTicket(root, id);
      assert.notEqual(ticket, undefined, `${id} must still resolve after its structural move`);
    }
  });
});

test("moveTicket --override forces a refused move and records exactly one Transition override line; a no-reason override omits the suffix; overriding an already-allowed move writes no line", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({ routing: { enforceTransitions: true } }));

    const withReason = await createTicket(root, "task", "Override with reason", { status: "ready_for_implementation" });
    const withReasonId = path.basename(withReason).split("_", 1)[0];
    const moved = await moveTicket(root, withReasonId, "ready_for_test", {
      overrideTransition: { reason: "Emergency hotfix, review waived by lead." },
      now: new Date("2026-06-01T12:00:00Z"),
    });
    const movedText = await readFile(moved, "utf8");
    assert.match(movedText, /^status: ready_for_test$/m);
    const overrideLines = [...movedText.matchAll(/Transition override: .*$/gm)];
    assert.equal(overrideLines.length, 1);
    assert.match(
      overrideLines[0][0],
      /^Transition override: ready_for_implementation -> ready_for_test: Emergency hotfix, review waived by lead\.$/,
    );

    const noReason = await createTicket(root, "task", "Override without reason", { status: "ready_for_implementation" });
    const noReasonId = path.basename(noReason).split("_", 1)[0];
    const movedNoReason = await moveTicket(root, noReasonId, "ready_for_test", {
      overrideTransition: {},
      now: new Date("2026-06-01T12:00:00Z"),
    });
    const movedNoReasonText = await readFile(movedNoReason, "utf8");
    const noReasonLines = [...movedNoReasonText.matchAll(/Transition override: .*$/gm)];
    assert.equal(noReasonLines.length, 1);
    assert.equal(noReasonLines[0][0], "Transition override: ready_for_implementation -> ready_for_test");

    // Overriding an already-allowed move is a silent no-op: no misleading
    // Run Log line, because isTransitionAllowed never reaches the override
    // branch for an allowed move.
    const alreadyAllowed = await createTicket(root, "task", "Already allowed", { status: "ready_for_review" });
    const alreadyAllowedId = path.basename(alreadyAllowed).split("_", 1)[0];
    const movedAllowed = await moveTicket(root, alreadyAllowedId, "ready_for_test", {
      overrideTransition: { reason: "Should not be recorded." },
    });
    const movedAllowedText = await readFile(movedAllowed, "utf8");
    assert.doesNotMatch(movedAllowedText, /Transition override:/);
  });
});

test("moveTicket ordering: an allowed/overridden loop-back still runs invalidation; a refused loop-back strips nothing", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({ routing: { enforceTransitions: true, invalidateOnLoopBack: true } }));

    // ready_for_test -> ready_for_implementation is map-governed (allowed),
    // so invalidation still runs on this ordinary loop-back.
    const ticketPath = await createTicket(root, "task", "Allowed loop-back", { status: "ready_for_test" });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    await completeStep(root, ticketId, "implement", "claude-subagent:local-board-implementer@sonnet", "Impl.");
    await completeStep(root, ticketId, "review", "codex-task:read-only", "Review.");
    await moveTicket(root, ticketId, "ready_for_implementation");
    const { ticket: after } = await findTicket(root, ticketId);
    assert.deepEqual(after.frontMatter.completedSteps, []);
    assert.match(after.body, /Invalidated downstream evidence on loop-back to ready_for_implementation/);

    // A move refused by the transition validator must run no other logic:
    // no invalidation, no evidence stripped.
    const refusedPath = await createTicket(root, "task", "Refused loop-back", { status: "ready_for_docs" });
    const refusedId = path.basename(refusedPath).split("_", 1)[0];
    await completeStep(root, refusedId, "implement", "claude-subagent:local-board-implementer@sonnet", "Impl.");
    await completeStep(root, refusedId, "review", "codex-task:read-only", "Review.");
    await completeStep(root, refusedId, "test", "claude-subagent:local-board-tester@sonnet", "Test.");
    // ready_for_docs -> ready_for_test is neither a map entry (ready_for_docs
    // only exits to done/ready_for_implementation/ready_for_design/questions/
    // blocked) nor structural, so it is refused.
    await assert.rejects(moveTicket(root, refusedId, "ready_for_test"), /move refused/);
    const { ticket: refusedAfter } = await findTicket(root, refusedId);
    assert.deepEqual(refusedAfter.frontMatter.completedSteps, [
      "implement:claude-subagent:local-board-implementer@sonnet",
      "review:codex-task:read-only",
      "test:claude-subagent:local-board-tester@sonnet",
    ]);
    assert.doesNotMatch(refusedAfter.body, /Invalidated downstream evidence/);
  });
});

test("set <id> status inherits transition refusal and honors --override parity with move", async () => {
  await withBoard(async (root) => {
    await writeConfig(root, JSON.stringify({ routing: { enforceTransitions: true } }));
    const ticketPath = await createTicket(root, "task", "Set status parity", { status: "ready_for_implementation" });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await assert.rejects(setTicketField(root, ticketId, "status", "ready_for_test"), /move refused/);

    await setTicketField(root, ticketId, "status", "ready_for_test", {
      overrideTransition: { reason: "Parity override via set." },
    });
    assert.match(await readFile(ticketPath, "utf8"), /^status: ready_for_test$/m);
    assert.match(await readFile(ticketPath, "utf8"), /Transition override: ready_for_implementation -> ready_for_test: Parity override via set\./);
  });
});

test("moveTicket enforceTransitions is off by default and via explicit false (advisory mode, back-compat)", async () => {
  await withBoard(async (root) => {
    // No config file at all: DEFAULT_CONFIG fallback keeps it off.
    const noConfig = await createTicket(root, "task", "No config advisory", { status: "ready_for_implementation" });
    const noConfigId = path.basename(noConfig).split("_", 1)[0];
    const movedNoConfig = await moveTicket(root, noConfigId, "ready_for_test");
    assert.match(await readFile(movedNoConfig, "utf8"), /^status: ready_for_test$/m);

    // Explicit false behaves the same.
    await writeConfig(root, JSON.stringify({ routing: { enforceTransitions: false } }));
    const explicitOff = await createTicket(root, "task", "Explicit advisory", { status: "ready_for_implementation" });
    const explicitOffId = path.basename(explicitOff).split("_", 1)[0];
    const movedExplicitOff = await moveTicket(root, explicitOffId, "ready_for_test");
    assert.match(await readFile(movedExplicitOff, "utf8"), /^status: ready_for_test$/m);
  });
});

test("moveTicket enforceTransitions on (scaffold config) permits the full task/bug happy-path pipeline and every structural move used by start-work/gate-check flows", async () => {
  await withBoard(async (root) => {
    await mkdir(path.join(root, "plans"), { recursive: true });
    await writeFile(path.join(root, "plans", "local-board.config.jsonc"), defaultConfigJsonc(), "utf8");

    const ticketPath = await createTicket(root, "task", "Full pipeline under scaffold", { status: "ready_for_design" });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];
    // The scaffold also enables estimation; complete-step design refuses a
    // task/bug with a null estimate, unrelated to this ticket's concern.
    await setTicketField(root, ticketId, "estimate", "4");

    await moveTicket(root, ticketId, "designing");
    await moveTicket(root, ticketId, "ready_for_design");
    await recordGateSkippedEmptyCatalog(root, ticketId, "design");
    await moveTicket(root, ticketId, "ready_for_implementation");
    await moveTicket(root, ticketId, "implementing");
    await moveTicket(root, ticketId, "ready_for_implementation");
    await recordGateSkippedEmptyCatalog(root, ticketId, "implement");
    await moveTicket(root, ticketId, "ready_for_review");
    await moveTicket(root, ticketId, "ready_for_test");
    await recordGateSkippedEmptyCatalog(root, ticketId, "test");
    await moveTicket(root, ticketId, "ready_for_docs");

    await completeStep(root, ticketId, "design", "claude-subagent:local-board-designer@opus", "Design evidence.");
    await completeStep(root, ticketId, "implement", "claude-subagent:local-board-implementer@sonnet", "Implementation evidence.");
    await completeStep(root, ticketId, "review", "codex-task:read-only", "Review evidence.");
    await completeStep(root, ticketId, "test", "claude-subagent:local-board-tester@sonnet", "Test evidence.");
    await completeStep(root, ticketId, "document", "codex-task:workspace-write", "Documentation evidence.");

    const done = await moveTicket(root, ticketId, "done");
    assert.match(await readFile(done, "utf8"), /^status: done$/m);
  });
});

// Probabilistic backstop (B20260707T1322Z): two real, separately-spawned
// `local-board` CLI processes racing `comment` on the same ticket. This is
// a secondary smoke test, not the primary guarantee -- the deterministic
// __afterRead-seam tests above are what actually prove the lock; this only
// adds confidence the lock also holds under real process-level scheduling.
// Gated behind an explicit env flag since spawning ~40 CLI processes is slow
// and any residual flakiness belongs in an opt-in slow-test lane, not the
// default `npm test` run.
test(
  "smoke (slow): two racing local-board CLI processes appending comments to the same ticket never lose an entry",
  { skip: !RUN_SLOW_TESTS },
  async () => {
    await withBoard(async (root) => {
      const ticketPath = await createTicket(root, "task", "Racing CLI processes", {
        status: "ready_for_implementation",
        now: new Date("2026-05-14T20:56:00Z"),
      });
      const ticketId = path.basename(ticketPath).split("_", 1)[0];

      const iterations = 20;
      async function commentLoop(label) {
        for (let i = 0; i < iterations; i += 1) {
          await execFileAsync(process.execPath, [CLI_PATH, "--root", root, "comment", ticketId, `${label}-${i}`], {
            encoding: "utf8",
          });
        }
      }

      await Promise.all([commentLoop("proc-a"), commentLoop("proc-b")]);

      const text = await readFile(ticketPath, "utf8");
      for (let i = 0; i < iterations; i += 1) {
        assert.match(text, new RegExp(`proc-a-${i}\\b`), `proc-a-${i} must not be lost`);
        assert.match(text, new RegExp(`proc-b-${i}\\b`), `proc-b-${i} must not be lost`);
      }
    });
  },
);

// --- front-matter list round-trip guard (formatListItem) ---

function roundTripList(list) {
  const serialized = serializeFrontMatter({ completedSteps: list });
  const lines = serialized.split(/\r?\n/).filter((line) => line !== "");
  return parseFrontMatter(lines).completedSteps;
}

// Deterministic LCG so the property test is reproducible without pulling in a
// fuzz library.
function makeLcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const LEGAL_LIST_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:-@./_+";

function randomLegalItem(rand) {
  const length = 1 + Math.floor(rand() * 8);
  let item = "";
  for (let i = 0; i < length; i += 1) {
    item += LEGAL_LIST_CHARSET[Math.floor(rand() * LEGAL_LIST_CHARSET.length)];
  }
  return item;
}

test("front-matter list serialization round-trips over the legal charset (seeded property test, ~1000 cases)", () => {
  const rand = makeLcg(0xc0ffee);
  for (let trial = 0; trial < 1000; trial += 1) {
    const count = Math.floor(rand() * 5); // 0-4 items
    const list = Array.from({ length: count }, () => randomLegalItem(rand));
    assert.deepEqual(roundTripList(list), list, `trial ${trial} failed for list ${JSON.stringify(list)}`);
  }
});

test("formatListItem rejects list items that cannot round-trip (comma, double quote, backslash)", () => {
  assert.throws(
    () => serializeFrontMatter({ children: ["a, b"] }),
    /front-matter list item cannot be serialized.*"a, b"/,
  );
  assert.throws(
    () => serializeFrontMatter({ children: ['a"b'] }),
    /front-matter list item cannot be serialized.*"a\\"b"/,
  );
  assert.throws(
    () => serializeFrontMatter({ children: ["a\\b"] }),
    /front-matter list item cannot be serialized.*"a\\\\b"/,
  );
});

test("formatListItem regression: quoted @-tokens (real completedSteps/gate/codex-task values) serialize byte-identically and round-trip", () => {
  const tokens = [
    "design:claude-subagent:local-board-designer@opus",
    "gate:design:skipped-empty-catalog",
    "implement:codex-task:read-only@codex-default",
  ];

  const serialized = serializeFrontMatter({ completedSteps: tokens });
  assert.equal(
    serialized,
    'completedSteps: ["design:claude-subagent:local-board-designer@opus", gate:design:skipped-empty-catalog, ' +
      '"implement:codex-task:read-only@codex-default"]\n',
  );

  const lines = serialized.split(/\r?\n/).filter((line) => line !== "");
  assert.deepEqual(parseFrontMatter(lines).completedSteps, tokens);
});

test("front-matter list boundary cases: empty, single, and multi-item lists format and round-trip", () => {
  assert.equal(serializeFrontMatter({ children: [] }), "children: []\n");
  assert.deepEqual(roundTripList([]), []);

  assert.equal(serializeFrontMatter({ children: ["E20260707T0000Z"] }), "children: [E20260707T0000Z]\n");
  assert.deepEqual(roundTripList(["E20260707T0000Z"]), ["E20260707T0000Z"]);

  const many = ["E20260707T0000Z", "T20260707T0001Z", "design:claude-subagent:local-board-designer@opus"];
  assert.equal(
    serializeFrontMatter({ children: many }),
    'children: [E20260707T0000Z, T20260707T0001Z, "design:claude-subagent:local-board-designer@opus"]\n',
  );
  assert.deepEqual(roundTripList(many), many);
});

async function replaceText(filePath, search, replacement) {
  const text = await readFile(filePath, "utf8");
  await writeFile(filePath, text.replace(search, replacement), "utf8");
}
