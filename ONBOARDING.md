# First-run onboarding

Web onboarding helps a new user reach a useful forecast:

> See where your money is going — and where your balance is going before you get there.

This is product UX only. Ledger math, matching, Plaid import semantics, recurring occurrence calculations, transfers, reconciliation, Stripe rules, and Free/Premium limits are unchanged.

## Status API

Authenticated endpoints:

- `GET /api/onboarding/status/`
- `POST /api/onboarding/complete/`
- `POST /api/onboarding/dismiss/`

Progress is derived from household-scoped existence checks (`has_account`, `has_transaction`, `has_recurring`). Only completion and dismissal timestamps are stored on `UserProfile`.

Forecast-ready:

```
has_account AND (has_transaction OR has_recurring)
```

A $0 starting balance is not an empty state.

## Web surfaces

- Welcome modal after login when `show_welcome` is true (Get started hides for the session; Skip dismisses)
- Dashboard first-run empty state when the user has no accounts
- Checklist until setup is complete or dismissed
- Empty states on Accounts, Transactions, and Recurring

Free users get a manual path (up to 3 accounts). Premium users also see Connect bank. Onboarding is not a paywall.

## Mobile

Mobile Home uses the same `GET /api/onboarding/status/` source of truth as web (`useOnboardingStatus`, query key `["onboarding", "status"]`). It does **not** infer first-run from $0 dashboard tiles (`isDashboardOnboarding`).

When `steps.account` is false, Home shows a first-run empty state (“Build your first forecast”) and does not load dashboard summary queries:

- Free: Add account manually + Upgrade for automatic bank syncing
- Premium: Add account manually + Connect bank (explains that bank linking is on web; mobile has no Plaid Link flow yet)

Onboarding is not a paywall. Manual accounts remain available on Free (max 3).

Mobile does not yet implement the web welcome modal or checklist; those remain web-first.
