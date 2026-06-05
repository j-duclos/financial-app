#!/usr/bin/env bash
# Production gunicorn entrypoint — worker count from GUNICORN_WORKERS (default 2 on paid tiers).
set -o errexit
WORKERS="${GUNICORN_WORKERS:-2}"
THREADS="${GUNICORN_THREADS:-4}"
TIMEOUT="${GUNICORN_TIMEOUT:-120}"
exec gunicorn config.wsgi:application \
  --bind "0.0.0.0:${PORT:-8000}" \
  --timeout "$TIMEOUT" \
  --workers "$WORKERS" \
  --threads "$THREADS"
