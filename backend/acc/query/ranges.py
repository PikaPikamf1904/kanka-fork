"""Date-range resolution and previous-period comparison (plan §7).

All ranges are half-open [start, end) in UTC; presentation uses America/Phoenix.
Mirrored in frontend/src/lib/range.ts.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from acc.models import RangePreset

DEFAULT_TZ = "America/Phoenix"
MAX_SPAN = timedelta(days=400)
COVERAGE_THRESHOLD_PCT = 80.0


class RangeError(ValueError):
    pass


@dataclass(frozen=True)
class TimeRange:
    start: datetime  # tz-aware UTC
    end: datetime  # tz-aware UTC, exclusive
    tz: str
    bucket: timedelta
    to_date: bool = False  # 'today': compare against the same clock window yesterday

    @property
    def start_ms(self) -> int:
        return int(self.start.timestamp() * 1000)

    @property
    def end_ms(self) -> int:
        return int(self.end.timestamp() * 1000)

    @property
    def span(self) -> timedelta:
        return self.end - self.start


def bucket_for(span: timedelta) -> timedelta:
    if span <= timedelta(hours=3):
        return timedelta(minutes=5)
    if span <= timedelta(days=2):
        return timedelta(hours=1)
    if span <= timedelta(days=62):
        return timedelta(days=1)
    return timedelta(weeks=1)


def _parse_instant(value: str, tz: ZoneInfo) -> datetime:
    try:
        dt = datetime.fromisoformat(value)
    except ValueError as e:
        raise RangeError(f"invalid timestamp: {value!r}") from e
    if dt.tzinfo is None:  # no offset means local (Phoenix) time
        dt = dt.replace(tzinfo=tz)
    return dt.astimezone(UTC)


def _parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as e:
        raise RangeError(f"invalid date: {value!r}") from e


def resolve(
    preset: RangePreset | str,
    *,
    now: datetime,
    start: str | None = None,
    end: str | None = None,
    tz_name: str = DEFAULT_TZ,
) -> TimeRange:
    """Resolve a preset or custom range. `now` must be tz-aware."""
    if now.tzinfo is None:
        raise RangeError("now must be timezone-aware")
    tz = ZoneInfo(tz_name)
    now_utc = now.astimezone(UTC)
    p = RangePreset(preset)

    if p is RangePreset.LAST_HOUR:
        s, e = now_utc - timedelta(hours=1), now_utc
    elif p is RangePreset.TODAY:
        local_midnight = datetime.combine(now_utc.astimezone(tz).date(), time.min, tzinfo=tz)
        s, e = local_midnight.astimezone(UTC), now_utc
    elif p is RangePreset.PREV_24H:
        s, e = now_utc - timedelta(hours=24), now_utc
    elif p is RangePreset.PREV_7D:
        s, e = now_utc - timedelta(days=7), now_utc
    elif p is RangePreset.PREV_30D:
        s, e = now_utc - timedelta(days=30), now_utc
    elif p is RangePreset.CUSTOM_DATES:
        if not start or not end:
            raise RangeError("custom_dates requires start and end dates")
        d0, d1 = _parse_date(start), _parse_date(end)
        if d1 < d0:
            raise RangeError("end date is before start date")
        s = datetime.combine(d0, time.min, tzinfo=tz).astimezone(UTC)
        e = datetime.combine(d1 + timedelta(days=1), time.min, tzinfo=tz).astimezone(UTC)
    else:  # CUSTOM
        if not start or not end:
            raise RangeError("custom requires start and end timestamps")
        s, e = _parse_instant(start, tz), _parse_instant(end, tz)

    e = min(e, now_utc)  # clamp future ends
    if e <= s:
        raise RangeError("end must be after start")
    if e - s > MAX_SPAN:
        raise RangeError("range exceeds 400 days")
    return TimeRange(
        start=s, end=e, tz=tz_name, bucket=bucket_for(e - s), to_date=p is RangePreset.TODAY
    )


def _shift_local_days(dt: datetime, tz: ZoneInfo, days: int) -> datetime:
    local = dt.astimezone(tz)
    shifted = datetime.combine(local.date() + timedelta(days=days), local.time(), tzinfo=tz)
    return shifted.astimezone(UTC)


def previous_period(r: TimeRange) -> TimeRange:
    """The comparison window.

    'today' (to-date) compares to the same local clock window yesterday, e.g.
    today 00:00-10:30 vs yesterday 00:00-10:30. Every other range compares to
    the immediately preceding window of equal length.
    """
    if r.to_date:
        tz = ZoneInfo(r.tz)
        s, e = _shift_local_days(r.start, tz, -1), _shift_local_days(r.end, tz, -1)
        return TimeRange(start=s, end=e, tz=r.tz, bucket=r.bucket)
    span = r.span
    return TimeRange(start=r.start - span, end=r.start, tz=r.tz, bucket=r.bucket)


def bucket_edges(r: TimeRange) -> list[datetime]:
    """Bucket start times. Day/week buckets align to local midnight."""
    tz = ZoneInfo(r.tz)
    if r.bucket >= timedelta(days=1):
        first = datetime.combine(r.start.astimezone(tz).date(), time.min, tzinfo=tz)
    else:
        step = int(r.bucket.total_seconds())
        epoch = int(r.start.timestamp())
        first = datetime.fromtimestamp(epoch - epoch % step, tz=UTC)
    edges: list[datetime] = []
    cur = first
    while cur < r.end:
        edges.append(cur.astimezone(UTC))
        cur = cur + r.bucket
    return edges


def delta_pct(current: float | None, previous: float | None) -> float | None:
    """Percent change; None when not meaningful (missing values or zero base)."""
    if current is None or previous is None or previous == 0:
        return None
    return (current - previous) / previous * 100.0


def comparable(coverage_current_pct: float, coverage_previous_pct: float) -> bool:
    return (
        coverage_current_pct >= COVERAGE_THRESHOLD_PCT
        and coverage_previous_pct >= COVERAGE_THRESHOLD_PCT
    )
