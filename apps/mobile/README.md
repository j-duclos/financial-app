# Mobile app (Expo)

Cross-platform client for the Budget App Django API. Business logic stays on the backend; this app is a presentation client.

## API environments (Local vs Render)

There is **one** canonical base URL: `EXPO_PUBLIC_API_URL` (resolved in `constants/env.ts` → `getApiBaseUrl()` → shared `@budget-app/api-client`).

Switching Local ↔ Render requires **only** an env change and Metro reload — no source edits.

### Fast local development

```text
Mobile → Local Django → Local database
```

```bash
cd backend
ALLOWED_HOSTS='*' python3 manage.py runserver 0.0.0.0:8000

cd apps/mobile
cp .env.local.example .env
# Edit EXPO_PUBLIC_API_URL for your client (see table below)
npx expo start --clear
```

| Client | `EXPO_PUBLIC_API_URL` |
|--------|------------------------|
| iOS Simulator | `http://localhost:8000` |
| Android Emulator | `http://10.0.2.2:8000` |
| Physical device | `http://<YOUR-LAN-IP>:8000` |

A physical iPhone **cannot** use the Mac’s `localhost` — use your Mac’s LAN IP and bind Django to `0.0.0.0:8000`.

### Realistic production-performance testing

```text
Mobile → Internet → Render Django → Render PostgreSQL / Redis
```

```bash
cd apps/mobile
cp .env.render.example .env
npx expo start --clear
```

Default Render host (from repo docs): `https://financial-app-1-tu0l.onrender.com`

This measures real client → Render latency. It does **not** point local Django at the production database.

**⚠ Production data:** Creates, edits, deletes, transactions, recurring, and reconciliation against Render are **real**. Prefer a staging Render service for destructive testing if available.

### Dev-only indicators

On Metro/`__DEV__` startup you should see:

```text
[MOBILE ENV] API: local (192.168.x.x)
```

or:

```text
[MOBILE ENV] API: render (financial-app-1-tu0l.onrender.com)
```

Profile & Settings (dev builds only) also shows `API: Local` or `API: Render`.
API performance logs are tagged `[PERF][local]` / `[PERF][render]`.

## Run

From the monorepo root (with the Django API already running **or** using Render):

```bash
npm install
npm run dev:mobile
```

Or:

```bash
cd apps/mobile
cp .env.local.example .env   # or .env.render.example
npx expo start
```

Auth uses JWT (`/api/auth/token/`, refresh via `/api/auth/refresh/`). Tokens are stored in **Expo SecureStore** (not AsyncStorage). Login and all feature APIs share the same `EXPO_PUBLIC_API_URL`.

## Environments

| `EXPO_PUBLIC_APP_ENV` | Use |
|-----------------------|-----|
| `development` | Local Metro; HTTP allowed for localhost/LAN |
| `staging` | EAS `preview` internal beta; HTTPS required |
| `production` | Store builds; HTTPS required |

Staging/production **fail at startup** if the URL is missing, non-HTTPS, or points at localhost/private networks — see `constants/env.ts`.

## EAS / internal beta

See **`BETA_READINESS.md`** for the full production-readiness report.

```bash
npm install   # from monorepo root
cd apps/mobile
eas build --profile preview --platform android   # internal APK → Render API
```

`eas.json` sets `EXPO_PUBLIC_API_URL` for `preview` and `production` to the Render HTTPS host. Override via EAS secrets if the host changes. Never point store builds at localhost.

## Tests

```bash
npm test -w @budget-app/mobile
```

## Product strategy — companion app

Mobile is a lightweight companion to the full web financial command center. It is **not** desktop Dashboard parity.

Home should answer three questions quickly:

1. Am I financially okay?
2. What needs attention?
3. What is happening next?

### Launch surfaces

**Full / core mobile**

- Dashboard (Home)
- Transactions
- Calendar
- Accounts
- Action Center
- Quick manual transaction

**Lightweight mobile**

- Budget
- Recurring
- Goals
- Payment Planner
- Reports

**Web-first / web-only at launch**

- DTI / affordability planning
- What-If / Planning Lab
- Reconciliation
- Advanced automation administration
- Category administration
- Large historical analysis
- Complex financial setup workflows (including Plaid Link)

Existing mobile screens for web-first features may still exist for deep links; they are not primary navigation. Bottom tabs stay **Home, Transactions, Calendar, Accounts, More**.

### Home metrics

Financial Health on mobile Home shows only:

- Lowest Forecast Balance
- Available Cash
- Available Credit

Liquid Net Position and Total Debt stay on **web**. Debt remains available on mobile via Accounts / credit-card detail, Reports, and Payment Planner.

### Free vs Premium (UX only — backend is authoritative)

Launch limits:

| | Free | Premium |
|---|---|---|
| Plaid bank sync | Unavailable | Automatic bank sync (web) |
| Manual accounts | Max 3 | Unlimited |
| Forecast | Max 90 days | Up to 365 days |
| Active recurring rules | Max 10 | Unlimited |
| Goals | Max 2 | Unlimited |
| Manual transactions | Unlimited | Unlimited |

Mobile forecast pickers show 365 days as a locked Premium row for Free users instead of submitting a request that 403s. Recurring and Goals create-limit UX is still backend-enforced and will be audited with those pages.

Mobile does not ship a mature Plaid Link flow in this companion release. Free users see Premium bank-sync copy; Premium users can connect banks on web. Manual account entry always remains available.

## Architecture

See `features/`, `components/ui/`, `services/`, and `theme/` for the foundation layout. Home progressive loading:

1. `GET /api/onboarding/status/` and `GET /api/billing/status/` (shared React Query keys with Settings)
2. `GET /api/insights/dashboard/summary-fast/?forecast_days=` when the user has an account
3. `GET /api/insights/dashboard/details/?forecast_days=` after summary-fast
4. `GET /api/insights/extended-cash-risk/` deferred after details
5. Low-priority Transactions prefetch after Home is useful
