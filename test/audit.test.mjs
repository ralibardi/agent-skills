import assert from "node:assert/strict";
import { test } from "node:test";
import { auditSkills, formatReport, proposeManifest } from "../lib/audit.mjs";

const lockEntry = (source) => ({ source, sourceType: "github" });
const XCODE = "/Users/me/Library/Developer/Xcode/CodingAssistant/codex/skills/__xcode";
const localEntry = (source) => ({ source, sourceType: "local" });

const manifest = {
  agents: ["claude-code", "codex"],
  sources: [
    { repo: "ralibardi/agent-skills", skills: "*" },
    { path: "~/Library/Developer/Xcode/CodingAssistant/codex/skills/__xcode", skills: ["translation"] },
    { repo: "mattpocock/skills", skills: ["tdd", "triage"] },
  ],
};

const audit = (overrides) =>
  auditSkills({ manifest, home: "/Users/me", lockSkills: {}, previouslyManaged: {}, ...overrides });

test("auditSkills reports nothing for a lock that matches the manifest", () => {
  const report = audit({
    lockSkills: {
      "merge-main-verify": lockEntry("ralibardi/agent-skills"),
      translation: localEntry(XCODE),
      tdd: lockEntry("mattpocock/skills"),
      triage: lockEntry("mattpocock/skills"),
    },
  });
  assert.deepEqual(report, {
    unlisted: [],
    strays: [],
    missing: [],
    moved: [],
    staleState: [],
    duplicates: [],
  });
});

test("auditSkills groups skills installed from sources the manifest does not name", () => {
  const report = audit({
    lockSkills: {
      "clerk-setup": lockEntry("clerk/skills"),
      "clerk-orgs": lockEntry("clerk/skills"),
      animate: lockEntry("emilkowalski/skills"),
      "my-local": localEntry("/Users/me/dev/skills"),
    },
  });
  assert.deepEqual(report.unlisted, [
    { source: "/Users/me/dev/skills", local: true, skills: ["my-local"] },
    { source: "clerk/skills", local: false, skills: ["clerk-orgs", "clerk-setup"] },
    { source: "emilkowalski/skills", local: false, skills: ["animate"] },
  ]);
});

test("auditSkills reports strays: installed from a listed source but not named there", () => {
  const report = audit({
    lockSkills: {
      tdd: lockEntry("mattpocock/skills"),
      triage: lockEntry("mattpocock/skills"),
      handoff: lockEntry("mattpocock/skills"),
    },
  });
  assert.deepEqual(report.strays, [{ source: "mattpocock/skills", skills: ["handoff"] }]);
  assert.deepEqual(report.unlisted, []);
});

test("auditSkills never treats wildcard-source skills as strays", () => {
  const report = audit({
    lockSkills: {
      "merge-main-verify": lockEntry("ralibardi/agent-skills"),
      "brand-new-skill": lockEntry("ralibardi/agent-skills"),
    },
  });
  assert.deepEqual(report.strays, []);
});

test("auditSkills reports named skills that are not installed, and wildcard sources with nothing installed", () => {
  const report = audit({ lockSkills: { tdd: lockEntry("mattpocock/skills") } });
  assert.deepEqual(report.missing, [
    { source: XCODE, skills: ["translation"] },
    { source: "mattpocock/skills", skills: ["triage"] },
    { source: "ralibardi/agent-skills", skills: ["*"] },
  ]);
});

test("auditSkills reports a named skill installed from a different source as moved, not missing", () => {
  const report = audit({ lockSkills: { tdd: lockEntry("someone-else/skills") } });
  assert.deepEqual(report.moved, [
    { name: "tdd", wanted: "mattpocock/skills", installed: "someone-else/skills" },
  ]);
  assert.ok(!report.missing.some((m) => m.skills.includes("tdd")));
  assert.deepEqual(report.unlisted, []);
});

test("auditSkills reports state entries for skills that are no longer installed", () => {
  const report = audit({
    lockSkills: { tdd: lockEntry("mattpocock/skills") },
    previouslyManaged: { tdd: "mattpocock/skills", council: "t3dotgg/tstack" },
  });
  assert.deepEqual(report.staleState, ["council"]);
});

test("auditSkills reports project skills that shadow a globally installed skill", () => {
  const report = audit({
    lockSkills: { tdd: lockEntry("mattpocock/skills"), triage: lockEntry("mattpocock/skills") },
    projectSkills: {
      "/repo/a": ["triage", "only-here"],
      "/repo/b": ["tdd"],
    },
  });
  assert.deepEqual(report.duplicates, [
    { name: "tdd", project: "/repo/b", source: "mattpocock/skills" },
    { name: "triage", project: "/repo/a", source: "mattpocock/skills" },
  ]);
});

test("auditSkills ignores lock entries without a source", () => {
  const report = audit({ lockSkills: { odd: { sourceType: "unknown" } } });
  assert.deepEqual(report.unlisted, []);
});

test("proposeManifest appends unlisted sources with explicit skill names and leaves the rest alone", () => {
  const report = audit({
    lockSkills: {
      "clerk-setup": lockEntry("clerk/skills"),
      "my-local": localEntry("/Users/me/dev/skills"),
    },
  });
  const proposed = proposeManifest(manifest, report, "/Users/me");
  assert.deepEqual(proposed.sources.slice(0, manifest.sources.length), manifest.sources);
  assert.deepEqual(proposed.sources.slice(manifest.sources.length), [
    { path: "~/dev/skills", skills: ["my-local"] },
    { repo: "clerk/skills", skills: ["clerk-setup"] },
  ]);
  // The input is not mutated.
  assert.equal(manifest.sources.length, 3);
});

test("formatReport says the install is in sync when there is nothing to report", () => {
  const text = formatReport(audit({ lockSkills: { tdd: lockEntry("mattpocock/skills"), triage: lockEntry("mattpocock/skills"), translation: localEntry(XCODE), x: lockEntry("ralibardi/agent-skills") } }));
  assert.match(text, /in sync/i);
});

test("formatReport names each finding with a count and the skills involved", () => {
  const text = formatReport(
    audit({
      lockSkills: { "clerk-setup": lockEntry("clerk/skills"), tdd: lockEntry("someone-else/skills") },
      previouslyManaged: { council: "t3dotgg/tstack" },
      projectSkills: { "/repo/a": ["clerk-setup"] },
    }),
  );
  assert.match(text, /Not in the manifest \(1 source, 1 skill\)/);
  assert.match(text, /clerk\/skills: clerk-setup/);
  assert.match(text, /tdd: wanted mattpocock\/skills, installed someone-else\/skills/);
  assert.match(text, /council/);
  assert.match(text, /\/repo\/a: clerk-setup/);
});
