#!/usr/bin/env bash
# Read-only logical backup of a hosted Chronicle project through the Supabase Management API.
#
#   SUPABASE_PROJECT_REF=<ref> bash scripts/export-logical-backup.sh <empty-output-dir>
#
# Writes one JSON file per table (public.*, auth.users, auth.identities, auth.mfa_factors,
# storage.buckets), the applied migration list (migrations.json) and a Storage object inventory
# (storage.objects.json, metadata only). Every query is sent with read_only=true. It never writes
# to the project.
#
# Authentication: SUPABASE_ACCESS_TOKEN (a personal access token) if set; otherwise the request is
# sent without one, for environments whose network proxy adds it. The token is never printed.
#
# The output contains private campaign content and password hashes. Keep it out of git (write it
# outside the repository), store it in private persistent storage, and prove it with
# `node scripts/restore-logical-backup.mjs <dir>` against the local stack.
# Storage object FILES are not downloaded by this script; if storage.objects.json is not empty,
# download them separately (Dashboard > Storage, or the Storage API) before any migration.
set -euo pipefail

out="${1:?usage: SUPABASE_PROJECT_REF=<ref> bash scripts/export-logical-backup.sh <empty-output-dir>}"
ref="${SUPABASE_PROJECT_REF:?set SUPABASE_PROJECT_REF}"
[[ "$ref" =~ ^[a-z0-9]{20}$ ]] || { echo "SUPABASE_PROJECT_REF does not look like a project ref" >&2; exit 2; }
mkdir -p "$out"
if [ -n "$(ls -A "$out")" ]; then echo "$out is not empty; refusing to mix backups" >&2; exit 2; fi
case "$(cd "$out" && pwd)" in "$(git rev-parse --show-toplevel 2>/dev/null || echo /nonexistent)"*) echo "refusing to write a backup inside the git repository" >&2; exit 2;; esac

auth=()
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] && auth=(-H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}")

query() { # $1 = SQL, $2 = output file
  local body
  body=$(python3 -c 'import json,sys; print(json.dumps({"query": sys.argv[1], "read_only": True}))' "$1")
  curl -sS --fail-with-body -X POST "https://api.supabase.com/v1/projects/${ref}/database/query" \
    -H 'Content-Type: application/json' "${auth[@]}" -d "$body" -o "$2"
}

query "select table_schema || '.' || table_name as t from information_schema.tables
       where table_type = 'BASE TABLE' and (table_schema = 'public'
         or (table_schema = 'auth' and table_name in ('users', 'identities', 'mfa_factors'))
         or (table_schema = 'storage' and table_name = 'buckets'))
       order by 1" "$out/.tables.json"
tables=$(python3 -c 'import json,sys; print("\n".join(r["t"] for r in json.load(open(sys.argv[1]))))' "$out/.tables.json")
rm "$out/.tables.json"

for t in $tables; do
  [[ "$t" =~ ^[a-z_]+\.[a-z_]+$ ]] || { echo "unexpected table name" >&2; exit 1; }
  s=${t%%.*}; n=${t#*.}
  query "select coalesce(json_agg(x), '[]'::json) as rows from \"$s\".\"$n\" x" "$out/$t.json"
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(sys.argv[2] + ":", len(d[0]["rows"]), "rows")' "$out/$t.json" "$t"
done

query "select version, name from supabase_migrations.schema_migrations order by version" "$out/migrations.json"
query "select bucket_id, name, (metadata->>'size')::bigint as bytes, created_at from storage.objects order by 1, 2" "$out/storage.objects.json"
python3 -c 'import json,sys; print("migrations:", len(json.load(open(sys.argv[1]))), " storage objects:", len(json.load(open(sys.argv[2]))))' "$out/migrations.json" "$out/storage.objects.json"
( cd "$out" && sha256sum ./*.json > SHA256SUMS )
echo "backup written to $out (checksums in SHA256SUMS). Next: node scripts/restore-logical-backup.mjs $out"
