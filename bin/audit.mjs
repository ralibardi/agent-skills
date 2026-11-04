#!/usr/bin/env node
// Reports where the installed agent skills have drifted from
// skills.manifest.json. Read-only: it changes nothing.

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { auditSkills, formatReport, proposeManifest } from "../lib/audit.mjs";
import { lockPath, readJson, readLockSkills, readPreviouslyManaged } from "../lib/files.mjs";
import { validateManifest } from "../lib/plan.mjs";

const DEFAULT_MANIFEST = fileURLToPath(new URL("../skills.manifest.json", import.meta.url));

const HELP = `Usage: agent-skills-audit [options]

Compares the skills the skills CLI has installed with the manifest and
reports the differences. Nothing is changed.

Options:
  --manifest <path>  Manifest to read (default: the one shipped in this repo)
  --project <path>   Also check this repo's .claude/skills and .agents/skills
                     for copies of globally installed skills (repeatable)
  --json             Print the report as JSON instead of text
  --propose          Print a manifest that adds every unlisted source, naming
                     the skills currently installed from it
  -h, --help         Show this help

Exit code 0 means in sync, 1 means drift was found, 2 means it could not run.
`;

// Folders the skills CLI installs into when run without -g.
const PROJECT_SKILL_DIRS = [".claude/skills", ".agents/skills"];

function projectSkillNames(projectPath) {
  const names = new Set();
  for (const dir of PROJECT_SKILL_DIRS) {
    const full = join(projectPath, dir);
    if (!existsSync(full)) continue;
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      // Symlinks count: that is how the CLI links one install into several agents.
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (existsSync(join(full, entry.name, "SKILL.md"))) names.add(entry.name);
    }
  }
  return [...names].sort();
}

function main() {
  const { values } = parseArgs({
    options: {
      manifest: { type: "string" },
      project: { type: "string", multiple: true, default: [] },
      json: { type: "boolean", default: false },
      propose: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }

  const manifestPath = resolve(values.manifest ?? DEFAULT_MANIFEST);
  const manifest = readJson(manifestPath, null);
  if (!manifest) {
    console.error(`Manifest not found: ${manifestPath}`);
    return 2;
  }
  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    console.error(`Invalid manifest ${manifestPath}:\n  - ${errors.join("\n  - ")}`);
    return 2;
  }
  if (!existsSync(lockPath())) {
    console.error(`No skills lock file at ${lockPath()}; nothing is installed yet.`);
    return 2;
  }

  const projectSkills = {};
  for (const project of values.project) {
    const path = resolve(project);
    if (!existsSync(path)) {
      console.error(`Project folder not found: ${path}`);
      return 2;
    }
    projectSkills[path] = projectSkillNames(path);
  }

  const home = homedir();
  const report = auditSkills({
    manifest,
    home,
    lockSkills: readLockSkills(),
    previouslyManaged: readPreviouslyManaged(),
    projectSkills,
  });

  if (values.propose) {
    console.log(JSON.stringify(proposeManifest(manifest, report, home), null, 2));
  } else if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Manifest: ${manifestPath}\nLock:     ${lockPath()}\n`);
    process.stdout.write(formatReport(report));
  }

  const drift = Object.values(report).some((findings) => findings.length > 0);
  return drift ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
