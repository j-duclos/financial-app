# Release checklist

Canonical ledger regression and CI are the merge gate. Do not deploy over a red
`ledger_regression` run.

## Before merging to main

- [ ] CI green on the PR (`backend-tests`, `web-tests`, `build-web`)
- [ ] Canonical ledger regression green (`pytest -m ledger_regression`)
- [ ] `python manage.py makemigrations --check` clean (no forgotten migrations)
- [ ] No accidental entitlement changes (Free 90-day forecast, 3 manual accounts, 10 recurring rules, 2 goals, Plaid Premium-only)
- [ ] No Stripe / Plaid / Django / SMTP / Sentry secrets committed

## Before production deploy

- [ ] Database backup available
- [ ] Migrations reviewed
- [ ] Required environment variables present on the host
- [ ] Stripe webhook configured (test mode or live as appropriate)
- [ ] Plaid webhook configured
- [ ] Email provider configured
- [ ] Sentry DSN configured (production only; keep scrubbing enabled)
- [ ] Legal pages and contact info configured

## After deploy

Manual sanity only — do not add destructive automated production smoke tests.

- [ ] Health endpoint responds
- [ ] Login
- [ ] Registration
- [ ] Email verification
- [ ] Manual account creation
- [ ] Test forecast (supported window)
- [ ] Stripe Checkout sanity (test-mode or live-mode as appropriate)
- [ ] Plaid connection sanity
- [ ] Error monitoring: send a test event only if a safe existing validation method is already in place

## Running the gate locally

```bash
cd backend
python -m pytest -m ledger_regression
python -m pytest billing plaid_link common/tests \
  transactions/tests/test_import_matching.py \
  transactions/tests/test_plaid_manual_merge.py \
  transactions/tests/test_reconciliation.py \
  transactions/tests/test_services.py \
  timeline/tests/test_ledger_forecast_matches_transactions_bal.py \
  goals \
  insights/tests/test_dashboard_summary.py::test_dashboard_projection_only_does_not_materialize_rule_transactions

# Docker
docker compose exec -T backend pytest -m ledger_regression
```

```bash
npm ci
npm test -w @budget-app/shared
npm test -w @budget-app/web
npm run build:web
```
