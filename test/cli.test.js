import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

import { commandWhere, main } from "../src/cli.js";
import { loadConfig } from "../src/config.js";
import { createTicket, discover, queryNext } from "../src/tickets.js";
import { ledgerPath, readActiveSteps, stampActiveStep } from "../src/active-steps.js";
import { removeFixtureDir } from "./helpers/fixtures.js";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI_BIN = path.join(REPO_ROOT, "bin", "local-board.js");

// A minimal PATH for the child process, containing only the current Node
// executable's directory plus the OS-minimum directories needed for
// `where`/`command -v` and `node` itself to resolve. Deliberately excludes
// any ambient PATH entries (notably a real `codex` install), so the
// codex-task-detection integration tests below are hermetic -- they pass
// identically whether or not `codex` is installed on the machine running
// the suite. Mirrors test/install.test.js's sanitizedSystemPath.
function sanitizedSystemPathForCodexDetect() {
  const nodeDir = path.dirname(process.execPath);
  if (process.platform === "win32") {
    const windir = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
    return [
      nodeDir,
      windir,
      path.join(windir, "System32"),
      path.join(windir, "System32", "Wbem"),
      path.join(windir, "System32", "WindowsPowerShell", "v1.0"),
    ].join(path.delimiter);
  }
  return [nodeDir, "/usr/bin", "/bin"].join(path.delimiter);
}

// Child-process CLI runner for tests that need real env isolation
// (HOME/USERPROFILE and a sanitized PATH), which the in-process `runCli`
// helper below cannot provide since it shares the test process's env/PATH
// and os.homedir(). Used only by the codex-task detection integration
// tests, which must control both the skill-dir home lookup and the `codex`
// PATH probe hermetically.
async function runCliChild(args, { home } = {}) {
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  if (home !== undefined) {
    env.HOME = home;
    env.USERPROFILE = home;
    env.HOMEDRIVE = path.parse(home).root.replace(/[\\/]+$/, "");
    env.HOMEPATH = home.slice(path.parse(home).root.length);
  }
  env[pathKey] = sanitizedSystemPathForCodexDetect();
  try {
    const result = await execFileAsync(process.execPath, [CLI_BIN, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: typeof error.code === "number" ? error.code : 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

async function withBoard(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-board-cli-"));
  try {
    await fn(root);
  } finally {
    await removeFixtureDir(root);
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
    // enforceTransitions is scaffold-on by default; ready_for_decomposition ->
    // ready_for_design is not a pipeline map entry or a structural allow-set
    // move (decomposition and design are separate decision points), so this
    // smoke-test move needs an explicit override.
    assert.equal(
      (
        await runCli([
          "--root", root, "move", childId, "ready_for_design",
          "--override", "--reason", "CLI smoke test moves directly into design",
        ])
      ).code,
      0,
    );
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

test("validate: config routing review to codex-task warns on stderr when codex is undetected, exit code unchanged", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    // DEFAULT_CONFIG/the init scaffold already route review -> codex-task:read-only;
    // no config override needed. No tickets required either -- the warning is
    // emitted from config alone, independent of ticket validity.
    const home = await mkdtemp(path.join(os.tmpdir(), "local-board-cli-codex-home-"));
    try {
      const result = await runCliChild(["--root", root, "validate"], { home });
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stderr, /WARNING:.*codex-task/);
      assert.match(result.stderr, /review/);
    } finally {
      await removeFixtureDir(home);
    }
  });
});

test("validate: config with zero codex-task routes prints no codex-task warning", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const configPath = path.join(root, "plans", "local-board.config.jsonc");
    await writeFile(
      configPath,
      JSON.stringify({ agents: { review: "inline", document: "inline" } }),
      "utf8",
    );

    const home = await mkdtemp(path.join(os.tmpdir(), "local-board-cli-codex-home-"));
    try {
      const result = await runCliChild(["--root", root, "validate"], { home });
      assert.equal(result.code, 0, result.stderr);
      assert.doesNotMatch(result.stderr, /codex-task/);
    } finally {
      await removeFixtureDir(home);
    }
  });
});

test("validate: a genuine ticket error and a codex-task route both surface -- exit 1, warning still present", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const createResult = await runCli(["--root", root, "create", "task", "Broken Ticket"]);
    assert.equal(createResult.code, 0);
    const ticketPath = createResult.stdout.trim();
    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /^blockedBy: \[\]$/m);
    await writeFile(ticketPath, text.replace(/^blockedBy: \[\]$/m, 'blockedBy: ["T20200101T0000Z"]'), "utf8");

    const home = await mkdtemp(path.join(os.tmpdir(), "local-board-cli-codex-home-"));
    try {
      const result = await runCliChild(["--root", root, "validate"], { home });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /blockedBy T20200101T0000Z does not exist/);
      assert.match(result.stderr, /WARNING:.*codex-task/);
    } finally {
      await removeFixtureDir(home);
    }
  });
});

// console.warn is not one of the streams the in-process runCli helper
// (below) patches, so the create-advisory tests use the child-process
// runCliChild harness (same reason the codex-task-warning tests above do).
test("create: a story created at a mismatched status (ready_for_design) prints the type-vs-status advisory on stderr, naming the conventional entry status; stdout still holds exactly the created path", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const result = await runCliChild([
      "--root",
      root,
      "create",
      "story",
      "Story created too early",
      "--status",
      "ready_for_design",
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /^WARNING: story created at ready_for_design/m);
    assert.match(result.stderr, /ready_for_decomposition/);
    assert.match(result.stderr, /"decompose"/);
    assert.match(result.stderr, /move <id> ready_for_decomposition --override --reason/);

    const ticketPath = result.stdout.trim();
    assert.match(ticketPath, /S\d{8}T\d{4}Z_story-created-too-early\.md$/);
    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /^status: ready_for_design$/m);
  });
});

test("create: a task created at ready_for_design (its own conventional entry status) stays silent -- no advisory on stderr, stdout unaffected", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const result = await runCliChild([
      "--root",
      root,
      "create",
      "task",
      "Task created at its normal status",
      "--status",
      "ready_for_design",
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /WARNING/);

    const ticketPath = result.stdout.trim();
    assert.match(ticketPath, /T\d{8}T\d{4}Z_task-created-at-its-normal-status\.md$/);
    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /^status: ready_for_design$/m);
  });
});

test("--version and version subcommand each print the package.json version and exit 0", async () => {
  const packageJson = JSON.parse(
    await readFile(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
  );

  const flagResult = await runCli(["--version"]);
  assert.equal(flagResult.code, 0);
  assert.equal(flagResult.stdout.trim(), packageJson.version);

  const subcommandResult = await runCli(["version"]);
  assert.equal(subcommandResult.code, 0);
  assert.equal(subcommandResult.stdout.trim(), packageJson.version);
});

test("where --json self-locates version, promptsDir, templatesDir, and agentsDir in the dev-clone layout", async () => {
  const result = await runCli(["where", "--json"]);
  assert.equal(result.code, 0);

  const packageJson = JSON.parse(
    await readFile(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
  );
  const info = JSON.parse(result.stdout);

  assert.equal(info.version, packageJson.version);
  assert.match(info.promptsDir.replace(/\\/g, "/"), /resources\/prompts$/);
  assert.match(info.templatesDir.replace(/\\/g, "/"), /resources\/templates$/);
  assert.match(info.agentsDir.replace(/\\/g, "/"), /agents\/codex$/);
  assert.ok(statSync(info.packageRoot).isDirectory());
  assert.ok(statSync(info.promptsDir).isDirectory());
  assert.ok(statSync(info.templatesDir).isDirectory());
  assert.ok(statSync(info.agentsDir).isDirectory());
  assert.ok(statSync(path.join(info.promptsDir, "steps", "gate-check.md")).isFile());
  assert.ok(statSync(path.join(info.agentsDir, "local-board-designer.md")).isFile());
});

test("where (non-JSON) prints the same labelled fields", async () => {
  const result = await runCli(["where"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^version: /m);
  assert.match(result.stdout, /^packageRoot: /m);
  assert.match(result.stdout, /^promptsDir: /m);
  assert.match(result.stdout, /^templatesDir: /m);
  assert.match(result.stdout, /^agentsDir: /m);
});

test("where --json resolves the flattened ~/.local-board runtime layout via a packageRoot override", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "local-board-where-flattened-"));
  try {
    await writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({ version: "9.9.9" }), "utf8");
    await mkdir(path.join(fixtureRoot, "prompts", "steps"), { recursive: true });
    await writeFile(path.join(fixtureRoot, "prompts", "steps", "gate-check.md"), "# Gate Check\n", "utf8");
    await mkdir(path.join(fixtureRoot, "templates"), { recursive: true });
    await mkdir(path.join(fixtureRoot, "agents", "codex"), { recursive: true });
    await writeFile(path.join(fixtureRoot, "agents", "codex", "local-board-designer.md"), "# Designer\n", "utf8");

    const stdout = [];
    const originalLog = console.log;
    console.log = (message = "") => stdout.push(String(message));
    let code;
    try {
      code = await commandWhere(".", ["--json"], fixtureRoot);
    } finally {
      console.log = originalLog;
    }

    assert.equal(code, 0);
    const info = JSON.parse(stdout.join("\n"));
    assert.equal(info.version, "9.9.9");
    assert.equal(info.packageRoot, fixtureRoot);
    assert.equal(info.promptsDir, path.join(fixtureRoot, "prompts"));
    assert.equal(info.templatesDir, path.join(fixtureRoot, "templates"));
    assert.equal(info.agentsDir, path.join(fixtureRoot, "agents", "codex"));
  } finally {
    await removeFixtureDir(fixtureRoot);
  }
});

test("begin-step --harness codex adds an additive codexDispatch block; base fields and the ledger stamp are unchanged", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    const create = await runCli([
      "--root", root, "create", "task", "Harness codex task",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const baseline = await runCli(["--root", root, "begin-step", ticketId, "--json"]);
    assert.equal(baseline.code, 0);
    const baselineResult = JSON.parse(baseline.stdout);
    assert.equal(baselineResult.configuredAgent, "claude-subagent:local-board-designer");
    assert.equal("codexDispatch" in baselineResult, false);

    const codexResult = await runCli(["--root", root, "begin-step", ticketId, "--harness", "codex", "--json"]);
    assert.equal(codexResult.code, 0);
    const parsed = JSON.parse(codexResult.stdout);
    for (const key of Object.keys(baselineResult)) {
      assert.deepEqual(parsed[key], baselineResult[key], `base field ${key} must be unchanged by --harness codex`);
    }
    assert.equal(parsed.codexDispatch.known, true);
    assert.equal(parsed.codexDispatch.dispatchKind, "spawn_agent");
    assert.equal(parsed.codexDispatch.agentType, "worker");
    assert.match(parsed.codexDispatch.promptPath.replace(/\\/g, "/"), /agents\/codex\/local-board-designer\.md$/);
    assert.equal(parsed.codexDispatch.evidenceExecutor, "claude-subagent:local-board-designer@codex-default");

    // The active-steps ledger stamp records the CONFIGURED logical route and
    // model regardless of --harness; the translation is presentation only.
    const steps = await readActiveSteps(root);
    const stamped = steps[ticketId];
    assert.equal(stamped.route, "claude-subagent:local-board-designer");
    assert.equal(stamped.model, baselineResult.configuredModel);

    const bogusHarness = await runCli(["--root", root, "begin-step", ticketId, "--harness", "bogus", "--json"]);
    assert.equal(bogusHarness.code, 2);
    assert.match(bogusHarness.stderr, /--harness/);
  });
});

test("begin-step surfaces configuredEffort (null when unset, pinned value when set) and threads it into codexDispatch.effort without touching the ledger stamp or evidence", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const create = await runCli([
      "--root", root, "create", "task", "Effort-pinned task",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    // Baseline (default config): no effort key configured for "design".
    const baseline = await runCli(["--root", root, "begin-step", ticketId, "--json"]);
    assert.equal(baseline.code, 0);
    const baselineResult = JSON.parse(baseline.stdout);
    assert.equal(baselineResult.configuredEffort, null);
    assert.equal(baselineResult.configuredAgent, "claude-subagent:local-board-designer");
    assert.equal(baselineResult.configuredModel, "opus");

    const codexBaseline = await runCli(["--root", root, "begin-step", ticketId, "--harness", "codex", "--json"]);
    assert.equal(codexBaseline.code, 0);
    assert.equal(JSON.parse(codexBaseline.stdout).codexDispatch.effort, null);

    // Pin an effort for "design" and re-run against a fresh ticket.
    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      JSON.stringify({
        agents: {
          design: { route: "claude-subagent:local-board-designer", model: "opus", effort: "xhigh" },
        },
      }),
      "utf8",
    );

    const create2 = await runCli([
      "--root", root, "create", "task", "Effort-pinned task 2",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create2.code, 0);
    const ticketId2 = path.basename(create2.stdout.trim()).split("_", 1)[0];

    const pinned = await runCli(["--root", root, "begin-step", ticketId2, "--json"]);
    assert.equal(pinned.code, 0);
    const pinnedResult = JSON.parse(pinned.stdout);
    assert.equal(pinnedResult.configuredEffort, "xhigh");
    assert.equal(pinnedResult.configuredAgent, "claude-subagent:local-board-designer");
    assert.equal(pinnedResult.configuredModel, "opus");

    const codexPinned = await runCli(["--root", root, "begin-step", ticketId2, "--harness", "codex", "--json"]);
    assert.equal(codexPinned.code, 0);
    const codexPinnedResult = JSON.parse(codexPinned.stdout);
    assert.equal(codexPinnedResult.codexDispatch.effort, "xhigh");
    assert.equal(codexPinnedResult.configuredEffort, "xhigh");

    // The active-step ledger stamp has no effort field.
    const steps = await readActiveSteps(root);
    const stamped = steps[ticketId2];
    assert.equal(Object.hasOwn(stamped, "effort"), false);
    // "kind" (B20260710T1225Z) discriminates action vs. gate/specialty
    // ledger entries for the conditional clears; begin-step's action stamp
    // carries kind: "action".
    assert.deepEqual(Object.keys(stamped).sort(), ["action", "kind", "model", "root", "route", "ticket", "ts"]);

    // Evidence is unchanged: complete-step composes <route>@<model>, no effort.
    assert.equal((await runCli(["--root", root, "estimate", ticketId2, "2"])).code, 0);
    const complete = await runCli([
      "--root", root, "complete-step", ticketId2, "design",
      "--executor", "claude-subagent:local-board-designer", "--model", "opus",
      "--evidence", "Design evidence.",
    ]);
    assert.equal(complete.code, 0, complete.stderr);
    const board = await discover(root);
    const ticket = board.tickets.find((t) => t.id === ticketId2);
    assert.deepEqual(ticket.frontMatter.completedSteps, ["design:claude-subagent:local-board-designer@opus"]);
  });
});

test("begin-step (T20260710T1532Z, D6): configuredFallbackModels and codexDispatch.fallbackModels are present only when the resolved profile carries a non-empty fallbackModels list; absent (byte-identical, exact deep-equal) otherwise", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const create = await runCli([
      "--root", root, "create", "task", "No fallback configured",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketPath = create.stdout.trim();
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    // Full expected begin-step result: transitions is sourced from the
    // scaffolded config (not re-typed) since it is large boilerplate text
    // unrelated to this ticket's fallbackModels behavior, but every other
    // field is a literal expected VALUE, not just a key -- a regression that
    // swaps/blanks configuredModel, configuredPrompt, strict, etc. now fails
    // here instead of only a key-set check.
    const config = await loadConfig(root);
    const expectedResult = {
      ticket: ticketId,
      action: "design",
      status: "ready_for_design",
      transitions: config.workflow.transitions.ready_for_design,
      configuredAgent: "claude-subagent:local-board-designer",
      configuredModel: "opus",
      configuredEffort: null,
      configuredPrompt: "plans/prompts/steps/design.md",
      strict: true,
      delegationRequired: true,
      branch: null,
      path: path.relative(root, ticketPath),
    };

    const baseline = await runCli(["--root", root, "begin-step", ticketId, "--json"]);
    assert.equal(baseline.code, 0, baseline.stderr);
    assert.deepEqual(JSON.parse(baseline.stdout), expectedResult);

    const codexBaseline = await runCli(["--root", root, "begin-step", ticketId, "--harness", "codex", "--json"]);
    assert.equal(codexBaseline.code, 0, codexBaseline.stderr);
    const agentsDir = path.join(REPO_ROOT, "agents", "codex");
    assert.deepEqual(JSON.parse(codexBaseline.stdout), {
      ...expectedResult,
      codexDispatch: {
        dispatchKind: "spawn_agent",
        agentType: "worker",
        promptPath: path.join(agentsDir, "local-board-designer.md"),
        model: null,
        effort: null,
        evidenceExecutor: "claude-subagent:local-board-designer@codex-default",
        known: true,
      },
    });

    // Pin an ordered fallbackModels list for "design" and re-run against a
    // fresh ticket.
    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      JSON.stringify({
        agents: {
          design: {
            route: "claude-subagent:local-board-designer",
            model: "opus",
            fallbackModels: ["gpt-5.5-fallback", "sonnet"],
          },
        },
      }),
      "utf8",
    );
    const create2 = await runCli([
      "--root", root, "create", "task", "Fallback configured",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create2.code, 0, create2.stderr);
    const ticketId2 = path.basename(create2.stdout.trim()).split("_", 1)[0];

    const pinned = await runCli(["--root", root, "begin-step", ticketId2, "--json"]);
    assert.equal(pinned.code, 0, pinned.stderr);
    assert.deepEqual(JSON.parse(pinned.stdout).configuredFallbackModels, ["gpt-5.5-fallback", "sonnet"]);

    const codexPinned = await runCli(["--root", root, "begin-step", ticketId2, "--harness", "codex", "--json"]);
    assert.equal(codexPinned.code, 0, codexPinned.stderr);
    // "sonnet" is a Claude alias and is sanitized out of the Codex-walkable list.
    assert.deepEqual(JSON.parse(codexPinned.stdout).codexDispatch.fallbackModels, ["gpt-5.5-fallback"]);

    // The active-step ledger stamp carries the raw (unsanitized) list.
    const steps = await readActiveSteps(root);
    assert.deepEqual(steps[ticketId2].fallbackModels, ["gpt-5.5-fallback", "sonnet"]);
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
          "claude-subagent:local-board-decomposer@opus",
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
    // Default catalog entries omit agent field, except security_threat_model
    // which the scaffold pins to gpt-5.6-sol/xhigh.
    for (const entry of designOut.catalog) {
      if (entry.name === "security_threat_model") {
        assert.deepEqual(entry.agent, {
          route: "codex-task:read-only",
          model: "gpt-5.6-sol",
          effort: "xhigh",
        });
      } else {
        assert.equal(Object.hasOwn(entry, "agent"), false, `entry ${entry.name} should omit agent when absent in config`);
      }
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

test("CLI gate-check auto-stamps gate:<stage>:skipped-empty-catalog on the empty-catalog branch and is idempotent", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const create = await runCli([
      "--root", root, "create", "task", "Empty catalog auto-stamp",
      "--status", "testing", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketPath = create.stdout.trim();
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    // optionalSteps.test is empty in the default config: no dispatch, no
    // gate-check.md prompt read, yet the consultation is still recorded.
    const first = await runCli(["--root", root, "gate-check", ticketId, "--stage", "test", "--json"]);
    assert.equal(first.code, 0, first.stderr);
    assert.match(await readFile(ticketPath, "utf8"), /^completedSteps: \[gate:test:skipped-empty-catalog\]$/m);
    const firstOut = JSON.parse(first.stdout);
    assert.equal(firstOut.skip, true);
    assert.equal(firstOut.recorded, "gate:test:skipped-empty-catalog");

    // Idempotent re-run does not duplicate the token or fail, and still
    // reports skip: true with the same recorded token.
    const second = await runCli(["--root", root, "gate-check", ticketId, "--stage", "test", "--json"]);
    assert.equal(second.code, 0, second.stderr);
    assert.match(await readFile(ticketPath, "utf8"), /^completedSteps: \[gate:test:skipped-empty-catalog\]$/m);
    const secondOut = JSON.parse(second.stdout);
    assert.equal(secondOut.skip, true);
    assert.equal(secondOut.recorded, "gate:test:skipped-empty-catalog");

    // Non-JSON mode: the skip line is present on the empty-catalog branch.
    const plain = await runCli(["--root", root, "gate-check", ticketId, "--stage", "test"]);
    assert.equal(plain.code, 0, plain.stderr);
    assert.match(plain.stdout, /^skip: empty catalog — recorded gate:test:skipped-empty-catalog \(no dispatch\)$/m);

    // The empty-catalog branch dispatches no agent, so it must not stamp the
    // active-steps dispatch ledger either (B20260710T1225Z: the consultation
    // stamp is scoped to the non-skip branch only).
    assert.equal(Object.hasOwn(await readActiveSteps(root), ticketId), false);
  });
});

test("CLI gate-check does not record ticket evidence on a non-empty catalog, but does stamp a scoped consultation entry in the active-steps ledger (B20260710T1225Z)", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const create = await runCli([
      "--root", root, "create", "task", "Non-empty catalog no auto-stamp",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketPath = create.stdout.trim();
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const result = await runCli(["--root", root, "gate-check", ticketId, "--stage", "design", "--json"]);
    assert.equal(result.code, 0, result.stderr);
    // Ticket evidence (completedSteps) is untouched on the non-empty branch --
    // the recorded gate token is written later by gate-complete.
    assert.match(await readFile(ticketPath, "utf8"), /^completedSteps: \[\]$/m);
    const out = JSON.parse(result.stdout);
    assert.equal(out.skip, false);
    assert.equal(out.recorded, null);

    // The non-empty branch DOES stamp a scoped consultation entry in the
    // active-steps dispatch ledger (distinct from ticket evidence) so
    // check-dispatch authorizes the upcoming gate agent dispatch.
    const steps = await readActiveSteps(root);
    assert.equal(steps[ticketId].kind, "gate");
    assert.equal(steps[ticketId].action, "gate-check");
    assert.equal(steps[ticketId].stage, "design");
    assert.equal(steps[ticketId].route, "claude-subagent:local-board-gatecheck");
    assert.equal(steps[ticketId].model, "haiku");

    // Non-JSON mode: the skip line is absent on the non-empty-catalog branch.
    const plain = await runCli(["--root", root, "gate-check", ticketId, "--stage", "design"]);
    assert.equal(plain.code, 0, plain.stderr);
    assert.doesNotMatch(plain.stdout, /^skip:/m);
  });
});

test("CLI gate-check (T20260710T1532Z, D6): a fallback-free gate profile is byte-identical to the legacy payload/stamp shape (no effort, no fallbackModels, no codexDispatch)", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const create = await runCli([
      "--root", root, "create", "task", "Gate-check legacy shape",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketPath = create.stdout.trim();
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    // catalog/gateProfile are sourced from the scaffolded config itself
    // (rather than re-typed prose) since the scaffold's optionalSteps.design
    // catalog is large boilerplate unrelated to this ticket's fallback
    // behavior; the catalog transform (name/prompt/triggers/agent only) is
    // still asserted verbatim below, exercising the real regression class
    // (a dropped/renamed/extra field) rather than only a key-set check.
    const config = await loadConfig(root);
    const gateProfile = config.agents["gate-check"];
    const expectedCatalog = (config.optionalSteps?.design ?? []).map((entry) => {
      const normalized = { name: entry.name, prompt: entry.prompt, triggers: entry.triggers };
      if (Object.hasOwn(entry, "agent")) {
        normalized.agent = entry.agent;
      }
      return normalized;
    });

    const result = await runCli(["--root", root, "gate-check", ticketId, "--stage", "design", "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.deepEqual(out, {
      ticket: ticketId,
      stage: "design",
      prompt: path.resolve(root, "plans", "prompts", "steps", "gate-check.md"),
      agent: gateProfile.route,
      model: gateProfile.model ?? null,
      ticketPath,
      ticketContext: {
        id: ticketId,
        type: "task",
        status: "ready_for_design",
        priority: "P2",
        path: path.relative(root, ticketPath),
        title: "Gate-check legacy shape",
        currentAction: "design",
        requirement: "",
        acceptanceCriteria: "",
      },
      catalog: expectedCatalog,
      skip: expectedCatalog.length === 0,
      recorded: expectedCatalog.length === 0 ? "gate:design:skipped-empty-catalog" : null,
    });

    const steps = await readActiveSteps(root);
    const stamp = steps[ticketId];
    assert.deepEqual(stamp, {
      ticket: ticketId,
      kind: "gate",
      action: "gate-check",
      stage: "design",
      route: gateProfile.route,
      model: gateProfile.model ?? null,
      root: path.resolve(root),
      ts: stamp.ts,
    });
    assert.match(stamp.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

test("CLI gate-check (T20260710T1532Z, D5/D6): a fallback-configured claude-subagent gate profile gains effort, fallbackModels, and a codexDispatch sub-block (bundle only, never individually); the stamp carries fallbackModels; effort and the resolved promptPath are preserved", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    // A minimal config overlay: agents["gate-check"] fallback pin, plus a
    // non-empty optionalSteps.design catalog entry (a bare overlay of just
    // "agents" would otherwise merge onto DEFAULT_CONFIG's EMPTY
    // optionalSteps, not the scaffold's populated one -- see loadConfig --
    // producing an empty catalog and skipping the non-empty-catalog stamp
    // branch entirely).
    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      JSON.stringify({
        agents: {
          "gate-check": {
            route: "claude-subagent:local-board-gatecheck",
            model: "haiku",
            effort: "high",
            // Not a Claude alias (opus/sonnet/haiku) and does not start with
            // "claude", so it survives codexDispatch sanitization unchanged --
            // alias-dropping sanitization itself is covered separately in
            // test/codex-dispatch.test.js.
            fallbackModels: ["gpt-5.5-fallback"],
          },
        },
        optionalSteps: {
          design: [
            { name: "custom_review", prompt: "p.md", triggers: "t" },
          ],
        },
      }),
      "utf8",
    );

    const create = await runCli([
      "--root", root, "create", "task", "Gate-check fallback bundle",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const result = await runCli(["--root", root, "gate-check", ticketId, "--stage", "design", "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.equal(out.effort, "high");
    assert.deepEqual(out.fallbackModels, ["gpt-5.5-fallback"]);
    assert.equal(out.codexDispatch.effort, "high");
    // A known claude-subagent role's codexDispatch.promptPath is the Codex
    // executor prompt fragment (translateCodexDispatch's existing
    // claude-subagent branch behavior), not the raw prompt param -- the
    // `prompt: promptPath` forwarding contract (finding 5) specifically
    // targets the codex-task consultation branch (see the codex-task variant
    // test below), where promptPath would otherwise be null.
    assert.match(out.codexDispatch.promptPath.replace(/\\/g, "/"), /local-board-gatecheck\.md$/);
    assert.deepEqual(out.codexDispatch.fallbackModels, ["gpt-5.5-fallback"]);

    const steps = await readActiveSteps(root);
    assert.deepEqual(steps[ticketId].fallbackModels, ["gpt-5.5-fallback"]);
  });
});

test("CLI gate-check (T20260710T1532Z, finding 5): a fallback-configured codex-task gate route's codexDispatch.promptPath equals the resolved prompt path, dispatchable directly; a fallback-free profile emits no codexDispatch block at all", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      JSON.stringify({
        agents: {
          "gate-check": {
            route: "codex-task:read-only",
            model: "gpt-5.6-sol",
            effort: "xhigh",
            fallbackModels: ["gpt-5.5"],
          },
        },
      }),
      "utf8",
    );

    const create = await runCli([
      "--root", root, "create", "task", "Gate-check codex-task fallback",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const result = await runCli(["--root", root, "gate-check", ticketId, "--stage", "design", "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.equal(out.codexDispatch.promptPath, out.prompt);
    assert.deepEqual(out.codexDispatch.fallbackModels, ["gpt-5.5"]);

    // A codex-task route is never hook-gated (only claude-subagent: is), so
    // no ledger stamp is written regardless of fallback configuration.
    const steps = await readActiveSteps(root);
    assert.equal(Object.hasOwn(steps, ticketId), false);
  });
});

test("CLI gate-complete records gate:<stage>:<executor>, appends a Run Log line, and supports route and route@model executor forms", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const create = await runCli([
      "--root", root, "create", "task", "Gate-complete recording",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketPath = create.stdout.trim();
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const jsonResult = await runCli([
      "--root", root, "gate-complete", ticketId,
      "--stage", "design",
      "--executor", "claude-subagent:local-board-gatecheck@haiku",
      "--evidence", "security_threat_model",
      "--json",
    ]);
    assert.equal(jsonResult.code, 0, jsonResult.stderr);
    const out = JSON.parse(jsonResult.stdout);
    assert.equal(out.ticket, ticketId);
    assert.equal(out.stage, "design");
    assert.equal(out.executor, "claude-subagent:local-board-gatecheck@haiku");

    const textAfterFirst = await readFile(ticketPath, "utf8");
    assert.match(textAfterFirst, /^completedSteps: \["gate:design:claude-subagent:local-board-gatecheck@haiku"\]$/m);
    assert.match(textAfterFirst, /Gate consultation design via claude-subagent:local-board-gatecheck@haiku: security_threat_model/);

    // Route-only executor form (no @model suffix), plain output, and a
    // default evidence of "none" when --evidence is omitted.
    const create2 = await runCli([
      "--root", root, "create", "task", "Gate-complete route only",
      "--status", "ready_for_implementation", "--priority", "P2",
    ]);
    assert.equal(create2.code, 0, create2.stderr);
    const ticketPath2 = create2.stdout.trim();
    const ticketId2 = path.basename(ticketPath2).split("_", 1)[0];

    const plainResult = await runCli([
      "--root", root, "gate-complete", ticketId2,
      "--stage", "implement",
      "--executor", "claude-subagent:local-board-gatecheck",
    ]);
    assert.equal(plainResult.code, 0, plainResult.stderr);
    assert.equal(plainResult.stdout.trim(), `${ticketId2} implement claude-subagent:local-board-gatecheck ${ticketPath2}`);
    const textAfterSecond = await readFile(ticketPath2, "utf8");
    assert.match(textAfterSecond, /^completedSteps: \[gate:implement:claude-subagent:local-board-gatecheck\]$/m);
    assert.match(textAfterSecond, /Gate consultation implement via claude-subagent:local-board-gatecheck: none/);
  });
});

test("CLI gate-complete --model composes gate:<stage>:<route>@<model>, mirroring complete-step", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const create = await runCli([
      "--root", root, "create", "task", "Gate-complete two-flag model",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketPath = create.stdout.trim();
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const twoFlag = await runCli([
      "--root", root, "gate-complete", ticketId,
      "--stage", "design",
      "--executor", "claude-subagent:local-board-gatecheck", "--model", "haiku",
      "--evidence", "security_threat_model",
    ]);
    assert.equal(twoFlag.code, 0, twoFlag.stderr);
    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /^completedSteps: \["gate:design:claude-subagent:local-board-gatecheck@haiku"\]$/m);

    // Conflict: disagreeing --model vs the --executor @suffix throws naming both.
    const create2 = await runCli([
      "--root", root, "create", "task", "Gate-complete model conflict",
      "--status", "ready_for_implementation", "--priority", "P2",
    ]);
    assert.equal(create2.code, 0, create2.stderr);
    const ticketId2 = path.basename(create2.stdout.trim()).split("_", 1)[0];

    const conflict = await runCli([
      "--root", root, "gate-complete", ticketId2,
      "--stage", "implement",
      "--executor", "claude-subagent:local-board-gatecheck@haiku", "--model", "opus",
    ]);
    assert.notEqual(conflict.code, 0);
    assert.match(conflict.stderr, /--executor pins @haiku but --model says opus; pass only one or make them agree/);
  });
});

test("CLI gate-complete rejects an invalid stage and missing required arguments", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    const create = await runCli([
      "--root", root, "create", "task", "Gate-complete errors",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const badStage = await runCli([
      "--root", root, "gate-complete", ticketId, "--stage", "docs", "--executor", "claude-subagent:local-board-gatecheck",
    ]);
    assert.equal(badStage.code, 2);
    assert.match(badStage.stderr, /--stage must be one of design, implement, test/);

    const missingExecutor = await runCli(["--root", root, "gate-complete", ticketId, "--stage", "design"]);
    assert.equal(missingExecutor.code, 2);
    assert.match(missingExecutor.stderr, /gate-complete requires/);

    const missingTicket = await runCli(["--root", root, "gate-complete", "--stage", "design", "--executor", "claude-subagent:local-board-gatecheck"]);
    assert.equal(missingTicket.code, 2);
    assert.match(missingTicket.stderr, /gate-complete requires/);
  });
});

test("CLI design-review-check resolves agent/model/effort, prompt path, and narrow ticketContext (--json and plain)", async () => {
  await withBoard(async (root) => {
    // local-board init scaffolds routing.requireDesignReview: true and the
    // default agents["design-review"] profile.
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const create = await runCli([
      "--root", root, "create", "task", "Design-review-check target",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const json = await runCli(["--root", root, "design-review-check", ticketId, "--json"]);
    assert.equal(json.code, 0, json.stderr);
    const out = JSON.parse(json.stdout);
    assert.equal(out.ticket, ticketId);
    assert.equal(out.agent, "codex-task:read-only");
    assert.equal(out.model, "gpt-5.6-sol");
    assert.equal(out.effort, "xhigh");
    assert.equal(out.prompt.endsWith(path.join("plans", "prompts", "steps", "design_review.md")), true);
    assert.deepEqual(Object.keys(out.ticketContext).sort(), [
      "acceptanceCriteria", "currentAction", "id", "path", "priority", "requirement", "status", "title", "type",
    ].sort());
    assert.equal(out.ticketContext.id, ticketId);
    assert.equal(out.ticketContext.status, "ready_for_design");
    assert.equal(out.ticketContext.currentAction, "design");

    const plain = await runCli(["--root", root, "design-review-check", ticketId]);
    assert.equal(plain.code, 0, plain.stderr);
    const plainLines = plain.stdout.split("\n");
    assert.match(plainLines[0], /^design-review-check .* agent=codex-task:read-only@gpt-5\.6-sol effort=xhigh$/);
    assert.equal(plainLines[1].endsWith(path.join("plans", "prompts", "steps", "design_review.md")), true);
  });
});

test("CLI design-review-check errors when design_review.md is missing, naming local-board init", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    await rm(path.join(root, "plans", "prompts", "steps", "design_review.md"));

    const create = await runCli([
      "--root", root, "create", "task", "Missing design-review prompt",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const result = await runCli(["--root", root, "design-review-check", ticketId]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /design-review: prompt not found at .*design_review\.md.*local-board init/s);
  });
});

test("CLI design-review-check and design-review-complete each require a ticket id, and design-review-complete requires --executor and --evidence", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    const create = await runCli([
      "--root", root, "create", "task", "Design-review missing args",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const missingCheckId = await runCli(["--root", root, "design-review-check"]);
    assert.equal(missingCheckId.code, 2);
    assert.match(missingCheckId.stderr, /design-review-check requires/);

    const missingCompleteId = await runCli(["--root", root, "design-review-complete", "--executor", "codex-task:read-only", "--evidence", "PASS"]);
    assert.equal(missingCompleteId.code, 2);
    assert.match(missingCompleteId.stderr, /design-review-complete requires/);

    const missingExecutor = await runCli(["--root", root, "design-review-complete", ticketId, "--evidence", "PASS"]);
    assert.equal(missingExecutor.code, 2);
    assert.match(missingExecutor.stderr, /design-review-complete requires/);

    const missingEvidence = await runCli(["--root", root, "design-review-complete", ticketId, "--executor", "codex-task:read-only"]);
    assert.equal(missingEvidence.code, 2);
    assert.match(missingEvidence.stderr, /design-review-complete requires/);
    assert.match(missingEvidence.stderr, /\[--json\]/);
  });
});

test("CLI design-review full pipeline: design -> design-review-check -> design-review-complete -> move succeeds; skipping design-review-complete is refused", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const create = await runCli([
      "--root", root, "create", "task", "Design-review pipeline",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketPath = create.stdout.trim();
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    assert.equal((await runCli(["--root", root, "estimate", ticketId, "2"])).code, 0);
    assert.equal(
      (
        await runCli([
          "--root", root, "complete-step", ticketId, "design",
          "--executor", "claude-subagent:local-board-designer", "--model", "opus",
          "--evidence", "Design evidence.",
        ])
      ).code,
      0,
    );
    // Satisfy the (separate) requireGateConsultation precondition on the
    // "design" stage catalog so the move refusal below isolates the
    // design-review guard specifically, not the unrelated gate guard.
    assert.equal(
      (
        await runCli([
          "--root", root, "gate-complete", ticketId, "--stage", "design",
          "--executor", "claude-subagent:local-board-gatecheck", "--evidence", "reviewed",
        ])
      ).code,
      0,
    );

    // Skip design-review-complete: the design -> implementation forward move
    // is refused by the T1220Z moveTicket precondition.
    const skipped = await runCli(["--root", root, "move", ticketId, "ready_for_implementation"]);
    assert.notEqual(skipped.code, 0);
    assert.match(skipped.stderr, /no recorded design review/);
    assert.match(
      skipped.stderr,
      new RegExp(`Run "design-review-check ${ticketId}" to resolve the reviewer route, then record the result with `),
    );
    assert.match(
      skipped.stderr,
      new RegExp(
        `"design-review-complete ${ticketId} --executor <executor> --model <model> --evidence <text>" before moving to ready_for_implementation\\.`,
      ),
    );

    const check = await runCli(["--root", root, "design-review-check", ticketId, "--json"]);
    assert.equal(check.code, 0, check.stderr);
    assert.equal(JSON.parse(check.stdout).agent, "codex-task:read-only");

    const complete = await runCli([
      "--root", root, "design-review-complete", ticketId,
      "--executor", "codex-task:read-only", "--model", "gpt-5.6-sol",
      "--evidence", "PASS - no concerns", "--json",
    ]);
    assert.equal(complete.code, 0, complete.stderr);
    const completeOut = JSON.parse(complete.stdout);
    assert.equal(completeOut.ticket, ticketId);
    assert.equal(completeOut.executor, "codex-task:read-only@gpt-5.6-sol");

    const text = await readFile(ticketPath, "utf8");
    assert.match(text, /design-review:codex-task:read-only@gpt-5\.6-sol/);
    assert.match(text, /PASS - no concerns/);

    const moved = await runCli(["--root", root, "move", ticketId, "ready_for_implementation"]);
    assert.equal(moved.code, 0, moved.stderr);
    assert.match(await readFile(ticketPath, "utf8"), /^status: ready_for_implementation$/m);
  });
});

test("CLI design-review-complete enforces the model pin: a mismatched --model is refused, gpt-5.6-sol and codex-default succeed", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const create = await runCli([
      "--root", root, "create", "task", "Design-review model pin mismatch",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const mismatched = await runCli([
      "--root", root, "design-review-complete", ticketId,
      "--executor", "codex-task:read-only", "--model", "wrong-model", "--evidence", "PASS",
    ]);
    assert.notEqual(mismatched.code, 0);
    assert.match(mismatched.stderr, /completed on model wrong-model, but configured model is gpt-5\.6-sol/);

    const create2 = await runCli([
      "--root", root, "create", "task", "Design-review model pin ok",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create2.code, 0, create2.stderr);
    const ticketId2 = path.basename(create2.stdout.trim()).split("_", 1)[0];
    const ok = await runCli([
      "--root", root, "design-review-complete", ticketId2,
      "--executor", "codex-task:read-only", "--model", "gpt-5.6-sol", "--evidence", "PASS",
    ]);
    assert.equal(ok.code, 0, ok.stderr);

    const create3 = await runCli([
      "--root", root, "create", "task", "Design-review model pin codex-default",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create3.code, 0, create3.stderr);
    const ticketId3 = path.basename(create3.stdout.trim()).split("_", 1)[0];
    const codexDefault = await runCli([
      "--root", root, "design-review-complete", ticketId3,
      "--executor", "codex-task:read-only", "--model", "codex-default", "--evidence", "PASS",
    ]);
    assert.equal(codexDefault.code, 0, codexDefault.stderr);
  });
});

test("CLI design-review-check and design-review-complete both refuse on a flag-off board, naming routing.requireDesignReview", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    // Turn the flag back off (scaffold defaults it to true).
    const configPath = path.join(root, "plans", "local-board.config.jsonc");
    await writeFile(
      configPath,
      (await readFile(configPath, "utf8")).replace('"requireDesignReview": true', '"requireDesignReview": false'),
      "utf8",
    );

    const create = await runCli([
      "--root", root, "create", "task", "Design-review flag off",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const check = await runCli(["--root", root, "design-review-check", ticketId]);
    assert.notEqual(check.code, 0);
    assert.match(check.stderr, /routing\.requireDesignReview/);

    const complete = await runCli([
      "--root", root, "design-review-complete", ticketId,
      "--executor", "codex-task:read-only", "--evidence", "PASS",
    ]);
    assert.notEqual(complete.code, 0);
    assert.match(complete.stderr, /routing\.requireDesignReview/);
  });
});

test("CLI design-review-check performs no dispatch and stamps nothing in the active-steps ledger: an absent ledger file stays absent, and a pre-seeded sentinel ledger's raw bytes are unchanged (review finding 1)", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const create = await runCli([
      "--root", root, "create", "task", "Design-review-check no ledger write",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const ledgerFilePath = await ledgerPath(root);
    assert.equal(existsSync(ledgerFilePath), false, "precondition: the ledger file does not exist yet");

    const before = await readActiveSteps(root);
    assert.equal(Object.hasOwn(before, ticketId), false);

    const result = await runCli(["--root", root, "design-review-check", ticketId, "--json"]);
    assert.equal(result.code, 0, result.stderr);

    // Unlike gate-check's non-empty-catalog branch, design-review-check
    // routes to codex-task:read-only (not a local-board-* claude-subagent),
    // which the ledger stamp block skips entirely: not merely an empty
    // ledger for this ticket, but no ledger FILE at all is ever created.
    assert.equal(existsSync(ledgerFilePath), false, "a codex-task route must not create the ledger file at all");
    const after = await readActiveSteps(root);
    assert.deepEqual(after, before);
    assert.equal(Object.hasOwn(after, ticketId), false);

    // Separately: a PRE-EXISTING ledger file (e.g. from an earlier
    // claude-subagent stamp for a different ticket) must be byte-for-byte
    // untouched by a codex-task design-review-check too -- not just
    // unchanged after a JSON.parse/deep-equal round-trip, which would hide a
    // spurious rewrite (re-serialized whitespace, key order, etc.).
    const sentinelBytes = `${JSON.stringify(
      { "T-sentinel": { ticket: "T-sentinel", kind: "action", action: "design", route: "r", model: "m" } },
      null,
      2,
    )}\n`;
    await mkdir(path.dirname(ledgerFilePath), { recursive: true });
    await writeFile(ledgerFilePath, sentinelBytes, "utf8");

    const create2 = await runCli([
      "--root", root, "create", "task", "Design-review-check sentinel ledger untouched",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create2.code, 0, create2.stderr);
    const ticketId2 = path.basename(create2.stdout.trim()).split("_", 1)[0];

    const result2 = await runCli(["--root", root, "design-review-check", ticketId2, "--json"]);
    assert.equal(result2.code, 0, result2.stderr);

    const rawAfter = await readFile(ledgerFilePath, "utf8");
    assert.equal(rawAfter, sentinelBytes, "a codex-task design-review-check must not rewrite a pre-existing ledger file at all");
  });
});

test("CLI design-review-check (T20260710T1532Z D6, B20260710T2050Z D7 fix): a fallback-free payload is byte-identical to the legacy shape on every route; no stamp is written on the default codex-task:read-only route, but a claude-subagent route without fallbackModels now DOES stamp the fallback-free 7-key record", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    // Default (codex-task:read-only, no fallbackModels).
    const create1 = await runCli([
      "--root", root, "create", "task", "Design-review legacy shape default",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create1.code, 0, create1.stderr);
    const ticketPath1 = create1.stdout.trim();
    const ticketId1 = path.basename(ticketPath1).split("_", 1)[0];
    const result1 = await runCli(["--root", root, "design-review-check", ticketId1, "--json"]);
    assert.equal(result1.code, 0, result1.stderr);
    const out1 = JSON.parse(result1.stdout);
    assert.deepEqual(out1, {
      ticket: ticketId1,
      prompt: path.resolve(root, "plans", "prompts", "steps", "design_review.md"),
      agent: "codex-task:read-only",
      model: "gpt-5.6-sol",
      effort: "xhigh",
      ticketPath: ticketPath1,
      ticketContext: {
        id: ticketId1,
        type: "task",
        status: "ready_for_design",
        priority: "P2",
        path: path.relative(root, ticketPath1),
        title: "Design-review legacy shape default",
        currentAction: "design",
        requirement: "",
        acceptanceCriteria: "",
      },
    });
    assert.equal(Object.hasOwn(await readActiveSteps(root), ticketId1), false);

    // claude-subagent route, no fallbackModels: hook-gated, and (D7 fix)
    // now DOES stamp the ledger unconditionally for claude-subagent routes.
    // Agent profiles are replaced wholesale per action (loadConfig, not
    // deep-merged): the overlay omits "effort", so it resolves to null, not
    // DEFAULT_CONFIG's "xhigh".
    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      JSON.stringify({
        routing: { requireDesignReview: true },
        agents: {
          "design-review": { route: "claude-subagent:local-board-reviewer", model: "sonnet" },
        },
      }),
      "utf8",
    );
    const create2 = await runCli([
      "--root", root, "create", "task", "Design-review legacy shape claude-subagent no fallback",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create2.code, 0, create2.stderr);
    const ticketPath2 = create2.stdout.trim();
    const ticketId2 = path.basename(ticketPath2).split("_", 1)[0];
    const result2 = await runCli(["--root", root, "design-review-check", ticketId2, "--json"]);
    assert.equal(result2.code, 0, result2.stderr);
    const out2 = JSON.parse(result2.stdout);
    assert.deepEqual(out2, {
      ticket: ticketId2,
      prompt: path.resolve(root, "plans", "prompts", "steps", "design_review.md"),
      agent: "claude-subagent:local-board-reviewer",
      model: "sonnet",
      effort: null,
      ticketPath: ticketPath2,
      ticketContext: {
        id: ticketId2,
        type: "task",
        status: "ready_for_design",
        priority: "P2",
        path: path.relative(root, ticketPath2),
        title: "Design-review legacy shape claude-subagent no fallback",
        currentAction: "design",
        requirement: "",
        acceptanceCriteria: "",
      },
    });
    // D7 fix (B20260710T2050Z): the stamp guard no longer requires a
    // non-empty fallbackModels list -- ANY claude-subagent design-review
    // route stamps unconditionally. The record carries exactly the 7
    // beginStep-shape keys; no `fallbackModels` key is present at all (D6:
    // the FIELD stays conditional on a non-empty configured list).
    const record2 = (await readActiveSteps(root))[ticketId2];
    assert.ok(record2, "a fallback-free claude-subagent design-review route must now stamp the ledger");
    assert.equal(Object.hasOwn(record2, "fallbackModels"), false);
    assert.deepEqual(Object.keys(record2).sort(), ["action", "kind", "model", "root", "route", "ticket", "ts"]);
    assert.equal(record2.kind, "action");
    assert.equal(record2.action, "design-review");
    assert.equal(record2.route, "claude-subagent:local-board-reviewer");
    assert.equal(record2.model, "sonnet");
    assert.equal(record2.root, path.resolve(root));
    assert.equal(typeof record2.ts, "string");
  });
});

test("CLI design-review-check (T20260710T1532Z, D5/D6): a fallback-configured claude-subagent design-review profile stamps an action/design-review ledger record and gains fallbackModels + codexDispatch in the payload", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      JSON.stringify({
        routing: { requireDesignReview: true },
        agents: {
          "design-review": {
            route: "claude-subagent:local-board-reviewer",
            model: "sonnet",
            fallbackModels: ["gpt-5.5-fallback"],
          },
        },
      }),
      "utf8",
    );
    const create = await runCli([
      "--root", root, "create", "task", "Design-review fallback bundle",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const result = await runCli(["--root", root, "design-review-check", ticketId, "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.deepEqual(out.fallbackModels, ["gpt-5.5-fallback"]);
    assert.deepEqual(out.codexDispatch.fallbackModels, ["gpt-5.5-fallback"]);

    const steps = await readActiveSteps(root);
    assert.equal(steps[ticketId].kind, "action");
    assert.equal(steps[ticketId].action, "design-review");
    assert.equal(steps[ticketId].route, "claude-subagent:local-board-reviewer");
    assert.equal(steps[ticketId].model, "sonnet");
    assert.deepEqual(steps[ticketId].fallbackModels, ["gpt-5.5-fallback"]);
  });
});

test("CLI design-review-check (T20260710T1532Z, finding 5): a fallback-configured codex-task design-review route gains the fallback bundle with a non-null codexDispatch.promptPath, but writes no stamp (not hook-gated)", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      JSON.stringify({
        routing: { requireDesignReview: true },
        agents: {
          "design-review": {
            route: "codex-task:read-only",
            model: "gpt-5.6-sol",
            effort: "xhigh",
            fallbackModels: ["gpt-5.5"],
          },
        },
      }),
      "utf8",
    );
    const create = await runCli([
      "--root", root, "create", "task", "Design-review codex-task fallback prompt path",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const result = await runCli(["--root", root, "design-review-check", ticketId, "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.equal(out.codexDispatch.promptPath, out.prompt);
    assert.deepEqual(out.codexDispatch.fallbackModels, ["gpt-5.5"]);
    assert.equal(Object.hasOwn(await readActiveSteps(root), ticketId), false);
  });
});

test("CLI design-review-check (B20260710T2050Z, review finding 2a: one-slot-per-ticket, premature call): design-review-check while a live begin-step design stamp is still present does not clobber it -- the command still succeeds, the old record stays, and check-dispatch still rejects the reviewer route", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      JSON.stringify({
        routing: { requireDesignReview: true },
        agents: {
          "design-review": { route: "claude-subagent:local-board-reviewer", model: "sonnet" },
        },
      }),
      "utf8",
    );

    const create = await runCli([
      "--root", root, "create", "task", "Premature design-review-check before design completes",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    assert.equal((await runCli(["--root", root, "estimate", ticketId, "2"])).code, 0);
    assert.equal((await runCli(["--root", root, "begin-step", ticketId, "--json"])).code, 0);

    const beforeCheck = (await readActiveSteps(root))[ticketId];
    assert.equal(beforeCheck.kind, "action");
    assert.equal(beforeCheck.action, "design");
    assert.equal(beforeCheck.route, "claude-subagent:local-board-designer");

    // Premature use: design-review-check runs while the "design" action
    // stamp is still live (design was never completed). Documenting the
    // actual, observed behavior: the command still succeeds (no-clobber is a
    // non-fatal warning, not an error), the pre-existing "design" record is
    // left untouched, and the reviewer dispatch stays rejected until the
    // slot is cleared by the normal complete-step flow.
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (message = "") => warnings.push(String(message));
    let check;
    try {
      check = await runCli(["--root", root, "design-review-check", ticketId, "--json"]);
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(check.code, 0, check.stderr);
    assert.ok(
      warnings.some((message) => message.includes(ticketId) && message.includes("not stamped")),
      `expected a not-stamped warning naming ${ticketId}, got: ${JSON.stringify(warnings)}`,
    );

    const afterCheck = (await readActiveSteps(root))[ticketId];
    assert.deepEqual(
      afterCheck,
      beforeCheck,
      "the live design action stamp must survive the conflicting design-review-check",
    );

    const dispatch = await runCli([
      "--root", root, "check-dispatch",
      "--agent", "local-board-reviewer", "--model", "sonnet", "--ticket", ticketId,
    ]);
    assert.equal(dispatch.code, 1);
    assert.deepEqual(JSON.parse(dispatch.stdout), {
      ok: false,
      reason: "agent-mismatch",
      expected: { agent: "local-board-designer", model: "opus" },
      ticket: ticketId,
    });
  });
});

test("CLI design-review-check (B20260710T2050Z, review finding 2b: one-slot-per-ticket, normal flow): complete-step design clears the slot, then design-review-check stamps cleanly; check-dispatch accepts the pinned reviewer, rejects a wrong model, and rejects a wrong agent", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      JSON.stringify({
        routing: { requireDesignReview: true },
        agents: {
          "design-review": { route: "claude-subagent:local-board-reviewer", model: "sonnet" },
        },
      }),
      "utf8",
    );

    const create = await runCli([
      "--root", root, "create", "task", "Design-review-check after design completes cleanly",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    assert.equal((await runCli(["--root", root, "estimate", ticketId, "2"])).code, 0);
    assert.equal((await runCli(["--root", root, "begin-step", ticketId, "--json"])).code, 0);
    assert.equal(
      (
        await runCli([
          "--root", root, "complete-step", ticketId, "design",
          "--executor", "claude-subagent:local-board-designer", "--model", "opus",
          "--evidence", "Design evidence.", "--json",
        ])
      ).code,
      0,
    );
    assert.equal(
      Object.hasOwn(await readActiveSteps(root), ticketId),
      false,
      "complete-step must clear the design action slot",
    );

    const check = await runCli(["--root", root, "design-review-check", ticketId, "--json"]);
    assert.equal(check.code, 0, check.stderr);
    const record = (await readActiveSteps(root))[ticketId];
    assert.equal(record.kind, "action");
    assert.equal(record.action, "design-review");
    assert.equal(record.route, "claude-subagent:local-board-reviewer");
    assert.equal(record.model, "sonnet");

    const pinned = await runCli([
      "--root", root, "check-dispatch", "--agent", "local-board-reviewer", "--model", "sonnet", "--ticket", ticketId,
    ]);
    assert.equal(pinned.code, 0, pinned.stderr);
    assert.equal(JSON.parse(pinned.stdout).reason, "match");

    const wrongModel = await runCli([
      "--root", root, "check-dispatch", "--agent", "local-board-reviewer", "--model", "opus", "--ticket", ticketId,
    ]);
    assert.equal(wrongModel.code, 1);
    assert.equal(JSON.parse(wrongModel.stdout).reason, "model-mismatch");

    const wrongAgent = await runCli([
      "--root", root, "check-dispatch", "--agent", "local-board-tester", "--model", "sonnet", "--ticket", ticketId,
    ]);
    assert.equal(wrongAgent.code, 1);
    assert.equal(JSON.parse(wrongAgent.stdout).reason, "agent-mismatch");
  });
});

test("CLI design-review-check (B20260710T2050Z, review finding 3): a second identical call is accepted as an idempotent match and rewrites the record with a refreshed ts, not a pure no-op", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      JSON.stringify({
        routing: { requireDesignReview: true },
        agents: {
          "design-review": { route: "claude-subagent:local-board-reviewer", model: "sonnet" },
        },
      }),
      "utf8",
    );

    const create = await runCli([
      "--root", root, "create", "task", "Consecutive design-review-check calls",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const first = await runCli(["--root", root, "design-review-check", ticketId, "--json"]);
    assert.equal(first.code, 0, first.stderr);
    const firstRecord = (await readActiveSteps(root))[ticketId];
    assert.equal(firstRecord.kind, "action");
    assert.equal(firstRecord.action, "design-review");

    // Force a distinguishable ts, deterministically (independent of clock
    // resolution): back-date the stamp directly, then re-run
    // design-review-check and assert the record's ts actually advances. A
    // second identical call is NOT a pure no-op -- stampActiveStepNoClobber
    // treats the same kind/action/route/model as an idempotent match and
    // rewrites the record, mirroring beginStep's self-healing re-stamp.
    await stampActiveStep(root, ticketId, { ...firstRecord, ts: "2020-01-01T00:00:00Z" });
    assert.equal((await readActiveSteps(root))[ticketId].ts, "2020-01-01T00:00:00Z");

    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (message = "") => warnings.push(String(message));
    let second;
    try {
      second = await runCli(["--root", root, "design-review-check", ticketId, "--json"]);
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(second.code, 0, second.stderr);
    assert.equal(warnings.length, 0, "an idempotent re-stamp must be accepted cleanly, not reported as a conflict");

    const secondRecord = (await readActiveSteps(root))[ticketId];
    assert.equal(secondRecord.kind, "action");
    assert.equal(secondRecord.action, "design-review");
    assert.equal(secondRecord.route, "claude-subagent:local-board-reviewer");
    assert.equal(secondRecord.model, "sonnet");
    assert.notEqual(
      secondRecord.ts,
      "2020-01-01T00:00:00Z",
      "a second identical call must rewrite the record with a refreshed ts, not leave the stale one in place",
    );
  });
});

test("CLI design-review-check -> design-review-complete (claude-subagent, fallback-free): recordDesignReview clears the identity-scoped stamp, and check-dispatch reverts to agent-mismatch afterward", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      JSON.stringify({
        routing: { requireDesignReview: true },
        agents: {
          "design-review": { route: "claude-subagent:local-board-reviewer", model: "sonnet" },
        },
      }),
      "utf8",
    );

    const create = await runCli([
      "--root", root, "create", "task", "recordDesignReview clears the fallback-free stamp",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const check = await runCli(["--root", root, "design-review-check", ticketId, "--json"]);
    assert.equal(check.code, 0, check.stderr);
    assert.ok(Object.hasOwn(await readActiveSteps(root), ticketId), "design-review-check must stamp the ledger");

    const complete = await runCli([
      "--root", root, "design-review-complete", ticketId,
      "--executor", "claude-subagent:local-board-reviewer", "--model", "sonnet",
      "--evidence", "PASS - no concerns", "--json",
    ]);
    assert.equal(complete.code, 0, complete.stderr);

    assert.equal(
      Object.hasOwn(await readActiveSteps(root), ticketId),
      false,
      "design-review-complete (recordDesignReview) must clear the identity-scoped design-review stamp",
    );

    const dispatch = await runCli([
      "--root", root, "check-dispatch",
      "--agent", "local-board-reviewer", "--model", "sonnet", "--ticket", ticketId,
    ]);
    assert.equal(dispatch.code, 1);
    assert.equal(
      JSON.parse(dispatch.stdout).reason,
      "agent-mismatch",
      "after the stamp clears, check-dispatch must fall back to the status action route (design), not the reviewer",
    );
  });
});

test("CLI full sequence (T20260710T1532Z, D5-finding-1 primary): specialty-run (claude-subagent design specialty) -> its own complete-step clears the specialty stamp -> design-review-check stamps design-review with no conflict -> check-dispatch accepts the pinned and configured-fallback model, rejects an unlisted model", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      JSON.stringify({
        routing: { requireDesignReview: true },
        agents: {
          "design-review": {
            route: "claude-subagent:local-board-reviewer",
            model: "sonnet",
            fallbackModels: ["gpt-5.5-fallback"],
          },
        },
        optionalSteps: {
          design: [
            {
              name: "security_threat_model",
              prompt: "plans/prompts/optional-steps/design/security_threat_model.md",
              triggers: "Auth, crypto, PII.",
              agent: { route: "claude-subagent:local-board-gatecheck", model: "haiku" },
            },
          ],
        },
      }),
      "utf8",
    );

    const create = await runCli([
      "--root", root, "create", "task", "Full sequence design-review after delegated specialty",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    // 1. specialty-run leaves a kind:"specialty" ledger stamp.
    const specialtyRun = await runCli(["--root", root, "specialty-run", ticketId, "security_threat_model", "--json"]);
    assert.equal(specialtyRun.code, 0, specialtyRun.stderr);
    let steps = await readActiveSteps(root);
    assert.equal(steps[ticketId].kind, "specialty");
    assert.equal(steps[ticketId].action, "security_threat_model");

    // Companion precondition: without the D5-finding-1 clear, the specialty
    // stamp would still be live here and design-review-check's
    // stampActiveStepNoClobber below would conflict.
    assert.equal(steps[ticketId].kind, "specialty", "precondition: specialty stamp is live before its own complete-step");

    // 2. The specialty's own complete-step clears its ledger stamp
    // (D5-finding-1, isSpecialtyLedgerEntry).
    const specialtyComplete = await runCli([
      "--root", root, "complete-step", ticketId, "security_threat_model",
      "--executor", "claude-subagent:local-board-gatecheck", "--model", "haiku",
      "--evidence", "Threat model reviewed.",
    ]);
    assert.equal(specialtyComplete.code, 0, specialtyComplete.stderr);
    steps = await readActiveSteps(root);
    assert.equal(Object.hasOwn(steps, ticketId), false, "specialty stamp must be cleared by its own complete-step");

    // 3. design-review-check now reaches a clean slot: the action/design-review
    // stamp lands with no conflict.
    const reviewCheck = await runCli(["--root", root, "design-review-check", ticketId, "--json"]);
    assert.equal(reviewCheck.code, 0, reviewCheck.stderr);
    steps = await readActiveSteps(root);
    assert.equal(steps[ticketId].kind, "action");
    assert.equal(steps[ticketId].action, "design-review");
    assert.deepEqual(steps[ticketId].fallbackModels, ["gpt-5.5-fallback"]);

    // 4. check-dispatch accepts the pin and the configured fallback, rejects
    // an unlisted model.
    const pinned = await runCli([
      "--root", root, "check-dispatch", "--agent", "local-board-reviewer", "--model", "sonnet", "--ticket", ticketId,
    ]);
    assert.equal(pinned.code, 0, pinned.stderr);
    assert.equal(JSON.parse(pinned.stdout).reason, "match");

    const fallback = await runCli([
      "--root", root, "check-dispatch", "--agent", "local-board-reviewer", "--model", "gpt-5.5-fallback", "--ticket", ticketId,
    ]);
    assert.equal(fallback.code, 0, fallback.stderr);
    assert.equal(JSON.parse(fallback.stdout).reason, "match");

    const unlisted = await runCli([
      "--root", root, "check-dispatch", "--agent", "local-board-reviewer", "--model", "gpt-4o", "--ticket", ticketId,
    ]);
    assert.equal(unlisted.code, 1);
    assert.equal(JSON.parse(unlisted.stdout).reason, "model-mismatch");
  });
});

test("CLI design-review-complete accepts a combined route@model --executor with no --model flag", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const create = await runCli([
      "--root", root, "create", "task", "Design-review combined executor",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const result = await runCli([
      "--root", root, "design-review-complete", ticketId,
      "--executor", "codex-task:read-only@codex-default", "--evidence", "PASS", "--json",
    ]);
    assert.equal(result.code, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.equal(out.executor, "codex-task:read-only@codex-default");
  });
});

test("CLI move refuses a forward gated transition with an actionable error (post-init default), then succeeds once recorded", async () => {
  await withBoard(async (root) => {
    // local-board init scaffolds requireGateConsultation: true.
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const create = await runCli([
      "--root", root, "create", "task", "Gated move via CLI",
      "--status", "ready_for_test", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const refused = await runCli(["--root", root, "move", ticketId, "ready_for_docs"]);
    assert.equal(refused.code, 2);
    assert.match(refused.stderr, /no recorded gate consultation for stage "test"/);
    assert.match(refused.stderr, /gate-check/);
    assert.match(refused.stderr, /gate-complete/);

    // optionalSteps.test is empty by default: gate-check auto-stamps the
    // consultation, no gate-complete call needed.
    assert.equal((await runCli(["--root", root, "gate-check", ticketId, "--stage", "test", "--json"])).code, 0);

    const moved = await runCli(["--root", root, "move", ticketId, "ready_for_docs"]);
    assert.equal(moved.code, 0, moved.stderr);
  });
});

test("CLI move gating is disabled when routing.requireGateConsultation is set to false", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      JSON.stringify({ routing: { requireGateConsultation: false } }),
      "utf8",
    );

    const create = await runCli([
      "--root", root, "create", "task", "Switch off restores old behavior",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const moved = await runCli(["--root", root, "move", ticketId, "ready_for_implementation"]);
    assert.equal(moved.code, 0, moved.stderr);
  });
});

test("CLI move refuses an illegal transition, names the allowed targets, then --override --reason forces it and records a Run Log line (scaffold enforceTransitions:true)", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    const create = await runCli([
      "--root", root, "create", "task", "Skip review via CLI",
      "--status", "ready_for_implementation", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const refused = await runCli(["--root", root, "move", ticketId, "ready_for_test"]);
    assert.equal(refused.code, 2);
    assert.match(refused.stderr, /move refused: transition ready_for_implementation -> ready_for_test is not allowed/);
    assert.match(refused.stderr, /Allowed targets:/);
    assert.match(refused.stderr, /--override --reason/);

    const overridden = await runCli([
      "--root", root, "move", ticketId, "ready_for_test",
      "--override", "--reason", "CLI override test",
    ]);
    assert.equal(overridden.code, 0, overridden.stderr);
    const text = await readFile(overridden.stdout.trim(), "utf8");
    assert.match(text, /^status: ready_for_test$/m);
    assert.match(text, /Transition override: ready_for_implementation -> ready_for_test: CLI override test/);
  });
});

test("CLI set <id> status has --override parity with move", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    const create = await runCli([
      "--root", root, "create", "task", "Set status override parity",
      "--status", "ready_for_implementation", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const refused = await runCli(["--root", root, "set", ticketId, "status", "ready_for_test"]);
    assert.equal(refused.code, 2);
    assert.match(refused.stderr, /move refused/);

    const overridden = await runCli([
      "--root", root, "set", ticketId, "status", "ready_for_test",
      "--override", "--reason", "set parity override",
    ]);
    assert.equal(overridden.code, 0, overridden.stderr);
    const text = await readFile(overridden.stdout.trim(), "utf8");
    assert.match(text, /^status: ready_for_test$/m);
    assert.match(text, /Transition override: ready_for_implementation -> ready_for_test: set parity override/);
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

    // security_audit is in the default optionalSteps.implement catalog and the
    // scaffold pins it to codex-task:read-only@gpt-5.6-sol.
    const done = await runCli([
      "--root", root, "complete-step", id, "security_audit",
      "--executor", "codex-task:read-only@gpt-5.6-sol", "--evidence", "PASS: no findings",
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

test("CLI complete-step --model composes route@model server-side, equivalent to the combined --executor route@model form", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const create = await runCli([
      "--root", root, "create", "task", "Two-flag model composition",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const id = path.basename(create.stdout.trim()).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "estimate", id, "2"])).code, 0);

    const twoFlag = await runCli([
      "--root", root, "complete-step", id, "design",
      "--executor", "claude-subagent:local-board-designer", "--model", "opus",
      "--evidence", "Design evidence.",
    ]);
    assert.equal(twoFlag.code, 0, twoFlag.stderr);
    const text = await readFile(create.stdout.trim(), "utf8");
    assert.match(text, /^completedSteps: \["design:claude-subagent:local-board-designer@opus"\]$/m);

    // Equivalence: the combined --executor route@model form on a second
    // ticket produces the identical recorded token.
    const create2 = await runCli([
      "--root", root, "create", "task", "Combined-form equivalence",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create2.code, 0, create2.stderr);
    const id2 = path.basename(create2.stdout.trim()).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "estimate", id2, "2"])).code, 0);

    const combined = await runCli([
      "--root", root, "complete-step", id2, "design",
      "--executor", "claude-subagent:local-board-designer@opus",
      "--evidence", "Design evidence.",
    ]);
    assert.equal(combined.code, 0, combined.stderr);
    const text2 = await readFile(create2.stdout.trim(), "utf8");
    assert.match(text2, /^completedSteps: \["design:claude-subagent:local-board-designer@opus"\]$/m);
  });
});

test("CLI complete-step: --executor @suffix disagreeing with --model throws naming both; an identical suffix is a no-op", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    const create = await runCli([
      "--root", root, "create", "task", "Disagreeing model flags",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const id = path.basename(create.stdout.trim()).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "estimate", id, "2"])).code, 0);

    const conflict = await runCli([
      "--root", root, "complete-step", id, "design",
      "--executor", "claude-subagent:local-board-designer@opus", "--model", "sonnet",
      "--evidence", "Design evidence.",
    ]);
    assert.notEqual(conflict.code, 0);
    assert.match(conflict.stderr, /--executor pins @opus but --model says sonnet; pass only one or make them agree/);

    const agree = await runCli([
      "--root", root, "complete-step", id, "design",
      "--executor", "claude-subagent:local-board-designer@opus", "--model", "opus",
      "--evidence", "Design evidence.",
    ]);
    assert.equal(agree.code, 0, agree.stderr);
    const text = await readFile(create.stdout.trim(), "utf8");
    assert.match(text, /^completedSteps: \["design:claude-subagent:local-board-designer@opus"\]$/m);
  });
});

test("CLI complete-step: --model with --executor inline throws the specific inline error", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    const create = await runCli([
      "--root", root, "create", "task", "Inline model flag rejection",
      "--status", "ready_for_review", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const id = path.basename(create.stdout.trim()).split("_", 1)[0];

    const res = await runCli([
      "--root", root, "complete-step", id, "review",
      "--executor", "inline", "--model", "opus", "--evidence", "x",
    ]);
    assert.notEqual(res.code, 0);
    assert.match(res.stderr, /--model cannot be used with --executor inline/);
  });
});

test("CLI complete-step --override --reason plumbs through and records; --override without --reason errors with the usage message (scaffold guardPrematureEvidence:true)", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    const create = await runCli([
      "--root", root, "create", "task", "Premature review via CLI",
      "--status", "ready_for_implementation", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const id = path.basename(create.stdout.trim()).split("_", 1)[0];

    const refused = await runCli([
      "--root", root, "complete-step", id, "review",
      "--executor", "codex-task:read-only@gpt-5.6-terra", "--evidence", "Review evidence.",
    ]);
    assert.notEqual(refused.code, 0);
    assert.match(refused.stderr, /would be stripped by the forward move into ready_for_review/);

    const missingReason = await runCli([
      "--root", root, "complete-step", id, "review",
      "--executor", "codex-task:read-only@gpt-5.6-terra", "--evidence", "Review evidence.", "--override",
    ]);
    assert.notEqual(missingReason.code, 0);
    assert.match(missingReason.stderr, /complete-step --override requires --reason/);

    const overridden = await runCli([
      "--root", root, "complete-step", id, "review",
      "--executor", "codex-task:read-only@gpt-5.6-terra", "--evidence", "Review evidence.",
      "--override", "--reason", "CLI override test",
    ]);
    assert.equal(overridden.code, 0, overridden.stderr);
    const text = await readFile(create.stdout.trim(), "utf8");
    assert.match(text, /^completedSteps: \["review:codex-task:read-only@gpt-5\.6-terra"\]$/m);
    assert.match(text, /Premature-evidence override: recorded review at ready_for_implementation ahead of its producing status ready_for_review: CLI override test/);
  });
});

test("CLI complete-step: --model codex-default composes route@codex-default and satisfies the pinned-model check", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    const create = await runCli([
      "--root", root, "create", "task", "Codex-default two-flag form",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const id = path.basename(create.stdout.trim()).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "estimate", id, "2"])).code, 0);

    const res = await runCli([
      "--root", root, "complete-step", id, "design",
      "--executor", "claude-subagent:local-board-designer", "--model", "codex-default",
      "--evidence", "Codex-translated design evidence.",
    ]);
    assert.equal(res.code, 0, res.stderr);
    const text = await readFile(create.stdout.trim(), "utf8");
    assert.match(text, /^completedSteps: \["design:claude-subagent:local-board-designer@codex-default"\]$/m);
  });
});

test("CLI complete-step rejects a flag swallowed as an option value", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    const create = await runCli([
      "--root", root, "create", "task", "Flag swallowed as value",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const id = path.basename(create.stdout.trim()).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "estimate", id, "2"])).code, 0);
    assert.equal(
      (await runCli(["--root", root, "approve-inline", id, "design", "--reason", "flag-swallow regression test"])).code,
      0,
    );

    const res = await runCli([
      "--root", root, "complete-step", id, "test",
      "--executor", "--evidence", "x",
    ]);
    assert.equal(res.code, 2);
    assert.match(res.stderr, /--executor/);
    assert.match(res.stderr, /--evidence/);

    // A value that merely contains dashes (not a leading --) still parses.
    const ok = await runCli([
      "--root", root, "complete-step", id, "design",
      "--executor", "inline", "--evidence", "pre--post",
    ]);
    assert.equal(ok.code, 0, ok.stderr);
  });
});

test("CLI global --root option rejects a following flag as its value with a clean usage error", async () => {
  const res = await runCli(["--root", "--json", "validate"]);
  assert.equal(res.code, 2);
  assert.match(res.stderr, /--root/);
  // The clean takeOption message, not an uncaught exception stack trace.
  assert.doesNotMatch(res.stderr, /\bat\s+\S+\s+\(.*:\d+:\d+\)/);
});

test("CLI approve-inline --executor approves a model deviation on a pinned action", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    const create = await runCli([
      "--root", root, "create", "task", "CLI model deviation",
      "--status", "ready_for_design", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const id = path.basename(create.stdout.trim()).split("_", 1)[0];
    assert.equal((await runCli(["--root", root, "estimate", id, "2"])).code, 0);

    const rejected = await runCli([
      "--root", root, "complete-step", id, "design",
      "--executor", "claude-subagent:local-board-designer@sonnet", "--evidence", "Design evidence",
    ]);
    assert.notEqual(rejected.code, 0);
    assert.match(rejected.stderr, /configured model is opus/);

    const approve = await runCli([
      "--root", root, "approve-inline", id, "design",
      "--executor", "claude-subagent:local-board-designer@sonnet",
      "--reason", "Opus unavailable; running sonnet.",
    ]);
    assert.equal(approve.code, 0, approve.stderr);

    const completed = await runCli([
      "--root", root, "complete-step", id, "design",
      "--executor", "claude-subagent:local-board-designer@sonnet", "--evidence", "Design evidence",
    ]);
    assert.equal(completed.code, 0, completed.stderr);

    const text = await readFile(create.stdout.trim(), "utf8");
    assert.match(text, /^routingApprovals: \["design:claude-subagent:local-board-designer@sonnet"\]$/m);
  });
});

test("CLI specialty-run dispatches to optionalSteps catalog by status-derived stage", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    // Case 1: implementing status -> implement stage, step security_audit,
    // scaffold-pinned agent codex-task:read-only@gpt-5.6-sol/xhigh.
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
    assert.equal(implOut.agent, "codex-task:read-only");
    assert.equal(implOut.model, "gpt-5.6-sol");
    assert.equal(implOut.effort, "xhigh");
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
    assert.match(plainLines[0], /^specialty-run .* step=security_audit stage=implement agent=codex-task:read-only@gpt-5\.6-sol$/);
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
    // specialty-run now verifies the resolved prompt exists; this custom entry
    // has no packaged counterpart, so seed the fixture file it points at.
    await writeFile(
      path.join(root, "plans", "prompts", "optional-steps", "design", "custom_review.md"),
      "# Custom Review\n",
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
    assert.equal(out.model, null);
    assert.equal(out.effort, null);
    assert.equal(out.step, "custom_review");
    assert.equal(out.stage, "design");
  });
});

test("CLI specialty-run returns model/effort pins for an object-form optionalSteps[].agent profile", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);

    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      JSON.stringify({
        version: 1,
        optionalSteps: {
          design: [],
          implement: [
            {
              name: "security_audit",
              prompt: "plans/prompts/optional-steps/impl/security_audit.md",
              triggers: "Anything touched by the security audit.",
              agent: { route: "codex-task:read-only", model: "gpt-5.6-sol", effort: "xhigh" },
            },
          ],
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
      "Specialty pinned-profile target",
      "--status",
      "implementing",
      "--priority",
      "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const result = await runCli(["--root", root, "specialty-run", ticketId, "security_audit", "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.equal(out.agent, "codex-task:read-only");
    assert.equal(out.model, "gpt-5.6-sol");
    assert.equal(out.effort, "xhigh");

    const plain = await runCli(["--root", root, "specialty-run", ticketId, "security_audit"]);
    assert.equal(plain.code, 0, plain.stderr);
    assert.match(
      plain.stdout.split("\n")[0],
      /^specialty-run .* step=security_audit stage=implement agent=codex-task:read-only@gpt-5\.6-sol$/,
    );
  });
});

test("CLI specialty-run (T20260710T1532Z, D6): a fallback-free specialty payload/stamp are byte-identical to the legacy shape (no fallbackModels, no codexDispatch)", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      JSON.stringify({
        version: 1,
        optionalSteps: {
          design: [],
          implement: [
            {
              name: "security_audit",
              prompt: "plans/prompts/optional-steps/impl/security_audit.md",
              triggers: "Anything touched by the security audit.",
              agent: { route: "codex-task:read-only", model: "gpt-5.6-sol", effort: "xhigh" },
            },
          ],
          test: [],
        },
      }),
      "utf8",
    );

    const create = await runCli([
      "--root", root, "create", "task", "Specialty legacy shape",
      "--status", "implementing", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketPath = create.stdout.trim();
    const ticketId = path.basename(ticketPath).split("_", 1)[0];

    const result = await runCli(["--root", root, "specialty-run", ticketId, "security_audit", "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.deepEqual(out, {
      ticket: ticketId,
      stage: "implement",
      step: "security_audit",
      prompt: path.resolve(root, "plans/prompts/optional-steps/impl/security_audit.md"),
      agent: "codex-task:read-only",
      model: "gpt-5.6-sol",
      effort: "xhigh",
      ticketPath,
      ticketContext: {
        id: ticketId,
        type: "task",
        status: "implementing",
        priority: "P2",
        path: path.relative(root, ticketPath),
        title: "Specialty legacy shape",
        currentAction: null,
        requirement: "",
        acceptanceCriteria: "",
      },
    });
    // codex-task:read-only is not hook-gated, so no ledger stamp is written.
    const steps = await readActiveSteps(root);
    assert.equal(Object.hasOwn(steps, ticketId), false);
  });
});

test("CLI specialty-run (T20260710T1532Z, D5/D6): a fallback-configured claude-subagent specialty gains raw fallbackModels + a codexDispatch sub-block (resolved effort and promptPath preserved); the specialty stamp carries fallbackModels", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      JSON.stringify({
        version: 1,
        optionalSteps: {
          design: [],
          implement: [
            {
              name: "security_audit",
              prompt: "plans/prompts/optional-steps/impl/security_audit.md",
              triggers: "Anything touched by the security audit.",
              agent: {
                route: "claude-subagent:local-board-gatecheck",
                model: "haiku",
                effort: "xhigh",
                fallbackModels: ["gpt-5.5-fallback"],
              },
            },
          ],
          test: [],
        },
      }),
      "utf8",
    );

    const create = await runCli([
      "--root", root, "create", "task", "Specialty fallback bundle",
      "--status", "implementing", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const result = await runCli(["--root", root, "specialty-run", ticketId, "security_audit", "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.deepEqual(out.fallbackModels, ["gpt-5.5-fallback"]);
    assert.equal(out.codexDispatch.effort, "xhigh");
    assert.deepEqual(out.codexDispatch.fallbackModels, ["gpt-5.5-fallback"]);

    const steps = await readActiveSteps(root);
    assert.equal(steps[ticketId].kind, "specialty");
    assert.deepEqual(steps[ticketId].fallbackModels, ["gpt-5.5-fallback"]);
  });
});

test("CLI specialty-run (T20260710T1532Z, finding 5): a fallback-configured codex-task specialty's codexDispatch.promptPath equals the entry's resolved prompt path", async () => {
  await withBoard(async (root) => {
    assert.equal((await runCli(["--root", root, "init", "--json"])).code, 0);
    await writeFile(
      path.join(root, "plans", "local-board.config.jsonc"),
      JSON.stringify({
        version: 1,
        optionalSteps: {
          design: [],
          implement: [
            {
              name: "security_audit",
              prompt: "plans/prompts/optional-steps/impl/security_audit.md",
              triggers: "Anything touched by the security audit.",
              agent: {
                route: "codex-task:read-only",
                model: "gpt-5.6-sol",
                effort: "xhigh",
                fallbackModels: ["gpt-5.5"],
              },
            },
          ],
          test: [],
        },
      }),
      "utf8",
    );

    const create = await runCli([
      "--root", root, "create", "task", "Specialty codex-task fallback prompt path",
      "--status", "implementing", "--priority", "P2",
    ]);
    assert.equal(create.code, 0, create.stderr);
    const ticketId = path.basename(create.stdout.trim()).split("_", 1)[0];

    const result = await runCli(["--root", root, "specialty-run", ticketId, "security_audit", "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.equal(out.codexDispatch.promptPath, out.prompt);
    assert.deepEqual(out.codexDispatch.fallbackModels, ["gpt-5.5"]);
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
    // specialty-run now verifies the resolved prompt exists; this synthetic
    // test-stage entry has no packaged counterpart, so seed its fixture file.
    await mkdir(path.join(root, "plans", "prompts", "optional-steps", "test"), { recursive: true });
    await writeFile(
      path.join(root, "plans", "prompts", "optional-steps", "test", "perf_smoke.md"),
      "# Perf Smoke\n",
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

test("design-review prompt describes the real persistence flow, not a phantom section", async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const stepText = await readFile(
    path.join(repoRoot, "plans", "prompts", "steps", "design_review.md"),
    "utf8",
  );
  assert.ok(stepText.trim().length > 0, "design_review step prompt is non-empty");
  assert.ok(
    stepText.includes("design-review-complete"),
    "design_review step references design-review-complete as the real recorder",
  );
  assert.ok(
    !stepText.includes("records the `## Design Review` section"),
    "design_review step must not instruct recording a phantom Design Review section",
  );
  const normalized = stepText.replace(/\s+/g, " ");
  assert.ok(
    normalized.includes("denies process spawning"),
    "design_review step includes the spawn-denial guidance",
  );
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
