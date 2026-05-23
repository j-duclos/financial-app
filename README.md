# Budget App MVP

Production-ready MVP budgeting app with a Django REST backend, React web app, and Expo mobile app. Supports households, accounts (checking, savings, credit, etc.), transactions, transfers, categories, monthly budgets, and insights.

## Tech stack

- **Backend:** Django 5, Django REST Framework, PostgreSQL, JWT (djangorestframework-simplejwt), drf-spectacular (OpenAPI)
- **Web:** React 19, Vite, TypeScript, Tailwind CSS, React Query
- **Mobile:** Expo (React Native), TypeScript, React Query
- **Shared:** OpenAPI-derived API contract; `packages/api-client` (typed client), `packages/shared` (types/utils)

## Monorepo layout

```
budget-app/
├── backend/          # Django project (config/, core, accounts, transactions, budgets, categories, insights)
├── apps/
│   ├── web/          # React + Vite + Tailwind
│   └── mobile/       # Expo + React Native
├── packages/
│   ├── api-client/   # Typed API client (shared by web + mobile)
│   └── shared/       # Types and utils
├── docker-compose.yml
├── .env.example
└── README.md
```

## Commands to run everything locally

### Backend (Django)

```bash
cd backend
pip install -r requirements.txt
cp ../.env.example .env   # or set DATABASE_URL, SECRET_KEY, etc.
python manage.py migrate
python manage.py runserver

docker compose exec backend python manage.py makemigrations
docker compose exec backend python manage.py migrate
```

- API: http://localhost:8000/api/
- Swagger UI: http://localhost:8000/api/docs/
- OpenAPI schema: http://localhost:8000/api/schema/

### With Docker

```bash
docker-compose up -d postgres
docker-compose up backend
```

**After changing backend code** you must rebuild the image (code is copied at build time, not mounted):

```bash
docker-compose up -d --build backend
```

**Check that the API is running new code:** In browser DevTools → Network, when the timeline is requested, the response should have header `X-Timeline-Skip-Logic: 1`. If that header is missing, the container is still running old code — rebuild again.

To run the timeline skip debug command **inside the same container that serves the API** (and with the same account filter as the Transactions page):

```bash
docker-compose exec backend python manage.py debug_timeline_skip
docker-compose exec backend python manage.py debug_timeline_skip --account_id=1
```
Use `--account_id=1` when you're viewing the Chase account so the debug uses the same "single account" path as the API.

### Web app

```bash
cd apps/web
npm install
npm run dev
```

- App: http://localhost:5173  
- Set `VITE_API_URL=http://localhost:8000` if needed (default in .env.example).

### Mobile app

```bash
cd apps/mobile
npm install
npx expo start
```

- Set `EXPO_PUBLIC_API_URL=http://localhost:8000` (e.g. in `.env` or app config) so the device/emulator can reach the API.

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
pytest
```

### Upcoming charge notifications (daily job)

Notifications remind users 1 day before a recurring rule charge is due. Run daily (e.g. cron at 06:00):

```bash
cd backend
python manage.py create_upcoming_charge_notifications
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
| API client | `packages/api-client/src/api.ts`, `packages/api-client/src/config.ts` |
| Shared types/utils | `packages/shared/src/` |
| Web auth + layout | `apps/web/src/context/AuthContext.tsx`, `apps/web/src/App.tsx` |
| Mobile auth + tabs | `apps/mobile/context/AuthContext.tsx`, `apps/mobile/app/(auth)/`, `apps/mobile/app/(tabs)/` |

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
