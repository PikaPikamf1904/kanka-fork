#!/usr/bin/env bash
# Activate a built Kanka release on the server. Run as the "kanka" user.
#
#   release.sh <release.tar.gz> [label]              normal deploy
#   release.sh <release.tar.gz> [label] --first-install
#   release.sh --rollback                            point "current" at the previous release
#   release.sh --list                                show installed releases
#
# Layout: /srv/kanka/{releases/<id>, shared/{.env,storage}, backups, current -> releases/<id>}
# Every step before the symlink switch leaves the live site untouched. A database backup
# is taken before every migration; --rollback switches code only (see deploy/README.md,
# "Undo a bad update", for restoring that backup).
set -euo pipefail

BASE=${KANKA_BASE:-/srv/kanka}
KEEP=${KANKA_KEEP_RELEASES:-3}
HEALTH_BASE=${KANKA_HEALTH_BASE:-http://127.0.0.1}
SUDO=${KANKA_SUDO-sudo -n}

log() { printf '[release] %s\n' "$*"; }

exec 9>"$BASE/.release.lock"
flock -n 9 || { log "another release is running"; exit 1; }

restart_services() {
    if [ -n "${KANKA_SKIP_SERVICES:-}" ]; then
        return
    fi
    $SUDO /usr/bin/systemctl reload php8.4-fpm
    # Running workers finish their current job, exit, and systemd starts them again from
    # the new release. This never interrupts a long map-tiling job halfway.
    (cd "$BASE/current" && php artisan queue:restart --no-interaction >/dev/null)
    # Starts the workers after the first deploy; a no-op when they already run.
    $SUDO /usr/bin/systemctl start kanka-queue kanka-queue-heavy
}

switch_to() {
    ln -sfn "$1" "$BASE/current.tmp"
    mv -Tf "$BASE/current.tmp" "$BASE/current"
    restart_services
}

http_code() {
    curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$1" || true
}

healthy() {
    local up home
    up=$(http_code "$HEALTH_BASE/up")
    home=$(http_code "$HEALTH_BASE/")
    log "health: /up -> $up, / -> $home"
    [ "$up" = "200" ] && [[ "$home" =~ ^(200|301|302)$ ]]
}

previous_release() {
    local active
    active=$(readlink -f "$BASE/current" || true)
    ls -1d "$BASE"/releases/*/ 2>/dev/null | sed 's#/$##' | grep -vx "$active" | sort | tail -n 1
}

case "${1:-}" in
    --list)
        active=$(readlink -f "$BASE/current" 2>/dev/null || true)
        for r in $(ls -1d "$BASE"/releases/*/ 2>/dev/null | sed 's#/$##' | sort); do
            [ "$r" = "$active" ] && echo "* $(basename "$r")  (live)" || echo "  $(basename "$r")"
        done
        exit 0
        ;;
    --rollback)
        target=$(previous_release)
        [ -n "$target" ] || { log "no previous release to roll back to"; exit 1; }
        log "rolling back code to $target (the database is not changed)"
        switch_to "$target"
        healthy || log "warning: health check failed after rollback"
        exit 0
        ;;
esac

tarball=${1:?usage: release.sh <release.tar.gz> [label] [--first-install]}
label=${2:-manual}
first_install=false
[ "${3:-}" = "--first-install" ] && first_install=true

[ -f "$BASE/shared/.env" ] || { log "missing $BASE/shared/.env (run provision.sh first)"; exit 1; }

id="$(date -u +%Y%m%d%H%M%S)-${label//[^A-Za-z0-9._-]/}"
release="$BASE/releases/$id"
log "unpacking into $release"
mkdir -p "$release"
tar -xzf "$tarball" -C "$release"

# Shared, persistent state lives outside the release directory.
storage="$BASE/shared/storage"
mkdir -p "$storage"/{app/public,app/s3,app/exports,app/imports,framework/cache/data,framework/sessions,framework/views,logs}
# Exports, imports, sessions and logs are never readable by the web server.
chmod 700 "$storage/app/s3" "$storage/app/exports" "$storage/app/imports" "$storage/framework" "$storage/logs"
# nginx (group www-data) may only walk through to app/public, the uploaded images.
chgrp www-data "$storage" "$storage/app"
chmod 750 "$storage" "$storage/app"
chmod 755 "$storage/app/public"
rm -rf "$release/storage"
ln -s "$storage" "$release/storage"
ln -sfn "$BASE/shared/.env" "$release/.env"
ln -sfn ../storage/app/public "$release/public/storage"

cd "$release"
artisan() { php artisan "$@" --no-interaction; }

if [ ! -f "$storage/oauth-private.key" ]; then
    log "generating Passport keys"
    artisan passport:keys
    chmod 600 "$storage"/oauth-*.key
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
    log "health check failed"
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
