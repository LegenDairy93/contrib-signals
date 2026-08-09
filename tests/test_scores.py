from __future__ import annotations

import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from forkyssey.db import connect


class ScoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.connection = connect(Path(self.temp.name) / "signals.sqlite")
        now = datetime.now(timezone.utc)
        run = self.connection.execute(
            "INSERT INTO collection_runs(collected_at, collector_version, repository_count) VALUES (?, 'test', 1)",
            (now.isoformat(),),
        ).lastrowid
        self.connection.execute(
            """
            INSERT INTO repositories VALUES (
                'example/healthy', ?, 'https://github.com/example/healthy', 'demo', 'Python',
                500, 40, 12, 0, ?, 'MIT', 1, 1, 10, 7, ?
            )
            """,
            (run, (now - timedelta(days=3)).isoformat(), now.isoformat()),
        )
        self.connection.execute(
            """
            INSERT INTO issues VALUES (
                'example/healthy', 42, 'Fix a reproducible parser edge case',
                'https://github.com/example/healthy/issues/42', 'good first issue, parser',
                ?, ?, 4, 0, 'MEMBER', 1, 1
            )
            """,
            ((now - timedelta(days=20)).isoformat(), (now - timedelta(days=2)).isoformat()),
        )
        self.connection.commit()

    def tearDown(self) -> None:
        self.connection.close()
        self.temp.cleanup()

    def test_ready_issue_scores_highly(self) -> None:
        row = self.connection.execute("SELECT * FROM opportunity_scores").fetchone()
        self.assertGreaterEqual(row["readiness_score"], 90)

    def test_healthy_repository_scores_highly(self) -> None:
        row = self.connection.execute("SELECT * FROM repository_scores").fetchone()
        self.assertGreaterEqual(row["contribution_score"], 80)
        self.assertEqual(row["ready_issues"], 1)

    def test_merge_rate_is_auditable(self) -> None:
        row = self.connection.execute("SELECT * FROM repository_scores").fetchone()
        self.assertAlmostEqual(row["external_merge_rate"], 0.7)


if __name__ == "__main__":
    unittest.main()
