"""Shared contracts (WP0). Owned by the lead: change only via a contract PR.

Mirrored in frontend/src/api/types.ts and docs/openapi.yaml.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, Field


class Provider(StrEnum):
    CLAUDE = "claude"
    GROK = "grok"


class Quality(StrEnum):
    """Stored on every fact row. UNAVAILABLE and CONFIGURED are display-only."""

    OBSERVED = "observed"
    ESTIMATED = "estimated"
    IMPORTED = "imported"


class DisplayQuality(StrEnum):
    OBSERVED = "observed"
    ESTIMATED = "estimated"
    IMPORTED = "imported"
    CONFIGURED = "configured"
    UNAVAILABLE = "unavailable"


class CostKind(StrEnum):
    ESTIMATED_LIST = "estimated_list"  # Claude cost_usd: local list-price estimate
    PROVIDER_REPORTED = "provider_reported"  # grok usage costUsdTicks (API-equivalent)
    ESTIMATED_PRICING_TABLE = "estimated_pricing_table"  # our pricing table, opt-in


class RangePreset(StrEnum):
    LAST_HOUR = "last_hour"
    TODAY = "today"
    PREV_24H = "prev_24h"
    PREV_7D = "prev_7d"
    PREV_30D = "prev_30d"
    CUSTOM_DATES = "custom_dates"
    CUSTOM = "custom"


class LimitWindow(StrEnum):
    FIVE_HOUR = "five_hour"
    SEVEN_DAY = "seven_day"
    SPEND_LIMIT = "spend_limit"


# ---------- response envelope ----------

T = TypeVar("T")


class RangeInfo(BaseModel):
    start: str  # ISO-8601 with offset, rendered in tz
    end: str
    tz: str
    bucket_seconds: int


class QualityMix(BaseModel):
    """Share of the underlying rows by quality, 0..1. Sums to 1 when any rows exist."""

    observed: float = 0.0
    estimated: float = 0.0
    imported: float = 0.0


class Gap(BaseModel):
    source_id: str
    start: str
    end: str


class Coverage(BaseModel):
    pct: float = Field(ge=0, le=100)
    gaps: list[Gap] = []


class CompareBlock(BaseModel, Generic[T]):
    range: RangeInfo
    data: T
    delta_pct: dict[str, float | None]  # None = not comparable (zero base or coverage < 80%)
    insufficient_coverage: bool


class Envelope(BaseModel, Generic[T]):
    range: RangeInfo
    data: T
    compare: CompareBlock[T] | None = None
    quality: QualityMix
    coverage: Coverage


# ---------- value types ----------


class TokenTotals(BaseModel):
    """Normalized: input excludes cache reads; output includes reasoning."""

    input: int = 0
    output: int = 0
    reasoning: int | None = None  # None = provider does not report it
    cache_read: int = 0
    cache_write: int = 0


class CostTotals(BaseModel):
    """Cost kinds are never summed together. None = no data of that kind."""

    estimated_list_usd: float | None = None
    provider_reported_usd: float | None = None
    estimated_pricing_table_usd: float | None = None
    configured_plan_usd: float | None = None
    unknown_cost_units: int = 0  # requests/turns whose cost is unknown (never 0 dollars)
    billed: Literal["unavailable"] = "unavailable"


class ProviderSummary(BaseModel):
    provider: Provider
    tokens: TokenTotals
    requests: int
    sessions: int
    active_sessions_now: int
    errors: int
    cost: CostTotals
    verified_tasks: int | None = None


class Unavailable(BaseModel):
    status: Literal["unavailable"] = "unavailable"
    reason: str
    docs_url: str | None = None


class LimitSnapshotOut(BaseModel):
    status: Literal["observed"] = "observed"
    window: LimitWindow
    used_pct: float
    resets_at: str | None
    observed_at: str
    stale: bool
