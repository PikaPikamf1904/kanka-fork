#!/usr/bin/env bash
# Entry point of the chronicle-dev container (see deploy/dev/local.sh). Starts MariaDB on a Unix
# socket, writes a development-only .env, syncs the code, seeds synthetic data on first start
# and serves the app. Settings follow deploy/env.production.example where they matter (local
# uploads, file cache and sessions), with debug pages on and jobs run inline.
set -euo pipefail
cd /app

install -d -o mysql -g mysql /run/mysqld /var/lib/mysql
fresh=false
if [ ! -d /var/lib/mysql/mysql ]; then
    mariadb-install-db --user=mysql --datadir=/var/lib/mysql --auth-root-authentication-method=socket >/dev/null
    fresh=true
fi
mariadbd --user=mysql --datadir=/var/lib/mysql --skip-networking >/var/log/mariadb.log 2>&1 &
for _ in $(seq 60); do mariadb-admin ping --silent 2>/dev/null && break; sleep 1; done
mariadb -e 'CREATE DATABASE IF NOT EXISTS kanka CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'

mkdir -p storage
# One key for the life of the volume, so sessions and encrypted fields survive restarts.
[ -f storage/dev-app-key ] || (umask 077 && echo "base64:$(head -c 32 /dev/urandom | base64)" > storage/dev-app-key)

(umask 077 && cat > /app/.env <<EOF
APP_NAME="Chronicle"
APP_ENV=local
APP_KEY=$(cat storage/dev-app-key)
APP_DEBUG=true
APP_URL=${CHRONICLE_DEV_URL:-http://127.0.0.1:8090}
APP_EMAIL=dev@chronicle.test
APP_FORCE_HTTPS=false
APP_IGNORE_DEVELOP_WARNING=true
APP_REGISTRATION_ENABLED=false
APP_REGISTRATION_CODE=
APP_SAAS_SCHEDULE=false
DEBUGBAR_ENABLED=false
TELESCOPE_ENABLED=false
BOOST_ENABLED=false
LOG_CHANNEL=single
DB_CONNECTION=mysql
DB_SOCKET=/run/mysqld/mysqld.sock
DB_DATABASE=kanka
DB_USERNAME=root
DB_PASSWORD=
DB_LOGS_DATABASE=
DB_REPLICA_ENABLED=false
CACHE_STORE=file
CACHE_DRIVER=file
SESSION_DRIVER=file
SESSION_SECURE_COOKIE=false
QUEUE_CONNECTION=sync
QUEUE_DRIVER=sync
QUEUE_HEAVY_DRIVER=sync
BROADCAST_DRIVER=log
BROADCAST_CONNECTION=log
SCOUT_DRIVER=null
FILESYSTEM_DRIVER=public
S3_DISK_DRIVER=local
MAIL_MAILER=log
MAIL_DRIVER=log
MAIL_FROM_ADDRESS=dev@chronicle.test
ENTRANCE_ENABLED=false
EOF
)

bash /src/deploy/dev/local/sync.sh

[ -f storage/oauth-private.key ] || php artisan passport:keys --force >/dev/null
php artisan storage:link >/dev/null 2>&1 || true

if $fresh || [ ! -f storage/dev-logins.txt ]; then
    php artisan db:seed --force --no-interaction
    DM_PASSWORD=$(head -c 18 /dev/urandom | base64 | tr -d '/+=')
    PLAYER_PASSWORD=$(head -c 18 /dev/urandom | base64 | tr -d '/+=')
    DM_PASSWORD=$DM_PASSWORD PLAYER_PASSWORD=$PLAYER_PASSWORD php /src/deploy/dev/local/seed.php \
        || { echo "seeding failed; fix it, then: deploy/dev/local.sh destroy && deploy/dev/local.sh up"; exit 1; }
    (umask 077 && cat > storage/dev-logins.txt <<EOF
Chronicle local development logins (synthetic accounts, this PC only)
  DM / admin : dm@chronicle.test      password: $DM_PASSWORD
  Player     : player@chronicle.test  password: $PLAYER_PASSWORD
EOF
)
fi

echo "chronicle dev ready at ${CHRONICLE_DEV_URL:-http://127.0.0.1:8090}"
export PHP_CLI_SERVER_WORKERS=4
exec php artisan serve --host=0.0.0.0 --port=8000 --no-reload
