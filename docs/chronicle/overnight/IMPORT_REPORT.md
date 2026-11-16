# Import report

Nothing was imported into the hosted wiki. Everything below was run on a local, disposable test
stack with synthetic data, or as a dry run.

## Two import routes

| Route | For | Command (from `chronicle-cloud/`) |
|---|---|---|
| Lore pack | Hand-reviewed drafts kept in the repository (`lore/<name>/pack.json`) | `npm run lore:check` |
| Kanka importer | A campaign export downloaded from Kanka | `npm run import:dry-run -- --source <dir>` |

Both are dry-run by default, need the target given twice (flag and environment) to write, mark
every row with a `source_ref`, skip rows that already exist, and can roll back only their own rows.

## Lore packs (new)

`importer/lore-pack.ts` reads a pack, validates it, can write a review document, and can stage it.

- Every article, section, infobox field and connection is created **DM-only**; every article and
  section is a **draft**. This is not configurable.
- A pack containing `visibility` or `status` anywhere with any other value is refused.
- Every article must list what supports it. Those statements are stored with the page as a
  private DM note called "Provenance"; open questions become a second note.
- Links and connections must point at pages inside the pack.
- If a page already exists at the same address and did not come from the pack, it is left alone
  and reported as a conflict; no duplicate is created.
- Re-running creates nothing and never overwrites the DM's edits.

Tests: 11 unit (`importer/lore-pack.test.ts`), 6 database (`tests/db/lore-pack.test.ts`). The
database test stages the real pack, then checks as a player that lists, search, suggestions,
sections, connections, link records, notes and address look-ups all return nothing.

## Kanka importer (improved)

Supported: characters, locations, organisations and families, items, quests, journals, events,
notes and similar as lore; posts as sections; attributes as infobox fields; relations; tags;
mentions as wiki links. See `docs/migration/kanka-import-plan.md`.

Changed in this branch:

1. **Malformed files no longer crash the run.** Files that are not usable records, repeated
   entity ids, and unusable posts, attributes or relations are skipped and listed in the dry-run
   report. Before, 8 of 19 synthetic malformed cases threw an error.
2. **Privacy flags fail closed.** Only `false`, `0` or `"0"` now means "not private". A value such
   as `"yes"` or `"true"` was previously read as public when `--trust-public-entities` was on.
3. **Large wikis.** Existing rows are read in pages of 1000. The hosted service caps a single
   request at 1000 rows, so a re-import of a large campaign could not see all existing rows and
   failed on the first one it missed.

Tests: 22 new unit tests (`importer/robustness.test.ts`); the existing 12 importer unit tests and
4 database tests still pass.

## Known limitations

- No real Kanka export has been run through the importer. It has only seen synthetic fixtures.
- Images, maps, markers, calendars and timeline entries are not imported. Not attempted: without a
  real export the file formats would be guesses.
- Lore packs do not create timeline entries or maps (those tables have no import reference
  column, so a re-run could not be made safe without a schema change). The pack carries a
  "Campaign timeline" page instead.
- The Kanka importer still creates pages as "published but DM-only"; lore packs create drafts.

## Source data still needed

- The Kanka export zip, if the campaign has one.
- The eight documents listed in `CANON_AUDIT.md`.
- The DM's answers to the questions in `LORE_REVIEW.md`.

## Safe procedure for the hosted wiki (not run)

1. Edit `lore/dragonlance/pack.json` until `LORE_REVIEW.md` reads correctly; run `npm run lore:check`.
2. Take a database backup (see the deployment guide, section 4).
3. With the two environment values set on your own machine, run
   `node --experimental-strip-types importer/lore-pack.ts --pack lore/dragonlance/pack.json --apply --target "$SUPABASE_URL"`.
4. Open the DM desk; the 28 pages appear in the review queue. Edit, then publish page by page.
5. To undo: the same command with `--rollback` in place of `--apply`.
