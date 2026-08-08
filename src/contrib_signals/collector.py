from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Any, Iterable

from . import __version__
from .github import GitHubClient

MAINTAINER_ASSOCIATIONS = {"OWNER", "MEMBER", "COLLABORATOR"}
BEGINNER_LABELS = {"good first issue", "help wanted", "first-timers-only", "beginner"}


def _labels(issue: dict[str, Any]) -> list[str]:
    return [str(label.get("name", "")).strip() for label in issue.get("labels", [])]


def collect_repositories(
    connection: sqlite3.Connection,
    client: GitHubClient,
    repositories: Iterable[str],
) -> int:
    names = list(dict.fromkeys(repository.strip() for repository in repositories if repository.strip()))
    if not names:
        raise ValueError("At least one owner/repository value is required")

    collected_at = datetime.now(timezone.utc).isoformat()
    cursor = connection.execute(
        "INSERT INTO collection_runs(collected_at, collector_version, repository_count) VALUES (?, ?, ?)",
        (collected_at, __version__, len(names)),
    )
    run_id = int(cursor.lastrowid)

    for repository in names:
        metadata = client.get(f"/repos/{repository}")
        pull_requests = client.get(
            f"/repos/{repository}/pulls", {"state": "closed", "per_page": 10, "sort": "updated"}
        )
        external_prs = [
            pr for pr in pull_requests if pr.get("author_association") not in MAINTAINER_ASSOCIATIONS
        ]
        external_merged = sum(1 for pr in external_prs if pr.get("merged_at"))

        connection.execute("DELETE FROM repositories WHERE full_name = ?", (repository,))
        connection.execute(
            """
            INSERT INTO repositories(
                full_name, run_id, html_url, description, language, stars, forks,
                open_issues_count, archived, pushed_at, license_spdx, has_contributing,
                has_code_of_conduct, external_prs_sampled, external_prs_merged, collected_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                repository,
                run_id,
                metadata["html_url"],
                metadata.get("description"),
                metadata.get("language"),
                int(metadata.get("stargazers_count", 0)),
                int(metadata.get("forks_count", 0)),
                int(metadata.get("open_issues_count", 0)),
                int(bool(metadata.get("archived"))),
                metadata.get("pushed_at"),
                (metadata.get("license") or {}).get("spdx_id"),
                int(client.exists(repository, "CONTRIBUTING.md")),
                int(client.exists(repository, "CODE_OF_CONDUCT.md")),
                len(external_prs),
                external_merged,
                collected_at,
            ),
        )

        open_items = client.get(
            f"/repos/{repository}/issues", {"state": "open", "per_page": 10, "sort": "updated"}
        )
        for issue in open_items:
            if "pull_request" in issue:
                continue
            labels = _labels(issue)
            normalized = {label.casefold() for label in labels}
            if not normalized.intersection(BEGINNER_LABELS):
                continue
            association = str(issue.get("author_association") or "NONE")
            connection.execute(
                """
                INSERT OR REPLACE INTO issues(
                    repository, number, title, html_url, labels, created_at, updated_at,
                    comments, assignee_count, author_association, maintainer_opened,
                    beginner_labeled
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                """,
                (
                    repository,
                    int(issue["number"]),
                    issue["title"],
                    issue["html_url"],
                    ", ".join(labels),
                    issue["created_at"],
                    issue["updated_at"],
                    int(issue.get("comments", 0)),
                    len(issue.get("assignees") or []),
                    association,
                    int(association in MAINTAINER_ASSOCIATIONS),
                ),
            )
        connection.commit()
    return run_id
