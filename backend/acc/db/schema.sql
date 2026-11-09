-- AI Command Center schema v1.
-- Conventions:
--   * every timestamp is UTC epoch milliseconds (INTEGER)
--   * every fact row has quality IN ('observed','estimated','imported') and source_id
--   * "Unavailable" is never stored: it is the absence of a row
--   * fact tables carry dedupe_key UNIQUE; writers use INSERT ... ON CONFLICT DO NOTHING
--   * NO prompt, response, code, tool payload, file path, email or credential is ever stored

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version (
  version     INTEGER PRIMARY KEY,
  applied_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id        TEXT PRIMARY KEY,            -- e.g. 'claude.otlp', 'grok.usage_poller'
  provider  TEXT NOT NULL CHECK (provider IN ('claude','grok','local')),
  kind      TEXT NOT NULL CHECK (kind IN ('otlp','poller','import','hook','statusline','git','tests')),
  enabled   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS source_heartbeats (
  id         INTEGER PRIMARY KEY,
  source_id  TEXT NOT NULL REFERENCES sources(id),
  ts         INTEGER NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('ok','degraded','error','paused')),
  detail     TEXT                         -- short machine message, never user content
);
CREATE INDEX IF NOT EXISTS ix_heartbeats_source_ts ON source_heartbeats(source_id, ts);

CREATE TABLE IF NOT EXISTS coverage_windows (
  id         INTEGER PRIMARY KEY,
  source_id  TEXT NOT NULL REFERENCES sources(id),
  start_ts   INTEGER NOT NULL,
  end_ts     INTEGER NOT NULL,
  CHECK (end_ts >= start_ts)
);
CREATE INDEX IF NOT EXISTS ix_coverage_source ON coverage_windows(source_id, start_ts);

CREATE TABLE IF NOT EXISTS repos (
  id            INTEGER PRIMARY KEY,
  path          TEXT NOT NULL UNIQUE,     -- only repos the user explicitly registers
  display_name  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  pk             TEXT PRIMARY KEY,        -- '<provider>:<session_id>'
  provider       TEXT NOT NULL CHECK (provider IN ('claude','grok')),
  session_id     TEXT NOT NULL,
  parent_pk      TEXT,
  agent_id       TEXT,
  agent_type     TEXT,
  is_subagent    INTEGER NOT NULL DEFAULT 0,
  model_primary  TEXT,
  effort         TEXT,
  entrypoint     TEXT,
  started_at     INTEGER,
  ended_at       INTEGER,
  last_seen_at   INTEGER,
  repo_id        INTEGER REFERENCES repos(id),
  quality        TEXT NOT NULL CHECK (quality IN ('observed','estimated','imported')),
  source_id      TEXT NOT NULL REFERENCES sources(id)
);
CREATE INDEX IF NOT EXISTS ix_sessions_provider_start ON sessions(provider, started_at);

CREATE TABLE IF NOT EXISTS api_requests (
  id              INTEGER PRIMARY KEY,
  dedupe_key      TEXT NOT NULL UNIQUE,
  provider        TEXT NOT NULL CHECK (provider IN ('claude','grok')),
  session_pk      TEXT,
  ts              INTEGER NOT NULL,
  model           TEXT,
  -- Normalized token semantics (see docs/m0-findings.md):
  --   input_tokens = uncached input only (Grok's inputTokens minus cachedReadTokens)
  --   output_tokens includes reasoning; reasoning_tokens is a breakdown, never added again
  input_tokens         INTEGER NOT NULL DEFAULT 0,
  output_tokens        INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens     INTEGER,
  cache_read_tokens    INTEGER NOT NULL DEFAULT 0,
  cache_write_5m_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_1h_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micros     INTEGER,                -- NULL = unknown, never treated as 0
  cost_kind       TEXT CHECK (cost_kind IN ('estimated_list','provider_reported','estimated_pricing_table')),
  duration_ms     INTEGER,
  query_source    TEXT,                   -- main / subagent / auxiliary
  agent_name      TEXT,
  effort          TEXT,
  quality         TEXT NOT NULL CHECK (quality IN ('observed','estimated','imported')),
  source_id       TEXT NOT NULL REFERENCES sources(id),
  CHECK (cost_micros IS NULL OR cost_kind IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_api_requests_ts ON api_requests(provider, ts);
CREATE INDEX IF NOT EXISTS ix_api_requests_session ON api_requests(session_pk);

CREATE TABLE IF NOT EXISTS turns (
  id               INTEGER PRIMARY KEY,
  dedupe_key       TEXT NOT NULL UNIQUE,
  provider         TEXT NOT NULL CHECK (provider IN ('claude','grok')),
  session_pk       TEXT NOT NULL,
  turn_no          INTEGER NOT NULL,
  ts               INTEGER NOT NULL,      -- turn end time
  outcome          TEXT,
  duration_ms      INTEGER,
  model            TEXT,
  model_calls      INTEGER,
  input_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens    INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micros      INTEGER,
  cost_kind        TEXT CHECK (cost_kind IN ('estimated_list','provider_reported','estimated_pricing_table')),
  quality          TEXT NOT NULL CHECK (quality IN ('observed','estimated','imported')),
  source_id        TEXT NOT NULL REFERENCES sources(id),
  CHECK (cost_micros IS NULL OR cost_kind IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_turns_ts ON turns(provider, ts);
CREATE INDEX IF NOT EXISTS ix_turns_session ON turns(session_pk);

CREATE TABLE IF NOT EXISTS errors (
  id           INTEGER PRIMARY KEY,
  dedupe_key   TEXT NOT NULL UNIQUE,
  provider     TEXT NOT NULL CHECK (provider IN ('claude','grok')),
  session_pk   TEXT,
  ts           INTEGER NOT NULL,
  model        TEXT,
  category     TEXT NOT NULL,             -- e.g. api_error, rate_limit, tool_error; never a message
  status_code  INTEGER,
  quality      TEXT NOT NULL CHECK (quality IN ('observed','estimated','imported')),
  source_id    TEXT NOT NULL REFERENCES sources(id)
);
CREATE INDEX IF NOT EXISTS ix_errors_ts ON errors(provider, ts);

CREATE TABLE IF NOT EXISTS tool_events (
  id           INTEGER PRIMARY KEY,
  dedupe_key   TEXT NOT NULL UNIQUE,
  provider     TEXT NOT NULL CHECK (provider IN ('claude','grok')),
  session_pk   TEXT,
  ts           INTEGER NOT NULL,
  tool_name    TEXT NOT NULL,             -- built-in name or collapsed 'mcp'
  success      INTEGER,
  duration_ms  INTEGER,
  quality      TEXT NOT NULL CHECK (quality IN ('observed','estimated','imported')),
  source_id    TEXT NOT NULL REFERENCES sources(id)
);
CREATE INDEX IF NOT EXISTS ix_tool_events_ts ON tool_events(provider, ts);

CREATE TABLE IF NOT EXISTS subagent_events (
  id               INTEGER PRIMARY KEY,
  dedupe_key       TEXT NOT NULL UNIQUE,
  provider         TEXT NOT NULL CHECK (provider IN ('claude','grok')),
  session_pk       TEXT,
  ts               INTEGER NOT NULL,
  agent_id         TEXT,
  parent_agent_id  TEXT,
  agent_type       TEXT,
  phase            TEXT CHECK (phase IN ('launched','completed')),
  outcome          TEXT,
  duration_ms      INTEGER,
  quality          TEXT NOT NULL CHECK (quality IN ('observed','estimated','imported')),
  source_id        TEXT NOT NULL REFERENCES sources(id)
);
CREATE INDEX IF NOT EXISTS ix_subagent_events_ts ON subagent_events(provider, ts);

-- Raw metric points: reconciliation only, NEVER summed into dashboard totals.
CREATE TABLE IF NOT EXISTS metric_points (
  id           INTEGER PRIMARY KEY,
  dedupe_key   TEXT NOT NULL UNIQUE,
  provider     TEXT NOT NULL CHECK (provider IN ('claude','grok')),
  name         TEXT NOT NULL,
  attrs_json   TEXT NOT NULL,             -- allowlisted attributes only
  ts           INTEGER NOT NULL,
  value        REAL NOT NULL,
  temporality  TEXT NOT NULL CHECK (temporality IN ('delta','cumulative','gauge')),
  source_id    TEXT NOT NULL REFERENCES sources(id)
);
CREATE INDEX IF NOT EXISTS ix_metric_points ON metric_points(provider, name, ts);

-- Last cumulative value per series, used to convert cumulative -> delta.
CREATE TABLE IF NOT EXISTS metric_series_state (
  series_key   TEXT PRIMARY KEY,
  start_ts     INTEGER NOT NULL,
  last_value   REAL NOT NULL,
  last_ts      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS limit_snapshots (
  id           INTEGER PRIMARY KEY,
  provider     TEXT NOT NULL CHECK (provider IN ('claude','grok')),
  limit_window TEXT NOT NULL CHECK (limit_window IN ('five_hour','seven_day','spend_limit')),
  used_pct     REAL NOT NULL CHECK (used_pct >= 0),
  resets_at    INTEGER,
  observed_at  INTEGER NOT NULL,
  session_pk   TEXT,
  quality      TEXT NOT NULL DEFAULT 'observed' CHECK (quality = 'observed'),
  source_id    TEXT NOT NULL REFERENCES sources(id),
  UNIQUE (provider, limit_window, resets_at, used_pct)
);
CREATE INDEX IF NOT EXISTS ix_limit_snapshots ON limit_snapshots(provider, limit_window, observed_at);

CREATE TABLE IF NOT EXISTS limit_events (
  id          INTEGER PRIMARY KEY,
  dedupe_key  TEXT NOT NULL UNIQUE,
  provider    TEXT NOT NULL CHECK (provider IN ('claude','grok')),
  ts          INTEGER NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('rate_limit_error','limit_hit')),
  session_pk  TEXT,
  quality     TEXT NOT NULL CHECK (quality IN ('observed','estimated','imported')),
  source_id   TEXT NOT NULL REFERENCES sources(id)
);

CREATE TABLE IF NOT EXISTS git_commits (
  id             INTEGER PRIMARY KEY,
  sha            TEXT NOT NULL UNIQUE,
  repo_id        INTEGER NOT NULL REFERENCES repos(id),
  ts             INTEGER NOT NULL,
  files_changed  INTEGER NOT NULL DEFAULT 0,
  insertions     INTEGER NOT NULL DEFAULT 0,
  deletions      INTEGER NOT NULL DEFAULT 0,
  ai_trailer     TEXT NOT NULL CHECK (ai_trailer IN ('claude','grok','none')),
  session_pk     TEXT,
  source_id      TEXT NOT NULL REFERENCES sources(id)
);
CREATE INDEX IF NOT EXISTS ix_git_commits_ts ON git_commits(repo_id, ts);

CREATE TABLE IF NOT EXISTS test_runs (
  id          INTEGER PRIMARY KEY,
  dedupe_key  TEXT NOT NULL UNIQUE,
  repo_id     INTEGER REFERENCES repos(id),
  ts_start    INTEGER NOT NULL,
  ts_end      INTEGER NOT NULL,
  runner      TEXT NOT NULL,
  exit_code   INTEGER NOT NULL,
  passed      INTEGER,
  failed      INTEGER,
  skipped     INTEGER,
  session_pk  TEXT,
  source_id   TEXT NOT NULL REFERENCES sources(id)
);

CREATE TABLE IF NOT EXISTS pricing (
  id                   INTEGER PRIMARY KEY,
  provider             TEXT NOT NULL CHECK (provider IN ('claude','grok')),
  model                TEXT NOT NULL,
  effective_from       INTEGER NOT NULL,
  input_per_mtok       REAL NOT NULL,
  output_per_mtok      REAL NOT NULL,
  cache_read_per_mtok  REAL,
  cache_write_per_mtok REAL,
  source_url           TEXT NOT NULL,
  UNIQUE (provider, model, effective_from)
);

CREATE TABLE IF NOT EXISTS plans (
  id              INTEGER PRIMARY KEY,
  provider        TEXT NOT NULL CHECK (provider IN ('claude','grok')),
  plan_name       TEXT NOT NULL,
  monthly_usd     REAL NOT NULL CHECK (monthly_usd >= 0),
  effective_from  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS import_runs (
  id            INTEGER PRIMARY KEY,
  source_id     TEXT NOT NULL REFERENCES sources(id),
  started_at    INTEGER NOT NULL,
  finished_at   INTEGER,
  files         INTEGER NOT NULL DEFAULT 0,
  inserted      INTEGER NOT NULL DEFAULT 0,
  skipped_dupe  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL CHECK (status IN ('running','ok','error'))
);

CREATE TABLE IF NOT EXISTS rollup_hourly (
  provider           TEXT NOT NULL,
  hour_ts            INTEGER NOT NULL,
  model              TEXT NOT NULL,
  quality            TEXT NOT NULL,
  requests           INTEGER NOT NULL,
  input_tokens       INTEGER NOT NULL,
  output_tokens      INTEGER NOT NULL,
  reasoning_tokens   INTEGER NOT NULL,
  cache_read_tokens  INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  cost_estimated_list_micros     INTEGER NOT NULL,
  cost_provider_reported_micros  INTEGER NOT NULL,
  cost_unknown_requests          INTEGER NOT NULL,
  PRIMARY KEY (provider, hour_ts, model, quality)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id      INTEGER PRIMARY KEY,
  ts      INTEGER NOT NULL,
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paired_devices (
  id            INTEGER PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,     -- SHA-256 of the session cookie value
  ts_login      TEXT NOT NULL,            -- Tailscale login that paired it
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  last_used_at  INTEGER
);
