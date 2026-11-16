#!/usr/bin/env bash
# Copy the read-only checkout (/src) into the app volume (/app), then install and migrate.
# Runs inside the chronicle-dev container. "build" forces a Vite rebuild.
set -euo pipefail
cd /app

rsync -a --delete \
    --exclude /vendor --exclude /node_modules --exclude /.git --exclude /public/build \
    --exclude /public/storage --exclude /storage --exclude /.env --exclude /phpunit.nostop.xml \
    /src/ /app/
# storage/ is not in git; keep uploads, sessions and logs between syncs.
mkdir -p storage/app/public storage/framework/cache/data storage/framework/sessions \
    storage/framework/views storage/framework/testing storage/logs storage/fonts storage/purify

lock_hash() { cat composer.lock package.json yarn.lock | sha1sum | cut -d' ' -f1; }
if [ ! -f vendor/autoload.php ] || [ "$(cat storage/.deps-hash 2>/dev/null)" != "$(lock_hash)" ]; then
    composer install --no-interaction --no-progress
    yarn install --frozen-lockfile --non-interactive
    lock_hash > storage/.deps-hash
    rebuild=1
fi
if [ "${1:-}" = build ] || [ -n "${rebuild:-}" ] || [ ! -f public/build/manifest.json ]; then
    yarn build
fi

php artisan migrate --force --no-interaction
php artisan optimize:clear >/dev/null
echo "synced"
