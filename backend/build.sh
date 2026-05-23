#!/usr/bin/env bash
# Render build script — run from backend/ (Root Directory on Render Web Service).
set -o errexit

pip install -r requirements.txt

PYTHON="${PYTHON:-python3}"
command -v "$PYTHON" >/dev/null 2>&1 || PYTHON=python

# Build React app into frontend_dist/ (same origin as API on Render).
BUILD_FRONTEND="${BUILD_FRONTEND:-true}"
if [ "$BUILD_FRONTEND" = "true" ] && [ -f "../package.json" ]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "ERROR: npm is required to build the React UI. Use a Render stack with Node, or set BUILD_FRONTEND=false."
    exit 1
  fi
  echo "Building React frontend (@budget-app/web)..."
  (
    cd ..
    npm install
    # Same-origin API: do not set VITE_API_URL (AuthContext uses "").
    npm run build:deploy -w @budget-app/web
  )
  rm -rf frontend_dist
  mkdir -p frontend_dist
  cp -r ../apps/web/dist/* frontend_dist/
  echo "Frontend copied to backend/frontend_dist ($(find frontend_dist -type f | wc -l | tr -d ' ') files)."
fi

"$PYTHON" manage.py collectstatic --no-input
"$PYTHON" manage.py migrate --no-input
