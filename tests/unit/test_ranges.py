from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from acc.query.ranges import (
    RangeError,
    bucket_edges,
    comparable,
    delta_pct,
    previous_period,
    resolve,
)

# 2026-11-08 10:30 Phoenix == 17:30 UTC
NOW = datetime(2026, 11, 8, 17, 30, tzinfo=UTC)


def test_today_starts_at_phoenix_midnight() -> None:
    r = resolve("today", now=NOW)
    assert r.start == datetime(2026, 11, 8, 7, 0, tzinfo=UTC)
    assert r.end == NOW


def test_today_just_after_utc_midnight_is_still_previous_phoenix_day() -> None:
    now = datetime(2026, 11, 9, 3, 0, tzinfo=UTC)  # 20:00 Phoenix on Nov 8
    r = resolve("today", now=now)
    assert r.start == datetime(2026, 11, 8, 7, 0, tzinfo=UTC)


def test_today_compares_to_same_clock_window_yesterday() -> None:
    p = previous_period(resolve("today", now=NOW))
    # yesterday 00:00-10:30 Phoenix
    assert p.start == datetime(2026, 11, 7, 7, 0, tzinfo=UTC)
    assert p.end == datetime(2026, 11, 7, 17, 30, tzinfo=UTC)
    assert p.span == timedelta(hours=10, minutes=30)


def test_today_comparison_handles_dst_zones() -> None:
    # Day after US DST ends: 'today' 00:00-09:00 in New York is 9 h; yesterday's
    # same clock window is also 9 h even though the calendar day was 25 h long.
    now = datetime(2026, 11, 2, 14, 0, tzinfo=UTC)  # 09:00 EST
    r = resolve("today", now=now, tz_name="America/New_York")
    p = previous_period(r)
    assert p.start == datetime(2026, 11, 1, 4, 0, tzinfo=UTC)  # 00:00 EDT
    assert p.end == datetime(2026, 11, 1, 14, 0, tzinfo=UTC)  # 09:00 EST


@pytest.mark.parametrize(
    ("preset", "span"),
    [
        ("last_hour", timedelta(hours=1)),
        ("prev_24h", timedelta(hours=24)),
        ("prev_7d", timedelta(days=7)),
        ("prev_30d", timedelta(days=30)),
    ],
)
def test_rolling_presets(preset: str, span: timedelta) -> None:
    r = resolve(preset, now=NOW)
    assert r.end == NOW and r.span == span
    p = previous_period(r)
    assert p.end == r.start and p.span == span


def test_custom_dates_are_inclusive_local_days() -> None:
    r = resolve("custom_dates", now=NOW, start="2026-11-01", end="2026-11-03")
    assert r.start == datetime(2026, 11, 1, 7, 0, tzinfo=UTC)
    assert r.end == datetime(2026, 11, 4, 7, 0, tzinfo=UTC)
    assert r.span == timedelta(days=3)


def test_custom_naive_timestamp_is_phoenix() -> None:
    r = resolve("custom", now=NOW, start="2026-11-08T08:00", end="2026-11-08T09:00")
    assert r.start == datetime(2026, 11, 8, 15, 0, tzinfo=UTC)


def test_custom_with_offset_respected() -> None:
    r = resolve("custom", now=NOW, start="2026-11-08T08:00Z", end="2026-11-08T09:00Z")
    assert r.start == datetime(2026, 11, 8, 8, 0, tzinfo=UTC)


def test_future_end_clamped() -> None:
    r = resolve("custom_dates", now=NOW, start="2026-11-08", end="2026-11-10")
    assert r.end == NOW


@pytest.mark.parametrize(
    ("start", "end"),
    [("2026-11-08T09:00", "2026-11-08T08:00"), ("garbage", "2026-11-08T08:00")],
)
def test_invalid_custom(start: str, end: str) -> None:
    with pytest.raises(RangeError):
        resolve("custom", now=NOW, start=start, end=end)


def test_span_limit() -> None:
    with pytest.raises(RangeError):
        resolve("custom_dates", now=NOW, start="2024-01-01", end="2026-01-01")


def test_naive_now_rejected() -> None:
    with pytest.raises(RangeError):
        resolve("today", now=datetime(2026, 11, 8))


@pytest.mark.parametrize(
    ("preset", "seconds"),
    [("last_hour", 300), ("prev_24h", 3600), ("prev_7d", 86400), ("prev_30d", 86400)],
)
def test_bucket_sizes(preset: str, seconds: int) -> None:
    assert resolve(preset, now=NOW).bucket.total_seconds() == seconds


def test_daily_buckets_align_to_phoenix_midnight() -> None:
    edges = bucket_edges(resolve("prev_7d", now=NOW))
    assert all(e.hour == 7 and e.minute == 0 for e in edges)
    assert edges[0] <= resolve("prev_7d", now=NOW).start


def test_five_minute_buckets_cover_range() -> None:
    r = resolve("last_hour", now=NOW)
    edges = bucket_edges(r)
    assert len(edges) == 12 and edges[0] == r.start


def test_delta_pct() -> None:
    assert delta_pct(150, 100) == 50.0
    assert delta_pct(5, 0) is None
    assert delta_pct(None, 10) is None


def test_coverage_guard() -> None:
    assert comparable(95, 80)
    assert not comparable(95, 79.9)
