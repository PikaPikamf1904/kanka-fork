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
# A synthetic DM screen passcode for the local tests only (the real one is a Cloudflare secret).
DM_SCREEN_PASSCODE=24680
EOF
chmod 600 .dev.vars

# A failed build must say why (it used to exit silently with the compiler's output discarded).
if ! VITE_SUPABASE_URL=$SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY npm run build > .local/build.log 2>&1; then
  cat .local/build.log >&2
  echo 'The build failed; the browser tests were not run.' >&2
  exit 1
fi

# The MCP server, run by Cloudflare's local runtime against the local stack (HS256 tokens from the
# local Auth server; the hosted Worker uses the project's signing keys instead).
cat > mcp/.dev.vars <<EOF
SUPABASE_URL=$SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY
SUPABASE_JWT_SECRET=$(cat .local/jwt_secret)
CHRONICLE_URL=http://127.0.0.1:8788
EOF
chmod 600 mcp/.dev.vars

# A server left on the port (for example from an interrupted run) would answer the tests with
# old keys and data; refuse to start rather than test the wrong thing.
for port in 8788 8789; do
  if curl -s -o /dev/null "http://127.0.0.1:$port/"; then
    echo "Port $port is already serving something; stop it before running the browser tests." >&2
    exit 1
  fi
done
# Own process group, so stopping it also stops the workerd children npx starts.
setsid npx wrangler pages dev dist --port 8788 --ip 127.0.0.1 --compatibility-date 2026-10-01 > .local/wrangler.log 2>&1 &
WRANGLER=$!
setsid npx wrangler dev -c mcp/wrangler.jsonc --port 8789 --ip 127.0.0.1 --inspector-port 9231 > .local/wrangler-mcp.log 2>&1 &
MCP=$!
trap 'kill -- -$WRANGLER 2>/dev/null || kill $WRANGLER 2>/dev/null || true; kill -- -$MCP 2>/dev/null || kill $MCP 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -fs -o /dev/null http://127.0.0.1:8788/ && break; sleep 1; done
for _ in $(seq 1 60); do curl -fs -o /dev/null http://127.0.0.1:8789/health && break; sleep 1; done

npx playwright test "$@"
