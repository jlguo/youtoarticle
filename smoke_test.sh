#!/usr/bin/env bash
set -uo pipefail

ENV="${1:-prd}"

case "$ENV" in
  stg|staging) BASE="https://youtoarticle-staging.junlikowk.workers.dev" ;;
  prd|prod|production) BASE="https://youtoarticle.junlikowk.workers.dev" ;;
  *) echo "Usage: smoke_test.sh [stg|prd]"; exit 1 ;;
esac

echo "=== Smoke Test: Single Lifecycle (${ENV}) ==="
TEST_URL="$BASE" npx playwright test e2e/smoke.spec.ts --reporter=list
