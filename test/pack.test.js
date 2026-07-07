import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

const execFileAsync = promisify(execFile);

test("npm pack --dry-run --json includes the publishable tree and excludes dev-only content", async () => {
  const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json"], {
    cwd: path.resolve("."),
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  const [result] = JSON.parse(stdout);
  const files = result.files.map((entry) => entry.path.replace(/\\/g, "/"));

  const includedExact = ["SKILL.md", "SKILL_TEAM.md", "install.mjs", "package.json"];
  for (const expected of includedExact) {
    assert.ok(files.includes(expected), `expected packed tree to include ${expected}`);
  }

  const includedPrefixes = ["bin/", "src/", "resources/", "agents/", "skills/"];
  for (const prefix of includedPrefixes) {
    assert.ok(
      files.some((file) => file.startsWith(prefix)),
      `expected packed tree to include files under ${prefix}`,
    );
  }

  const excludedPrefixes = ["plans/", "test/", "memory-bank/", "docs/", "scripts/"];
  for (const prefix of excludedPrefixes) {
    assert.ok(
      !files.some((file) => file.startsWith(prefix)),
      `expected packed tree to exclude files under ${prefix}`,
    );
  }
});
