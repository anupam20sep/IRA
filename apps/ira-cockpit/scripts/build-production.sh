#!/usr/bin/env bash
# Ira Cockpit — production desktop bundle (Tauri release)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MONOREPO="$(cd "$ROOT/../.." && pwd)"
cd "$ROOT"

if [[ -f "$HOME/.cargo/env" ]]; then
  # shellcheck source=/dev/null
  source "$HOME/.cargo/env"
fi

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: missing '$1'" >&2
    exit 1
  fi
}

need node
need pnpm
need cargo

echo "==> Sync config"
mkdir -p public
cp -f ira.config.json public/ira.config.json

echo "==> Ensure SuperSpec CLI present"
CLI="$MONOREPO/packages/core/dist/cli.js"
if [[ ! -f "$CLI" ]]; then
  echo "    building packages/core…"
  (cd "$MONOREPO" && pnpm --filter @superspec-dev/core build) \
    || (cd "$MONOREPO/packages/core" && pnpm build)
fi
export SUPERSPEC_BIN="${SUPERSPEC_BIN:-$CLI}"

echo "==> Frontend production build (tsc + vite)"
pnpm build

echo "==> Tauri release bundle"
pnpm tauri build

BUNDLE="$ROOT/src-tauri/target/release/bundle"
echo ""
echo "Production build complete."
echo "  Artifacts: $BUNDLE"
if [[ -d "$BUNDLE/dmg" ]]; then
  ls -la "$BUNDLE/dmg" || true
fi
if [[ -d "$BUNDLE/macos" ]]; then
  ls -la "$BUNDLE/macos" || true
fi
echo "  Open .app / .dmg from the bundle folder, or:"
echo "    open \"$BUNDLE/macos/Ira.app\"  # if present"
