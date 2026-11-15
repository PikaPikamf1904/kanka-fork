# Chronicle release bundle — 15 pending migrations (updated 2026-11-15)

**Status: NOT APPROVED FOR PRODUCTION.** Prepared and verified locally only. No part of this bundle
has been applied to the hosted project. Nothing may be applied until the gates in section 5 are met
and the owner approves this exact list of files and hashes.

Hosted project state (read-only `list_migrations`, re-checked 2026-11-14): 13 migrations recorded,
the last being `20261112001300 goblin_gazette`. Hosted Postgres is **17**. On 2026-11-14 the whole
bundle was verified locally on **PostgreSQL 17.12** as well as 16 (section 3). The restore
rehearsal on a copy of the real data (section 5) is still required.

## 1. Files, order and fingerprints

Apply in exactly this order, each file in its own transaction. Each file requires every earlier one.

| # | File | SHA-256 | Purpose |
|---|---|---|---|
| 1 | `20261112001400_article_images.sql` | `bee57c78bf7c920379d53ccf10a06ed0fa6040136980d26128a696204c74a8a2` | Portraits, galleries, inline images; media visibility follows usage |
| 2 | `20261112051529_oauth_access_management_guard.sql` | `e199a797d6cae2cb725963c82a9c37df361bd2a10fd59d6a9a2f3a18ddffdf9e` | Terra CH-101: assistants cannot manage access codes or members |
| 3 | `20261112052309_oauth_visible_section_delete_guard.sql` | `315c230565902aed1528d05da7b2710595d3a044ea21273b45ef0ae14a7dfe45` | Terra CH-102: assistants cannot delete visible sections |
| 4 | `20261112052438_protect_gazette_type_transitions.sql` | `c3140e72e76df7071899609b174292063c7e9189ef40f34e1026460673b2144c` | Terra CH-103: no conversion into or out of the Gazette |
| 5 | `20261112052528_resync_reparented_section_media.sql` | `15645f8fb1c42e0da0a3c032c4c755a50386cb3bb115ef99b76639130e84c064` | Terra CH-104: moving a section re-checks its pictures |
| 6 | `20261113000100_photo_library.sql` | `62a43851cc030fa7fe22b04bc1b01d939f6040b8382bac4bb5eb038d182cc687` | Photo library, private originals and credits |
| 7 | `20261113000200_oauth_write_boundary.sql` | `3c3a30d1a7da13dc485d13f60247ab2e4163854aa0440b6da00446fbf498ddfc` | CH-101: assistants cannot write content directly; only approved change sets apply |
| 8 | `20261113000300_photo_integrity.sql` | `e6da0b60bdae21fb6d3656a300a146c492d5a087c693131f7a8e70821ea4a98f` | Storage cannot move, overwrite or re-upload registered files; in-use covers history and proposals; attach/delete locking; assistants cannot read files |
| 9 | `20261113000400_mcp_public_content.sql` | `f33ca435f682b158afe67e1d81a04763448ec402751fdfbaa8f55e6a7bf24ab8` | CH-102: assistant change sets cannot change anything players see; a client named "web" is not the website |
| 10 | `20261113000500_gazette_review_integrity.sql` | `7b902f2ea804f9284a88b464481eb29083b71535dcee7489b56b5ae269127ed1` | CH-103: changing an approved story sends it back to review |
| 11 | `20261114000100_provenance_guard_and_review_binding.sql` | `bcf825ec45064020e81eba7a3ec0e7f0288388c82b24d2c6ae9437ac77bd96c2` | Assistants cannot write source records directly; Gazette approval and printing are bound to the text the DM saw |
| 12 | `20261114000200_suggest_any_word.sql` | `c4dae1fa857fe189ddf09d2f810b6fd605b0a14e223e15ba8119bf2c5619af2e` | Search suggestions match the start of any word in a title (still limited by Row Level Security) |
| 13 | `20261115000100_import_batches.sql` | `f061399790a426f4bc2ad89118b0cb9f9c151b49f9b6f8cdec34d2f7a26d25c6` | Staged lore imports (DM only; an assistant may stage and read, never approve or save) |
| 14 | `20261116000100_location_privacy.sql` | `399259c88f44ae740f755b486208c70474ebd3d7bfa5f504fe4ea49c3a202153` | Players can no longer read the current-location id directly; `campaign_location()` shows it only when that page is published to players |
| 15 | `20261116000200_news_proposals.sql` | `e3807f981e63f1dbb385c20dd6f32f65975997e0f800e5c8f88176b7a109b5d0` | Assistant Gazette story proposals; only the DM, on the website, accepts (as a private draft) or dismisses |

Check before applying, from `chronicle-cloud/`:
`sha256sum supabase/migrations/2026111200140* supabase/migrations/2026111205* supabase/migrations/20261113* supabase/migrations/20261114* supabase/migrations/20261115* supabase/migrations/20261116*`
must print exactly the hashes above. Applied migrations 1–13 are not modified by this bundle.

## 2. Schema and data compatibility

- Additive. No table, column or row is dropped. New: `media_private` table, media columns, triggers,
  functions and replaced policies. Existing article, section, Gazette, member and revision rows are
  not rewritten. Migrations 1, 5 and 6 re-derive `media.visibility` (safe direction: hidden unless
  a published player page uses the picture). The hosted project had 0 media rows at the last backup.
- Behaviour changes the owner should know about:
  - Assistant (MCP) connections can no longer write campaign tables directly, read stored files or
    private photo details, or change player-visible content even through an approved change set.
    Such changes must be made on the website.
  - Editing an approved but unprinted Gazette story sends it back to "in review".
  - A picture used by page history, a pending proposal, a map, a gallery, a banner or a waiting
    Gazette revision cannot be deleted from the library.
  - A registered stored file cannot be moved, renamed or overwritten through the Storage API.
  - Approving or printing a Gazette story from a tab that shows out-of-date text is refused
    (the website passes the version it loaded; the older two-argument call still works).
  - Assistant connections can no longer write source records (provenance) directly.
  - Nobody can select `campaign_settings.current_location_id` directly any more (file 14); the
    location is read through `campaign_location()`. The **currently deployed site's** settings
    query names that column, so once file 14 is applied its home page settings request fails for
    every reader, the DM included. See the deployment order below.
  - Assistant Gazette drafts arrive as proposals on the news desk instead of text to paste (file 15).
- After applying, the Data API must reload its schema to see new functions. Hosted Supabase does
  this automatically after DDL; file 11 also ends with `notify pgrst, 'reload schema'`. If a new
  function answers "not found", run that statement once.
- Client and order: the website build from branch `claude/chronicle-release-prep` expects this
  schema. It also works with files 1–13 alone (it falls back to the old location query and shows
  no proposals while files 14–15 are missing). The currently deployed site keeps working against
  files 1–13 for reading, but not against file 14. So:
  1. apply files 1–13;
  2. deploy that website build and check the home page as DM and as a player;
  3. apply files 14 and 15;
  4. deploy the MCP Worker right after step 3. The deployed Worker reads `current_location_id`
     directly, so between steps 3 and 4 its `chronicle_campaign_overview` and
     `chronicle_session_prep` tools fail with "not allowed"; the new Worker also needs file 15
     for its Gazette tool. Do steps 3 and 4 back to back.

## 3. Local verification (synthetic data only)

Files 1–12 run on 2026-11-14 on both PostgreSQL 16.15 and **PostgreSQL 17.12** (official
17 binaries, same real Auth, Data API and Storage services as the 16 stack):

- **Fresh install:** all 25 migrations then on both versions; all 26 (with file 13) on
  PostgreSQL 17.12 on 2026-11-15, followed by the full database (290) and browser (60) suites.
- **Upgrade simulation:** stack built with migrations through 13 only, seeded, plus 49 DM-only
  draft pages and 3 Gazette drafts (the production shape), a picture, a revision and a source
  record. The files applied in order, one transaction per file: all succeeded. Data fingerprint
  (articles, sections, media, Gazette details, revisions, members) identical before and after;
  media visibility unchanged.
- **Fresh install vs upgrade (PostgreSQL 17):** `pg_dump --schema-only` of `public` and `private`,
  plus all Storage policies: identical.
- **Tests on PostgreSQL 17:** database suite and browser suite pass on the fresh install, and the
  database suite again on the upgraded database (exact counts in `IMPLEMENTATION-STATUS.md`).
- Files 12 and 13 were added after the upgrade run of files 1 to 11; it was applied on top of that upgraded
  PostgreSQL 17 database and the suites were run again.
- Not re-runnable: migration 4 uses `create function` and `create trigger` without `or replace`, so a
  partially applied bundle must be resumed from the first unapplied file, not restarted.
- Still not verified: the real data (only its shape was simulated) and production-sized tables.
  That is what the restore rehearsal in section 5 is for.

**2026-11-15, all 15 files, PostgreSQL 17.12:** `scripts/upgrade-simulation.sh` (repeatable)
builds the stack at file 13 of the hosted history (`20261112001300`), adds the production-shaped
synthetic data (56 DM-only pages of 78, 4 Gazette drafts, picture, revision, source record), applies
files 1–15 in order with one transaction each, then compares. All 15 applied; data fingerprint
identical; `public`/`private` schema and Storage policies identical to a fresh install of the same
files; database suite 307/307 on the upgraded database. Fresh install afterwards: database 307/307,
browser 62/62 (re-run after file 15 gained its limits; hash above is the revised file).

How to repeat the PostgreSQL 17 run: `PGBIN=<dir with PostgreSQL 17 initdb/pg_ctl> bash scripts/local-stack.sh up`.

## 4. Rollback and forward-fix

- Preferred: **forward-fix**. Each file's header names what a corrective migration must restore.
  Write it as a new, reviewed migration; never edit an applied one.
- If a migration fails mid-apply, its own transaction rolls back; stop, do not retry the rest, and
  report the error. Earlier files in the bundle stay applied and are safe on their own.
- Last resort: restore the pre-migration backup (section 5) to a new project and switch the site to
  it. Data written after the backup would need to be re-entered by hand.

## 5. Gates before any production apply (all required)

1. A complete current backup (schema, data, roles/grants, Storage objects list and files) exists in
   **persistent private storage** chosen by the owner, with its checksum recorded.
2. **Restore rehearsal:** that backup is restored into an isolated, disposable Postgres 17 database;
   row counts match the source (expected: 49 articles, all DM-only, 3 Gazette drafts unless changed).
3. The bundle is applied to the restored copy in the order above; the checks in section 6 pass there.
4. The owner approves this exact file list and these exact hashes.

## 6. Production verification checklist (after an approved apply)

Read-only queries, then a DM walk-through:

- `select version, name from supabase_migrations.schema_migrations order by version` shows all 28.
- `select count(*), count(*) filter (where visibility = 'players' and status = 'published') from public.articles`
  — the second number is unchanged from before (expected 0).
- `select count(*) from public.articles where type = 'news' and status = 'published'` — unchanged (expected 0).
- `select tgname from pg_trigger where tgname in ('oauth_content_guard','oauth_public_content_guard','news_review_reset','sections_media_ref_lock','news_pending_media_ref_lock')` — all present, and `oauth_content_guard` exists on `public.provenance`.
- `select 'public.news_transition(uuid,text,text,timestamptz)'::regprocedure` — exists.
- `select has_column_privilege('authenticated', 'public.campaign_settings', 'current_location_id', 'select')`
  — `false` (file 14); `select 'public.campaign_location()'::regprocedure` — exists.
- `select to_regclass('public.news_proposals'), 'public.accept_news_proposal(uuid)'::regprocedure, (select count(*) from pg_trigger where tgname = 'news_proposals_guard')`
  — table and function exist, trigger count 1 (file 15).
- `select policyname from pg_policies where schemaname = 'storage'` — the Chronicle insert/update/read policies match section 1, file 8.
- Signed in as DM on the website: upload a photo, crop a portrait, add a gallery, open the Media
  Library, delete an unused test photo; confirm a player account cannot see a DM-only picture.
- Delete the test photo afterwards. Publish nothing.
