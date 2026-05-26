#!/usr/bin/env bash
set -uo pipefail
# Note: -e is intentionally omitted — individual step failures are tracked
# via PASS/FAIL counters and must not abort the entire run.

# ── Config ──────────────────────────────────────────
PORT=34997
BASE="http://localhost:${PORT}"
DEMO_URL="https://youtu.be/xRh2sVcNXQ8"
TIMEOUT=30
PASS=0
FAIL=0
SKIP=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# ── Helpers ─────────────────────────────────────────
step_pass() { echo -e "  ${GREEN}PASS${NC}  $1"; PASS=$((PASS + 1)); }
step_fail() { echo -e "  ${RED}FAIL${NC}  $1 — $2"; FAIL=$((FAIL + 1)); }
step_skip() { echo -e "  ${YELLOW}SKIP${NC}  $1 — $2"; SKIP=$((SKIP + 1)); }

curl_local() {
  # bypass system proxy for localhost requests
  curl -s --noproxy '*' "$@"
}

# ── Cleanup ─────────────────────────────────────────
cleanup() {
  echo ""
  echo "Cleaning up..."
  fuser -k ${PORT}/tcp 2>/dev/null || true
  pkill -f "wrangler dev.*${PORT}" 2>/dev/null || true
}
trap cleanup EXIT

# ── Step 1: Build & Start ───────────────────────────
echo "=== Step 1: Build & Start Dev Server ==="

fuser -k ${PORT}/tcp 2>/dev/null || true
pkill -f "wrangler dev.*${PORT}" 2>/dev/null || true
sleep 1

if ! node build.mjs; then
  step_fail "Build failed" "node build.mjs returned non-zero"
  exit 1
fi

# Start wrangler in background
nohup npx wrangler dev --port "${PORT}" > /tmp/smoke_test_wrangler.log 2>&1 &
WRANGLER_PID=$!

# Wait for server to be ready (up to 30s)
READY=0
for i in $(seq 1 30); do
  sleep 1
  STATUS=$(curl_local -o /dev/null -w "%{http_code}" --max-time 2 "${BASE}/" 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    READY=1
    break
  fi
done

if [ "$READY" -eq 0 ]; then
  step_fail "Server failed to start" "not ready after 30s"
  cat /tmp/smoke_test_wrangler.log
  exit 1
fi
step_pass "Build + dev server started"

# ── Step 2: HTML Page ───────────────────────────────
echo "=== Step 2: HTML Page ==="
HTTP=$(curl_local -o /dev/null -w "%{http_code}" "${BASE}/")
CT=$(curl_local -o /dev/null -w "%{content_type}" "${BASE}/")
if [ "$HTTP" = "200" ] && echo "$CT" | grep -q "text/html"; then
  step_pass "GET / → HTTP 200, text/html"
else
  step_fail "GET /" "HTTP ${HTTP}, Content-Type: ${CT}"
fi

# ── Step 3: Static Assets ───────────────────────────
echo "=== Step 3: Static Assets ==="

HTTP_JS=$(curl_local -o /dev/null -w "%{http_code}" "${BASE}/app.js")
CT_JS=$(curl_local -o /dev/null -w "%{content_type}" "${BASE}/app.js")
if [ "$HTTP_JS" = "200" ] && echo "$CT_JS" | grep -q "javascript"; then
  step_pass "GET /app.js → HTTP 200, javascript"
else
  step_fail "GET /app.js" "HTTP ${HTTP_JS}, Content-Type: ${CT_JS}"
fi

HTTP_CSS=$(curl_local -o /dev/null -w "%{http_code}" "${BASE}/app.css")
CT_CSS=$(curl_local -o /dev/null -w "%{content_type}" "${BASE}/app.css")
if [ "$HTTP_CSS" = "200" ] && echo "$CT_CSS" | grep -q "css"; then
  step_pass "GET /app.css → HTTP 200, css"
else
  step_fail "GET /app.css" "HTTP ${HTTP_CSS}, Content-Type: ${CT_CSS}"
fi

# ── Step 4: Subtitle Extraction (JSON) ──────────────
echo "=== Step 4: Subtitle Extraction ==="
SUBTITLE_FILE=$(mktemp)

curl_local -X POST "${BASE}/api/generate" \
  -H "Content-Type: application/json" \
  -d "{\"youtubeUrl\": \"${DEMO_URL}\"}" \
  --max-time ${TIMEOUT} > "${SUBTITLE_FILE}" 2>/dev/null

if python3 -c "
import json, sys
with open('${SUBTITLE_FILE}') as f:
    d = json.load(f)
assert 'subtitle' in d, 'missing subtitle field'
assert 'videoId' in d, 'missing videoId field'
assert isinstance(d['subtitle'], str), 'subtitle is not a string'
assert len(d['subtitle'].strip()) > 0, 'subtitle is empty'
assert d['videoId'] == 'xRh2sVcNXQ8', f'wrong videoId: {d[\"videoId\"]}'
assert isinstance(d.get('fromFallback'), bool), 'missing fromFallback field'
" 2>/dev/null; then
  SUB_LEN=$(python3 -c "import json; print(len(json.load(open('${SUBTITLE_FILE}'))['subtitle']))" 2>/dev/null)
  FB=$(python3 -c "import json; print(json.load(open('${SUBTITLE_FILE}'))['fromFallback'])" 2>/dev/null)
  step_pass "POST /api/generate → subtitle ${SUB_LEN} chars, videoId=xRh2sVcNXQ8, fromFallback=${FB}"
else
  BODY4=$(head -c 300 "${SUBTITLE_FILE}" 2>/dev/null)
  step_fail "POST /api/generate" "response: ${BODY4}"
fi

rm -f "${SUBTITLE_FILE}"

# ── Step 5: Invalid URL Error ───────────────────────
echo "=== Step 5: Invalid URL Error ==="
ERR5=$(curl_local -w "\n%{http_code}" -X POST "${BASE}/api/generate" \
  -H "Content-Type: application/json" \
  -d '{"youtubeUrl": "not-a-valid-url"}' \
  --max-time 10 2>/dev/null)
HTTP5=$(echo "$ERR5" | tail -1)
BODY5=$(echo "$ERR5" | head -n -1)

if [ "$HTTP5" = "400" ] && echo "$BODY5" | grep -qi "error\|无效"; then
  step_pass "POST /api/generate invalid URL → HTTP 400 + error message"
else
  step_fail "POST /api/generate invalid URL" "HTTP ${HTTP5}: $(echo "$BODY5" | head -c 100)"
fi

# ── Step 6: Empty Body Error ────────────────────────
echo "=== Step 6: Empty Body Error ==="
ERR6=$(curl_local -w "\n%{http_code}" -X POST "${BASE}/api/generate" \
  -H "Content-Type: application/json" \
  -d '{}' \
  --max-time 10 2>/dev/null)
HTTP6=$(echo "$ERR6" | tail -1)
BODY6=$(echo "$ERR6" | head -n -1)

if [ "$HTTP6" = "400" ] && echo "$BODY6" | grep -qi "error\|missing\|required"; then
  step_pass "POST /api/generate {} → HTTP 400 + error message"
else
  step_fail "POST /api/generate {}" "HTTP ${HTTP6}: $(echo "$BODY6" | head -c 100)"
fi

# ── Summary ─────────────────────────────────────────
TOTAL=$((PASS + FAIL + SKIP))
echo ""
echo "========================================="
echo "  Smoke Test Results: ${PASS}/${TOTAL} passed"
echo "========================================="
echo "  Pass: ${PASS}"
echo "  Fail: ${FAIL}"
echo "  Skip: ${SKIP}"
echo "========================================="

if [ "${FAIL}" -gt 0 ]; then
  echo -e "  ${RED}SMOKE TEST FAILED${NC}"
  exit 1
else
  echo -e "  ${GREEN}SMOKE TEST PASSED${NC}"
  exit 0
fi
