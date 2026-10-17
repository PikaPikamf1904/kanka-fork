#!/usr/bin/env bash
# Activate a built Kanka release on the server. Run as the "kanka" user.
#
#   release.sh <release.tar.gz> [label]              normal deploy
#   release.sh <release.tar.gz> [label] --first-install
#   release.sh --rollback                            point "current" at the previous release
#
# Layout: /srv/kanka/{releases/<id>, shared/{.env,storage}, current -> releases/<id>}
# Every step before the symlink switch leaves the live site untouched.
set -euo pipefail

BASE=${KANKA_BASE:-/srv/kanka}
KEEP=${KANKA_KEEP_RELEASES:-3}
HEALTH_URL=${KANKA_HEALTH_URL:-http://127.0.0.1/}
SUDO=${KANKA_SUDO-sudo -n}

log() { printf '[release] %s\n' "$*"; }

restart_services() {
    if [ -n "${KANKA_SKIP_SERVICES:-}" ]; then
        return
    fi
    $SUDO /usr/bin/systemctl reload php8.4-fpm
    $SUDO /usr/bin/systemctl restart kanka-queue
}

switch_to() {
    ln -sfn "$1" "$BASE/current.tmp"
    mv -Tf "$BASE/current.tmp" "$BASE/current"
    restart_services
}

healthy() {
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$HEALTH_URL" || true)
    [[ "$code" =~ ^(200|301|302)$ ]]
}

previous_release() {
    local active
    active=$(readlink -f "$BASE/current" || true)
    ls -1d "$BASE"/releases/*/ 2>/dev/null | sed 's#/$##' | grep -vx "$active" | sort | tail -n 1
}

if [ "${1:-}" = "--rollback" ]; then
    target=$(previous_release)
    [ -n "$target" ] || { log "no previous release to roll back to"; exit 1; }
    log "rolling back to $target"
    switch_to "$target"
    exit 0
fi

tarball=${1:?usage: release.sh <release.tar.gz> [label] [--first-install]}
label=${2:-manual}
first_install=false
[ "${3:-}" = "--first-install" ] && first_install=true

[ -f "$BASE/shared/.env" ] || { log "missing $BASE/shared/.env"; exit 1; }

id="$(date -u +%Y%m%d%H%M%S)-${label//[^A-Za-z0-9._-]/}"
release="$BASE/releases/$id"
log "unpacking into $release"
mkdir -p "$release"
tar -xzf "$tarball" -C "$release"

# Shared, persistent state lives outside the release directory.
mkdir -p "$BASE/shared/storage"/{app/public,app/s3,framework/cache/data,framework/sessions,framework/views,logs}
rm -rf "$release/storage"
ln -s "$BASE/shared/storage" "$release/storage"
ln -sfn "$BASE/shared/.env" "$release/.env"
ln -sfn ../storage/app/public "$release/public/storage"

cd "$release"
artisan() { php artisan "$@" --no-interaction; }

if [ ! -f "$BASE/shared/storage/oauth-private.key" ]; then
    log "generating Passport keys"
    artisan passport:keys
fi

if $first_install; then
    log "first install: migrating and seeding reference data"
    artisan migrate --force
    artisan db:seed --force
else
    log "backing up the database before migrating"
    artisan backup:run --only-db --disable-notifications
    artisan migrate --force
fi

artisan config:cache
artisan route:cache
artisan view:cache
artisan event:cache

previous=$(readlink -f "$BASE/current" 2>/dev/null || true)
log "switching current -> $release"
switch_to "$release"

if ! healthy; then
    log "health check failed for $HEALTH_URL"
    if [ -n "$previous" ] && [ -d "$previous" ]; then
        log "restoring $previous (database migrations are not reverted)"
        switch_to "$previous"
    fi
    exit 1
fi
log "health check passed"

# Keep the newest $KEEP releases.
ls -1d "$BASE"/releases/*/ | sed 's#/$##' | sort | head -n -"$KEEP" | while read -r old; do
    [ "$old" = "$(readlink -f "$BASE/current")" ] || rm -rf "$old"
done
log "done: $id"
