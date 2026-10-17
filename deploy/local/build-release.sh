#!/usr/bin/env bash
# Build a release archive for Big Bertha on this computer. Composer and Vite run inside the
# PHP 8.4 Docker image (deploy/dev/Dockerfile.test), so Windows needs only Git and Docker.
# Only committed code is built.
#
#   deploy/local/build-release.sh            build the current commit
#   deploy/local/build-release.sh <ref>      build a branch, tag or commit
#
# Output: deploy/local/out/kanka-<date>-<commit>.tar.gz (git-ignored). Next step:
# deploy/local/push-release.sh.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
IMAGE=${KANKA_TEST_IMAGE:-kanka-test-php84}
export MSYS_NO_PATHCONV=1
# Docker on Windows needs Windows-style paths (MSYS path conversion is off below).
host_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }

ref=${1:-HEAD}
sha=$(git rev-parse --short "$ref^{commit}")
if [ "$ref" = "HEAD" ] && [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "note: uncommitted changes are not part of the build"
fi

out="$ROOT/deploy/local/out"
mkdir -p "$out"
out_mount=$(host_path "$out")
name="kanka-$(date +%Y%m%d-%H%M)-$sha.tar.gz"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    docker build -t "$IMAGE" -f "$(host_path "$ROOT/deploy/dev/Dockerfile.test")" "$(host_path "$ROOT/deploy/dev")"
fi

echo "building $sha into deploy/local/out/$name"
# spatie/laravel-backup refuses to boot without APP_EMAIL; the server's .env sets the real one.
git archive --format=tar "$ref" | docker run --rm -i \
    -e APP_EMAIL=build@kanka.test \
    -e NAME="$name" \
    -v "$out_mount:/out" \
    -v kanka-composer-cache:/root/.cache/composer \
    -v kanka-yarn-cache:/usr/local/share/.cache/yarn \
    "$IMAGE" bash -euo pipefail -c '
        mkdir /build && cd /build && tar -xf -
        composer install --no-dev --prefer-dist --no-interaction --no-progress --optimize-autoloader
        yarn install --frozen-lockfile --non-interactive --silent
        yarn build >/dev/null
        rm -rf node_modules tests
        tar -czf "/out/$NAME" --exclude=./storage --exclude=./.env --exclude="./.env.*" .
    '
(cd "$out" && sha256sum "$name" > "$name.sha256")
ls -lh "$out/$name"
cat "$out/$name.sha256"
