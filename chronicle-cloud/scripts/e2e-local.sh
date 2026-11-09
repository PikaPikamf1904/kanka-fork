#!/usr/bin/env bash
# Build the app against the LOCAL stack, serve it with Cloudflare's own runtime (wrangler pages
# dev, including the /api/enroll function and _headers), and run the Playwright tests.
# Requires: scripts/local-stack.sh up && scripts/local-stack.sh seed
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
. .local/env

cat > .dev.vars <<EOF
SUPABASE_URL=$SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY=$SUPABASE_SECRET_KEY
IP_HASH_SECRET=$(openssl rand -hex 16)
EOF
chmod 600 .dev.vars

VITE_SUPABASE_URL=$SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY npm run build >/dev/null

npx wrangler pages dev dist --port 8788 --ip 127.0.0.1 --compatibility-date 2026-10-01 > .local/wrangler.log 2>&1 &
WRANGLER=$!
trap 'kill $WRANGLER 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -fs -o /dev/null http://127.0.0.1:8788/ && break; sleep 1; done

npx playwright test "$@"
