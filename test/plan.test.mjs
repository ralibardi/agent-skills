import assert from "node:assert/strict";
import { test } from "node:test";
import { nextManagedSet, normalizeRepo, planRemovals, planSync, validateManifest } from "../lib/plan.mjs";

const lockEntry = (source) => ({ source, sourceType: "github" });

test("normalizeRepo accepts the spellings the skills CLI accepts", () => {
  assert.equal(normalizeRepo("MattPocock/Skills"), "mattpocock/skills");
  assert.equal(normalizeRepo("https://github.com/t3dotgg/tstack.git"), "t3dotgg/tstack");
  assert.equal(normalizeRepo("git@github.com:t3dotgg/tstack.git"), "t3dotgg/tstack");
});

test("validateManifest rejects a skill name claimed by two repos", () => {
  const errors = validateManifest({
    agents: ["claude-code"],
    sources: [
      { repo: "a/one", skills: ["tdd"] },
      { repo: "b/two", skills: ["tdd"] },
    ],
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /"tdd" is listed under both a\/one and b\/two/);
});

test("validateManifest rejects missing agents, bad repos and empty skill lists", () => {
  const errors = validateManifest({
    agents: [],
    sources: [{ repo: "no-slash", skills: ["x"] }, { repo: "a/b", skills: [] }],
  });
  assert.equal(errors.length, 3);
});

test("the shipped manifest is valid", async () => {
  const { default: manifest } = await import("../skills.manifest.json", { with: { type: "json" } });
  assert.deepEqual(validateManifest(manifest), []);
});

test("planSync installs missing skills and updates ones already from the same repo", () => {
  const plan = planSync({
    manifest: {
      agents: ["claude-code"],
      sources: [{ repo: "mattpocock/skills", skills: ["tdd", "triage"] }],
    },
    lockSkills: { tdd: lockEntry("mattpocock/skills") },
    previouslyManaged: {},
  });
  assert.deepEqual(plan.installs, [{ source: "mattpocock/skills", local: false, skills: ["triage"] }]);
  assert.deepEqual(plan.updates, ["tdd"]);
});

test("planSync reinstalls a skill that is currently installed from another repo", () => {
  const plan = planSync({
    manifest: { agents: ["codex"], sources: [{ repo: "t3dotgg/tstack", skills: ["modernize"] }] },
    lockSkills: { modernize: lockEntry("someone-else/skills") },
    previouslyManaged: {},
  });
  assert.deepEqual(plan.installs, [{ source: "t3dotgg/tstack", local: false, skills: ["modernize"] }]);
  assert.deepEqual(plan.updates, []);
});

test("planSync always re-adds wildcard sources", () => {
  const plan = planSync({
    manifest: { agents: ["codex"], sources: [{ repo: "ralibardi/agent-skills", skills: "*" }] },
    lockSkills: { "merge-main-verify": lockEntry("ralibardi/agent-skills") },
    previouslyManaged: {},
  });
  assert.deepEqual(plan.installs, [{ source: "ralibardi/agent-skills", local: false, skills: ["*"] }]);
  assert.deepEqual(plan.updates, []);
});

const XCODE = "/Users/me/Library/Developer/Xcode/CodingAssistant/codex/skills/__xcode";
const localEntry = (source) => ({ source, sourceType: "local" });

test("validateManifest accepts folder sources and rejects relative or doubled ones", () => {
  assert.deepEqual(
    validateManifest({ agents: ["codex"], sources: [{ path: "~/xcode", skills: ["translation"] }] }),
    [],
  );
  const errors = validateManifest({
    agents: ["codex"],
    sources: [
      { path: "relative/dir", skills: ["a"] },
      { repo: "a/b", path: "/abs", skills: ["b"] },
    ],
  });
  assert.equal(errors.length, 2);
});

test("planSync expands ~ and always re-adds folder sources instead of updating", () => {
  const plan = planSync({
    manifest: {
      agents: ["codex"],
      sources: [
        {
          path: "~/Library/Developer/Xcode/CodingAssistant/codex/skills/__xcode",
          skills: ["swiftui-specialist", "translation"],
        },
      ],
    },
    home: "/Users/me",
    lockSkills: { "swiftui-specialist": localEntry(XCODE) },
    previouslyManaged: {},
  });
  assert.deepEqual(plan.installs, [
    { source: XCODE, local: true, skills: ["swiftui-specialist", "translation"] },
  ]);
  assert.deepEqual(plan.updates, []);
});

test("folder sources are managed and removed by path like repos", () => {
  const lockSkills = { translation: localEntry(XCODE), "swiftui-specialist": localEntry(XCODE) };
  const managed = nextManagedSet({
    desired: new Map([["translation", XCODE]]),
    wildcardSources: new Set(),
    lockSkills,
    previouslyManaged: { "swiftui-specialist": XCODE },
  });
  assert.deepEqual(managed, { translation: XCODE, "swiftui-specialist": XCODE });

  const plan = planSync({
    manifest: { agents: ["codex"], sources: [{ path: XCODE, skills: ["translation"] }] },
    lockSkills,
    previouslyManaged: managed,
  });
  assert.deepEqual(plan.removals, ["swiftui-specialist"]);
});

test("nextManagedSet adopts listed skills and leaves hand-installed ones alone", () => {
  const managed = nextManagedSet({
    desired: new Map([["tdd", "mattpocock/skills"]]),
    wildcardSources: new Set(["ralibardi/agent-skills"]),
    lockSkills: {
      tdd: lockEntry("mattpocock/skills"),
      "merge-main-verify": lockEntry("ralibardi/agent-skills"),
      "clerk-setup": lockEntry("clerk/skills"),
    },
    previouslyManaged: {},
  });
  assert.deepEqual(managed, {
    tdd: "mattpocock/skills",
    "merge-main-verify": "ralibardi/agent-skills",
  });
});

test("nextManagedSet keeps a dropped skill managed while it is still installed", () => {
  const managed = nextManagedSet({
    desired: new Map(),
    wildcardSources: new Set(),
    lockSkills: { triage: lockEntry("mattpocock/skills") },
    previouslyManaged: { triage: "mattpocock/skills" },
  });
  assert.deepEqual(managed, { triage: "mattpocock/skills" });
});

const removalInput = (overrides) => ({
  desired: new Map(),
  wildcardSources: new Set(),
  lockSkills: {},
  previouslyManaged: {},
  ...overrides,
});

test("planRemovals removes a previously managed skill that was dropped from the manifest", () => {
  const removals = planRemovals(
    removalInput({
      desired: new Map([["tdd", "mattpocock/skills"]]),
      lockSkills: { tdd: lockEntry("mattpocock/skills"), triage: lockEntry("mattpocock/skills") },
      previouslyManaged: { tdd: "mattpocock/skills", triage: "mattpocock/skills" },
    }),
  );
  assert.deepEqual(removals, ["triage"]);
});

test("planRemovals removes every managed skill of a repo dropped from the manifest", () => {
  const removals = planRemovals(
    removalInput({
      lockSkills: { council: lockEntry("t3dotgg/tstack"), "file-pr": lockEntry("t3dotgg/tstack") },
      previouslyManaged: { council: "t3dotgg/tstack", "file-pr": "t3dotgg/tstack" },
    }),
  );
  assert.deepEqual(removals, ["council", "file-pr"]);
});

test("planRemovals never removes a skill this tool did not install or adopt", () => {
  const removals = planRemovals(
    removalInput({
      desired: new Map([["tdd", "mattpocock/skills"]]),
      lockSkills: {
        tdd: lockEntry("mattpocock/skills"),
        "setup-matt-pocock-skills": lockEntry("mattpocock/skills"),
        "clerk-setup": lockEntry("clerk/skills"),
      },
      previouslyManaged: { tdd: "mattpocock/skills" },
    }),
  );
  assert.deepEqual(removals, []);
});

test("planRemovals keeps a skill that is now installed from a different repo", () => {
  const removals = planRemovals(
    removalInput({
      lockSkills: { modernize: lockEntry("someone-else/skills") },
      previouslyManaged: { modernize: "t3dotgg/tstack" },
    }),
  );
  assert.deepEqual(removals, []);
});

test("planRemovals keeps skills still covered by a wildcard source or moved to another repo", () => {
  const removals = planRemovals(
    removalInput({
      desired: new Map([["tdd", "someone-else/skills"]]),
      wildcardSources: new Set(["ralibardi/agent-skills"]),
      lockSkills: {
        tdd: lockEntry("mattpocock/skills"),
        "merge-main-verify": lockEntry("ralibardi/agent-skills"),
      },
      previouslyManaged: { tdd: "mattpocock/skills", "merge-main-verify": "ralibardi/agent-skills" },
    }),
  );
  assert.deepEqual(removals, []);
});

test("planRemovals skips managed skills that are no longer installed", () => {
  const removals = planRemovals(removalInput({ previouslyManaged: { triage: "mattpocock/skills" } }));
  assert.deepEqual(removals, []);
});

test("planSync passes dropped skills through to removals", () => {
  const plan = planSync({
    manifest: { agents: ["codex"], sources: [{ repo: "mattpocock/skills", skills: ["tdd"] }] },
    lockSkills: { tdd: lockEntry("mattpocock/skills"), triage: lockEntry("mattpocock/skills") },
    previouslyManaged: { tdd: "mattpocock/skills", triage: "mattpocock/skills" },
  });
  assert.deepEqual(plan.removals, ["triage"]);
  assert.deepEqual(plan.updates, ["tdd"]);
});
