#!/usr/bin/env bash
# Pornește backend-ul FastAPI
# BACKEND_HOST (default: 0.0.0.0)  BACKEND_PORT (default: 8000)
set -e
cd "$(dirname "$0")/backend"
HOST="${BACKEND_HOST:-0.0.0.0}"
PORT="${BACKEND_PORT:-8000}"
echo "▶  Starting backend on http://${HOST}:${PORT} ..."
.venv/bin/uvicorn main:app --host "$HOST" --port "$PORT" --reload
