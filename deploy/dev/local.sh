#!/usr/bin/env bash
# Run Chronicle locally for development, on this computer only, with synthetic data.
#
#   deploy/dev/local.sh up             create (first time) or start the "chronicle-dev" container
#   deploy/dev/local.sh sync           copy code changes in, migrate; add "build" to rebuild assets
#   deploy/dev/local.sh logins         show the synthetic development logins
#   deploy/dev/local.sh artisan <...>  run an artisan command inside
#   deploy/dev/local.sh sh <command>   run a shell command inside
#   deploy/dev/local.sh logs           follow the server log
#   deploy/dev/local.sh down           stop the container (data is kept)
#   deploy/dev/local.sh destroy        delete the container, its code copy and its database
#
# The app is then on http://127.0.0.1:8090 (override with CHRONICLE_DEV_PORT). Not a production
# setup: debug pages are on and the database has no password. Never put real campaign data in it.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
IMAGE=${KANKA_TEST_IMAGE:-kanka-test-php84}
NAME=${CHRONICLE_DEV_NAME:-chronicle-dev}
PORT=${CHRONICLE_DEV_PORT:-8090}
export MSYS_NO_PATHCONV=1
host_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }

in_box() { docker exec -i "$NAME" bash -c "cd /app && $1"; }

cmd=${1:-}
shift || true
case "$cmd" in
    up)
        if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
            docker build -t "$IMAGE" -f "$(host_path "$ROOT/deploy/dev/Dockerfile.test")" "$(host_path "$ROOT/deploy/dev")"
        fi
        if [ "$(docker container inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" = true ]; then
            echo "already running on http://127.0.0.1:$PORT"
            exit 0
        fi
        since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
        if docker container inspect "$NAME" >/dev/null 2>&1; then
            docker start "$NAME" >/dev/null
        else
            docker run -d --name "$NAME" \
                -p "127.0.0.1:$PORT:8000" \
                -e CHRONICLE_DEV_URL="http://127.0.0.1:$PORT" \
                -v "$(host_path "$ROOT"):/src:ro" \
                -v "$NAME-app:/app" \
                -v "$NAME-db:/var/lib/mysql" \
                -v kanka-composer-cache:/root/.cache/composer \
                -v kanka-yarn-cache:/usr/local/share/.cache/yarn \
                "$IMAGE" bash /src/deploy/dev/local/serve.sh >/dev/null
        fi
        echo "starting; the first start installs dependencies and builds assets (several minutes)"
        for _ in $(seq 900); do
            docker logs --since "$since" "$NAME" 2>&1 | grep -q 'chronicle dev ready' && break
            docker container inspect -f '{{.State.Running}}' "$NAME" | grep -q true || { docker logs --tail 40 "$NAME"; exit 1; }
            sleep 1
        done
        echo "Chronicle is on http://127.0.0.1:$PORT  (logins: deploy/dev/local.sh logins)"
        ;;
    sync)
        in_box "bash /src/deploy/dev/local/sync.sh ${1:-}"
        ;;
    logins)
        in_box 'cat storage/dev-logins.txt'
        ;;
    artisan)
        in_box "php artisan $*"
        ;;
    sh)
        in_box "$*"
        ;;
    logs)
        docker logs -f "$NAME"
        ;;
    down)
        docker stop "$NAME" >/dev/null && echo "stopped (data kept)"
        ;;
    destroy)
        docker rm -f "$NAME" >/dev/null 2>&1 || true
        docker volume rm "$NAME-app" "$NAME-db" >/dev/null && echo "deleted container, code copy and database"
        ;;
    *)
        sed -n '2,14p' "$0"
        exit 1
        ;;
esac
