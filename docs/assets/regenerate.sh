#!/usr/bin/env bash
# Regenerate README demo assets (GIF + screenshots).
# Prereqs: backend :8000, frontend :3000 running.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ASSETS="$ROOT/docs/assets"
cd "$ASSETS"
npm install --silent
npx playwright install chromium
node capture-demo.js
"$ROOT/backend/.venv/bin/pip" install -q pillow
"$ROOT/backend/.venv/bin/python" build-gif.py
echo "Done — see docs/assets/demo.gif"
