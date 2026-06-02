import test from "node:test";
import assert from "node:assert/strict";

import { main } from "../src/cli.js";
import { DEFAULT_MAX_TEAMMATES, MAX_TEAMMATES_ENV, resolveMaxTeammates } from "../src/team.js";

test("resolveMaxTeammates defaults to 6 when the env var is unset", () => {
  const result = resolveMaxTeammates({});
  assert.equal(result.maxTeammates, DEFAULT_MAX_TEAMMATES);
  assert.equal(result.source, "default");
  assert.equal(result.envVar, MAX_TEAMMATES_ENV);
});

test("resolveMaxTeammates reads a valid positive integer override", () => {
  const result = resolveMaxTeammates({ [MAX_TEAMMATES_ENV]: "10" });
  assert.equal(result.maxTeammates, 10);
  assert.equal(result.source, "env");
});

test("resolveMaxTeammates trims surrounding whitespace", () => {
  const result = resolveMaxTeammates({ [MAX_TEAMMATES_ENV]: "  3  " });
  assert.equal(result.maxTeammates, 3);
  assert.equal(result.source, "env");
});

test("resolveMaxTeammates falls back to default for empty string", () => {
  const result = resolveMaxTeammates({ [MAX_TEAMMATES_ENV]: "   " });
  assert.equal(result.maxTeammates, DEFAULT_MAX_TEAMMATES);
  assert.equal(result.source, "default");
});

test("resolveMaxTeammates rejects zero and negatives, falling back to default", () => {
  for (const bad of ["0", "-2"]) {
    const result = resolveMaxTeammates({ [MAX_TEAMMATES_ENV]: bad });
    assert.equal(result.maxTeammates, DEFAULT_MAX_TEAMMATES);
    assert.equal(result.source, "default");
    assert.equal(result.invalid, bad);
  }
});

test("resolveMaxTeammates rejects non-integer values, falling back to default", () => {
  for (const bad of ["abc", "3.5", "6x", "1e2"]) {
    const result = resolveMaxTeammates({ [MAX_TEAMMATES_ENV]: bad });
    assert.equal(result.maxTeammates, DEFAULT_MAX_TEAMMATES);
    assert.equal(result.source, "default");
    assert.equal(result.invalid, bad);
  }
});

test("team-config CLI reports the resolved max from the environment", async () => {
  const previous = process.env[MAX_TEAMMATES_ENV];
  try {
    process.env[MAX_TEAMMATES_ENV] = "9";
    const json = await runCli(["team-config", "--json"]);
    assert.equal(json.code, 0);
    const parsed = JSON.parse(json.stdout);
    assert.equal(parsed.maxTeammates, 9);
    assert.equal(parsed.source, "env");

    delete process.env[MAX_TEAMMATES_ENV];
    const fallback = await runCli(["team-config", "--json"]);
    assert.equal(JSON.parse(fallback.stdout).maxTeammates, DEFAULT_MAX_TEAMMATES);
  } finally {
    if (previous === undefined) {
      delete process.env[MAX_TEAMMATES_ENV];
    } else {
      process.env[MAX_TEAMMATES_ENV] = previous;
    }
  }
});

async function runCli(args) {
  const stdout = [];
  const stderr = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (message = "") => stdout.push(String(message));
  console.error = (message = "") => stderr.push(String(message));
  try {
    const code = await main(args);
    return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}
