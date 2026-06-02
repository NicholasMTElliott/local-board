// Team-mode configuration resolved from the environment, not project config.
// The agent-teams docs do not recognize a project-level team config, so the
// only tunable that survives across runs is an environment variable.

export const MAX_TEAMMATES_ENV = "LOCAL_BOARD_MAX_TEAMMATES";
export const DEFAULT_MAX_TEAMMATES = 6;

// Resolve the maximum number of teammates the lead may run concurrently.
// Missing, empty, or invalid values fall back to the default rather than
// throwing — the lead must always get a usable number to size the team.
export function resolveMaxTeammates(env = process.env) {
  const raw = env?.[MAX_TEAMMATES_ENV];

  if (raw === undefined || String(raw).trim() === "") {
    return { maxTeammates: DEFAULT_MAX_TEAMMATES, source: "default", envVar: MAX_TEAMMATES_ENV };
  }

  const trimmed = String(raw).trim();
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 10);
    if (parsed >= 1) {
      return { maxTeammates: parsed, source: "env", envVar: MAX_TEAMMATES_ENV, raw: trimmed };
    }
  }

  return {
    maxTeammates: DEFAULT_MAX_TEAMMATES,
    source: "default",
    envVar: MAX_TEAMMATES_ENV,
    invalid: trimmed,
  };
}
