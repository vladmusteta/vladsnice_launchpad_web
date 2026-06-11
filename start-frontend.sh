#!/usr/bin/env bash
# Pornește frontend-ul React
# FRONTEND_HOST (default: 0.0.0.0)  FRONTEND_PORT (default: 5173)
set -e
cd "$(dirname "$0")/frontend"

if [ ! -d node_modules ]; then
  echo "▶  Installing npm dependencies..."
  npm install
fi

HOST="${FRONTEND_HOST:-0.0.0.0}"
PORT="${FRONTEND_PORT:-5173}"
export FRONTEND_HOST="$HOST" FRONTEND_PORT="$PORT"
echo "▶  Starting frontend on http://${HOST}:${PORT} ..."
npm run dev
