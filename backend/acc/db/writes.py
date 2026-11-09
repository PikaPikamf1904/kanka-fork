"""The single write path for fact rows. Every collector uses insert_ignore().

Guarantees: replaying the same event is a no-op (dedupe_key / natural UNIQUE),
only whitelisted tables and columns can be written, and forbidden content keys
are rejected before SQL is built.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from collections.abc import Mapping, Sequence
from typing import Any

FACT_TABLES: frozenset[str] = frozenset(
    {
        "sessions",
        "api_requests",
        "turns",
        "errors",
        "tool_events",
        "subagent_events",
        "metric_points",
        "limit_snapshots",
        "limit_events",
        "git_commits",
        "test_runs",
    }
)

# Column names that must never reach the database, whatever table.
FORBIDDEN_COLUMNS: frozenset[str] = frozenset(
    {
        "prompt",
        "content",
        "message",
        "response",
        "body",
        "text",
        "email",
        "user_email",
        "tool_input",
        "tool_output",
        "command",
        "full_command",
        "file_path",
        "cwd",
        "api_key",
        "token",
        "password",
    }
)

VALID_QUALITY: frozenset[str] = frozenset({"observed", "estimated", "imported"})


class WriteRejected(ValueError):
    pass


def _columns(conn: sqlite3.Connection, table: str) -> frozenset[str]:
    return frozenset(r[1] for r in conn.execute(f"PRAGMA table_info({table})"))


def insert_ignore(conn: sqlite3.Connection, table: str, row: Mapping[str, Any]) -> bool:
    """Insert one row; return True if inserted, False if it was a duplicate."""
    return insert_many_ignore(conn, table, [row]) == 1


def insert_many_ignore(
    conn: sqlite3.Connection, table: str, rows: Sequence[Mapping[str, Any]]
) -> int:
    """Insert rows sharing the same keys; return how many were new."""
    if not rows:
        return 0
    if table not in FACT_TABLES:
        raise WriteRejected(f"table not writable via insert_ignore: {table}")
    keys = list(rows[0].keys())
    allowed = _columns(conn, table)
    bad = [k for k in keys if k in FORBIDDEN_COLUMNS or k not in allowed]
    if bad:
        raise WriteRejected(f"rejected columns for {table}: {sorted(bad)}")
    for r in rows:
        if list(r.keys()) != keys:
            raise WriteRejected("all rows in a batch must have identical keys")
        q = r.get("quality")
        if q is not None and q not in VALID_QUALITY:
            raise WriteRejected(f"invalid quality: {q!r}")
    cols = ", ".join(keys)
    marks = ", ".join("?" for _ in keys)
    sql = f"INSERT INTO {table} ({cols}) VALUES ({marks}) ON CONFLICT DO NOTHING"
    before = conn.total_changes
    conn.execute("BEGIN")
    try:
        conn.executemany(sql, [tuple(r[k] for k in keys) for r in rows])
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    return conn.total_changes - before


def fallback_key(
    provider: str, session: str | None, name: str, ts_ms: int, attrs: Mapping[str, Any]
) -> str:
    """Deterministic dedupe key for events lacking a natural id."""
    payload = json.dumps(
        [provider, session or "", name, ts_ms, sorted((str(k), str(v)) for k, v in attrs.items())],
        separators=(",", ":"),
    )
    return f"{provider}:h:{hashlib.sha256(payload.encode()).hexdigest()}"


# Canonical natural keys (documented in docs/schema.md). Collectors must use these.
def claude_request_key(request_id: str) -> str:
    return f"claude:req:{request_id}"


def grok_request_key(session_id: str, prompt_id: str, sequence: int | str) -> str:
    return f"grok:req:{session_id}:{prompt_id}:{sequence}"


def grok_turn_key(session_id: str, turn_no: int) -> str:
    return f"grok:turn:{session_id}:{turn_no}"
