// Pure audit logic. Compares what the `skills` CLI has actually installed
// (its lock file) with what the manifest says should be installed, and
// reports the differences. Nothing here touches the disk or the network.

import { isAbsolute } from "node:path";
import { resolveSources, sourceKey } from "./plan.mjs";

const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sortNames = (names) => [...names].sort(byString);

/** Collapses a home-relative absolute path back to the `~/` spelling. */
function contractHome(path, home) {
  if (!home) return path;
  if (path === home) return "~";
  return path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
}

/**
 * Audits the installed skills against the manifest.
 *
 * @param {object} input
 * @param {object} input.manifest - parsed skills.manifest.json.
 * @param {string} [input.home] - home directory, to expand `~/` in folder sources.
 * @param {Record<string, {source?: string}>} input.lockSkills - entries from
 *   the skills CLI lock file, keyed by skill name.
 * @param {Record<string, string>} [input.previouslyManaged] - skill name ->
 *   source key saved by the last sync run.
 * @param {Record<string, string[]>} [input.projectSkills] - project path ->
 *   names of skills installed inside that project.
 * @returns {{
 *   unlisted: {source: string, local: boolean, skills: string[]}[],
 *   strays: {source: string, skills: string[]}[],
 *   missing: {source: string, skills: string[]}[],
 *   moved: {name: string, wanted: string, installed: string}[],
 *   staleState: string[],
 *   duplicates: {name: string, project: string, source: string}[],
 * }}
 */
export function auditSkills({ manifest, home = "", lockSkills, previouslyManaged = {}, projectSkills = {} }) {
  const sources = resolveSources(manifest, home);
  const listedSources = new Map(sources.map((s) => [s.key, s]));
  const wanted = new Map(); // skill name -> source key, for skills named in the manifest
  for (const source of sources) {
    if (source.skills === "*") continue;
    for (const name of source.skills) wanted.set(name, source.key);
  }

  const installed = new Map(); // skill name -> source key
  for (const [name, entry] of Object.entries(lockSkills)) {
    const source = entry?.source;
    if (typeof source !== "string" || source.trim() === "") continue;
    installed.set(name, sourceKey(source));
  }

  const unlistedBySource = new Map();
  const straysBySource = new Map();
  const moved = [];
  for (const [name, key] of installed) {
    const wantedKey = wanted.get(name);
    if (wantedKey !== undefined) {
      if (wantedKey !== key) moved.push({ name, wanted: wantedKey, installed: key });
      continue;
    }
    const listed = listedSources.get(key);
    if (!listed) {
      if (!unlistedBySource.has(key)) unlistedBySource.set(key, []);
      unlistedBySource.get(key).push(name);
    } else if (listed.skills !== "*") {
      if (!straysBySource.has(key)) straysBySource.set(key, []);
      straysBySource.get(key).push(name);
    }
  }

  const missing = [];
  for (const source of sources) {
    if (source.skills === "*") {
      const any = [...installed.values()].some((key) => key === source.key);
      if (!any) missing.push({ source: source.key, skills: ["*"] });
      continue;
    }
    const absent = source.skills.filter((name) => !installed.has(name));
    if (absent.length > 0) missing.push({ source: source.key, skills: sortNames(absent) });
  }

  const staleState = Object.keys(previouslyManaged).filter((name) => !installed.has(name));

  const duplicates = [];
  for (const [project, names] of Object.entries(projectSkills)) {
    for (const name of names) {
      if (installed.has(name)) duplicates.push({ name, project, source: installed.get(name) });
    }
  }

  const grouped = (map, extra) =>
    [...map.entries()]
      .sort(([a], [b]) => byString(a, b))
      .map(([source, skills]) => ({ source, ...extra(source), skills: sortNames(skills) }));

  return {
    unlisted: grouped(unlistedBySource, (source) => ({ local: isAbsolute(source) })),
    strays: grouped(straysBySource, () => ({})),
    missing: missing.sort((a, b) => byString(a.source, b.source)),
    moved: moved.sort((a, b) => byString(a.name, b.name)),
    staleState: sortNames(staleState),
    duplicates: duplicates.sort((a, b) => byString(a.name, b.name) || byString(a.project, b.project)),
  };
}

/**
 * Returns a copy of the manifest with every unlisted source appended, naming
 * its installed skills explicitly. Explicit names, not `"*"`: adopting a
 * source should not silently pull in skills it publishes later.
 */
export function proposeManifest(manifest, report, home = "") {
  const added = report.unlisted.map(({ source, local, skills }) =>
    local ? { path: contractHome(source, home), skills } : { repo: source, skills },
  );
  return { ...manifest, sources: [...manifest.sources, ...added] };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Renders the audit as text for the terminal. */
export function formatReport(report) {
  const sections = [];
  const skillCount = (groups) => groups.reduce((sum, g) => sum + g.skills.length, 0);
  const groupLines = (groups) => groups.map((g) => `  ${g.source}: ${g.skills.join(", ")}`);

  if (report.unlisted.length > 0) {
    sections.push([
      `Not in the manifest (${plural(report.unlisted.length, "source")}, ${plural(skillCount(report.unlisted), "skill")})`,
      "  Installed by hand. Add the source to the manifest (see --propose) or remove the skills.",
      ...groupLines(report.unlisted),
    ]);
  }
  if (report.strays.length > 0) {
    sections.push([
      `Installed from a listed source but not named there (${plural(skillCount(report.strays), "skill")})`,
      "  Add the names to that source's list, or remove the skills.",
      ...groupLines(report.strays),
    ]);
  }
  if (report.missing.length > 0) {
    sections.push([
      `Listed but not installed (${plural(skillCount(report.missing), "skill")})`,
      "  Run the sync to install them.",
      ...groupLines(report.missing),
    ]);
  }
  if (report.moved.length > 0) {
    sections.push([
      `Installed from a different source than the manifest wants (${plural(report.moved.length, "skill")})`,
      "  The sync will reinstall them from the listed source.",
      ...report.moved.map((m) => `  ${m.name}: wanted ${m.wanted}, installed ${m.installed}`),
    ]);
  }
  if (report.staleState.length > 0) {
    sections.push([
      `Tracked by the sync state but no longer installed (${plural(report.staleState.length, "skill")})`,
      "  Harmless; the next sync run forgets them.",
      `  ${report.staleState.join(", ")}`,
    ]);
  }
  if (report.duplicates.length > 0) {
    sections.push([
      `Project skills that shadow a global install (${plural(report.duplicates.length, "skill")})`,
      "  The project copy wins inside that repo and will drift. Delete it unless it is deliberately different.",
      ...report.duplicates.map((d) => `  ${d.project}: ${d.name} (global copy from ${d.source})`),
    ]);
  }

  if (sections.length === 0) return "Installed skills are in sync with the manifest.\n";
  return `${sections.map((lines) => lines.join("\n")).join("\n\n")}\n`;
}
