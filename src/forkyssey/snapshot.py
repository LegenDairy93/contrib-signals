from __future__ import annotations

import csv
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def build_snapshot(connection: sqlite3.Connection) -> dict[str, Any]:
    repositories = connection.execute(
        """
        SELECT *
        FROM repository_scores
        ORDER BY contribution_score DESC, full_name
        """
    ).fetchall()
    opportunities = connection.execute(
        """
        SELECT *
        FROM opportunity_scores
        ORDER BY readiness_score DESC, repository, number
        """
    ).fetchall()

    collected = [row["collected_at"] for row in repositories]
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "evidenceWindow": {
            "oldestCollectedAt": min(collected) if collected else None,
            "newestCollectedAt": max(collected) if collected else None,
        },
        "methodology": {
            "repositoryScoreRange": [-100, 100],
            "opportunityScoreRange": [0, 100],
            "readyIssueThreshold": 70,
            "ageAnchor": "repository collected_at",
            "disclaimer": "A high score is evidence to investigate, not maintainer consent.",
        },
        "repositories": [_repository(row) for row in repositories],
        "opportunities": [_opportunity(row) for row in opportunities],
    }


def write_snapshot(
    connection: sqlite3.Connection,
    output: str | Path,
    csv_output: str | Path | None = None,
) -> dict[str, Any]:
    snapshot = build_snapshot(connection)
    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")

    if csv_output is not None:
        csv_path = Path(csv_output)
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        fields = [
            "repository", "number", "title", "readiness_score", "contribution_score",
            "language", "days_since_update", "maintainer_opened", "assignee_count", "html_url",
        ]
        repo_scores = {row["fullName"]: row["score"] for row in snapshot["repositories"]}
        repo_languages = {row["fullName"]: row["language"] for row in snapshot["repositories"]}
        with csv_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            for row in snapshot["opportunities"]:
                writer.writerow({
                    "repository": row["repository"],
                    "number": row["number"],
                    "title": row["title"],
                    "readiness_score": row["score"],
                    "contribution_score": repo_scores.get(row["repository"], 0),
                    "language": repo_languages.get(row["repository"]),
                    "days_since_update": row["daysSinceUpdate"],
                    "maintainer_opened": int(row["maintainerOpened"]),
                    "assignee_count": row["assigneeCount"],
                    "html_url": row["htmlUrl"],
                })
    return snapshot


def _repository(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "fullName": row["full_name"],
        "htmlUrl": row["html_url"],
        "description": row["description"],
        "language": row["language"],
        "stars": row["stars"],
        "forks": row["forks"],
        "openIssuesCount": row["open_issues_count"],
        "archived": bool(row["archived"]),
        "pushedAt": row["pushed_at"],
        "license": row["license_spdx"],
        "collectedAt": row["collected_at"],
        "score": row["contribution_score"],
        "scoreBreakdown": {
            "activity": row["activity_score"],
            "externalMerge": row["external_merge_score"],
            "documentation": row["documentation_score"],
            "opportunities": row["opportunity_score"],
            "archivePenalty": row["archive_score"],
        },
        "signals": {
            "daysSincePush": row["days_since_push"],
            "externalPrsSampled": row["external_prs_sampled"],
            "externalPrsMerged": row["external_prs_merged"],
            "externalMergeRate": row["external_merge_rate"],
            "hasContributing": bool(row["has_contributing"]),
            "hasCodeOfConduct": bool(row["has_code_of_conduct"]),
            "labeledIssues": row["labeled_issues"],
            "readyIssues": row["ready_issues"],
            "bestIssueScore": row["best_issue_score"],
        },
    }


def _opportunity(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "repository": row["repository"],
        "number": row["number"],
        "title": row["title"],
        "htmlUrl": row["html_url"],
        "labels": [label.strip() for label in row["labels"].split(",") if label.strip()],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "daysSinceUpdate": row["days_since_update"],
        "comments": row["comments"],
        "assigneeCount": row["assignee_count"],
        "authorAssociation": row["author_association"],
        "maintainerOpened": bool(row["maintainer_opened"]),
        "score": row["readiness_score"],
        "scoreBreakdown": {
            "label": row["label_score"],
            "unassigned": row["assignment_score"],
            "maintainerOpened": row["maintainer_score"],
            "freshness": row["freshness_score"],
            "discussion": row["discussion_score"],
        },
    }
