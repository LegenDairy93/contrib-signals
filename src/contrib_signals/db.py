from __future__ import annotations

import sqlite3
from pathlib import Path


def schema_path() -> Path:
    return Path(__file__).resolve().parents[2] / "sql" / "schema.sql"


def connect(path: str | Path) -> sqlite3.Connection:
    db_path = Path(path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.executescript(schema_path().read_text(encoding="utf-8"))
    return connection
