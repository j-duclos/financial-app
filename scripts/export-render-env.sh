#!/usr/bin/env bash
# Merge local backend/.env + backend/.env.render into a Render bulk-import file.
# Does not print to stdout — writes scripts/.render-env-export (gitignored pattern: do not commit).
set -o errexit

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/scripts/.render-env-export"
ENV_LOCAL="$ROOT/backend/.env"
ENV_RENDER="$ROOT/backend/.env.render"

if [[ ! -f "$ENV_LOCAL" ]]; then
  echo "Missing $ENV_LOCAL"
  exit 1
fi

{
  echo "# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) — paste into Render → Environment → Add from .env"
  echo "DEBUG=false"
  echo "NODE_VERSION=20"
  echo "GUNICORN_WORKERS=2"
  echo "GUNICORN_THREADS=4"
  if [[ -f "$ENV_RENDER" ]]; then
    grep -E '^DATABASE_URL=' "$ENV_RENDER" || true
  fi
  grep -E '^(DJANGO_SECRET_KEY|ALLOWED_HOSTS|CSRF_TRUSTED_ORIGINS|CORS_ALLOWED_ORIGINS|PLAID_[A-Z0-9_]+|REDIS_URL|GUNICORN_[A-Z0-9_]+)=' "$ENV_LOCAL" \
    | grep -v '^DEBUG=' || true
  # PLAID_REDIRECT_URI is often commented in .env — set explicitly for Render
  if ! grep -q '^PLAID_REDIRECT_URI=' "$OUT" 2>/dev/null; then
    echo "PLAID_REDIRECT_URI=https://financial-app-1-tu0l.onrender.com/plaid/oauth-return"
  fi
} > "$OUT"

echo "Wrote $OUT"
echo "Next:"
echo "  1. Edit DJANGO_SECRET_KEY in that file (use a NEW production secret, not change-me-in-production)"
echo "  2. Set ALLOWED_HOSTS / CSRF_TRUSTED_ORIGINS / PLAID_REDIRECT_URI to your *.onrender.com host"
echo "  3. Render Dashboard → your Web Service → Environment → Add from .env → paste file contents"
echo "  4. Link Postgres if DATABASE_URL is empty"
echo "  5. Save → Manual Deploy"
