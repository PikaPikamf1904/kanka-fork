# Feasibility: Chronicle on Cloudflare Pages + Supabase Free

Written 2026-11-09 against `audit/chronicle-integration` (`cbcc485fe`). Evidence is from this
repository and from the providers' official pages (see `free-tier-limits.md`).

## Verdict

**Feasible as a new application, not as a hosting change.** Cloudflare Pages serves static files
and small JavaScript functions; it cannot run PHP, Laravel, queues or a MariaDB server. The
existing Kanka/Laravel app therefore cannot move to Pages unchanged.

What was built instead (in `chronicle-cloud/`): a React app on Pages, with Supabase providing the
database (PostgreSQL), sign-in (Auth) and private image storage. All privacy rules are enforced
inside PostgreSQL by Row Level Security. The Kanka app is untouched and stays the source for
migration and the rollback option.

## 1–5. What the existing app depends on

Inventory of the Kanka app on this branch:

| Area | Size | Depends on |
|---|---|---|
| Controllers | 386 | Laravel routing, sessions, policies |
| Blade views | 1,256 | Server-side PHP rendering |
| Models | 142 (315 migrations) | Eloquent + MariaDB SQL |
| Vue/TS/JS files | 219 | Built by Vite, mounted inside Blade pages |
| Queued jobs | 51 | Laravel queue workers (exports, imports, map tiling, cleanup) |
| Scheduled tasks | 21 entries in `app/Console/Kernel.php` | A long-running scheduler |
| Mail classes | 17 | An SMTP mailer |
| Console commands | 58 | Artisan |
| Packages | Cashier (payments), Passport (API), Reverb + Pusher (live updates), Scout + Meilisearch (search), Socialite, spatie/laravel-backup, intervention/image, predis (Redis) | Separate servers or paid services |
| Tests | 193 Pest files | PHP 8.4 |

- **Depends on Laravel (1):** everything above. Permissions (campaign roles, `AclScope`,
  `VisibilityIDScope`, posts' `visibility_id`, `is_private`) live in PHP.
- **Server-side PHP rendering (2):** every page (Blade).
- **Jobs, queues, email, local files, Redis (3):** exports/imports, map tiling, notifications,
  backups, password-reset mail, sessions and cache.
- **Easily portable (4):** the content itself (entities, posts, attributes, relations, tags,
  maps, markers, images) through Kanka's own campaign export; the visibility *flags*.
- **Expensive to reimplement (5):** Kanka's per-role permission matrix, calendars and their
  date maths, map tiling and layers, the whiteboard, abilities and inventories, the Tiptap editor
  with mentions, premium-gated features, the public API. None of these were rebuilt.

## 6. Can a useful Chronicle run on Pages + Supabase Free? Yes

Built and tested here: private wiki with player/DM separation, access-code enrollment, DM
editor with drafts, history and preview-as-player, search, categories, maps with hidden markers,
timeline, connections, private images, Kanka importer. Test results are in
`docs/overnight-handoff.md`.

Deliberately simpler than Kanka: two roles (player, DM) instead of a role matrix; Markdown
instead of a rich-text editor; image maps without tiling; no calendars, whiteboards, abilities,
inventories, notifications or public API.

## 7. Can existing campaign data be migrated safely? Yes, with review

`chronicle-cloud/importer/` reads an unzipped Kanka campaign export (never the database), makes
a dry-run report, and only writes with `--apply --target <url>`. Because the export does not
include Kanka's role permissions, **everything imports DM-only** unless the DM confirms with
`--trust-public-entities`. Admin-only posts, private or hidden attributes and private entries
stay DM-only either way. See `docs/migration/kanka-import-plan.md`.

## 8. Will it fit the free quotas? Yes, for one campaign

Estimate in `free-tier-limits.md`: about 30–60 MB of database for 1,000 articles with history
(500 MB allowed); about 200 KB per article image after in-browser resizing (1 GB allowed, so
roughly 4,000 images); a handful of players stays far below 50,000 monthly users, 5 GB egress
and 100,000 function calls a day (only enrollment uses a function).

## 9. What breaks when Supabase pauses?

A free project with no activity for 7 days is paused (Supabase emails about a week before).
While paused, the site still loads from Cloudflare but nothing works behind the access screen:
no sign-in, no content, no images. Data is kept. The DM restores it from the Supabase dashboard
(paused free projects are restorable for 90 days). Weekly play keeps it active on its own.
**No keep-alive or fake traffic was added**, by design.

## 10. Backups at no cost

The free plan has no automatic backups. Manual options:

- `supabase db dump` (Supabase CLI) or `pg_dump` against the session pooler, for roles, schema
  and data, kept off-site (for example a private folder on the DM's PC).
- Storage files are not in database dumps; download the `chronicle-media` bucket separately.
- A scheduled GitHub Action that dumps the database is possible (Supabase documents one), but it
  would put a database password in GitHub secrets and write campaign data somewhere; it was not
  added without the owner's decision.

The Kanka installation and its backups remain the authoritative copy until cut-over.
