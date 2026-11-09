from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest

from acc.db.conn import connect
from acc.db.migrate import migrate

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


@pytest.fixture
def db(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    conn = connect(tmp_path / "acc.db")
    migrate(conn)
    yield conn
    conn.close()


@pytest.fixture
def fixtures_dir() -> Path:
    return FIXTURES
