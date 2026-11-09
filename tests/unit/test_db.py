from __future__ import annotations

import sqlite3

import pytest

from acc.db.migrate import KNOWN_SOURCES, SCHEMA_VERSION, migrate
from acc.db.writes import (
    WriteRejected,
    claude_request_key,
    fallback_key,
    insert_ignore,
    insert_many_ignore,
)


def _req(key: str, **over: object) -> dict[str, object]:
    row: dict[str, object] = {
        "dedupe_key": key,
        "provider": "claude",
        "session_pk": "claude:s1",
        "ts": 1_762_534_805_000,
        "model": "claude-opus-5-5",
        "input_tokens": 120,
        "output_tokens": 340,
        "cache_read_tokens": 15000,
        "cost_micros": None,
        "cost_kind": None,
        "quality": "observed",
        "source_id": "claude.otlp",
    }
    row.update(over)
    return row


def test_wal_and_sources(db: sqlite3.Connection) -> None:
    assert db.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    ids = {r[0] for r in db.execute("SELECT id FROM sources")}
    assert ids == {s[0] for s in KNOWN_SOURCES}


def test_migrate_idempotent(db: sqlite3.Connection) -> None:
    assert migrate(db) == SCHEMA_VERSION
    assert db.execute("SELECT COUNT(*) FROM schema_version").fetchone()[0] == 1


def test_replay_is_noop(db: sqlite3.Connection) -> None:
    key = claude_request_key("req_001")
    assert insert_ignore(db, "api_requests", _req(key)) is True
    assert insert_ignore(db, "api_requests", _req(key)) is False
    # The same request arriving later from the JSONL import must not double count.
    assert (
        insert_ignore(
            db, "api_requests", _req(key, quality="imported", source_id="claude.jsonl_import")
        )
        is False
    )
    assert db.execute("SELECT COUNT(*) FROM api_requests").fetchone()[0] == 1


def test_batch_counts_only_new(db: sqlite3.Connection) -> None:
    rows = [_req(claude_request_key(f"r{i}")) for i in range(5)]
    assert insert_many_ignore(db, "api_requests", rows) == 5
    assert insert_many_ignore(db, "api_requests", rows + [_req("claude:req:new")]) == 1


def test_forbidden_columns_rejected(db: sqlite3.Connection) -> None:
    with pytest.raises(WriteRejected):
        insert_ignore(db, "api_requests", _req("k", prompt="CANARY"))
    with pytest.raises(WriteRejected):
        insert_ignore(db, "api_requests", _req("k", not_a_column=1))
    with pytest.raises(WriteRejected):
        insert_ignore(db, "pricing", {"provider": "claude"})


def test_invalid_quality_rejected(db: sqlite3.Connection) -> None:
    with pytest.raises(WriteRejected):
        insert_ignore(db, "api_requests", _req("k", quality="unavailable"))


def test_cost_requires_kind(db: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        insert_ignore(db, "api_requests", _req("k", cost_micros=1000, cost_kind=None))


def test_unknown_cost_stays_null(db: sqlite3.Connection) -> None:
    insert_ignore(db, "api_requests", _req("k"))
    assert db.execute("SELECT cost_micros FROM api_requests").fetchone()[0] is None


def test_limit_snapshot_dedupes(db: sqlite3.Connection) -> None:
    snap = {
        "provider": "claude",
        "limit_window": "five_hour",
        "used_pct": 23.5,
        "resets_at": 1_762_560_000_000,
        "observed_at": 1,
        "source_id": "claude.statusline",
    }
    assert insert_ignore(db, "limit_snapshots", snap) is True
    assert insert_ignore(db, "limit_snapshots", {**snap, "observed_at": 2}) is False
    assert insert_ignore(db, "limit_snapshots", {**snap, "used_pct": 24.0}) is True


def test_fallback_key_stable() -> None:
    a = fallback_key("grok", "s", "tool_result", 5, {"b": 2, "a": 1})
    b = fallback_key("grok", "s", "tool_result", 5, {"a": 1, "b": 2})
    assert a == b and a.startswith("grok:h:")
    assert a != fallback_key("grok", "s", "tool_result", 6, {"a": 1, "b": 2})
