import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadConfig } from "./config.js";
import { ticketWorktreeMintOffsetMinutes } from "./worktrees.js";

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

const CLOSED_STATUSES = new Set(["done", "archived"]);

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
  "estimateBasis",
  "workStartedAt",
  "workCompletedAt",
  "created",
  "updated",
];

const OPTIONAL_FIELDS = ["completedSteps", "routingApprovals"];
const CANONICAL_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];
const IMMUTABLE_FIELDS = new Set(["id", "type", "created", "updated"]);
const LIST_FIELDS = ["children", "blockedBy", "blocks", ...OPTIONAL_FIELDS];
const NULLABLE_FIELDS = ["parent", "branch", "estimate", "estimateBasis", "workStartedAt", "workCompletedAt"];
const LEGACY_DEFAULT_NULL_FIELDS = ["estimateBasis", "workStartedAt", "workCompletedAt"];
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

export const TICKET_ID_RE = /^[ESBT]\d{8}T\d{4}Z$/;
const TICKET_FILE_RE = /^(?<id>[ESBT]\d{8}T\d{4}Z)_(?<slug>[a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

// Per-process monotonic counter so two in-flight writes from the same process
// never collide on the same temp filename (pid alone is not enough: linkParent,
// blockTicket, and future concurrency can issue overlapping writes).
let tmpSeq = 0;
function nextTmpSeq() {
  tmpSeq += 1;
  return tmpSeq;
}

// Windows can throw these transiently on rename (antivirus, Search Indexer, or an
// editor holding a handle open); retry a bounded number of times before giving up.
const RENAME_RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_RETRY_DELAYS_MS = [10, 20, 40, 80];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renameWithRetry(source, destination, renameFn = rename) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await renameFn(source, destination);
      return;
    } catch (error) {
      if (!RENAME_RETRY_CODES.has(error.code) || attempt >= RENAME_RETRY_DELAYS_MS.length) {
        throw error;
      }
      await delay(RENAME_RETRY_DELAYS_MS[attempt]);
    }
  }
}

// Atomically overwrite a canonical ticket file: write the full content to a
// sibling temp file, then rename it over the destination so readers only ever
// see a complete file (old or new, never torn). The temp name deliberately does
// NOT end in ".md" so discover()'s `endsWith(".md")` filter (see walkMarkdown
// below) never picks it up as a phantom ticket.
// `options.renameFn` is a test-only injection point for failure-simulation; all
// production call sites use the default real `rename`.
export async function writeTicketFile(targetPath, content, options = {}) {
  const renameFn = options.renameFn ?? rename;
  const dir = path.dirname(targetPath);
  const tmpPath = path.join(dir, `.${path.basename(targetPath)}.tmp-${process.pid}-${nextTmpSeq()}`);
  try {
    await writeFile(tmpPath, content, "utf8");
    await renameWithRetry(tmpPath, targetPath, renameFn);
  } catch (error) {
    // Best-effort cleanup of the orphaned temp file; the canonical file at
    // targetPath is left untouched and intact either way.
    await rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }
}

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
  for (const field of LEGACY_DEFAULT_NULL_FIELDS) {
    if (!Object.hasOwn(frontMatter, field)) {
      frontMatter[field] = null;
    }
  }
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

export function parseScalar(value) {
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

export function validate(board, config = null) {
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
    if (config !== null) {
      issues.push(...validateRouting(ticket, config));
    }
  }

  return issues;
}

export async function findTicket(root, ticketId) {
  const board = await discover(root);
  if (board.loadErrors.length > 0) {
    throw new Error(board.loadErrors.join("\n"));
  }

  const matches = board.tickets.filter((ticket) => ticket.id === ticketId);
  if (matches.length === 0) {
    throw new Error(`ticket ${ticketId} not found`);
  }
  if (matches.length > 1) {
    throw new Error(`ticket ${ticketId} is duplicated`);
  }
  return { board, ticket: matches[0] };
}

export async function moveTicket(root, ticketId, status, options = {}) {
  if (!STATUSES.has(status)) {
    throw new Error(`status must be one of ${[...STATUSES].sort().join(", ")}`);
  }

  const now = options.now ?? new Date();
  const { board, ticket } = await findTicket(root, ticketId);
  const frontMatter = withUpdated({ ...ticket.frontMatter, status }, now);
  if (
    status === "done" &&
    frontMatter.workCompletedAt === null &&
    typeof frontMatter.workStartedAt === "string"
  ) {
    frontMatter.workCompletedAt = formatIsoSeconds(now);
  }
  if (status === "done") {
    const config = await loadConfig(board.root);
    const issues = validateRouting({ ...ticket, status, frontMatter }, config);
    if (issues.length > 0) {
      throw new Error(`routing validation failed:\n${issues.join("\n")}`);
    }
  }
  const content = renderMarkdownTicket(frontMatter, ticket.body);
  const targetFolder = path.join(board.root, "plans", "tickets", STATUS_FOLDERS.get(status));
  const targetPath = path.join(targetFolder, path.basename(ticket.path));

  await mkdir(targetFolder, { recursive: true });
  if (path.resolve(ticket.path) !== path.resolve(targetPath) && (await exists(targetPath))) {
    throw new Error(`${targetPath} already exists`);
  }

  if (path.resolve(ticket.path) !== path.resolve(targetPath)) {
    // Rename first (risky op), then rewrite content in place. If the rename
    // throws, the file is untouched at the old path with old (folder-consistent)
    // status: the board stays queryable and the caller can retry. If the
    // in-place rewrite throws after a successful rename, roll the rename back
    // so the file returns to its old, fully-consistent path.
    await renameWithRetry(ticket.path, targetPath, options.renameFn);
    try {
      await writeTicketFile(targetPath, content, { renameFn: options.renameFn });
    } catch (error) {
      await renameWithRetry(targetPath, ticket.path, options.renameFn).catch(() => {});
      throw error;
    }
  } else {
    await writeTicketFile(targetPath, content, { renameFn: options.renameFn });
  }

  return targetPath;
}

export async function archiveDoneTickets(root, options = {}) {
  const archiveDoneAfterDays = options.archiveDoneAfterDays ?? 30;
  if (!Number.isFinite(archiveDoneAfterDays) || archiveDoneAfterDays < 0) {
    throw new Error("retention.archiveDoneAfterDays must be a non-negative number");
  }

  const now = options.now ?? new Date();
  const cutoff = now.getTime() - archiveDoneAfterDays * 24 * 60 * 60 * 1000;
  const excluded = new Set(options.excludeIds ?? []);
  const board = await discover(root);
  if (board.loadErrors.length > 0) {
    throw new Error(board.loadErrors.join("\n"));
  }

  const archived = [];
  for (const ticket of board.tickets) {
    if (ticket.status !== "done" || excluded.has(ticket.id)) {
      continue;
    }
    const updatedTime = Date.parse(ticket.frontMatter.updated);
    if (!Number.isFinite(updatedTime) || updatedTime >= cutoff) {
      continue;
    }
    const targetPath = await moveTicket(board.root, ticket.id, "archived", { now });
    archived.push({
      ticket: ticket.id,
      path: path.relative(board.root, targetPath),
    });
  }

  return archived;
}

export async function setTicketField(root, ticketId, field, value, options = {}) {
  if (!CANONICAL_FIELDS.includes(field)) {
    throw new Error(`field must be one of ${CANONICAL_FIELDS.join(", ")}`);
  }
  if (IMMUTABLE_FIELDS.has(field)) {
    throw new Error(`${field} is managed by local-board and cannot be set directly`);
  }
  if (field === "status") {
    return moveTicket(root, ticketId, String(value), options);
  }

  assertFieldValue(field, value);

  const { ticket } = await findTicket(root, ticketId);
  const frontMatter = withUpdated({ ...ticket.frontMatter, [field]: value }, options.now);
  await writeTicketFile(ticket.path, renderMarkdownTicket(frontMatter, ticket.body));
  return ticket.path;
}

export async function appendTicketComment(root, ticketId, section, text, options = {}) {
  if (text.trim() === "") {
    throw new Error("comment text is required");
  }

  const { ticket } = await findTicket(root, ticketId);
  const body = appendToSection(ticket.body, section, `- ${formatIsoSeconds(options.now ?? new Date())}: ${text.trim()}`);
  const frontMatter = withUpdated({ ...ticket.frontMatter }, options.now);
  await writeTicketFile(ticket.path, renderMarkdownTicket(frontMatter, body));
  return ticket.path;
}

export async function setTicketSection(root, ticketId, section, text, options = {}) {
  const { ticket } = await findTicket(root, ticketId);
  const body = replaceSection(ticket.body, section, text.trim());
  const frontMatter = withUpdated({ ...ticket.frontMatter }, options.now);
  await writeTicketFile(ticket.path, renderMarkdownTicket(frontMatter, body));
  return ticket.path;
}

export async function beginStep(root, ticketId, actionOverride = null) {
  const [board, config] = await Promise.all([discover(root), loadConfig(root)]);
  const issues = validate(board, config);
  if (issues.length > 0) {
    throw new Error(`ticket validation failed:\n${issues.join("\n")}`);
  }

  const byId = byTicketId(board);
  const ticket = byId.get(ticketId);
  if (ticket === undefined) {
    throw new Error(`ticket ${ticketId} not found`);
  }

  const action = actionOverride ?? config.workflow.statusActions[ticket.status] ?? null;
  if (action === null) {
    throw new Error(`ticket ${ticketId} has no configured action for status ${ticket.status}`);
  }

  assertAction(config, action);
  const configuredAgent = agentForAction(config, action);
  return {
    ticket: ticket.id,
    action,
    status: ticket.status,
    transitions: transitionsForStatus(config, ticket.status),
    configuredAgent,
    configuredModel: modelForAction(config, action),
    configuredPrompt: promptForAction(config, action),
    strict: config.routing?.strict === true,
    delegationRequired: config.routing?.strict === true && configuredAgent !== "inline",
    branch: ticket.frontMatter.branch ?? null,
    path: path.relative(board.root, ticket.path),
  };
}

export async function approveInline(root, ticketId, action, reason, options = {}) {
  if (reason.trim() === "") {
    throw new Error("approve-inline requires a non-empty reason");
  }

  const config = await loadConfig(root);
  assertAction(config, action);
  const { ticket } = await findTicket(root, ticketId);
  const token = stepToken(action, "inline");
  const now = options.now ?? new Date();
  const frontMatter = withUpdated(
    {
      ...ticket.frontMatter,
      routingApprovals: addUnique(asList(ticket.frontMatter.routingApprovals), token),
    },
    now,
  );
  const body = appendToSection(ticket.body, "Run Log", `- ${formatIsoSeconds(now)}: Approved inline ${action}: ${reason.trim()}`);
  await writeTicketFile(ticket.path, renderMarkdownTicket(frontMatter, body));
  return { ticket: ticket.id, action, approvedExecutor: "inline", path: ticket.path };
}

export async function completeStep(root, ticketId, action, executor, evidence, options = {}) {
  if (evidence.trim() === "") {
    throw new Error("complete-step requires non-empty evidence");
  }

  const config = await loadConfig(root);
  assertAction(config, action);
  if (!isValidAgentValue(executor)) {
    throw new Error(`executor must be one of ${schemaAgentValues().join(", ")}`);
  }

  const { ticket } = await findTicket(root, ticketId);
  const token = stepToken(action, executor);
  const routingIssues = validateStepRouting(ticket, config, action, executor);
  if (routingIssues.length > 0) {
    throw new Error(`routing validation failed:\n${routingIssues.join("\n")}`);
  }

  if (
    action === "design"
    && (ticket.frontMatter.type === "task" || ticket.frontMatter.type === "bug")
    && config.estimation?.enabled === true
    && (ticket.frontMatter.estimate === null || ticket.frontMatter.estimate === undefined)
  ) {
    throw new Error(
      `complete-step design refused: ticket has no estimate. Run local-board estimate ${ticket.id} POINTS [--basis ID] before completing design (config.estimation.enabled is true).`,
    );
  }

  const now = options.now ?? new Date();
  const frontMatter = withUpdated(
    {
      ...ticket.frontMatter,
      completedSteps: addUnique(asList(ticket.frontMatter.completedSteps), token),
    },
    now,
  );
  const body = appendToSection(
    ticket.body,
    "Run Log",
    `- ${formatIsoSeconds(now)}: Completed ${action} via ${executor}: ${evidence.trim()}`,
  );
  await writeTicketFile(ticket.path, renderMarkdownTicket(frontMatter, body));
  return { ticket: ticket.id, action, executor, path: ticket.path };
}

export async function linkParent(root, childId, parentId, options = {}) {
  const { child, parent } = await findTicketPair(root, childId, parentId, "parent");
  if (child.frontMatter.parent !== null && child.frontMatter.parent !== undefined && child.frontMatter.parent !== parent.id) {
    throw new Error(`ticket ${child.id} already has parent ${child.frontMatter.parent}; unlink it before reparenting`);
  }
  const now = options.now ?? new Date();

  await writeTicketUpdate(child, {
    ...child.frontMatter,
    parent: parent.id,
    updated: formatIsoSeconds(now),
  });
  await writeTicketUpdate(parent, {
    ...parent.frontMatter,
    children: addUnique(asList(parent.frontMatter.children), child.id),
    updated: formatIsoSeconds(now),
  });

  return { childPath: child.path, parentPath: parent.path };
}

export async function unlinkParent(root, childId, parentId, options = {}) {
  const { child, parent } = await findTicketPair(root, childId, parentId, "parent");
  const now = options.now ?? new Date();

  await writeTicketUpdate(child, {
    ...child.frontMatter,
    parent: child.frontMatter.parent === parent.id ? null : child.frontMatter.parent,
    updated: formatIsoSeconds(now),
  });
  await writeTicketUpdate(parent, {
    ...parent.frontMatter,
    children: removeValue(asList(parent.frontMatter.children), child.id),
    updated: formatIsoSeconds(now),
  });

  return { childPath: child.path, parentPath: parent.path };
}

export async function blockTicket(root, ticketId, dependencyId, options = {}) {
  const { child: ticket, parent: dependency } = await findTicketPair(root, ticketId, dependencyId, "dependency");
  const now = options.now ?? new Date();

  await writeTicketUpdate(ticket, {
    ...ticket.frontMatter,
    blockedBy: addUnique(asList(ticket.frontMatter.blockedBy), dependency.id),
    updated: formatIsoSeconds(now),
  });
  await writeTicketUpdate(dependency, {
    ...dependency.frontMatter,
    blocks: addUnique(asList(dependency.frontMatter.blocks), ticket.id),
    updated: formatIsoSeconds(now),
  });

  return { ticketPath: ticket.path, dependencyPath: dependency.path };
}

export async function unblockTicket(root, ticketId, dependencyId, options = {}) {
  const { child: ticket, parent: dependency } = await findTicketPair(root, ticketId, dependencyId, "dependency");
  const now = options.now ?? new Date();

  await writeTicketUpdate(ticket, {
    ...ticket.frontMatter,
    blockedBy: removeValue(asList(ticket.frontMatter.blockedBy), dependency.id),
    updated: formatIsoSeconds(now),
  });
  await writeTicketUpdate(dependency, {
    ...dependency.frontMatter,
    blocks: removeValue(asList(dependency.frontMatter.blocks), ticket.id),
    updated: formatIsoSeconds(now),
  });

  return { ticketPath: ticket.path, dependencyPath: dependency.path };
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
    if (fm.status === "blocked" && asList(fm.blockedBy).length > 0) {
      issues.push(`${ticket.path}: dependency-blocked tickets must stay in their intended ready status; status blocked is for non-ticket blockers`);
    }
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

  if (typeof fm.estimateBasis === "string" && fm.estimateBasis !== "bootstrap" && !TICKET_ID_RE.test(fm.estimateBasis)) {
    issues.push(`${ticket.path}: estimateBasis must be a ticket id or the literal bootstrap`);
  }

  for (const field of ["workStartedAt", "workCompletedAt"]) {
    if (typeof fm[field] === "string" && Number.isNaN(parseDate(fm[field]).getTime())) {
      issues.push(`${ticket.path}: ${field} must be an ISO-8601 datetime with a timezone offset or Z`);
    }
  }

  if (fm.estimate === null && typeof fm.estimateBasis === "string") {
    issues.push(`${ticket.path}: estimateBasis must be null when estimate is null`);
  }

  if (typeof fm.workCompletedAt === "string" && fm.workStartedAt === null) {
    issues.push(`${ticket.path}: workCompletedAt requires workStartedAt to be set`);
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

function validateRouting(ticket, config) {
  const issues = [];
  if (config.routing?.strict !== true) {
    return issues;
  }

  const completed = completedStepRecords(ticket);
  const required = config.routing.doneRequires?.[ticket.type] ?? [];

  for (const record of completed) {
    issues.push(...validateStepRouting(ticket, config, record.action, record.executor));
  }

  if (ticket.status === "done") {
    for (const action of required) {
      if (!completed.some((record) => record.action === action)) {
        issues.push(`${ticket.path}: done ticket is missing completedSteps entry for ${action}`);
      }
    }
  }

  return issues;
}

function validateStepRouting(ticket, config, action, executor) {
  const issues = [];
  if (!isKnownAction(config, action)) {
    return [`${ticket.path}: completedSteps entry uses unknown action ${action}`];
  }
  if (!isValidAgentValue(executor)) {
    return [`${ticket.path}: completedSteps entry for ${action} uses unknown executor ${executor}`];
  }
  const configuredAgent = configuredRouteForAction(config, action);
  const executorRoute = routeOf(executor);
  const approvals = asList(ticket.frontMatter.routingApprovals);
  if (
    configuredAgent !== executorRoute
    && !approvals.includes(stepToken(action, executorRoute))
    && !approvals.includes(stepToken(action, executor))
  ) {
    issues.push(
      `${ticket.path}: ${action} completed by ${executorRoute}, but configured agent is ${configuredAgent}; approve the deviation first`,
    );
  }
  return issues;
}

function completedStepRecords(ticket) {
  return asList(ticket.frontMatter.completedSteps).map((token) => {
    const separator = token.indexOf(":");
    return separator === -1
      ? { action: token, executor: "" }
      : { action: token.slice(0, separator), executor: token.slice(separator + 1) };
  });
}

export function nextTicket(board) {
  const byId = byTicketId(board);
  const eligible = board.tickets.filter((ticket) => isEligible(ticket, byId));
  eligible.sort(compareTicketsForSelection);
  return eligible[0] ?? null;
}

export async function queryNext(root = ".") {
  const [board, config] = await Promise.all([discover(root), loadConfig(root)]);
  const issues = validate(board, config);
  if (issues.length > 0) {
    throw new Error(`ticket validation failed:\n${issues.join("\n")}`);
  }

  const byId = byTicketId(board);
  const eligible = board.tickets.filter((ticket) => isEligibleForConfig(ticket, byId, config));
  eligible.sort((left, right) => compareTicketsForConfig(left, right, config));
  const ticket = eligible[0] ?? null;
  if (ticket === null) {
    return null;
  }

  return actionRecord(board.root, ticket, config, byId);
}

export async function queryReady(root = ".", { limit } = {}) {
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error("--limit must be a positive integer");
  }

  const [board, config] = await Promise.all([discover(root), loadConfig(root)]);
  const issues = validate(board, config);
  if (issues.length > 0) {
    throw new Error(`ticket validation failed:\n${issues.join("\n")}`);
  }

  const byId = byTicketId(board);
  const eligible = board.tickets.filter((ticket) => isEligibleForConfig(ticket, byId, config));
  eligible.sort((left, right) => compareTicketsForConfig(left, right, config));
  const records = eligible.map((ticket) => actionRecord(board.root, ticket, config, byId));
  return limit === undefined ? records : records.slice(0, limit);
}

export async function queryTicket(root = ".", ticketId) {
  const [board, config] = await Promise.all([discover(root), loadConfig(root)]);
  const issues = validate(board, config);
  if (issues.length > 0) {
    throw new Error(`ticket validation failed:\n${issues.join("\n")}`);
  }

  const byId = byTicketId(board);
  const ticket = byId.get(ticketId);
  if (ticket === undefined) {
    throw new Error(`ticket ${ticketId} not found`);
  }
  return actionRecord(board.root, ticket, config, byId);
}

export async function stateReport(root = ".") {
  const [board, config] = await Promise.all([discover(root), loadConfig(root)]);
  const issues = validate(board, config);
  const byId = byTicketId(board);
  const byStatus = {};
  const byType = {};
  const byAction = {};
  let eligible = 0;

  for (const ticket of board.tickets) {
    byStatus[ticket.status] = (byStatus[ticket.status] ?? 0) + 1;
    byType[ticket.type] = (byType[ticket.type] ?? 0) + 1;
    const action = config.workflow.statusActions[ticket.status] ?? "none";
    byAction[action] = (byAction[action] ?? 0) + 1;
    if (isEligibleForConfig(ticket, byId, config)) {
      eligible += 1;
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    total: board.tickets.length,
    eligible,
    byStatus,
    byType,
    byAction,
    next: issues.length === 0 ? await queryNext(root) : null,
  };
}

export async function suggestCalibration(root, ticketId) {
  const { ticket: target } = await findTicket(root, ticketId);
  const board = await discover(root);
  if (board.loadErrors.length > 0) {
    throw new Error(board.loadErrors.join("\n"));
  }

  const pool = board.tickets.filter((candidate) => {
    if (candidate.id === target.id) {
      return false;
    }
    if (candidate.status !== "done") {
      return false;
    }
    if (candidate.type !== target.type) {
      return false;
    }
    const fm = candidate.frontMatter;
    if (fm.estimate === null || fm.estimate === undefined) {
      return false;
    }
    if (typeof fm.workStartedAt !== "string") {
      return false;
    }
    if (typeof fm.workCompletedAt !== "string") {
      return false;
    }
    if (Number.isNaN(Number(fm.estimate))) {
      return false;
    }
    return true;
  });

  if (pool.length === 0) {
    return {
      ticket: target.id,
      calibration: "bootstrap",
      poolSize: 0,
      median: null,
      reason: `No prior calibrated tickets of type ${target.type}`,
    };
  }

  const sortedEstimates = pool.map((entry) => Number(entry.frontMatter.estimate)).sort((left, right) => left - right);
  // Lower-median: for odd n take the middle; for even n take the lower of the two middle entries.
  const medianIndex = Math.floor((sortedEstimates.length - 1) / 2);
  const median = sortedEstimates[medianIndex];

  const ranked = [...pool].sort((left, right) => {
    const leftDiff = Math.abs(Number(left.frontMatter.estimate) - median);
    const rightDiff = Math.abs(Number(right.frontMatter.estimate) - median);
    if (leftDiff !== rightDiff) {
      return leftDiff - rightDiff;
    }
    // Tie-break: most-recent workCompletedAt first. ISO-8601 with Z suffix sorts lexicographically.
    return right.frontMatter.workCompletedAt.localeCompare(left.frontMatter.workCompletedAt);
  });

  const pick = ranked[0];
  const noun = `${target.type}${pool.length === 1 ? "" : "s"}`;
  return {
    ticket: target.id,
    calibration: pick.id,
    poolSize: pool.length,
    median,
    reason: `Closest to median estimate ${median} among ${pool.length} calibrated ${noun}; selected by recency on tie.`,
  };
}

export async function schemaRecord(root = ".") {
  const config = await loadConfig(root);
  return {
    configPath: "plans/local-board.config.jsonc",
    types: Object.fromEntries(TYPE_PREFIXES),
    statuses: [...STATUSES],
    statusFolders: Object.fromEntries(STATUS_FOLDERS),
    triggerStatuses: [...TRIGGER_STATUSES],
    priorities: PRIORITIES,
    actions: [...new Set(Object.values(config.workflow.statusActions))],
    agentValues: schemaAgentValues(),
    claudeAgents: [
      "local-board-decomposer",
      "local-board-designer",
      "local-board-gatecheck",
      "local-board-implementer",
      "local-board-reviewer",
      "local-board-tester",
      "local-board-documenter",
    ],
    workflow: config.workflow,
    agents: config.agents,
    routing: config.routing,
    retention: config.retention,
    git: config.git,
    optionalSteps: config.optionalSteps,
    estimation: config.estimation,
  };
}

export function isEligible(ticket, byId) {
  if (!TRIGGER_STATUSES.has(ticket.status)) {
    return false;
  }

  for (const dependencyId of asList(ticket.frontMatter.blockedBy)) {
    const dependency = byId.get(dependencyId);
    if (dependency === undefined || !isClosedStatus(dependency.status)) {
      return false;
    }
  }

  return true;
}

export function isEligibleForConfig(ticket, byId, config) {
  if (!Object.hasOwn(config.workflow.statusActions, ticket.status)) {
    return false;
  }

  for (const dependencyId of asList(ticket.frontMatter.blockedBy)) {
    const dependency = byId.get(dependencyId);
    if (dependency === undefined || !isClosedStatus(dependency.status)) {
      return false;
    }
  }

  return true;
}

function isClosedStatus(status) {
  return CLOSED_STATUSES.has(status);
}

function actionRecord(root, ticket, config, byId) {
  const action = config.workflow.statusActions[ticket.status] ?? null;
  const configuredAgent = action === null ? null : agentForAction(config, action);
  return {
    // `ticket` is the stable ticket id; CLI ready JSON maps it to `id` for list output clarity.
    ticket: ticket.id,
    type: ticket.type,
    status: ticket.status,
    priority: ticket.priority,
    path: path.relative(root, ticket.path),
    title: ticket.title,
    branch: ticket.frontMatter.branch ?? null,
    action,
    prompt: action === null ? null : promptForAction(config, action),
    agent: configuredAgent,
    model: action === null ? null : modelForAction(config, action),
    routing: action === null
      ? null
      : {
          strict: config.routing?.strict === true,
          delegationRequired: config.routing?.strict === true && configuredAgent !== "inline",
        },
    transitions: transitionsForStatus(config, ticket.status),
    eligible: action === null ? false : isEligibleForConfig(ticket, byId, config),
  };
}

function transitionsForStatus(config, status) {
  const transitions = config.workflow?.transitions?.[status];
  return Array.isArray(transitions) ? transitions : [];
}

function compareTicketsForSelection(left, right) {
  return (
    priorityRank(left) - priorityRank(right) ||
    parseDate(left.frontMatter.created) - parseDate(right.frontMatter.created) ||
    left.id.localeCompare(right.id)
  );
}

export function compareTicketsForConfig(left, right, config) {
  return (
    priorityRank(left) - priorityRank(right) ||
    pipelineRank(left, config) - pipelineRank(right, config) ||
    parseDate(left.frontMatter.created) - parseDate(right.frontMatter.created) ||
    left.id.localeCompare(right.id)
  );
}

function pipelineRank(ticket, config) {
  const index = config.workflow.pipelineOrder.indexOf(ticket.status);
  return index === -1 ? config.workflow.pipelineOrder.length : index;
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

  const board = await discover(root);
  const loadErrors = board.loadErrors.filter((error) => !error.endsWith(": missing ticket directory"));
  if (loadErrors.length > 0) {
    throw new Error(loadErrors.join("\n"));
  }
  const byId = byTicketId(board);
  if (parent !== null && !byId.has(parent)) {
    throw new Error(`parent ${parent} does not exist`);
  }

  const offsetMinutes = options.now === undefined ? await ticketWorktreeMintOffsetMinutes(root) : 0;
  const start = offsetMinutes > 0 ? new Date(now.getTime() + offsetMinutes * 60_000) : now;
  const timestamp = nextAvailableTimestamp(board, ticketType, start);
  const ticketId = `${TYPE_PREFIXES.get(ticketType)}${formatTicketTimestamp(timestamp)}`;
  const slug = slugify(title);
  const folder = path.resolve(root, "plans", "tickets", STATUS_FOLDERS.get(status));
  const ticketPath = path.join(folder, `${ticketId}_${slug}.md`);
  const created = formatIsoSeconds(timestamp);

  await mkdir(folder, { recursive: true });
  await writeFile(ticketPath, renderTicket(ticketId, ticketType, status, priority, parent, created, title), {
    encoding: "utf8",
    flag: "wx",
  });

  if (parent !== null) {
    await linkParent(root, ticketId, parent, { now: timestamp });
  }

  return ticketPath;
}

function nextAvailableTimestamp(board, ticketType, start) {
  const prefix = TYPE_PREFIXES.get(ticketType);
  let timestamp = new Date(start);
  const usedIds = new Set(board.tickets.map((ticket) => ticket.id));
  while (usedIds.has(`${prefix}${formatTicketTimestamp(timestamp)}`)) {
    timestamp = new Date(timestamp.getTime() + 60_000);
  }
  return timestamp;
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
estimateBasis: null
workStartedAt: null
workCompletedAt: null
completedSteps: []
routingApprovals: []
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

export function renderMarkdownTicket(frontMatter, body) {
  const normalizedBody = body.startsWith("\n") ? body : `\n${body}`;
  const trailingBody = normalizedBody.endsWith("\n") ? normalizedBody : `${normalizedBody}\n`;
  return `---\n${serializeFrontMatter(frontMatter)}---${trailingBody}`;
}

export function serializeFrontMatter(frontMatter) {
  const orderedKeys = [
    ...CANONICAL_FIELDS.filter((field) => Object.hasOwn(frontMatter, field)),
    ...Object.keys(frontMatter)
      .filter((field) => !CANONICAL_FIELDS.includes(field))
      .sort(),
  ];
  return orderedKeys.map((field) => `${field}: ${formatScalar(frontMatter[field])}\n`).join("");
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

function assertAction(config, action) {
  if (!isKnownAction(config, action)) {
    const mandatory = [...new Set(Object.values(config.workflow.statusActions))].sort();
    throw new Error(
      `action must be a mandatory action (${mandatory.join(", ")}) or a configured optional specialty step`,
    );
  }
}

// Find an optional specialty step entry by name across all stages.
function optionalStepEntry(config, name) {
  const stages = config.optionalSteps ?? {};
  for (const stage of Object.keys(stages)) {
    const list = Array.isArray(stages[stage]) ? stages[stage] : [];
    const entry = list.find((candidate) => candidate && candidate.name === name);
    if (entry) {
      return entry;
    }
  }
  return null;
}

function isKnownAction(config, action) {
  const actions = new Set(Object.values(config.workflow.statusActions));
  return actions.has(action) || optionalStepEntry(config, action) !== null;
}

// The configured route for an action: mandatory actions use the agents map;
// optional specialty steps use their catalog entry's `agent` (default inline).
function configuredRouteForAction(config, action) {
  const actions = new Set(Object.values(config.workflow.statusActions));
  if (actions.has(action)) {
    return agentForAction(config, action);
  }
  const entry = optionalStepEntry(config, action);
  return entry ? entry.agent ?? "inline" : "inline";
}

// Resolve the full normalized profile { route, model?, prompt? } for an action.
function profileForAction(config, action) {
  const entry = config.agents[action] ?? config.agents.default ?? { route: "inline" };
  return typeof entry === "string" ? { route: entry } : entry;
}

// agentForAction returns just the route string so all existing routing and
// evidence comparisons keep working unchanged. Per-step model lives alongside it.
function agentForAction(config, action) {
  return profileForAction(config, action).route;
}

function modelForAction(config, action) {
  return profileForAction(config, action).model ?? null;
}

function promptForAction(config, action) {
  return (
    profileForAction(config, action).prompt
    ?? config.workflow?.actionPrompts?.[action]
    ?? null
  );
}

function schemaAgentValues() {
  return [
    "inline",
    "claude-subagent:<agent-name>",
    "codex-task:<mode>",
    "<route>@<model> (completion evidence may pin the model that ran)",
  ];
}

// An executor string is a route optionally suffixed with @<model> to record the
// model that actually ran. Routing comparisons use the route part only.
function routeOf(value) {
  const at = value.indexOf("@");
  return at === -1 ? value : value.slice(0, at);
}

function isValidAgentValue(value) {
  if (typeof value !== "string") {
    return false;
  }
  const at = value.indexOf("@");
  const route = at === -1 ? value : value.slice(0, at);
  const model = at === -1 ? null : value.slice(at + 1);
  const routeValid =
    route === "inline" ||
    /^codex-task:[a-z0-9][a-z0-9-]*$/.test(route) ||
    /^claude-subagent:[a-z0-9][a-z0-9-]*$/.test(route);
  if (!routeValid) {
    return false;
  }
  if (model === null) {
    return true;
  }
  // inline runs on the orchestrator's own model and cannot pin one.
  if (route === "inline") {
    return false;
  }
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(model);
}

function stepToken(action, executor) {
  return `${action}:${executor}`;
}

function assertFieldValue(field, value) {
  if (LIST_FIELDS.includes(field) && !Array.isArray(value)) {
    throw new Error(`${field} must be a list`);
  }
  if (NULLABLE_FIELDS.includes(field) && value !== null && typeof value !== "string") {
    throw new Error(`${field} must be null or a string`);
  }
  if (field === "priority" && !PRIORITIES.includes(value)) {
    throw new Error(`priority must be one of ${PRIORITIES.join(", ")}`);
  }
}

function appendToSection(body, section, line) {
  const sectionRe = new RegExp(`(^## ${escapeRegExp(section)}\\s*$)`, "m");
  const match = body.match(sectionRe);
  if (match === null || match.index === undefined) {
    throw new Error(`section "${section}" not found`);
  }

  const sectionStart = match.index + match[0].length;
  const nextSection = body.slice(sectionStart).search(/\n## /);
  const insertAt = nextSection === -1 ? body.length : sectionStart + nextSection;
  const before = body.slice(0, insertAt).replace(/\s*$/, "\n\n");
  const after = body.slice(insertAt);
  return `${before}${line}\n${after}`;
}

export function getSectionText(body, section) {
  const sectionRe = new RegExp(`(^## ${escapeRegExp(section)}\\s*$)`, "m");
  const match = body.match(sectionRe);
  if (match === null || match.index === undefined) {
    return null;
  }

  const sectionStart = match.index + match[0].length;
  const nextSection = body.slice(sectionStart).search(/\n## /);
  const endAt = nextSection === -1 ? body.length : sectionStart + nextSection;
  return body.slice(sectionStart, endAt).trim();
}

function replaceSection(body, section, text) {
  const sectionRe = new RegExp(`(^## ${escapeRegExp(section)}\\s*$)`, "m");
  const match = body.match(sectionRe);
  if (match === null || match.index === undefined) {
    throw new Error(`section "${section}" not found`);
  }

  const sectionStart = match.index + match[0].length;
  const nextSection = body.slice(sectionStart).search(/\n## /);
  const insertAt = nextSection === -1 ? body.length : sectionStart + nextSection;
  const before = body.slice(0, sectionStart).replace(/\s*$/, "");
  const after = body.slice(insertAt).replace(/^\n*/, "");
  const sectionBody = text === "" ? "" : `\n\n${text}`;
  return after === "" ? `${before}${sectionBody}\n` : `${before}${sectionBody}\n\n${after}`;
}

function withUpdated(frontMatter, now = new Date()) {
  return { ...frontMatter, updated: formatIsoSeconds(now) };
}

async function findTicketPair(root, leftId, rightId, rightLabel) {
  if (leftId === rightId) {
    throw new Error(`ticket cannot be linked to itself as ${rightLabel}`);
  }

  const board = await discover(root);
  if (board.loadErrors.length > 0) {
    throw new Error(board.loadErrors.join("\n"));
  }
  const byId = byTicketId(board);
  const child = byId.get(leftId);
  const parent = byId.get(rightId);
  if (child === undefined) {
    throw new Error(`ticket ${leftId} not found`);
  }
  if (parent === undefined) {
    throw new Error(`ticket ${rightId} not found`);
  }
  return { board, child, parent };
}

async function writeTicketUpdate(ticket, frontMatter) {
  await writeTicketFile(ticket.path, renderMarkdownTicket(frontMatter, ticket.body));
}

function addUnique(values, value) {
  return values.includes(value) ? values : [...values, value];
}

function removeValue(values, value) {
  return values.filter((item) => item !== value);
}

function formatScalar(value) {
  if (value === null || value === undefined) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => formatListItem(item)).join(", ")}]`;
  }
  return formatString(String(value));
}

function formatListItem(value) {
  return formatString(String(value));
}

function formatString(value) {
  if (/^[A-Za-z0-9_./:+-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
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

export function formatIsoSeconds(date) {
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
