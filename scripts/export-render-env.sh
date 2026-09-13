#!/usr/bin/env bash
# Merge local backend/.env + backend/.env.render into a Render bulk-import file.
# Does not print to stdout — writes scripts/.render-env-export (gitignored pattern: do not commit).
set -o errexit

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/scripts/.render-env-export"
ENV_LOCAL="$ROOT/backend/.env"
ENV_RENDER="$ROOT/backend/.env.render"
# Your live app URL — must match the Web Service you configure in Render (not a stale/other service).
RENDER_APP_HOST="${RENDER_APP_HOST:-financial-app-5ywr.onrender.com}"
CUSTOM_DOMAIN="${CUSTOM_DOMAIN:-flowsight360.com}"

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
  grep -E '^(PLAID_CLIENT_ID|PLAID_ENV|PLAID_PRODUCTION_SECRET|PLAID_SANDBOX_SECRET|PLAID_DEVELOPMENT_SECRET|PLAID_SECRET|PLAID_TOKEN_FERNET_KEY|REDIS_URL)=' "$ENV_LOCAL" \
    | grep -v '^PLAID_TOKEN_FERNET_KEY=$' || true
  echo "ALLOWED_HOSTS=${CUSTOM_DOMAIN},www.${CUSTOM_DOMAIN},${RENDER_APP_HOST},.onrender.com"
  echo "CSRF_TRUSTED_ORIGINS=https://${CUSTOM_DOMAIN},https://www.${CUSTOM_DOMAIN},https://${RENDER_APP_HOST}"
  echo "FRONTEND_ORIGIN=https://${CUSTOM_DOMAIN}"
  echo "PLAID_REDIRECT_URI=https://${CUSTOM_DOMAIN}/plaid/oauth-return"
} > "$OUT"

echo "Wrote $OUT"
echo "Next:"
echo "  1. Edit DJANGO_SECRET_KEY in that file (use a NEW production secret, not change-me-in-production)"
echo "  2. Confirm ALLOWED_HOSTS / CSRF_TRUSTED_ORIGINS / PLAID_REDIRECT_URI include ${CUSTOM_DOMAIN} and ${RENDER_APP_HOST}"
echo "  3. Render Dashboard → Web Service ${RENDER_APP_HOST} → Environment → Add from .env"
echo "  4. Link Postgres if DATABASE_URL is empty"
echo "  5. Save → Manual Deploy"
