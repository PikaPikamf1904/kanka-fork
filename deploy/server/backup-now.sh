#!/usr/bin/env bash
# Take an encrypted backup right now (the scheduler already does this at 02:00 and 14:00).
# Installed as "kanka-backup" by provision.sh. Run as kanka or root:
#
#   kanka-backup             database + uploaded files
#   kanka-backup --db-only   database only (quick, e.g. before a risky change)
#   kanka-backup --list      show existing backups
#
# Archives land in /srv/kanka/backups/<APP_NAME>/ and open only with BACKUP_ARCHIVE_PASSWORD.
set -euo pipefail

BASE=${KANKA_BASE:-/srv/kanka}
APP_USER=kanka

[ -e "$BASE/current/artisan" ] || { echo "No release is installed yet (nothing to back up)."; exit 1; }

as_app() {
    if [ "$(id -un)" = "$APP_USER" ]; then
        (cd "$BASE/current" && "$@")
    else
        (cd "$BASE/current" && runuser -u "$APP_USER" -- "$@")
    fi
}

case "${1:-}" in
    --list)
        as_app php artisan backup:list --no-interaction
        ;;
    --db-only)
        as_app php artisan backup:run --only-db --disable-notifications --no-interaction
        ;;
    "")
        as_app php artisan backup:run --disable-notifications --no-interaction
        ;;
    *)
        sed -n '2,9p' "$0"
        exit 1
        ;;
esac
