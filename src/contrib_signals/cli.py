from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

from .collector import collect_repositories
from .db import connect
from .github import GitHubClient, GitHubError
from .snapshot import write_snapshot


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="contrib-signals",
        description="Collect and query auditable GitHub contribution signals.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    collect = subparsers.add_parser("collect", help="Collect public evidence from GitHub")
    collect.add_argument("--repo", action="append", required=True, help="owner/repository (repeatable)")
    collect.add_argument("--db", default="data/contrib-signals.sqlite")

    report = subparsers.add_parser("report", help="Print ranked contribution opportunities")
    report.add_argument("--db", default="data/contrib-signals.sqlite")
    report.add_argument("--limit", type=int, default=20)

    export = subparsers.add_parser("export", help="Export ranked opportunities as CSV")
    export.add_argument("--db", default="data/contrib-signals.sqlite")
    export.add_argument("--out", default="data/opportunities.csv")

    snapshot = subparsers.add_parser("snapshot", help="Write a reproducible static dashboard snapshot")
    snapshot.add_argument("--db", default="data/contrib-signals.sqlite")
    snapshot.add_argument("--out", default="web/data/snapshot.json")
    snapshot.add_argument("--csv", default="web/data/opportunities.csv")
    return parser


def _rows(connection, limit: int | None = None):
    sql = """
        SELECT
            o.repository, o.number, o.title, o.readiness_score,
            r.contribution_score, r.language, o.days_since_update,
            o.maintainer_opened, o.assignee_count, o.html_url
        FROM opportunity_scores o
        JOIN repository_scores r ON r.full_name = o.repository
        ORDER BY r.contribution_score DESC, o.readiness_score DESC, o.repository, o.number
    """
    parameters: tuple[int, ...] = ()
    if limit is not None:
        sql += " LIMIT ?"
        parameters = (limit,)
    return connection.execute(sql, parameters).fetchall()


def _print_report(connection, limit: int) -> None:
    rows = _rows(connection, limit)
    if not rows:
        print("No labeled opportunities collected.")
        return
    print(f"{'REPO':34} {'ISSUE':>7} {'REPO':>5} {'READY':>5} {'AGE':>5}  TITLE")
    for row in rows:
        title = row["title"].replace("\n", " ")
        if len(title) > 58:
            title = f"{title[:55]}..."
        print(
            f"{row['repository'][:34]:34} #{row['number']:<6} "
            f"{row['contribution_score']:>5} {row['readiness_score']:>5} "
            f"{row['days_since_update']:>4}d  {title}"
        )


def _export(connection, output: str) -> None:
    rows = _rows(connection)
    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = list(rows[0].keys()) if rows else [
        "repository", "number", "title", "readiness_score", "contribution_score",
        "language", "days_since_update", "maintainer_opened", "assignee_count", "html_url",
    ]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(dict(row) for row in rows)
    print(f"Exported {len(rows)} opportunities to {path}")


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        connection = connect(args.db)
        if args.command == "collect":
            run_id = collect_repositories(connection, GitHubClient(), args.repo)
            print(f"Collection run {run_id} completed for {len(args.repo)} repositories.")
        elif args.command == "report":
            _print_report(connection, args.limit)
        elif args.command == "export":
            _export(connection, args.out)
        elif args.command == "snapshot":
            snapshot = write_snapshot(connection, args.out, args.csv)
            print(
                f"Exported {len(snapshot['repositories'])} repositories and "
                f"{len(snapshot['opportunities'])} opportunities to {args.out}"
            )
        return 0
    except (GitHubError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
