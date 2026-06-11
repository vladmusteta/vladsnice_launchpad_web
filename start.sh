#!/usr/bin/env bash
# Pornește ambele servicii în paralel
# Variabile de mediu disponibile:
#   BACKEND_HOST   (default: 0.0.0.0)
#   BACKEND_PORT   (default: 8000)
#   FRONTEND_HOST  (default: 0.0.0.0)
#   FRONTEND_PORT  (default: 5173)
#
# Exemplu: BACKEND_HOST=192.168.1.10 FRONTEND_HOST=192.168.1.10 ./start.sh
set -e
ROOT="$(dirname "$0")"

BACKEND_HOST="${BACKEND_HOST:-0.0.0.0}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

echo "▶  Starting Monitoring App..."
echo "   Backend  → http://${BACKEND_HOST}:${BACKEND_PORT}"
echo "   Frontend → http://${FRONTEND_HOST}:${FRONTEND_PORT}"
echo ""

# Install frontend deps if needed
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "▶  Installing npm dependencies..."
  cd "$ROOT/frontend" && npm install && cd "$ROOT"
fi

# Run both in background, kill both on Ctrl+C
trap 'kill $(jobs -p) 2>/dev/null; exit 0' INT TERM

export BACKEND_HOST BACKEND_PORT FRONTEND_HOST FRONTEND_PORT

"$ROOT/backend/.venv/bin/uvicorn" main:app \
  --app-dir "$ROOT/backend" \
  --host "$BACKEND_HOST" --port "$BACKEND_PORT" --reload &

cd "$ROOT/frontend" && npm run dev &

wait
