#!/usr/bin/env bash
# House Hunt pre-deploy smoke check — fails if regression markers are missing.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MARKERS="$ROOT/scripts/smoke-markers.txt"
FAIL=0

red() { printf '\033[0;31m%s\033[0m\n' "$1"; }
green() { printf '\033[0;32m%s\033[0m\n' "$1"; }

if [[ ! -f "$MARKERS" ]]; then
  red "ERROR: missing $MARKERS"
  exit 1
fi

echo "House Hunt smoke check (repo: $ROOT)"

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  IFS='|' read -r file pattern desc <<< "$line"
  path="$ROOT/$file"
  if [[ ! -f "$path" ]]; then
    red "FAIL: missing file $file ($desc)"
    FAIL=1
    continue
  fi
  if ! grep -qF "$pattern" "$path" 2>/dev/null; then
    red "FAIL: $file missing pattern [$pattern] — $desc"
    FAIL=1
  fi
done < "$MARKERS"

# Version alignment: SPA_VERSION in config.js must match index.html comment
SPA_VER="$(grep -oP "SPA_VERSION = '\K[^']+" js/config.js 2>/dev/null || true)"
if [[ -z "$SPA_VER" ]]; then
  red "FAIL: could not read SPA_VERSION from js/config.js"
  FAIL=1
else
  if ! grep -qF "SPA $SPA_VER" index.html; then
    red "FAIL: index.html header comment does not reference SPA $SPA_VER"
    FAIL=1
  fi
  if ! grep -qF "$SPA_VER" extension/manifest.json; then
    red "FAIL: extension/manifest.json does not reference SPA $SPA_VER"
    FAIL=1
  fi
fi

# initHouseHunt must call syncGeoLayouts after load
if ! grep -q 'syncGeoLayouts()' index.html; then
  red "FAIL: syncGeoLayouts() not found in index.html"
  FAIL=1
fi

if [[ "$FAIL" -ne 0 ]]; then
  echo ""
  red "Smoke check FAILED — fix regressions before deploy."
  exit 1
fi

green "Smoke check passed ($SPA_VER)."
