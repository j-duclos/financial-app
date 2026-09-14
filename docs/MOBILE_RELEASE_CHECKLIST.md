# Mobile release checklist

Store and legal hardening for FlowSight. Financial calculations, Stripe pricing,
and Free/Premium rules are unchanged.

## Monetization status

| Client | Purchase path | Notes |
| --- | --- | --- |
| Web | Stripe Checkout | Unchanged |
| Android | Stripe Checkout in browser | Unchanged. Play Billing is not used. |
| iOS development / EAS preview | Stripe Checkout (test/preview only) | Explicit non-production exception |
| iOS App Store production | **No purchase CTA** | Apple IAP is **not implemented** |

Existing Premium (from synchronized Stripe status or an allowed test override)
still works on every client. iOS App Store builds do not silently downgrade
those users. They can view plan status. They cannot start Stripe Checkout or
open the Stripe portal from the app.

**Apple IAP is still required** before charging for digital Premium inside the
iOS App Store. This repo has types and a stub client only. Do not ship a
production iOS purchase flow until server-side Apple verification exists.

## Apple IAP work still required

- Create `com.jduclos.flowsight.premium.monthly` in App Store Connect
- Add StoreKit / `expo-in-app-purchases` or equivalent
- Implement `POST /api/billing/apple/verify/`
- Verify signed transactions with Apple on the server
- Store Apple `original_transaction_id` separately from Stripe IDs
- Grant Premium only through `user_has_premium` after Apple verification
- Never persist Apple entitlement only on-device
- Display price from StoreKit metadata, not the Stripe marketing label

## Legal URLs

Production/preview must use:

- Privacy: `https://flowsight360.com/privacy`
- Terms: `https://flowsight360.com/terms`

Set on EAS profiles (`EXPO_PUBLIC_PRIVACY_URL`, `EXPO_PUBLIC_TERMS_URL`).
The app also defaults to those URLs when env is empty.

Optional: `EXPO_PUBLIC_SUPPORT_EMAIL` for Settings → About.

## Icon and splash

| Asset | Path | Size | Use |
| --- | --- | --- | --- |
| iOS / store icon | `apps/mobile/assets/images/icon.png` | **1024×1024** PNG, no alpha | `icon` |
| Android adaptive | `apps/mobile/assets/images/adaptive-icon.png` | 1024×1024 | `android.adaptiveIcon` |
| Splash | `apps/mobile/assets/images/splash-icon.png` | 1024×1024 | splash only |
| Wordmark / marketing | `apps/mobile/assets/branding/flowsight-logo.jpg` | **1024×768** | Do **not** use as the App Store icon |

Do not stretch the rectangular JPG into a square.

## TestFlight vs App Store

- EAS `preview` (`EXPO_PUBLIC_APP_ENV=staging`): iOS may still show Stripe test checkout
- EAS `production` (`EXPO_PUBLIC_APP_ENV=production`): iOS must not show Stripe purchase CTAs
- Confirm a production archive with `EXPO_PUBLIC_APP_ENV=production` before App Store submit

## iOS config snapshot

- Name: FlowSight
- Bundle id: `com.jduclos.flowsight`
- Version: `0.9.0` (`app.config.ts`)
- Scheme: `budgetapp`
- No Sign in with Apple (email/password only)
- No tracking permission
- Account deletion: Settings → Profile → Delete account (`DELETE` + password)

## Android config snapshot

- Package: `com.budgetapp.mobile`
- Adaptive icon preserved
- Stripe checkout remains the intended purchase path
- Account deletion and legal links are the same screens as iOS

## Remaining store blockers

### App Store

- Apple IAP is **not implemented**. Production iOS cannot sell Premium in-app.
- `EXPO_PUBLIC_SUPPORT_EMAIL` is optional and **not set** in EAS. Set a real support address before submit if App Review requires a contact path in About.
- `EXPO_PUBLIC_IOS_APP_STORE_ID` is empty until the listing exists.
- Confirm `https://flowsight360.com/privacy` and `/terms` load on device.
- If shipping push (`expo-notifications`), configure APNs on EAS.

### Play Store

- Android still uses Stripe Checkout in a browser. Play Billing is not used.
- Google may require Play Billing for digital subscriptions. That is a policy decision, not a code change in this phase.
- Support email same as iOS.

## Before store submit

- [ ] Production EAS env is `production`
- [ ] Legal URLs open on device
- [ ] iOS production build shows no Stripe Upgrade CTA
- [ ] Existing Premium user still has Premium features
- [ ] Account deletion confirmation works
- [ ] Icon is the 1024×1024 PNG (`apps/mobile/assets/images/icon.png`, no alpha)
- [ ] Support email configured if required by the store listing
- [ ] Apple IAP still deferred unless verification shipped
