# Kanka → Chronicle import plan

The importer is in `chronicle-cloud/importer/`. It reads Kanka's own **campaign export** (the
JSON zip the DM can download from Kanka), never the Kanka database, so the source cannot be
modified. Tested on a synthetic export fixture only; **no real campaign data has been imported.**

## Mapping

| Kanka | Chronicle |
|---|---|
| characters | character articles |
| locations | location articles |
| organisations, families | faction articles |
| items, quests, journals (sessions), events | item, quest, session, event articles |
| notes, races, creatures, abilities, timelines, calendars | lore articles (DM-only by default) |
| entity `entry` (HTML) | "Overview" section, converted to Markdown |
| posts | sections (one per post, in order) |
| child fields (title, age, pronouns, type, price…) and attributes | infobox fields |
| relations | connections (`related_to`, with Kanka's text as the note) |
| tags | tags (categories with kind `tag`) |
| `[type:id]` mentions | `[[slug|text]]` wiki links |
| entity id | `source_ref = kanka:entity:<id>`; slug from the name, id suffix on collisions |
| other modules (dice rolls, whiteboards, bookmarks…) | not imported; listed in the report |

## Visibility rules (unknown means private)

The export contains `is_private` and per-post/relation visibility, but **not** the campaign's
role permissions. So:

- Every article is **DM-only** by default. `--trust-public-entities` makes non-private entries
  player-visible; use it only after checking that Kanka's Player role could read every entity
  type you use. The report shows exactly how many entries that flag would reveal.
- Private entries, posts not visible to "All", private or hidden attributes, attributes of an
  entity with private attributes, private tags and relations not visible to "All" (or touching
  a DM-only entry) stay DM-only regardless.
- In player-visible text, a mention of a DM-only entry becomes "(unrevealed)" (or the
  author-written label), so its name and address never leak.
- Entry HTML is reduced to Markdown: scripts, styles, embeds and inline images are removed.

## Running it

```bash
cd chronicle-cloud
unzip ~/Downloads/kanka-export.zip -d /tmp/kanka-export     # your downloaded export
npm run import:dry-run -- --source /tmp/kanka-export        # writes importer/out/report.md (gitignored)
```

Read `importer/out/report.md`: counts, visibility and reasons, possible duplicates, mentions of
entries missing from the export, relations with a missing end, dropped images, unreadable files,
and a SHA-256 checksum of the input.

Applying (only into a project you control, never a public one with real data unapproved):

```bash
export SUPABASE_URL=https://<project>.supabase.co
export SUPABASE_SECRET_KEY=<secret key>   # from the dashboard; never commit it
node --experimental-strip-types importer/kanka-import.ts --source /tmp/kanka-export --apply --target "$SUPABASE_URL"
```

- Re-running skips everything already imported (matched on `source_ref`); it never overwrites
  edits made in Chronicle.
- Slug clashes with existing Chronicle pages get a `-kanka-<id>` suffix.

## Not yet covered

- Images (entity portraits, headers, gallery) are counted in the report but **not uploaded**;
  upload them in the editor (they are resized there).
- Maps, markers, timelines' elements and calendars are not imported.
- Kanka entity URLs are not redirected (the new app has different addresses).

## Rollback

```bash
node --experimental-strip-types importer/kanka-import.ts --rollback --target "$SUPABASE_URL"
```

Deletes every relation, article and tag with `source_ref` starting `kanka:` (sections, fields,
links and tag links go with them). Pages created in Chronicle are untouched (tested). Kanka
itself is never changed, so it remains the fallback until the DM decides to retire it.
