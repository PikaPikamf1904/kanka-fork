# OVERNIGHT CHRONICLE RESULTS

| | |
|---|---|
| Repository | `PikaPikamf1904/kanka-fork` |
| Branch | `feature/chronicle-cloudflare-supabase` (pushed) |
| Starting commit | `cbcc485fe` (`audit/chronicle-integration`, verified to contain `399646229`, `audit/chronicle-backend` and `chronicle/main`) |
| Final commit | see the PR (this file is in it) |
| GitHub PR | draft, into `audit/chronicle-integration`; not merged |
| Deployment status | **Nothing deployed.** No Supabase or Cloudflare account was used. |
| Test status | All new tests pass locally (below). Kanka's own suite unchanged: 17 pre-existing failures. |

## Completed

A new app in `chronicle-cloud/`; the Kanka app is untouched (0 files changed outside
`chronicle-cloud/` and `docs/`).

- **Database (Supabase/PostgreSQL):** articles with separate player and DM rows for sections,
  infobox fields, relations, markers, timeline, categories, redirects and media; DM notes,
  revisions (last 30 kept), maps, members, hashed access codes. RLS on every table.
- **Access:** shared player code → one revocable account per device, via a Cloudflare Pages
  Function with rate limits; DM email/password with optional TOTP two-step (enforced in the
  database); sign-up and anonymous sign-in off.
- **Wiki (players):** main page with banner, featured, party, latest session, important
  characters and places, recent changes; articles with infobox, contents, sections,
  connections, "What links here", categories, redirects; browse pages, search with suggestions
  and highlighted snippets, categories and tags, timeline, connections, maps with marker search,
  child maps and breadcrumbs; light/dark; phone, tablet, desktop.
- **DM tools:** editor with templates for nine types (character, location, faction, item, quest,
  session, event, lore, dossier), per-section and per-field visibility and draft/publish,
  categories/tags, connections, redirects, private notes, history with restore, preview as a
  player, image upload (resized in the browser), delete with typed confirmation, unsaved-change
  warning, warning when player text links a hidden page; DM desk; private notes; access codes
  and devices; wiki settings; timeline editor; map editor with click-to-place markers.
- **Importer:** Kanka export → Chronicle, dry run by default with a report; apply/rollback by
  `source_ref`; everything DM-only unless explicitly trusted.
- **Local stack:** PostgreSQL 16 + GoTrue + PostgREST + storage-api from Supabase's official
  images and init scripts; synthetic sample campaign; scripts for tests.
- **Docs:** `docs/hosting/`, `docs/architecture/`, `docs/security/`, `docs/migration/`,
  `docs/deployment/`, `docs/decision-log.md`.

## Verified

All from a fresh local stack on 2026-11-09 (commands from `chronicle-cloud/`):

| Command | Result |
|---|---|
| `npm run lint` | 0 problems |
| `npm run typecheck` | 0 errors |
| `npm test` (unit: enrollment function, importer) | 24 passed, 0 failed |
| `npm run test:db` (RLS, functions, enrollment through real GoTrue/PostgREST, storage-api, privileges, importer apply/rollback) | 59 passed, 0 failed |
| `bash scripts/e2e-local.sh` (Playwright, Chromium, built app on `wrangler pages dev`) | 17 passed, 0 failed |
| `npm run build` | OK; first load ~174 KB gzip (React 100, Supabase 58, app 15) |
| Policy mutation check (weakened `sections_read`) | 5 tests failed as expected; restored |

Kanka baseline on the same base commit (PHP 8.4.11, SQLite): 1,360 tests, 15 failed + 2 errors
(all pre-existing), 7 skipped; PHPStan 9 errors. Not changed by this work.

**Not verified:** a real Supabase project or Cloudflare deployment; MariaDB; real campaign data;
real devices (phones/tablets were emulated in Chromium); screen-reader testing; Turnstile.

## Security

- Every table has RLS; `anon` has no privilege on anything in `public` (tested against
  Supabase's own default grants); players get only published, player-visible rows whose parents
  are visible; the DM gets everything (with aal2 once TOTP is on).
- Search, suggestions, counts, backlinks, relations, markers, timeline, redirects, storage
  (download, list, signed URLs) and preview are all covered by tests. A browser test scans every
  API response a player receives for 20 secret phrases: none found.
- Roles come only from `campaign_members`; forged token claims and metadata grant nothing.
- Remaining risks: the shared code is a shared secret (rotate it and remove devices if it leaks);
  sessions live in `localStorage` (mitigated by CSP and no raw HTML); a DM who writes a hidden
  page's name into player text reveals it (the editor warns); sessions do not expire by time on
  the free plan.

Details: `docs/security/access-control.md`, `docs/security/rls-test-matrix.md`.

## Hosting

$0: Cloudflare Pages Free (`<project>.pages.dev`) + Supabase Free. Limits that matter: 500 MB
database, 1 GB storage, 5 GB egress, 100,000 Function calls/day (only enrollment uses one).
Estimated use for one campaign: 30–75 MB database, ~200 KB per image. **A free Supabase project
pauses after 7 days without activity**; the site then cannot load content until the DM restores
it in the dashboard (data kept; restorable for 90 days). No keep-alive was added. No automatic
backups on Free: take manual `supabase db dump`/`pg_dump` copies and download the image bucket.
See `docs/hosting/`.

## Migration

The importer reads Kanka's campaign export (not the database): entities → articles, entry →
overview, posts → sections, attributes and type fields → infobox, relations → connections,
tags → tags, mentions → `[[links]]`. Everything is DM-only unless `--trust-public-entities`;
private posts/attributes/entries stay DM-only regardless. Not yet imported: images, maps and
markers, calendars, timelines' elements. Tested only on a synthetic export.
See `docs/migration/kanka-import-plan.md`.

## Screenshots

Synthetic sample content, in `docs/chronicle-cloud/screenshots/`: access screen, player home,
player article, DM article (DM-only rows marked), player map, phone home, phone article, tablet
dark mode, DM editor, DM map with hidden markers, access and device management.

## Blockers (need the owner)

1. Supabase and Cloudflare accounts: create the free projects and follow
   `docs/deployment/cloudflare-supabase-setup.md` (no payment method needed).
2. Decide whether Kanka's Player role could read every entity type (controls
   `--trust-public-entities`), and review the dry-run report on a real export before any import.
3. Approve publishing a preview, and approve merging; nothing has been deployed or merged.

## Next five actions

1. Create the free Supabase project, run the four migrations, disable sign-ups and anonymous
   sign-in, create the DM account (setup guide §1).
2. Connect the branch to Cloudflare Pages with the listed variables, open the `pages.dev` URL,
   sign in as DM and turn on two-step sign-in (§2–3), still with synthetic or no content.
3. Download a Kanka campaign export and run the importer **dry run**; review `report.md`.
4. Apply the import to the new project, review DM-only pages, publish what players may see; check
   in a second browser as a player before sharing the code.
5. Fix the remaining Kanka findings (M1, L1, L2) if Kanka stays in use; plan image and map import
   (not done yet) and a manual backup routine.
