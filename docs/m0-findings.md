# M0 findings (verified on this PC, 2026-11-08)

Corrections and additions to the approved plan's capability matrix. Workers must follow these.

## Grok

- **`grok usage <session-id>` works while signed out.** It reads local session data. Fixture: `fixtures/grok/usage_session.json`.
- **Grok 4.7 exists.** Older sessions recorded `primaryModelId: "grok-4.7-build"`. `grok models` lists only 4.6/4.5 while signed out, so check the model menu again after `grok login`.
- **Token semantics differ from Claude.** `totalTokens = inputTokens + outputTokens`:
  - `inputTokens` **includes** `cachedReadTokens`. Normalized `input = inputTokens - cachedReadTokens`.
  - `reasoningTokens` is treated as **included in** `outputTokens`. Never add it again; store it only as a breakdown. (`7082 ≤ 9296` in the fixture. Recheck against a reasoning-heavy session at M1.)
  - `cacheCreationTokens` maps to `cache_write`.
- **Each turn has `endedAt`** (RFC 3339 with nanoseconds), plus `turnNumber`, `modelCalls`, per-model `modelUsage` and `costUsdTicks`. Turn timestamps come from `endedAt`. There is no turn start, so duration comes from OTel `turn_completed` when available.
- `costUsdTicks / 1e10 = USD`. The fixture session reports 1,703,746,800 ticks, which is $0.17037468. If a turn has no `costUsdTicks`, its cost is **unknown**.
- **`summary.json` contains conversation-derived text.** These fields must be **dropped**: `generated_title`, `last_turn_summary`, `session_summary`, `info`, `git_root_dir`, `grok_home`.
  - Allowlist: `created_at`, `updated_at`, `last_active_at`, `current_model_id`, `reasoning_effort`, `agent_name`, `num_messages`, `num_chat_messages`, `head_branch`.
- Session folders also hold `usage.json` (same data as `grok usage`, but undocumented, so don't read it) and `events.jsonl` / `chat_history.jsonl` (**content: never read**).

## Claude

- `~/.claude/settings.json` has **no `statusLine` and no `hooks`** yet. `env` holds only `CLAUDE_CODE_SUBAGENT_MODEL`, so setup can add keys without chaining.
- Version is 2.1.308. `agent_id` / `parent_agent_id` on OTel need ≥ 2.1.310 (`claude update`, which the user runs).
- Still open, to verify live:
  - Whether the desktop app's Code tab runs `statusLine`.
  - The exact OTLP attribute names, captured with `OTEL_LOGS_EXPORTER=console`.

## Normalized token contract (both providers)

| Field | Claude source | Grok source |
|---|---|---|
| `input_tokens` | `input_tokens` | `inputTokens - cachedReadTokens` |
| `output_tokens` | `output_tokens` | `outputTokens` |
| `reasoning_tokens` | NULL (not reported separately) | `reasoningTokens` (subset of output) |
| `cache_read_tokens` | `cache_read_input_tokens` / `cache_read_tokens` | `cachedReadTokens` |
| `cache_write_*` | `cache_creation_5m/1h` (or total in `5m` when unsplit) | `cacheCreationTokens` → `cache_write_5m` |

## Dedupe keys (canonical, in `acc/db/writes.py`)

- `claude:req:{request_id}`: OTel `api_request.request_id` and JSONL `requestId` map to the same key.
- `grok:req:{session.id}:{prompt.id}:{event.sequence}`: OTel `api_request`.
- `grok:turn:{session_id}:{turn}`: `grok usage` turns.
- Precedence for Grok: `api_requests` (OTel) drive time series. `turns` (poller) supply cost and stand in for tokens only for sessions with **no** OTel `api_requests`. The query layer enforces this per session.
