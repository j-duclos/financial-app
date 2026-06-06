#!/usr/bin/env bash
# Print the exact Plaid env var names + whether local .env has values (not the secrets).
set -o errexit
ENV="${1:-$(dirname "$0")/../backend/.env}"
HOST="${RENDER_APP_HOST:-financial-app-5ywr.onrender.com}"

echo "=== Plaid keys for Render Web Service: ${HOST} ==="
echo ""
echo "In Render Dashboard → open the service whose URL is https://${HOST}"
echo "→ Environment → Add each variable manually (Key / Value):"
echo ""

for key in PLAID_CLIENT_ID PLAID_ENV PLAID_PRODUCTION_SECRET PLAID_REDIRECT_URI PLAID_TOKEN_FERNET_KEY; do
  if grep -q "^${key}=" "$ENV" 2>/dev/null; then
    val=$(grep "^${key}=" "$ENV" | head -1 | cut -d= -f2-)
    if [[ -n "$val" ]]; then
      echo "  ✓ ${key}  (copy value from backend/.env)"
    else
      echo "  ✗ ${key}  (EMPTY in backend/.env — set before pasting to Render)"
    fi
  else
    case "$key" in
      PLAID_ENV) echo "  → ${key}=production" ;;
      PLAID_REDIRECT_URI) echo "  → ${key}=https://${HOST}/plaid/oauth-return" ;;
      PLAID_TOKEN_FERNET_KEY)
        echo "  → ${key}  (run: cd backend && python manage.py plaid_fernet_key_for_render)"
        ;;
      *) echo "  ✗ ${key}  (missing from backend/.env)" ;;
    esac
  fi
done

echo ""
echo "Also required on that same Web Service (not Postgres):"
echo "  DJANGO_SECRET_KEY, DATABASE_URL (link budgeter DB), NODE_VERSION=20, DEBUG=false"
echo ""
echo "After Save → Manual Deploy, verify:"
echo "  https://${HOST}/api/plaid/config-check/"
echo "  → plaid_configured must be true"
