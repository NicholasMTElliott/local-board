import { createTicket, discover, nextTicket, ticketRecord, validate } from "./tickets.js";

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
    if (command === "create") {
      return await commandCreate(root, args);
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
  const issues = validate(board);

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
  local-board [--root <path>] create <type> <title> [--status <status>] [--priority <priority>] [--parent <id>]`);
}
