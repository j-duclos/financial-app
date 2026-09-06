# Legal pages and production error monitoring

This document covers public-beta legal configuration and Sentry error monitoring.

**These Privacy Policy and Terms of Service texts are developer drafts for public beta. They should be reviewed by qualified legal counsel before a broad commercial launch.** They are not attorney-reviewed.

## Legal configuration

Public pages:

- `/privacy` — Privacy Policy
- `/terms` — Terms of Service

Copy and contact details come from `apps/web/src/lib/legalConfig.ts`. Configure production identity with Vite environment variables at **build time** (Render Web Service or Static Site env):

| Variable | Purpose |
|----------|---------|
| `VITE_LEGAL_PRODUCT_NAME` | Product name shown in the UI (default: `Financial App`) |
| `VITE_LEGAL_BUSINESS_NAME` | Legal/business name. Leave empty rather than inventing an LLC. The pages then say “the operator of this application”. |
| `VITE_LEGAL_CONTACT_EMAIL` | Contact email. Leave empty to use a generic “contact method provided with this beta” placeholder. |
| `VITE_LEGAL_STATE` | Governing-law state (default: `Arizona`) |

Do not commit fake company names or live contact inboxes in source. Set real values in the hosting environment before a named commercial launch.

Last-updated dates live in `legalConfig.ts` (`LEGAL_LAST_UPDATED`). Update that constant when the policy text changes.

Mobile apps can point `EXPO_PUBLIC_PRIVACY_URL` and `EXPO_PUBLIC_TERMS_URL` at the deployed web `/privacy` and `/terms` URLs.

## In-product acknowledgements

- Registration: creating an account agrees to Terms and acknowledges Privacy (linked; no extra checkbox).
- Settings → Legal, plus the authenticated app footer: Privacy and Terms.
- Plan & Billing: Terms, Privacy, and automatic-renewal / portal-cancellation language near Upgrade. Stripe Checkout remains the payment UI.
- Short financial disclaimer on Dashboard, Payment Planner, What-If, Debt-to-Income, and Reports. Footer note: “Financial information is for planning purposes only.”

## Monitoring configuration (Sentry)

Error monitoring is optional. **Local development works with no Sentry DSN.** `/health/` does not call Sentry and must not fail if Sentry is down.

### Create projects

1. Create a Sentry organization/project for the **Django API**.
2. Create a separate project for the **web app** (or one project with two DSNs if you prefer).
3. Copy the DSN values into hosting env vars. **Never commit DSNs.**

### Backend (Django)

Set on the API / Render Web Service:

| Variable | Purpose |
|----------|---------|
| `SENTRY_DSN` | Backend DSN. Empty or unset = monitoring off. |
| `SENTRY_ENVIRONMENT` | e.g. `production`. Defaults to `production` when `RENDER=true`, otherwise `development`. |
| `SENTRY_RELEASE` | Optional git SHA or version string. |

SDK: `sentry-sdk` in `backend/requirements.txt`. Initialization is in `backend/config/sentry.py`.

### Frontend (Vite)

Set at **frontend build time**:

| Variable | Purpose |
|----------|---------|
| `VITE_SENTRY_DSN` | Browser DSN. Empty or unset = monitoring off. |
| `VITE_SENTRY_ENVIRONMENT` | Optional; defaults to Vite `MODE`. |
| `VITE_SENTRY_RELEASE` | Optional release string. |

SDK: `@sentry/react`. Initialization is in `apps/web/src/lib/monitoring.ts`.

### Privacy-safe settings (required for this product)

This app stores financial data. Monitoring is configured to:

- Skip initialization when DSN is absent.
- Set `send_default_pii` / `sendDefaultPii` to false.
- Never send request bodies (`max_request_body_size="never"`).
- Associate errors with **internal user id only** (no email).
- Scrub Authorization/cookies, passwords, tokens, Plaid/Stripe secrets, payee/memo fields, and token-like strings (`backend/config/sentry_scrub.py`, `apps/web/src/lib/sentryScrub.ts`).
- Sample traces at 0 for launch (errors only).

**Session Replay is intentionally disabled.** Do not enable Sentry Session Replay, session replay sample rates, or marketing/ad trackers without an explicit later approval. Replay can capture on-screen account numbers, balances, and transaction detail.

Do not add behavioral advertising or invasive analytics in this phase.

## Production 500 responses

With `DEBUG=False` (Render default), Django does not send Python tracebacks to clients. Validation, 403, and 404 payloads are unchanged. Unhandled server errors should still be captured by Sentry when a DSN is configured.
