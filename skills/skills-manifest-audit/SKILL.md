---
name: skills-manifest-audit
description: Audits the agent skills installed by the `skills` CLI against skills.manifest.json in ralibardi/agent-skills and reports drift: skills installed by hand from sources the manifest does not name, skills missing or installed from the wrong source, stale sync state, and project-level skill copies that shadow a global install. Use when the user asks to audit, check or reconcile their skills, asks why a skill is installed, or before editing the manifest.
disable-model-invocation: true
---

# Skills Manifest Audit

## Goal

Tell the user exactly where the installed skills have drifted from the manifest, and give them the manifest edits or `skills remove` commands that close the gap. Change nothing without being asked: the audit is read-only, and the fix is always the user's decision.

## Run the audit

From a checkout of `ralibardi/agent-skills`:

```bash
npm run audit -- --project <repo-path>
```

Without a checkout:

```bash
npx --allow-git=root -p github:ralibardi/agent-skills agent-skills-audit --project <repo-path>
```

Pass `--project` once per repository the user is working in (the current directory at least). It makes the audit look inside that repo's `.claude/skills` and `.agents/skills` for copies of globally installed skills.

Exit codes: 0 in sync, 1 drift found, 2 the audit could not run (no lock file, bad manifest, missing folder). Treat 1 as a normal result, not a failure.

## Read the report

The report has up to six sections. Explain each one that appears in the user's own terms:

| Section | Meaning | Usual fix |
|---|---|---|
| Not in the manifest | Installed with `npx skills add` directly, so the sync neither updates nor removes them. | Add the source to the manifest, or `skills remove` the skills. |
| Installed from a listed source but not named there | The source is in the manifest with an explicit list, and these names are not on it. | Add the names to the list, or remove the skills. |
| Listed but not installed | The manifest wants them; the sync has not run since, or failed. | Run the sync. |
| Installed from a different source | Same skill name, another repo. The sync will reinstall from the listed source. | Run the sync, or change the manifest if the other source is the one wanted. |
| Tracked by sync state but no longer installed | Bookkeeping only. | None; the next sync forgets them. |
| Project skills that shadow a global install | A copy inside a repo wins there and will drift from the global one. | Delete the project copy unless it was changed on purpose. Compare the two first. |

## Propose manifest changes

When the user wants to adopt unlisted skills into the manifest, print the proposal and offer it as a diff of `skills.manifest.json`:

```bash
npm run audit -- --propose
```

The proposal appends one source per unlisted repo or folder with the skill names spelled out. Do not switch an adopted source to `"*"` without asking: a wildcard also pulls in every skill that source publishes later.

Before handing over a proposal, check it with the user for sources that should instead be removed. Many hand-installed skills are experiments; the manifest should list the ones they want to keep.

## Guardrails

- Never run `skills remove`, edit the manifest or run the sync as part of the audit. Show the commands and let the user run them, or run them only when they explicitly ask.
- A skill name can appear under only one source. If the proposal would collide with an existing entry, the manifest validation in the sync will say so; fix the collision by choosing one source.
- Folder sources (such as Xcode's skills) are machine specific. Report them as such and do not propose removing them because another machine lacks the folder.
