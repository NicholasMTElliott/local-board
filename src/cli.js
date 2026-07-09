import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  appendTicketComment,
  approveInline,
  archiveDoneTickets,
  beginStep,
  blockTicket,
  collectComments,
  completeStep,
  composeExecutor,
  createTicket,
  discover,
  findTicket,
  getSectionText,
  linkParent,
  moveTicket,
  nextTicket,
  parseScalar,
  queryNext,
  queryReady,
  queryTicket,
  recordGateConsultation,
  recordGateSkippedEmptyCatalog,
  schemaRecord,
  setTicketField,
  setTicketSection,
  stateReport,
  suggestCalibration,
  TICKET_ID_RE,
  ticketRecord,
  unblockTicket,
  unlinkParent,
  validate,
} from "./tickets.js";
import { assertAutoMergeReady, autoMergeTicketBranch, startTicketWork } from "./git.js";
import { checkDispatch } from "./active-steps.js";
import { translateCodexDispatch } from "./codex-dispatch.js";
import { loadConfig, OPTIONAL_STEP_STAGES } from "./config.js";
import { runInstall } from "./install.js";
import { initProject, packagedResourceDir } from "./scaffold.js";
import {
  addTicketWorktree,
  assertInvocationRootForTicket,
  fastForwardDefaultBranch,
  listTicketWorktrees,
  removeTicketWorktree,
} from "./worktrees.js";
import { resolveMaxTeammates } from "./team.js";

export { commandWhere };

export async function main(argv) {
  const args = [...argv];

  try {
    const root = takeOption(args, "--root") ?? ".";
    const allowMainRoot = takeFlag(args, "--allow-main-root");
    const command = args.shift();

    if (command === "--version" || command === "version") {
      console.log(await readPackageVersion());
      return 0;
    }
    if (command === "where") {
      return await commandWhere(root, args);
    }
    if (command === "validate") {
      return await commandValidate(root, args);
    }
    if (command === "list") {
      return await commandList(root, args);
    }
    if (command === "next") {
      return await commandNext(root, args);
    }
    if (command === "query-next") {
      return await commandQueryNext(root, args);
    }
    if (command === "query-ticket") {
      return await commandQueryTicket(root, args);
    }
    if (command === "state-report" || command === "report") {
      return await commandStateReport(root, args);
    }
    if (command === "schema") {
      return await commandSchema(root, args);
    }
    if (command === "create") {
      return await commandCreate(root, args);
    }
    if (command === "start-work" || command === "ensure-branch") {
      return await commandStartWork(root, args, allowMainRoot);
    }
    if (command === "worktree-add") {
      return await commandWorktreeAdd(root, args);
    }
    if (command === "worktree-remove") {
      return await commandWorktreeRemove(root, args);
    }
    if (command === "worktree-list") {
      return await commandWorktreeList(root, args);
    }
    if (command === "fast-forward") {
      return await commandFastForward(root, args);
    }
    if (command === "team-config") {
      return await commandTeamConfig(root, args);
    }
    if (command === "begin-step") {
      return await commandBeginStep(root, args);
    }
    if (command === "complete-step") {
      return await commandCompleteStep(root, args, allowMainRoot);
    }
    if (command === "approve-inline") {
      return await commandApproveInline(root, args, allowMainRoot);
    }
    if (command === "check-dispatch") {
      return await commandCheckDispatch(root, args);
    }
    if (command === "init") {
      return await commandInit(root, args);
    }
    if (command === "install") {
      return await commandInstall(root, args);
    }
    if (command === "move") {
      return await commandMove(root, args, allowMainRoot);
    }
    if (command === "set" || command === "update-field") {
      return await commandSet(root, args, allowMainRoot);
    }
    if (command === "comment") {
      return await commandComment(root, args, allowMainRoot);
    }
    if (command === "comments") {
      return await commandComments(root, args);
    }
    if (command === "section" || command === "set-section") {
      return await commandSection(root, args, allowMainRoot);
    }
    if (command === "link-parent") {
      return await commandLinkParent(root, args, allowMainRoot);
    }
    if (command === "link-child") {
      return await commandLinkChild(root, args, allowMainRoot);
    }
    if (command === "unlink-parent") {
      return await commandUnlinkParent(root, args, allowMainRoot);
    }
    if (command === "block") {
      return await commandBlock(root, args, allowMainRoot);
    }
    if (command === "unblock") {
      return await commandUnblock(root, args, allowMainRoot);
    }
    if (command === "estimate") {
      return await commandEstimate(root, args, allowMainRoot);
    }
    if (command === "gate-check") {
      return await commandGateCheck(root, args, allowMainRoot);
    }
    if (command === "gate-complete") {
      return await commandGateComplete(root, args, allowMainRoot);
    }
    if (command === "specialty-run") {
      return await commandSpecialtyRun(root, args);
    }
    if (command === "calibration") {
      const sub = args.shift();
      if (sub === "suggest") {
        return await commandCalibrationSuggest(root, args);
      }
      throw new Error(`unknown calibration subcommand: ${sub ?? "(missing)"}`);
    }

    printUsage();
    return command === undefined ? 2 : 2;
  } catch (error) {
    console.error(error.message);
    return 2;
  }
}

// Reads the package `version` field via new URL("../package.json",
// import.meta.url), which resolves in both layouts this file ships in:
// the repo checkout (<root>/src/cli.js -> <root>/package.json) and the
// flattened runtime copy the installer writes (~/.local-board/src/cli.js ->
// ~/.local-board/package.json, since install.js copies package.json to the
// install dir root and src/ beneath it). Never depends on process.cwd().
//
// `packageRoot`, when supplied, overrides the self-located root (test seam
// for `where`, mirroring `packagedResourceDir`'s override parameter).
async function readPackageVersion(packageRoot) {
  const contents = packageRoot
    ? await readFile(path.join(packageRoot, "package.json"), "utf8")
    : await readFile(new URL("../package.json", import.meta.url), "utf8");
  return JSON.parse(contents).version;
}

// Resolves the running CLI's own package root, the same seam readPackageVersion
// uses: fileURLToPath(new URL("..", import.meta.url)) from this file's own
// location. Correct under every install mode because the CLI invoked on PATH
// (global npm install, npm link, dev clone) is always co-located with its own
// assets -- unlike the separate, flattened ~/.local-board runtime copy, which
// `where` deliberately does not resolve against (see ticket T20260707T1322Z).
function selfPackageRoot() {
  return path.resolve(fileURLToPath(new URL("..", import.meta.url)));
}

// The Codex executor-prompt directory for a given package root. Single seam
// so `where` and `begin-step --harness codex` agree; never resolve a second,
// divergent path.
function agentsDirFor(packageRoot) {
  return path.join(packageRoot, "agents", "codex");
}

// Reports the running CLI's own asset locations: version, package root,
// packaged prompts/templates dirs (dual-layout aware via packagedResourceDir),
// and the Codex executor-prompt dir. `packageRoot`, when supplied, overrides
// self-location -- a test seam for exercising both the layered (dev clone /
// npm global) and flattened (~/.local-board runtime) layouts hermetically
// against fixtures.
async function commandWhere(root, args, packageRootOverride) {
  const asJson = takeFlag(args, "--json");
  ensureNoArgs(args);

  const packageRoot = packageRootOverride ?? selfPackageRoot();
  const version = await readPackageVersion(packageRoot);
  const promptsDir = packagedResourceDir("prompts", packageRoot);
  const templatesDir = packagedResourceDir("templates", packageRoot);
  const agentsDir = agentsDirFor(packageRoot);

  const result = { version, packageRoot, promptsDir, templatesDir, agentsDir };

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`version: ${result.version}`);
    console.log(`packageRoot: ${result.packageRoot}`);
    console.log(`promptsDir: ${result.promptsDir}`);
    console.log(`templatesDir: ${result.templatesDir}`);
    console.log(`agentsDir: ${result.agentsDir}`);
  }

  return 0;
}

async function commandValidate(root, args) {
  const asJson = takeFlag(args, "--json");
  ensureNoArgs(args);

  const board = await discover(root);
  const config = await loadConfig(root);
  const issues = validate(board, config);

  if (asJson) {
    console.log(JSON.stringify({ ok: issues.length === 0, issues }, null, 2));
  } else if (issues.length === 0) {
    console.log("Ticket validation OK");
  } else {
    for (const issue of issues) {
      console.error(issue);
    }
  }

  return issues.length === 0 ? 0 : 1;
}

async function commandList(root, args) {
  const asJson = takeFlag(args, "--json");
  const ready = takeFlag(args, "--ready");
  const status = takeOption(args, "--status");
  const limit = parseLimit(takeOption(args, "--limit"));
  ensureNoArgs(args);

  if (ready) {
    const records = (await queryReady(root))
      .filter((record) => status === undefined || record.status === status)
      .slice(0, limit ?? undefined);

    if (asJson) {
      console.log(JSON.stringify(records.map(readyListJsonRecord), null, 2));
    } else {
      for (const record of records) {
        console.log(`${record.ticket} ${record.priority} ${record.status} ${record.path} ${record.title}`);
      }
    }

    return 0;
  }

  const board = await discover(root);
  const records = board.tickets
    .filter((ticket) => status === undefined || ticket.status === status)
    .map((ticket) => ticketRecord(root, ticket))
    .slice(0, limit ?? undefined);

  if (asJson) {
    console.log(JSON.stringify(records, null, 2));
  } else {
    for (const record of records) {
      console.log(`${record.id} ${record.priority} ${record.status} ${record.path} ${record.title}`);
    }
  }

  return 0;
}

function readyListJsonRecord(record) {
  return {
    id: record.ticket,
    type: record.type,
    status: record.status,
    priority: record.priority,
    branch: record.branch,
    title: record.title,
    path: record.path,
    action: record.action,
  };
}

async function commandNext(root, args) {
  const asJson = takeFlag(args, "--json");
  ensureNoArgs(args);

  const board = await discover(root);
  const ticket = nextTicket(board);

  if (ticket === null) {
    console.log(asJson ? "null" : "No eligible ticket");
    return 1;
  }

  const record = ticketRecord(root, ticket);
  if (asJson) {
    console.log(JSON.stringify(record, null, 2));
  } else {
    console.log(`${record.id} ${record.priority} ${record.status} ${record.path} ${record.title}`);
  }

  return 0;
}

async function commandQueryNext(root, args) {
  const asJson = takeFlag(args, "--json");
  ensureNoArgs(args);

  const result = await queryNext(root);
  if (result === null) {
    console.log(asJson ? "null" : "No eligible ticket");
    return 1;
  }

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${result.path}: ${result.action}`);
  }

  return 0;
}

async function commandQueryTicket(root, args) {
  const asJson = takeFlag(args, "--json");
  const ticketId = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined) {
    throw new Error("query-ticket requires: <ticket-id>");
  }

  const result = await queryTicket(root, ticketId);
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${result.path}: ${result.action ?? "no-action"}`);
  }
  return 0;
}

async function commandStateReport(root, args) {
  const asJson = takeFlag(args, "--json");
  ensureNoArgs(args);

  const report = await stateReport(root);
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Tickets: ${report.total}`);
    console.log(`Eligible: ${report.eligible}`);
    console.log(`Valid: ${report.ok ? "yes" : "no"}`);
    if (report.next !== null) {
      console.log(`Next: ${report.next.path}: ${report.next.action}`);
    }
  }
  return report.ok ? 0 : 1;
}

async function commandSchema(root, args) {
  const asJson = takeFlag(args, "--json");
  ensureNoArgs(args);

  const schema = await schemaRecord(root);
  if (asJson) {
    console.log(JSON.stringify(schema, null, 2));
  } else {
    console.log(`Config: ${schema.configPath}`);
    console.log(`Statuses: ${schema.statuses.join(", ")}`);
    console.log(`Trigger statuses: ${schema.triggerStatuses.join(", ")}`);
    console.log(`Actions: ${schema.actions.join(", ")}`);
    console.log(`Agent values: ${schema.agentValues.join(", ")}`);
  }
  return 0;
}

async function commandCreate(root, args) {
  const status = takeOption(args, "--status") ?? "backlog";
  const priority = takeOption(args, "--priority") ?? "P2";
  const parent = takeOption(args, "--parent") ?? null;
  const ticketType = args.shift();
  const title = args.shift();
  ensureNoArgs(args);

  if (ticketType === undefined || title === undefined) {
    throw new Error("create requires: <type> <title>");
  }

  const ticketPath = await createTicket(root, ticketType, title, { status, priority, parent });
  console.log(ticketPath);
  return 0;
}

async function commandStartWork(root, args, allowMainRoot) {
  const asJson = takeFlag(args, "--json");
  const allowDirty = takeFlag(args, "--allow-dirty");
  const branch = takeOption(args, "--branch");
  const ticketId = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined) {
    throw new Error("start-work requires: <ticket-id> [--branch <branch>] [--allow-dirty] [--allow-main-root]");
  }

  await assertInvocationRootForTicket(root, ticketId, { allowMainRoot });

  const result = await startTicketWork(root, ticketId, { branch, allowDirty });
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${result.ticket} ${result.branch} ${result.gitAction} ${result.path}`);
  }
  return 0;
}

async function commandWorktreeAdd(root, args) {
  const asJson = takeFlag(args, "--json");
  const ticketId = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined) {
    throw new Error("worktree-add requires: <ticket-id> [--json]");
  }

  const result = await addTicketWorktree(root, ticketId);
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `${result.ticketId} ${result.branch} ${result.created ? "created" : "existing"} ${result.worktreePath}`,
    );
  }
  return 0;
}

async function commandWorktreeRemove(root, args) {
  const asJson = takeFlag(args, "--json");
  const force = takeFlag(args, "--force");
  const ticketId = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined) {
    throw new Error("worktree-remove requires: <ticket-id> [--force] [--json]");
  }

  const result = await removeTicketWorktree(root, ticketId, { force });
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${result.ticketId} ${result.removed ? "removed" : "not-found"} ${result.worktreePath}`);
  }
  return 0;
}

async function commandWorktreeList(root, args) {
  const asJson = takeFlag(args, "--json");
  ensureNoArgs(args);

  const result = await listTicketWorktrees(root);
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const record of result) {
      console.log(`${record.ticketId} ${record.branch ?? "(detached)"} ${record.locked ? "locked" : "unlocked"} ${record.worktreePath}`);
    }
  }
  return 0;
}

async function commandFastForward(root, args) {
  const asJson = takeFlag(args, "--json");
  ensureNoArgs(args);

  const config = await loadConfig(root);
  const result = await fastForwardDefaultBranch(root, { defaultBranch: config.git.defaultBranch });
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${result.defaultBranch} ${result.advanced ? "advanced" : "unchanged"} ${result.newHead}`);
  }
  return 0;
}

async function commandTeamConfig(root, args) {
  const asJson = takeFlag(args, "--json");
  ensureNoArgs(args);

  const result = resolveMaxTeammates(process.env);
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const suffix = result.source === "env" ? `(from ${result.envVar})` : `(default; ${result.envVar} unset or invalid)`;
    console.log(`maxTeammates ${result.maxTeammates} ${suffix}`);
  }
  return 0;
}

async function commandBeginStep(root, args) {
  const asJson = takeFlag(args, "--json");
  const action = takeOption(args, "--action") ?? null;
  const harness = takeOption(args, "--harness") ?? "claude";
  const ticketId = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined) {
    throw new Error("begin-step requires: <ticket-id> [--action <action>] [--harness claude|codex] [--json]");
  }
  if (harness !== "claude" && harness !== "codex") {
    throw new Error(`--harness must be "claude" or "codex", got: ${harness}`);
  }

  const result = await beginStep(root, ticketId, action);

  // `--harness codex` splices an additive `codexDispatch` block onto the
  // already-computed result as CLI post-processing; beginStep's return shape
  // and its ledger stamp (logical route/model) are untouched (design decision
  // 5 in T20260707T1335Z). Default `--harness claude` (or no flag) is
  // byte-for-byte identical to before this flag existed.
  if (harness === "codex") {
    const agentsDir = agentsDirFor(selfPackageRoot());
    result.codexDispatch = translateCodexDispatch({
      route: result.configuredAgent,
      model: result.configuredModel,
      prompt: result.configuredPrompt,
      agentsDir,
    });
  }

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const model = result.configuredModel ? `@${result.configuredModel}` : "";
    console.log(`${result.ticket} ${result.action} ${result.configuredAgent}${model}`);
    if (result.codexDispatch) {
      const cd = result.codexDispatch;
      console.log(`codexDispatch: ${cd.dispatchKind} ${cd.agentType ?? "-"} ${cd.promptPath ?? "-"} ${cd.evidenceExecutor}`);
    }
  }
  return 0;
}

async function commandCompleteStep(root, args, allowMainRoot) {
  const asJson = takeFlag(args, "--json");
  const executor = takeOption(args, "--executor");
  const model = takeOption(args, "--model");
  const evidence = takeOption(args, "--evidence");
  const override = takeFlag(args, "--override");
  const reason = takeOption(args, "--reason");
  const ticketId = args.shift();
  const action = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined || action === undefined || executor === undefined || evidence === undefined) {
    throw new Error(
      "complete-step requires: <ticket-id> <action> --executor <executor> [--model <model>] --evidence <text> " +
        "[--override --reason <text>] [--allow-main-root]",
    );
  }
  if (override && (reason === undefined || reason.trim() === "")) {
    throw new Error("complete-step --override requires --reason <text>");
  }

  await assertInvocationRootForTicket(root, ticketId, { allowMainRoot });

  const composedExecutor = composeExecutor(executor, model);
  const result = await completeStep(root, ticketId, action, composedExecutor, evidence, {
    override,
    overrideReason: reason,
  });
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${result.ticket} ${result.action} ${result.executor} ${result.path}`);
  }
  return 0;
}

async function commandApproveInline(root, args, allowMainRoot) {
  const asJson = takeFlag(args, "--json");
  const reason = takeOption(args, "--reason");
  const executor = takeOption(args, "--executor") ?? "inline";
  const ticketId = args.shift();
  const action = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined || action === undefined || reason === undefined) {
    throw new Error("approve-inline requires: <ticket-id> <action> --reason <text> [--executor <executor>] [--allow-main-root]");
  }

  await assertInvocationRootForTicket(root, ticketId, { allowMainRoot });

  const result = await approveInline(root, ticketId, action, reason, { executor });
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${result.ticket} ${result.action} ${result.approvedExecutor} ${result.path}`);
  }
  return 0;
}

async function commandCheckDispatch(root, args) {
  // check-dispatch always prints a JSON verdict (the hook needs a stable,
  // parseable contract); --json is accepted as a no-op for CLI consistency.
  takeFlag(args, "--json");
  const agent = takeOption(args, "--agent");
  const model = takeOption(args, "--model");
  const ticketId = takeOption(args, "--ticket");
  ensureNoArgs(args);

  if (agent === undefined || agent.trim() === "") {
    throw new Error("check-dispatch requires: --agent <subagent-type> [--model <model>] [--ticket <ticket-id>] [--json]");
  }

  try {
    const verdict = await checkDispatch(root, { agent, model, ticketId });
    console.log(JSON.stringify(verdict.body, null, 2));
    return verdict.code;
  } catch (error) {
    // check-dispatch is a hook contract: stdout must always carry a parseable
    // JSON verdict, even when the ledger read itself throws (e.g. a corrupt
    // active-steps.json). Surface the error on stdout as { ok: false } rather
    // than letting it propagate to the generic CLI catch (stderr-only).
    console.log(JSON.stringify({ ok: false, reason: "error", error: error.message }, null, 2));
    return 2;
  }
}

async function commandInit(root, args) {
  const overwrite = takeFlag(args, "--overwrite");
  const asJson = takeFlag(args, "--json");
  ensureNoArgs(args);

  const result = await initProject(root, { overwrite });
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Initialized local-board at ${result.root}`);
    console.log(`Created ${result.created.length} file(s); skipped ${result.skipped.length} existing file(s).`);
  }
  return 0;
}

async function commandInstall(root, args) {
  // The installer operates on the user HOME, not the board root; --root has
  // no effect here (see printUsage).
  return runInstall(args, {});
}

async function commandMove(root, args, allowMainRoot) {
  const asJson = takeFlag(args, "--json");
  const override = takeFlag(args, "--override");
  const reason = takeOption(args, "--reason");
  const ticketId = args.shift();
  const status = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined || status === undefined) {
    throw new Error("move requires: <ticket-id> <status> [--override] [--reason <text>] [--allow-main-root]");
  }

  await assertInvocationRootForTicket(root, ticketId, { allowMainRoot });

  const overrideTransition = override ? { reason } : undefined;
  await moveAndMaybeMerge(root, ticketId, status, { asJson, overrideTransition });
  return 0;
}

async function commandSet(root, args, allowMainRoot) {
  const override = takeFlag(args, "--override");
  const reason = takeOption(args, "--reason");
  const ticketId = args.shift();
  const field = args.shift();
  const rawValue = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined || field === undefined || rawValue === undefined) {
    throw new Error("set requires: <ticket-id> <field> <value> [--override] [--reason <text>] [--allow-main-root]");
  }

  await assertInvocationRootForTicket(root, ticketId, { allowMainRoot });

  const value = parseScalar(rawValue);
  if (field === "status") {
    const overrideTransition = override ? { reason } : undefined;
    await moveAndMaybeMerge(root, ticketId, String(value), { asJson: false, overrideTransition });
    return 0;
  }

  const ticketPath = await setTicketField(root, ticketId, field, value);
  console.log(ticketPath);
  return 0;
}

async function moveAndMaybeMerge(root, ticketId, status, options = {}) {
  const config = await loadConfig(root);
  const shouldAutoMerge = status === "done" && config.git.autoMerge === true;
  const shouldArchiveDone = status === "done" && config.retention?.archiveOnMoveDone === true;
  if (shouldAutoMerge) {
    await assertAutoMergeReady(root, ticketId, { defaultBranch: config.git.defaultBranch });
  }

  const ticketPath = await moveTicket(root, ticketId, status, { overrideTransition: options.overrideTransition });
  const archived = shouldArchiveDone
    ? await archiveDoneTickets(root, {
        archiveDoneAfterDays: config.retention.archiveDoneAfterDays,
        excludeIds: [ticketId],
      })
    : [];
  const merge = shouldAutoMerge
    ? await autoMergeTicketBranch(root, ticketId, {
        commitPlanningChanges: config.git.commitPlanningChanges,
        defaultBranch: config.git.defaultBranch,
        pruneMergedBranches: config.git.pruneMergedBranches,
      })
    : null;

  if (options.asJson) {
    console.log(JSON.stringify({ path: ticketPath, archived, autoMerge: merge }, null, 2));
  } else {
    console.log(ticketPath);
    for (const archivedTicket of archived) {
      console.log(`Archived ${archivedTicket.ticket} ${archivedTicket.path}`);
    }
    if (merge !== null) {
      console.log(`Merged ${merge.branch} into ${merge.defaultBranch}`);
    }
  }
}

async function commandComment(root, args, allowMainRoot) {
  const markerFlags = takeAllOptions(args, "--marker");
  const section = takeOption(args, "--section") ?? "Run Log";
  const ticketId = args.shift();
  const text = args.join(" ").trim();

  if (ticketId === undefined || text === "") {
    throw new Error(
      "comment requires: <ticket-id> <text> [--marker key=value ...] [--section <section>] [--allow-main-root]",
    );
  }

  await assertInvocationRootForTicket(root, ticketId, { allowMainRoot });

  const markers = parseMarkerFlags(markerFlags);
  const ticketPath = await appendTicketComment(root, ticketId, section, text, { markers });
  console.log(ticketPath);
  return 0;
}

// Read-only counterpart to `comment`: lists and filters the parsed Run
// Log-style comments on one ticket. No `assertInvocationRootForTicket` call
// (that guard is only for mutations) and no lock/write of any kind, matching
// `query-ticket`/`state-report`.
async function commandComments(root, args) {
  const asJson = takeFlag(args, "--json");
  const markerFlags = takeAllOptions(args, "--marker");
  const section = takeOption(args, "--section") ?? null;
  const ticketId = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined) {
    throw new Error("comments requires: <ticket-id> [--section <name>] [--marker key=value ...] [--json]");
  }

  const markers = parseMarkerFlags(markerFlags);
  const { ticket } = await findTicket(root, ticketId);
  const records = collectComments(ticket, { section, markers });

  if (asJson) {
    console.log(JSON.stringify(records, null, 2));
  } else {
    printCommentsHuman(records);
  }
  return 0;
}

// Groups already-filtered records by section (in document order, using each
// section's first appearance in the filtered set to fix its group position)
// and prints them as `<Section>\n- <ts> [markers] <body>`, one blank line
// between groups. A section with no matching records is never printed;
// nothing is printed at all when records is empty (still exit 0).
function printCommentsHuman(records) {
  const bySection = new Map();
  for (const record of records) {
    if (!bySection.has(record.section)) {
      bySection.set(record.section, []);
    }
    bySection.get(record.section).push(record);
  }

  let first = true;
  for (const [sectionName, sectionRecords] of bySection) {
    if (!first) {
      console.log("");
    }
    first = false;
    console.log(sectionName);
    for (const record of sectionRecords) {
      const markerSegment =
        record.markers.length === 0
          ? ""
          : `[${record.markers.map((marker) => `${marker.key}:${marker.value}`).join(" ")}] `;
      console.log(`- ${record.timestamp} ${markerSegment}${record.body}`);
    }
  }
}

async function commandSection(root, args, allowMainRoot) {
  const section = takeOption(args, "--section");
  const file = takeOption(args, "--file");
  const ticketId = args.shift();
  const inlineText = args.join(" ").trim();

  if (ticketId === undefined || section === undefined) {
    throw new Error("section requires: <ticket-id> (<text>|--file <path>) --section <section> [--allow-main-root]");
  }
  if (file !== undefined && inlineText !== "") {
    throw new Error("section accepts either <text> or --file <path>, not both");
  }

  await assertInvocationRootForTicket(root, ticketId, { allowMainRoot });

  const text = file === undefined ? inlineText : await readFile(file, "utf8");
  if (text.trim() === "") {
    throw new Error("section requires non-empty text from <text> or --file <path>");
  }

  const ticketPath = await setTicketSection(root, ticketId, section, text);
  console.log(ticketPath);
  return 0;
}

async function commandLinkParent(root, args, allowMainRoot) {
  const childId = args.shift();
  const parentId = args.shift();
  ensureNoArgs(args);

  if (childId === undefined || parentId === undefined) {
    throw new Error("link-parent requires: <child-ticket-id> <parent-ticket-id> [--allow-main-root]");
  }

  await assertInvocationRootForTicket(root, childId, { allowMainRoot });
  await assertInvocationRootForTicket(root, parentId, { allowMainRoot });

  const result = await linkParent(root, childId, parentId);
  console.log(`${result.childPath}\n${result.parentPath}`);
  return 0;
}

async function commandLinkChild(root, args, allowMainRoot) {
  const parentId = args.shift();
  const childId = args.shift();
  ensureNoArgs(args);

  if (parentId === undefined || childId === undefined) {
    throw new Error("link-child requires: <parent-ticket-id> <child-ticket-id> [--allow-main-root]");
  }

  await assertInvocationRootForTicket(root, parentId, { allowMainRoot });
  await assertInvocationRootForTicket(root, childId, { allowMainRoot });

  const result = await linkParent(root, childId, parentId);
  console.log(`${result.parentPath}\n${result.childPath}`);
  return 0;
}

async function commandUnlinkParent(root, args, allowMainRoot) {
  const childId = args.shift();
  const parentId = args.shift();
  ensureNoArgs(args);

  if (childId === undefined || parentId === undefined) {
    throw new Error("unlink-parent requires: <child-ticket-id> <parent-ticket-id> [--allow-main-root]");
  }

  await assertInvocationRootForTicket(root, childId, { allowMainRoot });
  await assertInvocationRootForTicket(root, parentId, { allowMainRoot });

  const result = await unlinkParent(root, childId, parentId);
  console.log(`${result.childPath}\n${result.parentPath}`);
  return 0;
}

async function commandBlock(root, args, allowMainRoot) {
  const ticketId = args.shift();
  const dependencyId = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined || dependencyId === undefined) {
    throw new Error("block requires: <ticket-id> <dependency-ticket-id> [--allow-main-root]");
  }

  await assertInvocationRootForTicket(root, ticketId, { allowMainRoot });
  await assertInvocationRootForTicket(root, dependencyId, { allowMainRoot });

  const result = await blockTicket(root, ticketId, dependencyId);
  console.log(`${result.ticketPath}\n${result.dependencyPath}`);
  return 0;
}

async function commandUnblock(root, args, allowMainRoot) {
  const ticketId = args.shift();
  const dependencyId = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined || dependencyId === undefined) {
    throw new Error("unblock requires: <ticket-id> <dependency-ticket-id> [--allow-main-root]");
  }

  await assertInvocationRootForTicket(root, ticketId, { allowMainRoot });
  await assertInvocationRootForTicket(root, dependencyId, { allowMainRoot });

  const result = await unblockTicket(root, ticketId, dependencyId);
  console.log(`${result.ticketPath}\n${result.dependencyPath}`);
  return 0;
}

async function commandEstimate(root, args, allowMainRoot) {
  const basisOption = takeOption(args, "--basis");
  const force = takeFlag(args, "--force");
  const asJson = takeFlag(args, "--json");
  const ticketId = args.shift();
  const rawPoints = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined || rawPoints === undefined) {
    throw new Error("estimate requires: <ticket-id> <points> [--basis <ticket-id-or-bootstrap>] [--force] [--json] [--allow-main-root]");
  }

  await assertInvocationRootForTicket(root, ticketId, { allowMainRoot });

  const trimmedPoints = rawPoints.trim();
  if (trimmedPoints === "") {
    throw new Error("estimate: <points> must be an integer");
  }
  const parsedPoints = Number.parseInt(trimmedPoints, 10);
  if (Number.isNaN(parsedPoints) || String(parsedPoints) !== trimmedPoints) {
    throw new Error("estimate: <points> must be an integer");
  }

  const config = await loadConfig(root);
  const scale = config.estimation.scale;
  if (!scale.includes(parsedPoints)) {
    throw new Error(`estimate: ${parsedPoints} is not in estimation.scale [${scale.join(", ")}]`);
  }

  if (basisOption !== undefined && basisOption !== "bootstrap") {
    if (!TICKET_ID_RE.test(basisOption)) {
      throw new Error('estimate: --basis must be "bootstrap" or a ticket id matching [ESBT]yyyyMMddTHHmmZ');
    }
    await findTicket(root, basisOption);
  }

  const { ticket } = await findTicket(root, ticketId);
  const currentEstimate = ticket.frontMatter.estimate ?? null;
  if (currentEstimate !== null && !force) {
    throw new Error(`estimate: ticket ${ticketId} already has estimate ${currentEstimate}; pass --force to overwrite`);
  }

  const effectiveBasis = basisOption ?? "bootstrap";
  const pointsValue = String(parsedPoints);

  await setTicketField(root, ticketId, "estimate", pointsValue);
  const ticketPath = await setTicketField(root, ticketId, "estimateBasis", effectiveBasis);

  if (asJson) {
    console.log(JSON.stringify({ path: ticketPath, estimate: parsedPoints, estimateBasis: effectiveBasis }, null, 2));
  } else {
    console.log(ticketPath);
  }
  return 0;
}

// Verifies a resolved prompt path exists before it is handed to a dispatched
// agent as a `prompt` field. Boards initialized before prompt scaffolding
// covered the full resources/prompts tree (or that have since deleted a
// prompt file) would otherwise hand back a dead path; fail loudly instead
// with the remedy (re-run init, or restore the file from packaged
// resources/prompts).
async function assertPromptExists(promptPath, action) {
  try {
    await access(promptPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        `${action}: prompt not found at ${promptPath}. Run "local-board init" in this repo to scaffold missing prompts, or restore the file from the packaged resources/prompts.`,
      );
    }
    throw error;
  }
}

async function commandGateCheck(root, args, allowMainRoot) {
  const asJson = takeFlag(args, "--json");
  const stage = takeOption(args, "--stage");
  const ticketId = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined || stage === undefined) {
    throw new Error("gate-check requires: <ticket-id> --stage <stage> [--allow-main-root] [--json]");
  }
  if (!OPTIONAL_STEP_STAGES.includes(stage)) {
    throw new Error(`gate-check --stage must be one of ${OPTIONAL_STEP_STAGES.join(", ")}`);
  }

  // Guarded before the empty-catalog auto-stamp branch below (which mutates
  // the ticket via recordGateSkippedEmptyCatalog): a wrong-root invocation
  // must be refused before any write, not just on the non-empty read path.
  await assertInvocationRootForTicket(root, ticketId, { allowMainRoot });

  const config = await loadConfig(root);
  const { ticket } = await findTicket(root, ticketId);

  const catalog = (config.optionalSteps?.[stage] ?? []).map((entry) => {
    const normalized = {
      name: entry.name,
      prompt: entry.prompt,
      triggers: entry.triggers,
    };
    if (Object.hasOwn(entry, "agent")) {
      normalized.agent = entry.agent;
    }
    return normalized;
  });

  const promptPath = path.resolve(root, "plans", "prompts", "steps", "gate-check.md");
  // Only verify the prompt exists when a dispatch will actually occur: an
  // empty catalog for this stage means gate-check.md is never opened, so a
  // missing file here must not fail what would otherwise be a legitimate
  // empty-catalog result.
  const skip = catalog.length === 0;
  let recorded = null;
  if (!skip) {
    await assertPromptExists(promptPath, "gate-check");
  } else {
    // Empty-catalog branch: the CLI itself has deterministically established
    // there is nothing to consult, so it self-certifies the consultation by
    // stamping gate:<stage>:skipped-empty-catalog. Idempotent (addUnique), so
    // a re-run is safe and dispatches no agent (B1320). Echo the exact
    // stamped token back on the wire, sourced from the recorder's return
    // value so it cannot drift from what was actually written.
    const skipResult = await recordGateSkippedEmptyCatalog(root, ticket.id, stage);
    recorded = skipResult.token;
  }

  const baseRecord = ticketRecord(root, ticket);
  const currentAction = config.workflow?.statusActions?.[ticket.status] ?? null;
  const ticketContext = {
    id: baseRecord.id,
    type: baseRecord.type,
    status: baseRecord.status,
    priority: baseRecord.priority,
    path: baseRecord.path,
    title: baseRecord.title,
    currentAction,
    requirement: getSectionText(ticket.body, "Requirement") ?? "",
    acceptanceCriteria: getSectionText(ticket.body, "Acceptance Criteria") ?? "",
  };

  const gateProfile = config.agents?.["gate-check"] ?? { route: "inline" };
  const payload = {
    ticket: ticket.id,
    stage,
    prompt: promptPath,
    agent: gateProfile.route,
    model: gateProfile.model ?? null,
    ticketPath: ticket.path,
    ticketContext,
    catalog,
    skip,
    recorded,
  };

  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    const gateModel = gateProfile.model ? `@${gateProfile.model}` : "";
    console.log(`gate-check ${ticket.id} stage=${stage} agent=${gateProfile.route}${gateModel} catalog=${catalog.length}`);
    console.log(promptPath);
    for (const entry of catalog) {
      console.log(`- ${entry.name}: ${entry.triggers}`);
    }
    if (skip) {
      console.log(`skip: empty catalog — recorded ${recorded} (no dispatch)`);
    }
  }
  return 0;
}

async function commandGateComplete(root, args, allowMainRoot) {
  const asJson = takeFlag(args, "--json");
  const stage = takeOption(args, "--stage");
  const executor = takeOption(args, "--executor");
  const model = takeOption(args, "--model");
  const evidence = takeOption(args, "--evidence") ?? "none";
  const ticketId = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined || stage === undefined || executor === undefined) {
    throw new Error(
      "gate-complete requires: <ticket-id> --stage <stage> --executor <executor> [--model <model>] [--evidence <text>] [--allow-main-root]",
    );
  }
  if (!OPTIONAL_STEP_STAGES.includes(stage)) {
    throw new Error(`gate-complete --stage must be one of ${OPTIONAL_STEP_STAGES.join(", ")}`);
  }

  await assertInvocationRootForTicket(root, ticketId, { allowMainRoot });

  const composedExecutor = composeExecutor(executor, model);
  const result = await recordGateConsultation(root, ticketId, stage, composedExecutor, evidence);
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${result.ticket} ${result.stage} ${result.executor} ${result.path}`);
  }
  return 0;
}

async function commandSpecialtyRun(root, args) {
  const asJson = takeFlag(args, "--json");
  const ticketId = args.shift();
  const stepName = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined || stepName === undefined) {
    throw new Error("specialty-run requires: <ticket-id> <step-name> [--json]");
  }

  const config = await loadConfig(root);
  const { ticket } = await findTicket(root, ticketId);

  const stage = statusToStage(ticket.status);
  if (stage === null) {
    throw new Error(
      `specialty-run: status ${ticket.status} has no specialty stage (expected designing, ready_for_design, implementing, ready_for_implementation, testing, or ready_for_test)`,
    );
  }

  const catalog = config.optionalSteps?.[stage] ?? [];
  const entry = catalog.find((candidate) => candidate.name === stepName);
  if (entry === undefined) {
    const available = catalog.length === 0 ? "none" : catalog.map((c) => c.name).join(", ");
    throw new Error(
      `specialty-run: step ${stepName} not found in optionalSteps.${stage} (available: ${available})`,
    );
  }

  const promptPath = path.resolve(root, entry.prompt);
  await assertPromptExists(promptPath, "specialty-run");
  const agent = Object.hasOwn(entry, "agent") ? entry.agent : "inline";

  const baseRecord = ticketRecord(root, ticket);
  const currentAction = config.workflow?.statusActions?.[ticket.status] ?? null;
  const ticketContext = {
    id: baseRecord.id,
    type: baseRecord.type,
    status: baseRecord.status,
    priority: baseRecord.priority,
    path: baseRecord.path,
    title: baseRecord.title,
    currentAction,
    requirement: getSectionText(ticket.body, "Requirement") ?? "",
    acceptanceCriteria: getSectionText(ticket.body, "Acceptance Criteria") ?? "",
  };

  const payload = {
    ticket: ticket.id,
    stage,
    step: entry.name,
    prompt: promptPath,
    agent,
    ticketPath: ticket.path,
    ticketContext,
  };

  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`specialty-run ${ticket.id} step=${entry.name} stage=${stage} agent=${agent}`);
    console.log(promptPath);
  }
  return 0;
}

function statusToStage(status) {
  if (status === "designing" || status === "ready_for_design") {
    return "design";
  }
  if (status === "implementing" || status === "ready_for_implementation") {
    return "implement";
  }
  if (status === "testing" || status === "ready_for_test") {
    return "test";
  }
  return null;
}

async function commandCalibrationSuggest(root, args) {
  const asJson = takeFlag(args, "--json");
  const ticketId = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined) {
    throw new Error("calibration suggest requires: <ticket-id> [--json]");
  }

  const result = await suggestCalibration(root, ticketId);
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result.calibration);
  }
  return 0;
}

function takeFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return false;
  }
  args.splice(index, 1);
  return true;
}

function takeOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  if (index === args.length - 1) {
    throw new Error(`${name} requires a value`);
  }
  const value = args[index + 1];
  if (value.startsWith("--")) {
    throw new Error(`option ${name} requires a value but got ${value}`);
  }
  args.splice(index, 2);
  return value;
}

// Collect every occurrence of a repeatable option, in left-to-right order,
// splicing each name+value pair out of args. Mirrors takeOption's value
// guards but accumulates rather than returning after the first match.
function takeAllOptions(args, name) {
  const values = [];
  let index = args.indexOf(name);
  while (index !== -1) {
    if (index === args.length - 1) {
      throw new Error(`${name} requires a value`);
    }
    const value = args[index + 1];
    if (value.startsWith("--")) {
      throw new Error(`option ${name} requires a value but got ${value}`);
    }
    args.splice(index, 2);
    values.push(value);
    index = args.indexOf(name);
  }
  return values;
}

const MARKER_KEY_RE = /^[A-Za-z0-9_.-]+$/;
const MARKER_VALUE_RE = /^[A-Za-z0-9_./-]+$/;

// Validate + remap CLI key=value flags into ordered on-disk pairs. Throws an
// Error with a clear CLI message on: missing '=', empty key/value, key/value
// charset violation, or duplicate key.
function parseMarkerFlags(rawFlags) {
  const markers = [];
  const seenKeys = new Set();

  for (const raw of rawFlags) {
    const eqIndex = raw.indexOf("=");
    if (eqIndex === -1) {
      throw new Error(`--marker ${raw} must be in key=value form`);
    }
    const key = raw.slice(0, eqIndex);
    const value = raw.slice(eqIndex + 1);
    if (!MARKER_KEY_RE.test(key)) {
      throw new Error(`--marker key ${JSON.stringify(key)} must match ${MARKER_KEY_RE}`);
    }
    if (!MARKER_VALUE_RE.test(value)) {
      throw new Error(`--marker value ${JSON.stringify(value)} for key ${key} must match ${MARKER_VALUE_RE}`);
    }
    if (seenKeys.has(key)) {
      throw new Error(`--marker key ${key} was repeated; each marker key must be unique`);
    }
    seenKeys.add(key);
    markers.push({ key, value });
  }

  return markers;
}

function parseLimit(value) {
  if (value === undefined) {
    return undefined;
  }
  const limit = Number.parseInt(value, 10);
  if (Number.isNaN(limit) || !/^-?\d+$/.test(value) || limit <= 0) {
    throw new Error("--limit must be a positive integer");
  }
  return limit;
}

function ensureNoArgs(args) {
  if (args.length > 0) {
    throw new Error(`unexpected argument: ${args[0]}`);
  }
}

const USAGE_TEXT = `Usage:
  local-board --version
  local-board where [--json]
  local-board [--root <path>] validate [--json]
  local-board [--root <path>] list [--status <status>] [--ready] [--limit <N>] [--json]
  local-board [--root <path>] next [--json]
  local-board [--root <path>] query-next [--json]
  local-board [--root <path>] query-ticket <ticket-id> [--json]
  local-board [--root <path>] state-report [--json]
  local-board [--root <path>] schema [--json]
  local-board [--root <path>] init [--overwrite] [--json]
  local-board install [--target=<ids>] [--all] [--no-<id>] [--list-targets] [--uninstall] [--home <dir>] (acts on user HOME; ignores --root)
  local-board [--root <path>] create <type> <title> [--status <status>] [--priority <priority>] [--parent <id>]
  local-board [--root <path>] start-work <ticket-id> [--branch <branch>] [--allow-dirty] [--allow-main-root] [--json]
  local-board [--root <path>] worktree-add <ticket-id> [--json]
  local-board [--root <path>] worktree-remove <ticket-id> [--force] [--json]
  local-board [--root <path>] worktree-list [--json]
  local-board [--root <path>] fast-forward [--json]
  local-board team-config [--json]
  local-board [--root <path>] begin-step <ticket-id> [--action <action>] [--harness claude|codex] [--json]
  local-board [--root <path>] complete-step <ticket-id> <action> --executor <executor> [--model <model>] --evidence <text> [--override --reason <text>] [--allow-main-root] [--json]
  local-board [--root <path>] approve-inline <ticket-id> <action> --reason <text> [--executor <executor>] [--allow-main-root] [--json]
  local-board [--root <path>] check-dispatch --agent <subagent-type> [--model <model>] [--ticket <ticket-id>] [--json]
  local-board [--root <path>] move <ticket-id> <status> [--override] [--reason <text>] [--allow-main-root] [--json]
  local-board [--root <path>] set <ticket-id> <field> <value> [--override] [--reason <text>] [--allow-main-root]
  local-board [--root <path>] comment <ticket-id> <text> [--marker key=value ...] [--section <section>] [--allow-main-root]
  local-board [--root <path>] comments <ticket-id> [--section <name>] [--marker key=value ...] [--json]
  local-board [--root <path>] section <ticket-id> <text> --section <section> [--allow-main-root]
  local-board [--root <path>] section <ticket-id> --file <path> --section <section> [--allow-main-root]
  local-board [--root <path>] link-parent <child-ticket-id> <parent-ticket-id> [--allow-main-root]
  local-board [--root <path>] link-child <parent-ticket-id> <child-ticket-id> [--allow-main-root]
  local-board [--root <path>] unlink-parent <child-ticket-id> <parent-ticket-id> [--allow-main-root]
  local-board [--root <path>] block <ticket-id> <dependency-ticket-id> [--allow-main-root]
  local-board [--root <path>] unblock <ticket-id> <dependency-ticket-id> [--allow-main-root]
  local-board [--root <path>] estimate <ticket-id> <points> [--basis <ticket-id-or-bootstrap>] [--force] [--allow-main-root] [--json]
  local-board [--root <path>] gate-check <ticket-id> --stage <stage> [--allow-main-root] [--json]
  local-board [--root <path>] gate-complete <ticket-id> --stage <stage> --executor <executor> [--model <model>] [--evidence <text>] [--allow-main-root] [--json]
  local-board [--root <path>] specialty-run <ticket-id> <step-name> [--json]
  local-board [--root <path>] calibration suggest <ticket-id> [--json]

--allow-main-root overrides the wrong-root mutation guard (worktrees.guardWrongRoot)
for per-ticket commands above; it is a no-op unless the ticket has a registered
worktree and the invocation root is not that worktree.`;

function printUsage() {
  console.error(USAGE_TEXT);
}

// Test-support export: derives the authoritative command-name set from the
// same USAGE_TEXT that printUsage renders. Inert at runtime (no behavior
// change) — consumed only by test/skill-usage-sync.test.js to check that the
// curated CLI Commands blocks in SKILL.md / skills/codex/local-board/SKILL.md
// stay a subset of the real CLI surface.
export function usageCommandNames() {
  const names = [];
  for (const rawLine of USAGE_TEXT.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("local-board")) continue;
    const rest = line.slice("local-board".length).trim();
    if (!rest) continue;
    const withoutRoot = rest.replace(/^\[--root <path>\]\s*/, "");
    const match = withoutRoot.match(/^(--version|calibration suggest|[a-z][a-z-]*)/);
    if (match) names.push(match[1]);
  }
  return names;
}
