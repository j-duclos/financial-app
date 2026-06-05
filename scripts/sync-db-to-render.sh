#!/usr/bin/env bash
# Copy local Docker Postgres → Render Postgres (OVERWRITES production data).
set -o errexit

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_RENDER="$ROOT/backend/.env.render"
LOCAL_URL="${LOCAL_DATABASE_URL:-postgres://budget:budget@localhost:5433/budget}"
DUMP="$ROOT/backend/.local-db.dump"

if [[ ! -f "$ENV_RENDER" ]]; then
  echo "Missing $ENV_RENDER"
  echo "Create it with one line: DATABASE_URL=postgresql://...@dpg-....render.com/db?sslmode=require"
  exit 1
fi

RENDER_URL="$(grep -E '^DATABASE_URL=' "$ENV_RENDER" | head -1 | cut -d= -f2- | tr -d '"')"
if [[ -z "$RENDER_URL" ]]; then
  echo "DATABASE_URL not set in $ENV_RENDER"
  exit 1
fi

if [[ "${1:-}" != "--yes" ]]; then
  echo "This OVERWRITES all data on Render Postgres with your local Docker copy."
  echo "Re-run with: $0 --yes"
  exit 1
fi

echo "=== Sync local → Render ==="
echo "Source: $LOCAL_URL"
echo "Target: Render (external)"
echo ""

docker compose -f "$ROOT/docker-compose.yml" up -d postgres >/dev/null

echo "Dumping local Postgres…"
docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -v "$ROOT/backend:/out" \
  postgres:18 \
  pg_dump "postgres://budget:budget@host.docker.internal:5433/budget" \
    --no-owner --no-acl -Fc -f /out/.local-db.dump

echo "Terminating active Render DB sessions (required for --clean restore)…"
docker run --rm postgres:18 psql "$RENDER_URL" -v ON_ERROR_STOP=1 -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();" \
  >/dev/null || true

echo "Restoring into Render (may take 2–5 min)…"
docker run --rm \
  -v "$ROOT/backend:/in" \
  postgres:18 \
  pg_restore \
    -d "$RENDER_URL" \
    --clean --if-exists --no-owner --no-acl \
    /in/.local-db.dump

rm -f "$DUMP"
echo ""
echo "Done. Render now matches your local Docker database."
echo "If the live site looks stale, trigger a manual deploy or wait for Render to reconnect."
