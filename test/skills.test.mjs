import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// This package has no dependencies, so there is no YAML parser here. These
// checks catch the frontmatter mistakes that stop skill loaders from reading a
// skill at all, without parsing YAML in full.

const SKILLS_DIR = fileURLToPath(new URL("../skills", import.meta.url));

function frontmatter(path) {
  const text = readFileSync(path, "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, `${path} must start with a --- frontmatter block`);
  return match[1].split("\n");
}

/** Top-level `key: value` lines; block scalars (`>` / `|`) report their indicator as the value. */
function topLevelFields(lines) {
  const fields = new Map();
  for (const line of lines) {
    const match = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (match) fields.set(match[1], match[2]);
  }
  return fields;
}

const skills = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

test("every skill folder has a SKILL.md", () => {
  assert.ok(skills.length > 0);
  for (const name of skills) {
    assert.doesNotThrow(() => readFileSync(join(SKILLS_DIR, name, "SKILL.md")));
  }
});

for (const name of skills) {
  test(`${name}: frontmatter has a matching name and a YAML-safe description`, () => {
    const fields = topLevelFields(frontmatter(join(SKILLS_DIR, name, "SKILL.md")));
    assert.equal(fields.get("name"), name, "name must match the folder");

    const description = fields.get("description");
    assert.ok(description, "description is required");
    const isBlockScalar = /^[>|][+-]?$/.test(description);
    const isQuoted = /^(["']).*\1$/.test(description);
    if (!isBlockScalar && !isQuoted) {
      // A plain scalar cannot contain ": " or " #": YAML reads those as a nested
      // mapping or a comment, and the whole frontmatter fails to parse.
      assert.ok(
        !/: | #/.test(description),
        'plain description contains ": " or " #"; quote it or use "description: >-"',
      );
    }
  });
}
