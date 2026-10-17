#!/usr/bin/env bash
# Run a command against a disposable copy of this checkout inside the PHP 8.4 test image.
# The checkout is mounted read-only and copied into the "kanka-work" Docker volume, so
# vendor/, node_modules/ and test output never touch the working tree.
#
#   deploy/dev/run.sh sync                       copy the checkout into the volume
#   deploy/dev/run.sh setup                      sync + composer install + Passport test keys
#   deploy/dev/run.sh pest [args]                sync + full Pest suite (does not stop on failure)
#   deploy/dev/run.sh exec <command...>          sync + any command, e.g. "vendor/bin/phpstan analyse"
#
# Works from Git Bash on Windows and from Linux/macOS shells.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
IMAGE=${KANKA_TEST_IMAGE:-kanka-test-php84}
VOLUME=${KANKA_TEST_VOLUME:-kanka-work}
export MSYS_NO_PATHCONV=1

# Docker on Windows needs Windows-style paths (MSYS path conversion is off below).
host_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }
src=$(host_path "$ROOT")

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    docker build -t "$IMAGE" -f "$(host_path "$ROOT/deploy/dev/Dockerfile.test")" "$(host_path "$ROOT/deploy/dev")"
fi

in_container() {
    # spatie/laravel-backup refuses to boot with a null APP_EMAIL; tests never send mail.
    docker run --rm -i \
        -e APP_EMAIL=dev@kanka.test \
        -v "$src:/src:ro" \
        -v "$VOLUME:/app" \
        -v kanka-composer-cache:/root/.cache/composer \
        -v kanka-yarn-cache:/usr/local/share/.cache/yarn \
        "$IMAGE" bash -c "$1"
}

SYNC='rsync -a --delete --exclude /vendor --exclude /node_modules --exclude /.git \
  --exclude /public/build --exclude /phpunit.nostop.xml --exclude "/storage/oauth-*.key" \
  --exclude /storage/test-output /src/ /app/'

cmd=${1:-}
shift || true
case "$cmd" in
    sync)
        in_container "$SYNC"
        ;;
    setup)
        in_container "$SYNC && composer install --no-interaction --no-progress \
            && php artisan passport:keys --env=testing --force >/dev/null && echo setup done"
        ;;
    pest)
        # phpunit.xml stops at the first failure; the copy used here reports every failure.
        in_container "$SYNC && sed 's/stopOnFailure=\"true\"/stopOnFailure=\"false\"/' phpunit.xml > phpunit.nostop.xml \
            && vendor/bin/pest -c phpunit.nostop.xml --colors=never $*"
        ;;
    exec)
        in_container "$SYNC && $*"
        ;;
    *)
        sed -n '2,10p' "$0"
        exit 1
        ;;
esac
