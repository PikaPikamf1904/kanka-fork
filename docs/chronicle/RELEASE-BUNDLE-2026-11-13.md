# Chronicle release bundle — migrations 14 to 0500 (2026-11-13)

**Status: NOT APPROVED FOR PRODUCTION.** Prepared and verified locally only. No part of this bundle
has been applied to the hosted project. Nothing may be applied until the gates in section 5 are met
and the owner approves this exact list of files and hashes.

Hosted project state (read-only `list_migrations`, 2026-11-13): 13 migrations recorded, the last
being `20261112001300 goblin_gazette`. Hosted Postgres is **17**. The local test stack runs
**Postgres 16**, so a final dry run on a Postgres 17 restore copy is required (section 5).

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

Check before applying, from `chronicle-cloud/`:
`sha256sum supabase/migrations/2026111200140* supabase/migrations/2026111205* supabase/migrations/20261113*`
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
- Client: the website build from branch `claude/chronicle-p0-security` expects this schema. The
  currently deployed site keeps working against it for reading; its photo features need the new
  build. Deploy the site only after the migrations succeed.

## 3. Local verification (2026-11-13, synthetic data only)

- **Upgrade simulation:** fresh stack built with migrations through 13 only, seeded, plus 49 DM-only
  draft pages and 3 Gazette drafts (the production shape), a picture, a revision. Bundle applied in
  order, one transaction per file: all 10 succeeded. Data fingerprint (articles, sections, media,
  Gazette details, revisions, members) identical before and after; media visibility unchanged.
- **Fresh install vs upgrade:** `pg_dump --schema-only` of `public` and `private`, plus all Storage
  policies, identical apart from pg_dump's random `\restrict` tokens.
- Not re-runnable: migration 4 uses `create function` and `create trigger` without `or replace`, so a
  partially applied bundle must be resumed from the first unapplied file, not restarted.

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

- `select version, name from supabase_migrations.schema_migrations order by version` shows all 23.
- `select count(*), count(*) filter (where visibility = 'players' and status = 'published') from public.articles`
  — the second number is unchanged from before (expected 0).
- `select count(*) from public.articles where type = 'news' and status = 'published'` — unchanged (expected 0).
- `select tgname from pg_trigger where tgname in ('oauth_content_guard','oauth_public_content_guard','news_review_reset','sections_media_ref_lock','news_pending_media_ref_lock')` — all present.
- `select policyname from pg_policies where schemaname = 'storage'` — the Chronicle insert/update/read policies match section 1, file 8.
- Signed in as DM on the website: upload a photo, crop a portrait, add a gallery, open the Media
  Library, delete an unused test photo; confirm a player account cannot see a DM-only picture.
- Delete the test photo afterwards. Publish nothing.
