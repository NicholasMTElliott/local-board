import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const PREFIX_TYPES = new Map([
  ["E", "epic"],
  ["S", "story"],
  ["T", "task"],
  ["B", "bug"],
]);

export const TYPE_PREFIXES = new Map([...PREFIX_TYPES.entries()].map(([prefix, type]) => [type, prefix]));

export const STATUSES = new Set([
  "backlog",
  "ready_for_decomposition",
  "ready_for_design",
  "designing",
  "questions",
  "ready_for_implementation",
  "implementing",
  "ready_for_review",
  "reviewing",
  "ready_for_test",
  "testing",
  "ready_for_docs",
  "done",
  "blocked",
  "archived",
]);

export const STATUS_FOLDERS = new Map([
  ["backlog", "backlog"],
  ["ready_for_decomposition", "ready"],
  ["ready_for_design", "ready"],
  ["ready_for_implementation", "ready"],
  ["ready_for_review", "review"],
  ["ready_for_test", "ready"],
  ["ready_for_docs", "ready"],
  ["designing", "active"],
  ["implementing", "active"],
  ["reviewing", "review"],
  ["testing", "active"],
  ["questions", "questions"],
  ["blocked", "blocked"],
  ["done", "done"],
  ["archived", "archive"],
]);

export const TRIGGER_STATUSES = new Set([
  "ready_for_decomposition",
  "ready_for_design",
  "ready_for_implementation",
  "ready_for_review",
  "ready_for_test",
  "ready_for_docs",
]);

export const PRIORITIES = ["P0", "P1", "P2", "P3", "P4"];

const REQUIRED_FIELDS = [
  "id",
  "type",
  "status",
  "priority",
  "parent",
  "children",
  "blockedBy",
  "blocks",
  "branch",
  "estimate",
  "created",
  "updated",
];

const LIST_FIELDS = ["children", "blockedBy", "blocks"];
const NULLABLE_FIELDS = ["parent", "branch", "estimate"];
const STANDARD_SECTIONS = [
  "Requirement",
  "Acceptance Criteria",
  "Related Tickets",
  "Technical Design",
  "Implementation Notes",
  "Review Findings",
  "Test Evidence",
  "Documentation Updates",
  "Questions",
  "Run Log",
];

const TICKET_ID_RE = /^[ESBT]\d{8}T\d{4}Z$/;
const TICKET_FILE_RE = /^(?<id>[ESBT]\d{8}T\d{4}Z)_(?<slug>[a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

export async function discover(root = ".") {
  const rootPath = path.resolve(root);
  const ticketRoot = path.join(rootPath, "plans", "tickets");
  const tickets = [];
  const loadErrors = [];

  try {
    for await (const filePath of walkMarkdown(ticketRoot)) {
      if (path.basename(filePath).toLowerCase() === "readme.md") {
        continue;
      }
      try {
        tickets.push(await readTicket(filePath));
      } catch (error) {
        loadErrors.push(`${filePath}: ${error.message}`);
      }
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      loadErrors.push(`${ticketRoot}: missing ticket directory`);
    } else {
      throw error;
    }
  }

  tickets.sort((left, right) => left.path.localeCompare(right.path));
  return { root: rootPath, tickets, loadErrors };
}

async function* walkMarkdown(root) {
  const entries = await readdir(root, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkMarkdown(entryPath);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      yield entryPath;
    }
  }
}

export async function readTicket(filePath) {
  const text = await readFile(filePath, "utf8");
  const { frontMatter, body } = parseMarkdownTicket(text);
  return {
    path: path.resolve(filePath),
    frontMatter,
    body,
    id: String(frontMatter.id ?? ""),
    type: String(frontMatter.type ?? ""),
    status: String(frontMatter.status ?? ""),
    priority: String(frontMatter.priority ?? ""),
    title: extractTitle(body),
  };
}

export function parseMarkdownTicket(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== "---") {
    throw new Error("missing YAML front matter");
  }

  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) {
    throw new Error("unterminated YAML front matter");
  }

  return {
    frontMatter: parseFrontMatter(lines.slice(1, end)),
    body: lines.slice(end + 1).join("\n"),
  };
}

export function parseFrontMatter(lines) {
  const values = {};

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      return;
    }
    const separator = line.indexOf(":");
    if (separator === -1) {
      throw new Error(`invalid front matter line ${index + 2}`);
    }
    const key = line.slice(0, separator).trim();
    if (key === "") {
      throw new Error(`empty key on front matter line ${index + 2}`);
    }
    values[key] = parseScalar(line.slice(separator + 1).trim());
  });

  return values;
}

function parseScalar(value) {
  if (value === "" || ["null", "Null", "NULL", "~"].includes(value)) {
    return null;
  }
  if (value === "[]") {
    return [];
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (inner === "") {
      return [];
    }
    return inner.split(",").map((item) => parseListItem(item.trim()));
  }
  if (value.length >= 2 && value[0] === value[value.length - 1] && ["'", '"'].includes(value[0])) {
    return value.slice(1, -1);
  }
  return value;
}

function parseListItem(value) {
  const parsed = parseScalar(value);
  if (parsed === null) {
    return "";
  }
  if (Array.isArray(parsed)) {
    throw new Error("nested lists are not supported");
  }
  return String(parsed);
}

export function validate(board) {
  const issues = [...board.loadErrors];
  const byId = byTicketId(board);
  const seenIds = new Map();

  for (const ticket of board.tickets) {
    issues.push(...validateTicketShape(board, ticket));
    if (ticket.id !== "") {
      if (seenIds.has(ticket.id)) {
        issues.push(`${ticket.path}: duplicate id ${ticket.id}; first seen in ${seenIds.get(ticket.id)}`);
      }
      seenIds.set(ticket.id, ticket.path);
    }
  }

  for (const ticket of board.tickets) {
    issues.push(...validateLinks(ticket, byId));
  }

  return issues;
}

export function byTicketId(board) {
  const byId = new Map();
  for (const ticket of board.tickets) {
    if (ticket.id !== "") {
      byId.set(ticket.id, ticket);
    }
  }
  return byId;
}

function validateTicketShape(board, ticket) {
  const issues = [];
  const fm = ticket.frontMatter;

  for (const field of REQUIRED_FIELDS) {
    if (!Object.hasOwn(fm, field)) {
      issues.push(`${ticket.path}: missing required field ${field}`);
    }
  }

  const fileMatch = path.basename(ticket.path).match(TICKET_FILE_RE);
  if (fileMatch === null) {
    issues.push(`${ticket.path}: filename must match {Prefix}{yyyyMMddTHHmmZ}_{slug}.md`);
  } else if (ticket.id !== "" && fileMatch.groups.id !== ticket.id) {
    issues.push(`${ticket.path}: filename id ${fileMatch.groups.id} does not match front matter id ${ticket.id}`);
  }

  if (ticket.id !== "" && !TICKET_ID_RE.test(ticket.id)) {
    issues.push(`${ticket.path}: id must match [ESBT]yyyyMMddTHHmmZ`);
  }

  if (!TYPE_PREFIXES.has(fm.type)) {
    issues.push(`${ticket.path}: type must be one of ${[...TYPE_PREFIXES.keys()].sort().join(", ")}`);
  } else if (TICKET_ID_RE.test(ticket.id) && TYPE_PREFIXES.get(fm.type) !== ticket.id[0]) {
    issues.push(`${ticket.path}: type ${fm.type} does not match id prefix ${ticket.id[0]}`);
  }

  if (!STATUSES.has(fm.status)) {
    issues.push(`${ticket.path}: status must be one of ${[...STATUSES].sort().join(", ")}`);
  } else {
    issues.push(...validateStatusFolder(board, ticket, fm.status));
  }

  if (!PRIORITIES.includes(fm.priority)) {
    issues.push(`${ticket.path}: priority must be one of ${PRIORITIES.join(", ")}`);
  }

  for (const field of LIST_FIELDS) {
    if (Object.hasOwn(fm, field) && !Array.isArray(fm[field])) {
      issues.push(`${ticket.path}: ${field} must be a list`);
    }
  }

  for (const field of NULLABLE_FIELDS) {
    if (Object.hasOwn(fm, field) && fm[field] !== null && typeof fm[field] !== "string") {
      issues.push(`${ticket.path}: ${field} must be null or a string`);
    }
  }

  for (const field of ["created", "updated"]) {
    if (Object.hasOwn(fm, field) && Number.isNaN(parseDate(fm[field]).getTime())) {
      issues.push(`${ticket.path}: ${field} must be an ISO-8601 datetime with a timezone offset or Z`);
    }
  }

  if (ticket.title === "") {
    issues.push(`${ticket.path}: missing # Title`);
  }

  for (const section of STANDARD_SECTIONS) {
    const sectionRe = new RegExp(`^## ${escapeRegExp(section)}\\s*$`, "m");
    if (!sectionRe.test(ticket.body)) {
      issues.push(`${ticket.path}: missing ## ${section} section`);
    }
  }

  return issues;
}

function validateStatusFolder(board, ticket, status) {
  const ticketRoot = path.join(board.root, "plans", "tickets");
  const relative = path.relative(ticketRoot, ticket.path);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return [`${ticket.path}: ticket is outside ${ticketRoot}`];
  }

  const [actualFolder] = relative.split(path.sep);
  const expectedFolder = STATUS_FOLDERS.get(status);
  if (actualFolder !== expectedFolder) {
    return [`${ticket.path}: status ${status} belongs in plans/tickets/${expectedFolder}/`];
  }
  return [];
}

function validateLinks(ticket, byId) {
  const issues = [];
  if (ticket.id === "") {
    return issues;
  }

  const parent = ticket.frontMatter.parent;
  if (parent !== null && parent !== undefined) {
    if (typeof parent !== "string") {
      issues.push(`${ticket.path}: parent must be null or a ticket id`);
    } else if (!byId.has(parent)) {
      issues.push(`${ticket.path}: parent ${parent} does not exist`);
    } else if (!asList(byId.get(parent).frontMatter.children).includes(ticket.id)) {
      issues.push(`${ticket.path}: parent ${parent} does not list ${ticket.id} as a child`);
    }
  }

  for (const childId of asList(ticket.frontMatter.children)) {
    const child = byId.get(childId);
    if (child === undefined) {
      issues.push(`${ticket.path}: child ${childId} does not exist`);
    } else if (child.frontMatter.parent !== ticket.id) {
      issues.push(`${ticket.path}: child ${childId} does not point back to parent ${ticket.id}`);
    }
  }

  for (const dependencyId of asList(ticket.frontMatter.blockedBy)) {
    const dependency = byId.get(dependencyId);
    if (dependency === undefined) {
      issues.push(`${ticket.path}: blockedBy ${dependencyId} does not exist`);
    } else if (!asList(dependency.frontMatter.blocks).includes(ticket.id)) {
      issues.push(`${ticket.path}: blockedBy ${dependencyId} does not list ${ticket.id} in blocks`);
    }
  }

  for (const blockedId of asList(ticket.frontMatter.blocks)) {
    const blocked = byId.get(blockedId);
    if (blocked === undefined) {
      issues.push(`${ticket.path}: blocks ${blockedId} does not exist`);
    } else if (!asList(blocked.frontMatter.blockedBy).includes(ticket.id)) {
      issues.push(`${ticket.path}: blocks ${blockedId} does not list ${ticket.id} in blockedBy`);
    }
  }

  return issues;
}

export function nextTicket(board) {
  const byId = byTicketId(board);
  const eligible = board.tickets.filter((ticket) => isEligible(ticket, byId));
  eligible.sort(compareTicketsForSelection);
  return eligible[0] ?? null;
}

export function isEligible(ticket, byId) {
  if (!TRIGGER_STATUSES.has(ticket.status)) {
    return false;
  }

  for (const dependencyId of asList(ticket.frontMatter.blockedBy)) {
    const dependency = byId.get(dependencyId);
    if (dependency === undefined || dependency.status !== "done") {
      return false;
    }
  }

  return true;
}

function compareTicketsForSelection(left, right) {
  return (
    priorityRank(left) - priorityRank(right) ||
    parseDate(left.frontMatter.created) - parseDate(right.frontMatter.created) ||
    left.id.localeCompare(right.id)
  );
}

function priorityRank(ticket) {
  const index = PRIORITIES.indexOf(ticket.priority);
  return index === -1 ? PRIORITIES.length : index;
}

export async function createTicket(root, ticketType, title, options = {}) {
  const status = options.status ?? "backlog";
  const priority = options.priority ?? "P2";
  const parent = options.parent ?? null;
  const now = options.now ?? new Date();

  if (!TYPE_PREFIXES.has(ticketType)) {
    throw new Error(`type must be one of ${[...TYPE_PREFIXES.keys()].sort().join(", ")}`);
  }
  if (!STATUSES.has(status)) {
    throw new Error(`status must be one of ${[...STATUSES].sort().join(", ")}`);
  }
  if (!PRIORITIES.includes(priority)) {
    throw new Error(`priority must be one of ${PRIORITIES.join(", ")}`);
  }

  const ticketId = `${TYPE_PREFIXES.get(ticketType)}${formatTicketTimestamp(now)}`;
  const slug = slugify(title);
  const folder = path.resolve(root, "plans", "tickets", STATUS_FOLDERS.get(status));
  const ticketPath = path.join(folder, `${ticketId}_${slug}.md`);
  const created = formatIsoSeconds(now);

  await mkdir(folder, { recursive: true });
  await writeFile(ticketPath, renderTicket(ticketId, ticketType, status, priority, parent, created, title), {
    encoding: "utf8",
    flag: "wx",
  });

  return ticketPath;
}

export function renderTicket(ticketId, ticketType, status, priority, parent, created, title) {
  const parentValue = parent ?? "null";
  return `---
id: ${ticketId}
type: ${ticketType}
status: ${status}
priority: ${priority}
parent: ${parentValue}
children: []
blockedBy: []
blocks: []
branch: null
estimate: null
created: ${created}
updated: ${created}
---

# ${title}

## Requirement

## Acceptance Criteria

## Related Tickets

## Technical Design

## Implementation Notes

## Review Findings

## Test Evidence

## Documentation Updates

## Questions

## Run Log
`;
}

export function ticketRecord(root, ticket) {
  return {
    id: ticket.id,
    type: ticket.type,
    status: ticket.status,
    priority: ticket.priority,
    path: path.relative(path.resolve(root), ticket.path),
    title: ticket.title,
  };
}

function extractTitle(body) {
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith("# ")) {
      return line.slice(2).trim();
    }
  }
  return "";
}

function asList(value) {
  return Array.isArray(value) ? value.map(String).filter((item) => item !== "") : [];
}

function parseDate(value) {
  if (typeof value !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return new Date(Number.NaN);
  }
  return new Date(value);
}

function formatTicketTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").slice(0, 13) + "Z";
}

function formatIsoSeconds(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function slugify(value) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "ticket" : slug;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
