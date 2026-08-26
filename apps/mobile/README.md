# Mobile app (Expo)

Cross-platform client for the Budget App Django API. Business logic stays on the backend; this app is a presentation client.

## Run

From the monorepo root (with the Django API already running):

```bash
npm install
npm run dev:mobile
```

Or:

```bash
cd apps/mobile
cp .env.example .env
# Adjust EXPO_PUBLIC_API_URL for simulator / emulator / device
npx expo start
```

### API URL tips

| Runtime | Typical `EXPO_PUBLIC_API_URL` |
|---------|------------------------------|
| iOS Simulator | `http://localhost:8000` |
| Android Emulator | `http://10.0.2.2:8000` |
| Physical device | `http://<LAN-IP>:8000` |
| Production | `https://your-api-host` |

Auth uses JWT (`/api/auth/token/`, refresh via `/api/auth/refresh/`). Tokens are stored in **Expo SecureStore** (not AsyncStorage).

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
