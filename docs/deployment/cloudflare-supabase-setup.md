# Setting up Chronicle on Supabase Free + Cloudflare Pages

**Status (2026-11-09):** the free project `chronicle-wiki` (ref `cqrgdtnvmgnimzxyaiih`,
us-east-1, org "Dnd" on the Free plan) has migrations 1–5 applied (`functions` was run in the
SQL Editor and recorded in the migration history). **Migrations 6, 7 and 8 (`…0600_audit_fixes`, `…0700_media_sync_lock`,
`…0800_rls_performance`) are tested locally only and are NOT applied to the hosted project yet**;
apply all three in order and re-run the live check
before any deployment. Steps 1.3 onwards and section 2 still need the
owner's dashboards. Everything is on free plans; do
not add a payment method. Use synthetic content until you are ready to import real data.

## 1. Supabase project (free)

1. Create a project on the Free plan (region near your players). Save the database password in
   your password manager.
2. **SQL Editor:** run the files in `chronicle-cloud/supabase/migrations/` in order
   (`…0100_core_schema`, `…0200_functions`, `…0300_storage`, `…0400_import_refs`,
   `…0500_hardening`, `…0600_audit_fixes`, `…0700_media_sync_lock`,
   `…0800_rls_performance`). This is the
   tested route. (The Supabase CLI's `supabase db push` also works from `chronicle-cloud/`, but
   needs `supabase init` and `supabase link --project-ref <ref>` first; not tested here.)
3. **Authentication → Sign In / Providers:**
   - Turn **off** "Allow new users to sign up".
   - Turn **off** anonymous sign-ins.
   - Keep Email enabled (the DM signs in with it); confirm email on.
4. **Authentication → URL configuration:** Site URL = `https://<your-project>.pages.dev`.
5. **Authentication → Users → Add user:** your DM email and a long password (auto-confirm).
6. **SQL Editor:** make that user the DM (replace the email):
   ```sql
   insert into public.campaign_members (user_id, role, display_name)
   select id, 'dm', 'Dungeon Master' from auth.users where email = 'you@example.com';
   ```
7. **Project Settings → API Keys:** create a publishable key and a secret key. The publishable key
   goes to the browser; the secret key only to Cloudflare (step 2.4). Never commit either.

## 2. Cloudflare Pages (free)

1. Workers & Pages → Create → Pages → Connect to Git → this repository.
2. Build settings:
   - Production branch: the branch you approve (not merged yet).
   - Root directory: `chronicle-cloud`
   - Build command: `npm ci && npm run build`
   - Output directory: `dist`
3. Build environment variables: `NODE_VERSION=22`, `VITE_SUPABASE_URL=https://<ref>.supabase.co`,
   `VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>`.
4. Settings → Variables and Secrets (Production, type **Secret** where marked):
   - `SUPABASE_URL` = `https://<ref>.supabase.co`
   - `SUPABASE_PUBLISHABLE_KEY` = publishable key
   - `SUPABASE_SECRET_KEY` = secret key (**Secret**)
   - `IP_HASH_SECRET` = 32+ random characters (**Secret**)
   - optional `TURNSTILE_SECRET_KEY` (**Secret**) with a free Turnstile widget (the widget is not
     yet wired into the access screen; leave unset for now)
5. Leave Functions on the free plan's daily limit (fail closed is fine: only enrollment uses it).

## 3. First run

1. Open `https://<project>.pages.dev/sign-in`, sign in as the DM.
2. Wiki settings → set the title and overview; **turn on two-step sign-in**.
3. Player access → create a code (rotate on) and give it to your players.
4. Write or import content (see `docs/migration/kanka-import-plan.md`); publish what players may see.

## 4. Backups (manual, free)

- Database: `supabase db dump --linked -f roles.sql --role-only`, `-f schema.sql`, and
  `--data-only -f data.sql`, or `pg_dump` with the session-pooler connection string. Keep copies
  off-site.
- Images: download the `chronicle-media` bucket (dashboard or CLI); not part of database dumps.

## 5. Pausing

A free project idles out after 7 days without activity. If players see the access screen fail,
open the Supabase dashboard and restore the project (data is kept; restorable for 90 days).

## Local development

```bash
cd chronicle-cloud
npm ci
bash scripts/local-stack.sh up      # PostgreSQL 16 + GoTrue + PostgREST + storage, needs Docker
bash scripts/local-stack.sh seed    # synthetic sample campaign; credentials in .local/dev-credentials
npm test && npm run test:db         # unit and database tests
bash scripts/e2e-local.sh           # build, serve with wrangler pages dev, run Playwright
```
