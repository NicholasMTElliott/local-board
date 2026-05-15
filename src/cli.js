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
  parseScalar,
  queryNext,
  queryTicket,
  schemaRecord,
  setTicketField,
  setTicketSection,
  stateReport,
  ticketRecord,
  unblockTicket,
  unlinkParent,
  validate,
} from "./tickets.js";
import { assertAutoMergeReady, autoMergeTicketBranch, startTicketWork } from "./git.js";
import { loadConfig } from "./config.js";
import { initProject } from "./scaffold.js";

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
    if (command === "begin-step") {
      return await commandBeginStep(root, args);
    }
    if (command === "complete-step") {
      return await commandCompleteStep(root, args);
    }
    if (command === "approve-inline") {
      return await commandApproveInline(root, args);
    }
    if (command === "init") {
      return await commandInit(root, args);
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
  const status = takeOption(args, "--status");
  ensureNoArgs(args);

  const board = await discover(root);
  const records = board.tickets
    .filter((ticket) => status === undefined || ticket.status === status)
    .map((ticket) => ticketRecord(root, ticket));

  if (asJson) {
    console.log(JSON.stringify(records, null, 2));
  } else {
    for (const record of records) {
      console.log(`${record.id} ${record.priority} ${record.status} ${record.path} ${record.title}`);
    }
  }

  return 0;
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
    console.log(`${result.ticket} ${result.action} ${result.configuredAgent}`);
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
  const ticketId = args.shift();
  const action = args.shift();
  ensureNoArgs(args);

  if (ticketId === undefined || action === undefined || reason === undefined) {
    throw new Error("approve-inline requires: <ticket-id> <action> --reason <text>");
  }

  const result = await approveInline(root, ticketId, action, reason);
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${result.ticket} ${result.action} ${result.approvedExecutor} ${result.path}`);
  }
  return 0;
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
  const ticketId = args.shift();
  const text = args.join(" ").trim();

  if (ticketId === undefined || section === undefined || text === "") {
    throw new Error("section requires: <ticket-id> <text> --section <section>");
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

function ensureNoArgs(args) {
  if (args.length > 0) {
    throw new Error(`unexpected argument: ${args[0]}`);
  }
}

function printUsage() {
  console.error(`Usage:
  local-board [--root <path>] validate [--json]
  local-board [--root <path>] list [--status <status>] [--json]
  local-board [--root <path>] next [--json]
  local-board [--root <path>] query-next [--json]
  local-board [--root <path>] query-ticket <ticket-id> [--json]
  local-board [--root <path>] state-report [--json]
  local-board [--root <path>] schema [--json]
  local-board [--root <path>] init [--overwrite] [--json]
  local-board [--root <path>] create <type> <title> [--status <status>] [--priority <priority>] [--parent <id>]
  local-board [--root <path>] start-work <ticket-id> [--branch <branch>] [--allow-dirty] [--json]
  local-board [--root <path>] begin-step <ticket-id> [--action <action>] [--json]
  local-board [--root <path>] complete-step <ticket-id> <action> --executor <executor> --evidence <text> [--json]
  local-board [--root <path>] approve-inline <ticket-id> <action> --reason <text> [--json]
  local-board [--root <path>] move <ticket-id> <status> [--json]
  local-board [--root <path>] set <ticket-id> <field> <value>
  local-board [--root <path>] comment <ticket-id> <text> [--section <section>]
  local-board [--root <path>] section <ticket-id> <text> --section <section>
  local-board [--root <path>] link-parent <child-ticket-id> <parent-ticket-id>
  local-board [--root <path>] link-child <parent-ticket-id> <child-ticket-id>
  local-board [--root <path>] unlink-parent <child-ticket-id> <parent-ticket-id>
  local-board [--root <path>] block <ticket-id> <dependency-ticket-id>
  local-board [--root <path>] unblock <ticket-id> <dependency-ticket-id>`);
}
