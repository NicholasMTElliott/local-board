import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  appendTicketComment,
  approveInline,
  archiveDoneTickets,
  beginStep,
  blockTicket,
  completeStep,
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
import { loadConfig, OPTIONAL_STEP_STAGES } from "./config.js";
import { runInstall } from "./install.js";
import { initProject } from "./scaffold.js";
import {
  addTicketWorktree,
  fastForwardDefaultBranch,
  listTicketWorktrees,
  removeTicketWorktree,
} from "./worktrees.js";
import { resolveMaxTeammates } from "./team.js";

export async function main(argv) {
  const args = [...argv];
  const root = takeOption(args, "--root") ?? ".";
  const command = args.shift();

  try {
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
      return await commandStartWork(root, args);
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
      return await commandCompleteStep(root, args);
    }
    if (command === "approve-inline") {
      return await commandApproveInline(root, args);
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
      return await commandMove(root, args);
    }
    if (command === "set" || command === "update-field") {
      return await commandSet(root, args);
    }
    if (command === "comment") {
      return await commandComment(root, args);
    }
    if (command === "section" || command === "set-section") {
      return await commandSection(root, args);
    }
    if (command === "link-parent") {
      return await commandLinkParent(root, args);
    }
    if (command === "link-child") {
      return await commandLinkChild(root, args);
    }
    if (command === "unlink-parent") {
      return await commandUnlinkParent(root, args);
    }
    if (command === "block") {
      return await commandBlock(root, args);
    }
    if (command === "unblock") {
      return await commandUnblock(root, args);
    }
    if (command === "estimate") {
      return await commandEstimate(root, args);
    }
    if (command === "gate-check") {
      return await commandGateCheck(root, args);
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

async function commandStartWork(root, args) {
  const asJson = takeFlag(args, "--json");
  const allowDirty = takeFlag(args, "--allow-dirty");
  const branch = takeOption(args, "--branch");
  const ticketId = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined) {
    throw new Error("start-work requires: <ticket-id> [--branch <branch>] [--allow-dirty]");
  }

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
  const ticketId = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined) {
    throw new Error("begin-step requires: <ticket-id> [--action <action>] [--json]");
  }

  const result = await beginStep(root, ticketId, action);
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const model = result.configuredModel ? `@${result.configuredModel}` : "";
    console.log(`${result.ticket} ${result.action} ${result.configuredAgent}${model}`);
  }
  return 0;
}

async function commandCompleteStep(root, args) {
  const asJson = takeFlag(args, "--json");
  const executor = takeOption(args, "--executor");
  const evidence = takeOption(args, "--evidence");
  const ticketId = args.shift();
  const action = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined || action === undefined || executor === undefined || evidence === undefined) {
    throw new Error("complete-step requires: <ticket-id> <action> --executor <executor> --evidence <text>");
  }

  const result = await completeStep(root, ticketId, action, executor, evidence);
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${result.ticket} ${result.action} ${result.executor} ${result.path}`);
  }
  return 0;
}

async function commandApproveInline(root, args) {
  const asJson = takeFlag(args, "--json");
  const reason = takeOption(args, "--reason");
  const executor = takeOption(args, "--executor") ?? "inline";
  const ticketId = args.shift();
  const action = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined || action === undefined || reason === undefined) {
    throw new Error("approve-inline requires: <ticket-id> <action> --reason <text> [--executor <executor>]");
  }

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

async function commandMove(root, args) {
  const asJson = takeFlag(args, "--json");
  const ticketId = args.shift();
  const status = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined || status === undefined) {
    throw new Error("move requires: <ticket-id> <status>");
  }

  await moveAndMaybeMerge(root, ticketId, status, { asJson });
  return 0;
}

async function commandSet(root, args) {
  const ticketId = args.shift();
  const field = args.shift();
  const rawValue = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined || field === undefined || rawValue === undefined) {
    throw new Error("set requires: <ticket-id> <field> <value>");
  }

  const value = parseScalar(rawValue);
  if (field === "status") {
    await moveAndMaybeMerge(root, ticketId, String(value), { asJson: false });
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

  const ticketPath = await moveTicket(root, ticketId, status);
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

async function commandComment(root, args) {
  const section = takeOption(args, "--section") ?? "Run Log";
  const ticketId = args.shift();
  const text = args.join(" ").trim();

  if (ticketId === undefined || text === "") {
    throw new Error("comment requires: <ticket-id> <text> [--section <section>]");
  }

  const ticketPath = await appendTicketComment(root, ticketId, section, text);
  console.log(ticketPath);
  return 0;
}

async function commandSection(root, args) {
  const section = takeOption(args, "--section");
  const file = takeOption(args, "--file");
  const ticketId = args.shift();
  const inlineText = args.join(" ").trim();

  if (ticketId === undefined || section === undefined) {
    throw new Error("section requires: <ticket-id> (<text>|--file <path>) --section <section>");
  }
  if (file !== undefined && inlineText !== "") {
    throw new Error("section accepts either <text> or --file <path>, not both");
  }

  const text = file === undefined ? inlineText : await readFile(file, "utf8");
  if (text.trim() === "") {
    throw new Error("section requires non-empty text from <text> or --file <path>");
  }

  const ticketPath = await setTicketSection(root, ticketId, section, text);
  console.log(ticketPath);
  return 0;
}

async function commandLinkParent(root, args) {
  const childId = args.shift();
  const parentId = args.shift();
  ensureNoArgs(args);

  if (childId === undefined || parentId === undefined) {
    throw new Error("link-parent requires: <child-ticket-id> <parent-ticket-id>");
  }

  const result = await linkParent(root, childId, parentId);
  console.log(`${result.childPath}\n${result.parentPath}`);
  return 0;
}

async function commandLinkChild(root, args) {
  const parentId = args.shift();
  const childId = args.shift();
  ensureNoArgs(args);

  if (parentId === undefined || childId === undefined) {
    throw new Error("link-child requires: <parent-ticket-id> <child-ticket-id>");
  }

  const result = await linkParent(root, childId, parentId);
  console.log(`${result.parentPath}\n${result.childPath}`);
  return 0;
}

async function commandUnlinkParent(root, args) {
  const childId = args.shift();
  const parentId = args.shift();
  ensureNoArgs(args);

  if (childId === undefined || parentId === undefined) {
    throw new Error("unlink-parent requires: <child-ticket-id> <parent-ticket-id>");
  }

  const result = await unlinkParent(root, childId, parentId);
  console.log(`${result.childPath}\n${result.parentPath}`);
  return 0;
}

async function commandBlock(root, args) {
  const ticketId = args.shift();
  const dependencyId = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined || dependencyId === undefined) {
    throw new Error("block requires: <ticket-id> <dependency-ticket-id>");
  }

  const result = await blockTicket(root, ticketId, dependencyId);
  console.log(`${result.ticketPath}\n${result.dependencyPath}`);
  return 0;
}

async function commandUnblock(root, args) {
  const ticketId = args.shift();
  const dependencyId = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined || dependencyId === undefined) {
    throw new Error("unblock requires: <ticket-id> <dependency-ticket-id>");
  }

  const result = await unblockTicket(root, ticketId, dependencyId);
  console.log(`${result.ticketPath}\n${result.dependencyPath}`);
  return 0;
}

async function commandEstimate(root, args) {
  const basisOption = takeOption(args, "--basis");
  const force = takeFlag(args, "--force");
  const asJson = takeFlag(args, "--json");
  const ticketId = args.shift();
  const rawPoints = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined || rawPoints === undefined) {
    throw new Error("estimate requires: <ticket-id> <points> [--basis <ticket-id-or-bootstrap>] [--force] [--json]");
  }

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

async function commandGateCheck(root, args) {
  const asJson = takeFlag(args, "--json");
  const stage = takeOption(args, "--stage");
  const ticketId = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined || stage === undefined) {
    throw new Error("gate-check requires: <ticket-id> --stage <stage> [--json]");
  }
  if (!OPTIONAL_STEP_STAGES.includes(stage)) {
    throw new Error(`gate-check --stage must be one of ${OPTIONAL_STEP_STAGES.join(", ")}`);
  }

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
  args.splice(index, 2);
  return value;
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

function printUsage() {
  console.error(`Usage:
  local-board [--root <path>] validate [--json]
  local-board [--root <path>] list [--status <status>] [--ready] [--limit <N>] [--json]
  local-board [--root <path>] next [--json]
  local-board [--root <path>] query-next [--json]
  local-board [--root <path>] query-ticket <ticket-id> [--json]
  local-board [--root <path>] state-report [--json]
  local-board [--root <path>] schema [--json]
  local-board [--root <path>] init [--overwrite] [--json]
  local-board install [--target=<ids>] [--all] [--no-<id>] [--list-targets] [--uninstall] (acts on user HOME; ignores --root)
  local-board [--root <path>] create <type> <title> [--status <status>] [--priority <priority>] [--parent <id>]
  local-board [--root <path>] start-work <ticket-id> [--branch <branch>] [--allow-dirty] [--json]
  local-board [--root <path>] worktree-add <ticket-id> [--json]
  local-board [--root <path>] worktree-remove <ticket-id> [--force] [--json]
  local-board [--root <path>] worktree-list [--json]
  local-board [--root <path>] fast-forward [--json]
  local-board team-config [--json]
  local-board [--root <path>] begin-step <ticket-id> [--action <action>] [--json]
  local-board [--root <path>] complete-step <ticket-id> <action> --executor <executor> --evidence <text> [--json]
  local-board [--root <path>] approve-inline <ticket-id> <action> --reason <text> [--executor <executor>] [--json]
  local-board [--root <path>] check-dispatch --agent <subagent-type> [--model <model>] [--ticket <ticket-id>] [--json]
  local-board [--root <path>] move <ticket-id> <status> [--json]
  local-board [--root <path>] set <ticket-id> <field> <value>
  local-board [--root <path>] comment <ticket-id> <text> [--section <section>]
  local-board [--root <path>] section <ticket-id> <text> --section <section>
  local-board [--root <path>] section <ticket-id> --file <path> --section <section>
  local-board [--root <path>] link-parent <child-ticket-id> <parent-ticket-id>
  local-board [--root <path>] link-child <parent-ticket-id> <child-ticket-id>
  local-board [--root <path>] unlink-parent <child-ticket-id> <parent-ticket-id>
  local-board [--root <path>] block <ticket-id> <dependency-ticket-id>
  local-board [--root <path>] unblock <ticket-id> <dependency-ticket-id>
  local-board [--root <path>] estimate <ticket-id> <points> [--basis <ticket-id-or-bootstrap>] [--force] [--json]
  local-board [--root <path>] gate-check <ticket-id> --stage <stage> [--json]
  local-board [--root <path>] specialty-run <ticket-id> <step-name> [--json]
  local-board [--root <path>] calibration suggest <ticket-id> [--json]`);
}
