#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v rg >/dev/null 2>&1; then
  echo "secret-check requires rg (ripgrep)." >&2
  exit 1
fi

PATTERN='AIza[0-9A-Za-z_-]{20,}|sk_live_[0-9A-Za-z]+|sk_test_[0-9A-Za-z]+|AKIA[0-9A-Z]{16}|ghp_[0-9A-Za-z]{20,}|xox[baprs]-[0-9A-Za-z-]{10,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|railway-verify=[0-9a-f]{20,}'

if rg -n --hidden \
  --glob '!node_modules' \
  --glob '!.git' \
  --glob '!.env' \
  --glob '!.env.local' \
  --glob '!.env.*' \
  --glob '!data/state.json' \
  --glob '!scripts/secret-check.sh' \
  "$PATTERN" "$ROOT"; then
  echo
  echo "Potential secret exposure found in repo-visible files." >&2
  exit 1
fi

echo "Secret scan passed: no live-looking secrets found in repo-visible files."
