#!/usr/bin/env bash
# Build the app against the LOCAL stack, serve it with Cloudflare's own runtime (wrangler pages
# dev, including the /api/enroll function and _headers), and run the Playwright tests.
# Requires: scripts/local-stack.sh up && scripts/local-stack.sh seed
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# Validate both the endpoints and database identity before reading keys or building.
node --input-type=module -e "import {readLocalEnv, assertDisposableDatabase} from './scripts/local-targets.mjs'; const e = readLocalEnv(); await assertDisposableDatabase(e.DATABASE_URL);"
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_PUBLISHABLE_KEY=$(sed -n 's/^SUPABASE_PUBLISHABLE_KEY=//p' .local/env)
SUPABASE_SECRET_KEY=$(sed -n 's/^SUPABASE_SECRET_KEY=//p' .local/env)
for key in "$SUPABASE_PUBLISHABLE_KEY" "$SUPABASE_SECRET_KEY"; do
  [[ "$key" =~ ^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$ ]] || { echo 'Invalid local API key' >&2; exit 1; }
done

cat > .dev.vars <<EOF
SUPABASE_URL=$SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY=$SUPABASE_SECRET_KEY
IP_HASH_SECRET=$(openssl rand -hex 16)
EOF
chmod 600 .dev.vars

VITE_SUPABASE_URL=$SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY npm run build >/dev/null

# A server left on the port (for example from an interrupted run) would answer the tests with
# old keys and data; refuse to start rather than test the wrong thing.
if curl -fs -o /dev/null http://127.0.0.1:8788/; then
  echo 'Port 8788 is already serving something; stop it before running the browser tests.' >&2
  exit 1
fi
# Own process group, so stopping it also stops the workerd children npx starts.
setsid npx wrangler pages dev dist --port 8788 --ip 127.0.0.1 --compatibility-date 2026-10-01 > .local/wrangler.log 2>&1 &
WRANGLER=$!
trap 'kill -- -$WRANGLER 2>/dev/null || kill $WRANGLER 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -fs -o /dev/null http://127.0.0.1:8788/ && break; sleep 1; done

npx playwright test "$@"
