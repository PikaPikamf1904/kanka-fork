# Release runbook: pending bundle (23 migrations) and the website-features build

Nothing in this file has been applied to the hosted project. Every step below that writes to
production needs the owner's explicit approval of this exact release.

## State on 2026-11-17 (verified read-only)

- Hosted project's last applied migration: `20261112001300` (13 applied).
- Pending: 23 files, `20261112001400_article_images.sql` through `20261118000100_dm_gate.sql`
  (22 written by 2026-11-17, plus the DM screen's attempt log).
- Hosted data: 52 articles, 143 sections, 54 DM notes, 20 relations, 313 provenance rows,
  2 members (DM active; the one player row is revoked), 0 media rows, 0 Storage objects.
- The live site (`chronicle-wiki-preview.pages.dev`, production deployment) is the Gazette build
  and works with the current schema. Builds from the newer branches need the pending migrations.

## 1. Backup (read-only)

```
SUPABASE_PROJECT_REF=<ref> bash chronicle-cloud/scripts/export-logical-backup.sh <dir outside the repo>
```

Writes one JSON per table, `auth.users/identities/mfa_factors`, `storage.buckets`, the migration
list, a Storage object inventory and `SHA256SUMS`. If the inventory is not empty, download the
files too. The backup holds private lore and password hashes: keep it in private persistent
storage, never in git. Optionally also take a Dashboard backup (Database > Backups).

## 2. Restore rehearsal (local, disposable)

```
cd chronicle-cloud
PGBIN=/opt/pg17/bin MIGRATIONS_UNTIL=20261112001300 bash scripts/local-stack.sh up
node scripts/restore-logical-backup.mjs <dir>        # must print RESTORE OK
```

Then apply each pending file in order, one transaction each
(`psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -1 -f <file>`) and compare
the data fingerprint before and after. Result on 2026-11-17: restore OK on every table, 22 applied,
fingerprint unchanged, DM reads 52 pages, outsider 0, anonymous refused. Repeated with all 23
files on the same data: identical result.

## 3. Apply to production (needs approval)

1. Fresh backup (step 1) taken minutes before, checksums kept.
2. Optional: switch the maintenance notice on (`MAINTENANCE_MODE=on` in Pages, or the DM switch
   once `…0700` exists).
3. Apply the 23 files in filename order, each in its own transaction, and record each in
   `supabase_migrations.schema_migrations`. Stop at the first error; nothing after it is applied.
   Dry run first (read-only, lists files and SHA-256), then apply:
   ```
   export NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=<ca bundle>   # only when behind a proxy
   SUPABASE_PROJECT_REF=<ref> node chronicle-cloud/scripts/apply-hosted-migrations.mjs --expect 23
   SUPABASE_PROJECT_REF=<ref> node chronicle-cloud/scripts/apply-hosted-migrations.mjs --expect 23 --apply
   ```
4. Read-only checks: `select max(version) from supabase_migrations.schema_migrations` equals
   `20261118000100`; article/section/relation counts equal the backup's; as the DM the site
   lists every page; signed out, `/rest/v1/articles` returns nothing.
5. Pages Production variables (verified present on 2026-11-17: `SUPABASE_URL`,
   `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, secrets
   `SUPABASE_SECRET_KEY` and `IP_HASH_SECRET`). Add the secret `DM_SCREEN_PASSCODE`. Previews carry no
   server secrets, so on a preview the DM sign-in says the DM screen is not set up.
   Deploy: switch the Pages project's production branch to the approved branch, create a deployment on
   it (Dashboard "Retry"/"Create deployment", or `POST .../pages/projects/<name>/deployments` with
   `branch=<approved branch>`), wait for it to finish, then confirm that
   `canonical_deployment.deployment_trigger.metadata.commit_hash` is the approved commit.
6. Walk the DM and player journeys on the live URL; invite one test player and check they see
   only published player pages.

## 4. Rollback

- **Website only:** in Cloudflare Pages, roll back to the previous production deployment
  (the Gazette build). It works against the old schema only, so do this together with the
  database rollback if the migrations were applied.
- **Database, nothing lost since the apply:** every pending migration is additive; each file's
  header names what to drop. Dropping in reverse filename order returns the schema to
  `20261112001300`.
- **Database, data damaged:** restore the backup. Preferred: Supabase point-in-time or Dashboard
  backup restore if the plan includes it. Otherwise restore the logical backup's rows into the
  project with `restore-logical-backup.mjs` pointed at it. The script refuses non-local databases
  by design; restoring production needs a deliberate, reviewed change of that guard, so treat it
  as a last resort and rehearse it locally first.
