#!/usr/bin/env bash
# Check that the Kanka server is healthy and locked down. Installed as "kanka-verify" by
# provision.sh. Read-only: it changes nothing and prints no passwords or keys.
#
#   sudo kanka-verify
#
# Every line is PASS, WARN (worth a look) or FAIL (fix before relying on the wiki).
# Exit code 1 when anything FAILs.
set -uo pipefail

BASE=${KANKA_BASE:-/srv/kanka}
APP_USER=kanka
ENV_FILE=$BASE/shared/.env
STORAGE=$BASE/shared/storage
HEALTH_BASE=${KANKA_HEALTH_BASE:-http://127.0.0.1}

fails=0
warns=0
pass() { printf 'PASS  %s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*"; warns=$((warns + 1)); }
fail() { printf 'FAIL  %s\n' "$*"; fails=$((fails + 1)); }
section() { printf '\n== %s\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
    echo "Run as root for the full check (sudo kanka-verify)."
    exit 1
fi

env_value() {
    grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}
http_code() { curl -s --path-as-is -o /dev/null -w '%{http_code}' --max-time 20 "$1" 2>/dev/null || true; }
mode_of() { stat -c '%a' "$1" 2>/dev/null; }
owner_of() { stat -c '%U' "$1" 2>/dev/null; }

section "System"
. /etc/os-release
[ "${VERSION_CODENAME:-}" = "trixie" ] && pass "Debian 13 (trixie)" || warn "expected Debian 13, found ${PRETTY_NAME:-unknown}"
if [ -n "$(swapon --noheadings --show)" ]; then pass "swap is enabled"; else warn "no swap: big map uploads may run out of memory"; fi
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
pass "memory: ${mem_mb} MB"
for mount in / "$BASE"; do
    used=$(df --output=pcent "$mount" | tail -n 1 | tr -dc '0-9')
    if [ "$used" -ge 95 ]; then fail "disk $mount is ${used}% full"
    elif [ "$used" -ge 85 ]; then warn "disk $mount is ${used}% full"
    else pass "disk $mount is ${used}% full"; fi
done
if [ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" = "yes" ]; then
    pass "clock is synchronised"
else
    warn "clock is not synchronised (backups and logs use the time)"
fi

section "Services (running and starting at boot)"
for unit in nginx php8.4-fpm mariadb kanka-queue kanka-queue-heavy kanka-scheduler.timer; do
    active=$(systemctl is-active "$unit" 2>/dev/null)
    # Workers restart themselves after each deploy; give them a few seconds.
    for _ in 1 2 3 4 5 6 7 8; do
        [ "$active" = "activating" ] || break
        sleep 2
        active=$(systemctl is-active "$unit" 2>/dev/null)
    done
    enabled=$(systemctl is-enabled "$unit" 2>/dev/null)
    if [ "$active" = "active" ] && [ "$enabled" = "enabled" ]; then
        pass "$unit"
    else
        fail "$unit is $active / $enabled (journalctl -u $unit -n 50)"
    fi
done
for unit in nginx php8.4-fpm mariadb kanka-queue kanka-queue-heavy; do
    restart=$(systemctl show "$unit" -p Restart --value 2>/dev/null)
    [ -n "$restart" ] && [ "$restart" != "no" ] && pass "$unit restarts after a crash ($restart)" \
        || fail "$unit does not restart after a crash (re-run provision.sh)"
done
last_run=$(systemctl show kanka-scheduler.service -p ExecMainExitTimestampMonotonic --value 2>/dev/null)
now_mono=$(awk '{print int($1 * 1000000)}' /proc/uptime)
if [ -n "$last_run" ] && [ "$last_run" -gt 0 ] && [ $(((now_mono - last_run) / 1000000)) -lt 300 ]; then
    result=$(systemctl show kanka-scheduler.service -p Result --value)
    [ "$result" = "success" ] && pass "scheduler ran in the last 5 minutes" || fail "scheduler last run: $result"
else
    warn "scheduler has not run in the last 5 minutes"
fi
[ -x "$(command -v vips)" ] && pass "vips is installed (large maps can be tiled)" || warn "vips is not installed (INSTALL_VIPS=1)"

section "Network exposure"
db_listen=$(ss -Hltn '( sport = :3306 )' | awk '{print $4}')
if [ -z "$db_listen" ] || ! grep -qvE '^(127\.0\.0\.1|\[::1\]):3306$' <<<"$db_listen"; then
    pass "MariaDB only accepts local connections"
else
    fail "MariaDB listens on: $(tr '\n' ' ' <<<"$db_listen")"
fi
ss -Hltn '( sport = :80 )' | grep -q . && pass "nginx listens on port 80" || fail "nothing listens on port 80"
others=$(ss -Hltn | awk '{print $4}' | grep -vE '^(127\.[0-9.]+|\[::1\]|\[::ffff:127\.[0-9.]+\]):' | grep -vE ':(22|80)$' | sort -u | tr '\n' ' ')
[ -z "$others" ] && pass "no other network services listening" || warn "other listening ports: $others"

section "Website"
up=$(http_code "$HEALTH_BASE/up")
[ "$up" = "200" ] && pass "/up answers 200" || fail "/up answers $up"
home=$(http_code "$HEALTH_BASE/")
[[ "$home" =~ ^(200|301|302)$ ]] && pass "home page answers $home" || fail "home page answers $home"
for path in /.env /storage/ /index.php/../.env /../shared/.env /storage/../../.env; do
    code=$(http_code "$HEALTH_BASE$path")
    [ "$code" = "200" ] && fail "$path is downloadable" || pass "$path is not downloadable ($code)"
done
app_url=$(env_value APP_URL)
if [ -n "$app_url" ]; then
    code=$(http_code "$app_url/up")
    [ "$code" = "200" ] && pass "APP_URL ($app_url) works from this machine" || warn "APP_URL ($app_url) answers $code"
fi

section "Files and secrets"
if [ -f "$ENV_FILE" ]; then
    [ "$(mode_of "$ENV_FILE")" = "600" ] && [ "$(owner_of "$ENV_FILE")" = "$APP_USER" ] \
        && pass ".env is private to $APP_USER" || fail ".env is $(mode_of "$ENV_FILE") owned by $(owner_of "$ENV_FILE")"
    [ "$(env_value APP_ENV)" = "production" ] && pass "APP_ENV=production" || fail "APP_ENV is not production"
    [ "$(env_value APP_DEBUG)" = "false" ] && pass "APP_DEBUG=false" || fail "APP_DEBUG is not false (shows internals on errors)"
    # The app ignores it in production too, but a stray "true" means a dev .env was copied.
    case "$(env_value APP_LOGIN_LIST)" in
        "" | false | "(false)" | 0 | null | "(null)" | empty | "(empty)") pass "APP_LOGIN_LIST is off" ;;
        *) fail "APP_LOGIN_LIST is on (a development shortcut that logs anyone in as any user)" ;;
    esac
    for key in APP_KEY DB_PASSWORD BACKUP_ARCHIVE_PASSWORD; do
        value=$(env_value "$key")
        if [ -z "$value" ] || [[ "$value" == CHANGE_ME* ]]; then fail "$key is not set"; else pass "$key is set"; fi
    done
    unset value
else
    fail "missing $ENV_FILE"
fi
if runuser -u www-data -- test -r "$ENV_FILE" 2>/dev/null; then fail "the web server can read .env"; else pass "the web server cannot read .env"; fi
for dir in "$STORAGE/app/s3" "$STORAGE/app/exports" "$STORAGE/app/imports" "$STORAGE/logs" "$BASE/backups"; do
    if runuser -u www-data -- test -r "$dir" 2>/dev/null; then
        fail "the web server can read $dir"
    else
        pass "$dir is private"
    fi
done
for key in "$STORAGE"/oauth-*.key; do
    [ -e "$key" ] || continue
    [ "$(mode_of "$key")" = "600" ] && pass "$(basename "$key") is private" || fail "$(basename "$key") is $(mode_of "$key")"
done

section "Release"
if [ -e "$BASE/current/artisan" ]; then
    pass "live release: $(basename "$(readlink -f "$BASE/current")")"
    [ -f "$BASE/current/bootstrap/cache/config.php" ] && pass "configuration is cached" || warn "configuration is not cached"
    [ "$(readlink "$BASE/current/public/storage")" = "../storage/app/public" ] \
        && pass "public/storage points at uploads only" || fail "public/storage points somewhere unexpected"
else
    fail "no release is live yet ($BASE/current)"
fi

section "Queues and backups"
db_name=$(env_value DB_DATABASE)
if [ -n "$db_name" ] && mariadb -N -e "SELECT 1" "$db_name" >/dev/null 2>&1; then
    failed=$(mariadb -N -e "SELECT COUNT(*) FROM failed_jobs" "$db_name" 2>/dev/null || echo "?")
    [ "$failed" = "0" ] && pass "no failed background jobs" || warn "$failed failed background jobs (php artisan queue:failed)"
    stuck=$(mariadb -N -e "SELECT COUNT(*) FROM jobs WHERE reserved_at IS NULL AND available_at < UNIX_TIMESTAMP() - 900" "$db_name" 2>/dev/null || echo "?")
    [ "$stuck" = "0" ] && pass "no jobs waiting longer than 15 minutes" || warn "$stuck jobs waiting longer than 15 minutes"
else
    fail "cannot reach the $db_name database"
fi
newest=$(find "$BASE/backups" -name '*.zip' -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -n 1)
if [ -z "$newest" ]; then
    warn "no backup archive yet (sudo kanka-backup)"
else
    age_h=$(( ($(date +%s) - ${newest%%.*}) / 3600 ))
    if [ "$age_h" -le 26 ]; then pass "newest backup is ${age_h}h old"; else fail "newest backup is ${age_h}h old"; fi
    [ "$(mode_of "$BASE/backups")" = "700" ] && pass "backups folder is private" || fail "backups folder is $(mode_of "$BASE/backups")"
fi

printf '\n%s failed, %s warnings\n' "$fails" "$warns"
[ "$fails" -eq 0 ]
