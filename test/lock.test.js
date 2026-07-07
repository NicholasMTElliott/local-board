import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveMainRoot,
  ticketLockPath,
  withFileLock,
  withOrderedTicketLocks,
  withTicketLock,
} from "../src/lock.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRoot(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-board-lock-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("resolveMainRoot falls back to the resolved root in a non-git directory", async () => {
  await withRoot(async (root) => {
    assert.equal(await resolveMainRoot(root), path.resolve(root));
  });
});

test("ticketLockPath resolves under <root>/.local-board/locks/<ticketId>.lock", async () => {
  await withRoot(async (root) => {
    const lockPath = await ticketLockPath(root, "T1");
    assert.equal(lockPath, path.join(path.resolve(root), ".local-board", "locks", "T1.lock"));
  });
});

// --- withFileLock: mutual exclusion, stale-break, contention timeout ---

test("withFileLock serializes two overlapping critical sections on the same lock path", async () => {
  await withRoot(async (root) => {
    const lockPath = path.join(root, ".local-board", "locks", "demo.lock");
    const events = [];

    const callA = withFileLock(lockPath, async () => {
      events.push("A-start");
      await delay(60);
      events.push("A-end");
    });
    const callB = withFileLock(lockPath, async () => {
      events.push("B-start");
      await delay(5);
      events.push("B-end");
    });

    await Promise.all([callA, callB]);

    assert.equal(events.length, 4);
    // Whichever critical section starts first must fully finish before the
    // other's start -- start/end pairs are never interleaved.
    const firstStarter = events[0].split("-")[0];
    const otherStarter = firstStarter === "A" ? "B" : "A";
    assert.deepEqual(events, [`${firstStarter}-start`, `${firstStarter}-end`, `${otherStarter}-start`, `${otherStarter}-end`]);
  });
});

test("withFileLock releases the lock even when fn throws", async () => {
  await withRoot(async (root) => {
    const lockPath = path.join(root, ".local-board", "locks", "demo.lock");

    await assert.rejects(
      withFileLock(lockPath, async () => {
        throw new Error("boom");
      }),
      /boom/,
    );

    // The lock must be released; a fresh acquire should succeed immediately.
    let ran = false;
    await withFileLock(lockPath, async () => {
      ran = true;
    });
    assert.equal(ran, true);
  });
});

test("withFileLock breaks a stale lock (age > staleMs) and proceeds", async () => {
  await withRoot(async (root) => {
    const lockPath = path.join(root, ".local-board", "locks", "demo.lock");
    await mkdir(lockPath, { recursive: true });
    await writeFile(
      path.join(lockPath, "meta"),
      JSON.stringify({ pid: 424242, ts: new Date(Date.now() - 60_000).toISOString(), hostname: "stale-host" }),
      "utf8",
    );

    let staleBreakInfo = null;
    let ran = false;
    await withFileLock(
      lockPath,
      async () => {
        ran = true;
      },
      { staleMs: 100, retryBudgetMs: 50, onStaleBreak: (info) => { staleBreakInfo = info; } },
    );

    assert.equal(ran, true);
    assert.ok(staleBreakInfo !== null, "onStaleBreak must fire when breaking a stale lock");
    assert.equal(staleBreakInfo.meta.pid, 424242);
  });
});

test("withFileLock throws a clear, path-carrying error when a live (non-stale) lock cannot be acquired", async () => {
  await withRoot(async (root) => {
    const lockPath = path.join(root, ".local-board", "locks", "demo.lock");
    // Hold the lock across the whole test via a never-resolving critical
    // section's acquire (simulated directly: create the sentinel + fresh meta).
    await mkdir(lockPath, { recursive: true });
    await writeFile(
      path.join(lockPath, "meta"),
      JSON.stringify({ pid: process.pid, ts: new Date().toISOString(), hostname: os.hostname() }),
      "utf8",
    );

    await assert.rejects(
      withFileLock(lockPath, async () => {}, { staleMs: 60_000, retryBudgetMs: 40 }),
      (error) => {
        assert.match(error.message, new RegExp(lockPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.match(error.message, /held by/);
        return true;
      },
    );
  });
});

// --- withTicketLock / withOrderedTicketLocks ---

test("withTicketLock serializes concurrent callers for the same ticket id", async () => {
  await withRoot(async (root) => {
    const events = [];
    await Promise.all([
      withTicketLock(root, "T1", async () => {
        events.push("first-start");
        await delay(40);
        events.push("first-end");
      }),
      withTicketLock(root, "T1", async () => {
        events.push("second-start");
        await delay(5);
        events.push("second-end");
      }),
    ]);

    assert.equal(events.length, 4);
    const winner = events[0].split("-")[0];
    const loser = winner === "first" ? "second" : "first";
    assert.deepEqual(events, [`${winner}-start`, `${winner}-end`, `${loser}-start`, `${loser}-end`]);
  });
});

test("withOrderedTicketLocks: reversed argument order across concurrent callers never deadlocks and still serializes", async () => {
  await withRoot(async (root) => {
    const events = [];

    // Two callers contend on the same {A, B} pair but pass the ids in
    // opposite order. Sorted-order acquisition means both actually try to
    // take lock "A" first, so they serialize instead of each holding one of
    // the two locks and waiting on the other (the deadlock shape sorted
    // acquisition rules out).
    const callOne = withOrderedTicketLocks(root, "A", "B", async () => {
      events.push("one-start");
      await delay(40);
      events.push("one-end");
    });
    const callTwo = withOrderedTicketLocks(root, "B", "A", async () => {
      events.push("two-start");
      await delay(5);
      events.push("two-end");
    });

    await Promise.all([callOne, callTwo]);

    assert.equal(events.length, 4);
    const winner = events[0].split("-")[0];
    const loser = winner === "one" ? "two" : "one";
    assert.deepEqual(events, [`${winner}-start`, `${winner}-end`, `${loser}-start`, `${loser}-end`]);
  });
});

test("withOrderedTicketLocks: self-pair (same id twice) does not deadlock", async () => {
  await withRoot(async (root) => {
    let ran = false;
    await withOrderedTicketLocks(root, "A", "A", async () => {
      ran = true;
    });
    assert.equal(ran, true);
  });
});

test("withTicketLock releases the sentinel directory after the critical section completes", async () => {
  await withRoot(async (root) => {
    const lockPath = await ticketLockPath(root, "T1");
    await withTicketLock(root, "T1", async () => {});

    await assert.rejects(
      readFile(path.join(lockPath, "meta"), "utf8"),
      (error) => error.code === "ENOENT",
    );
  });
});
