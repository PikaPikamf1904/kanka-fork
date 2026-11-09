"""Apply schema.sql and register the known sources. Idempotent."""

from __future__ import annotations

import sqlite3
import time
from importlib import resources

SCHEMA_VERSION = 1

# Every collector writes under one of these ids. Adding a source = contract change.
KNOWN_SOURCES: tuple[tuple[str, str, str], ...] = (
    ("claude.otlp", "claude", "otlp"),
    ("claude.statusline", "claude", "statusline"),
    ("claude.hooks", "claude", "hook"),
    ("claude.jsonl_import", "claude", "import"),
    ("grok.otlp", "grok", "otlp"),
    ("grok.usage_poller", "grok", "poller"),
    ("grok.hooks", "grok", "hook"),
    ("grok.sessions_import", "grok", "import"),
    ("local.git", "local", "git"),
    ("local.tests", "local", "tests"),
)


def migrate(conn: sqlite3.Connection) -> int:
    current = _current_version(conn)
    if current >= SCHEMA_VERSION:
        return current
    sql = resources.files("acc.db").joinpath("schema.sql").read_text(encoding="utf-8")
    conn.executescript(sql)
    conn.executemany(
        "INSERT OR IGNORE INTO sources(id, provider, kind) VALUES (?, ?, ?)", KNOWN_SOURCES
    )
    conn.execute(
        "INSERT OR IGNORE INTO schema_version(version, applied_at) VALUES (?, ?)",
        (SCHEMA_VERSION, int(time.time() * 1000)),
    )
    return SCHEMA_VERSION


def _current_version(conn: sqlite3.Connection) -> int:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
    ).fetchone()
    if row is None:
        return 0
    v = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
    return int(v or 0)
