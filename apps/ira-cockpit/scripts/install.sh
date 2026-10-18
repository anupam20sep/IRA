#!/usr/bin/env bash
# Ira Cockpit — local install (dev + tooling prerequisites)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MONOREPO="$(cd "$ROOT/../.." && pwd)"
cd "$ROOT"

echo "==> Ira Cockpit install"
echo "    cockpit:  $ROOT"
echo "    monorepo: $MONOREPO"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: missing '$1' — $2" >&2
    exit 1
  fi
}

need node "install Node.js 20+ (https://nodejs.org)"
need pnpm "corepack enable && corepack prepare pnpm@latest --activate"
need cargo "install Rust (https://rustup.rs) — required for Tauri desktop"

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "error: Node 20+ required (found $(node -v))" >&2
  exit 1
fi

# Ensure cargo env for this shell when rustup is present
if [[ -f "$HOME/.cargo/env" ]]; then
  # shellcheck source=/dev/null
  source "$HOME/.cargo/env"
fi

echo "==> Installing JS dependencies (workspace)"
cd "$MONOREPO"
pnpm install

echo "==> Building SuperSpec CLI (packages/core)"
if [[ -f "$MONOREPO/packages/core/package.json" ]]; then
  pnpm --filter @superspec-dev/core build 2>/dev/null \
    || pnpm --filter ./packages/core build 2>/dev/null \
    || (cd "$MONOREPO/packages/core" && pnpm build)
else
  echo "warn: packages/core not found — set SUPERSPEC_BIN later"
fi

echo "==> Syncing ira.config.json → public/"
cd "$ROOT"
if [[ -f ira.config.json ]]; then
  mkdir -p public
  cp ira.config.json public/ira.config.json
fi

echo "==> Optional: Cursor Agent CLI"
if command -v cursor-agent >/dev/null 2>&1 || command -v agent >/dev/null 2>&1; then
  echo "    cursor-agent: OK ($(command -v cursor-agent 2>/dev/null || command -v agent))"
else
  echo "    not installed — run: curl https://cursor.com/install -fsS | bash"
  echo "    then: export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

echo ""
echo "Install complete."
echo "  Dev:        pnpm --filter ira-cockpit start"
echo "              or:  ./scripts/dev.sh"
echo "  Production: ./scripts/build-production.sh"
echo "  Docs:       README.md"
