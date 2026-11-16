# Chronicle cloud architecture

```
Browser (React SPA, publishable key only)
  │  static files ─────────────► Cloudflare Pages (dist/, _headers, CSP)
  │  POST /api/enroll ─────────► Pages Function (secret key, server only)
  │                                   │ rpc begin/complete_enrollment, Auth admin API
  │  REST + Auth + Storage ────► Supabase
  │                                PostgreSQL: tables + Row Level Security (all privacy rules)
  │                                Auth: DM account (password + TOTP), one user per player device
  │                                Storage: private bucket chronicle-media (RLS via media rows)
```

## Code

| Path | What |
|---|---|
| `chronicle-cloud/supabase/migrations/` | Schema, RLS, functions, storage policies (apply in order) |
| `chronicle-cloud/functions/` | Cloudflare Pages Function for enrollment (`/api/enroll`) |
| `chronicle-cloud/src/` | React + TypeScript app (Vite) |
| `chronicle-cloud/importer/` | Kanka export → Chronicle importer (dry run by default) |
| `chronicle-cloud/tests/db/` | PostgreSQL policy, function, enrollment, storage and importer tests |
| `chronicle-cloud/tests/e2e/` | Playwright browser tests |
| `chronicle-cloud/scripts/` | Local Supabase stack, seed, e2e runner, header writer |

## Data model

- `articles`: one row per page (type, slug, title, summary, visibility, status, flags).
- `article_sections`, `infobox_fields`: separate rows, each with its own visibility (and status
  for sections), so player lore and DM secrets of one page are different rows.
- `dm_notes`, `revisions`: DM only.
- `categories` (+ `article_categories`): categories and tags, each with visibility.
- `relations`: typed links between articles, with visibility.
- `article_links`: `[[wiki links]]` found in section text, maintained by a trigger.
- `redirects`: old slugs, with visibility.
- `timeline_events`, `maps`, `map_markers`: with visibility (and status).
- `media`: image metadata; decides who may read each file in storage.
- `campaign_members`, `access_codes`, `enrollment_attempts`: access control.
- `campaign_settings`: title, tagline, overview, banner.

## Choices

- **React + TypeScript + Vite**, react-router, supabase-js 2.118, react-markdown (no raw HTML),
  Leaflet for maps. Versions are pinned; `package-lock.json` is committed.
- **All authorization in PostgreSQL.** The browser never filters secrets; it only shows what the
  API returned. Read functions are `SECURITY INVOKER`.
- **Publishable/secret keys** (Supabase's current scheme); the secret key exists only in the
  Pages Function's environment and is sent only as the `apikey` header.
- **No Kanka code reused** in the new app (Kanka's licence is the Commons Clause with no stated
  base licence; see `docs/dragonlance/first-pass-audit.md`). The importer reads Kanka's export
  *data format* only.

## Local development

A faithful local subset of Supabase built from the official images and init scripts
(`scripts/local-stack.sh`): PostgreSQL 16, GoTrue, PostgREST, storage-api and a small gateway.
It reproduces hosted defaults that matter for security (including the default grants of new
public tables to `anon`), so tests prove the migrations revoke them.
