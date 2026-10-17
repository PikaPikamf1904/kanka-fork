#!/usr/bin/env bash
# Restore Kanka from one of its encrypted backup archives. Installed as "kanka-restore" by
# provision.sh. Run as root:
#
#   kanka-restore --list
#   kanka-restore <archive.zip>                  check the archive and show what would happen
#   kanka-restore <archive.zip> --yes            restore the database and uploaded files
#   kanka-restore <archive.zip> --yes --db-only  restore the database only
#   kanka-restore <archive.zip> --ask-password   archive made with a different password
#
# Order of work: unpack and check the archive (site untouched), maintenance mode, stop
# workers and scheduler, keep a copy of the current database and uploads ("pre-restore"),
# load the archive's database into a scratch database, swap it in, swap the uploads in,
# run any newer migrations, and bring the site back. If anything fails before the swap,
# the site comes back unchanged.
set -euo pipefail

BASE=${KANKA_BASE:-/srv/kanka}
APP_USER=kanka
ENV_FILE=$BASE/shared/.env
STORAGE=$BASE/shared/storage
BACKUPS=$BASE/backups

log() { printf '[restore] %s\n' "$*"; }
die() { printf '[restore] ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root (sudo kanka-restore ..., or 'su -' first)"
[ -f "$ENV_FILE" ] || die "missing $ENV_FILE (run provision.sh first)"

env_value() {
    grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

if [ "${1:-}" = "--list" ]; then
    find "$BACKUPS" -name '*.zip' -printf '%TY-%Tm-%Td %TH:%TM  %10s bytes  %p\n' 2>/dev/null | sort
    exit 0
fi

archive=${1:-}
[ -n "$archive" ] && [ "${archive:0:2}" != "--" ] || { sed -n '2,10p' "$0"; exit 1; }
[ -f "$archive" ] || die "no such file: $archive"
archive=$(readlink -f "$archive")
shift

confirmed=false
db_only=false
ask_password=false
for arg in "$@"; do
    case "$arg" in
        --yes) confirmed=true ;;
        --db-only) db_only=true ;;
        --ask-password) ask_password=true ;;
        *) die "unknown option $arg" ;;
    esac
done

db_name=$(env_value DB_DATABASE)
db_user=$(env_value DB_USERNAME)
[ -n "$db_name" ] && [ -n "$db_user" ] || die "DB_DATABASE / DB_USERNAME missing in $ENV_FILE"

if $ask_password; then
    read -rsp "Backup archive password: " KANKA_ZIP_PASSWORD
    echo
else
    KANKA_ZIP_PASSWORD=$(env_value BACKUP_ARCHIVE_PASSWORD)
fi
export KANKA_ZIP_PASSWORD

ts=$(date +%Y%m%d-%H%M%S)
work="$BASE/restore-tmp/$ts"
install -d -m 700 "$BASE/restore-tmp" "$work"

stage=prepare
finish() {
    status=$?
    unset KANKA_ZIP_PASSWORD
    case "$stage" in
        prepare)
            rm -rf "$work"
            ;;
        offline)
            log "nothing was changed; bringing the site back"
            bring_up || true
            rm -rf "$work"
            ;;
        swapping)
            log "STOPPED HALFWAY. The site stays in maintenance mode."
            log "Copies of the data from before the restore:"
            log "  database: $BACKUPS/pre-restore-$ts.sql.gz"
            $db_only || log "  uploads:  $STORAGE/app/public.pre-restore-$ts"
            log "Unpacked archive kept in $work. See deploy/README.md, 'Restore went wrong'."
            ;;
    esac
    exit "$status"
}
trap finish EXIT

artisan() { (cd "$BASE/current" && runuser -u "$APP_USER" -- php artisan "$@" --no-interaction); }

bring_up() {
    if [ -e "$BASE/current/artisan" ]; then
        artisan up >/dev/null || true
    fi
    systemctl start kanka-queue kanka-queue-heavy kanka-scheduler.timer
}

log "unpacking $archive"
# PHP's zip extension reads the AES-encrypted archives spatie/laravel-backup writes, so no
# extra tools are needed. Entry names are checked so nothing lands outside $work.
php -d memory_limit=512M -r '
    $zip = new ZipArchive();
    if ($zip->open($argv[1]) !== true) { fwrite(STDERR, "cannot open archive\n"); exit(2); }
    $password = getenv("KANKA_ZIP_PASSWORD");
    if ($password !== false && $password !== "") { $zip->setPassword($password); }
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $name = $zip->getNameIndex($i);
        if ($name === false || str_starts_with($name, "/") || preg_match("#(^|/)\.\.(/|$)#", $name)) {
            fwrite(STDERR, "unsafe entry in archive\n"); exit(3);
        }
    }
    if (! $zip->extractTo($argv[2])) {
        fwrite(STDERR, "could not extract (wrong password?): " . $zip->getStatusString() . "\n"); exit(4);
    }
' "$archive" "$work" || die "could not unpack the archive"

shopt -s nullglob
dumps=("$work"/db-dumps/*.sql.gz "$work"/db-dumps/*.sql)
shopt -u nullglob
[ "${#dumps[@]}" -eq 1 ] || die "expected one database dump in the archive, found ${#dumps[@]}"
dump=${dumps[0]}
case "$dump" in
    *.gz) gzip -t "$dump" || die "the database dump is damaged" ;;
esac

uploads=""
if [ -d "$work/public" ]; then
    uploads="$work/public"
else
    # Archives made before uploads were stored as "public/..." keep the full server path.
    uploads=$(find "$work" -type d -path '*/storage/app/public' -print -quit)
fi
if ! $db_only && [ -z "$uploads" ]; then
    log "this archive has no uploaded files; only the database will be restored"
    db_only=true
fi

log "archive contents:"
log "  database dump: ${dump#"$work"/} ($(du -h "$dump" | cut -f1))"
$db_only || log "  uploaded files: $(find "$uploads" -type f | wc -l) files ($(du -sh "$uploads" | cut -f1))"

if ! $confirmed; then
    log "check only. To replace the live wiki with this backup, run again with --yes."
    exit 0
fi

stage=offline
log "maintenance mode on; stopping workers and scheduler"
if [ -e "$BASE/current/artisan" ]; then
    artisan down --retry=60 >/dev/null
fi
systemctl stop kanka-scheduler.timer kanka-queue kanka-queue-heavy

log "saving the current database to $BACKUPS/pre-restore-$ts.sql.gz"
(umask 077 && mariadb-dump --single-transaction --skip-lock-tables "$db_name" | gzip > "$BACKUPS/pre-restore-$ts.sql.gz")
chown "$APP_USER:$APP_USER" "$BACKUPS/pre-restore-$ts.sql.gz"

scratch="${db_name}_restore"
log "loading the backup into the scratch database $scratch"
mariadb -e "DROP DATABASE IF EXISTS \`$scratch\`; CREATE DATABASE \`$scratch\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
case "$dump" in
    *.gz) gunzip -c "$dump" | mariadb "$scratch" ;;
    *) mariadb "$scratch" < "$dump" ;;
esac
tables=$(mariadb -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$scratch'")
[ "$tables" -gt 0 ] || die "the backup's database is empty"

stage=swapping
log "swapping in the restored database ($tables tables)"
mariadb -e "DROP DATABASE \`$db_name\`; CREATE DATABASE \`$db_name\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
renames=$(mariadb -N -e "SET SESSION group_concat_max_len = 4194304; SELECT GROUP_CONCAT(CONCAT('\`$scratch\`.\`', table_name, '\` TO \`$db_name\`.\`', table_name, '\`') SEPARATOR ', ') FROM information_schema.tables WHERE table_schema='$scratch'")
mariadb -e "RENAME TABLE $renames;"
mariadb -e "DROP DATABASE \`$scratch\`; GRANT ALL PRIVILEGES ON \`$db_name\`.* TO '$db_user'@'localhost'; FLUSH PRIVILEGES;"

if ! $db_only; then
    log "swapping in the restored uploads (old ones kept in app/public.pre-restore-$ts)"
    mv "$STORAGE/app/public" "$STORAGE/app/public.pre-restore-$ts"
    mv "$uploads" "$STORAGE/app/public"
    chown -R "$APP_USER:$APP_USER" "$STORAGE/app/public"
    find "$STORAGE/app/public" -type d -exec chmod 755 {} +
    find "$STORAGE/app/public" -type f -exec chmod 644 {} +
    chmod 700 "$STORAGE/app/public.pre-restore-$ts"
fi

if [ -e "$BASE/current/artisan" ]; then
    log "applying migrations newer than the backup"
    artisan migrate --force
    artisan cache:clear >/dev/null
fi

stage=done
bring_up
rm -rf "$work"
log "restore finished. Check the wiki, then delete the pre-restore copies when happy:"
log "  $BACKUPS/pre-restore-$ts.sql.gz"
$db_only || log "  $STORAGE/app/public.pre-restore-$ts"
