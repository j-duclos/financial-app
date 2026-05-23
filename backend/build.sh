#!/usr/bin/env bash
# Render build script — run from backend/ (Root Directory on Render Web Service).
set -o errexit

pip install -r requirements.txt

PYTHON="${PYTHON:-python3}"
command -v "$PYTHON" >/dev/null 2>&1 || PYTHON=python

"$PYTHON" manage.py collectstatic --no-input
"$PYTHON" manage.py migrate --no-input
