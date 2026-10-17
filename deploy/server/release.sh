#!/usr/bin/env bash
# Activate a built Kanka release on the server. Run as the "kanka" user.
#
#   release.sh <release.tar.gz> [label]              normal deploy
#   release.sh <release.tar.gz> [label] --first-install
#   release.sh --rollback                            point "current" at the previous release
#   release.sh --reload                              apply edits to shared/.env (no new code)
#   release.sh --list                                show installed releases
#
# Layout: /srv/kanka/{releases/<id>, shared/{.env,storage}, backups, current -> releases/<id>}
# Every step before the symlink switch leaves the live site untouched. A database backup
# is taken before every migration; --rollback switches code only (see deploy/README.md,
# "Undo a bad update", for restoring that backup).
set -euo pipefail

BASE=${KANKA_BASE:-/srv/kanka}
KEEP=${KANKA_KEEP_RELEASES:-3}
# The live release and the one before it (for --rollback) are always kept.
[[ "$KEEP" =~ ^[0-9]+$ ]] && [ "$KEEP" -ge 2 ] || { echo "KANKA_KEEP_RELEASES must be a number of at least 2"; exit 1; }
HEALTH_BASE=${KANKA_HEALTH_BASE:-http://127.0.0.1}
SUDO=${KANKA_SUDO-sudo -n}

log() { printf '[release] %s\n' "$*"; }

# Files written as root (the lock, caches) would block every later deploy by "kanka".
if [ "$(id -u)" -eq 0 ]; then
    echo "Run this as the kanka user: sudo -u kanka $(basename "$0") $*"
    exit 1
fi

exec 9>"$BASE/.release.lock"
flock -n 9 || { log "another release is running"; exit 1; }

restart_services() {
    if [ -n "${KANKA_SKIP_SERVICES:-}" ]; then
        return
    fi
    # Frees PHP memory held for the old release; requests already use the new path.
    $SUDO /usr/bin/systemctl reload php8.4-fpm || log "warning: could not reload PHP-FPM"
    # Running workers finish their current job, exit, and systemd starts them again from
    # the new release. This never interrupts a long map-tiling job halfway.
    (cd "$BASE/current" && php artisan queue:restart --no-interaction >/dev/null)
    # Starts the workers after the first deploy; a no-op when they already run.
    $SUDO /usr/bin/systemctl start kanka-queue kanka-queue-heavy || log "warning: could not start the queue workers"
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

# Migrations recorded in the database, one per line, read with the given release's code.
db_migrations() {
    (cd "$1" && php -r '
        require "vendor/autoload.php";
        $app = require "bootstrap/app.php";
        $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
        foreach (Illuminate\Support\Facades\DB::table("migrations")->orderBy("migration")->pluck("migration") as $m) {
            echo $m, "\n";
        }')
}

# Migrations the database has but the release in $1 never ran. Each release records the
# migrations present once it went live (.migrations); older releases have no record.
newer_migrations() {
    [ -f "$1/.migrations" ] || { echo "(unknown: $(basename "$1") has no migration record)"; return; }
    comm -23 <(db_migrations "$BASE/current" | sort) <(sort "$1/.migrations")
}

# The newest backup archive, checked to hold a non-empty database dump. Entry names and
# sizes are readable without the archive password.
newest_db_backup() {
    local archive
    archive=$(ls -1t "$BASE"/backups/*/*.zip 2>/dev/null | head -n 1)
    [ -n "$archive" ] || return 1
    php -r '
        $zip = new ZipArchive();
        if ($zip->open($argv[1]) !== true) { exit(1); }
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $s = $zip->statIndex($i);
            if (str_starts_with($s["name"], "db-dumps/") && $s["size"] > 0) { exit(0); }
        }
        exit(1);' "$archive" || return 1
    echo "$archive"
}

# Rows in the migrations table (0 when the table does not exist yet), read with the given
# release's code. Used to refuse --first-install on a database that already holds Kanka.
db_migration_count() {
    # Warnings go to stderr so that stdout holds only the number.
    (cd "$1" && php -d display_errors=stderr -r '
        require "vendor/autoload.php";
        $app = require "bootstrap/app.php";
        $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
        echo Illuminate\Support\Facades\Schema::hasTable("migrations")
            ? Illuminate\Support\Facades\DB::table("migrations")->count() : 0;')
}

# Shown when --first-install is refused: the usual cause is a first install that stopped
# partway (migrations ran, or the health check failed with nothing to fall back to).
first_install_hint() {
    log "if an earlier first install stopped partway and nobody has used the site yet, see"
    log "\"First install stopped partway\" in deploy/README.md. Never do that once real data exists."
}

restore_hint() {
    log "the database has migrations this code never ran:"
    sed 's/^/[release]   /' <<<"$1"
    if [ -f "$2/.pre-migrate-backup" ]; then
        log "to put the database back as it was before that update (as root):"
        log "  kanka-restore $(cat "$2/.pre-migrate-backup") --db-only"
    fi
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
        extra=$(newer_migrations "$target")
        if [ -n "$extra" ] && [ "${2:-}" != "--force" ]; then
            restore_hint "$extra" "$(readlink -f "$BASE/current")"
            log "rolling back the code alone could break the site. Not rolling back."
            log "restore the database first, or run again with --rollback --force"
            exit 1
        fi
        log "rolling back code to $target (the database is not changed)"
        switch_to "$target"
        healthy || log "warning: health check failed after rollback"
        exit 0
        ;;
    --reload)
        [ -e "$BASE/current" ] || { log "no release is live yet"; exit 1; }
        log "re-reading $BASE/shared/.env"
        (cd "$BASE/current" && php artisan config:cache --no-interaction >/dev/null)
        restart_services
        healthy || { log "health check failed: check the last .env change"; exit 1; }
        exit 0
        ;;
esac

tarball=${1:?usage: release.sh <release.tar.gz> [label] [--first-install]}
label=${2:-manual}
first_install=false
[ "${3:-}" = "--first-install" ] && first_install=true

[ -f "$BASE/shared/.env" ] || { log "missing $BASE/shared/.env (run provision.sh first)"; exit 1; }
[ -f "$tarball" ] || { log "no such archive: $tarball"; exit 1; }
if $first_install && [ -e "$BASE/current" ]; then
    log "a release is already live; --first-install is only for the very first deploy. Not deploying."
    first_install_hint
    exit 1
fi

# build-release.sh writes <archive>.sha256 next to the archive; check it when it came along.
if [ -f "$tarball.sha256" ]; then
    expected=$(awk '{print $1; exit}' "$tarball.sha256")
    actual=$(sha256sum "$tarball" | awk '{print $1}')
    [ "$expected" = "$actual" ] || { log "checksum mismatch for $tarball; the upload is damaged. Not deploying."; exit 1; }
    log "checksum ok"
fi

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
rm -rf "$release/public/storage"
ln -s ../storage/app/public "$release/public/storage"

cd "$release"
artisan() { php artisan "$@" --no-interaction; }

if [ ! -f "$storage/oauth-private.key" ]; then
    log "generating Passport keys"
    # umask: the private key is never readable by others, not even for a moment.
    (umask 077 && artisan passport:keys)
    chmod 600 "$storage"/oauth-*.key
fi

if $first_install; then
    # Seeding a database that already holds Kanka would add duplicate reference data, and
    # there would be no backup first. Only an empty database gets the first-install path.
    count=$(db_migration_count "$release") || { log "could not read the database; check $BASE/shared/.env"; rm -rf "$release"; exit 1; }
    [[ "$count" =~ ^[0-9]+$ ]] || { log "could not count migrations (got: $count). Not deploying."; rm -rf "$release"; exit 1; }
    if [ "$count" != "0" ]; then
        log "the database already has $count migrations; --first-install is only for an empty database."
        log "deploy without --first-install (that path backs the database up first). Not deploying."
        first_install_hint
        rm -rf "$release"
        exit 1
    fi
    log "first install: migrating and seeding reference data"
    artisan migrate --force
    artisan db:seed --force
else
    log "backing up the database before migrating"
    artisan backup:run --only-db --disable-notifications
    # Never migrate without a backup that is known to hold the database.
    pre_backup=$(newest_db_backup) || { log "the backup has no database dump; not migrating"; exit 1; }
    echo "$pre_backup" > "$release/.pre-migrate-backup"
    log "backup: $pre_backup"
    artisan migrate --force
fi
db_migrations "$release" > "$release/.migrations"

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
        log "switching back to $previous"
        switch_to "$previous"
        extra=$(newer_migrations "$previous")
        [ -z "$extra" ] || restore_hint "$extra" "$release"
    fi
    exit 1
fi
log "health check passed"

# Keep the newest $KEEP releases.
ls -1d "$BASE"/releases/*/ | sed 's#/$##' | sort | head -n -"$KEEP" | while read -r old; do
    [ "$old" = "$(readlink -f "$BASE/current")" ] || rm -rf "$old"
done
log "done: $id"
