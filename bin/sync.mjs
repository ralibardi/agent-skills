#!/usr/bin/env node
// Makes the globally installed agent skills match skills.manifest.json by
// running the `skills` CLI (https://github.com/vercel-labs/skills).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readJson, readLockSkills, readPreviouslyManaged, statePath } from "../lib/files.mjs";
import { nextManagedSet, planSync, validateManifest } from "../lib/plan.mjs";

const SKILLS_CLI = process.env.SKILLS_CLI ?? "skills@^1.7.4";
const DEFAULT_MANIFEST = fileURLToPath(new URL("../skills.manifest.json", import.meta.url));

const HELP = `Usage: agent-skills [options]

Installs, updates and removes global agent skills so they match the manifest.

Options:
  --manifest <path>  Manifest to read (default: the one shipped in this repo)
  --dry-run          Print the skills commands without running them
  --no-update        Skip updating skills that are already installed
  -h, --help         Show this help
`;

function runSkills(args, { dryRun }) {
  const printable = ["npx", SKILLS_CLI, ...args]
    .map((a) => (a === "*" || a.includes(" ") ? `'${a}'` : a))
    .join(" ");
  console.log(`\n$ ${printable}`);
  if (dryRun) return true;
  const result = spawnSync("npx", ["--yes", SKILLS_CLI, ...args], { stdio: "inherit" });
  if (result.error) console.error(`  Could not start npx: ${result.error.message}`);
  return result.status === 0;
}

function main() {
  const { values } = parseArgs({
    options: {
      manifest: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "no-update": { type: "boolean", default: false },
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
    return 1;
  }
  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    console.error(`Invalid manifest ${manifestPath}:\n  - ${errors.join("\n  - ")}`);
    return 1;
  }

  const dryRun = values["dry-run"];
  const previouslyManaged = readPreviouslyManaged();
  const plan = planSync({
    manifest,
    home: homedir(),
    lockSkills: readLockSkills(),
    previouslyManaged,
  });
  const agentArgs = ["-a", ...manifest.agents];
  const failures = [];

  console.log(`Manifest: ${manifestPath}${dryRun ? " (dry run)" : ""}`);

  // No -a on remove: a dropped skill should leave every agent, not just the
  // ones the manifest lists today.
  if (plan.removals.length > 0) {
    if (!runSkills(["remove", ...plan.removals, "-g", "-y"], { dryRun })) {
      failures.push(`remove ${plan.removals.join(", ")}`);
    }
  }

  for (const { source, local, skills } of plan.installs) {
    // A folder source only exists on machines that have it (e.g. Xcode's
    // skills), so a missing folder is skipped rather than failing the sync.
    if (local && !existsSync(source)) {
      console.warn(`\nSkipping ${source}: folder not found.`);
      continue;
    }
    if (!runSkills(["add", source, "--skill", ...skills, "-g", ...agentArgs, "-y"], { dryRun })) {
      failures.push(`add ${source} (${skills.join(", ")})`);
    }
  }

  if (!values["no-update"] && plan.updates.length > 0) {
    if (!runSkills(["update", ...plan.updates, "-g", "-y"], { dryRun })) {
      failures.push(`update ${plan.updates.join(", ")}`);
    }
  }

  if (plan.removals.length + plan.installs.length + plan.updates.length === 0) {
    console.log("\nNothing to do.");
  }

  if (!dryRun) {
    const managed = nextManagedSet({ ...plan, lockSkills: readLockSkills(), previouslyManaged });
    mkdirSync(dirname(statePath()), { recursive: true });
    writeFileSync(statePath(), `${JSON.stringify({ managed }, null, 2)}\n`);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} step(s) failed:\n  - ${failures.join("\n  - ")}`);
    return 1;
  }
  console.log("\nDone.");
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
