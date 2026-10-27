import { realpathSync } from "node:fs";
import path from "node:path";

// Physical spelling of a path, for building EXPECTED values. Fixtures live
// under os.tmpdir(), which can be reached through a symlink (macOS:
// /var -> /private/var) or an 8.3 short name (Windows runners:
// C:\Users\RUNNER~1). The CLI reports paths the way git does, physically, so
// tests compare against this instead of the fixture's own spelling. The
// fixtures themselves keep the symlinked spelling on purpose: that is the
// case the CLI must handle (see test/symlink-root.test.js).
//
// Deliberately independent of src/paths.js so it can serve as the oracle.
// A path that doesn't exist (yet, or any more) keeps its missing tail and
// canonicalizes the nearest existing ancestor.
export function physicalPath(value) {
  let current = path.resolve(value);
  const tail = [];
  for (;;) {
    try {
      return path.join(realpathSync.native(current), ...tail.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return path.resolve(value);
      }
      tail.push(path.basename(current));
      current = parent;
    }
  }
}
