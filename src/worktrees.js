import { mkdir, access } from "node:fs/promises";
import path from "node:path";

import { discover, findTicket, setTicketField } from "./tickets.js";
import {
  assertBranchName,
  currentBranch,
  gitOk,
  gitOutput,
  gitRawOutput,
  gitRun,
  resolveDefaultBranch,
  ticketBranchName,
} from "./git.js";

export async function addTicketWorktree(root, ticketId) {
  const repoRoot = await gitOutput(root, ["rev-parse", "--show-toplevel"]);
  const { ticket } = await findTicket(repoRoot, ticketId);
  const branch = ticketBranchName(ticket);
  await assertBranchName(repoRoot, branch);

  const worktreePath = ticketWorktreePath(repoRoot, ticketId);
  const existing = await findRegisteredWorktree(repoRoot, worktreePath);
  if (existing !== null) {
    if (existing.branch !== branch) {
      throw new Error(
        `worktree for ${ticketId} already exists at ${displayPath(worktreePath)} on branch ${existing.branch ?? "(detached)"}; expected ${branch}`,
      );
    }
    if (ticket.frontMatter.branch !== branch) {
      await setTicketField(worktreePath, ticketId, "branch", branch);
    }
    return worktreeAddRecord(ticketId, branch, worktreePath, false);
  }

  if (await pathExists(worktreePath)) {
    throw new Error(`${displayPath(worktreePath)} exists but is not a registered git worktree`);
  }

  await mkdir(path.dirname(worktreePath), { recursive: true });
  if (ticket.frontMatter.branch === null) {
    await gitRun(repoRoot, ["worktree", "add", "-b", branch, worktreePath]);
    await setTicketField(worktreePath, ticketId, "branch", branch);
    await commitBranchStamp(worktreePath, ticketId, branch);
  } else {
    await gitRun(repoRoot, ["worktree", "add", worktreePath, branch]);
  }

  return worktreeAddRecord(ticketId, branch, worktreePath, true);
}

async function commitBranchStamp(worktreePath, ticketId, branch) {
  await gitRun(worktreePath, ["add", "plans"]);
  if (await gitOk(worktreePath, ["diff", "--cached", "--quiet"])) {
    return;
  }
  await gitRun(worktreePath, ["commit", "-m", `local-board: stamp branch ${branch} on ${ticketId}`]);
}

export async function removeTicketWorktree(root, ticketId, options = {}) {
  const repoRoot = await gitOutput(root, ["rev-parse", "--show-toplevel"]);
  await findTicket(repoRoot, ticketId);
  const worktreePath = ticketWorktreePath(repoRoot, ticketId);
  const existing = await findRegisteredWorktree(repoRoot, worktreePath);
  if (existing === null) {
    return {
      ticketId,
      worktreePath: displayPath(worktreePath),
      removed: false,
    };
  }

  await gitRun(repoRoot, ["worktree", "remove", ...(options.force ? ["--force"] : []), worktreePath]);
  return {
    ticketId,
    worktreePath: displayPath(worktreePath),
    removed: true,
  };
}

export async function listTicketWorktrees(root) {
  const repoRoot = await gitOutput(root, ["rev-parse", "--show-toplevel"]);
  const worktreesRoot = ticketWorktreesRoot(repoRoot);
  if (!(await pathExists(worktreesRoot))) {
    return [];
  }

  const board = await discover(repoRoot);
  if (board.loadErrors.length > 0) {
    throw new Error(board.loadErrors.join("\n"));
  }
  const knownTicketIds = new Set(board.tickets.map((ticket) => ticket.id));

  const records = await listRegisteredWorktrees(repoRoot);
  return records
    .filter((record) => isChildPath(worktreesRoot, record.worktreePath))
    .map((record) => ({ record, ticketId: path.basename(record.worktreePath) }))
    .filter(({ ticketId }) => knownTicketIds.has(ticketId))
    .sort((left, right) => left.ticketId.localeCompare(right.ticketId))
    .map(({ record, ticketId }) => ({
      ticketId,
      branch: record.branch,
      worktreePath: displayPath(record.worktreePath),
      locked: record.locked,
    }));
}

export async function fastForwardDefaultBranch(root, options = {}) {
  const defaultBranch = await resolveDefaultBranch(root, options.defaultBranch ?? null);
  const current = await currentBranch(root);
  if (current !== defaultBranch) {
    throw new Error(`on branch ${current}; switch to ${defaultBranch} before fast-forwarding`);
  }

  const newHead = await gitOutput(root, ["rev-parse", "HEAD"]);
  const previousHead = await cleanCheckoutHead(root, defaultBranch, newHead);

  await gitRun(root, ["reset", "--hard", "HEAD"]);
  return {
    defaultBranch,
    previousHead,
    newHead,
    advanced: previousHead !== newHead,
  };
}

export function ticketWorktreesRoot(repoRoot) {
  const resolved = path.resolve(repoRoot);
  return path.join(path.dirname(resolved), `${path.basename(resolved)}-worktrees`);
}

export function ticketWorktreePath(repoRoot, ticketId) {
  return path.join(ticketWorktreesRoot(repoRoot), ticketId);
}

export async function ticketWorktreeMintOffsetMinutes(root) {
  let records;
  try {
    records = await listRegisteredWorktrees(root);
  } catch {
    return 0;
  }
  if (records.length === 0) {
    return 0;
  }

  const mainRoot = records[0].worktreePath;
  const worktreesRoot = ticketWorktreesRoot(mainRoot);
  const ticketIds = records
    .filter((record) => isChildPath(worktreesRoot, record.worktreePath))
    .map((record) => path.basename(record.worktreePath))
    .sort();

  if (ticketIds.length === 0) {
    return 0;
  }

  let topLevel;
  try {
    topLevel = path.resolve(await gitOutput(root, ["rev-parse", "--show-toplevel"]));
  } catch {
    return 0;
  }

  const index = ticketIds.indexOf(path.basename(topLevel));
  return index < 0 ? 0 : index;
}

async function cleanCheckoutHead(root, branch, newHead) {
  if (!(await gitOk(root, ["diff-files", "--quiet", "--"]))) {
    throw new Error("fast-forward requires a clean working tree; commit or stash changes first");
  }

  const untracked = await gitRawOutput(root, ["ls-files", "--others", "--exclude-standard"]);
  if (untracked.trim() !== "") {
    throw new Error("fast-forward requires a clean working tree; commit or stash changes first");
  }

  const candidates = await reflogCandidates(root, branch, newHead);
  for (const candidate of candidates) {
    if (await gitOk(root, ["diff-index", "--cached", "--quiet", candidate, "--"])) {
      return candidate;
    }
  }

  throw new Error("fast-forward requires a clean working tree; commit or stash changes first");
}

async function reflogCandidates(root, branch, newHead) {
  const seen = new Set();
  const candidates = [];
  const add = (value) => {
    if (value !== "" && !seen.has(value)) {
      seen.add(value);
      candidates.push(value);
    }
  };

  add(newHead);
  try {
    const reflog = await gitRawOutput(root, ["reflog", "--format=%H", "-n", "25", branch]);
    for (const line of reflog.split(/\r?\n/)) {
      add(line.trim());
    }
  } catch {
    // A missing reflog should not prevent the ordinary no-op case above.
  }
  return candidates;
}

async function findRegisteredWorktree(root, worktreePath) {
  const target = path.resolve(worktreePath);
  const records = await listRegisteredWorktrees(root);
  return records.find((record) => path.resolve(record.worktreePath) === target) ?? null;
}

async function listRegisteredWorktrees(root) {
  const output = await gitRawOutput(root, ["worktree", "list", "--porcelain"]);
  return output
    .split(/\r?\n\r?\n/)
    .map((block) => parseWorktreeBlock(block))
    .filter((record) => record !== null);
}

function parseWorktreeBlock(block) {
  const lines = block.split(/\r?\n/).filter((line) => line !== "");
  if (lines.length === 0) {
    return null;
  }

  const record = {
    worktreePath: null,
    branch: null,
    locked: false,
  };

  for (const line of lines) {
    if (line.startsWith("worktree ")) {
      record.worktreePath = path.resolve(line.slice("worktree ".length));
    } else if (line.startsWith("branch ")) {
      const branch = line.slice("branch ".length);
      record.branch = branch.startsWith("refs/heads/") ? branch.slice("refs/heads/".length) : branch;
    } else if (line === "locked" || line.startsWith("locked ")) {
      record.locked = true;
    }
  }

  return record.worktreePath === null ? null : record;
}

function worktreeAddRecord(ticketId, branch, worktreePath, created) {
  return {
    ticketId,
    branch,
    worktreePath: displayPath(worktreePath),
    created,
  };
}

function isChildPath(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function displayPath(value) {
  return path.resolve(value).replace(/\\/g, "/");
}
