import { realpathSync } from "node:fs";
import path from "node:path";

// Canonical (physical) spelling of a filesystem path, matching what git
// reports. git resolves symlinks and, on Windows, 8.3 short names
// (`rev-parse --show-toplevel`, `worktree list`), so a root reached through a
// symlink (macOS /var -> /private/var, a symlinked ~/code) or a short name
// (C:\Users\RUNNER~1) must be canonicalized before it is compared with git
// output. Without this the wrong-root guard fails open and worktree lookups
// miss.
//
// Paths that don't exist yet (a worktree about to be created, one just
// removed) canonicalize their nearest existing ancestor and keep the rest
// as given. Never throws: an unresolvable path comes back path.resolve()d.
export function canonicalPath(value) {
  const resolved = path.resolve(value);
  const missing = [];
  let current = resolved;
  for (;;) {
    const real = realpathOrNull(current);
    if (real !== null) {
      return missing.length === 0 ? real : path.join(real, ...missing.reverse());
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return resolved;
    }
    missing.push(path.basename(current));
    current = parent;
  }
}

function realpathOrNull(value) {
  let real;
  try {
    real = realpathSync.native(value);
  } catch {
    return null;
  }
  // On Windows, realpath.native turns a mapped network drive (Z:\repo) into
  // its UNC target (\\server\share\repo). git keeps the drive letter, and a
  // changed spelling can trip git's safe.directory ownership check, so keep
  // the drive form there. The JS realpath still resolves symlinks/junctions.
  if (process.platform === "win32" && real.startsWith("\\\\") && !value.startsWith("\\\\")) {
    try {
      return realpathSync(value);
    } catch {
      return null;
    }
  }
  return real;
}
