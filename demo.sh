#!/usr/bin/env bash
# RailMind PITCH / DEMO launcher — runs the PRODUCTION build of the control room.
#
# Why this exists: `next dev` ships a red error overlay that surfaces Mapbox GL's
# benign "AbortError: signal is aborted without reason" (thrown when it cancels
# outdated map tiles on a style/satellite switch). A PRODUCTION build has no such
# overlay, so the demo is clean. Use this when presenting; use dev.sh while coding.
#
# Ctrl-C stops both the engine and the control room.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

PY="${PYTHON:-python3.13}"
command -v "$PY" >/dev/null 2>&1 || PY="python3"

echo "==> Setting up backend venv"
if [ ! -d "$BACKEND/.venv" ]; then
  "$PY" -m venv "$BACKEND/.venv"
  "$BACKEND/.venv/bin/pip" install -q --upgrade pip
  "$BACKEND/.venv/bin/pip" install -q -r "$BACKEND/requirements.txt"
fi

echo "==> Installing frontend deps"
if [ ! -d "$FRONTEND/node_modules" ]; then
  (cd "$FRONTEND" && npm install)
fi

cleanup() {
  echo ""
  echo "==> Shutting down"
  kill "${BACK_PID:-}" "${FRONT_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "==> Training delay forecaster if missing"
if [ ! -f "$BACKEND/models/delay_forecaster.joblib" ]; then
  ( cd "$BACKEND" && PYTHONPATH=. .venv/bin/python -m railmind.train_delay )
fi

echo "==> Building control room (production, no dev overlay)"
( cd "$FRONTEND" && NEXT_PUBLIC_BACKEND_URL="http://127.0.0.1:8000" npm run build )

echo "==> Starting backend on http://127.0.0.1:8000"
( cd "$BACKEND" && PYTHONPATH=. exec .venv/bin/uvicorn railmind.app:app --host 127.0.0.1 --port 8000 ) &
BACK_PID=$!

echo "==> Starting control room (production) on http://localhost:3000"
( cd "$FRONTEND" && NEXT_PUBLIC_BACKEND_URL="http://127.0.0.1:8000" exec npm start ) &
FRONT_PID=$!

echo ""
echo "RailMind (DEMO MODE) is starting:"
echo "  Engine  : http://127.0.0.1:8000  (REST + ws://127.0.0.1:8000/stream)"
echo "  Control : http://localhost:3000  (production build — no error overlay)"
echo "Press Ctrl-C to stop."
wait
