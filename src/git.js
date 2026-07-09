import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { appendTicketComment, findTicket, formatIsoSeconds, moveTicket, setTicketField } from "./tickets.js";

const execFileAsync = promisify(execFile);

export async function startTicketWork(root, ticketId, options = {}) {
  const { ticket } = await findTicket(root, ticketId);
  const now = options.now ?? new Date();
  const branch = ticketBranchName(ticket, options.branch);
  await assertBranchName(root, branch);

  const git = await ensureGitBranch(root, branch, { allowDirty: options.allowDirty ?? false });
  let ticketPath = ticket.path;

  if (ticket.frontMatter.workStartedAt === null) {
    ticketPath = await setTicketField(root, ticketId, "workStartedAt", formatIsoSeconds(now), { now });
  }

  ticketPath = await recordTicketBranch(root, ticketId, ticket, branch, { now, currentPath: ticketPath });

  ticketPath = await appendTicketComment(root, ticketId, "Run Log", `Ensured git branch ${branch} (${git.action}).`, {
    now,
  });

  let status = ticket.status;
  if (ticket.status === "ready_for_implementation") {
    ticketPath = await moveTicket(root, ticketId, "implementing", { now });
    status = "implementing";
  }

  return {
    ticket: ticket.id,
    branch,
    status,
    path: ticketPath,
    gitRoot: git.root,
    gitAction: git.action,
  };
}

export async function assertAutoMergeReady(root, ticketId, options = {}) {
  const { ticket } = await findTicket(root, ticketId);
  const branch = ticket.frontMatter.branch;
  const defaultBranch = await resolveDefaultBranch(root, options.defaultBranch ?? null);
  const current = await currentBranch(root);

  assertMergeBranch(ticketId, branch, defaultBranch, current);
  await assertNoNonPlanningChanges(root);
  await assertTicketBranchUpToDate(root, branch, defaultBranch);

  return { ticket: ticket.id, branch, defaultBranch, current };
}

export async function autoMergeTicketBranch(root, ticketId, options = {}) {
  const { ticket } = await findTicket(root, ticketId);
  const branch = ticket.frontMatter.branch;
  const defaultBranch = await resolveDefaultBranch(root, options.defaultBranch ?? null);
  const current = await currentBranch(root);

  assertMergeBranch(ticketId, branch, defaultBranch, current);
  await assertNoNonPlanningChanges(root);
  await assertTicketBranchUpToDate(root, branch, defaultBranch);

  const now = options.now ?? new Date();
  await appendTicketComment(root, ticketId, "Run Log", `Auto-merge prepared for ${branch} into ${defaultBranch}.`, {
    now,
  });

  const planningCommit = await commitPlanningChanges(root, ticketId, options);
  if (await branchCheckedOutElsewhere(root, defaultBranch)) {
    await mergeBranchIntoDefaultRef(root, ticketId, branch, defaultBranch);
    const pruned = await maybePruneMergedTicketBranch(root, branch, defaultBranch, options, {
      stillOnTicketBranch: true,
    });
    return {
      ticket: ticket.id,
      branch,
      defaultBranch,
      planningCommit,
      pruned,
      action: "merged",
    };
  }

  await gitRun(root, ["switch", defaultBranch]);

  try {
    await gitRun(root, ["merge", "--no-ff", branch, "-m", `Merge ${ticketId}`]);
  } catch (error) {
    await abortMergeAndReturn(root, branch);
    throw error;
  }

  const pruned = await maybePruneMergedTicketBranch(root, branch, defaultBranch, options, {
    stillOnTicketBranch: false,
  });
  return {
    ticket: ticket.id,
    branch,
    defaultBranch,
    planningCommit,
    pruned,
    action: "merged",
  };
}

async function maybePruneMergedTicketBranch(root, branch, defaultBranch, options, context) {
  if (options.pruneMergedBranches === false) {
    return "skipped";
  }
  if (branch === defaultBranch) {
    return "skipped";
  }

  if (context.stillOnTicketBranch) {
    try {
      await gitRun(root, ["checkout", "--detach"]);
    } catch {
      return "skipped";
    }
  }

  if (await branchCheckedOutElsewhere(root, branch)) {
    return "skipped";
  }

  try {
    await gitRun(root, ["branch", "-d", branch]);
    return "deleted";
  } catch {
    return "skipped";
  }
}

async function ensureGitBranch(root, branch, options) {
  const gitRoot = await gitOutput(root, ["rev-parse", "--show-toplevel"]);
  const current = await currentBranch(root);
  const existsLocal = await gitOk(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  const existsOrigin = await gitOk(root, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`]);
  const dirty = (await gitOutput(root, ["status", "--porcelain"])) !== "";

  if (current === branch) {
    return { root: gitRoot, action: "already-current" };
  }

  if (dirty && !options.allowDirty) {
    const action = existsLocal || existsOrigin ? "switch to existing branch" : "create branch";
    throw new Error(`working tree has uncommitted changes; refusing to ${action} ${branch}`);
  }

  if (existsLocal) {
    await gitRun(root, ["switch", branch]);
    return { root: gitRoot, action: "switched-existing" };
  }

  if (existsOrigin) {
    await gitRun(root, ["switch", "--track", "-c", branch, `origin/${branch}`]);
    return { root: gitRoot, action: "switched-origin" };
  }

  await gitRun(root, ["switch", "-c", branch]);
  return { root: gitRoot, action: "created" };
}

function assertMergeBranch(ticketId, branch, defaultBranch, current) {
  if (typeof branch !== "string" || branch.trim() === "") {
    throw new Error(`ticket ${ticketId} has no branch; run start-work before auto-merge`);
  }
  if (branch === defaultBranch) {
    throw new Error(`ticket ${ticketId} branch is the default branch; refusing to auto-merge`);
  }
  if (current !== branch) {
    throw new Error(`auto-merge must run from ticket branch ${branch}; current branch is ${current}`);
  }
}

export async function assertNoNonPlanningChanges(root) {
  const entries = await workingTreeEntries(root);
  const nonPlanning = entries.filter((entry) => entry.paths.some((changedPath) => !isPlanningPath(changedPath)));
  if (nonPlanning.length > 0) {
    const paths = nonPlanning.flatMap((entry) => entry.paths).join(", ");
    throw new Error(`auto-merge requires non-planning changes to be committed first: ${paths}`);
  }
}

async function mergeBranchIntoDefaultRef(root, ticketId, branch, defaultBranch) {
  const oldDefault = await gitOutput(root, ["rev-parse", defaultBranch]);
  const mergeCommit = await gitOutput(root, [
    "commit-tree",
    `${branch}^{tree}`,
    "-p",
    oldDefault,
    "-p",
    branch,
    "-m",
    `Merge ${ticketId}`,
  ]);
  await gitRun(root, ["update-ref", `refs/heads/${defaultBranch}`, mergeCommit, oldDefault]);
}

async function branchCheckedOutElsewhere(root, branch) {
  const currentRoot = path.resolve(await gitOutput(root, ["rev-parse", "--show-toplevel"]));
  const output = await gitRawOutput(root, ["worktree", "list", "--porcelain"]);
  let worktreePath = null;
  let worktreeBranch = null;

  const flush = () => {
    const checkedOutElsewhere =
      worktreePath !== null &&
      worktreeBranch === `refs/heads/${branch}` &&
      path.resolve(worktreePath) !== currentRoot;
    worktreePath = null;
    worktreeBranch = null;
    return checkedOutElsewhere;
  };

  for (const line of output.split(/\r?\n/)) {
    if (line === "") {
      if (flush()) {
        return true;
      }
      continue;
    }
    if (line.startsWith("worktree ")) {
      worktreePath = line.slice("worktree ".length);
    } else if (line.startsWith("branch ")) {
      worktreeBranch = line.slice("branch ".length);
    }
  }

  return flush();
}

async function assertTicketBranchUpToDate(root, branch, defaultBranch) {
  const containsDefaultTip = await gitOk(root, ["merge-base", "--is-ancestor", defaultBranch, branch]);
  if (!containsDefaultTip) {
    throw new Error(
      `auto-merge requires ticket branch ${branch} to contain the tip of ${defaultBranch}; ` +
        `run \`git rebase ${defaultBranch}\` or \`git merge ${defaultBranch}\` on ${branch} and retry`,
    );
  }
}

// Commits the planning-only subset of the working tree (plans/**, per
// isPlanningPath) immediately after a successful mutating CLI command, so
// ticket state survives destructive git operations (an aborted merge, a
// `git checkout -- .` probe) that would otherwise destroy uncommitted
// evidence between stage transitions. Dirty-check-first makes a clean
// worktree a true no-op; non-git roots are a legitimate config, not an
// error. Never throws: any git failure downgrades to a stderr warning so a
// planning-commit failure can never roll back — or block — the mutation
// that already completed before this helper runs. The `git add plans` scope
// here is kept in lockstep with isPlanningPath's `plans/` prefix test — both
// must change together if the planning root ever moves.
export async function commitPlanningTransition(root, { ticketId, command, detail }) {
  let isGitRoot = false;
  try {
    await gitOutput(root, ["rev-parse", "--is-inside-work-tree"]);
    isGitRoot = true;
  } catch {
    isGitRoot = false;
  }
  if (!isGitRoot) {
    return { committed: false, reason: "non-git" };
  }

  const entries = await workingTreeEntries(root);
  const hasPlanningChanges = entries.some((entry) => entry.paths.some(isPlanningPath));
  if (!hasPlanningChanges) {
    return { committed: false, reason: "clean" };
  }

  try {
    await gitRun(root, ["add", "plans"]);
    const stagedIsClean = await gitOk(root, ["diff", "--cached", "--quiet"]);
    if (stagedIsClean) {
      return { committed: false, reason: "clean" };
    }
    await gitRun(root, ["commit", "-m", `${ticketId}: ${command} ${detail}`]);
    return { committed: true };
  } catch (error) {
    console.error(`warning: planning commit skipped: ${error.message}`);
    return { committed: false, reason: "error", error };
  }
}

async function commitPlanningChanges(root, ticketId, options) {
  const entries = await workingTreeEntries(root);
  const hasPlanningChanges = entries.some((entry) => entry.paths.some(isPlanningPath));
  if (!hasPlanningChanges) {
    return "none";
  }
  if (options.commitPlanningChanges === false) {
    throw new Error("auto-merge found uncommitted planning changes and git.commitPlanningChanges is false");
  }

  await gitRun(root, ["add", "plans"]);
  const stagedIsClean = await gitOk(root, ["diff", "--cached", "--quiet"]);
  if (stagedIsClean) {
    return "none";
  }
  await gitRun(root, ["commit", "-m", `Complete ${ticketId}`]);
  return "committed";
}

async function workingTreeEntries(root) {
  const status = await gitRawOutput(root, ["status", "--porcelain"]);
  if (status.trim() === "") {
    return [];
  }
  return status.split(/\r?\n/).filter((line) => line !== "").map(parseStatusLine);
}

function parseStatusLine(line) {
  const rawPath = line.slice(3).trim();
  const paths = rawPath.includes(" -> ") ? rawPath.split(" -> ") : [rawPath];
  return {
    code: line.slice(0, 2),
    paths: paths.map(unquoteGitPath),
  };
}

function unquoteGitPath(value) {
  if (value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1);
  }
  return value;
}

// Shared "planning path" classifier: the one source of truth for what
// counts as planning state (currently `plans/**`), reused by
// assertNoNonPlanningChanges, commitPlanningChanges, and
// commitPlanningTransition so all three resolve planning-vs-non-planning
// identically. Visibility-only export; behavior is unchanged.
export function isPlanningPath(changedPath) {
  return changedPath.replace(/\\/g, "/").startsWith("plans/");
}

export async function resolveDefaultBranch(root, configuredBranch) {
  if (typeof configuredBranch === "string" && configuredBranch.trim() !== "") {
    await assertBranchName(root, configuredBranch);
    return configuredBranch;
  }

  try {
    const originHead = await gitOutput(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
    if (originHead.startsWith("origin/")) {
      return originHead.slice("origin/".length);
    }
  } catch {
    // Fall through to common local branch names.
  }

  for (const candidate of ["main", "master"]) {
    if (await gitOk(root, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`])) {
      return candidate;
    }
  }

  throw new Error("could not determine default branch; set git.defaultBranch in plans/local-board.config.jsonc");
}

async function abortMergeAndReturn(root, branch) {
  try {
    await gitRun(root, ["merge", "--abort"]);
  } catch {
    // Best effort cleanup. The original merge error is more useful to the caller.
  }
  try {
    await gitRun(root, ["switch", branch]);
  } catch {
    // Leave the repository state visible if switching back is not possible.
  }
}

export async function assertBranchName(root, branch) {
  if (branch.trim() === "") {
    throw new Error("branch name is required");
  }
  await gitRun(root, ["check-ref-format", "--branch", branch]);
}

export async function currentBranch(root) {
  const branch = await gitOutput(root, ["branch", "--show-current"]);
  return branch === "" ? await gitOutput(root, ["rev-parse", "--abbrev-ref", "HEAD"]) : branch;
}

export async function gitRun(root, args) {
  try {
    await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });
  } catch (error) {
    throw new Error(formatGitError(args, error));
  }
}

export async function gitOutput(root, args) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });
    return stdout.trim();
  } catch (error) {
    throw new Error(formatGitError(args, error));
  }
}

export async function gitRawOutput(root, args) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });
    return stdout;
  } catch (error) {
    throw new Error(formatGitError(args, error));
  }
}

export async function gitOk(root, args) {
  try {
    await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });
    return true;
  } catch (error) {
    if (error.code === 1) {
      return false;
    }
    throw new Error(formatGitError(args, error));
  }
}

export async function recordTicketBranch(root, ticketId, ticket, branch, options = {}) {
  if (ticket.frontMatter.branch === branch) {
    return options.currentPath ?? ticket.path;
  }
  return setTicketField(root, ticketId, "branch", branch, { now: options.now });
}

export function ticketBranchName(ticket, overrideBranch = undefined) {
  return overrideBranch ?? ticket.frontMatter.branch ?? defaultBranchName(ticket);
}

function defaultBranchName(ticket) {
  return `local-board/${ticket.id}-${slugify(ticket.title)}`;
}

function slugify(value) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "ticket" : slug;
}

function formatGitError(args, error) {
  const detail = [error.stderr, error.stdout, error.message].filter(Boolean).join("\n").trim();
  return `git ${args.join(" ")} failed${detail === "" ? "" : `: ${detail}`}`;
}
