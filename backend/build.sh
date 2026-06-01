#!/usr/bin/env bash
# Render build script — run from backend/ (Root Directory on Render Web Service).
set -o errexit

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$BACKEND_DIR"
REPO_ROOT="$(cd "$BACKEND_DIR/.." && pwd)"

echo "=== budget-app build.sh ==="
echo "BACKEND_DIR=$BACKEND_DIR"
echo "REPO_ROOT=$REPO_ROOT"
echo "RENDER=${RENDER:-unset}"
echo "NODE_VERSION=${NODE_VERSION:-unset}"
echo "BUILD_FRONTEND=${BUILD_FRONTEND:-true}"
if [ -f "$REPO_ROOT/package.json" ]; then
  echo "Found monorepo package.json"
else
  echo "MISSING $REPO_ROOT/package.json — is Root Directory set to backend with full repo cloned?"
fi
if command -v npm >/dev/null 2>&1; then
  echo "npm: $(command -v npm) ($(npm --version))"
else
  echo "npm: NOT FOUND — set NODE_VERSION=20 (Render) or NIXPACKS_NODE_VERSION=20 (Railway)"
fi

PYTHON="${PYTHON:-python3}"
command -v "$PYTHON" >/dev/null 2>&1 || PYTHON=python
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "ERROR: python not found."
  echo "       Railway: commit budget-app/nixpacks.toml (providers = node + python) at repo root."
  echo "       Render: use a Python runtime with NODE_VERSION=20 for the frontend build."
  exit 1
fi
echo "python: $($PYTHON --version) at $(command -v "$PYTHON")"
if ! "$PYTHON" -m pip --version >/dev/null 2>&1; then
  echo "WARN: pip module not available for $PYTHON in this build stage."
  echo "      Trying to bootstrap pip with ensurepip..."
  "$PYTHON" -m ensurepip --upgrade >/dev/null 2>&1 || true
fi

if "$PYTHON" -m pip --version >/dev/null 2>&1; then
  "$PYTHON" -m pip install -r requirements.txt
else
  echo "WARN: pip still unavailable; assuming dependencies were installed by platform install phase."
fi

if ! "$PYTHON" -c "import django" >/dev/null 2>&1; then
  echo "ERROR: Django is not installed in this build environment."
  echo "       Railway: ensure nixpacks.toml install phase runs python -m pip install -r backend/requirements.txt"
  exit 1
fi

_on_render() {
  case "${RENDER:-}" in true|1|yes|TRUE) return 0 ;; esac
  return 1
}

# Render installs Node when NODE_VERSION is set on the service (Dashboard → Environment).
_prepend_render_node() {
  if [ ! -d /opt/render/project/nodes ]; then
    return 1
  fi
  local node_dir
  node_dir="$(find /opt/render/project/nodes -maxdepth 1 -type d -name 'node-*' 2>/dev/null | sort -V | tail -1)"
  if [ -n "$node_dir" ] && [ -x "$node_dir/bin/npm" ]; then
    export PATH="$node_dir/bin:$PATH"
    echo "Using Render Node at $node_dir"
    return 0
  fi
  return 1
}

_build_frontend() {
  if [ ! -f "$REPO_ROOT/package.json" ]; then
    echo "ERROR: Monorepo package.json not found at $REPO_ROOT/package.json"
    echo "       Render Root Directory should be 'backend' with the full repo cloned."
    return 1
  fi

  _prepend_render_node || true

  if ! command -v npm >/dev/null 2>&1; then
    echo "ERROR: npm not found."
    echo "       On Render: add environment variable NODE_VERSION=20 (or 22) and redeploy."
    return 1
  fi

  echo "Building React frontend (@budget-app/web)..."
  (
    cd "$REPO_ROOT"
    npm install
    npm run build:deploy -w @budget-app/web
  )

  local dist="$REPO_ROOT/apps/web/dist"
  if [ ! -f "$dist/index.html" ]; then
    echo "ERROR: Vite build did not produce $dist/index.html"
    return 1
  fi

  rm -rf "$BACKEND_DIR/frontend_dist"
  mkdir -p "$BACKEND_DIR/frontend_dist"
  cp -r "$dist/"* "$BACKEND_DIR/frontend_dist/"
  echo "Frontend copied to $BACKEND_DIR/frontend_dist ($(find "$BACKEND_DIR/frontend_dist" -type f | wc -l | tr -d ' ') files)."
}

BUILD_FRONTEND="${BUILD_FRONTEND:-true}"
if [ "$BUILD_FRONTEND" = "true" ]; then
  if _build_frontend; then
    :
  elif [ -f "$BACKEND_DIR/frontend_dist/index.html" ]; then
    echo "WARN: npm build failed; using frontend_dist already in the repo."
    echo "      Set NODE_VERSION=20 on Render to rebuild React on each deploy."
  else
    echo "ERROR: React frontend build failed and backend/frontend_dist/index.html is missing."
    exit 1
  fi
fi

if [ "$BUILD_FRONTEND" = "true" ] && [ ! -f "$BACKEND_DIR/frontend_dist/index.html" ]; then
  echo "ERROR: frontend_dist/index.html missing after build."
  exit 1
fi

"$PYTHON" manage.py collectstatic --no-input
"$PYTHON" manage.py migrate --no-input
