# Financial engine invariants

Release-critical ledger rules. The canonical regression
(`backend/common/tests/test_canonical_ledger_regression.py`, marker
`ledger_regression`) must stay green. Do not change these semantics to make a
test pass.

## Imports are bank records

Plaid-imported transactions are authoritative bank posts. Identical-looking
imports (same description, date, and amount) may all be legitimate. They must
never be deleted or hidden solely because those three fields match another
imported row. Distinct `plaid_transaction_id` values stay.

## Manual future transactions stay visible

A future-dated manual transaction remains on the projected timeline and affects
the correct future balance. It is not removed merely because no imported twin
exists yet.

## Matching may replace a manual with an import

When amount, date window, and merchant similarity meet the production matching
rules, an import may merge onto (or replace) a matching manual/scheduled row.
The surviving visible row must be counted once — never double-counted in
ledger or forecast math.

## Linked transfer and payment legs

A transfer or credit-card payment creates exactly two linked legs. Checking
moves once; the destination (savings or card) moves once. Forecasts must not
add extra synthetic legs for those posted groups.

Credit sign convention: a positive `starting_balance` on a CREDIT account is
signed debt (negative). Card payments are inflows on the card (debt down) and
outflows on checking.

## Projection-only mode does not persist rows

Dashboard / Action Center / account forecast projection walks
(`build_forecast_projection_timeline`, `projection_only=True`) must not create
`Transaction` rows. Recurring occurrences still affect projected balances once
in the window.

## Recurring occurrences count once

Each rule occurrence date appears once in a given forecast window. Materializing
due schedules is a separate write path — do not change it to make a projection
test pass.

## Forecast windows are explicit and entitlement-bounded

Allowed operational windows include 90 days (Free maximum) and 365 days
(Premium). Invalid values such as 184 days are rejected. Long windows run only
when explicitly requested and allowed for the caller’s plan. Results must not
truncate inside a supported requested window.
