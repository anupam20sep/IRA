#!/usr/bin/env bash
# Ira Cockpit — smoke verify (unit + staging + engine detect)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MONOREPO="$(cd "$ROOT/../.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/.local/bin:${PATH}"
export SUPERSPEC_BIN="${SUPERSPEC_BIN:-$MONOREPO/packages/core/dist/cli.js}"

echo "==> Unit / module tests"
pnpm test

echo "==> Staging HTTP suite"
pnpm test:staging

echo "==> Engine detect"
node --experimental-strip-types -e "
import { detectEngines } from './src/backend/engines.ts';
const p = await detectEngines();
for (const e of p.engines) {
  console.log(\`  \${e.id.padEnd(14)} installed=\${e.installed} hostSpawnOnly=\${e.hostSpawnOnly}\`);
}
"

echo ""
echo "Verify OK."
