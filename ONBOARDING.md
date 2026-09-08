# First-run onboarding

Web onboarding helps a new user reach a useful forecast:

> See where your money is going — and where your balance is going before you get there.

This is product UX only. Ledger math, matching, Plaid import semantics, recurring occurrence calculations, transfers, reconciliation, Stripe rules, and Free/Premium limits are unchanged.

## Status API

Authenticated endpoints:

- `GET /api/onboarding/status/`
- `POST /api/onboarding/complete/`
- `POST /api/onboarding/dismiss/`

Progress is derived from household-scoped existence checks (`has_account`, `has_transaction`, `has_recurring`). Only completion and dismissal timestamps are stored on `UserProfile`. The payload also includes a cheap `checklist` object (`account`, `upcoming_transaction`, `recurring`, `goal`) for progressive Getting Started UI. `upcoming_transaction` is a future-dated manual/planned row (not rule/interest/system). `goal` is an active or paused goal bucket. These flags do not change `forecast_ready`.

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

When `steps.account` is false, Home shows a first-run empty state plus the Getting Started checklist, and does not load dashboard summary queries:

- Welcome (one screen, not a carousel): “Welcome to FlowSight” / Get started / Skip for now
- Free: Add account manually + Upgrade for automatic bank syncing
- Premium: Add account manually + Connect bank (explains that bank linking is on web; mobile has no Plaid Link flow yet)

After the first account exists, Home shows the normal dashboard with a Getting Started card below the header (account, upcoming transaction, recurring, calendar, goal). Completion is derived from real data (`checklist` on the status payload, plus a local “opened Calendar” flag). The card hides when all five items are done, and can be collapsed after 4 of 5.

One-time education (welcome, first-account success, first-transaction forecast, calendar intro) is stored locally per user (`getting-started-education:{userId}`) so it does not reappear every session.

Onboarding is not a paywall. Manual accounts and manual transactions remain available on Free. The Getting Started checklist does not contain upgrade buttons.
