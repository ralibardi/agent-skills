#!/usr/bin/env python3
"""Extract repo contribution evidence for CV and portfolio use.

The script is intentionally stdlib-only. It gathers factual Git evidence,
merges provider-export JSON when available, and renders deterministic Markdown
and portfolio JSON outputs for agent review.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "contribution-miner.evidence.v1"
PORTFOLIO_SCHEMA_VERSION = "contribution-miner.portfolio.v1"

TECH_BY_EXT = {
    ".cs": "C#",
    ".css": "CSS",
    ".dockerfile": "Docker",
    ".fs": "F#",
    ".go": "Go",
    ".html": "HTML",
    ".java": "Java",
    ".js": "JavaScript",
    ".jsx": "React",
    ".json": "JSON",
    ".kt": "Kotlin",
    ".md": "Documentation",
    ".ps1": "PowerShell",
    ".py": "Python",
    ".rb": "Ruby",
    ".rs": "Rust",
    ".scss": "Sass",
    ".sh": "Shell",
    ".sql": "SQL",
    ".swift": "Swift",
    ".tf": "Terraform",
    ".ts": "TypeScript",
    ".tsx": "React",
    ".yaml": "YAML",
    ".yml": "YAML",
}

TAG_RULES = [
    ("accessibility", re.compile(r"\b(a11y|accessibility|aria|screen reader)\b", re.I)),
    ("api", re.compile(r"\b(api|endpoint|controller|route|graphql|rest)\b", re.I)),
    ("auth", re.compile(r"\b(auth|oauth|login|token|permission|role)\b", re.I)),
    ("ci-cd", re.compile(r"\b(ci|pipeline|workflow|deploy|release|build)\b", re.I)),
    ("database", re.compile(r"\b(db|database|migration|sql|postgres|schema)\b", re.I)),
    ("documentation", re.compile(r"\b(doc|readme|markdown|guidance)\b", re.I)),
    ("frontend", re.compile(r"\b(ui|ux|react|component|css|page|view)\b", re.I)),
    ("infrastructure", re.compile(r"\b(docker|terraform|kubernetes|helm|infra)\b", re.I)),
    ("performance", re.compile(r"\b(perf|performance|cache|latency|optimis|optimiz)\b", re.I)),
    ("refactor", re.compile(r"\b(refactor|cleanup|rename|simplif)\b", re.I)),
    ("security", re.compile(r"\b(security|vulnerab|encrypt|secret|sanitize|sanitise)\b", re.I)),
    ("testing", re.compile(r"\b(test|spec|fixture|mock|coverage)\b", re.I)),
]


def run(args: list[str], cwd: Path, allow_fail: bool = False) -> str:
    result = subprocess.run(
        args,
        cwd=cwd,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0 and allow_fail:
        return ""
    if result.returncode != 0:
        raise SystemExit(f"Command failed: {' '.join(args)}\n{result.stderr.strip()}")
    return result.stdout


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, sort_keys=True)
        handle.write("\n")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def parse_month(value: str) -> date:
    if not re.fullmatch(r"\d{4}-\d{2}", value):
        raise SystemExit(f"Invalid month '{value}'. Expected YYYY-MM.")
    year, month = map(int, value.split("-"))
    return date(year, month, 1)


def add_months(value: date, months: int) -> date:
    month_index = value.year * 12 + value.month - 1 + months
    year = month_index // 12
    month = month_index % 12 + 1
    return date(year, month, 1)


def month_keys(start_month: str, end_month: str) -> list[str]:
    start = parse_month(start_month)
    end = parse_month(end_month)
    if start > end:
        raise SystemExit("--start-month must be before or equal to --end-month")
    keys = []
    current = end
    while current >= start:
        keys.append(current.strftime("%Y-%m"))
        current = add_months(current, -1)
    return keys


def next_month(month_key: str) -> str:
    return add_months(parse_month(month_key), 1).strftime("%Y-%m-%dT00:00:00")


def month_start(month_key: str) -> str:
    return f"{month_key}-01T00:00:00"


def load_identities(path: Path) -> dict[str, list[str]]:
    identities = load_json(path)
    normalized = {
        "git_author_names": sorted({str(v).strip() for v in identities.get("git_author_names", []) if str(v).strip()}),
        "git_author_emails": sorted({str(v).strip().lower() for v in identities.get("git_author_emails", []) if str(v).strip()}),
        "github_usernames": sorted({str(v).strip().lower().lstrip("@") for v in identities.get("github_usernames", []) if str(v).strip()}),
        "azure_devops_identities": sorted({str(v).strip().lower() for v in identities.get("azure_devops_identities", []) if str(v).strip()}),
    }
    if not normalized["git_author_names"] and not normalized["git_author_emails"]:
        raise SystemExit("identity file must include at least one Git author name or email")
    return normalized


def repo_metadata(repo: Path) -> dict[str, Any]:
    root = Path(run(["git", "rev-parse", "--show-toplevel"], repo).strip())
    remote = run(["git", "config", "--get", "remote.origin.url"], root, allow_fail=True).strip()
    branch = run(["git", "branch", "--show-current"], root, allow_fail=True).strip()
    return {
        "path": str(root),
        "name": root.name,
        "remote": remote,
        "provider": detect_provider(remote),
        "default_branch": branch or None,
    }


def detect_provider(remote: str) -> str:
    lowered = remote.lower()
    if "github.com" in lowered:
        return "github"
    if "dev.azure.com" in lowered or ".visualstudio.com" in lowered or "azure.com" in lowered:
        return "azure-devops"
    if remote:
        return "unknown"
    return "local"


def commit_matches_identity(commit: dict[str, Any], identities: dict[str, list[str]]) -> bool:
    author_name = str(commit.get("author_name", "")).strip().lower()
    author_email = str(commit.get("author_email", "")).strip().lower()
    names = {name.lower() for name in identities["git_author_names"]}
    emails = set(identities["git_author_emails"])
    return bool((author_name and author_name in names) or (author_email and author_email in emails))


def technologies_for_files(files: list[dict[str, Any]]) -> list[str]:
    technologies = set()
    for item in files:
        path = str(item.get("path", ""))
        name = Path(path).name.lower()
        suffix = Path(path).suffix.lower()
        if name == "dockerfile":
            technologies.add("Docker")
        if suffix in TECH_BY_EXT:
            technologies.add(TECH_BY_EXT[suffix])
    return sorted(technologies)


def tags_for(subject: str, files: list[dict[str, Any]]) -> list[str]:
    haystack = " ".join([subject] + [str(item.get("path", "")) for item in files])
    tags = {label for label, regex in TAG_RULES if regex.search(haystack)}
    return sorted(tags)


def sanitize_text(text: str) -> str:
    sanitized = re.sub(r"\b[A-Z][A-Z0-9]+-\d+\b", "[ticket]", text)
    sanitized = re.sub(r"\b(PR|AB|BUG|TASK)[ -]?\d+\b", r"\1 [id]", sanitized, flags=re.I)
    sanitized = re.sub(r"\s+", " ", sanitized).strip()
    return sanitized


def stable_id(*parts: str) -> str:
    digest = hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()
    return digest[:12]


def parse_git_log(output: str, identities: dict[str, list[str]]) -> list[dict[str, Any]]:
    commits = []
    for block in output.split("\x1e"):
        block = block.strip()
        if not block:
            continue
        lines = block.splitlines()
        header = lines[0].split("\x1f")
        if len(header) != 5:
            continue
        commit = {
            "hash": header[0],
            "short_hash": header[0][:12],
            "author_name": header[1],
            "author_email": header[2],
            "authored_at": header[3],
            "subject_raw": header[4],
            "subject_public": sanitize_text(header[4]),
            "files": [],
        }
        for line in lines[1:]:
            parts = line.split("\t")
            if len(parts) != 3:
                continue
            added, deleted, path = parts
            commit["files"].append(
                {
                    "path": path,
                    "insertions": None if added == "-" else int(added),
                    "deletions": None if deleted == "-" else int(deleted),
                }
            )
        if not commit_matches_identity(commit, identities):
            continue
        commit["month"] = commit["authored_at"][:7]
        commit["technologies"] = technologies_for_files(commit["files"])
        commit["tags"] = tags_for(commit["subject_raw"], commit["files"])
        commit["evidence_id"] = f"commit-{commit['short_hash']}"
        commits.append(commit)
    return commits


def summarize_month(month: dict[str, Any]) -> dict[str, Any]:
    commits = month["commits"]
    prs = month["pull_requests"]
    files = {file["path"] for commit in commits for file in commit["files"]}
    insertions = sum(
        file["insertions"] or 0
        for commit in commits
        for file in commit["files"]
        if file["insertions"] is not None
    )
    deletions = sum(
        file["deletions"] or 0
        for commit in commits
        for file in commit["files"]
        if file["deletions"] is not None
    )
    techs = Counter(tech for commit in commits for tech in commit["technologies"])
    tags = Counter(tag for commit in commits for tag in commit["tags"])
    for pr in prs:
        techs.update(pr.get("technologies", []))
        tags.update(pr.get("tags", []))
    return {
        "commit_count": len(commits),
        "merged_pr_count": len(prs),
        "files_changed_count": len(files),
        "insertions": insertions,
        "deletions": deletions,
        "top_technologies": [name for name, _ in techs.most_common()],
        "light_tags": [name for name, _ in tags.most_common()],
    }


def git_scan(args: argparse.Namespace) -> None:
    repo = Path(args.repo).resolve()
    identities = load_identities(Path(args.identity_file))
    metadata = repo_metadata(repo)
    keys = month_keys(args.start_month, args.end_month)
    start = month_start(args.start_month)
    before = next_month(args.end_month)
    root = Path(metadata["path"])
    log_output = run(
        [
            "git",
            "log",
            "--all",
            f"--since={start}",
            f"--before={before}",
            "--date=iso-strict",
            "--numstat",
            "--format=%x1e%H%x1f%an%x1f%ae%x1f%aI%x1f%s",
        ],
        root,
    )
    commits = parse_git_log(log_output, identities)
    months = {
        key: {
            "month": key,
            "is_partial": key == date.today().strftime("%Y-%m"),
            "commits": [],
            "pull_requests": [],
            "summary": {},
        }
        for key in keys
    }
    for commit in commits:
        if commit["month"] in months:
            months[commit["month"]]["commits"].append(commit)
    for month in months.values():
        month["commits"].sort(key=lambda item: item["authored_at"], reverse=True)
        month["summary"] = summarize_month(month)
    evidence = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": now_iso(),
        "repo": metadata,
        "date_range": {
            "start_month": args.start_month,
            "end_month": args.end_month,
            "includes_partial_current_month": args.end_month == date.today().strftime("%Y-%m"),
        },
        "identities": identities,
        "months": [months[key] for key in keys],
    }
    write_json(Path(args.out), evidence)


def normalise_provider_records(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("pull_requests", "prs", "values", "items"):
            if isinstance(data.get(key), list):
                return data[key]
    raise SystemExit("provider JSON must be an array or contain pull_requests/prs/values/items")


def provider_author_matches(record: dict[str, Any], identities: dict[str, list[str]]) -> bool:
    author = record.get("author") or record.get("createdBy") or record.get("created_by") or {}
    candidates = []
    if isinstance(author, dict):
        candidates.extend(
            str(author.get(key, "")).lower().lstrip("@")
            for key in ("login", "name", "displayName", "uniqueName", "emailAddress")
        )
    elif author:
        candidates.append(str(author).lower().lstrip("@"))
    known = set(identities.get("github_usernames", [])) | set(identities.get("azure_devops_identities", []))
    return not known or any(candidate in known for candidate in candidates if candidate)


def provider_record_is_merged(record: dict[str, Any]) -> bool:
    state = str(record.get("state") or record.get("status") or "").lower()
    if state:
        return state in {"merged", "completed"}
    return bool(record.get("mergedAt") or record.get("merged_at"))


def provider_month(record: dict[str, Any]) -> str | None:
    value = (
        record.get("mergedAt")
        or record.get("merged_at")
    )
    if not value and provider_record_is_merged(record):
        value = record.get("closedDate") or record.get("closed_date") or record.get("completionDate")
    if not value:
        return None
    return str(value)[:7]


def provider_pr_id(record: dict[str, Any], repo_name: str) -> str:
    number = record.get("number") or record.get("pullRequestId") or record.get("id")
    if number:
        return f"pr-{number}"
    return f"pr-{stable_id(repo_name, str(record.get('title', '')), str(record.get('url', '')))}"


def normalise_provider_pr(record: dict[str, Any], repo_name: str) -> dict[str, Any]:
    title = str(record.get("title") or record.get("name") or "Untitled PR")
    url = record.get("url") or record.get("webUrl") or record.get("_links", {}).get("web", {}).get("href")
    labels = record.get("labels") or []
    if labels and isinstance(labels[0], dict):
        labels = [label.get("name", "") for label in labels]
    files = record.get("files") if isinstance(record.get("files"), list) else []
    changed_files = record.get("changedFiles") or record.get("changed_files") or len(files) or None
    additions = record.get("additions") or record.get("insertions")
    deletions = record.get("deletions")
    work_items = record.get("workItems") or record.get("work_items") or record.get("linkedWorkItems") or []
    pr = {
        "evidence_id": provider_pr_id(record, repo_name),
        "number": record.get("number") or record.get("pullRequestId") or record.get("id"),
        "title_raw": title,
        "title_public": sanitize_text(title),
        "url": url,
        "merged_at": record.get("mergedAt") or record.get("merged_at") or record.get("closedDate") or record.get("closed_date"),
        "month": provider_month(record),
        "state": record.get("state") or record.get("status") or "merged",
        "labels": sorted({str(label) for label in labels if str(label)}),
        "changed_files": changed_files,
        "additions": additions,
        "deletions": deletions,
        "work_items": work_items,
        "technologies": technologies_for_files([{"path": path} if isinstance(path, str) else path for path in files]),
        "tags": tags_for(title, [{"path": path} if isinstance(path, str) else path for path in files]),
    }
    return pr


def merge_provider(args: argparse.Namespace) -> None:
    evidence = load_json(Path(args.git))
    provider = load_json(Path(args.provider))
    records = normalise_provider_records(provider)
    months = {month["month"]: month for month in evidence["months"]}
    for record in records:
        if not isinstance(record, dict):
            continue
        if not provider_record_is_merged(record):
            continue
        if not provider_author_matches(record, evidence.get("identities", {})):
            continue
        month_key = provider_month(record)
        if month_key not in months:
            continue
        pr = normalise_provider_pr(record, evidence["repo"]["name"])
        months[month_key]["pull_requests"].append(pr)
    for month in evidence["months"]:
        month["pull_requests"].sort(key=lambda item: str(item.get("merged_at", "")), reverse=True)
        month["summary"] = summarize_month(month)
    evidence["generated_at"] = now_iso()
    evidence["provider_enriched"] = True
    write_json(Path(args.out), evidence)


def aggregate(evidence: dict[str, Any]) -> dict[str, Any]:
    techs = Counter()
    tags = Counter()
    total_commits = 0
    total_prs = 0
    files = set()
    insertions = 0
    deletions = 0
    for month in evidence["months"]:
        total_commits += len(month["commits"])
        total_prs += len(month["pull_requests"])
        for commit in month["commits"]:
            techs.update(commit.get("technologies", []))
            tags.update(commit.get("tags", []))
            for file in commit.get("files", []):
                files.add(file["path"])
                insertions += file.get("insertions") or 0
                deletions += file.get("deletions") or 0
        for pr in month["pull_requests"]:
            techs.update(pr.get("technologies", []))
            tags.update(pr.get("tags", []))
    return {
        "total_commits": total_commits,
        "total_merged_prs": total_prs,
        "total_files_changed": len(files),
        "total_insertions": insertions,
        "total_deletions": deletions,
        "technologies": [name for name, _ in techs.most_common()],
        "patterns": [name for name, _ in tags.most_common()],
    }


def markdown_list(items: list[str], empty: str = "None identified from repository evidence.") -> str:
    if not items:
        return f"- {empty}"
    return "\n".join(f"- {item}" for item in items)


def render_markdown(evidence: dict[str, Any]) -> str:
    stats = aggregate(evidence)
    repo = evidence["repo"]
    lines = [
        "# Contribution Miner Handoff",
        "",
        "## Instructions For The CV Agent",
        "",
        "- Use this as evidence, not as final CV prose.",
        "- Do not invent metrics, business outcomes, project names, or technologies.",
        "- Preserve the difference between exact repository metrics and inferred impact.",
        "- Keep public-facing text sanitised unless the user explicitly restores private names.",
        "- Prefer concise UK professional wording.",
        "",
        "## Repository",
        "",
        f"- Name: `{repo['name']}`",
        f"- Provider: `{repo['provider']}`",
        f"- Remote: `{repo.get('remote') or 'none'}`",
        f"- Date range: `{evidence['date_range']['start_month']}` to `{evidence['date_range']['end_month']}`",
        f"- Includes partial current month: `{evidence['date_range']['includes_partial_current_month']}`",
        "",
        "## Executive Contribution Summary",
        "",
        f"- Authored commits found: {stats['total_commits']}",
        f"- Merged authored PRs found: {stats['total_merged_prs']}",
        f"- Files changed by matching commits: {stats['total_files_changed']}",
        f"- Exact code churn from matching commits: +{stats['total_insertions']} / -{stats['total_deletions']}",
        "",
        "## Skills And Technologies",
        "",
        markdown_list(stats["technologies"]),
        "",
        "## Architecture And Delivery Patterns",
        "",
        markdown_list(stats["patterns"]),
        "",
        "## Monthly Timeline",
        "",
    ]
    for month in evidence["months"]:
        label = f"{month['month']} (partial)" if month["is_partial"] else month["month"]
        summary = month["summary"]
        lines.extend(
            [
                f"### {label}",
                "",
                f"- Commits: {summary['commit_count']}",
                f"- Merged authored PRs: {summary['merged_pr_count']}",
                f"- Files changed: {summary['files_changed_count']}",
                f"- Technologies: {', '.join(summary['top_technologies']) or 'None identified'}",
                f"- Patterns: {', '.join(summary['light_tags']) or 'None identified'}",
                "",
            ]
        )
        if month["pull_requests"]:
            lines.append("Merged authored PRs:")
            for pr in month["pull_requests"]:
                ref = f" [link]({pr['url']})" if pr.get("url") else ""
                lines.append(f"- {pr['title_public']}{ref}")
            lines.append("")
        if month["commits"]:
            lines.append("Representative commits:")
            for commit in month["commits"][:12]:
                lines.append(f"- `{commit['short_hash']}` {commit['subject_public']}")
            if len(month["commits"]) > 12:
                lines.append(f"- ... {len(month['commits']) - 12} additional matching commits")
            lines.append("")
    lines.extend(
        [
            "## Projects And Features Delivered",
            "",
            "- Use the monthly PRs and commit clusters above to group work into features. Keep each project tied to commit hashes or PR links.",
            "",
            "## Impact Evidence",
            "",
            "- Exact: repository metrics above are directly measured from matching commits and merged authored PRs.",
            "- Inferred: use low/medium/high confidence labels and explain the evidence before turning impact into CV language.",
            "",
            "## CV-Ready Bullet Starters",
            "",
            "- Delivered repository improvements across identified technologies and patterns; tailor this only after grouping related PRs/commits into real features.",
            "- Improved maintainability, delivery quality, or user-facing functionality where supported by commit/PR evidence; add only verified metrics.",
            "",
            "## LinkedIn-Ready Bullet Starters",
            "",
            "- Built and maintained features in this repository using the technologies and delivery patterns listed above.",
            "- Contributed measurable code changes and merged PRs across the analysed period, with evidence available in the appendix.",
            "",
            "## Evidence Appendix",
            "",
        ]
    )
    for month in evidence["months"]:
        if not month["commits"] and not month["pull_requests"]:
            continue
        lines.append(f"### {month['month']}")
        for pr in month["pull_requests"]:
            lines.append(f"- PR `{pr['evidence_id']}`: {pr['title_raw']} ({pr.get('url') or 'no url'})")
        for commit in month["commits"]:
            lines.append(f"- Commit `{commit['hash']}`: {commit['subject_raw']}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def render(args: argparse.Namespace) -> None:
    evidence = load_json(Path(args.evidence))
    write_text(Path(args.out), render_markdown(evidence))


def portfolio(args: argparse.Namespace) -> None:
    evidence = load_json(Path(args.evidence))
    stats = aggregate(evidence)
    repo = evidence["repo"]
    contributions = []
    evidence_links = []
    for month in evidence["months"]:
        for pr in month["pull_requests"]:
            contribution_id = f"{repo['name']}-{pr['evidence_id']}"
            contributions.append(
                {
                    "id": contribution_id,
                    "source_type": "pull_request",
                    "month": month["month"],
                    "title_public": pr["title_public"],
                    "title_raw": pr["title_raw"],
                    "url": pr.get("url"),
                    "technologies": pr.get("technologies", []),
                    "patterns": pr.get("tags", []),
                    "impact": [
                        {
                            "type": "delivery",
                            "metric": "merged authored pull request",
                            "value": 1,
                            "confidence": "high",
                            "evidence": pr["evidence_id"],
                        }
                    ],
                }
            )
            evidence_links.append({"id": pr["evidence_id"], "type": "pull_request", "url": pr.get("url")})
        for commit in month["commits"]:
            contribution_id = f"{repo['name']}-{commit['evidence_id']}"
            contributions.append(
                {
                    "id": contribution_id,
                    "source_type": "commit",
                    "month": month["month"],
                    "title_public": commit["subject_public"],
                    "title_raw": commit["subject_raw"],
                    "commit": commit["hash"],
                    "technologies": commit.get("technologies", []),
                    "patterns": commit.get("tags", []),
                    "files_changed": len(commit.get("files", [])),
                    "impact": [
                        {
                            "type": "code_change",
                            "metric": "files changed",
                            "value": len(commit.get("files", [])),
                            "confidence": "high",
                            "evidence": commit["evidence_id"],
                        }
                    ],
                }
            )
            evidence_links.append({"id": commit["evidence_id"], "type": "commit", "commit": commit["hash"]})
    dataset = {
        "schema_version": PORTFOLIO_SCHEMA_VERSION,
        "generated_at": now_iso(),
        "source": {
            "repo_name": repo["name"],
            "provider": repo["provider"],
            "remote": repo.get("remote"),
            "date_range": evidence["date_range"],
        },
        "projects": [
            {
                "id": stable_id(repo["name"], evidence["date_range"]["start_month"], evidence["date_range"]["end_month"]),
                "name_public": repo["name"],
                "summary_public": f"Repository contribution evidence for {repo['name']}.",
                "summary_raw": f"Authored contribution evidence mined from {repo.get('remote') or repo['path']}.",
                "technologies": stats["technologies"],
                "patterns": stats["patterns"],
                "contribution_count": len(contributions),
            }
        ],
        "contributions": contributions,
        "technologies": stats["technologies"],
        "patterns": stats["patterns"],
        "impact_entries": [
            {
                "id": stable_id(repo["name"], "aggregate", "commits"),
                "metric": "authored commits",
                "value": stats["total_commits"],
                "confidence": "high",
                "source": "local git",
            },
            {
                "id": stable_id(repo["name"], "aggregate", "merged-prs"),
                "metric": "merged authored pull requests",
                "value": stats["total_merged_prs"],
                "confidence": "high" if evidence.get("provider_enriched") else "low",
                "source": "provider export" if evidence.get("provider_enriched") else "not provider-enriched",
            },
        ],
        "evidence_links": evidence_links,
    }
    write_json(Path(args.out), dataset)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Mine repository contribution evidence.")
    sub = parser.add_subparsers(dest="command", required=True)

    scan = sub.add_parser("git-scan", help="Extract local Git evidence.")
    scan.add_argument("--repo", required=True)
    scan.add_argument("--start-month", required=True)
    scan.add_argument("--end-month", default=date.today().strftime("%Y-%m"))
    scan.add_argument("--identity-file", required=True)
    scan.add_argument("--out", required=True)
    scan.set_defaults(func=git_scan)

    merge = sub.add_parser("merge-provider", help="Merge provider PR export JSON.")
    merge.add_argument("--git", required=True)
    merge.add_argument("--provider", required=True)
    merge.add_argument("--out", required=True)
    merge.set_defaults(func=merge_provider)

    render_cmd = sub.add_parser("render", help="Render Markdown CV-agent handoff.")
    render_cmd.add_argument("--evidence", required=True)
    render_cmd.add_argument("--out", required=True)
    render_cmd.set_defaults(func=render)

    portfolio_cmd = sub.add_parser("portfolio", help="Render stable portfolio JSON.")
    portfolio_cmd.add_argument("--evidence", required=True)
    portfolio_cmd.add_argument("--out", required=True)
    portfolio_cmd.set_defaults(func=portfolio)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
