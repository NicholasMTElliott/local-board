import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  appendTicketComment,
  approveInline,
  archiveDoneTickets,
  beginStep,
  blockTicket,
  completeStep,
  createTicket,
  discover,
  linkParent,
  moveTicket,
  nextTicket,
  queryNext,
  queryTicket,
  setTicketField,
  setTicketSection,
  stateReport,
  unblockTicket,
  validate,
} from "../src/tickets.js";
import { initProject } from "../src/scaffold.js";
import { loadConfig } from "../src/config.js";

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

test("strict routing blocks done until required steps have completion evidence", async () => {
  await withBoard(async (root) => {
    const ticketPath = await createTicket(root, "task", "Strict done", {
      status: "ready_for_docs",
      now: new Date("2026-05-14T20:56:00Z"),
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await assert.rejects(moveTicket(root, ticketId, "done"), /missing completedSteps entry for design/);

    await completeStep(root, ticketId, "design", "claude-subagent:local-board-designer", "Design evidence.");
    await completeStep(root, ticketId, "implement", "claude-subagent:local-board-implementer", "Implementation evidence.");
    await completeStep(root, ticketId, "review", "codex-task:read-only", "Review evidence.");
    await completeStep(root, ticketId, "test", "claude-subagent:local-board-tester", "Test evidence.");
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

    await completeStep(root, ticketId, "design", "claude-subagent:local-board-designer", "Design evidence.");
    await completeStep(root, ticketId, "implement", "claude-subagent:local-board-implementer", "Implementation evidence.");
    await completeStep(root, ticketId, "review", "codex-task:read-only", "Review evidence.");
    await completeStep(root, ticketId, "test", "claude-subagent:local-board-tester", "Test evidence.");
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

    await completeStep(root, ticketId, "design", "claude-subagent:local-board-designer", "Design evidence.");
    await completeStep(root, ticketId, "implement", "claude-subagent:local-board-implementer", "Implementation evidence.");
    await completeStep(root, ticketId, "review", "codex-task:read-only", "Review evidence.");
    await completeStep(root, ticketId, "test", "claude-subagent:local-board-tester", "Test evidence.");
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

    await completeStep(root, ticketId, "design", "claude-subagent:local-board-designer", "Design evidence.");
    await completeStep(root, ticketId, "implement", "claude-subagent:local-board-implementer", "Implementation evidence.");
    await completeStep(root, ticketId, "review", "codex-task:read-only", "Review evidence.");
    await completeStep(root, ticketId, "test", "claude-subagent:local-board-tester", "Test evidence.");
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

    await completeStep(root, ticketId, "design", "claude-subagent:local-board-designer", "Design evidence.");
    await completeStep(root, ticketId, "implement", "claude-subagent:local-board-implementer", "Implementation evidence.");
    await completeStep(root, ticketId, "review", "codex-task:read-only", "Review evidence.");
    await completeStep(root, ticketId, "test", "claude-subagent:local-board-tester", "Test evidence.");
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
    assert.equal((await loadConfig(root)).agents.implement, "claude-subagent:local-board-implementer");
    assert.deepEqual(validate(await discover(root)), []);
  });
});

async function replaceText(filePath, search, replacement) {
  const text = await readFile(filePath, "utf8");
  await writeFile(filePath, text.replace(search, replacement), "utf8");
}
