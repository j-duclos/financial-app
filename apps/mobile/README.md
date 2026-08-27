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

## Architecture

See `features/`, `components/ui/`, `services/`, and `theme/` for the foundation layout. Dashboard consumes:

- `GET /api/insights/dashboard/summary-fast/?forecast_days=`
- `GET /api/insights/dashboard/details/?forecast_days=`
- `GET /api/insights/extended-cash-risk/`
- `GET /api/profile/`
