#!/usr/bin/env bash
# Ira Cockpit — development (Tauri + Vite HMR on 127.0.0.1:1420)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f "$HOME/.cargo/env" ]]; then
  # shellcheck source=/dev/null
  source "$HOME/.cargo/env"
fi

# Free stale listeners from prior crashes
if command -v lsof >/dev/null 2>&1; then
  lsof -tiTCP:1420 -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null || true
fi

export PATH="${HOME}/.local/bin:${PATH}"
export SUPERSPEC_BIN="${SUPERSPEC_BIN:-$(cd "$ROOT/../.." && pwd)/packages/core/dist/cli.js}"

MODE="${1:-tauri}"

case "$MODE" in
  tauri|desktop)
    echo "==> Starting Ira Tauri dev → http://127.0.0.1:1420"
    exec pnpm tauri:dev
    ;;
  web|browser)
    echo "==> Starting Ira Vite only → http://127.0.0.1:1420"
    exec pnpm dev
    ;;
  *)
    echo "usage: $0 [tauri|web]" >&2
    exit 1
    ;;
esac
