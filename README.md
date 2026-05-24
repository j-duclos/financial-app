# Budget App MVP

Production-ready MVP budgeting app with a Django REST backend, React web app, and Expo mobile app. Supports households, accounts (checking, savings, credit, etc.), transactions, transfers, categories, monthly budgets, and insights.

**Architecture:** Business logic lives in Django services and is exposed as REST APIs (`/api/`). The **web UI is React** (`apps/web/`). Render builds that React app and serves it from the same Django host as the API. Mobile uses the same APIs via `@budget-app/api-client`.

## Tech stack

- **Backend + API:** Django 5, Django REST Framework, PostgreSQL (Render) / SQLite (local), JWT, drf-spectacular (OpenAPI)
- **Web UI:** React 19, Vite, TypeScript, Tailwind CSS, React Query — `apps/web/src/pages/*.tsx`
- **Mobile:** Expo (React Native), TypeScript, React Query
- **Shared:** `packages/api-client`, `packages/shared`

## Monorepo layout

```
budget-app/
├── backend/          # Django API (+ build.sh copies React build to frontend_dist/ for Render)
├── apps/
│   ├── web/          # React web UI — edit these .tsx files
│   └── mobile/       # Expo + React Native
├── packages/
│   ├── api-client/   # Typed API client (web + mobile)
│   └── shared/       # Types and utils
├── docker-compose.yml
├── .env.example
└── README.md
```

## Web UI — local development (React)

Edit files under **`apps/web/src/`** (pages, components, hooks). This is the same code Render deploys.

### Day-to-day (hot reload)

Two terminals:

```bash
# Terminal 1 — API + SQLite (from repo root)
docker-compose up backend
```

```bash
# Terminal 2 — React dev server (from repo root, npm install once at repo root)
npm run dev:web
```

| URL | Role |
|-----|------|
| **http://localhost:5173** | **Web UI** — open this while developing |
| http://localhost:8000/api/ | REST API only |
| http://localhost:8000/api/docs/ | Swagger |

Vite proxies `/api` → `http://localhost:8000`, so leave `VITE_API_URL` unset in local dev. Docker uses your existing **`backend/db.sqlite3`** (`DATABASE_URL=""` in compose overrides the Postgres placeholder in `.env`).

> **Note:** http://localhost:8000/ without a React build shows Django template pages (`backend/web/`). That is a separate, minimal UI — **not** what you use for web development. Use **:5173** for the React app.

### Without Docker

```bash
cd backend
pip3 install -r requirements.txt
cp ../.env.example .env
# Comment out DATABASE_URL in .env to use backend/db.sqlite3
python3 manage.py migrate
python3 manage.py runserver
```

Then `npm run dev:web` from repo root → http://localhost:5173

### Test locally like Render (optional)

Before pushing, verify the production bundle on one host (same as Render):

```bash
npm run build:deploy -w @budget-app/web
rm -rf backend/frontend_dist && mkdir -p backend/frontend_dist
cp -r apps/web/dist/* backend/frontend_dist/
cd backend && SERVE_REACT_APP=true python3 manage.py runserver
```

Open http://localhost:8000 — React UI + API on one port, no Vite.

## Deploy to Render (React + API, root dir `backend/`)

Render **Root Directory = `backend`** is correct. The monorepo root is still cloned; `backend/build.sh` goes up one level, runs `npm install` + `npm run build:deploy -w @budget-app/web`, and copies `apps/web/dist/` → `backend/frontend_dist/`. On Render, `SERVE_REACT_APP` defaults to **true**, so your app URL serves the React build and `/api/` on the same hostname.

**Web Service settings:**

| Setting | Value |
|---------|--------|
| Root Directory | `backend` |
| Build Command | `chmod +x build.sh && ./build.sh` |
| Start Command | `gunicorn config.wsgi:application --bind 0.0.0.0:$PORT` |
| `NODE_VERSION` | `20` (required — Render won't run npm without this) |

When you push changes to `apps/web/src/**/*.tsx`, Render rebuilds the React app automatically. No separate static site is required unless you want a split deploy (see `RENDER_DEPLOYMENT.md`).

**Database on Render:** Create a Postgres instance and **link it** to the Web Service. Render injects `DATABASE_URL` automatically. Do **not** set `DATABASE_URL` to `localhost` in Render env vars — that causes `Connection refused` during `migrate` in `build.sh`.

Full env var checklist: `RENDER_DEPLOYMENT.md`.

## Mobile app

```bash
cd apps/mobile
npm install
npx expo start
```

- Set `EXPO_PUBLIC_API_URL=http://localhost:8000` (e.g. in `.env` or app config) so the device/emulator can reach the API.

## Other commands

### Generate API client (optional)

After the backend is running and serving the OpenAPI schema:

```bash
cd packages/api-client
npm run generate
```

(Otherwise the hand-written client in `packages/api-client/src/api.ts` is used.)

### Backend tests

```bash
cd backend
python3 -m pytest
```

### Upcoming charge notifications (daily job)

Notifications remind users 1 day before a recurring rule charge is due. Run daily (e.g. cron at 06:00):

```bash
cd backend
python3 manage.py create_upcoming_charge_notifications
```

Optional: limit to one household: `--household_id=1`

## Key files

| Area | Location |
|------|----------|
| Django settings | `backend/config/settings.py` |
| Household / membership | `backend/core/models.py` |
| Account model | `backend/accounts/models.py` |
| Transaction + Transfer | `backend/transactions/models.py` |
| Transaction & transfer logic | `backend/transactions/services.py` |
| Budget model | `backend/budgets/models.py` |
| Category model + seed | `backend/categories/models.py`, `backend/categories/signals.py`, `backend/categories/management/commands/seed_categories.py` |
| Permissions | `backend/core/permissions.py` |
| Auth (JWT + register) | `backend/core/views.py`, `backend/core/urls.py` |
| Insights | `backend/insights/views.py` |
| **React web UI** | `apps/web/src/pages/`, `apps/web/src/components/`, `apps/web/src/App.tsx` |
| API client | `packages/api-client/src/api.ts`, `packages/api-client/src/config.ts` |
| Render build | `backend/build.sh` → copies `apps/web/dist/` to `backend/frontend_dist/` |
| Django template UI (legacy) | `backend/web/` — not used for React web development |
| Shared types/utils | `packages/shared/src/` |
| Mobile | `apps/mobile/context/AuthContext.tsx`, `apps/mobile/app/(tabs)/` |

## Features (MVP)

- User sign up / login / logout (JWT + refresh)
- Households: create and list; accounts belong to a household
- Account types: Checking, Savings, Credit, Cash, Investment, 401k, Other
- Transactions: date, payee, amount (signed: + inflow, − outflow), category, memo, cleared/reconciled, tags
- Transfers: create linked pair of transactions across two accounts (atomic)
- Categories: hierarchical, INCOME/EXPENSE; default seed on household create
- Monthly budgets per category; dashboard shows planned vs spent vs remaining
- Reports: monthly summary (income, expenses, net), category breakdown, account balances
- Data: Decimal for money; balances computed from transactions; ownership enforced via household membership
- **Upcoming charge notifications:** In-app reminders 1 day before a recurring rule (expense/transfer) is due; created by the `create_upcoming_charge_notifications` management command (run daily)

## Lint / format (backend)

Recommended: `black`, `isort`, `ruff` (configure in `pyproject.toml` or `ruff.toml`). Frontend: ESLint + Prettier in `apps/web` and `apps/mobile`.
