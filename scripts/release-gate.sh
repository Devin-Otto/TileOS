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
RELEASE_GATE_HOST="${RELEASE_GATE_HOST:-127.0.0.1}"
BASE_URL="http://${RELEASE_GATE_HOST}:${PORT}"
APP_PATH="${TILEOS_BASE_PATH:-/tileos/app}"
APP_URL="${BASE_URL}${APP_PATH}"
TMP_DATA_ROOT="$(mktemp -d)"
SERVER_LOG="$TMP_DATA_ROOT/tileos-release-gate.log"
COOKIE_ONE="$TMP_DATA_ROOT/visitor-one.cookies"
COOKIE_TWO="$TMP_DATA_ROOT/visitor-two.cookies"
ADMIN_COOKIE="$TMP_DATA_ROOT/admin.cookies"

json_assert() {
  local file="$1"
  local script="$2"
  python3 - "$file" <<PY
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
data = json.loads(path.read_text())
$script
PY
}

write_json() {
  local file="$1"
  shift
  curl -fsS "$@" >"$file"
}

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
HOST="$RELEASE_GATE_HOST" \
TILEOS_PUBLIC_URL="$APP_URL" \
TILEOS_BASE_PATH="$APP_PATH" \
TILEOS_DATA_ROOT="$TMP_DATA_ROOT/data" \
TILEOS_DISABLE_DOTENV="1" \
ADMIN_PASSWORD="release-gate-password" \
SESSION_SECRET="release-gate-session-secret" \
GEMINI_API_KEYS="" \
GEMINI_API_KEY="" \
GOOGLE_API_KEY="" \
node server.js >"$SERVER_LOG" 2>&1 &
SERVER_PID="$!"

for _ in {1..50}; do
  if curl -fsS "$APP_URL/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

if ! curl -fsS "$APP_URL/healthz" >/dev/null 2>&1; then
  echo "TileOS failed to start during release gate." >&2
  cat "$SERVER_LOG" >&2 || true
  exit 1
fi

health_headers="$(curl -isS "$APP_URL/healthz")"
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
test_status 404 "$APP_URL/.env"
test_status 200 "$APP_URL/api/session"
test_status 403 -X POST -H "Origin: https://evil.example" -H "Content-Type: application/json" -d '{"password":"x"}' "$APP_URL/api/auth/login"
test_status 403 -X POST -H "Origin: $BASE_URL" -H "Content-Type: application/json" -d '{"orderedIds":[]}' "$APP_URL/api/projects/reorder"
test_status 403 -X POST -H "Origin: $BASE_URL" "$APP_URL/api/projects/release-gate-test/publish"
test_status 403 -X POST -H "Origin: $BASE_URL" "$APP_URL/api/projects/release-gate-test/unpublish"
test_status 403 -X DELETE -H "Origin: $BASE_URL" "$APP_URL/api/projects/release-gate-test"

BOOTSTRAP_FILE="$TMP_DATA_ROOT/bootstrap.json"
write_json "$BOOTSTRAP_FILE" "$APP_URL/api/bootstrap"
if rg -q 'AIza|sk_live|sk_test|SESSION_SECRET|ADMIN_PASSWORD|GEMINI_API_KEYS' "$BOOTSTRAP_FILE"; then
  echo "Bootstrap response appears to expose secrets." >&2
  exit 1
fi
json_assert "$BOOTSTRAP_FILE" $'
assert data["basePath"] == "'"$APP_PATH"'", data["basePath"]
assert data["generation"]["mode"] == "fallback", data["generation"]
assert data["generation"]["available"] is False, data["generation"]
assert data["models"][0]["id"] == "gemini", data["models"]
assert data["models"][0]["available"] is False, data["models"]
'

MANIFEST_FILE="$TMP_DATA_ROOT/manifest.json"
write_json "$MANIFEST_FILE" "$APP_URL/tileos.project.json"
if rg -q 'GEMINI_API_KEYS|SESSION_SECRET|ADMIN_PASSWORD|dataRoot|hasGeminiKeys' "$MANIFEST_FILE"; then
  echo "Manifest exposes internal deployment detail." >&2
  exit 1
fi
json_assert "$MANIFEST_FILE" $'
assert data["basePath"] == "'"$APP_PATH"'", data
assert data["liveUrl"] == "'"$APP_URL"'", data
'

CHAT_ONE_FILE="$TMP_DATA_ROOT/chat-one.json"
curl -fsS \
  -c "$COOKIE_ONE" \
  -b "$COOKIE_ONE" \
  -H "Content-Type: application/json" \
  -d '{"message":"make me a tile app that says Release Gate Hello"}' \
  "$APP_URL/api/chat" >"$CHAT_ONE_FILE"
json_assert "$CHAT_ONE_FILE" $'
assert data["ok"] is True, data
assert data["action"] == "deploy", data
assert data["project"]["visibility"] == "draft", data["project"]
assert data["project"]["viewerOwned"] is True, data["project"]
assert data["project"]["canEdit"] is True, data["project"]
assert data["focusProjectId"] == data["project"]["id"], data
'
PROJECT_ID="$(python3 - "$CHAT_ONE_FILE" <<'PY'
import json
import pathlib
import sys
data = json.loads(pathlib.Path(sys.argv[1]).read_text())
print(data["project"]["id"])
PY
)"

VISITOR_ONE_PROJECTS="$TMP_DATA_ROOT/projects-one.json"
write_json "$VISITOR_ONE_PROJECTS" -c "$COOKIE_ONE" -b "$COOKIE_ONE" "$APP_URL/api/projects"
json_assert "$VISITOR_ONE_PROJECTS" $'
project_ids = {project["id"] for project in data["projects"]}
assert "'"$PROJECT_ID"'" in project_ids, project_ids
'

VISITOR_TWO_PROJECTS="$TMP_DATA_ROOT/projects-two.json"
write_json "$VISITOR_TWO_PROJECTS" -c "$COOKIE_TWO" -b "$COOKIE_TWO" "$APP_URL/api/projects"
json_assert "$VISITOR_TWO_PROJECTS" $'
project_ids = {project["id"] for project in data["projects"]}
assert "'"$PROJECT_ID"'" not in project_ids, project_ids
'

ADMIN_LOGIN_FILE="$TMP_DATA_ROOT/admin-login.json"
curl -fsS \
  -c "$ADMIN_COOKIE" \
  -b "$ADMIN_COOKIE" \
  -X POST \
  -H "Origin: $BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{"password":"release-gate-password"}' \
  "$APP_URL/api/auth/login" >"$ADMIN_LOGIN_FILE"
json_assert "$ADMIN_LOGIN_FILE" $'
assert data["ok"] is True, data
assert data["isAdmin"] is True, data
'

PUBLISH_FILE="$TMP_DATA_ROOT/publish.json"
curl -fsS \
  -c "$ADMIN_COOKIE" \
  -b "$ADMIN_COOKIE" \
  -X POST \
  -H "Origin: $BASE_URL" \
  "$APP_URL/api/projects/$PROJECT_ID/publish" >"$PUBLISH_FILE"
json_assert "$PUBLISH_FILE" $'
assert data["ok"] is True, data
assert data["project"]["visibility"] == "published", data["project"]
assert data["project"]["canPublish"] is False, data["project"]
'

ADMIN_PROJECTS_FILE="$TMP_DATA_ROOT/admin-projects.json"
write_json "$ADMIN_PROJECTS_FILE" -c "$ADMIN_COOKIE" -b "$ADMIN_COOKIE" "$APP_URL/api/projects"
ORDERED_IDS_JSON="$(python3 - "$ADMIN_PROJECTS_FILE" <<'PY'
import json
import pathlib
import sys
data = json.loads(pathlib.Path(sys.argv[1]).read_text())
published = [project["id"] for project in data["projects"] if project.get("visibility") == "published"]
print(json.dumps(published))
PY
)"
REORDER_FILE="$TMP_DATA_ROOT/reorder.json"
curl -fsS \
  -c "$ADMIN_COOKIE" \
  -b "$ADMIN_COOKIE" \
  -X POST \
  -H "Origin: $BASE_URL" \
  -H "Content-Type: application/json" \
  -d "{\"orderedIds\":$ORDERED_IDS_JSON}" \
  "$APP_URL/api/projects/reorder" >"$REORDER_FILE"
json_assert "$REORDER_FILE" $'
assert data["ok"] is True, data
assert isinstance(data["projects"], list) and len(data["projects"]) >= 1, data
'

VISITOR_TWO_PUBLISHED="$TMP_DATA_ROOT/projects-two-published.json"
write_json "$VISITOR_TWO_PUBLISHED" -c "$COOKIE_TWO" -b "$COOKIE_TWO" "$APP_URL/api/projects"
json_assert "$VISITOR_TWO_PUBLISHED" $'
project_ids = {project["id"] for project in data["projects"]}
assert "'"$PROJECT_ID"'" in project_ids, project_ids
'

UNPUBLISH_FILE="$TMP_DATA_ROOT/unpublish.json"
curl -fsS \
  -c "$ADMIN_COOKIE" \
  -b "$ADMIN_COOKIE" \
  -X POST \
  -H "Origin: $BASE_URL" \
  "$APP_URL/api/projects/$PROJECT_ID/unpublish" >"$UNPUBLISH_FILE"
json_assert "$UNPUBLISH_FILE" $'
assert data["ok"] is True, data
assert data["project"]["visibility"] == "draft", data["project"]
'

VISITOR_TWO_AFTER_UNPUBLISH="$TMP_DATA_ROOT/projects-two-unpublished.json"
write_json "$VISITOR_TWO_AFTER_UNPUBLISH" -c "$COOKIE_TWO" -b "$COOKIE_TWO" "$APP_URL/api/projects"
json_assert "$VISITOR_TWO_AFTER_UNPUBLISH" $'
project_ids = {project["id"] for project in data["projects"]}
assert "'"$PROJECT_ID"'" not in project_ids, project_ids
'

DELETE_FILE="$TMP_DATA_ROOT/delete.json"
curl -fsS \
  -c "$ADMIN_COOKIE" \
  -b "$ADMIN_COOKIE" \
  -X DELETE \
  -H "Origin: $BASE_URL" \
  "$APP_URL/api/projects/$PROJECT_ID" >"$DELETE_FILE"
json_assert "$DELETE_FILE" $'
assert data["ok"] is True, data
'

VISITOR_ONE_AFTER_DELETE="$TMP_DATA_ROOT/projects-one-deleted.json"
write_json "$VISITOR_ONE_AFTER_DELETE" -c "$COOKIE_ONE" -b "$COOKIE_ONE" "$APP_URL/api/projects"
json_assert "$VISITOR_ONE_AFTER_DELETE" $'
project_ids = {project["id"] for project in data["projects"]}
assert "'"$PROJECT_ID"'" not in project_ids, project_ids
'

echo "Release gate passed."
