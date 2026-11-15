#!/usr/bin/env bash
# Rehearse the production upgrade on the LOCAL disposable stack: migrations up to FROM (production's
# current state), synthetic data shaped like production, then every later migration in order, one
# transaction each. Checks that the data is unchanged and that the schema and Storage policies are
# exactly those of a fresh install. Never connects to a hosted project.
#
#   PGBIN=/path/to/postgresql-17/bin bash scripts/upgrade-simulation.sh [FROM]
#
# FROM defaults to 20261112001300 (the last migration applied to production on 2026-11-15).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
FROM="${1:-20261112001300}"
OUT="$ROOT/.local-upgrade"
rm -rf "$OUT" && mkdir -p "$OUT"
PSQL=(psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -At)
DUMP="${PGBIN:-/usr/lib/postgresql/16/bin}/pg_dump"
schema() { "$DUMP" -h 127.0.0.1 -p 54322 -U postgres -d postgres --schema-only -n public -n private | grep -v '^\\\(un\)\?restrict'; "${PSQL[@]}" -c "select policyname||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,'') from pg_policies where schemaname='storage' order by 1"; }
fingerprint() {
  "${PSQL[@]}" <<'SQL'
select 'data ' || md5(string_agg(x, '|' order by x)) from (
  select format('%s|%s|%s|%s|%s|%s|%s|%s', id, slug, type, title, summary, visibility, status, hero_media_id) x from public.articles
  union all select format('%s|%s|%s|%s|%s', id, article_id, body, visibility, status) from public.article_sections
  union all select format('%s|%s|%s|%s', id, article_id, label, value) from public.infobox_fields
  union all select format('%s|%s', id, path) from public.media
  union all select format('%s|%s|%s|%s', article_id, review_state, reporter, reliability) from public.news_stories
  union all select format('%s|%s', id, snapshot::text) from public.revisions
  union all select format('%s|%s|%s', article_id, kind, reference) from public.provenance
  union all select format('%s|%s|%s', user_id, role, revoked_at) from public.campaign_members) t;
select 'settings ' || md5(format('%s|%s|%s|%s', title, overview, current_location_id, current_status)) from public.campaign_settings;
select 'dm-only pages ' || count(*) filter (where visibility = 'dm') || ' of ' || count(*) || '; news drafts ' || count(*) filter (where type = 'news' and status = 'draft') from public.articles;
SQL
}

echo "1/4 Fresh install of every migration"
bash scripts/local-stack.sh up >/dev/null
schema > "$OUT/schema-fresh.sql"

echo "2/4 Stack at $FROM, with synthetic data shaped like production"
MIGRATIONS_UNTIL="$FROM" bash scripts/local-stack.sh up >/dev/null
bash scripts/local-stack.sh seed >/dev/null
"${PSQL[@]}" <<'SQL'
insert into public.articles (slug, type, title, summary, visibility, status)
select 'zz-upg-' || g, 'lore', 'Synthetic page ' || g, 'Synthetic summary ' || g, 'dm', 'draft' from generate_series(1, 49) g;
insert into public.article_sections (article_id, position, heading, body, visibility, status)
select id, 0, 'Notes', 'Synthetic body for ' || slug, 'dm', 'draft' from public.articles where slug like 'zz-upg-%';
insert into public.articles (slug, type, title, summary, visibility, status)
select 'zz-upg-news-' || g, 'news', 'Synthetic story ' || g, 'Synthetic deck', 'dm', 'draft' from generate_series(1, 3) g;
insert into public.news_stories (article_id, reporter) select id, 'nib' from public.articles where slug like 'zz-upg-news-%';
insert into public.media (path, visibility) values ('media/99999999-9999-4999-8999-999999999991.webp', 'dm');
update public.articles set hero_media_id = (select id from public.media where path like '%99991.webp') where slug = 'zz-upg-1';
insert into public.revisions (article_id, snapshot, note) select id, jsonb_build_object('article', jsonb_build_object('title', title)), 'synthetic' from public.articles where slug = 'zz-upg-2';
insert into public.provenance (article_id, kind, reference) select id, 'dm_confirmed', 'synthetic' from public.articles where slug = 'zz-upg-3';
update public.campaign_settings set current_location_id = (select id from public.articles where slug = 'zz-upg-4'), current_status = 'Synthetic status';
SQL
fingerprint > "$OUT/data-before.txt"

echo "3/4 Applying the later migrations, one transaction each"
for f in supabase/migrations/*.sql; do
  [[ "$(basename "$f")" > "${FROM}_~" ]] || continue
  if "${PSQL[@]}" -1 -f "$f" > "$OUT/apply.log" 2>&1; then echo "  ok   $(basename "$f")"; else echo "  FAIL $(basename "$f")"; cat "$OUT/apply.log"; exit 1; fi
done
"${PSQL[@]}" -c "notify pgrst, 'reload schema'"
fingerprint > "$OUT/data-after.txt"

echo "4/4 Comparing"
status=0
if diff -u "$OUT/data-before.txt" "$OUT/data-after.txt"; then echo "  data unchanged: $(tail -1 "$OUT/data-after.txt")"; else echo "  DATA CHANGED"; status=1; fi
schema > "$OUT/schema-upgraded.sql"
if diff -u "$OUT/schema-fresh.sql" "$OUT/schema-upgraded.sql" > "$OUT/schema.diff"; then echo "  schema and Storage policies identical to a fresh install"; else echo "  SCHEMA DIFFERS (see $OUT/schema.diff)"; status=1; fi
echo "  PostgreSQL $("${PSQL[@]}" -c "show server_version")"
exit $status
