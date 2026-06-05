# Production image for Docker-based deploys (Render Docker, Fly.io, etc.).
# Recommended on Render: use Native Python with Root Directory `backend` and ./build.sh
# (see RENDER_DEPLOYMENT.md). This file exists so Docker runtime finds a Dockerfile at repo root.

# --- React frontend (Vite) ---
FROM node:20-slim AS frontend
WORKDIR /repo
COPY package.json package-lock.json ./
COPY scripts ./scripts
COPY apps/web/package.json ./apps/web/
COPY apps/mobile/package.json ./apps/mobile/
COPY packages/api-client/package.json ./packages/api-client/
COPY packages/shared/package.json ./packages/shared/
RUN npm ci --workspace=@budget-app/web --include-workspace-root
COPY apps/web ./apps/web
COPY packages ./packages
RUN npm run build:deploy -w @budget-app/web

# --- Django API + static frontend ---
FROM python:3.11-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY --from=frontend /repo/apps/web/dist ./frontend_dist/

EXPOSE 8000
CMD ["sh", "-c", "python manage.py migrate --no-input && exec gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8000} --timeout ${GUNICORN_TIMEOUT:-120} --workers ${GUNICORN_WORKERS:-2} --threads ${GUNICORN_THREADS:-4}"]
