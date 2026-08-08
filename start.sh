#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo
echo "================================================"
echo "  SUUWETHAAN AI - setup and launch"
echo "================================================"
echo

if ! command -v python3 >/dev/null 2>&1 && ! command -v python >/dev/null 2>&1; then
  echo "[ERROR] Python was not found."
  echo "Install Python 3.10+ then run this script again."
  exit 1
fi

if command -v python3 >/dev/null 2>&1; then
  PY=python3
else
  PY=python
fi

if [ ! -x ".venv/bin/python" ]; then
  echo "[1/3] Creating virtual environment..."
  "$PY" -m venv .venv
else
  echo "[1/3] Virtual environment already exists."
fi

echo "[2/3] Installing dependencies..."
.venv/bin/python -m pip install --upgrade pip >/dev/null 2>&1 || true
.venv/bin/python -m pip install -r requirements.txt

if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    echo "[info] Creating .env from .env.example — add your API key inside."
    cp .env.example .env
  else
    echo "[ERROR] Missing .env file. Create one with API_KEY=..."
    exit 1
  fi
fi

echo "[3/3] Starting SUUWETHAAN AI..."
echo
exec .venv/bin/python app.py
