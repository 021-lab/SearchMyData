#!/bin/bash
# Test script for POST /voice API
# Usage: ./test-voice-api.sh [endpoint]

ENDPOINT="${1:-https://minds.myapp.fund/voice/}"

echo "=== Voice API Test ==="
echo "Endpoint: $ENDPOINT"
echo ""

# Generate a minimal valid WebM file (silent, ~100 bytes)
AUDIO_FILE=$(mktemp /tmp/test_voice_XXXXXX.webm)
printf '\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01\x42\xf7\x81\x01\x42\xf2\x81\x04\x42\xf3\x81\x08\x42\x82\x84\x77\x65\x62\x6d\x42\x87\x81\x02\x42\x85\x81\x02' > "$AUDIO_FILE"

# ── Test 1: только аудио ──────────────────────────────────────────────────────
echo "[ Test 1 ] Audio only"
RES=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$ENDPOINT" \
  -F "audio=@$AUDIO_FILE;type=audio/webm")
CODE=$(echo "$RES" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RES" | grep -v "HTTP_CODE:")
echo "  Status: $CODE"
echo "  Body:   $BODY"
echo ""

# ── Test 2: только context ────────────────────────────────────────────────────
echo "[ Test 2 ] Context only"
RES=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$ENDPOINT" \
  -F "context=тест голосового добавления задачи")
CODE=$(echo "$RES" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RES" | grep -v "HTTP_CODE:")
echo "  Status: $CODE"
echo "  Body:   $BODY"
echo ""

# ── Test 3: аудио + context + user_id ────────────────────────────────────────
echo "[ Test 3 ] Audio + context + user_id"
RES=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$ENDPOINT" \
  -F "audio=@$AUDIO_FILE;type=audio/webm" \
  -F "context=список покупок" \
  -F "user_id=user_42")
CODE=$(echo "$RES" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RES" | grep -v "HTTP_CODE:")
echo "  Status: $CODE"
echo "  Body:   $BODY"
echo ""

# ── Test 4: пустой запрос (должен вернуть 400) ───────────────────────────────
echo "[ Test 4 ] Empty request (expect 400)"
RES=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$ENDPOINT")
CODE=$(echo "$RES" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RES" | grep -v "HTTP_CODE:")
echo "  Status: $CODE"
echo "  Body:   $BODY"
echo ""

# ── Test 5: CORS preflight ────────────────────────────────────────────────────
echo "[ Test 5 ] CORS preflight OPTIONS"
curl -s -o /dev/null -w "  Status: %{http_code}\n  Access-Control-Allow-Origin: " \
  -X OPTIONS "$ENDPOINT" \
  -H "Origin: https://htmlpreview.github.io" \
  -H "Access-Control-Request-Method: POST"
curl -s -I -X OPTIONS "$ENDPOINT" \
  -H "Origin: https://htmlpreview.github.io" | grep -i "access-control"
echo ""

rm -f "$AUDIO_FILE"
echo "=== Done ==="
