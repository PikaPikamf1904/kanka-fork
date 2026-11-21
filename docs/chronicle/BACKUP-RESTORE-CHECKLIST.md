# Backup and restore readiness checklist (before any production migration)

Status: a checklist for the owner and the reviewer. It is not a record of a backup that has been taken. As of the 2026-11-16 status in `IMPLEMENTATION-STATUS.md`, the first item below (a complete backup in permanent private storage) and the restore rehearsal were still the owner's tasks and were **not done**. Nothing here is deployed. The migrations it covers (`20261117000100` to `20261117000700`, and the earlier pending files listed in `MIGRATIONS-2026-11-17.md` and `RELEASE-BUNDLE-2026-11-13.md`) are on the development branch and are not applied to production.

This checklist follows the gates already written in `RELEASE-BUNDLE-2026-11-13.md` (section 5) and `MIGRATIONS-2026-11-17.md`. If the two ever disagree, stop and reconcile them before applying anything.

**Never put a credential, a project identifier, a database URL, a key value or an address for a hosted service in this checklist, in the backup record, or in the repository.** Record names only (for example, the name of an environment variable), never values.

## 1. What a complete backup must include

Take all of these from the **same point in time**, before any change, and record the time.

- [ ] **Database schema** for `public`, `private` and the migration history table `supabase_migrations.schema_migrations`.
- [ ] **Database data** for every table in `public` and `private`, including the new tables (reading lists, bookmarks, scratchpad, journals, invitations and devices, mysteries and clues, board, feedback, research) when they exist.
- [ ] **Roles and grants** (table, column and function privileges). The migrations depend on column-level grants, so a schema-only dump is not enough.
- [ ] **`auth` schema** data needed to restore sign-in: users, identities, sessions, MFA factors. Handle this data as sensitive.
- [ ] **`storage` metadata**: the bucket rows, the object rows, and the Storage policies. The RLS policies on `storage.objects` are part of the Storage checks in the upgrade simulation.
- [ ] **Storage files**: every object in each bucket, with its path, size and SHA-256. The list alone is not enough for the photo library and media.
- [ ] **Auth settings** (providers enabled, MFA settings, redirect addresses, email templates), exported as settings. Secrets are excluded from the export and recorded by name only.
- [ ] **Website hosting record**: the commit hash of the deployed code, the Pages environment variable **names** and the bindings **names** (for example the status KV namespace), and the deployment record. No values.
- [ ] **Row-count and checksum summary** of the key tables (see section 4), generated at backup time.
- [ ] **Migration list**: the applied migration versions (`select version, name from supabase_migrations.schema_migrations order by version`), as text.

Environment variable names to record (names only), from the code: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `IP_HASH_SECRET`, `TURNSTILE_SECRET_KEY`, `MAINTENANCE_MODE`, `DM_SCREEN_PASSCODE`, and the build-time `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Check the list against the Pages project before use; it is taken from `functions/` and `src/lib/` and may be incomplete.

## 2. Where the backup must be kept

- [ ] In **persistent private storage chosen by the owner**. Not in the repository, not in a chat, not in a shared folder, and not in a temporary directory that a reboot or cleanup can remove.
- [ ] Encrypted at rest and access-restricted to the owner and named reviewers. The campaign data includes private content and the Auth export includes accounts.
- [ ] The **SHA-256 of each archive** and its size are written into the release record, not the archive itself.
- [ ] A second copy is kept if the owner's storage has no independent backup. The owner decides; record where each copy is.
- [ ] The retention time is written down. Backups are kept until the owner says the release is complete and the post-apply checks in section 6 of `RELEASE-BUNDLE-2026-11-13.md` have passed.

## 3. Isolated restore rehearsal

Do this on a **disposable** target. Never restore onto the production project, and never run the rehearsal against a hosted project unless the owner has said so in writing for that disposable project.

1. [ ] **Prepare the target.** Either:
   - the local disposable stack: `PGBIN=<directory with PostgreSQL 17 binaries> bash scripts/local-stack.sh up` (the script builds a fresh PostgreSQL 17 instance); or
   - a new disposable hosted project created only for the rehearsal, deleted when finished.
2. [ ] **Verify the backup first.** Compare each archive's SHA-256 with the release record. Stop if one does not match.
3. [ ] **Restore in this order:** roles and grants, schema, data, Auth settings (where the target supports them), Storage metadata, Storage files. Record each step's result and any warning.
4. [ ] **Spot-check row counts** against the summary written at backup time (section 1). Check at least: articles, article sections, media, campaign members, revisions, and the number of applied migrations. Any mismatch is a no-go (section 5).
5. [ ] **Apply the bundle to the restored copy**, in the order in the release record, one file at a time, each in its own transaction. Record each file's result. If a file fails, its transaction rolls back; stop there (see section 4 of `RELEASE-BUNDLE-2026-11-13.md`).
6. [ ] **Upgrade comparison.** `PGBIN=<PostgreSQL 17 binaries> bash scripts/upgrade-simulation.sh <FROM>`, where `<FROM>` is the last migration version actually recorded on production (check it first; the script's default is set for an earlier date). The script checks that the data fingerprint is unchanged and that the `public` and `private` schemas and Storage policies equal a fresh install of the same files. It runs on the local stack only.
7. [ ] **Database tests.** Run `npm run test:db` on the rehearsal database and record the counts. If the suite cannot be pointed at the restored database, record that as a gap and do not treat the rehearsal as complete on that point.
8. [ ] **Browser tests (recommended).** Run `npm run test:e2e` against the rehearsal stack and record the counts.
9. [ ] **Reference-leak check.** The database suite includes the reference-leak sweep (`tests/db/reference-leak-sweep.test.ts`). Its result must be recorded with the rest.
10. [ ] **Clean up.** Delete the rehearsal database and any copy of campaign data made for it, after the results are recorded.

## 4. Counts and fingerprints to record

Record these at backup time and again on the rehearsal copy:

- number of articles, and how many are visible to players, drafts and DM-only (the last recorded figure in the docs is from 2026-11-12 and is historical only);
- number of article sections, infobox fields and revisions;
- number of media files and Storage objects;
- number of campaign members (by role, and revoked);
- number of Gazette stories by review state;
- number of applied migrations and the last version;
- the data fingerprint from the upgrade script, and the schema comparison result.

## 5. Go and no-go criteria

**Go only if all of these are true:**

- [ ] The complete backup (section 1) exists in permanent private storage, and its checksums match the release record.
- [ ] The restore rehearsal (section 3) succeeded on a disposable target.
- [ ] The restored counts match the summary written at backup time.
- [ ] The bundle applied in order to the restored copy with no failed file.
- [ ] The upgrade comparison (step 6) reports an unchanged data fingerprint and an identical schema and Storage policies to a fresh install.
- [ ] The database suite passes on the rehearsal copy, or every gap is written down and accepted by the owner.
- [ ] The reference-leak sweep shows no leak of DM-only content to a player.
- [ ] The owner has approved the **exact** file list and the exact SHA-256 hashes of the migrations to apply.
- [ ] The rollback route is written down: forward-fix by a new reviewed migration (preferred); restore of the backup to a new project as a last resort, with the data written after the backup re-entered by hand.
- [ ] Any ordering note in the release record has been followed. The known one is that `20261117000500` changes `private.is_member()`, which every membership policy uses.

**No-go if any of these is true:**

- a checksum does not match;
- any table count differs from the backup summary without an explanation the owner accepts;
- a migration file fails or emits an unexpected warning;
- Storage files are missing or their checksums differ;
- a database test or the leak sweep fails;
- the owner's approval is not explicit for the exact files and hashes.

## 6. Who signs off

- **Owner (required):** approves the exact bundle and its hashes, approves the backup location, and approves any deployment that goes with it. This is the rule in the existing release records.
- **Reviewer (required):** checks the go criteria, reads the restore results and the counts, and confirms no credential, project identifier or address appears in the record.
- **Person who ran the rehearsal (required):** records the commands run, the time, the results and any gaps.

The sign-off is recorded in the release record with the date, the file hashes and the checksums of the backup archives. It does not contain any secret.

## 7. After an approved apply

Follow section 6 of `RELEASE-BUNDLE-2026-11-13.md` (read-only checks of the migration history and the schema, then a DM walk-through). Keep the backup until the owner says the release is complete.
