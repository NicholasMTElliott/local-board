import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { clearActiveStepIf, stampActiveStep } from "./active-steps.js";
import { loadConfig, OPTIONAL_STEP_STAGES, resolveOptionalStepAgent } from "./config.js";
import { withOrderedTicketLocks, withTicketLock } from "./lock.js";
import { ticketWorktreeMintOffsetMinutes } from "./worktrees.js";

// Ledger-entry identity predicates shared by the conditional clears below
// (B20260710T1225Z review fix, re-review 2): `beginStep` stamps kind
// "action"; `gate-check`/`specialty-run` (src/cli.js) stamp kind
// "gate"/"specialty". A record with no `kind` at all (pre-fix ledger data, or
// an external writer) is treated as an action entry for backward
// compatibility, matching `beginStep`'s pre-fix unconditional overwrite
// semantics.
//
// Kind alone is NOT a sufficient identity: `completeStep("design")` and
// `completeStep("implement")` both clear kind "action", so a stale
// `completeStep("design")` call (e.g. retried after a slow write) could erase
// a fresh `beginStep("implement")` stamp created in between if the predicate
// only checked `kind`. Likewise a stale `recordGateConsultation("design", ...)`
// could erase a fresh `gate-check(..., "implement")` stamp. Each predicate
// therefore also takes the specific action/stage the caller is clearing for,
// and only matches an existing entry with that SAME action/stage -- never a
// same-kind entry for a different one.
function isActionLedgerEntry(record, action) {
  return (record.kind ?? "action") === "action" && record.action === action;
}

// Third review (B20260710T1225Z): `recordGateConsultation` backs the
// `gate-complete` verb, which only ever records a GATE agent's verdict --
// there is no separate specialty-completion verb, but that does NOT make
// recordGateConsultation the clear point for a specialty stamp. Before this
// predicate was kind-agnostic (`kind === "gate" || kind === "specialty"`), a
// stale/retried `gate-complete --stage design` could clear a NEWER
// `specialty-run` stamp for a still-unconsulted specialty in the same
// "design" stage -- a different kind, wrongly erased because only `stage`
// was compared. `recordGateConsultation` must therefore match ONLY its own
// kind ("gate"), never "specialty". A lingering specialty stamp is instead
// cleared by `moveTicket`'s broad abandonment sweep (isAnyConsultationLedgerEntry,
// below) once the ticket actually leaves the stage, or self-heals on the next
// `begin-step`/`specialty-run` overwrite.
function isGateLedgerEntry(record, stage) {
  return record.kind === "gate" && record.stage === stage;
}

// Broad variant used only by `moveTicket`'s abandonment cleanup, which is not
// clearing "the entry its own preceding write created" (unlike
// completeStep/approveInline/recordGateConsultation above) -- it is a
// catch-all sweep for ANY lingering consultation stamp left behind when a
// ticket moves away from a gated stage without ever reaching gate-complete
// (e.g. into questions/blocked, or a loop-back). There is no single "the
// stage this move is leaving" for a non-forward move, so this intentionally
// stays kind-only.
function isAnyConsultationLedgerEntry(record) {
  return record.kind === "gate" || record.kind === "specialty";
}

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

// The design-review action: a requireGateConsultation-style stage-scoped
// required step gated on the design -> ready_for_implementation forward move,
// recognized via config.agents["design-review"] even though it is absent
// from workflow.statusActions. See isKnownAction/configuredRouteForAction/
// profileForAction below.
const DESIGN_REVIEW_ACTION = "design-review";

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

// The design -> implementation forward move that requires a recorded
// design-review token when config.routing.requireDesignReview is true.
// Backward, lateral, and archive/done moves are never gated: only this exact
// from/to pair returns true.
const DESIGN_REVIEW_FROM = new Set(["ready_for_design", "designing"]);
export function isDesignReviewGatedMove(fromStatus, toStatus) {
  return DESIGN_REVIEW_FROM.has(fromStatus) && toStatus === "ready_for_implementation";
}

// Parses on the first colon (mirroring completedStepRecords) and requires a
// non-empty executor: a bare "design-review" or a "design-review:" token
// with an empty/garbage executor is NOT recorder-produced evidence and must
// not satisfy the precondition.
function hasDesignReviewToken(ticket) {
  return asList(ticket.frontMatter.completedSteps).some((token) => {
    const separator = token.indexOf(":");
    if (separator === -1) {
      return false;
    }
    const action = token.slice(0, separator);
    const executor = token.slice(separator + 1);
    return action === DESIGN_REVIEW_ACTION && executor.trim() !== "";
  });
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
// not already listed, de-duplicated. The idempotent self-transition is not
// added as its own suggestion, but unconditional structural targets can still
// include the current status (archived/questions/blocked).
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

  // A design-review token is design-stage evidence: place it at
  // ready_for_design so invalidateDownstreamEvidence (loop-back) and
  // evidenceStrippedByPendingForwardMove (premature-evidence guard) treat it
  // identically to a design token.
  if (action === DESIGN_REVIEW_ACTION) {
    return STAGE_TO_STATUS.design;
  }

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

// True when recording `token` at the ticket's current status would be stripped
// by a forward move the ticket still has to make. Reuses the SAME relation
// invalidateDownstreamEvidence uses (producing status + pipeline rank) so the
// guard and the stripper cannot drift. The concrete threat is the forward move
// INTO the token's own producing status: the stripper removes any token whose
// producing rank <= target rank, and a move into producingStatus has
// target rank == producing rank, so it always strips. That move is still
// pending exactly when the ticket's current pipeline position is STRICTLY
// upstream of the producing status (higher rank = further from done).
export function evidenceStrippedByPendingForwardMove(ticket, config, token) {
  const producingStatus = producingStatusForToken(token, config, invertStatusActions(config));
  if (producingStatus === null) return { stripped: false };
  const producingRank = pipelineRankOfStatus(producingStatus, config);
  if (producingRank === null) return { stripped: false };
  const currentReady = ACTIVE_STATUS_TO_READY[ticket.status] ?? ticket.status;
  const currentRank = pipelineRankOfStatus(currentReady, config);
  if (currentRank === null) {
    // No pipeline rank means backlog/questions/blocked (rankless, non-terminal:
    // structural transitions still allow a move from any of these straight into
    // a ready_* status — see isStructurallyAllowed) or done/archived (rankless,
    // terminal: out of normal flow, no forward move is ever pending). Treat the
    // non-terminal ones as upstream of every pipeline status so recording here
    // always refuses (still overridable); done/archived are unaffected.
    return { stripped: !isClosedStatus(currentReady), producingStatus };
  }
  return { stripped: currentRank > producingRank, producingStatus };
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
    issues.push(...validateCommentMarkers(ticket));
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

      // Same "no side effects on refusal" window as the gate-consultation
      // block above: a scoped hard precondition on the design -> implementation
      // forward move only, active only when config.routing.requireDesignReview
      // is true. Never gates backward/lateral/archive moves (isDesignReviewGatedMove
      // returns true only for the two forward pairs).
      if (isDesignReviewGatedMove(ticket.status, status) && config.routing?.requireDesignReview === true) {
        if (!hasDesignReviewToken(ticket)) {
          throw new Error(
            `${ticket.path}: move refused: ticket ${ticket.id} has no recorded design review. ` +
              `Run "design-review-check ${ticket.id}" to resolve the reviewer route, then record the result with ` +
              `"design-review-complete ${ticket.id} --executor <executor> --model <model> --evidence <text>" ` +
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

      // Abandonment cleanup (B20260710T1225Z review finding 2): a
      // gate-check/specialty-run consultation stamp is only ever meant to
      // live between its own stamp and the matching gate-complete's clear
      // (recordGateConsultation). If the ticket instead moves away (e.g.
      // through questions/blocked, or a loop-back) before that consultation
      // is ever completed, the stamp would otherwise linger and later
      // wrongly authorize a gate/specialty dispatch for a different stage.
      // Any successful FORWARD-OR-SIDEWAYS move (a real status change) clears
      // a lingering consultation-kind entry for this ticket; action-kind
      // entries (an in-flight begin-step dispatch) are left untouched --
      // moving a ticket is not evidence an action dispatch abandoned.
      // Best-effort: a clear failure must never undo an already-successful
      // move.
      //
      // Skipped for a same-status re-save (ticket.status === status, e.g. a
      // front-matter-only rewrite that happens to pass the current status --
      // third review, B20260710T1225Z): a re-save abandons nothing, so
      // sweeping here would erase a legitimate, still-pending gate/specialty
      // consultation stamp for no reason (e.g. a Run Log comment appended via
      // a code path that round-trips through moveTicket with the unchanged
      // status). Reserve the sweep for calls that actually change status.
      if (ticket.status !== status) {
        await clearActiveStepIf(root, ticketId, isAnyConsultationLedgerEntry).catch(() => {});
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
      const prefix = renderMarkerBlock(options.markers);
      const body = appendToSection(
        ticket.body,
        section,
        `- ${formatIsoSeconds(options.now ?? new Date())}: ${prefix}${text.trim()}`,
      );
      const frontMatter = withUpdated({ ...ticket.frontMatter }, options.now);
      await writeTicketFile(ticket.path, renderMarkdownTicket(frontMatter, body));
      return ticket.path;
    },
    options.lock,
  );
}

// Renders an ordered list of {key, value} marker pairs into the bracketed
// block inserted between the "- <ts>: " prefix and the comment body. Empty
// or absent markers render "" so unmarked comments stay byte-identical to
// the pre-marker format. Non-empty output always ends with exactly one
// trailing space so callers can splice it directly before the body text.
function renderMarkerBlock(markers) {
  if (markers === undefined || markers === null || markers.length === 0) {
    return "";
  }
  return `[${markers.map(({ key, value }) => `${key}:${value}`).join(" ")}] `;
}

const COMMENT_LINE_RE = /^- (?<ts>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})): (?<rest>[\s\S]*)$/;
const MARKER_KEY_RE = /^[A-Za-z0-9_.-]+$/;
const MARKER_VALUE_RE = /^[A-Za-z0-9_./-]+$/;
const MARKER_TOKEN_RE = /^([A-Za-z0-9_.-]+):([A-Za-z0-9_./-]+)$/;

// Parses a single Run Log-style comment line into { timestamp, markers, body }.
// Pure and never throws: any shape that doesn't cleanly match the marker
// grammar falls back to treating the whole remainder as body text. Callers
// are responsible for feeding real comment lines (fence-awareness lives in
// the contentLines walker, not here).
//
// Normalizes a single trailing "\r" up front so callers that split CRLF text
// on "\n" (leaving a stray "\r" on every line) get clean bodies rather than
// a "\r" suffix (or, for a marker block with no body, a body of just "\r").
export function parseCommentLine(line) {
  const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
  const match = COMMENT_LINE_RE.exec(normalized);
  if (match === null) {
    return { timestamp: null, markers: [], body: normalized };
  }

  const { ts, rest } = match.groups;

  if (rest.startsWith("[")) {
    const closeIndex = rest.indexOf("]");
    if (closeIndex !== -1) {
      const inner = rest.slice(1, closeIndex);
      const tokens = inner.length === 0 ? [] : inner.split(" ");
      const markers = [];
      let valid = inner.length > 0;
      for (const token of tokens) {
        const tokenMatch = MARKER_TOKEN_RE.exec(token);
        if (tokenMatch === null) {
          valid = false;
          break;
        }
        markers.push({ key: tokenMatch[1], value: tokenMatch[2] });
      }
      if (valid) {
        const body = rest.slice(closeIndex + 1).replace(/^ /, "");
        return { timestamp: ts, markers, body };
      }
    }
  }

  return { timestamp: ts, markers: [], body: rest };
}

// Shared fence-tracking line walker (the state machine locateSection uses
// internally to skip fenced code blocks). Yields { line, lineStart } for
// every line NOT inside a ``` or ~~~ fence, so callers that scan comment
// text for marker-shaped lines don't mistake fenced example content for
// real markers. Kept standalone (rather than refactoring locateSection to
// consume it) to avoid risk to that load-bearing function.
function* contentLines(body) {
  const fenceRe = /^\s*(`{3,}|~{3,})/;
  let inFence = false;
  let fenceChar = null;

  let offset = 0;
  const lineRe = /[^\n]*\n|[^\n]+$/g;
  let m;
  while ((m = lineRe.exec(body)) !== null) {
    const rawLine = m[0];
    const line = rawLine.endsWith("\n") ? rawLine.slice(0, -1) : rawLine;
    const lineStart = offset;
    offset += rawLine.length;

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

    yield { line, lineStart };
  }
}

const SECTION_HEADING_RE = /^## (.+?)\s*$/;

// Single fence-aware pass over a ticket's body, collecting every well-formed
// Run Log-style bullet comment (per parseCommentLine) into an ordered list of
// records, each tagged with the `## ` heading it falls under. Reuses the same
// contentLines fence walker validateCommentMarkers uses, so fenced example
// lines are never mistaken for real comments. Pure and never throws.
//
// `section`: exact-match filter against the heading text (e.g. "Run Log");
// null (default) keeps every section. An unknown section simply matches no
// records — no error.
// `markers`: an ordered `[{ key, value }]` list (as produced by the CLI's
// parseMarkerFlags); a record is kept only when it has, for every requested
// pair, some marker with that exact key AND value (AND semantics, exact
// equality). An empty/absent list is vacuously true for every record,
// including unmarked ones.
export function collectComments(ticket, { section = null, markers = [] } = {}) {
  const records = [];
  let currentSection = null;

  for (const { line } of contentLines(ticket.body)) {
    const headingMatch = SECTION_HEADING_RE.exec(line);
    if (headingMatch !== null) {
      currentSection = headingMatch[1];
      continue;
    }

    if (currentSection === null) {
      continue;
    }

    const parsed = parseCommentLine(line);
    if (parsed.timestamp === null) {
      continue;
    }

    records.push({
      ticket: ticket.id,
      section: currentSection,
      timestamp: parsed.timestamp,
      markers: parsed.markers,
      body: parsed.body,
    });
  }

  return records
    .filter((record) => section === null || record.section === section)
    .filter((record) =>
      markers.every((marker) =>
        record.markers.some(
          (recordMarker) => recordMarker.key === marker.key && recordMarker.value === marker.value,
        ),
      ),
    );
}

const MARKER_SHAPED_LINE_RE =
  /^- \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2}): \[/;

// Flags comment lines that look like an attempted marker block but fail the
// strict marker grammar -- deliberately stricter than parseCommentLine's
// graceful fallback so real author mistakes surface, without flagging
// ordinary prose that happens to start with a bracketed aside (no token
// containing ":" -> not marker syntax -> skipped).
function validateCommentMarkers(ticket) {
  const issues = [];

  for (const { line } of contentLines(ticket.body)) {
    if (!MARKER_SHAPED_LINE_RE.test(line)) {
      continue;
    }

    const openIndex = line.indexOf("[");
    const closeIndex = line.indexOf("]", openIndex);
    const unclosed = closeIndex === -1;
    const inner = unclosed ? line.slice(openIndex + 1) : line.slice(openIndex + 1, closeIndex);
    const tokens = inner.length === 0 ? [] : inner.split(" ");

    const looksIntended = tokens.some((token) => token.includes(":"));
    if (!looksIntended) {
      continue;
    }

    if (unclosed) {
      issues.push(`${ticket.path}: malformed marker block in comment "${line}": unclosed [`);
      continue;
    }

    const badToken = tokens.find((token) => !MARKER_TOKEN_RE.test(token));
    if (badToken !== undefined) {
      issues.push(
        `${ticket.path}: malformed marker block in comment "${line}": token "${badToken}" violates key:value grammar (key ${MARKER_KEY_RE}, value ${MARKER_VALUE_RE})`,
      );
    }
  }

  return issues;
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
  const configuredEffort = effortForAction(config, action);

  const result = {
    ticket: ticket.id,
    action,
    status: ticket.status,
    transitions: transitionsForStatus(config, ticket.status),
    configuredAgent,
    configuredModel,
    configuredEffort,
    configuredPrompt: promptForAction(config, action),
    strict: config.routing?.strict === true,
    delegationRequired: config.routing?.strict === true && configuredAgent !== "inline",
    branch: ticket.frontMatter.branch ?? null,
    path: path.relative(board.root, ticket.path),
  };

  // Additive side effect (unconditional, idempotent): stamps this ticket's
  // in-flight step so `check-dispatch` (T20260707T1325Z) can verify a later
  // Task dispatch against it. `begin-step`'s return shape is unchanged.
  // `kind: "action"` (B20260710T1225Z) lets completeStep/approveInline clear
  // only the entry they correspond to, via `clearActiveStepIf`.
  await stampActiveStep(root, ticket.id, {
    ticket: ticket.id,
    kind: "action",
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
  // Conditional (B20260710T1225Z, re-review 2): clears only the action entry
  // stamped for THIS action, never a newer gate/specialty consultation, nor a
  // newer action stamp for a DIFFERENT action, in the gap between this write
  // and this clear (see clearActiveStepIf / isActionLedgerEntry).
  await clearActiveStepIf(root, result.ticket, (record) => isActionLedgerEntry(record, action)).catch(() => {});
  return result;
}

export async function completeStep(root, ticketId, action, executor, evidence, options = {}) {
  if (evidence.trim() === "") {
    throw new Error("complete-step requires non-empty evidence");
  }
  if (options.override === true && (options.overrideReason ?? "").trim() === "") {
    // Enforced here (not just in the CLI) so any API caller that sets
    // override is held to the same accountability requirement: the reason is
    // what makes an override auditable in the Run Log.
    throw new Error("complete-step --override requires a non-empty overrideReason");
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

      // Premature-evidence guard: recording `token` now would be silently
      // stripped by a forward move the ticket still has to make (see
      // evidenceStrippedByPendingForwardMove). Refuse before any write, unless
      // the caller passed --override --reason. Gate tokens never reach this
      // path (recorded via gate-complete, not completeStep), so this is
      // deliberately scoped to mandatory-action and specialty tokens.
      let overrideNote = null;
      if (config.routing?.guardPrematureEvidence === true) {
        const check = evidenceStrippedByPendingForwardMove(ticket, config, token);
        if (check.stripped) {
          if (options.override === true) {
            overrideNote = check.producingStatus
              ? ` ahead of its producing status ${check.producingStatus}`
              : "";
          } else {
            throw new Error(
              `complete-step ${action} refused: recording it now at status ${ticket.status} would ` +
                `be stripped by the forward move into ${check.producingStatus} (routing.invalidateOnLoopBack). ` +
                `Record ${action} evidence at ${check.producingStatus} or later (the earliest status where ` +
                `it survives). Re-run with --override --reason <text> to record anyway (the reason ` +
                `is appended to the Run Log), or set routing.guardPrematureEvidence to false to disable this guard.`,
            );
          }
        }
      }

      const now = options.now ?? new Date();
      const frontMatter = withUpdated(
        {
          ...ticket.frontMatter,
          completedSteps: addUnique(asList(ticket.frontMatter.completedSteps), token),
        },
        now,
      );
      let body = appendToSection(
        ticket.body,
        "Run Log",
        `- ${formatIsoSeconds(now)}: Completed ${action} via ${executor}: ${evidence.trim()}`,
      );
      if (options.override === true && overrideNote !== null) {
        body = appendToSection(
          body,
          "Run Log",
          `- ${formatIsoSeconds(now)}: Premature-evidence override: recorded ${action} at ${ticket.status}` +
            `${overrideNote}: ${(options.overrideReason ?? "").trim()}`,
        );
      }
      await writeTicketFile(ticket.path, renderMarkdownTicket(frontMatter, body));
      return { ticket: ticket.id, action, executor, path: ticket.path };
    },
    options.lock,
  );
  // Conditional (B20260710T1225Z, re-review 2): see the identical rationale
  // on approveInline's clear above.
  await clearActiveStepIf(root, result.ticket, (record) => isActionLedgerEntry(record, action)).catch(() => {});
  return result;
}

// Records a design-review consultation, modeled on completeStep (not
// recordGateConsultation): it must run validateStepRouting with model
// enforcement (the configured model pin, e.g. gpt-5.6-sol, is enforced
// exactly like a mandatory action's model gate) and the premature-evidence
// guard. Effort is a dispatch-time hint only and is never read here, so it
// cannot leak into the token or evidence.
export async function recordDesignReview(root, ticketId, executor, evidence, options = {}) {
  if (evidence.trim() === "") {
    throw new Error("design-review requires non-empty evidence");
  }
  if (options.override === true && (options.overrideReason ?? "").trim() === "") {
    throw new Error("design-review --override requires a non-empty overrideReason");
  }

  const config = await loadConfig(root);
  if (config.routing?.requireDesignReview !== true) {
    throw new Error(
      "design-review is disabled: set routing.requireDesignReview to true in the board config to enable the design-review recorder",
    );
  }
  if (!isValidAgentValue(executor)) {
    throw new Error(`executor must be one of ${schemaAgentValues().join(", ")}`);
  }

  const result = await withTicketLock(
    root,
    ticketId,
    async () => {
      const { ticket } = await findTicket(root, ticketId);
      if (options.__afterRead) {
        await options.__afterRead();
      }
      const token = stepToken(DESIGN_REVIEW_ACTION, executor);
      const routingIssues = validateStepRouting(ticket, config, DESIGN_REVIEW_ACTION, executor, {
        enforceModel: true,
      });
      if (routingIssues.length > 0) {
        throw new Error(`routing validation failed:\n${routingIssues.join("\n")}`);
      }

      let overrideNote = null;
      if (config.routing?.guardPrematureEvidence === true) {
        const check = evidenceStrippedByPendingForwardMove(ticket, config, token);
        if (check.stripped) {
          if (options.override === true) {
            overrideNote = check.producingStatus
              ? ` ahead of its producing status ${check.producingStatus}`
              : "";
          } else {
            throw new Error(
              `design-review refused: recording it now at status ${ticket.status} would ` +
                `be stripped by the forward move into ${check.producingStatus} (routing.invalidateOnLoopBack). ` +
                `Record design-review evidence at ${check.producingStatus} or later (the earliest status where ` +
                `it survives). Re-run with --override --reason <text> to record anyway (the reason ` +
                `is appended to the Run Log), or set routing.guardPrematureEvidence to false to disable this guard.`,
            );
          }
        }
      }

      const now = options.now ?? new Date();
      const frontMatter = withUpdated(
        {
          ...ticket.frontMatter,
          completedSteps: addUnique(asList(ticket.frontMatter.completedSteps), token),
        },
        now,
      );
      let body = appendToSection(
        ticket.body,
        "Run Log",
        `- ${formatIsoSeconds(now)}: Recorded design review via ${executor}: ${evidence.trim()}`,
      );
      if (options.override === true && overrideNote !== null) {
        body = appendToSection(
          body,
          "Run Log",
          `- ${formatIsoSeconds(now)}: Premature-evidence override: recorded design-review at ${ticket.status}` +
            `${overrideNote}: ${(options.overrideReason ?? "").trim()}`,
        );
      }
      await writeTicketFile(ticket.path, renderMarkdownTicket(frontMatter, body));
      return { ticket: ticket.id, executor, path: ticket.path };
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
  return { ticket: ticketId, stage, path: writtenPath, token };
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
  // Clears the ledger's gate-check stamp for THIS stage only. Best-effort,
  // same rationale as completeStep: a missing/already-cleared entry is a
  // no-op, and a clear failure must never block evidence recording that
  // already succeeded. Conditional (B20260710T1225Z, re-review 2): only
  // clears a gate entry for THIS `stage`, never a newer action stamp (e.g.
  // begin-step for the NEXT stage, already running before this clear fires),
  // and never a newer gate stamp for a DIFFERENT stage (e.g. this call is a
  // stale/retried gate-complete for "design" while a fresh gate-check for
  // "implement" already stamped its own entry).
  //
  // Deliberately does NOT clear a "specialty"-kind entry (third review
  // residual, B20260710T1225Z): gate-complete records only the GATE agent's
  // verdict, never a specialty's. A stale/retried gate-complete for this
  // stage must not erase a still-live specialty-run stamp for a different,
  // not-yet-consulted specialty in the SAME stage -- there is no "this
  // gate-complete call also completed that specialty" relationship to assert.
  // A lingering specialty stamp is instead cleared by moveTicket's broad
  // abandonment sweep (isAnyConsultationLedgerEntry) once the ticket actually
  // leaves the stage, or self-heals on the next begin-step/specialty-run
  // overwrite. See isGateLedgerEntry's comment for the full rationale.
  await clearActiveStepIf(root, ticketId, (record) => isGateLedgerEntry(record, stage)).catch(() => {});
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
  const created = formatIsoSeconds(now);

  await mkdir(folder, { recursive: true });
  await writeFile(ticketPath, renderTicket(ticketId, ticketType, status, priority, parent, created, title), {
    encoding: "utf8",
    flag: "wx",
  });

  if (parent !== null) {
    await linkParent(root, ticketId, parent, { now });
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
  if (action === DESIGN_REVIEW_ACTION) {
    // Flag-off inertness: design-review is not a known/dispatchable action
    // unless routing.requireDesignReview is true, so begin-step
    // --action design-review, resolveExpectedStep, and completeStep all
    // refuse it on flag-off boards, exactly like any other unconfigured
    // action.
    return config.routing?.requireDesignReview === true;
  }
  const actions = new Set(Object.values(config.workflow.statusActions));
  return actions.has(action) || optionalStepEntry(config, action) !== null;
}

// The configured route for an action: mandatory actions use the agents map;
// optional specialty steps use their catalog entry's `agent` (default inline).
// Subsumed by profileForAction below; kept as a thin named wrapper for
// call-site clarity.
function configuredRouteForAction(config, action) {
  return profileForAction(config, action).route;
}

// Resolve the full normalized profile { route, model?, effort?, prompt? } for
// an action. Mandatory actions (workflow.statusActions values) resolve
// through the agents map with the agents.default fallback, unchanged from
// before. Optional specialty steps resolve through their own catalog entry's
// `agent` and must NOT fall back to agents.default: a specialty with no
// `agent` is inline, not the default agent. This is the single seam that
// makes route/model/effort/prompt resolution specialty-aware, so a pinned
// specialty model is enforced by the same completeStep model gate that
// enforces mandatory-action pins.
function profileForAction(config, action) {
  const mandatory = new Set(Object.values(config.workflow.statusActions));
  // design-review is absent from workflow.statusActions but resolves through
  // the agents map exactly like a mandatory action (config.agents["design-review"]),
  // never through the optionalSteps catalog -- and only when the flag is on
  // (flag-off inertness: config.agents["design-review"] is never consulted).
  if (
    mandatory.has(action) ||
    (action === DESIGN_REVIEW_ACTION && config.routing?.requireDesignReview === true)
  ) {
    const entry = config.agents[action] ?? config.agents.default ?? { route: "inline" };
    return typeof entry === "string" ? { route: entry } : entry;
  }
  const step = optionalStepEntry(config, action);
  if (step && step.agent !== undefined) {
    return resolveOptionalStepAgent(step.agent);
  }
  return { route: "inline" };
}

// agentForAction returns just the route string so all existing routing and
// evidence comparisons keep working unchanged. Per-step model lives alongside it.
function agentForAction(config, action) {
  return profileForAction(config, action).route;
}

function modelForAction(config, action) {
  return profileForAction(config, action).model ?? null;
}

function effortForAction(config, action) {
  return profileForAction(config, action).effort ?? null;
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

// Compose the `<route>@<model>` executor evidence string server-side so
// callers (CLI, skills) do not have to hand-splice the suffix that
// isValidAgentValue/validateStepRouting validate strictly.
//
// - No model given (undefined/empty/whitespace-only): return executor
//   verbatim; any existing "@model" combined form still flows through
//   unchanged (today's behavior, downstream-validated as before).
// - executor already carries "@" and model is given:
//   - same value -> no-op, return executor as-is (idempotent).
//   - different value -> throw naming both, so the caller fixes the
//     disagreement instead of one flag silently winning.
// - executor is "inline" and model is given -> throw a targeted error
//   (inline runs on the orchestrator's own model and cannot pin one).
// - otherwise -> return `${executor}@${model}`.
export function composeExecutor(executor, model) {
  if (model === undefined || model === null || model.trim() === "") {
    return executor;
  }
  if (executor === "inline") {
    throw new Error(
      "--model cannot be used with --executor inline: inline runs on the orchestrator's own model and cannot pin one",
    );
  }
  const existingModel = modelOf(executor);
  if (existingModel !== null) {
    if (existingModel === model) {
      return executor;
    }
    throw new Error(
      `--executor pins @${existingModel} but --model says ${model}; pass only one or make them agree`,
    );
  }
  return `${executor}@${model}`;
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
