# agent-skills

My own agent skills, plus a manifest that points at skills from other repos.
One command installs, updates and removes all of them for Claude Code and Codex.

Other people's skills are **not copied** here. The manifest names their repo, and
the [`skills` CLI](https://github.com/vercel-labs/skills) installs and updates
them straight from that repo.

## Use it

```bash
npx --allow-git=root github:ralibardi/agent-skills
```

npm 12 refuses to fetch packages from git by default (`EALLOWGIT`).
`--allow-git=root` lifts that for this one command only; this package has no
dependencies, so nothing else is fetched from git.

Options:

| Option | What it does |
|---|---|
| `--dry-run` | Print the `skills` commands without running them |
| `--no-update` | Install and remove only; skip updating installed skills |
| `--manifest <path>` | Use another manifest (handy while editing) |

From a local checkout: `npm run sync` or `npm run sync:dry`.

My skills on their own also install with the plain CLI:

```bash
npx skills add ralibardi/agent-skills -g
```

## What's here

```text
skills/                  my skills, one folder per skill (SKILL.md + files)
skills.manifest.json     which skills to install, and from which repos
bin/sync.mjs             the command above
lib/plan.mjs             decides what to install, update and remove
test/                    tests for lib/plan.mjs (npm test)
```

## The manifest

```json
{
  "agents": ["claude-code", "codex"],
  "sources": [
    { "repo": "ralibardi/agent-skills", "skills": "*" },
    { "repo": "mattpocock/skills", "skills": ["grill-me", "tdd"] }
  ]
}
```

- `agents`: the `skills` CLI agent names to install into
  ([list](https://github.com/vercel-labs/skills/blob/main/docs/agents.md)).
- `repo`: anything `npx skills add` accepts; `owner/repo` for GitHub.
- `skills`: `"*"` for every skill in the repo, or a list of skill names. To see
  what a repo offers, run `npx skills add <repo> --list`.
- A skill name can only appear once across all sources, because the CLI's lock
  file is keyed by name.

To add a vendor, add a source. To drop a skill, delete it from its list.

## How a sync works

1. **Remove** skills this tool installed before that are no longer in the
   manifest (see [Removal policy](#removal-policy)).
2. **Install** listed skills that are missing, or that are currently installed
   from a different repo. Sources marked `"*"` are re-added every time, which
   also picks up new skills from that repo.
3. **Update** listed skills that are already installed from the right repo.

The CLI records each installed skill's source repo in
`~/.agents/.skill-lock.json`, which is how updates come from the original
vendor. This tool also saves the names it manages in
`~/.agents/.agent-skills-state.json`, so it never touches skills you installed
by hand.

## Removal policy

A sync only removes skills that this tool installed or adopted on an earlier
run and that the manifest no longer lists, either by name or through a `"*"`
source. It keeps:

- skills you installed by hand, even from a repo in the manifest;
- skills that have since been reinstalled from a different repo;
- skills from a listed repo that were never listed.

Removal takes the skill out of every agent, not only the ones in `agents`.

## Adding one of my own skills

1. Create `skills/<name>/SKILL.md` with `name` and `description` frontmatter
   (`npx skills init skills/<name>` scaffolds one).
2. Commit and push. The next sync installs it, since this repo is listed as `"*"`.
