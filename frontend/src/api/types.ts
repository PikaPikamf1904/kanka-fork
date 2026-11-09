// Shared contracts (WP0). Mirror of backend/acc/models.py — change both together.

export type Provider = "claude" | "grok";
export type Quality = "observed" | "estimated" | "imported";
export type DisplayQuality = Quality | "configured" | "unavailable";
export type CostKind = "estimated_list" | "provider_reported" | "estimated_pricing_table";
export type RangePreset =
  | "last_hour"
  | "today"
  | "prev_24h"
  | "prev_7d"
  | "prev_30d"
  | "custom_dates"
  | "custom";
export type LimitWindow = "five_hour" | "seven_day" | "spend_limit";

export interface RangeInfo {
  start: string; // ISO-8601 with offset
  end: string;
  tz: string;
  bucket_seconds: number;
}

export interface QualityMix {
  observed: number;
  estimated: number;
  imported: number;
}

export interface Gap {
  source_id: string;
  start: string;
  end: string;
}

export interface Coverage {
  pct: number;
  gaps: Gap[];
}

export interface CompareBlock<T> {
  range: RangeInfo;
  data: T;
  /** null = not comparable (zero base or coverage < 80%) */
  delta_pct: Record<string, number | null>;
  insufficient_coverage: boolean;
}

export interface Envelope<T> {
  range: RangeInfo;
  data: T;
  compare: CompareBlock<T> | null;
  quality: QualityMix;
  coverage: Coverage;
}

/** Normalized: input excludes cache reads; output includes reasoning. */
export interface TokenTotals {
  input: number;
  output: number;
  reasoning: number | null; // null = provider does not report it
  cache_read: number;
  cache_write: number;
}

/** Cost kinds are never summed together. null = no data of that kind. */
export interface CostTotals {
  estimated_list_usd: number | null;
  provider_reported_usd: number | null;
  estimated_pricing_table_usd: number | null;
  configured_plan_usd: number | null;
  unknown_cost_units: number;
  billed: "unavailable";
}

export interface ProviderSummary {
  provider: Provider;
  tokens: TokenTotals;
  requests: number;
  sessions: number;
  active_sessions_now: number;
  errors: number;
  cost: CostTotals;
  verified_tasks: number | null;
}

export interface Unavailable {
  status: "unavailable";
  reason: string;
  docs_url: string | null;
}

export interface LimitSnapshot {
  status: "observed";
  window: LimitWindow;
  used_pct: number;
  resets_at: string | null;
  observed_at: string;
  stale: boolean;
}

export type LimitState = LimitSnapshot | Unavailable;
