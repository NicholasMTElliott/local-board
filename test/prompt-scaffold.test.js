import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { initProject, packagedResourceDir } from "../src/scaffold.js";
import { loadConfig } from "../src/config.js";
import { createTicket } from "../src/tickets.js";
import { main } from "../src/cli.js";

const REPO_ROOT = path.resolve(".");

async function withBoard(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-board-prompt-scaffold-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

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

async function listFilesRecursive(dir) {
  const results = [];
  async function walk(current, relative) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      const entryRelative = relative ? path.join(relative, entry.name) : entry.name;
      if (entry.isDirectory()) {
        await walk(entryPath, entryRelative);
      } else if (entry.isFile()) {
        results.push(entryRelative);
      }
    }
  }
  await walk(dir, "");
  return results.sort();
}

test("initProject copies the full packaged resources/prompts and resources/templates trees into a fresh board", async () => {
  await withBoard(async (root) => {
    await initProject(root);

    const [sourcePrompts, targetPrompts, sourceTemplates, targetTemplates] = await Promise.all([
      listFilesRecursive(path.join(REPO_ROOT, "resources", "prompts")),
      listFilesRecursive(path.join(root, "plans", "prompts")),
      listFilesRecursive(path.join(REPO_ROOT, "resources", "templates")),
      listFilesRecursive(path.join(root, "plans", "templates")),
    ]);

    assert.deepEqual(targetPrompts, sourcePrompts, "scaffolded plans/prompts must mirror resources/prompts exactly");
    assert.deepEqual(
      targetTemplates,
      sourceTemplates,
      "scaffolded plans/templates must mirror resources/templates exactly",
    );

    for (const relativeFile of sourcePrompts) {
      const stat = statSync(path.join(root, "plans", "prompts", relativeFile));
      assert.ok(stat.size > 0, `${relativeFile} was scaffolded empty`);
    }
  });
});

test("initProject creates every prompt the default config's gate-check and optionalSteps reference", async () => {
  await withBoard(async (root) => {
    await initProject(root);
    const config = await loadConfig(root);

    const gateCheckPath = path.join(root, "plans", "prompts", "steps", "gate-check.md");
    assert.ok(existsSync(gateCheckPath), "gate-check.md must be scaffolded");
    assert.ok(statSync(gateCheckPath).size > 0, "gate-check.md must be non-empty");

    let referencedCount = 0;
    for (const stage of Object.keys(config.optionalSteps)) {
      for (const entry of config.optionalSteps[stage]) {
        const promptPath = path.resolve(root, entry.prompt);
        assert.ok(existsSync(promptPath), `optionalSteps.${stage}.${entry.name} prompt missing at ${promptPath}`);
        assert.ok(statSync(promptPath).size > 0, `optionalSteps.${stage}.${entry.name} prompt is empty`);
        referencedCount += 1;
      }
    }
    assert.ok(referencedCount >= 5, `expected at least 5 default optionalSteps entries, saw ${referencedCount}`);
  });
});

test("initProject prompts/templates are always add-missing-only: second run skips, --overwrite still never clobbers a customized prompt but restores a deleted one", async () => {
  await withBoard(async (root) => {
    const first = await initProject(root);
    assert.ok(
      first.created.some((p) => p.endsWith(path.join("prompts", "steps", "gate-check.md"))),
      "first init must create gate-check.md",
    );

    const gateCheckPath = path.join(root, "plans", "prompts", "steps", "gate-check.md");
    await writeFile(gateCheckPath, "locally modified content\n", "utf8");

    // A second prompt is deleted entirely, simulating a file the user removed
    // (or a board initialized before this prompt existed). --overwrite must
    // restore it even though it must not touch the customized one above.
    const implementerPath = path.join(root, "plans", "prompts", "roles", "implementer.md");
    assert.ok(existsSync(implementerPath), "fixture assumption: implementer.md is part of the packaged prompt tree");
    const implementerOriginalContent = await readFile(implementerPath, "utf8");
    await rm(implementerPath, { force: true });

    const second = await initProject(root);
    assert.equal(
      second.created.some((p) => p.endsWith(path.join("prompts", "steps", "gate-check.md"))),
      false,
      "second init without --overwrite must not recreate an existing prompt file",
    );
    assert.ok(
      second.skipped.some((p) => p.endsWith(path.join("prompts", "steps", "gate-check.md"))),
      "second init without --overwrite must report gate-check.md as skipped",
    );
    assert.equal(
      await readFile(gateCheckPath, "utf8"),
      "locally modified content\n",
      "existing prompt content must be untouched without --overwrite",
    );
    assert.ok(
      second.created.some((p) => p.endsWith(path.join("prompts", "roles", "implementer.md"))),
      "init without --overwrite must still restore a deleted prompt file (add-missing-only)",
    );

    // Re-customize the restored file and re-delete a different one, then run
    // --overwrite: the customized prompt must survive untouched, while the
    // deleted one is restored. Config and .gitignore --overwrite semantics
    // are unrelated to this tree and unchanged by this test.
    await writeFile(implementerPath, "locally modified implementer content\n", "utf8");
    await rm(implementerPath, { force: true }); // deleted again, this time going into --overwrite

    const third = await initProject(root, { overwrite: true });
    assert.equal(
      third.created.some((p) => p.endsWith(path.join("prompts", "steps", "gate-check.md"))),
      false,
      "--overwrite must NOT refresh an existing customized prompt file (user content clobber)",
    );
    assert.equal(
      await readFile(gateCheckPath, "utf8"),
      "locally modified content\n",
      "--overwrite must leave existing prompt content untouched",
    );
    assert.ok(
      third.created.some((p) => p.endsWith(path.join("prompts", "roles", "implementer.md"))),
      "--overwrite must still restore a missing prompt file",
    );
    assert.equal(
      await readFile(implementerPath, "utf8"),
      implementerOriginalContent,
      "a restored prompt file must contain the packaged content",
    );
  });
});

test("gate-check on a board missing the resolved prompt produces an actionable error, not a dead path", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const ticketPath = await createTicket(root, "task", "Gate-check missing prompt target", {
      status: "ready_for_design",
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    // Simulate a board initialized before this fix: the gate-check prompt is missing.
    await rm(path.join(root, "plans", "prompts", "steps", "gate-check.md"), { force: true });

    const result = await runCli(["--root", root, "gate-check", ticketId, "--stage", "design", "--json"]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /gate-check: prompt not found at/);
    assert.match(result.stderr, /local-board init/);
  });
});

test("gate-check does not fail on a missing prompt when the stage catalog is empty (no dispatch would occur)", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const ticketPath = await createTicket(root, "task", "Gate-check empty-catalog target", {
      status: "testing",
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    // Default config's optionalSteps.test is empty; gate-check.md is irrelevant to this
    // stage's outcome, so its absence must not fail the request.
    await rm(path.join(root, "plans", "prompts", "steps", "gate-check.md"), { force: true });

    const result = await runCli(["--root", root, "gate-check", ticketId, "--stage", "test", "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.deepEqual(out.catalog, []);
  });
});

test("specialty-run on a board missing the resolved prompt produces an actionable error, not a dead path", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const ticketPath = await createTicket(root, "task", "Specialty-run missing prompt target", {
      status: "implementing",
    });
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    await rm(path.join(root, "plans", "prompts", "optional-steps", "impl", "security_audit.md"), { force: true });

    const result = await runCli(["--root", root, "specialty-run", ticketId, "security_audit", "--json"]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /specialty-run: prompt not found at/);
    assert.match(result.stderr, /local-board init/);
  });
});

test("packagedResourceDir resolves the dev-clone layout (<root>/resources/<name>)", () => {
  const resolved = packagedResourceDir("prompts", REPO_ROOT);
  assert.equal(resolved, path.join(REPO_ROOT, "resources", "prompts"));
  assert.ok(existsSync(resolved));
});

test("packagedResourceDir resolves the flattened ~/.local-board runtime layout (<root>/<name>)", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "local-board-flattened-fixture-"));
  try {
    await mkdir(path.join(fixtureRoot, "prompts", "steps"), { recursive: true });
    await writeFile(path.join(fixtureRoot, "prompts", "steps", "gate-check.md"), "# Gate Check\n", "utf8");

    const resolved = packagedResourceDir("prompts", fixtureRoot);
    assert.equal(resolved, path.join(fixtureRoot, "prompts"));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("packagedResourceDir prefers the dev-clone layout when both layouts are present", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "local-board-both-layouts-fixture-"));
  try {
    await mkdir(path.join(fixtureRoot, "resources", "prompts"), { recursive: true });
    await mkdir(path.join(fixtureRoot, "prompts"), { recursive: true });

    const resolved = packagedResourceDir("prompts", fixtureRoot);
    assert.equal(resolved, path.join(fixtureRoot, "resources", "prompts"));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("packagedResourceDir throws a clear packaging error when neither layout resolves", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "local-board-no-layout-fixture-"));
  try {
    assert.throws(
      () => packagedResourceDir("prompts", fixtureRoot),
      /could not locate packaged "prompts" resources/,
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
