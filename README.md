# Budget App
Production-ready budgeting app with a Django REST backend, React web app, and Expo mobile app. Supports households, accounts (checking, savings, credit, etc.), transactions, transfers, categories, monthly budgets, and insights.

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

## Web UI — local development (React + Vite)

Edit files under **`apps/web/src/`** (pages, components, hooks). This is the same code Render deploys. Local UI work uses the **Vite dev server** (`apps/web/`) for hot reload; production and Render use `vite build` output served by Django.

See **[Web UI — app tour](#web-ui--app-tour)** for what each page and nav item does.

### Running Vite

**One-time setup** (from repo root — installs web, mobile, and shared packages):

```bash
npm install
```

Start the Vite dev server (pick one):

```bash
# From repo root (recommended) — dev:web is NOT defined inside apps/web/
npm run dev:web
```

```bash
# From apps/web/
cd apps/web
npm run dev
# same as: npx vite
```

Open **http://localhost:5173** (or the port Vite prints if 5173 is already in use — run only **one** Vite instance). Vite proxies browser requests for `/api/*` to `http://localhost:8000` (see `apps/web/vite.config.ts`), so leave **`VITE_API_URL` unset** in local dev.

On startup, Vite prints the **Plaid redirect URI** for your current port. The same URL appears under **Accounts → Bank connections (Plaid)** in the UI.

| URL | Role |
|-----|------|
| **http://localhost:5173** | **Web UI (Vite)** — use this while developing |
| http://localhost:8000/api/ | REST API only |
| http://localhost:8000/api/docs/ | Swagger |

**Other Vite commands** (from repo root or `apps/web/`):

| Command | Purpose |
|---------|---------|
| `npm run dev:web` / `npm run dev -w @budget-app/web` | Dev server with HMR |
| `npm run build:web` | Production build → `apps/web/dist/` |
| `npm run preview -w @budget-app/web` | Serve the production build locally (default **http://localhost:4173**) |
| `npm run serve:web` | Build + preview in one step |
| `npm run tunnel` (from `apps/web/`) | HTTPS tunnel via localhost.run for Plaid OAuth (Chase) |

The backend must be running separately — Vite only serves the React app and proxies API calls.

### Plaid (local dev)

**Sandbox (fake banks only):** `PLAID_ENV=sandbox` in `backend/.env`. Allowlist `http://localhost:5173/plaid/oauth-return` in [Plaid Dashboard → Developers → API](https://dashboard.plaid.com/developers/api). Open the app at that same origin. Vite prints this URL on startup.

**Real banks (your actual Chase, etc.):** Docker reads **`backend/.env` only** (not the Plaid Dashboard alone). Set:

```env
PLAID_CLIENT_ID=<from Plaid Team → Keys>
PLAID_PRODUCTION_SECRET=<Production secret from same page>
PLAID_ENV=production
```

Then reload env into Docker (**`restart` is not enough** — `env_file` is read at container create):

```bash
docker compose up -d --force-recreate backend
docker compose exec backend python manage.py plaid_verify
```

You should see `PLAID_ENV: 'production'` and non-zero secret length. Plaid **rejects** `http://localhost` for production. You need either:

> **If Plaid “used to work” locally:** check `backend/.env` still has `PLAID_CLIENT_ID` and secrets — a “Changed templates” commit once wiped them to empty placeholders. Restore from git: `git show 019201e:backend/.env` (pick a commit before the wipe) and copy the `PLAID_*` lines back.

- **Render (simplest):** use `https://<your-service>.onrender.com/plaid/oauth-return` in Plaid Dashboard and in the browser — see `RENDER_DEPLOYMENT.md`, or
- **Local HTTPS tunnel** (below). The `https://….lhr.life` URL is **not** shown by Vite — it appears only after you run `npm run tunnel` in another terminal.

**OAuth banks via tunnel (three terminals):**

```bash
# Terminal 1 — API
docker-compose up backend
```

```bash
# Terminal 2 — Vite (repo root)
npm run dev:web
```

```bash
# Terminal 3 — tunnel (apps/web; default port 5173 — pass your Vite port if different)
cd apps/web
npm run tunnel
# If Vite is on 5174: npm run tunnel -- 5174
```

1. Copy the **one** `https://….lhr.life` line localhost.run prints (ignore QR noise below it).
2. Open the app at that **https** URL (not localhost).
3. Plaid Dashboard → Allowed redirect URIs: `https://….lhr.life/plaid/oauth-return`
4. Optional: `apps/web/.env.local` → `VITE_PLAID_REDIRECT_URI=https://….lhr.life/plaid/oauth-return`
5. Optional: `backend/.env` → `PLAID_REDIRECT_URI=` same value; restart Django.

Production Plaid setup: `RENDER_DEPLOYMENT.md`.

https://dashboard.plaid.com/developers/api

### Day-to-day (hot reload)

Two terminals:

```bash
# Terminal 1 — API + Postgres + Redis (from repo root)
docker compose up -d postgres redis && docker compose up backend
```

```bash
# Terminal 2 — Vite (from repo root)
npm run dev:web
```

Docker uses **Postgres** (`postgres://budget:budget@postgres:5432/budget`). Your SQLite file **`backend/db.sqlite3`** is kept for backup; import with `loaddata data.json` after switching (see `backend/migrate_sqlite_to_postgres.sh`).

### Redis (timeline cache)

Repeat dashboard/timeline loads are much faster with Redis. Local:

```bash
docker compose up -d redis
# backend/.env: REDIS_URL=redis://localhost:6379/0
cd backend && python manage.py redis_verify
```

On **Render**: Dashboard → **New → Key Value** (Starter) → copy **Internal Redis URL** → Web Service → Environment → `REDIS_URL` → redeploy. Verify: `GET /health/` should show `"timeline_cache_enabled": true`.

> **Tip:** With `frontend_dist` in the repo, http://localhost:8000/ also serves the React build from Django. Day-to-day UI work still uses **:5173** (Vite) for hot reload.


### Render.com

https://dashboard.render.com/web/srv-d8934mtckfvc7386vilg/events
https://financial-app-1-tu0l.onrender.com/transactions

### Without Docker

```bash
cd backend
pip3 install -r requirements.txt
cp ../.env.example .env
# Comment out DATABASE_URL in .env to use backend/db.sqlite3
python3 manage.py migrate
python3 manage.py runserver
```

Then start Vite from repo root (`npm run dev:web`) or from `apps/web` (`npm run dev`) → http://localhost:5173

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

Pytest uses `config/settings_test.py` (SQLite in `backend/test_db.sqlite3`), not `DATABASE_URL` from `.env`, so tests do not run against Render Postgres.

### Upcoming charge notifications (daily job)

Notifications remind users 1 day before a recurring automation charge is due. Run daily (e.g. cron at 06:00):

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
| Vite config (dev proxy, build) | `apps/web/vite.config.ts` |
| API client | `packages/api-client/src/api.ts`, `packages/api-client/src/config.ts` |
| Render build | `backend/build.sh` → copies `apps/web/dist/` to `backend/frontend_dist/` |
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
- **Upcoming charge notifications:** In-app reminders 1 day before recurring automation (expense/transfer) is due; created by the `create_upcoming_charge_notifications` management command (run daily)

## Lint / format (backend)

Recommended: `black`, `isort`, `ruff` (configure in `pyproject.toml` or `ruff.toml`). Frontend: ESLint + Prettier in `apps/web` and `apps/mobile`.




Still To-Do:
[ ] Notifications
    Only actionable alerts.
    Examples:
        Rent due Friday
        Main negative Jun 17
        Card payment exceeds cash
    No spam.

[ ] Add investments:
    401k
    IRA
    brokerage
    crypto
    home equity
    vehicle value
    mortgage
    loans
    Asset Types
        Cash
        Checking
        Savings
        Investment
        Retirement
        Property
        Vehicle
        Crypto
        Loan
        Mortgage
        Credit Card

[ ] Income Path Engine
    User sets:
    “I want $250k/year.”
    App shows:
    Current projected income growth
    Gap
    Timeline
    Required side income or raise
    Required savings rate
    This becomes strategic planning.

    A forward-looking system that answers:
        If I buy this house, what happens in 18 months?
        If interest rates drop, what changes?
        If I lose income for 3 months, do I collapse?
        If I add a second property, how tight am I?
        If I want $250k/year income, what timeline gets me there?

[ ] Add multiple workspaces to allow personal and business for more $$

[ ] Cash Shock Detection
    System automatically detects:
    “You normally spend $200/week on groceries.
    Current projection = $350.”
    or
    “This bill increased 17%.”

[ ] Life Event Simulator
    This could become your signature.
    Buttons:
        Buy house
        New baby
        Lose job
        Move
        Marriage
        Divorce
        Retirement
    Instant forecast.

💰 Monetization Reality
Free Accounts: ($0/month)
Can use 1 workspace (personal)
No access to PLAID (Only manual accounts)
Can create 2 Accounts
Can create 10 recurring rules
Can see 6-month projection
Can create 1 scenario

Premium Accounts: ($7.99/month)
Can use 1 workspace (personal)
Access to PLAID and automatic imports (plus manual accounts)
Can create unlimited Accounts
Can create unlimited recurring rules
Can see 36 month projection
Can create unlimited scenarios
Recurring detection
Export 

Pro Accounts: ($19.99/month)
Can use multiple workspaces (personal/business)
Access to PLAID and automatic imports (plus manual accounts)
Can create unlimited Accounts
Can create unlimited recurring rules
Can see 36 month projection
Can create unlimited scenarios
Recurring detection
Export


|   Current Balance Next Risk Date  Lowest Projected In Date Range  View Forecast   |   Date Range      |   Account                     |   
|       $xxxx.xx      MM-DD-YY         $xxxx.xx on MM-DD-YY                         |   Hide Reconciled |   Reconciled | Type | Amount  |






## Monorepo layout

```
budget-app/
├── backend/          # Django API (+ build.sh copies React build to frontend_dist/ for Render)
├── apps/
│   ├── web/          # React web UI — edit these .tsx files
│   │   └── src/
│   │       ├── pages/
│   │       │   ├── Accounts.tsx            (/accounts)
│   │       │   ├── Categories.tsx          (/categories)
│   │       │   ├── CreditCards.tsx         (/credit-cards)
│   │       │   ├── Dashboard.tsx           (/)
│   │       │   ├── GoalDetail.tsx          (/goals/:id)
│   │       │   ├── Goals.tsx               (/goals)
│   │       │   ├── Login.tsx               (/login)
│   │       │   ├── PlaidOAuthReturn.tsx    (Plaid OAuth callback)
│   │       │   ├── Profile.tsx             (/profile)
│   │       │   ├── Reconcile.tsx           (/reconcile)
│   │       │   ├── Recurring.tsx           (/recurring)
│   │       │   ├── Register.tsx            (/register)
│   │       │   ├── Reports.tsx             (/reports)
│   │       │   ├── Rules.tsx               (/automation)
│   │       │   ├── Scenarios.tsx           (/scenarios)
│   │       │   ├── SpendingTargets.tsx     (/spending-goals)
│   │       │   ├── Timeline.tsx            (/timeline)
│   │       │   └── Transactions.tsx        (/transactions)
│   │       └── components/
│   │           ├── accounts/               → Accounts.tsx
│   │           ├── bills/                    → Recurring.tsx, Timeline.tsx
│   │           ├── dashboard/                → Dashboard.tsx (+ metric tiles on Timeline, Recurring, Goals, SpendingTargets, Reports, CreditCards)
│   │           ├── goals/                    → Goals.tsx (+ Dashboard.tsx via GoalsProgressSection)
│   │           ├── paymentPlanner/           → CreditCards.tsx
│   │           ├── quickActions/             → Dashboard.tsx, Accounts.tsx, Timeline.tsx
│   │           ├── reconcile/                → Reconcile.tsx
│   │           ├── recurring/                → Recurring.tsx
│   │           ├── resolveRisk/              → Dashboard.tsx, Accounts.tsx
│   │           ├── rules/                    → Rules.tsx
│   │           ├── scenarios/                → Scenarios.tsx
│   │           ├── shared/                   → Dashboard.tsx, Timeline.tsx, Reconcile.tsx, …
│   │           ├── spendingTargets/          → SpendingTargets.tsx
│   │           ├── timeline/                 → Timeline.tsx
│   │           └── transactions/             → Transactions.tsx (+ Reconcile, Accounts, CreditCards)
│   └── mobile/       # Expo + React Native
├── packages/
│   ├── api-client/   # Typed API client (web + mobile)
│   └── shared/       # Types and utils
├── docker-compose.yml
├── .env.example
└── README.md
```

## Web UI — app tour

The web app is a **cash-flow forecasting** tool, not just a transaction log. Django holds the business logic (balances, projections, rules, goals). React pages in `apps/web/src/pages/` load data via `@budget-app/api-client` and compose UI from `apps/web/src/components/<feature>/`.

### Shell and routing

After login, every main screen shares **`Layout.tsx`**: sticky top nav, notifications, username, logout. The active page renders below the header via React Router (`App.tsx`).

Login and Register are full-screen (no nav). Plaid OAuth banks redirect to `/plaid/oauth-return` (standalone page), then back to Accounts.

Some URLs redirect to current names: `/rules` → `/automation`, `/bills` → `/recurring`, `/budget` and `/spending-targets` → `/spending-goals`.

### Navigation

| Nav label | URL | Page file |
|-----------|-----|-----------|
| Dashboard | `/` | `Dashboard.tsx` |
| Calendar | `/timeline` | `Timeline.tsx` |
| Accounts | `/accounts` | `Accounts.tsx` |
| Transactions | `/transactions` | `Transactions.tsx` |
| Recurring | `/recurring` | `Recurring.tsx` |
| Spending Limits | `/spending-goals` | `SpendingTargets.tsx` |
| Goals | `/goals` | `Goals.tsx` |
| Payment Planner | `/credit-cards` | `CreditCards.tsx` |
| What-If | `/scenarios` | `Scenarios.tsx` |
| Reports | `/reports` | `Reports.tsx` |
| Automation | `/automation` | `Rules.tsx` |
| Categories | `/categories` | `Categories.tsx` |
| Reconcile | `/reconcile` | `Reconcile.tsx` |
| Profile | `/profile` | `Profile.tsx` |

Also: `GoalDetail.tsx` at `/goals/:id`, `Login.tsx`, `Register.tsx`, `PlaidOAuthReturn.tsx`.

### How the main screens relate

Three layers:

1. **Setup** — Accounts, Categories, Automation (rules)
2. **Day-to-day** — Transactions, Calendar, Recurring
3. **Planning & review** — Goals, Spending Limits, Payment Planner, What-If, Reports, Reconcile

**Automation rules** (paychecks, rent, subscriptions, transfers, card payments) feed projected rows into **Transactions** and daily balances on **Calendar**. **Recurring** is the operations view for those obligations (paid? matched to a bank txn?) — not the forecast itself.

### Each page

#### Dashboard (`/`)

Command center: “Am I okay? What needs attention? What’s coming up?”

- Safe-to-spend summary with configurable forecast window (14 / 30 / 90 days)
- **Attention Required** — accounts at risk; actions to move money or resolve
- **Recommendations** — suggested transfers or fixes
- **Upcoming** — next bills/income by day (collapsible)
- **Financial snapshot** — where money sits (checking, savings, debt, etc.)
- **Goals progress** — compact active goals
- Onboarding if no accounts yet; quick-action modals for transactions

#### Calendar (`/timeline`)

Time-based cash-flow view — not a transaction editor.

- Calendar or list view of projected daily activity
- Summary tiles (safe-until-next-income, lowest balance in range, etc.)
- Filter by account, horizon (14d–24m), optional what-if scenario
- Click a day for that day’s inflows/outflows
- Answers: “When do I run out of money?” / “What happens in March?”

#### Accounts (`/accounts`)

Account management hub.

- Connect banks (Plaid) or add manual accounts
- Create/edit: type, role, balances, credit terms, autopay
- Group, sort, filter; per-account health and forecast alerts
- Quick actions: add transaction, add recurring rule, view forecast, resolve risk
- Jump to Transactions ledger for a specific account

#### Transactions (`/transactions`)

Per-account ledger — past and projected future.

- **Past** — historical transactions; filters (date, type, amount, reconciled)
- **Pending / expected** — uncleared or rule-generated items
- **Forecast** — future rows from automation rules
- Summary bar: balance, next risk date, lowest projected balance
- Inline add/edit/delete; credit-card payoff quick calc
- Remembers filters in browser storage

#### Recurring (`/recurring`)

Bill and subscription **operations** — not the forecast view.

- Monthly checklist: due, paid, overdue, unmatched
- Subscription intelligence (detected recurring charges)
- Detail panel: link a bank transaction to a rule, edit rule
- Summary metrics (monthly obligations, paid vs remaining)
- For day-by-day balances, use Calendar

#### Automation (`/automation`, file `Rules.tsx`)

Rules engine — where recurring behavior is defined.

- CRUD for rules grouped by: income, bills, card/loan payments, transfers, subscriptions
- Frequency, amounts, accounts, categories
- Estimated monthly cash flow summary
- Changes propagate to Transactions forecasts and Calendar

#### Spending Limits (`/spending-goals`)

Monthly **category caps** (spending, not saving).

- Limits tied to expense categories (e.g. Groceries $600/mo)
- Spent vs limit, on-track / over status
- Distinct from **Goals** (savings targets)

#### Goals (`/goals`) and Goal Detail (`/goals/:id`)

Savings goals with targets and optional auto-funding.

- Create goals (emergency fund, vacation, debt payoff, etc.)
- Active / paused / completed / archived
- Monthly contributions or paycheck-linked funding
- **Goal Detail** — progress, pace, funding source, contribution history, growth chart, optional scenario overlay

#### Payment Planner (`/credit-cards`)

Credit card **debt strategy**.

- All cards with balances and health
- Household plan: avalanche vs snowball, extra monthly, lump-sum what-if
- Per-card: minimum vs statement vs custom payment → payoff date and interest

#### What-If (`/scenarios`)

Hypothetical planning without changing real data.

- Named scenarios (blank or templates)
- Overrides to existing rules, one-time events, category shocks, new recurring items, debt paydown
- Compare scenario vs baseline (12–36 months)
- View on Calendar with `?scenario_id=…`

#### Reports (`/reports`)

**Backward-looking** monthly summaries (read-only).

- Income, expenses, net for selected month
- Category breakdown; credit card interest paid
- Goals progress; spending limits status

#### Reconcile (`/reconcile`)

Bank statement matching.

- Pick account and statement period; enter bank balance
- Check off transactions; running variance vs bank
- Add missing transactions; complete when variance is zero
- Reconciliation history

#### Categories (`/categories`)

Chart of accounts for labeling transactions.

- Expense vs income; hierarchical (parent/child)
- Create, rename, archive

#### Profile (`/profile`)

User settings: display name, phone (Plaid SMS), default household/account, password.

#### Auth and Plaid

- **Login / Register** — JWT auth; protected routes redirect if logged out
- **Plaid OAuth Return** — technical landing page for OAuth banks (e.g. Chase); resumes connection and returns to Accounts

### Component folders → pages

| Folder | Primary page(s) | Role |
|--------|-----------------|------|
| `dashboard/` | Dashboard (+ metric tiles elsewhere) | Summary cards, attention, recommendations, upcoming |
| `timeline/` | Calendar | Calendar grid, day panel, list view |
| `accounts/` | Accounts | List, grouping, lifecycle modals |
| `transactions/` | Transactions (+ utils elsewhere) | Ledger sections, filters, forecast bars |
| `recurring/` | Recurring | Bill detail, subscription panel |
| `bills/` | Recurring, Calendar | Link-transaction-to-bill modal |
| `goals/` | Goals, Dashboard | Goal cards, forms, funding UI |
| `spendingTargets/` | Spending Limits | Limit cards and form |
| `paymentPlanner/` | Payment Planner | Debt strategy cards and drawer |
| `scenarios/` | What-If | Debt payment modals |
| `reconcile/` | Reconcile | Reconciliation panels and history |
| `rules/` | Automation | Rule action menus |
| `quickActions/` | Dashboard, Accounts, Calendar | Fast add transaction/recurring modals |
| `resolveRisk/` | Dashboard, Accounts | Fix negative-balance wizard |
| `shared/` | Many pages | Badges, month headers, day heat indicators |

Supporting code: `hooks/`, `lib/` (display helpers), `packages/api-client/` (typed API, shared with mobile).

### One-liner cheat sheet

| Screen | Question it answers |
|--------|---------------------|
| Dashboard | What should I worry about right now? |
| Calendar | What does cash flow look like day by day? |
| Accounts | What accounts do I have and how healthy are they? |
| Transactions | Everything on this one account, past and future |
| Recurring | Are my bills paid and matched to real transactions? |
| Automation | What repeating money moves have I configured? |
| Spending Limits | Am I staying within monthly category caps? |
| Goals | Am I on track for savings targets? |
| Payment Planner | Fastest/cheapest way to pay off cards? |
| What-If | What happens if I change something before I commit? |
| Reports | How did last month actually go? |
| Reconcile | Does the app match my bank statement? |
| Categories | What labels do I use for income and expenses? |
| Profile | What are my defaults and account settings? |



