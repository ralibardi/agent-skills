// Pure planning logic for the sync script. Compares the manifest with the
// `skills` CLI lock file and the skills this tool managed on its last run,
// then decides what to install, update and remove. No I/O happens here.

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
  const repos = new Set();
  manifest.sources.forEach((source, index) => {
    const label = `sources[${index}]`;
    if (typeof source?.repo !== "string" || !source.repo.includes("/")) {
      errors.push(`${label}.repo must look like "owner/repo".`);
      return;
    }
    const repo = normalizeRepo(source.repo);
    if (repos.has(repo)) errors.push(`${label}: "${repo}" is listed more than once.`);
    repos.add(repo);

    if (source.skills === "*") return;
    if (!Array.isArray(source.skills) || source.skills.length === 0) {
      errors.push(`${label}.skills must be "*" or a non-empty array of skill names.`);
      return;
    }
    for (const name of source.skills) {
      // The lock file is keyed by skill name, so two sources cannot share one.
      if (ownerOf.has(name)) {
        errors.push(`"${name}" is listed under both ${ownerOf.get(name)} and ${repo}.`);
      }
      ownerOf.set(name, repo);
    }
  });
  return errors;
}

/**
 * Decides which previously managed skills to uninstall.
 *
 * @param {object} input
 * @param {Map<string, string>} input.desired - skill name -> repo, for skills
 *   listed by name in the manifest.
 * @param {Set<string>} input.wildcardRepos - repos listed with `"skills": "*"`.
 * @param {Record<string, {source?: string}>} input.lockSkills - entries from
 *   ~/.agents/.skill-lock.json, keyed by skill name.
 * @param {Record<string, string>} input.previouslyManaged - skill name -> repo
 *   for everything this tool installed or adopted on its last run.
 * @returns {string[]} skill names to pass to `skills remove`.
 */
export function planRemovals({ desired, wildcardRepos, lockSkills, previouslyManaged }) {
  // Conservative policy: only skills this tool managed and that the manifest
  // no longer lists. Skills from a listed repo that were never listed are kept.
  const removals = [];
  for (const [name, managedRepo] of Object.entries(previouslyManaged)) {
    const repo = normalizeRepo(managedRepo);
    // Still wanted, by name (from any repo; a new repo reinstalls over it) or via "*".
    if (desired.has(name) || wildcardRepos.has(repo)) continue;
    const entry = lockSkills[name];
    // Already gone, or reinstalled from another repo since: not ours any more.
    if (!entry || normalizeRepo(entry.source ?? "") !== repo) continue;
    removals.push(name);
  }
  return removals.sort();
}

/** Builds the full plan: installs, updates and removals. */
export function planSync({ manifest, lockSkills, previouslyManaged }) {
  const desired = new Map();
  const wildcardRepos = new Set();
  const installs = [];
  const updates = [];

  for (const source of manifest.sources) {
    const repo = normalizeRepo(source.repo);
    if (source.skills === "*") {
      // Without listing the repo we cannot tell which skills are new upstream,
      // so a wildcard source is always re-added; that also updates it.
      wildcardRepos.add(repo);
      installs.push({ repo, skills: ["*"] });
      continue;
    }

    const missing = [];
    for (const name of source.skills) {
      desired.set(name, repo);
      const entry = lockSkills[name];
      if (entry && normalizeRepo(entry.source ?? "") === repo) updates.push(name);
      else missing.push(name);
    }
    if (missing.length > 0) installs.push({ repo, skills: missing });
  }

  const removals = planRemovals({ desired, wildcardRepos, lockSkills, previouslyManaged });
  return { installs, updates, removals, desired, wildcardRepos };
}

/**
 * Works out which installed skills this tool now manages, to save as the next
 * run's `previouslyManaged`. Skills whose removal failed stay managed so the
 * next run retries them.
 */
export function nextManagedSet({ desired, wildcardRepos, lockSkills, previouslyManaged }) {
  const managed = {};
  for (const [name, entry] of Object.entries(lockSkills)) {
    const repo = normalizeRepo(entry?.source ?? "");
    const isManaged =
      desired.get(name) === repo ||
      wildcardRepos.has(repo) ||
      previouslyManaged[name] === repo;
    if (isManaged) managed[name] = repo;
  }
  return managed;
}
