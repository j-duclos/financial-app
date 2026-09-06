# Account export and deletion

Financial data is **household-owned**. A user may belong to one or more households. Export and deletion use the same membership boundary as the rest of the app.

## What is deleted immediately with the user

- Django `User` row (username, email, password hash)
- `UserProfile`
- `HouseholdMembership` rows for that user
- Local `BillingSubscription` row
- Households where the user was the **only remaining member**, including that household’s accounts, transactions, rules, goals, categories, budgets, scenarios, and Plaid Items (after Plaid `/item/remove`)

Audit fields such as `created_by` on goals/transfers use `SET_NULL` and may remain on shared household rows as anonymized history.

## What can remain for other members

If other people are still members of a household:

- Household financial data is **not** deleted
- Shared Plaid Items are **not** revoked (Items have no per-user owner field)
- The deleting user’s membership is removed

If the user is the **sole OWNER** and other members remain, deletion is **blocked** until ownership is transferred. The app does not auto-promote another member.

## Stripe

Active/trialing subscriptions are **canceled immediately** via the Stripe API before the local user is removed. The Stripe Customer object is **not** deleted so Stripe can retain payment records under its own policies. Local billing linkage is removed with the user.

If Stripe cancellation fails, the local account is left intact.

## Plaid

Plaid `/item/remove` is called only for Items on households that will be deleted. Access-token ciphertext is never logged. If revocation fails, the local account and Plaid records remain so the operation can be retried.

## What this process cannot erase

- Stripe’s legally retained payment/customer records
- Plaid’s own logs after a successful Item remove
- Application backups, database snapshots, and operational logs kept by the host (e.g. Render) for their retention window

This is not a guarantee of instant physical erasure from every backup.
