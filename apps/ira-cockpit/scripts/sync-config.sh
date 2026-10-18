#!/usr/bin/env bash
# Copy ira.config.json → public/ for Vite static serve
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/public"
cp -f "$ROOT/ira.config.json" "$ROOT/public/ira.config.json"
echo "Synced ira.config.json → public/ira.config.json"
