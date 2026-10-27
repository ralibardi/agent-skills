import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "contribution_miner.py"
spec = importlib.util.spec_from_file_location("contribution_miner", SCRIPT)
contribution_miner = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(contribution_miner)


def run(args, cwd, env=None):
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    result = subprocess.run(
        args,
        cwd=cwd,
        env=merged_env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        raise AssertionError(f"command failed: {' '.join(args)}\n{result.stderr}")
    return result.stdout


class ContributionMinerTests(unittest.TestCase):
    def make_repo(self, root: Path) -> Path:
        repo = root / "repo"
        repo.mkdir()
        run(["git", "init"], repo)
        run(["git", "config", "user.name", "Ronny Alibardi"], repo)
        run(["git", "config", "user.email", "ronny@example.com"], repo)
        run(["git", "remote", "add", "origin", "git@github.com:example/product.git"], repo)
        return repo

    def commit_file(self, repo: Path, path: str, content: str, message: str, author_name: str, author_email: str, when: str):
        target = repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        run(["git", "add", path], repo)
        env = {
            "GIT_AUTHOR_NAME": author_name,
            "GIT_AUTHOR_EMAIL": author_email,
            "GIT_AUTHOR_DATE": when,
            "GIT_COMMITTER_NAME": author_name,
            "GIT_COMMITTER_EMAIL": author_email,
            "GIT_COMMITTER_DATE": when,
        }
        run(["git", "commit", "-m", message], repo, env=env)

    def test_git_scan_filters_identity_and_groups_by_month(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo = self.make_repo(root)
            self.commit_file(repo, "src/app.ts", "one", "Add API route", "Ronny Alibardi", "ronny@example.com", "2026-05-02T12:00:00+0000")
            self.commit_file(repo, "README.md", "docs", "Update docs", "Other Person", "other@example.com", "2026-05-03T12:00:00+0000")
            self.commit_file(repo, "tests/app.test.ts", "test", "Add tests", "Ronny Alibardi", "ronny@example.com", "2026-04-10T12:00:00+0000")
            identities = root / "identities.json"
            identities.write_text(
                json.dumps(
                    {
                        "git_author_names": ["Ronny Alibardi"],
                        "git_author_emails": ["ronny@example.com"],
                        "github_usernames": ["ronnyalibardi"],
                    }
                ),
                encoding="utf-8",
            )
            out = root / "evidence.json"
            contribution_miner.main(
                [
                    "git-scan",
                    "--repo",
                    str(repo),
                    "--start-month",
                    "2026-04",
                    "--end-month",
                    "2026-05",
                    "--identity-file",
                    str(identities),
                    "--out",
                    str(out),
                ]
            )
            evidence = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual([month["month"] for month in evidence["months"]], ["2026-05", "2026-04"])
            self.assertEqual(evidence["repo"]["provider"], "github")
            self.assertEqual(evidence["months"][0]["summary"]["commit_count"], 1)
            self.assertEqual(evidence["months"][1]["summary"]["commit_count"], 1)
            self.assertIn("TypeScript", evidence["months"][0]["summary"]["top_technologies"])
            self.assertTrue(evidence["months"][0]["is_partial"])

    def test_merge_provider_keeps_only_merged_authored_prs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            evidence_path = root / "evidence.json"
            provider_path = root / "provider.json"
            merged_path = root / "merged.json"
            evidence_path.write_text(
                json.dumps(
                    {
                        "schema_version": "contribution-miner.evidence.v1",
                        "generated_at": "2026-05-11T00:00:00+00:00",
                        "repo": {"name": "product", "provider": "github"},
                        "date_range": {"start_month": "2026-05", "end_month": "2026-05"},
                        "identities": {"github_usernames": ["ronnyalibardi"], "azure_devops_identities": []},
                        "months": [
                            {"month": "2026-05", "is_partial": True, "commits": [], "pull_requests": [], "summary": {}}
                        ],
                    }
                ),
                encoding="utf-8",
            )
            provider_path.write_text(
                json.dumps(
                    [
                        {
                            "number": 12,
                            "title": "Add portfolio exporter",
                            "state": "MERGED",
                            "mergedAt": "2026-05-04T12:00:00Z",
                            "author": {"login": "ronnyalibardi"},
                            "url": "https://github.com/example/product/pull/12",
                            "files": ["scripts/export.py"],
                        },
                        {
                            "number": 13,
                            "title": "Closed experiment",
                            "state": "CLOSED",
                            "closedDate": "2026-05-04T12:00:00Z",
                            "author": {"login": "ronnyalibardi"},
                        },
                        {
                            "number": 14,
                            "title": "Someone else",
                            "state": "MERGED",
                            "mergedAt": "2026-05-05T12:00:00Z",
                            "author": {"login": "other"},
                        },
                    ]
                ),
                encoding="utf-8",
            )
            contribution_miner.main(
                ["merge-provider", "--git", str(evidence_path), "--provider", str(provider_path), "--out", str(merged_path)]
            )
            evidence = json.loads(merged_path.read_text(encoding="utf-8"))
            prs = evidence["months"][0]["pull_requests"]
            self.assertEqual(len(prs), 1)
            self.assertEqual(prs[0]["number"], 12)
            self.assertEqual(evidence["months"][0]["summary"]["merged_pr_count"], 1)

    def test_portfolio_output_has_stable_public_and_raw_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            evidence_path = root / "evidence.json"
            portfolio_path = root / "portfolio.json"
            evidence_path.write_text(
                json.dumps(
                    {
                        "schema_version": "contribution-miner.evidence.v1",
                        "generated_at": "2026-05-11T00:00:00+00:00",
                        "repo": {"name": "product", "provider": "github", "remote": "git@github.com:example/product.git"},
                        "date_range": {"start_month": "2026-05", "end_month": "2026-05"},
                        "months": [
                            {
                                "month": "2026-05",
                                "is_partial": True,
                                "commits": [
                                    {
                                        "hash": "abcdef1234567890",
                                        "evidence_id": "commit-abcdef123456",
                                        "subject_raw": "Add ABC-123 private feature",
                                        "subject_public": "Add [ticket] private feature",
                                        "technologies": ["Python"],
                                        "tags": ["api"],
                                        "files": [{"path": "api.py", "insertions": 5, "deletions": 1}],
                                    }
                                ],
                                "pull_requests": [],
                                "summary": {},
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            contribution_miner.main(["portfolio", "--evidence", str(evidence_path), "--out", str(portfolio_path)])
            data = json.loads(portfolio_path.read_text(encoding="utf-8"))
            self.assertEqual(data["schema_version"], "contribution-miner.portfolio.v1")
            self.assertEqual(data["contributions"][0]["title_public"], "Add [ticket] private feature")
            self.assertEqual(data["contributions"][0]["title_raw"], "Add ABC-123 private feature")
            self.assertEqual(data["impact_entries"][0]["confidence"], "high")


if __name__ == "__main__":
    unittest.main()
