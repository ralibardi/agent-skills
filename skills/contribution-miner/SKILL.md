---
name: contribution-miner
description: Use when analysing a Git repository for a user's authored commits, merged PRs, skills, technologies, project work, architecture patterns, impact evidence, CV bullets, LinkedIn wording, or portfolio-app data.
---

# Contribution Miner

## Overview

Mine one repository at a time for evidence-backed career material. Produce a Markdown handoff for a CV-writing agent and a stable JSON dataset for a portfolio app.

## Required Inputs

Before analysis, confirm:
- Repository path, normally the current working directory.
- Earliest month to include, in `YYYY-MM`.
- Identity aliases: Git author names/emails, GitHub usernames, and Azure DevOps identities.
- Whether any specific names must be sanitized in public-facing output.

Use current partial month first, then walk backward month by month until the earliest month. Always mark the current month as partial.

## Workflow

1. Detect the repo and provider from `origin`. Treat the repo as GitHub, Azure DevOps, or local/unknown; do not merge mirrored providers unless the user explicitly says so.
2. Create an identity file:

```json
{
  "git_author_names": ["Ronny Alibardi"],
  "git_author_emails": ["ronny@example.com"],
  "github_usernames": ["ronnyalibardi"],
  "azure_devops_identities": ["Ronny Alibardi"]
}
```

3. Run the local Git scan:

```bash
python3 scripts/contribution_miner.py git-scan \
  --repo . \
  --start-month 2024-01 \
  --end-month 2026-05 \
  --identity-file identities.json \
  --out contribution-evidence.json
```

4. If provider tools are available, enrich merged authored PRs. Prefer MCP tools; otherwise use `gh` for GitHub or `az repos pr` / Azure DevOps API output. Save the provider export as JSON and merge it:

```bash
python3 scripts/contribution_miner.py merge-provider \
  --git contribution-evidence.json \
  --provider provider-prs.json \
  --out contribution-evidence.enriched.json
```

5. Render both outputs:

```bash
python3 scripts/contribution_miner.py render \
  --evidence contribution-evidence.enriched.json \
  --out contribution-handoff.md

python3 scripts/contribution_miner.py portfolio \
  --evidence contribution-evidence.enriched.json \
  --out portfolio-contributions.json
```

## Output Rules

- Include authored commits and merged authored PRs only.
- Exclude PR reviews, approvals, comments, and unmerged PRs from contribution scoring.
- Keep raw/private evidence traceable in JSON; sanitize CV, LinkedIn, and portfolio display text by default.
- Use exact metrics when present. For inferred improvements, include `confidence` and explain the evidence.
- Capture linked ticket/work-item IDs and titles when provider data exposes them, but do not require deep ticket-system access.
- Do not invent metrics, business outcomes, project names, or technology usage.

## Markdown Handoff Requirements

Write for another agent that will rewrite the CV. Include:
- Downstream-agent instructions.
- Executive contribution summary.
- Monthly timeline.
- Projects/features delivered.
- Skills and technologies.
- Architecture and delivery patterns.
- Impact estimates, clearly separated into exact and inferred.
- CV-ready bullets and LinkedIn-ready bullets.
- Evidence appendix with commit hashes, PR links, and ticket/work-item references.

Use concise UK professional wording.

## Portfolio JSON Requirements

The portfolio JSON is the app-ingestion source of truth. It must include stable IDs, repo metadata, date range, public summaries, contribution records, technologies, patterns, impact entries, evidence links, and confidence labels. Keep raw/private fields separate from public display fields.

## Common Mistakes

- Counting every commit in the repo instead of confirmed identity aliases.
- Treating closed/unmerged PRs as delivered work.
- Letting a prose Markdown report become the only portfolio source.
- Overstating impact when only code-level evidence exists.
- Forgetting that the current month is partial.
