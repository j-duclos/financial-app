# Mobile Beta Production Readiness Report

**App:** Budget (Expo / React Native)  
**Version:** 0.9.0  
**Date:** 2026-08-26  
**Scope:** Internal beta readiness — not App Store / Play Store submission

---

## 1. Expo / EAS Configuration Status

| Item | Status |
|------|--------|
| `app.config.ts` | **Complete** — dynamic config, env-driven display name, legal URLs, Sentry DSN slot, EAS project ID slot |
| `app.json` | **Legacy base** — merged by Expo; `app.config.ts` overrides version/IDs; consider removing duplicate fields later |
| Expo SDK | **54** (`expo ~54.0.33`) |
| Plugins | `expo-router`, `expo-secure-store` |
| New Architecture | Enabled |
| `eas.json` | **Complete** — `development`, `preview` (staging/internal APK), `production` (store, autoIncrement) |
| Scheme | `budgetapp` |

**Action before first EAS build:** Run `eas init`, set `EAS_PROJECT_ID`, configure `EXPO_PUBLIC_API_URL` in EAS secrets for `preview` and `production` profiles.

---

## 2. Environment Configuration

Centralized in `constants/env.ts` and `app.config.ts` `extra`.

| Environment | `EXPO_PUBLIC_APP_ENV` | API rules |
|-------------|----------------------|-----------|
| Local dev | `development` | HTTP allowed for localhost/LAN |
| Internal beta | `staging` (EAS `preview`) | HTTPS required; blocks localhost/private IPs |
| Production | `production` | HTTPS required; fails if `EXPO_PUBLIC_API_URL` missing |

`.env.example` documents all public variables. No API hosts are hard-coded in feature components.

---

## 3. Production API URL

- Staging/production builds **throw at startup** if URL is missing, non-HTTPS, or points to localhost/private network.
- Development **requires** an explicit `EXPO_PUBLIC_API_URL` (no silent localhost fallback). Copy `.env.local.example` or `.env.render.example`.
- Document production URL in EAS / `.env.render.example`: `EXPO_PUBLIC_API_URL=https://financial-app-1-tu0l.onrender.com` (no trailing slash).
- Switch Local ↔ Render via env only; see `apps/mobile/README.md`.

---

## 4. Secrets Audit

**Client bundle contains only public configuration:**

- `EXPO_PUBLIC_*` vars (API URL, app env, legal URLs, optional Sentry DSN)
- No Django secret keys, database credentials, or private API keys in mobile source, `.env`, or `app.config.ts`.

JWT access/refresh tokens are runtime-only in SecureStore — never committed.

---

## 5. SecureStore / Auth Review

| Check | Status |
|-------|--------|
| Access token in SecureStore | Yes (`budget_access_token`) |
| Refresh token in SecureStore | Yes (`budget_refresh_token`) |
| Logout clears tokens | Yes (`clearTokens`) |
| 401 / refresh failure clears session | Yes (api-client refresh + `onUnauthorized` → logout) |
| Logout clears query cache | Yes (`clearUserQueryCache`) |
| Tokens in AsyncStorage | **No** |
| React Query disk persistence | **No** |

---

## 6. Query Cache / Privacy

- TanStack Query is **in-memory only** — no `persistQueryClient` / AsyncStorage persistence.
- Logout and unauthorized flows call `clearUserQueryCache()` removing profile, accounts, transactions, what-if, and related keys.
- Acceptable for beta; secure encrypted persistence is a post-beta decision if needed.

---

## 7. Error Boundaries

| Layer | Status |
|-------|--------|
| Top-level `AppErrorBoundary` | Wired in `app/_layout.tsx` — Try again / Go to Home; no stack traces in production |
| Expo Router `ErrorBoundary` | Exported for route-level errors |
| Feature-level boundaries | Not added per-screen (judgment: top-level sufficient for beta; Reports/What-If can be wrapped post-beta if crash data warrants) |

---

## 8. Crash Monitoring

- Integration point: `lib/monitoring.ts`
- `EXPO_PUBLIC_SENTRY_DSN` supported in config; native `@sentry/react-native` install is **pending** (commented stub).
- `captureError` used from `AppErrorBoundary`; scrubs Authorization headers in `beforeSend` stub.
- **Beta recommendation:** Provision Sentry project, add `@sentry/react-native`, uncomment init before distributing builds.

---

## 9. Network / Offline Behavior

| Item | Status |
|------|--------|
| API timeout | 90s (`API_REQUEST_TIMEOUT_MS`) via shared api-client |
| Structured errors | `describeApiError` — network, 401, 403, 404, 422, 429, 504, 5xx |
| Query retry policy | `lib/queryRetry.ts` — no retry on 401/403/404/422; limited retry on 5xx/network |
| Offline detection | `OfflineBanner` via `@react-native-community/netinfo` (graceful fallback if module missing) |
| Offline mutations | **Not queued** — writes fail clearly; no false success |

---

## 10. App Lifecycle

- `useAppLifecycleRefresh` — after **5+ minutes** backgrounded, refetches dashboard/balances/transactions via `refetchFinancialDataOnForeground()` (not full app reset).
- `PrivacyOverlay` — obscures UI in app switcher when inactive/backgrounded.
- Token refresh on 401 handled by api-client; expired refresh → clear tokens + cache + login redirect.

---

## 11. Biometrics

**Decision: Post-beta (not implemented).**

- `NSFaceIDUsageDescription` reserved in iOS config for future opt-in app lock.
- Biometrics would protect local re-entry only — not server authentication.

---

## 12. Push Notifications

**Decision: Post-beta (not implemented).**

Potential future use cases: low-balance warning, forecast alert, goal milestone, automation alert. Backend push infrastructure and privacy-conscious copy not yet required for internal beta.

---

## 13. Deep Linking

| Item | Status |
|------|--------|
| Scheme | `budgetapp://` |
| Protected routes | Guarded by `(app)/_layout` auth check |
| Logged-out deep link | Path saved via `setPendingPostLoginRedirect`; restored after login (`postLoginRedirect.ts`) |
| Sanitization | Only allowlisted in-app prefixes; no traversal or external URLs |

Stable routes exist for transaction, account, recurring, automation, budget, reports, what-if, payment-planner, goals.

---

## 14. Permissions Audit

| Permission | Status |
|------------|--------|
| Camera / Photos / Location / Contacts | **Not requested** |
| Notifications | Not requested (no push in beta) |
| Face ID string | Present for future biometric lock only |
| SecureStore | Used for tokens (Expo plugin) |

---

## 15. Icon / Splash

- Icons: `assets/images/icon.png`, `adaptive-icon.png`
- Splash: `assets/images/splash-icon.png`, `#F4F6F8` background
- **Not** default Expo placeholder — suitable for internal beta
- Final brand polish optional before store submission

---

## 16. Identifiers

| Platform | Value |
|----------|-------|
| Android package | `com.budgetapp.mobile` |
| iOS bundle ID | `com.budgetapp.mobile` |
| Expo slug | `budget-app` |
| Scheme | `budgetapp` |

**Stable before broad beta distribution** — changing these later is costly.

---

## 17. Version / Build Strategy

- Semantic version: **0.9.0** (`app.config.ts`)
- Android `versionCode` / iOS `buildNumber`: start at `1`; EAS `production` profile uses `autoIncrement`
- Display in app: Profile → About shows `getAppVersionLabel()` (e.g. `0.9.0 (1)`)
- Dev-only environment label in About when `__DEV__`

---

## 18. Feature Parity Matrix

| Feature | Mobile | Notes |
|---------|--------|-------|
| Dashboard | **Complete** | |
| Transactions | **Complete** | CRUD, filters, search |
| Accounts | **Complete** | |
| Calendar | **Complete** | |
| Recurring | **Complete** | |
| Budget | **Complete** | |
| Spending Limits | **Complete** | |
| Goals | **Complete** | |
| Payment Planner | **Complete** | |
| What-If | **Complete** | |
| Reports | **Complete** | |
| Automation | **Complete** | |
| Categories | **Partial** | Selection in forms; full CRUD **web only** for beta |
| Reconcile | **Intentionally omitted** | Financially sensitive; explicit placeholder + web fallback |
| Profile / Settings | **Partial** | View profile, forecast window (read-only), logout, About; edit forecast/password on web |
| Action Center | **Complete** | |
| Register | **Complete** | Account creation in-app |

---

## 19. Reconciliation Status

**Not included in mobile beta.** Screen shows clear messaging; More menu subtitle indicates web-only. Full reconciliation preserves complex invariants on web — do not ship a partial mobile workflow.

---

## 20. Category Management Status

**Partial.** Users can assign categories in transaction/budget flows. Create/edit/archive category management is **web only** for beta — documented on Categories screen and More menu.

---

## 21. Profile / Settings Status

- Signed-in user display
- Default forecast window (read-only; web edit documented)
- Logout with confirmation
- About: version/build, optional privacy/terms/support links via env
- Missing for store (not blocking internal beta): password change, email change, in-app account deletion

---

## 22. Security / Authorization Findings

- Mobile is untrusted client; Django enforces household scoping.
- Backend tests include cross-user isolation (e.g. reconciliation setup, profile tests) — **22 passed** in spot check.
- JWT refresh rate limiting: document current Django REST / simplejwt settings on server (not modified in this pass).
- Login errors use generic safe copy via `describeApiError`.
- No debug auth bypass or API switching in production builds (`__DEV__` gates perf logs and connectivity hints).

**Recommendation before store:** Expand object-level authorization test coverage for all mobile-used mutation endpoints.

---

## 23. Test Results

| Suite | Result |
|-------|--------|
| Mobile vitest | **128 passed** |
| Backend spot check (profile, reconciliation isolation, mobile baseline) | **22 passed** |

Run full backend suite before production store submission.

---

## 24. Beta Smoke Test

**Status: Manual — required on physical devices before internal beta distribution.**

Checklist (perform on Android + iOS):

1. Fresh install → Login → Dashboard
2. Accounts, Transactions (create/edit test txn)
3. Calendar, Budget, Goal, Payment Planner, What-If, Reports, Automation
4. Background → Resume (5+ min → data refresh)
5. Airplane mode → offline banner → restore network
6. Logout → Login again
7. Deep link while logged out → login → lands on intended screen

Document failures in issue tracker with app version from About.

---

## 25. Remaining Blockers

### Before internal beta

1. Set `EXPO_PUBLIC_API_URL` (HTTPS) in EAS `preview` secrets
2. Run `eas init` / link `EAS_PROJECT_ID`
3. `npm install` at monorepo root (adds `@react-native-community/netinfo`)
4. Build with `eas build --profile preview` and smoke-test on real devices
5. Optional but recommended: enable Sentry DSN
6. Configure `EXPO_PUBLIC_PRIVACY_URL`, `EXPO_PUBLIC_TERMS_URL`, `EXPO_PUBLIC_SUPPORT_EMAIL` for beta testers

### Before App Store / Play Store submission

1. In-app account deletion (if account creation remains in-app — Apple/Google requirement)
2. Password / account management flows or explicit web-only policy review
3. Privacy Policy & Terms URLs mandatory
4. Sentry or equivalent crash reporting enabled
5. Full backend regression + authorization test suite
6. Store screenshots, review notes, production EAS credentials
7. Biometrics app lock (optional product decision)
8. Push notifications (only if product requires)

---

## Security Confirmations

| Requirement | Status |
|-------------|--------|
| Production build cannot point to localhost/dev Django | **Enforced** in `constants/env.ts` |
| Production API uses HTTPS | **Enforced** for staging/production |
| Tokens only in SecureStore | **Yes** |
| Logout clears user financial cache | **Yes** |
| No tokens/financial payloads in production logs | **Yes** (`__DEV__` gates `[PERF]` logs) |
| No insecure query persistence | **Yes** — in-memory only |
| Expired refresh → login, no stale authenticated UI | **Yes** |
| No debug tooling in production | **Yes** |
| Django object-level authorization | **Present**; expand tests pre-store |
| Stable bundle/package IDs | **Yes** — `com.budgetapp.mobile` |

---

## EAS Quick Reference

```bash
# Internal beta (staging API, APK for Android sideload)
eas build --profile preview --platform all

# Production (store — do not submit until blockers cleared)
eas build --profile production --platform all
```

See `apps/mobile/README.md` for local development workflow.
