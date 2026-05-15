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
