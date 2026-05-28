#!/usr/bin/env bash
set -uo pipefail

ENV="${1:-prd}"

case "$ENV" in
  stg|staging) BASE="https://youtoarticle-staging.junlikowk.workers.dev" ;;
  prd|prod|production) BASE="https://youtoarticle.junlikowk.workers.dev" ;;
  local)
    echo "=== Building frontend ==="
    node build.mjs

    echo "=== Starting local dev server (port 34997) ==="
    npx wrangler dev --port 34997 &
    WRANGLER_PID=$!

    # Wait for dev server to be ready (up to 30s)
    # --noproxy '*' bypasses the webshare proxy for localhost
    for i in $(seq 1 30); do
      CODE=$(curl --noproxy '*' -s -o /dev/null -w "%{http_code}" http://localhost:34997/ 2>/dev/null || echo "000")
      if [ "$CODE" = "200" ]; then
        echo "Dev server ready (HTTP $CODE)"
        break
      fi
      sleep 1
    done

    BASE="http://localhost:34997"
    ;;
  *) echo "Usage: smoke_test.sh [stg|prd|local]"; exit 1 ;;
esac

# Default to deepseek — Gemini has geo-restrictions from this location
export MODEL="${MODEL:-deepseek-v4-flash}"

echo "=== Smoke Test: Single Lifecycle (${ENV}) ==="
echo "BASE=$BASE MODEL=${MODEL:-default}"

TEST_URL="$BASE" npx playwright test e2e/smoke.spec.ts --reporter=list
TEST_EXIT=$?

if [ "$ENV" = "local" ]; then
  kill $WRANGLER_PID 2>/dev/null
  wait $WRANGLER_PID 2>/dev/null
fi

exit $TEST_EXIT
