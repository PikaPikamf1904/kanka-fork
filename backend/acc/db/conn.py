"""SQLite connection factory: WAL, busy timeout, foreign keys."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path


def default_data_dir() -> Path:
    base = os.environ.get("ACC_DATA_DIR")
    if base:
        return Path(base)
    local = os.environ.get("LOCALAPPDATA")
    if local:
        return Path(local) / "AICommandCenter"
    return Path.home() / ".local" / "share" / "ai-command-center"


def default_db_path() -> Path:
    return default_data_dir() / "acc.db"


def connect(path: Path | str | None = None) -> sqlite3.Connection:
    """Open a connection. ':memory:' is allowed for tests (WAL is skipped there)."""
    target = str(path) if path is not None else str(default_db_path())
    if target != ":memory:":
        Path(target).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(target, timeout=5.0, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA foreign_keys = ON")
    if target != ":memory:":
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
    return conn
