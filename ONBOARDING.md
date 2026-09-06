# First-run onboarding

Web onboarding helps a new user reach a useful forecast:

> See where your money is going — and where your balance is going before you get there.

This is product UX only. Ledger math, matching, Plaid import semantics, recurring occurrence calculations, transfers, reconciliation, Stripe rules, and Free/Premium limits are unchanged.

## Status API

Authenticated endpoints (reusable by mobile later):

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

## Mobile follow-up

Mobile does **not** yet implement this guided welcome, checklist, or first-run empty states.

The onboarding status API and `@budget-app/api-client` helpers (`getOnboardingStatus`, `completeOnboarding`, `dismissOnboarding`) are ready for a later mobile pass. Until then, mobile Home may still use `isDashboardOnboarding`, which looks at $0 summary tiles and is not the source of truth for web first-run.
