import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { appendTicketComment, findTicket, moveTicket, setTicketField } from "./tickets.js";

const execFileAsync = promisify(execFile);

export async function startTicketWork(root, ticketId, options = {}) {
  const { ticket } = await findTicket(root, ticketId);
  const branch = options.branch ?? ticket.frontMatter.branch ?? defaultBranchName(ticket);
  await assertBranchName(root, branch);

  const git = await ensureGitBranch(root, branch, { allowDirty: options.allowDirty ?? false });
  const now = options.now ?? new Date();
  let ticketPath = ticket.path;

  if (ticket.frontMatter.branch !== branch) {
    ticketPath = await setTicketField(root, ticketId, "branch", branch, { now });
  }

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

  return { ticket: ticket.id, branch, defaultBranch, current };
}

export async function autoMergeTicketBranch(root, ticketId, options = {}) {
  const { ticket } = await findTicket(root, ticketId);
  const branch = ticket.frontMatter.branch;
  const defaultBranch = await resolveDefaultBranch(root, options.defaultBranch ?? null);
  const current = await currentBranch(root);

  assertMergeBranch(ticketId, branch, defaultBranch, current);
  await assertNoNonPlanningChanges(root);

  const now = options.now ?? new Date();
  await appendTicketComment(root, ticketId, "Run Log", `Auto-merge prepared for ${branch} into ${defaultBranch}.`, {
    now,
  });

  const planningCommit = await commitPlanningChanges(root, ticketId, options);
  await gitRun(root, ["switch", defaultBranch]);

  try {
    await gitRun(root, ["merge", "--no-ff", branch, "-m", `Merge ${ticketId}`]);
  } catch (error) {
    await abortMergeAndReturn(root, branch);
    throw error;
  }

  return {
    ticket: ticket.id,
    branch,
    defaultBranch,
    planningCommit,
    action: "merged",
  };
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

  if ((existsLocal || existsOrigin) && dirty && !options.allowDirty) {
    throw new Error(`working tree has uncommitted changes; refusing to switch to existing branch ${branch}`);
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

async function assertNoNonPlanningChanges(root) {
  const entries = await workingTreeEntries(root);
  const nonPlanning = entries.filter((entry) => entry.paths.some((changedPath) => !isPlanningPath(changedPath)));
  if (nonPlanning.length > 0) {
    const paths = nonPlanning.flatMap((entry) => entry.paths).join(", ");
    throw new Error(`auto-merge requires non-planning changes to be committed first: ${paths}`);
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

function isPlanningPath(changedPath) {
  return changedPath.replace(/\\/g, "/").startsWith("plans/");
}

async function resolveDefaultBranch(root, configuredBranch) {
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

async function assertBranchName(root, branch) {
  if (branch.trim() === "") {
    throw new Error("branch name is required");
  }
  await gitRun(root, ["check-ref-format", "--branch", branch]);
}

async function currentBranch(root) {
  const branch = await gitOutput(root, ["branch", "--show-current"]);
  return branch === "" ? await gitOutput(root, ["rev-parse", "--abbrev-ref", "HEAD"]) : branch;
}

async function gitRun(root, args) {
  try {
    await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });
  } catch (error) {
    throw new Error(formatGitError(args, error));
  }
}

async function gitOutput(root, args) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });
    return stdout.trim();
  } catch (error) {
    throw new Error(formatGitError(args, error));
  }
}

async function gitRawOutput(root, args) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });
    return stdout;
  } catch (error) {
    throw new Error(formatGitError(args, error));
  }
}

async function gitOk(root, args) {
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
