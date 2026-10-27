// Pure planning logic for the sync script. Compares the manifest with the
// `skills` CLI lock file and the skills this tool managed on its last run,
// then decides what to install, update and remove. No I/O happens here.

import { isAbsolute, join, resolve } from "node:path";

/** Reduces the repo spellings the skills CLI accepts to `owner/repo`. */
export function normalizeRepo(repo) {
  return String(repo)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

/**
 * Key for comparing a manifest source with a lock entry's `source`. The CLI
 * stores folder sources as absolute paths and repos as `owner/repo`.
 */
export function sourceKey(source) {
  const value = String(source).trim();
  return isAbsolute(value) ? resolve(value) : normalizeRepo(value);
}

/** Expands a leading `~/` in a manifest path. */
export function expandHome(path, home) {
  if (path === "~") return home;
  return path.startsWith("~/") ? join(home, path.slice(2)) : path;
}

/**
 * Turns manifest sources into what the plan works with: `target` is passed to
 * `skills add`, `key` matches lock entries, and `local` marks folder sources.
 */
export function resolveSources(manifest, home) {
  return manifest.sources.map((source) => {
    if (typeof source.path === "string") {
      const target = resolve(expandHome(source.path.trim(), home));
      return { target, key: target, local: true, skills: source.skills };
    }
    const target = source.repo.trim();
    return { target, key: normalizeRepo(target), local: false, skills: source.skills };
  });
}

/** Returns a list of problems with the manifest; empty means valid. */
export function validateManifest(manifest) {
  const errors = [];
  if (!Array.isArray(manifest?.agents) || manifest.agents.length === 0) {
    errors.push('"agents" must be a non-empty array of agent names, e.g. ["claude-code"].');
  }
  if (!Array.isArray(manifest?.sources)) {
    errors.push('"sources" must be an array.');
    return errors;
  }

  const ownerOf = new Map();
  const seen = new Set();
  manifest.sources.forEach((source, index) => {
    const label = `sources[${index}]`;
    const hasRepo = typeof source?.repo === "string";
    const hasPath = typeof source?.path === "string";
    if (hasRepo === hasPath) {
      errors.push(`${label} needs exactly one of "repo" or "path".`);
      return;
    }
    if (hasRepo && !source.repo.includes("/")) {
      errors.push(`${label}.repo must look like "owner/repo".`);
      return;
    }
    if (hasPath && !(source.path.startsWith("/") || source.path.startsWith("~/"))) {
      errors.push(`${label}.path must be absolute or start with "~/".`);
      return;
    }
    const key = hasRepo ? normalizeRepo(source.repo) : source.path.trim().replace(/\/+$/, "");
    if (seen.has(key)) errors.push(`${label}: "${key}" is listed more than once.`);
    seen.add(key);

    if (source.skills === "*") return;
    if (!Array.isArray(source.skills) || source.skills.length === 0) {
      errors.push(`${label}.skills must be "*" or a non-empty array of skill names.`);
      return;
    }
    for (const name of source.skills) {
      // The lock file is keyed by skill name, so two sources cannot share one.
      if (ownerOf.has(name)) {
        errors.push(`"${name}" is listed under both ${ownerOf.get(name)} and ${key}.`);
      }
      ownerOf.set(name, key);
    }
  });
  return errors;
}

/**
 * Decides which previously managed skills to uninstall.
 *
 * @param {object} input
 * @param {Map<string, string>} input.desired - skill name -> source key, for
 *   skills listed by name in the manifest.
 * @param {Set<string>} input.wildcardSources - source keys listed with
 *   `"skills": "*"`.
 * @param {Record<string, {source?: string}>} input.lockSkills - entries from
 *   ~/.agents/.skill-lock.json, keyed by skill name.
 * @param {Record<string, string>} input.previouslyManaged - skill name ->
 *   source key for everything this tool installed or adopted on its last run.
 * @returns {string[]} skill names to pass to `skills remove`.
 */
export function planRemovals({ desired, wildcardSources, lockSkills, previouslyManaged }) {
  // Conservative policy: only skills this tool managed and that the manifest
  // no longer lists. Skills from a listed source that were never listed are kept.
  const removals = [];
  for (const [name, managedSource] of Object.entries(previouslyManaged)) {
    const key = sourceKey(managedSource);
    // Still wanted, by name (from any source; a new one reinstalls over it) or via "*".
    if (desired.has(name) || wildcardSources.has(key)) continue;
    const entry = lockSkills[name];
    // Already gone, or reinstalled from another source since: not ours any more.
    if (!entry || sourceKey(entry.source ?? "") !== key) continue;
    removals.push(name);
  }
  return removals.sort();
}

/**
 * Builds the full plan: installs, updates and removals. `home` expands `~/`
 * in folder sources.
 */
export function planSync({ manifest, home = "", lockSkills, previouslyManaged }) {
  const desired = new Map();
  const wildcardSources = new Set();
  const installs = [];
  const updates = [];

  for (const source of resolveSources(manifest, home)) {
    const install = { source: source.target, local: source.local };
    if (source.skills === "*") {
      // Without listing the source we cannot tell which skills are new, so a
      // wildcard source is always re-added; that also updates it.
      wildcardSources.add(source.key);
      installs.push({ ...install, skills: ["*"] });
      continue;
    }

    const toInstall = [];
    for (const name of source.skills) {
      desired.set(name, source.key);
      const entry = lockSkills[name];
      // `skills update` skips folder sources, so those are always re-added.
      const installedHere = entry && sourceKey(entry.source ?? "") === source.key;
      if (installedHere && !source.local) updates.push(name);
      else toInstall.push(name);
    }
    if (toInstall.length > 0) installs.push({ ...install, skills: toInstall });
  }

  const removals = planRemovals({ desired, wildcardSources, lockSkills, previouslyManaged });
  return { installs, updates, removals, desired, wildcardSources };
}

/**
 * Works out which installed skills this tool now manages, to save as the next
 * run's `previouslyManaged`. Skills whose removal failed stay managed so the
 * next run retries them.
 */
export function nextManagedSet({ desired, wildcardSources, lockSkills, previouslyManaged }) {
  const managed = {};
  for (const [name, entry] of Object.entries(lockSkills)) {
    const key = sourceKey(entry?.source ?? "");
    const isManaged =
      desired.get(name) === key ||
      wildcardSources.has(key) ||
      (name in previouslyManaged && sourceKey(previouslyManaged[name]) === key);
    if (isManaged) managed[name] = key;
  }
  return managed;
}
