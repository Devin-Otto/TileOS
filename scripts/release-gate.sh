#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v curl >/dev/null 2>&1; then
  echo "release-gate requires curl." >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "release-gate requires git." >&2
  exit 1
fi

npm run verify:repo

git check-ignore -q .env.local
git check-ignore -q data/state.json

PORT="${PORT:-9627}"
HOST="${HOST:-127.0.0.1}"
BASE_URL="http://${HOST}:${PORT}"
TMP_DATA_ROOT="$(mktemp -d)"
SERVER_LOG="$TMP_DATA_ROOT/tileos-release-gate.log"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DATA_ROOT"
}

trap cleanup EXIT

NODE_ENV=production \
PORT="$PORT" \
HOST="$HOST" \
TILEOS_PUBLIC_URL="$BASE_URL" \
TILEOS_DATA_ROOT="$TMP_DATA_ROOT/data" \
ADMIN_PASSWORD="release-gate-password" \
SESSION_SECRET="release-gate-session-secret" \
GEMINI_API_KEYS="release-gate-gemini-key" \
node server.js >"$SERVER_LOG" 2>&1 &
SERVER_PID="$!"

for _ in {1..50}; do
  if curl -fsS "$BASE_URL/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

if ! curl -fsS "$BASE_URL/healthz" >/dev/null 2>&1; then
  echo "TileOS failed to start during release gate." >&2
  cat "$SERVER_LOG" >&2 || true
  exit 1
fi

health_headers="$(curl -isS "$BASE_URL/healthz")"
printf '%s' "$health_headers" | grep -Fq "Strict-Transport-Security:"
printf '%s' "$health_headers" | grep -Fq "Content-Security-Policy:"
printf '%s' "$health_headers" | grep -Fq "X-Frame-Options: SAMEORIGIN"
printf '%s' "$health_headers" | grep -Fq "X-Content-Type-Options: nosniff"
printf '%s' "$health_headers" | grep -Fq "Referrer-Policy: strict-origin-when-cross-origin"
printf '%s' "$health_headers" | grep -Fq "Permissions-Policy:"

health_body="$(printf '%s' "$health_headers" | sed -n '/^\r$/,$p')"
if printf '%s' "$health_body" | rg -q 'dataRoot|hasGeminiKeys|SESSION_SECRET|ADMIN_PASSWORD|GEMINI_API_KEYS'; then
  echo "Health endpoint exposes internal deployment detail." >&2
  exit 1
fi

test_status() {
  local expected="$1"
  shift
  local actual
  actual="$(curl -o /dev/null -sS -w '%{http_code}' "$@")"
  if [[ "$actual" != "$expected" ]]; then
    echo "Expected HTTP $expected but got $actual for: $*" >&2
    exit 1
  fi
}

test_status 404 "$BASE_URL/.env"
test_status 404 "$BASE_URL/.git/HEAD"
test_status 200 "$BASE_URL/api/session"
test_status 403 -X POST -H "Origin: https://evil.example" -H "Content-Type: application/json" -d '{"password":"x"}' "$BASE_URL/api/auth/login"
test_status 403 -X POST -H "Origin: $BASE_URL" -H "Content-Type: application/json" -d '{"orderedIds":[]}' "$BASE_URL/api/projects/reorder"
test_status 403 -X POST -H "Origin: $BASE_URL" "$BASE_URL/api/projects/release-gate-test/publish"
test_status 403 -X POST -H "Origin: $BASE_URL" "$BASE_URL/api/projects/release-gate-test/unpublish"
test_status 403 -X DELETE -H "Origin: $BASE_URL" "$BASE_URL/api/projects/release-gate-test"

bootstrap_body="$(curl -fsS "$BASE_URL/api/bootstrap")"
if printf '%s' "$bootstrap_body" | rg -q 'AIza|sk_live|sk_test|SESSION_SECRET|ADMIN_PASSWORD|GEMINI_API_KEYS'; then
  echo "Bootstrap response appears to expose secrets." >&2
  exit 1
fi

manifest_body="$(curl -fsS "$BASE_URL/tileos.project.json")"
if printf '%s' "$manifest_body" | rg -q 'GEMINI_API_KEYS|SESSION_SECRET|ADMIN_PASSWORD|dataRoot|hasGeminiKeys'; then
  echo "Manifest exposes internal deployment detail." >&2
  exit 1
fi

echo "Release gate passed."
