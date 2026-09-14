# Production configuration (FlowSight)

Names only. Do not paste secret values into this file or into git.

**Authoritative Render API/UI host:** `financial-app-1-tu0l.onrender.com`  
**Public web origin:** `https://flowsight360.com`  
**Retired host (do not use):** `financial-app-5ywr.onrender.com`

Verify a live service with:

```bash
cd backend
python manage.py check_production_config
python manage.py check_billing_config
python manage.py check_email_config
# Only when you intentionally want a real message:
# python manage.py send_test_email you@example.com
```

Commands print presence/state. They never print API keys, webhook secrets, price IDs, SMTP passwords, or JWTs. `send_test_email` is never run by deploy.

---

## Django

| Variable | Required | Notes |
| --- | --- | --- |
| `DJANGO_SECRET_KEY` | Required | Unique secret when `DEBUG=false`. |
| `DEBUG` | Required | Must be `false` in production. |
| `ALLOWED_HOSTS` | Required | Include `flowsight360.com`, `www.flowsight360.com`, and `financial-app-1-tu0l.onrender.com`. `.onrender.com` is added when `RENDER=true`. |
| `CSRF_TRUSTED_ORIGINS` | Required | HTTPS origins for the custom domain and the Render host. |
| `CORS_ALLOWED_ORIGINS` | Optional | Needed only if the UI is on a different origin than the API. Same-service deploy can omit. |
| `RENDER` | Optional | Set by Render. Enables production host defaults. |
| `RENDER_EXTERNAL_URL` | Optional | Set by Render. Fallback frontend origin if `FRONTEND_ORIGIN` is empty. |
| `SECURE_SSL_REDIRECT` | Optional | Defaults on when not in DEBUG. |
| `GUNICORN_WORKERS` | Optional | Paid-tier sizing. |
| `GUNICORN_THREADS` | Optional | Paid-tier sizing. |
| `GUNICORN_TIMEOUT` | Optional | Paid-tier sizing. |
| `ENABLE_PERF_LOGS` | Optional | Defaults on when `RENDER=true`. |
| `ALLOW_PLAN_TEST_OVERRIDE` | Do not set in production | Dev-only Free/Premium simulation. |

## Database

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Required | Render Postgres internal/external URL. Never `localhost` on Render. |

## Redis

| Variable | Required | Notes |
| --- | --- | --- |
| `REDIS_URL` | Required for production cache | Render Key Value internal URL. |
| `REDISCLOUD_URL` | Optional | Alternate name; used only if `REDIS_URL` is empty. |

## Email

| Variable | Required | Notes |
| --- | --- | --- |
| `EMAIL_BACKEND` | Required | Production: `django.core.mail.backends.smtp.EmailBackend`. Local default is console. |
| `EMAIL_HOST` | Required for password-reset delivery | SMTP hostname. |
| `EMAIL_PORT` | Optional | Default `587`. |
| `EMAIL_HOST_USER` | Required for most SMTP providers | Username only; diagnostics never print it. |
| `EMAIL_HOST_PASSWORD` | Required for most SMTP providers | Never print or commit. |
| `EMAIL_USE_TLS` | Optional | Default `true`. |
| `EMAIL_USE_SSL` | Optional | Default `false`. Do not enable with TLS. |
| `DEFAULT_FROM_EMAIL` | Required | From address users will see. |
| `FEEDBACK_EMAIL_TO` | Optional | In-app feedback inbox. |
| `EMAIL_VERIFICATION_MAX_AGE` | Optional | Seconds; default 48 hours. |
| `PASSWORD_RESET_TIMEOUT` | Optional | Seconds; default 3 days. |

Password-reset **web** flow (already implemented):

1. `POST /api/auth/forgot-password/`
2. Email generated only when SMTP + `FRONTEND_ORIGIN` (or `RENDER_EXTERNAL_URL`) are set
3. Reset URL: `{FRONTEND_ORIGIN}/reset-password?uid=…&token=…`
4. Completion: `POST /api/auth/reset-password/`
5. Token expiry: `PASSWORD_RESET_TIMEOUT`

Mobile can **request** a reset in-app. Reset **completion** uses the HTTPS web page at `{FRONTEND_ORIGIN}/reset-password` because Universal Links are not configured; custom-scheme email URLs would strand users without the app. After resetting on the web, the user returns to the mobile app and signs in. A native `budgetapp://reset-password?uid=&token=` screen exists for the existing Expo scheme only.

Remaining production dependency: working SMTP plus `FRONTEND_ORIGIN=https://flowsight360.com`.

## Plaid

| Variable | Required | Notes |
| --- | --- | --- |
| `PLAID_ENV` | Required in production | Must be set explicitly. Production must use `production`. Missing `PLAID_ENV` no longer falls back to sandbox when `DEBUG=false`. |
| `PLAID_CLIENT_ID` | Required | |
| `PLAID_PRODUCTION_SECRET` | Required when `PLAID_ENV=production` | Preferred production secret name. |
| `PLAID_SECRET` | Optional fallback | Used if the env-specific secret is empty. |
| `PLAID_SANDBOX_SECRET` | Development only | |
| `PLAID_DEVELOPMENT_SECRET` | Development only | |
| `PLAID_REDIRECT_URI` | Required for OAuth banks | Must be HTTPS in production. |
| `PLAID_WEBHOOK_URL` | Optional | Set if Plaid webhooks are enabled. |
| `PLAID_TOKEN_FERNET_KEY` | Required when `DEBUG=false` | Encrypts stored Plaid tokens. |
| `PLAID_ENABLE_LIABILITIES` | Optional | Leave unset until Plaid Liabilities is approved. |

## Stripe

| Variable | Required | Notes |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Required for Checkout | Live keys start with `sk_live_`. |
| `STRIPE_PUBLISHABLE_KEY` | Optional | Client publishable key. |
| `STRIPE_PREMIUM_PRICE_ID` | Required for Checkout | Must match the secret key mode (test vs live). |
| `STRIPE_WEBHOOK_SECRET` | Required for subscription state | Endpoint: `/api/billing/webhook/`. |
| `BILLING_SUCCESS_URL` | Optional | Defaults to `{FRONTEND_ORIGIN}/profile?billing=success&session_id={CHECKOUT_SESSION_ID}`. |
| `BILLING_CANCEL_URL` | Optional | Defaults to `{FRONTEND_ORIGIN}/profile?billing=canceled`. |
| `BILLING_PORTAL_RETURN_URL` | Optional | Defaults to `{FRONTEND_ORIGIN}/profile`. |

Do not put test (`sk_test_`) keys on the production Render service.

Stripe Dashboard webhook URL: `https://financial-app-1-tu0l.onrender.com/api/billing/webhook/`  
Plaid Dashboard webhook URL (if used): value of `PLAID_WEBHOOK_URL`.

## Frontend

| Variable | Required | Notes |
| --- | --- | --- |
| `FRONTEND_ORIGIN` | Required | Production should be `https://flowsight360.com`. Used for auth emails and Stripe return URLs. |
| `VITE_API_URL` | Optional | Same-origin Render deploy leaves this unset. |
| `VITE_API_BASE_URL` | Optional | Alias of `VITE_API_URL`. |
| `VITE_PLAID_REDIRECT_URI` | Optional | Same-origin deploy uses the Django/Plaid server setting. |

## Mobile

| Variable | Required | Notes |
| --- | --- | --- |
| `EXPO_PUBLIC_APP_ENV` | Required | EAS `production` profile: `production`. EAS `preview`: `staging`. |
| `EXPO_PUBLIC_API_URL` | Required for preview/production | Must be `https://financial-app-1-tu0l.onrender.com`. Local development may use `http://localhost:8000` or a LAN IP. |
| `EXPO_PUBLIC_PRIVACY_URL` | Required for store builds | Production default `https://flowsight360.com/privacy`. |
| `EXPO_PUBLIC_TERMS_URL` | Required for store builds | Production default `https://flowsight360.com/terms`. |
| `EXPO_PUBLIC_SUPPORT_EMAIL` | Optional | Shown in Settings → About. |
| `EAS_PROJECT_ID` | Optional | Only if Expo project linking is used. |
| `EXPO_PUBLIC_IOS_APP_STORE_ID` | Optional | Store listing. |
| `EXPO_PUBLIC_FINANCIAL_ENGINE_MODE` | Optional | Leave unset for server-authoritative balances. |
| `EXPO_ACCESS_TOKEN` | Optional | Expo push for projected-funds alerts. |
| `PROJECTED_FUNDS_PUSH_DRY_RUN` | Optional | |

Development/preview builds log `[api-runtime]` (`environment`, `resolved_api_host`, `build_profile`) and `[billing-checkout]` (`api_host`, `endpoint`, `status` / `network_failure`). Tokens are never logged. Store production builds do not emit those traces.
