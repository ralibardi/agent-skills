---
name: merge-main-verify
description: Use when updating the current Git branch from main or master and verifying the result through local lint, build, unit, accessibility, telemetry e2e, and e2e quality gates.
---

# Merge Main Verify

## Goal

Merge the latest remote `main` or `master` into the current branch, resolve integration conflicts semantically, fix merge-related verification failures, and leave the result ready for human review. Do not create commits automatically.

## Git Preflight

1. Inspect context:
   - `git branch --show-current`
   - `git status --short`
   - `git remote -v`
2. If the worktree has local changes, preserve them with a clearly named stash before merging:
   - `git stash push -u -m "merge-main-verify pre-merge stash"`
   - Record that a stash was created so it can be restored later.
3. Run `git fetch --prune`.
4. Choose the base ref:
   - Prefer `origin/main` if it exists.
   - Fall back to `origin/master` if `origin/main` does not exist.
   - If neither exists, ask the user which base ref to merge.
5. Merge without committing when possible:
   - `git merge --no-ff --no-commit <base-ref>`
   - If Git requires a different mode for the repo state, explain why before proceeding.

## Conflict Resolution

- Resolve conflicts by reading both sides and preserving the intended behavior from the feature branch and the base branch where possible.
- Never blindly choose `ours`, `theirs`, or the larger/smaller diff.
- Use nearby tests, types, schemas, API contracts, and docs as the source of truth.
- Ask the user only when the product or domain intent is ambiguous after inspection.
- After resolving conflicts, inspect the combined diff before running verification.

## Command Discovery

Use a Node-first discovery path:

1. Inspect `package.json` scripts, lockfiles, repo docs, test configs, and tool configs.
2. Prefer project scripts over ad hoc commands.
3. Identify commands for:
   - lint
   - build
   - unit tests
   - accessibility checks
   - telemetry e2e, headed browser, feature flags off
   - telemetry e2e, headed browser, feature flags on
   - regular e2e, headed browser, feature flags off
   - regular e2e, headed browser, feature flags on
4. For headed browser mode, use documented Playwright, Cypress, or equivalent flags/scripts that open a browser window.
5. Discover feature flag on/off mechanics from scripts, env examples, test config, docs, or local flag tooling. If the mechanism is not explicit, stop and ask.
6. Discover telemetry e2e through dedicated scripts, Playwright projects, Cypress specs, tags, grep patterns, or docs. If multiple plausible commands exist, stop and ask.
7. Discover accessibility checks through scripts or tooling such as `a11y`, `accessibility`, axe, Pa11y, Lighthouse, or accessibility-specific e2e projects/tags.

## Setup Boundaries

- Use installed dependencies and documented setup commands.
- Ask before installing packages, browser binaries, or new tooling.
- Start app servers or background services only through repo-documented scripts or test-runner `webServer` configuration.
- Stop any service started during the workflow.

## Verification Ladder

Run checks in this order:

1. lint
2. build
3. unit tests
4. accessibility checks
5. telemetry e2e headed with feature flags off
6. telemetry e2e headed with feature flags on
7. e2e headed with feature flags off
8. e2e headed with feature flags on

Failure handling:

- Fix failures that are plausibly caused by the merge or conflict resolution.
- Report likely pre-existing unrelated failures separately instead of expanding scope silently.
- After fixing a lint failure, rerun lint.
- After fixing a build failure, rerun lint, then build.
- After fixing a unit test failure, rerun lint, build, then unit tests.
- After fixing accessibility, telemetry e2e, or e2e failures, rerun lint, build, unit tests, then rerun the failed phase before continuing.
- If the final feature-flags-on e2e phase fails and is fixed, rerun lint, build, unit tests, the feature-flags-off e2e gate, then the feature-flags-on e2e gate.

## Stash Restore

If a pre-merge stash was created:

1. Restore it after the merge result and verification fixes are stable.
2. Resolve any stash-restore conflicts semantically, using the same conflict policy.
3. Rerun the relevant verification ladder after restoring the stash.
4. Report whether the stash was applied and whether any stash entry remains.

## Final Report

End with a concise report that includes:

- Current branch and merged base ref.
- Whether a stash was created, restored, or left in place.
- Conflicts resolved and the intent preserved.
- Merge-related fixes made.
- Commands discovered and run, with pass/fail status.
- Any likely pre-existing failures or blocked checks.
- Final `git status --short`.
- Confirmation that no commits were created automatically.
