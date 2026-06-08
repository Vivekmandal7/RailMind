#!/usr/bin/env bash
# RailMind one-command dev launcher: brings up the Python engine (FastAPI/WS)
# and the Next.js control room, connected. Ctrl-C stops both.
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

echo "==> Starting backend on http://127.0.0.1:8000"
( cd "$BACKEND" && exec .venv/bin/uvicorn railmind.app:app --host 127.0.0.1 --port 8000 ) &
BACK_PID=$!

echo "==> Starting frontend on http://localhost:3000"
( cd "$FRONTEND" && NEXT_PUBLIC_BACKEND_URL="http://127.0.0.1:8000" exec npm run dev ) &
FRONT_PID=$!

echo ""
echo "RailMind is starting:"
echo "  Engine  : http://127.0.0.1:8000  (REST + ws://127.0.0.1:8000/stream)"
echo "  Control : http://localhost:3000"
echo "Press Ctrl-C to stop."
wait
