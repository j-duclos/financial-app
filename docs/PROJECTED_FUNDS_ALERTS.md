# Projected insufficient-funds alerts — production setup

Server-authoritative 7-day overdraft / credit-limit warnings. Clients display `GET /api/alerts/`; they do not calculate risk.

## Render Cron (required)

Create a **Cron Job** on the same Render account/region as the API, using the `backend/` root:

| Field | Value |
|-------|--------|
| Schedule | `0 * * * *` (hourly) |
| Command | `python manage.py evaluate_projected_funds_alerts` |
| Root directory | `backend` |

The job must use the **same** `DATABASE_URL` and `REDIS_URL` as the web service (same Env Group).

Optional:

```bash
python manage.py evaluate_projected_funds_alerts --household_id=1
python manage.py evaluate_projected_funds_alerts --skip-push
```

Related daily job (unchanged): `python manage.py create_upcoming_charge_notifications`

## Server environment

| Variable | Purpose |
|----------|---------|
| `EXPO_ACCESS_TOKEN` | Optional Expo access token for the Push API (`https://exp.host/--/api/v2/push/send`). |
| `PROJECTED_FUNDS_PUSH_DRY_RUN` | `true` skips the network (tests). Leave unset in production. |

No new queue/worker is required.

## Expo push (iOS + Android)

1. Create/link an EAS project and set `EAS_PROJECT_ID` for production builds (`apps/mobile/app.config.ts` extra.eas.projectId).
2. Install `expo-notifications` (already in `apps/mobile/package.json`) and rebuild native binaries after adding the plugin (`npx expo prebuild` / EAS Build).
3. **iOS:** In [Expo dashboard](https://expo.dev) / Apple Developer, configure APNs (key or certificate) for bundle id `com.jduclos.flowsight`. EAS can manage credentials (`eas credentials`).
4. **Android:** FCM is required for Expo push on Android. Add a Firebase project, download `google-services.json`, and configure it in EAS (`eas.json` / Expo credentials). Expo’s current build path uses FCM for Android devices.
5. Physical devices only for reliable push (simulators/emulators are limited).

Permission is requested **after** the user has financial data (forecast-ready / onboarding), never on first launch. Tokens are registered to `POST /api/push-devices/` and removed on logout.

## Clients

- Web banner: `apps/web/src/components/ProjectedFundsAlertBanner.tsx` (session-local hide; not a per-navigation modal)
- Action Center: same `GET /api/alerts/?active=1` on web and mobile
- Preferences: Profile / Settings (`projected_funds_*` on `UserProfile`)

Available to Free and Premium. Free users are limited to data they entered (no Plaid).
