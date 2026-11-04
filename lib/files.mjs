// Where the skills CLI keeps its lock file, where this tool keeps its state,
// and how both commands read JSON. Shared by bin/sync.mjs and bin/audit.mjs.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Same lock location rule as the skills CLI. */
export function lockPath() {
  const stateHome = process.env.XDG_STATE_HOME;
  return stateHome
    ? join(stateHome, "skills", ".skill-lock.json")
    : join(homedir(), ".agents", ".skill-lock.json");
}

export function statePath() {
  return join(dirname(lockPath()), ".agent-skills-state.json");
}

export function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not parse ${path}: ${error.message}`);
  }
}

export function readLockSkills() {
  return readJson(lockPath(), {}).skills ?? {};
}

export function readPreviouslyManaged() {
  return readJson(statePath(), {}).managed ?? {};
}
