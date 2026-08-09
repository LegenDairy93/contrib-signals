from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from contrib_signals.db import connect, schema_text


class PackageDataTests(unittest.TestCase):
    def test_packaged_schema_matches_public_sql(self) -> None:
        public_schema = (
            Path(__file__).resolve().parents[1] / "sql" / "schema.sql"
        ).read_text(encoding="utf-8")
        self.assertEqual(schema_text(), public_schema)

    def test_connection_uses_packaged_schema(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            connection = connect(Path(directory) / "signals.sqlite")
            try:
                view = connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'view' AND name = 'opportunity_scores'"
                ).fetchone()
                self.assertIsNotNone(view)
            finally:
                connection.close()


if __name__ == "__main__":
    unittest.main()
