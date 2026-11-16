#!/usr/bin/env bash
# Disposable PostgreSQL-only harness. Auth and Storage schemas are stubs, not services.
# This is for SQL tests only; it cannot verify Auth, PostgREST or Storage behavior.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL="$ROOT/.local"
IMAGE='postgres@sha256:f9a7b9ebf6f56201f949db745e47bc423c0f0f8294bafe991cc10bf74b029657'
docker() { env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock "$@"; }

verify_container() {
  [ -d "$LOCAL" ] && [ ! -L "$LOCAL" ] && [ -f "$LOCAL/sql-only-owner" ] && [ ! -L "$LOCAL/sql-only-owner" ] && [ -f "$LOCAL/sql-only-container" ] && [ ! -L "$LOCAL/sql-only-container" ] || { echo 'No owned SQL-only stack found.' >&2; return 1; }
  local owner id actual
  owner="$(cat "$LOCAL/sql-only-owner")"
  id="$(cat "$LOCAL/sql-only-container")"
  [[ "$owner" =~ ^[a-f0-9]{64}$ && "$id" =~ ^[a-f0-9]{64}$ ]] || { echo 'Invalid SQL-only identity.' >&2; return 1; }
  actual="$(docker inspect -f '{{index .Config.Labels "chronicle.sql-only.owner"}}' "$id")"
  [ "$actual" = "$owner" ] || { echo 'Refusing unowned database container.' >&2; return 1; }
  CONTAINER="$id"
}

up() {
  [ ! -e "$LOCAL" ] && [ ! -L "$LOCAL" ] || { echo 'Refusing existing .local directory; inspect it first.' >&2; return 1; }
  docker info >/dev/null
  mkdir -m 700 "$LOCAL"
  openssl rand -hex 32 > "$LOCAL/sql-only-owner"
  openssl rand -hex 32 > "$LOCAL/test-db-marker"
  openssl rand -hex 32 > "$LOCAL/jwt_secret"
  chmod 600 "$LOCAL/sql-only-owner" "$LOCAL/test-db-marker" "$LOCAL/jwt_secret"
  local owner secret anon service file
  owner="$(cat "$LOCAL/sql-only-owner")"
  # No named volumes or host data are mounted. A port conflict fails without affecting its owner.
  docker run -d --rm --name "chronicle-sqlonly-${owner:0:12}" --label "chronicle.sql-only.owner=$owner" \
    --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,size=768m -e POSTGRES_HOST_AUTH_METHOD=trust \
    -e POSTGRES_USER=supabase_admin -p 127.0.0.1:54322:5432 "$IMAGE" > "$LOCAL/sql-only-container"
  chmod 600 "$LOCAL/sql-only-container"
  verify_container
  for _ in $(seq 1 60); do
    if docker exec "$CONTAINER" pg_isready -q -U supabase_admin; then break; fi
    sleep 1
  done
  docker exec "$CONTAINER" pg_isready -q -U supabase_admin
  docker exec -i "$CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q < "$ROOT/supabase/local/sql-only-bootstrap.sql"
  for file in "$ROOT"/supabase/migrations/*.sql; do
    echo "Applying ${file##*/}"
    docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$file"
  done
  docker exec -i "$CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q -v marker="$(cat "$LOCAL/test-db-marker")" <<'SQL'
grant usage on schema extensions to anon, authenticated, service_role;
create schema chronicle_local_test;
create table chronicle_local_test.identity (marker text not null);
insert into chronicle_local_test.identity values (:'marker');
grant usage on schema chronicle_local_test to postgres;
grant select on chronicle_local_test.identity to postgres;
SQL
  secret="$(cat "$LOCAL/jwt_secret")"
  anon="$(node "$ROOT/scripts/mint-local-jwt.mjs" "$secret" anon)"
  service="$(node "$ROOT/scripts/mint-local-jwt.mjs" "$secret" service_role)"
  cat > "$LOCAL/env" <<ENV
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_PUBLISHABLE_KEY=$anon
SUPABASE_SECRET_KEY=$service
DATABASE_URL=postgres://postgres@127.0.0.1:54322/postgres
ENV
  chmod 600 "$LOCAL/env"
  echo 'SQL-only database ready. Do not run service-dependent tests against these stubs.'
}

down() {
  verify_container
  docker rm -f "$CONTAINER" >/dev/null
  echo 'Stopped the owned SQL-only container. Synthetic .local files remain for inspection.'
}
case "${1:-}" in
  up) up ;;
  down) down ;;
  *) echo "usage: $0 up|down" >&2; exit 2 ;;
esac
