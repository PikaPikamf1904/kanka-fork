#!/usr/bin/env bash
# Local Supabase subset for development and tests: PostgreSQL 16 + GoTrue (Auth) + PostgREST
# (Data API) + storage-api, behind a small gateway on http://127.0.0.1:54321 that mimics the
# hosted URL layout (/auth/v1, /rest/v1, /storage/v1).
#
# Everything lives in chronicle-cloud/.local and is disposable. This script never connects to a
# hosted Supabase project and never touches the Kanka application or its data.
#
#   scripts/local-stack.sh up      # wipe .local and start a fresh stack
#   scripts/local-stack.sh seed    # load synthetic sample content (no real campaign data)
#   scripts/local-stack.sh down    # stop everything (keeps .local for inspection)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL="$ROOT/.local"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PG_PORT=54322
GATEWAY_PORT=54321
AUTH_PORT=54331
REST_PORT=54330
STORAGE_PORT=54332
# Official Supabase init scripts, pinned.
SUPABASE_POSTGRES_REPO=https://github.com/supabase/postgres.git
SUPABASE_POSTGRES_COMMIT=c6226c6
GOTRUE_IMAGE=supabase/gotrue:v2.177.0
POSTGREST_IMAGE=postgrest/postgrest:v12.2.12
STORAGE_IMAGE=supabase/storage-api:v1.25.7

psql_as() { psql -h 127.0.0.1 -p "$PG_PORT" -U "$1" -d postgres -v ON_ERROR_STOP=1 -q "${@:2}"; }

wait_http() {
  for _ in $(seq 1 60); do
    if curl -fs -o /dev/null "$1"; then return 0; fi
    sleep 1
  done
  echo "Timed out waiting for $1" >&2
  return 1
}

down() {
  docker rm -f chronicle-gotrue chronicle-rest chronicle-storage >/dev/null 2>&1 || true
  if [ -f "$LOCAL/gateway.pid" ]; then kill "$(cat "$LOCAL/gateway.pid")" 2>/dev/null || true; rm -f "$LOCAL/gateway.pid"; fi
  if [ -d "$LOCAL/pg" ]; then su postgres -c "$PGBIN/pg_ctl -D $LOCAL/pg -m fast stop" >/dev/null 2>&1 || true; fi
}

up() {
  down
  rm -rf "$LOCAL/pg" "$LOCAL/storage-files" "$LOCAL/env"
  mkdir -p "$LOCAL/pg" "$LOCAL/storage-files"
  chown postgres:postgres "$LOCAL/pg"
  chmod 700 "$LOCAL/pg"

  # Local-only JWT secret; regenerated with each fresh stack.
  openssl rand -hex 32 > "$LOCAL/jwt_secret"
  chmod 600 "$LOCAL/jwt_secret"
  local secret anon service
  secret="$(cat "$LOCAL/jwt_secret")"
  anon="$(node "$ROOT/scripts/mint-local-jwt.mjs" "$secret" anon)"
  service="$(node "$ROOT/scripts/mint-local-jwt.mjs" "$secret" service_role)"

  echo "Starting PostgreSQL on $PG_PORT"
  su postgres -c "$PGBIN/initdb -D $LOCAL/pg -U supabase_admin --auth=trust -E UTF8 --locale=C.UTF-8" >/dev/null
  su postgres -c "$PGBIN/pg_ctl -D $LOCAL/pg -o '-p $PG_PORT -k /tmp -c listen_addresses=127.0.0.1' -l $LOCAL/pg/server.log -w start" >/dev/null

  if [ ! -d "$LOCAL/supabase-postgres" ]; then
    git clone -q --filter=blob:none --sparse "$SUPABASE_POSTGRES_REPO" "$LOCAL/supabase-postgres"
    git -C "$LOCAL/supabase-postgres" sparse-checkout set migrations/db/init-scripts >/dev/null
  fi
  git -C "$LOCAL/supabase-postgres" checkout -q "$SUPABASE_POSTGRES_COMMIT"

  psql_as supabase_admin -c "create role postgres login createrole createdb"
  for f in "$LOCAL"/supabase-postgres/migrations/db/init-scripts/0000000000000*.sql; do
    psql_as supabase_admin -f "$f" 2>&1 | grep -v -E 'wal_level|HINT' || true
  done
  psql_as supabase_admin -f "$ROOT/supabase/local/bootstrap-local.sql"

  echo "Starting Auth (GoTrue) on $AUTH_PORT"
  # Sign-ups are disabled, as in production: players are created only by the enrollment
  # function, and the DM account is created by hand.
  docker run -d --name chronicle-gotrue --network host \
    -e GOTRUE_API_HOST=127.0.0.1 -e PORT="$AUTH_PORT" \
    -e API_EXTERNAL_URL="http://127.0.0.1:$GATEWAY_PORT/auth/v1" \
    -e GOTRUE_DB_DRIVER=postgres \
    -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin@127.0.0.1:$PG_PORT/postgres?sslmode=disable" \
    -e GOTRUE_SITE_URL=http://127.0.0.1:5173 -e GOTRUE_DISABLE_SIGNUP=true \
    -e GOTRUE_JWT_ADMIN_ROLES=service_role -e GOTRUE_JWT_AUD=authenticated \
    -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_SECRET="$secret" \
    -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=false \
    -e GOTRUE_MAILER_AUTOCONFIRM=true \
    -e GOTRUE_MFA_TOTP_ENROLL_ENABLED=true -e GOTRUE_MFA_TOTP_VERIFY_ENABLED=true \
    -e GOTRUE_RATE_LIMIT_TOKEN_REFRESH=1000 -e GOTRUE_RATE_LIMIT_VERIFY=1000 \
    "$GOTRUE_IMAGE" >/dev/null
  wait_http "http://127.0.0.1:$AUTH_PORT/health"

  echo "Starting Storage on $STORAGE_PORT"
  docker run -d --name chronicle-storage --network host -v "$LOCAL/storage-files:/var/lib/storage" \
    -e ANON_KEY="$anon" -e SERVICE_KEY="$service" -e AUTH_JWT_SECRET="$secret" -e PGRST_JWT_SECRET="$secret" \
    -e DATABASE_URL="postgres://supabase_storage_admin@127.0.0.1:$PG_PORT/postgres" -e DB_INSTALL_ROLES=false \
    -e FILE_SIZE_LIMIT=52428800 -e STORAGE_BACKEND=file -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage \
    -e TENANT_ID=stub -e REGION=local -e GLOBAL_S3_BUCKET=stub -e ENABLE_IMAGE_TRANSFORMATION=false \
    -e SERVER_PORT="$STORAGE_PORT" -e PORT="$STORAGE_PORT" -e SERVER_HOST=127.0.0.1 \
    "$STORAGE_IMAGE" >/dev/null
  wait_http "http://127.0.0.1:$STORAGE_PORT/status"

  psql_as supabase_admin -f "$ROOT/supabase/local/post-services-local.sql"

  echo "Applying Chronicle migrations as the postgres role"
  for f in "$ROOT"/supabase/migrations/*.sql; do
    psql_as postgres -f "$f" 2>&1 | grep -v -E 'already exists, skipping' || true
  done
  # Fail loudly if any migration did not apply.
  psql_as postgres -Atc "select to_regprocedure('public.complete_enrollment(uuid,uuid,text)') is not null" | grep -q t

  echo "Starting Data API (PostgREST) on $REST_PORT"
  docker run -d --name chronicle-rest --network host \
    -e PGRST_DB_URI="postgres://authenticator@127.0.0.1:$PG_PORT/postgres" \
    -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$secret" \
    -e PGRST_DB_USE_LEGACY_GUCS=false -e PGRST_SERVER_PORT="$REST_PORT" -e PGRST_SERVER_HOST=127.0.0.1 \
    "$POSTGREST_IMAGE" >/dev/null
  wait_http "http://127.0.0.1:$REST_PORT/"

  cat > "$LOCAL/env" <<EOF
# Local stack only. These keys are minted from a random local secret and are worthless elsewhere.
SUPABASE_URL=http://127.0.0.1:$GATEWAY_PORT
SUPABASE_PUBLISHABLE_KEY=$anon
SUPABASE_SECRET_KEY=$service
DATABASE_URL=postgres://postgres@127.0.0.1:$PG_PORT/postgres
EOF
  chmod 600 "$LOCAL/env"

  echo "Starting gateway on $GATEWAY_PORT"
  nohup node "$ROOT/scripts/local-gateway.mjs" > "$LOCAL/gateway.log" 2>&1 &
  echo $! > "$LOCAL/gateway.pid"
  wait_http "http://127.0.0.1:$GATEWAY_PORT/auth/v1/health"
  echo "Local stack ready. Settings in $LOCAL/env"
}

seed() {
  # shellcheck disable=SC1091
  . "$LOCAL/env"
  node "$ROOT/scripts/seed-local.mjs"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  seed) seed ;;
  *) echo "usage: $0 up|down|seed" >&2; exit 2 ;;
esac
