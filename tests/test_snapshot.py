from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from contrib_signals.db import connect
from contrib_signals.snapshot import build_snapshot, write_snapshot


class SnapshotTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.connection = connect(self.root / "signals.sqlite")
        run_id = self.connection.execute(
            "INSERT INTO collection_runs(collected_at, collector_version, repository_count) VALUES (?, 'test', 1)",
            ("2026-01-31T00:00:00+00:00",),
        ).lastrowid
        self.connection.execute(
            """
            INSERT INTO repositories VALUES (
                'example/project', ?, 'https://github.com/example/project', 'A useful project', 'Python',
                250, 20, 8, 0, '2026-01-28T00:00:00+00:00', 'MIT', 1, 1, 10, 7,
                '2026-01-31T00:00:00+00:00'
            )
            """,
            (run_id,),
        )
        self.connection.execute(
            """
            INSERT INTO issues VALUES (
                'example/project', 42, 'Fix the parser edge case',
                'https://github.com/example/project/issues/42', 'good first issue, parser',
                '2026-01-01T00:00:00+00:00', '2026-01-29T00:00:00+00:00',
                4, 0, 'MEMBER', 1, 1
            )
            """
        )
        self.connection.commit()

    def tearDown(self) -> None:
        self.connection.close()
        self.temp.cleanup()

    def test_snapshot_exposes_auditable_score_components(self) -> None:
        snapshot = build_snapshot(self.connection)
        repository = snapshot["repositories"][0]
        opportunity = snapshot["opportunities"][0]

        self.assertEqual(snapshot["schemaVersion"], 1)
        self.assertEqual(snapshot["methodology"]["ageAnchor"], "repository collected_at")
        self.assertEqual(repository["score"], sum(repository["scoreBreakdown"].values()))
        self.assertEqual(opportunity["score"], sum(opportunity["scoreBreakdown"].values()))
        self.assertEqual(repository["signals"]["daysSincePush"], 3)
        self.assertEqual(opportunity["daysSinceUpdate"], 2)

    def test_writes_browser_json_and_downloadable_csv(self) -> None:
        json_path = self.root / "web" / "data" / "snapshot.json"
        csv_path = self.root / "web" / "data" / "opportunities.csv"

        write_snapshot(self.connection, json_path, csv_path)

        saved = json.loads(json_path.read_text(encoding="utf-8"))
        self.assertEqual(saved["repositories"][0]["fullName"], "example/project")
        csv_text = csv_path.read_text(encoding="utf-8")
        self.assertIn("readiness_score", csv_text)
        self.assertIn("Fix the parser edge case", csv_text)


if __name__ == "__main__":
    unittest.main()
