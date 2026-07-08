import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { clearActiveStep, stampActiveStep } from "./active-steps.js";
import { loadConfig, OPTIONAL_STEP_STAGES } from "./config.js";
import { withOrderedTicketLocks, withTicketLock } from "./lock.js";
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

// Gate-consultation tokens (`gate:<stage>:<executor>`) record that gate-check
// was actually consulted for a design/implement/test stage, distinct from a
// specialty step's own completedSteps evidence. They deliberately live in the
// same `completedSteps` list (per the requirement) but must never be parsed
// as routing evidence: completedStepRecords/validateStepRouting split on the
// FIRST ":", which would otherwise mis-parse "gate:design:skipped-empty-catalog"
// as action="gate", executor="design:skipped-empty-catalog" and trip a
// spurious "unknown action gate" issue at done-time validation.
const GATE_TOKEN_RE = /^gate:(design|implement|test):(.+)$/;
const GATE_SKIPPED_EMPTY_CATALOG_EXECUTOR = "skipped-empty-catalog";

// The three forward transitions that require a recorded gate consultation for
// the stage just completed (when config.routing.requireGateConsultation is
// true). Backward, lateral (questions/blocked), and archive/done moves are
// never gated: only these exact from/to pairs return non-null.
const GATE_FORWARD_TRANSITIONS = [
  { from: new Set(["ready_for_design", "designing"]), to: "ready_for_implementation", stage: "design" },
  { from: new Set(["ready_for_implementation", "implementing"]), to: "ready_for_review", stage: "implement" },
  { from: new Set(["ready_for_test", "testing"]), to: "ready_for_docs", stage: "test" },
];

function gateToken(stage, executor) {
  return `gate:${stage}:${executor}`;
}

function isGateToken(token) {
  return GATE_TOKEN_RE.test(token);
}

// Parses gate-consultation tokens out of a ticket's completedSteps, returning
// { stage, executor } records. These are intentionally excluded from
// completedStepRecords (routing evidence) — see the comment on GATE_TOKEN_RE.
export function gateConsultationRecords(ticket) {
  const records = [];
  for (const token of asList(ticket.frontMatter.completedSteps)) {
    const match = GATE_TOKEN_RE.exec(token);
    if (match !== null) {
      records.push({ stage: match[1], executor: match[2] });
    }
  }
  return records;
}

// Returns the stage ("design" | "implement" | "test") that must have a
// recorded gate consultation before this exact forward move is allowed, or
// null when the move is not one of the three gated forward pairs (including
// all backward, lateral, and archive/done moves).
export function gateStageForForwardMove(fromStatus, toStatus) {
  for (const transition of GATE_FORWARD_TRANSITIONS) {
    if (transition.from.has(fromStatus) && transition.to === toStatus) {
      return transition.stage;
    }
  }
  return null;
}

// Fixed structural mapping from a gate/optional-step "stage" name to the
// ready_* status that produces evidence for it. This is deliberately NOT
// derived from config.workflow.statusActions: OPTIONAL_STEP_STAGES and
// GATE_TOKEN_RE stages are always exactly {design, implement, test}
// regardless of how a config renames its mandatory actions.
const STAGE_TO_STATUS = {
  design: "ready_for_design",
  implement: "ready_for_implementation",
  test: "ready_for_test",
};

// Active in-flight statuses have no statusActions entry of their own; they
// resolve their action through the ready_* status they were promoted from,
// so `begin-step` works before OR after `start-work` moves the ticket into
// its active status. Kept structural (not config-derived) for the same
// reason as STAGE_TO_STATUS: the active<->ready pairing is fixed regardless
// of how a config renames its mandatory actions.
const ACTIVE_STATUS_TO_READY = {
  designing: "ready_for_design",
  implementing: "ready_for_implementation",
  reviewing: "ready_for_review",
  testing: "ready_for_test",
};

// Fixed structural allow-set for the hard transition validator
// (routing.enforceTransitions). These are administrative/escape moves that
// are not pipeline decisions, so they are never surfaced as advisory
// `transitions` guidance (see transitionsForStatus) and are always permitted
// when enforcement is on, independent of config.workflow.transitions:
//   1. fromStatus === toStatus (idempotent re-save).
//   2. backlog -> any trigger (ready_*) status (promote out of backlog).
//   3. ready_* -> its paired active status, the inverse of
//      ACTIVE_STATUS_TO_READY (start-work).
//   4. an active status -> its own ready_* (revert/back-out), i.e.
//      ACTIVE_STATUS_TO_READY direct.
//   5. questions/blocked -> any trigger status (resume; origin is not
//      tracked, so any ready_* is allowed).
//   6. any status -> archived (supersede + retention done -> archived).
//   7. any status -> questions and any status -> blocked (escape hatches from
//      any state).
function isStructurallyAllowed(fromStatus, toStatus) {
  if (fromStatus === toStatus) {
    return true;
  }
  if (fromStatus === "backlog" && TRIGGER_STATUSES.has(toStatus)) {
    return true;
  }
  if (ACTIVE_STATUS_TO_READY[toStatus] === fromStatus) {
    return true;
  }
  if (ACTIVE_STATUS_TO_READY[fromStatus] === toStatus) {
    return true;
  }
  if ((fromStatus === "questions" || fromStatus === "blocked") && TRIGGER_STATUSES.has(toStatus)) {
    return true;
  }
  if (toStatus === "archived" || toStatus === "questions" || toStatus === "blocked") {
    return true;
  }
  return false;
}

// The hard validator predicate for routing.enforceTransitions: true when the
// move is either in the fixed structural allow-set above, or toStatus is one
// of the `.status` values configured for fromStatus in
// config.workflow.transitions (the pipeline-ordering authority).
export function isTransitionAllowed(config, fromStatus, toStatus) {
  if (isStructurallyAllowed(fromStatus, toStatus)) {
    return true;
  }
  const mapEntries = config.workflow?.transitions?.[fromStatus];
  if (!Array.isArray(mapEntries)) {
    return false;
  }
  return mapEntries.some((entry) => entry.status === toStatus);
}

// Computes the allowed-targets list for a refusal error message: map targets
// for fromStatus (in map order) followed by any applicable structural targets
// not already listed, de-duplicated. The self-transition (fromStatus itself)
// is intentionally omitted — it is allowed but not a useful "did you mean"
// suggestion.
function allowedTargetsFor(config, fromStatus) {
  const targets = [];
  const seen = new Set();
  const add = (candidate) => {
    if (!seen.has(candidate)) {
      seen.add(candidate);
      targets.push(candidate);
    }
  };

  const mapEntries = config.workflow?.transitions?.[fromStatus];
  if (Array.isArray(mapEntries)) {
    for (const entry of mapEntries) {
      add(entry.status);
    }
  }

  if (fromStatus === "backlog") {
    for (const status of TRIGGER_STATUSES) {
      add(status);
    }
  }
  const pairedActive = Object.keys(ACTIVE_STATUS_TO_READY).find(
    (active) => ACTIVE_STATUS_TO_READY[active] === fromStatus,
  );
  if (pairedActive !== undefined) {
    add(pairedActive);
  }
  if (ACTIVE_STATUS_TO_READY[fromStatus] !== undefined) {
    add(ACTIVE_STATUS_TO_READY[fromStatus]);
  }
  if (fromStatus === "questions" || fromStatus === "blocked") {
    for (const status of TRIGGER_STATUSES) {
      add(status);
    }
  }
  add("archived");
  add("questions");
  add("blocked");

  return targets;
}

// Rank of a raw status string within config.workflow.pipelineOrder, or null
// when the status is not in the pipeline (e.g. questions/blocked/done/active
// statuses). Lower rank = closer to done. Distinct from the ticket-based
// pipelineRank below (which falls back to pipelineOrder.length for sorting).
function pipelineRankOfStatus(status, config) {
  const index = config.workflow.pipelineOrder.indexOf(status);
  return index === -1 ? null : index;
}

// Inverts config.workflow.statusActions (status -> action) to action ->
// status, so a mandatory action token can be mapped back to the ready_*
// status that produced it. Computed fresh per call: cheap, and config can
// legitimately differ between calls (tests reload config per case).
function invertStatusActions(config) {
  const actionToStatus = {};
  for (const [status, action] of Object.entries(config.workflow.statusActions)) {
    actionToStatus[action] = status;
  }
  return actionToStatus;
}

// Resolves the producing ready_* status for a single completedSteps or
// routingApprovals token, or null when the token cannot be placed (unknown
// action; defensive — never strip what we cannot place). Handles all three
// token grammars: gate:<stage>:<executor>, mandatory <action>:<executor>,
// and optional specialty <name>:<executor>.
function producingStatusForToken(token, config, actionToStatus) {
  const gateMatch = GATE_TOKEN_RE.exec(token);
  if (gateMatch !== null) {
    return STAGE_TO_STATUS[gateMatch[1]] ?? null;
  }

  const separator = token.indexOf(":");
  const action = separator === -1 ? token : token.slice(0, separator);

  if (Object.hasOwn(actionToStatus, action)) {
    return actionToStatus[action];
  }

  const entry = optionalStepEntry(config, action);
  if (entry !== null) {
    return STAGE_TO_STATUS[entry.stage] ?? null;
  }

  return null;
}

// Pure core of the loop-back invalidation: strips completedSteps/
// routingApprovals tokens whose producing status ranks at-or-downstream of
// targetStatus (target-inclusive: pipelineRank(producing) <= pipelineRank(target)).
// Returns the reduced lists plus exactly what was removed, for the Run Log
// enumeration. A no-op (empty removed lists, unchanged input lists) when
// targetStatus has no pipeline rank (not a ready_* pipeline status).
export function invalidateDownstreamEvidence(frontMatter, config, targetStatus) {
  const completedStepsIn = asList(frontMatter.completedSteps);
  const routingApprovalsIn = asList(frontMatter.routingApprovals);
  const targetRank = pipelineRankOfStatus(targetStatus, config);

  if (targetRank === null) {
    return {
      completedSteps: completedStepsIn,
      routingApprovals: routingApprovalsIn,
      removed: { completedSteps: [], routingApprovals: [] },
    };
  }

  const actionToStatus = invertStatusActions(config);
  const isAtOrDownstreamOfTarget = (token) => {
    const producingStatus = producingStatusForToken(token, config, actionToStatus);
    if (producingStatus === null) {
      return false;
    }
    const rank = pipelineRankOfStatus(producingStatus, config);
    return rank !== null && rank <= targetRank;
  };

  const removedCompletedSteps = [];
  const completedSteps = completedStepsIn.filter((token) => {
    if (isAtOrDownstreamOfTarget(token)) {
      removedCompletedSteps.push(token);
      return false;
    }
    return true;
  });

  const removedApprovals = [];
  const routingApprovals = routingApprovalsIn.filter((token) => {
    if (isAtOrDownstreamOfTarget(token)) {
      removedApprovals.push(token);
      return false;
    }
    return true;
  });

  return {
    completedSteps,
    routingApprovals,
    removed: { completedSteps: removedCompletedSteps, routingApprovals: removedApprovals },
  };
}

// Formats the single Run Log line enumerating exactly what a loop-back move
// stripped (the firm audit-trail requirement for the strip-vs-timestamp
// design decision). Only called when at least one list is non-empty.
function invalidationRunLogMessage(targetStatus, removed) {
  const parts = [];
  if (removed.completedSteps.length > 0) {
    parts.push(`completedSteps [${removed.completedSteps.join(", ")}]`);
  }
  if (removed.routingApprovals.length > 0) {
    parts.push(`routingApprovals [${removed.routingApprovals.join(", ")}]`);
  }
  return `Invalidated downstream evidence on loop-back to ${targetStatus}: removed ${parts.join("; ")}.`;
}

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

  // Locks the whole read (findTicket) -> write/rename span: a concurrent
  // mutation of the same ticket (e.g. a Run Log comment) racing this rename
  // would otherwise read the same stale frontMatter and clobber this write.
  return withTicketLock(
    root,
    ticketId,
    async () => {
      const now = options.now ?? new Date();
      const { board, ticket } = await findTicket(root, ticketId);
      if (options.__afterRead) {
        await options.__afterRead();
      }

      // Config is needed on nearly every call now that the hard transition
      // validator (routing.enforceTransitions, checked first below) runs
      // unconditionally; load it once up front instead of the old
      // needsConfig gate (it was already loaded for gated/done/trigger moves).
      const config = await loadConfig(board.root);
      let body = ticket.body;

      // Hard transition validator: the FIRST gate, before the gate-consultation
      // precondition and before loop-back invalidation, so a refused move has
      // zero side effects (nothing written, nothing stripped, no folder
      // created — moveTicket performs no fs mutation until the mkdir/rename
      // block near the end). isTransitionAllowed treats a same-status move as
      // always allowed (idempotent re-save).
      if (config.routing?.enforceTransitions === true && !isTransitionAllowed(config, ticket.status, status)) {
        if (options.overrideTransition) {
          const reason = options.overrideTransition.reason;
          const suffix = reason ? `: ${reason}` : "";
          body = appendToSection(
            body,
            "Run Log",
            `- ${formatIsoSeconds(now)}: Transition override: ${ticket.status} -> ${status}${suffix}`,
          );
        } else {
          const allowed = allowedTargetsFor(config, ticket.status);
          throw new Error(
            `${ticket.path}: move refused: transition ${ticket.status} -> ${status} is not allowed. ` +
              `Allowed targets: ${allowed.join(", ")}. Re-run with --override --reason <text> to force this ` +
              `transition (it will be recorded in the Run Log), or set routing.enforceTransitions to false for ` +
              `advisory-only mode.`,
          );
        }
      }

      const gateStage = gateStageForForwardMove(ticket.status, status);
      if (gateStage !== null && config.routing?.requireGateConsultation === true) {
        const consulted = gateConsultationRecords(ticket).some((record) => record.stage === gateStage);
        if (!consulted) {
          throw new Error(
            `${ticket.path}: move refused: ticket ${ticket.id} has no recorded gate consultation for stage "${gateStage}". ` +
              `Run "gate-check ${ticket.id} --stage ${gateStage}" first; if the catalog is non-empty, dispatch the gate agent ` +
              `and record the result with "gate-complete ${ticket.id} --stage ${gateStage} --executor <route> --evidence <summary>" ` +
              `before moving to ${status}.`,
          );
        }
      }

      // Strip stale downstream evidence on a loop-back move, inside this same
      // lock/read span, before front matter is rendered. Guarded on the
      // target (not the source): only ready_* pipeline statuses trigger it,
      // which excludes questions/blocked/done/archived/active targets. A
      // no-op (no front-matter change, no Run Log line) when nothing at or
      // downstream of the target has recorded evidence yet (ordinary forward
      // moves stay byte-identical).
      let nextFrontMatter = { ...ticket.frontMatter, status };
      if (config.routing?.invalidateOnLoopBack === true && TRIGGER_STATUSES.has(status)) {
        const invalidation = invalidateDownstreamEvidence(ticket.frontMatter, config, status);
        if (invalidation.removed.completedSteps.length > 0 || invalidation.removed.routingApprovals.length > 0) {
          nextFrontMatter = {
            ...nextFrontMatter,
            completedSteps: invalidation.completedSteps,
            routingApprovals: invalidation.routingApprovals,
          };
          body = appendToSection(
            body,
            "Run Log",
            `- ${formatIsoSeconds(now)}: ${invalidationRunLogMessage(status, invalidation.removed)}`,
          );
        }
      }

      const frontMatter = withUpdated(nextFrontMatter, now);
      if (
        status === "done" &&
        frontMatter.workCompletedAt === null &&
        typeof frontMatter.workStartedAt === "string"
      ) {
        frontMatter.workCompletedAt = formatIsoSeconds(now);
      }
      if (status === "done") {
        const issues = validateRouting({ ...ticket, status, frontMatter }, config);
        if (issues.length > 0) {
          throw new Error(`routing validation failed:\n${issues.join("\n")}`);
        }
      }
      const content = renderMarkdownTicket(frontMatter, body);
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
    },
    options.lock,
  );
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

  // Locks the read (findTicket) -> write span so a concurrent mutation of the
  // same ticket (e.g. a Run Log comment or complete-step) cannot read the
  // same stale frontMatter and clobber this write.
  return withTicketLock(
    root,
    ticketId,
    async () => {
      const { ticket } = await findTicket(root, ticketId);
      if (options.__afterRead) {
        await options.__afterRead();
      }
      const frontMatter = withUpdated({ ...ticket.frontMatter, [field]: value }, options.now);
      await writeTicketFile(ticket.path, renderMarkdownTicket(frontMatter, ticket.body));
      return ticket.path;
    },
    options.lock,
  );
}

export async function appendTicketComment(root, ticketId, section, text, options = {}) {
  if (text.trim() === "") {
    throw new Error("comment text is required");
  }

  // See setTicketField: locks the read -> write span (this is the acceptance
  // scenario's "Run Log comment landing while a complete-step is in flight").
  return withTicketLock(
    root,
    ticketId,
    async () => {
      const { ticket } = await findTicket(root, ticketId);
      if (options.__afterRead) {
        await options.__afterRead();
      }
      const body = appendToSection(
        ticket.body,
        section,
        `- ${formatIsoSeconds(options.now ?? new Date())}: ${text.trim()}`,
      );
      const frontMatter = withUpdated({ ...ticket.frontMatter }, options.now);
      await writeTicketFile(ticket.path, renderMarkdownTicket(frontMatter, body));
      return ticket.path;
    },
    options.lock,
  );
}

export async function setTicketSection(root, ticketId, section, text, options = {}) {
  return withTicketLock(
    root,
    ticketId,
    async () => {
      const { ticket } = await findTicket(root, ticketId);
      if (options.__afterRead) {
        await options.__afterRead();
      }
      const body = replaceSection(ticket.body, section, text.trim());
      const frontMatter = withUpdated({ ...ticket.frontMatter }, options.now);
      await writeTicketFile(ticket.path, renderMarkdownTicket(frontMatter, body));
      return ticket.path;
    },
    options.lock,
  );
}

// Pure core shared by `beginStep` and `resolveExpectedStep`: resolves a
// ticket's configured action against an already-loaded board/config, without
// touching the ledger or requiring board-wide validation to pass.
function resolveStepFromBoard(board, config, ticketId, actionOverride) {
  const ticket = byTicketId(board).get(ticketId);
  if (ticket === undefined) {
    throw new Error(`ticket ${ticketId} not found`);
  }

  const readyStatus = ACTIVE_STATUS_TO_READY[ticket.status] ?? ticket.status;
  const action =
    actionOverride ??
    config.workflow.statusActions[ticket.status] ??
    config.workflow.statusActions[readyStatus] ??
    null;
  if (action === null) {
    throw new Error(`ticket ${ticketId} has no configured action for status ${ticket.status}`);
  }

  assertAction(config, action);
  return { ticket, action };
}

// Read-only resolver for a ticket's expected step (action/route/model), used
// by `check-dispatch` when no ledger record exists yet for the ticket. Never
// stamps the ledger and does not require the whole board to validate cleanly
// (a hook must not go blind because an unrelated ticket has an issue).
export async function resolveExpectedStep(root, ticketId, actionOverride = null) {
  const [board, config] = await Promise.all([discover(root), loadConfig(root)]);
  const { ticket, action } = resolveStepFromBoard(board, config, ticketId, actionOverride);
  return {
    ticket: ticket.id,
    action,
    status: ticket.status,
    route: agentForAction(config, action),
    model: modelForAction(config, action),
  };
}

export async function beginStep(root, ticketId, actionOverride = null) {
  const [board, config] = await Promise.all([discover(root), loadConfig(root)]);
  const issues = validate(board, config);
  if (issues.length > 0) {
    throw new Error(`ticket validation failed:\n${issues.join("\n")}`);
  }

  const { ticket, action } = resolveStepFromBoard(board, config, ticketId, actionOverride);
  const configuredAgent = agentForAction(config, action);
  const configuredModel = modelForAction(config, action);

  const result = {
    ticket: ticket.id,
    action,
    status: ticket.status,
    transitions: transitionsForStatus(config, ticket.status),
    configuredAgent,
    configuredModel,
    configuredPrompt: promptForAction(config, action),
    strict: config.routing?.strict === true,
    delegationRequired: config.routing?.strict === true && configuredAgent !== "inline",
    branch: ticket.frontMatter.branch ?? null,
    path: path.relative(board.root, ticket.path),
  };

  // Additive side effect (unconditional, idempotent): stamps this ticket's
  // in-flight step so `check-dispatch` (T20260707T1325Z) can verify a later
  // Task dispatch against it. `begin-step`'s return shape is unchanged.
  await stampActiveStep(root, ticket.id, {
    ticket: ticket.id,
    action,
    route: configuredAgent,
    model: configuredModel,
    root: path.resolve(root),
    ts: formatIsoSeconds(new Date()),
  });

  return result;
}

export async function approveInline(root, ticketId, action, reason, options = {}) {
  if (reason.trim() === "") {
    throw new Error("approve-inline requires a non-empty reason");
  }

  const executor = options.executor ?? "inline";
  const config = await loadConfig(root);
  assertAction(config, action);
  if (!isValidAgentValue(executor)) {
    throw new Error(`executor must be one of ${schemaAgentValues().join(", ")}`);
  }

  // Locks the read (findTicket) -> write span, same rationale as
  // setTicketField/appendTicketComment.
  const result = await withTicketLock(
    root,
    ticketId,
    async () => {
      const { ticket } = await findTicket(root, ticketId);
      if (options.__afterRead) {
        await options.__afterRead();
      }
      const token = stepToken(action, executor);
      const now = options.now ?? new Date();
      const frontMatter = withUpdated(
        {
          ...ticket.frontMatter,
          routingApprovals: addUnique(asList(ticket.frontMatter.routingApprovals), token),
        },
        now,
      );
      const logMessage = executor === "inline"
        ? `Approved inline ${action}: ${reason.trim()}`
        : `Approved routing deviation for ${action}: ${executor}: ${reason.trim()}`;
      const body = appendToSection(ticket.body, "Run Log", `- ${formatIsoSeconds(now)}: ${logMessage}`);
      await writeTicketFile(ticket.path, renderMarkdownTicket(frontMatter, body));
      return { ticket: ticket.id, action, approvedExecutor: executor, path: ticket.path };
    },
    options.lock,
  );
  await clearActiveStep(root, result.ticket).catch(() => {});
  return result;
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

  // Locks the read (findTicket) -> write span: the acceptance scenario this
  // closes is exactly a Run Log comment (appendTicketComment) racing this
  // complete-step on the same ticket.
  const result = await withTicketLock(
    root,
    ticketId,
    async () => {
      const { ticket } = await findTicket(root, ticketId);
      if (options.__afterRead) {
        await options.__afterRead();
      }
      const token = stepToken(action, executor);
      const routingIssues = validateStepRouting(ticket, config, action, executor, { enforceModel: true });
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
    },
    options.lock,
  );
  await clearActiveStep(root, result.ticket).catch(() => {});
  return result;
}

// Idempotent low-level writer shared by recordGateConsultation and the
// empty-catalog auto-stamp: adds a gate token to completedSteps via
// addUnique (safe to re-run) and, when a Run Log line is supplied, appends
// it in the same locked span.
async function stampGateToken(root, ticketId, token, runLogLine, options = {}) {
  return withTicketLock(
    root,
    ticketId,
    async () => {
      const { ticket } = await findTicket(root, ticketId);
      if (options.__afterRead) {
        await options.__afterRead();
      }
      const now = options.now ?? new Date();
      const frontMatter = withUpdated(
        {
          ...ticket.frontMatter,
          completedSteps: addUnique(asList(ticket.frontMatter.completedSteps), token),
        },
        now,
      );
      const body = runLogLine === null ? ticket.body : appendToSection(ticket.body, "Run Log", runLogLine);
      await writeTicketFile(ticket.path, renderMarkdownTicket(frontMatter, body));
      return ticket.path;
    },
    options.lock,
  );
}

// Called by `gate-check` on the empty-catalog branch only (the CLI's own "no
// dispatch" path — B1320): records that the CLI itself determined there was
// nothing to consult for this stage. No Run Log line: this is a deterministic,
// idempotent CLI side effect, not an agent's recorded verdict.
export async function recordGateSkippedEmptyCatalog(root, ticketId, stage, options = {}) {
  if (!OPTIONAL_STEP_STAGES.includes(stage)) {
    throw new Error(`stage must be one of ${OPTIONAL_STEP_STAGES.join(", ")}`);
  }
  const token = gateToken(stage, GATE_SKIPPED_EMPTY_CATALOG_EXECUTOR);
  const writtenPath = await stampGateToken(root, ticketId, token, null, options);
  return { ticket: ticketId, stage, path: writtenPath };
}

// Backs the `gate-complete` verb: records that a gate agent actually
// consulted and answered for `stage`, after the orchestrator has already
// received that answer. This is the only producer of a non-empty-catalog gate
// token, so the token means "a consultation actually produced a result" (see
// the rejected fetch-time-stamp alternative in the ticket's Technical Design).
export async function recordGateConsultation(root, ticketId, stage, executor, evidence, options = {}) {
  if (!OPTIONAL_STEP_STAGES.includes(stage)) {
    throw new Error(`stage must be one of ${OPTIONAL_STEP_STAGES.join(", ")}`);
  }
  if (!isValidAgentValue(executor)) {
    throw new Error(`executor must be one of ${schemaAgentValues().join(", ")}`);
  }
  if (evidence.trim() === "") {
    throw new Error("gate-complete requires non-empty evidence");
  }

  const token = gateToken(stage, executor);
  const now = options.now ?? new Date();
  const runLogLine = `- ${formatIsoSeconds(now)}: Gate consultation ${stage} via ${executor}: ${evidence.trim()}`;
  const writtenPath = await stampGateToken(root, ticketId, token, runLogLine, { ...options, now });
  return { ticket: ticketId, stage, executor, path: writtenPath };
}

// linkParent/unlinkParent/blockTicket/unblockTicket each read-then-write two
// ticket files with no atomicity across the pair. Acquiring both ticket locks
// in sorted-id order (withOrderedTicketLocks) prevents a concurrent writer to
// either file from clobbering the other's half of the pair. It does NOT give
// two-file crash atomicity: a power-loss between the two renames can still
// leave a half-link. That residual is accepted because both halves are
// idempotent (addUnique, and linkParent's parent !== null guard tolerates a
// re-run) and self-healing: validateLinks flags either half, and re-running
// the same link/block command completes the missing side.
export async function linkParent(root, childId, parentId, options = {}) {
  return withOrderedTicketLocks(
    root,
    childId,
    parentId,
    async () => {
      const { child, parent } = await findTicketPair(root, childId, parentId, "parent");
      if (
        child.frontMatter.parent !== null
        && child.frontMatter.parent !== undefined
        && child.frontMatter.parent !== parent.id
      ) {
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
    },
    options.lock,
  );
}

export async function unlinkParent(root, childId, parentId, options = {}) {
  return withOrderedTicketLocks(
    root,
    childId,
    parentId,
    async () => {
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
    },
    options.lock,
  );
}

export async function blockTicket(root, ticketId, dependencyId, options = {}) {
  return withOrderedTicketLocks(
    root,
    ticketId,
    dependencyId,
    async () => {
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
    },
    options.lock,
  );
}

export async function unblockTicket(root, ticketId, dependencyId, options = {}) {
  return withOrderedTicketLocks(
    root,
    ticketId,
    dependencyId,
    async () => {
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
    },
    options.lock,
  );
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
    if (locateSection(ticket.body, section) === null) {
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

  // Done-time re-validation stays route-only (enforceModel defaults false): it must
  // not retroactively fail tokens recorded before per-step model pinning existed or
  // before this rule shipped. The model gate runs once, at complete-step write time.
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

function validateStepRouting(ticket, config, action, executor, { enforceModel = false } = {}) {
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
  const routeApproved =
    approvals.includes(stepToken(action, executorRoute)) || approvals.includes(stepToken(action, executor));

  if (configuredAgent !== executorRoute) {
    if (!routeApproved) {
      issues.push(
        `${ticket.path}: ${action} completed by ${executorRoute}, but configured agent is ${configuredAgent}; approve the deviation first`,
      );
    }
    return issues;
  }

  if (!enforceModel || executorRoute === "inline") {
    return issues;
  }

  const configuredModel = modelForAction(config, action);
  if (configuredModel === null) {
    return issues;
  }

  const executorModel = modelOf(executor);
  if (modelSatisfies(configuredModel, executorModel)) {
    return issues;
  }

  if (approvals.includes(stepToken(action, executor))) {
    return issues;
  }

  issues.push(
    `${ticket.path}: ${action} completed on model ${executorModel ?? "(none)"}, but configured model is ${configuredModel}; ` +
      `record --executor ${configuredAgent}@${configuredModel} (or @codex-default for a Codex-translated run), ` +
      `or approve the deviation with approve-inline --executor ${configuredAgent}@<model>.`,
  );
  return issues;
}

function completedStepRecords(ticket) {
  return asList(ticket.frontMatter.completedSteps)
    .filter((token) => !isGateToken(token))
    .map((token) => {
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
  const rank = pipelineRankOfStatus(ticket.status, config);
  return rank === null ? config.workflow.pipelineOrder.length : rank;
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

// Find an optional specialty step entry by name across all stages. The
// returned entry carries its owning `stage` (design/implement/test) so
// callers like invalidateDownstreamEvidence can map a specialty token back to
// the ready_* status that produced it, without changing existing consumers
// that only read entry.agent.
function optionalStepEntry(config, name) {
  const stages = config.optionalSteps ?? {};
  for (const stage of Object.keys(stages)) {
    const list = Array.isArray(stages[stage]) ? stages[stage] : [];
    const entry = list.find((candidate) => candidate && candidate.name === name);
    if (entry) {
      return { ...entry, stage };
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

// The model part of an executor string (after "@"), or null if none was recorded.
function modelOf(value) {
  const at = value.indexOf("@");
  return at === -1 ? null : value.slice(at + 1);
}

// Shared predicate for "does this executor's recorded model satisfy the
// configured pin". `codex-default` is the documented sentinel Codex records
// when it translates and physically runs a Claude-routed step (no valid Codex
// model id to pin), so it satisfies any configured model.
export function modelSatisfies(configuredModel, executorModel) {
  return executorModel === configuredModel || executorModel === "codex-default";
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

// Fence-aware section boundary finder. Tracks ``` / ~~~ fence state line by
// line so heading-like lines (`## …`) inside a fenced code block are not
// mistaken for real section boundaries. Pragmatic grammar: any 3+ run of the
// active fence char closes the fence (the closing run need not be >= the
// opening run's length); info strings after an opener are ignored. Does not
// recognize 4-space-indented code blocks (out of scope; pre-existing
// behavior for that case is unchanged). An unbalanced fence leaves the
// scanner "in fence" through EOF, so a real trailing heading after a
// malformed body is not found — no worse than prior behavior for that
// pathological input.
//
// Returns null if the heading is not found (outside fences). Otherwise
// returns character offsets into the original `body`:
//   { headingStart, headingEnd, contentStart, contentEnd }
// contentStart is just after the heading line's newline; contentEnd is the
// start of the next top-level `## ` heading, or body.length if none.
function locateSection(body, section) {
  const headingRe = new RegExp(`^## ${escapeRegExp(section)}\\s*$`);
  const anySectionRe = /^## /;
  const fenceRe = /^\s*(`{3,}|~{3,})/;

  let inFence = false;
  let fenceChar = null;

  let headingStart = null;
  let headingEnd = null;
  let contentStart = null;

  let offset = 0;
  const lineRe = /[^\n]*\n|[^\n]+$/g;
  let m;
  while ((m = lineRe.exec(body)) !== null) {
    const rawLine = m[0];
    const line = rawLine.endsWith("\n") ? rawLine.slice(0, -1) : rawLine;
    const lineStart = offset;
    const lineLen = rawLine.length;
    offset += lineLen;

    const fenceMatch = fenceRe.exec(line);
    if (fenceMatch !== null) {
      const runChar = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = runChar;
        continue;
      }
      if (runChar === fenceChar) {
        inFence = false;
        fenceChar = null;
        continue;
      }
    }

    if (inFence) {
      continue;
    }

    if (headingStart === null) {
      if (headingRe.test(line)) {
        headingStart = lineStart;
        headingEnd = lineStart + line.length;
        contentStart = offset;
      }
      continue;
    }

    if (anySectionRe.test(line)) {
      return { headingStart, headingEnd, contentStart, contentEnd: lineStart };
    }
  }

  if (headingStart === null) {
    return null;
  }
  return { headingStart, headingEnd, contentStart, contentEnd: body.length };
}

function appendToSection(body, section, line) {
  const loc = locateSection(body, section);
  if (loc === null) {
    throw new Error(`section "${section}" not found`);
  }

  const insertAt = loc.contentEnd;
  const before = body.slice(0, insertAt).replace(/\s*$/, "\n\n");
  const after = body.slice(insertAt);
  // contentEnd sits at the next heading's first character (no blank line of
  // its own), so when a following section exists we must supply the
  // separating blank line ourselves; the last section (after === "") only
  // needs the single trailing newline.
  const separator = after === "" ? "\n" : "\n\n";
  return `${before}${line}${separator}${after}`;
}

export function getSectionText(body, section) {
  const loc = locateSection(body, section);
  if (loc === null) {
    return null;
  }

  return body.slice(loc.contentStart, loc.contentEnd).trim();
}

function replaceSection(body, section, text) {
  const loc = locateSection(body, section);
  if (loc === null) {
    throw new Error(`section "${section}" not found`);
  }

  const sectionStart = loc.contentStart;
  const insertAt = loc.contentEnd;
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
  const str = String(value);
  // Bare tokens always round-trip: their charset excludes , " \.
  if (/^[A-Za-z0-9_./:+-]+$/.test(str)) {
    return str;
  }
  // Otherwise the item is emitted quoted. parseScalar unwraps a quoted list
  // item with slice(1,-1) (no unescape) after splitting the interior on bare
  // commas, so a quoted item round-trips ONLY when it contains no comma and
  // JSON.stringify adds no escape sequences (no " \ or control chars).
  if (str.includes(",") || JSON.stringify(str) !== `"${str}"`) {
    throw new Error(
      `front-matter list item cannot be serialized without corrupting the round trip ` +
        `(contains a comma, quote, backslash, or control character): ${JSON.stringify(str)}`,
    );
  }
  return JSON.stringify(str);
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
