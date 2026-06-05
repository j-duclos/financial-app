#!/usr/bin/env bash
# Copy Render Postgres → local Docker Postgres (fast local dev, same data as production).
set -o errexit

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_RENDER="$ROOT/backend/.env.render"
LOCAL_URL="${LOCAL_DATABASE_URL:-postgres://budget:budget@localhost:5433/budget}"
DUMP="$ROOT/backend/.render-db.dump"

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

echo "=== Sync Render → local ==="
echo "Source: Render (external)"
echo "Target: $LOCAL_URL"
echo ""

docker compose -f "$ROOT/docker-compose.yml" up -d postgres >/dev/null

echo "Dumping from Render (may take 1–3 min)…"
docker run --rm \
  -v "$ROOT/backend:/out" \
  postgres:18 \
  pg_dump "$RENDER_URL" --no-owner --no-acl -Fc -f /out/.render-db.dump

echo "Restoring into local Postgres…"
docker run --rm \
  -v "$ROOT/backend:/in" \
  --add-host=host.docker.internal:host-gateway \
  postgres:18 \
  pg_restore \
    -d "postgres://budget:budget@host.docker.internal:5433/budget" \
    --clean --if-exists --no-owner --no-acl \
    /in/.render-db.dump

rm -f "$DUMP"
echo ""
echo "Done. Local backend/.env should use: postgres://budget:budget@localhost:5433/budget"
echo "Restart backend: docker compose up -d --force-recreate backend"
exit 0
