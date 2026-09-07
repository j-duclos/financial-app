# FlowSight security

This document describes how FlowSight handles sensitive data today. It is not a marketing page and does not claim end-to-end encryption of ledgers.

## Data flow

- **Web** (React) and **mobile** (Expo) call the Django REST API with JWT `Authorization` headers.
- Production API and SPA are served over **HTTPS** (Render reverse proxy).
- PostgreSQL on Render holds application data. Ordinary transaction amounts and descriptions are **not** field-level encrypted so they remain queryable.
- Redis may cache timeline/dashboard payloads. Treat it as sensitive in production.
- Plaid is used for bank linking. Stripe is used for Premium billing.

Native mobile apps do not use browser CORS. They authenticate with JWT like the web client.

## Sensitive-data handling

| Data | Handling |
|------|----------|
| Passwords | Django password hashers (PBKDF2 by default). Never exported. |
| JWT access/refresh | Issued by SimpleJWT. Not stored in the database. |
| Plaid `access_token` | Encrypted at rest with Fernet (`access_token_cipher`). |
| Plaid account mask | Last digits only. Bank login credentials are never stored. |
| Stripe secret / webhook secret | Server env only. Webhooks require a valid Stripe signature. |
| Exports | Authenticated, household-scoped. No password hashes, JWTs, Plaid ciphertext, or Stripe IDs. |
| Expo push tokens | Stored per user on `PushDevice`. Register/unregister requires JWT. Never returned on other users’ APIs. Push payloads include account display name and amounts for the at-risk occurrence only — no account numbers, Plaid IDs, or JWTs. |

## Secrets management

Set secrets in Render **Environment**, never in git.

Required in production (`DEBUG=false`):

- `DJANGO_SECRET_KEY`
- `PLAID_TOKEN_FERNET_KEY`
- `DATABASE_URL` (Render Postgres)
- `ALLOWED_HOSTS` (include `flowsight.com` and `www.flowsight.com` when using the custom domain)

Required for billed production:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PREMIUM_PRICE_ID`

Required for email (verification / password reset):

- SMTP settings (`EMAIL_BACKEND`, `EMAIL_HOST`, `EMAIL_HOST_PASSWORD`, …)

Optional:

- `SENTRY_DSN` / `VITE_SENTRY_DSN` (empty disables monitoring)
- `PLAID_CLIENT_ID` / `PLAID_SECRET` (or env-specific secret vars)
- `PLAID_WEBHOOK_URL` (unsigned requests are rejected; leave unset to keep the route inert)

Do not log these values. Do not put them in client bundles except Stripe **publishable** key and public DSN if you choose to enable Sentry.

## Plaid token encryption

`PLAID_TOKEN_FERNET_KEY` is required when `DEBUG` is false (including Render). Local development may derive a Fernet key from `DJANGO_SECRET_KEY` only while `DEBUG=true`. Do not use that fallback in production.

Generate a key:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Rotating the key without re-encrypting stored ciphertext makes existing bank links undecryptable (users must re-link).

## Auth model

- JWT access ~60 minutes, refresh ~7 days.
- `/api/` is CSRF-exempt because it is JWT-only. Django admin and other non-API routes still use CSRF.
- Login, register, password reset, resend verification, email change, password change, account deletion, and in-app feedback are rate-limited.
- Email change and password change require the current password.
- Password reset and email verification tokens expire.
- Forgot-password responses are enumeration-safe.
- SimpleJWT blacklist is **not** enabled: after a password change, existing JWTs remain valid until they expire. That is a known follow-up.

Web stores JWTs in `localStorage` (XSS can steal them). Migrating to httpOnly cookies is a follow-up and must not be done casually. Mobile stores JWTs in Expo SecureStore (Keychain on iOS).

## Production HTTPS

When `DEBUG` is false:

- `SECURE_SSL_REDIRECT` (Render `X-Forwarded-Proto`)
- Secure session and CSRF cookies
- HSTS (`SECURE_HSTS_SECONDS=31536000`)
- `X_FRAME_OPTIONS=DENY`
- `SECURE_CONTENT_TYPE_NOSNIFF`
- `Referrer-Policy: same-origin`

HSTS **preload** and **includeSubDomains** are off until `flowsight.com` and every required subdomain are confirmed HTTPS-only.

CORS is an explicit allowlist (`CORS_ALLOW_ALL_ORIGINS` is false). Production includes `https://flowsight.com` and `https://www.flowsight.com`.

## Logging and Sentry

- Backend and web Sentry scrubbers drop Authorization, cookies, passwords, JWTs, Plaid tokens, Stripe secrets, and request bodies.
- `send_default_pii=False`, Session Replay off, request bodies not sent (`max_request_body_size=never`).
- Mobile Sentry SDK is not wired; do not enable a DSN there without the same scrubbing.

Do not log raw request bodies, tokens, or full account numbers.

## Authorization

- Authenticated `POST /api/feedback/` stores product comments and emails `FEEDBACK_EMAIL_TO`. It is rate-limited, strips HTML, rejects financial fields, and does not expose other users’ submissions. Full feedback bodies are not written to application logs.

## Database and backups

Production is **Render PostgreSQL**. Encryption at rest and backup retention are hosting-provider controls — verify them in the Render dashboard; this repo does not implement application-level encryption of ledger rows.

## Dependency scanning

CI runs gitleaks, `pip-audit`, `npm audit --omit=dev --audit-level=high`, and `python manage.py check --deploy`.

## Vulnerability reporting

Email security issues to **security@flowsight.com** (placeholder — replace with the monitored inbox before launch). Do not file public GitHub issues for active exploits.

## Deployment checklist

- [ ] `DEBUG=false` on Render
- [ ] Unique `DJANGO_SECRET_KEY`
- [ ] Explicit `PLAID_TOKEN_FERNET_KEY` (not derived from the Django secret)
- [ ] `DATABASE_URL` is Render Postgres, not localhost
- [ ] `ALLOWED_HOSTS` / `CORS_ALLOWED_ORIGINS` / `CSRF_TRUSTED_ORIGINS` include only intended hosts (`flowsight.com`, `www.flowsight.com`, Render hostname)
- [ ] SMTP configured if customers must verify email, reset passwords, or receive in-app feedback (`FEEDBACK_EMAIL_TO`)
- [ ] Stripe webhook endpoint uses `STRIPE_WEBHOOK_SECRET`
- [ ] Plaid webhook URL unset **or** Plaid-Verification JWT required (current code)
- [ ] Sentry DSNs empty or pointing at a project with scrubbing enabled
- [ ] Render Postgres encryption-at-rest / backups reviewed in the dashboard
- [ ] No dumps (`data.json`, SQLite backups) in git
- [ ] If dumps or secrets were ever committed, rotate those secrets and consider `git filter-repo` history cleanup (do not rewrite history casually)
