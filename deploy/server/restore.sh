#!/usr/bin/env bash
# Restore Kanka from one of its encrypted backup archives. Installed as "kanka-restore" by
# provision.sh. Run as root:
#
#   kanka-restore --list
#   kanka-restore <archive.zip>                  check the archive and show what would happen
#   kanka-restore <archive.zip> --yes            restore the database and uploaded files
#   kanka-restore <archive.zip> --yes --db-only  restore the database only
#   kanka-restore <archive.zip> --ask-password   archive made with a different password
#   kanka-restore --undo <time>                  check the copies a restore kept; <time> is
#                                                the one in its "pre-restore-<time>" copies
#   kanka-restore --undo <time> --yes            put back what that restore replaced
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
    { grep -m1 "^$1=" "$ENV_FILE" || true; } | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

if [ "${1:-}" = "--list" ]; then
    find "$BACKUPS" -name '*.zip' -printf '%TY-%Tm-%Td %TH:%TM  %10s bytes  %p\n' 2>/dev/null | sort
    exit 0
fi

artisan() { (cd "$BASE/current" && runuser -u "$APP_USER" -- php artisan "$@" --no-interaction); }

bring_up() {
    if [ -e "$BASE/current/artisan" ]; then
        artisan up >/dev/null || true
    fi
    systemctl start kanka-queue kanka-queue-heavy kanka-scheduler.timer
}

# Replace every table of database $2 with the tables of database $1 in one RENAME TABLE,
# which MariaDB applies all or nothing: the live database is never left half empty. The
# replaced tables move to "<db>_old" first and are dropped once the swap has succeeded.
swap_database() {
    local from=$1 to=$2 old="${2}_old" renames views
    # Views cannot move between databases. Kanka has none, so stop if one appears.
    views=$(mariadb -N -e "SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema IN ('$from', '$to') AND table_type <> 'BASE TABLE'")
    [ "$views" = "0" ] || die "$from or $to holds views, which this script cannot swap. Nothing was changed."
    renames=$(mariadb -N -e "SET SESSION group_concat_max_len = 4194304;
        SELECT GROUP_CONCAT(r ORDER BY k SEPARATOR ', ') FROM (
            SELECT 1 AS k, CONCAT('\`$to\`.\`', table_name, '\` TO \`$old\`.\`', table_name, '\`') AS r
                FROM information_schema.tables WHERE table_schema='$to'
            UNION ALL
            SELECT 2, CONCAT('\`$from\`.\`', table_name, '\` TO \`$to\`.\`', table_name, '\`')
                FROM information_schema.tables WHERE table_schema='$from'
        ) AS x")
    [ -n "$renames" ] && [ "$renames" != "NULL" ] || die "no tables to swap. Nothing was changed."
    mariadb -e "CREATE DATABASE \`$old\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    if ! mariadb -e "RENAME TABLE $renames;"; then
        # All or nothing: the live database is untouched, so the empty _old can go.
        mariadb -e "DROP DATABASE \`$old\`;" || true
        die "the swap failed; $to is unchanged. The loaded copy is still in $from."
    fi
    mariadb -e "DROP DATABASE \`$old\`; DROP DATABASE \`$from\`;"
}

# A "<db>_old" database left by an interrupted swap may hold the only other copy of data:
# never overwrite it.
check_no_old() {
    local found
    found=$(mariadb -N -e "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='${1}_old'")
    [ "$found" = "0" ] || die "database ${1}_old exists (left by an interrupted restore). Check it, then drop it by hand."
}

# Load a gzipped or plain SQL dump into a new, empty scratch database. --one-database skips
# any statement aimed at another database.
load_scratch() {
    local dump=$1 scratch=$2
    mariadb -e "DROP DATABASE IF EXISTS \`$scratch\`; CREATE DATABASE \`$scratch\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    case "$dump" in
        *.gz) gunzip -c "$dump" | mariadb --one-database "$scratch" ;;
        *) mariadb --one-database "$scratch" < "$dump" ;;
    esac
}

# A database copy is only trusted when it is a readable gzip holding at least one table.
check_copy() {
    local created
    gzip -t "$1" || die "$1 is damaged"
    created=$(gunzip -c "$1" | grep -c '^CREATE TABLE' || true)
    [ "${created:-0}" -gt 0 ] || die "$1 has no tables"
}

if [ "${1:-}" = "--undo" ]; then
    ts=${2:?usage: kanka-restore --undo <time> [--yes], e.g. 20261017-051008}
    [[ "$ts" =~ ^[0-9]{8}-[0-9]{6}$ ]] || die "<time> looks like 20261017-051008"
    undo_confirmed=false
    [ "${3:-}" = "--yes" ] && undo_confirmed=true
    db_copy="$BACKUPS/pre-restore-$ts.sql.gz"
    files_copy="$STORAGE/app/public.pre-restore-$ts"
    [ -f "$db_copy" ] || die "no $db_copy"
    check_copy "$db_copy"
    db_name=$(env_value DB_DATABASE)
    [ -n "$db_name" ] || die "DB_DATABASE missing in $ENV_FILE"
    log "would put back the database from $db_copy"
    [ -d "$files_copy" ] && log "and the uploads from $files_copy"
    if ! $undo_confirmed; then
        log "check only. To replace the live wiki with these copies, run: kanka-restore --undo $ts --yes"
        exit 0
    fi
    now=$(date +%Y%m%d-%H%M%S)
    undo_stage=offline
    undo_finish() {
        status=$?
        case "$undo_stage" in
            offline)
                log "nothing was changed; bringing the site back"
                bring_up || true
                ;;
            swapping)
                log "STOPPED HALFWAY. The site stays in maintenance mode."
                log "The database from before this undo: $BACKUPS/pre-undo-$now.sql.gz"
                log "See deploy/README.md, 'Restore went wrong'."
                ;;
        esac
        exit "$status"
    }
    trap undo_finish EXIT

    log "maintenance mode on; stopping workers and scheduler"
    if [ -e "$BASE/current/artisan" ]; then artisan down --retry=60 >/dev/null; fi
    systemctl stop kanka-scheduler.timer kanka-queue kanka-queue-heavy
    log "keeping the database being replaced in $BACKUPS/pre-undo-$now.sql.gz"
    (umask 077 && mariadb-dump --single-transaction --skip-lock-tables "$db_name" | gzip > "$BACKUPS/pre-undo-$now.sql.gz")
    # Nothing is replaced unless that copy is readable and actually holds the tables.
    check_copy "$BACKUPS/pre-undo-$now.sql.gz"
    check_no_old "$db_name"
    log "loading $db_copy into ${db_name}_restore"
    load_scratch "$db_copy" "${db_name}_restore"
    undo_stage=swapping
    swap_database "${db_name}_restore" "$db_name"
    if [ -d "$files_copy" ]; then
        log "putting back the uploads (the replaced ones go to app/public.pre-undo-$now)"
        mv "$STORAGE/app/public" "$STORAGE/app/public.pre-undo-$now"
        chmod 700 "$STORAGE/app/public.pre-undo-$now"
        mv "$files_copy" "$STORAGE/app/public"
        chmod 755 "$STORAGE/app/public"
    fi
    if [ -e "$BASE/current/artisan" ]; then artisan cache:clear >/dev/null; fi
    undo_stage="done"
    bring_up
    log "done. The pre-undo copies are not encrypted: delete them once you are happy."
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

# Not exported: only the PHP unpacker below gets it, in its own environment.
if $ask_password; then
    read -rsp "Backup archive password: " zip_password
    echo
else
    zip_password=$(env_value BACKUP_ARCHIVE_PASSWORD)
fi

ts=$(date +%Y%m%d-%H%M%S)
work="$BASE/restore-tmp/$ts"
install -d -m 700 "$BASE/restore-tmp" "$work"

stage=prepare
finish() {
    status=$?
    unset zip_password
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

log "unpacking $archive"
# PHP's zip extension reads the AES-encrypted archives spatie/laravel-backup writes, so no
# extra tools are needed. Entry names are checked so nothing lands outside $work.
KANKA_ZIP_PASSWORD=$zip_password php -d memory_limit=512M -r '
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
# Nothing is replaced unless that copy is readable and actually holds the tables.
check_copy "$BACKUPS/pre-restore-$ts.sql.gz"

check_no_old "$db_name"
scratch="${db_name}_restore"
log "loading the backup into the scratch database $scratch"
load_scratch "$dump" "$scratch"
tables=$(mariadb -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$scratch'")
[ "$tables" -gt 0 ] || die "the backup's database is empty"

stage=swapping
log "swapping in the restored database ($tables tables)"
swap_database "$scratch" "$db_name"
mariadb -e "GRANT ALL PRIVILEGES ON \`$db_name\`.* TO '$db_user'@'localhost'; FLUSH PRIVILEGES;"

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

stage="done"
bring_up
rm -rf "$work"
log "restore finished. Check the wiki, then delete the pre-restore copies (not encrypted) when happy:"
log "  $BACKUPS/pre-restore-$ts.sql.gz"
$db_only || log "  $STORAGE/app/public.pre-restore-$ts"
