"""Configurable thresholds for account health indicators.

Severity, user targets, and recommended actions are separate:

- USER TARGET: per-account optimization goal (e.g. 10% utilization).
  Used by Action Center / Payment Planner to compute the payment to reach the goal.
- HEALTH SEVERITY: how serious the current condition is (Watch / At Risk / Critical).
  Missing a utilization *target* is not a financial emergency.
- REASON CODE: canonical machine-readable cause (UI emphasizes this over bare severity).
- RECOMMENDED ACTION: what to do about it (still aims at the user target).
"""
from decimal import Decimal

# Relative ATS pressure only (not an absolute small-balance watch).
# Absolute "balance under $100" watches were removed — low nominal cash ≠ unhealthy.
SAFE_TO_SPEND_LOW_PERCENT = Decimal("0.10")

# Model default when a credit account has no saved preference.
# Not a recommendation target — each account's target_utilization_percent is canonical.
DEFAULT_TARGET_UTILIZATION_PERCENT = Decimal("10")

# Absolute utilization floors for health severity. Independent of the user's target.
# High utilization is Watch / At Risk; it is never Critical by itself.
# Critical is reserved for over-limit, past-due required payments, and cash overdraft.
CREDIT_UTILIZATION_WATCH = Decimal("50")
CREDIT_UTILIZATION_RISK = Decimal("70")
# Near-limit messaging floor (still At Risk severity, not Critical).
CREDIT_UTILIZATION_NEAR_LIMIT = Decimal("90")
# Recommendation-priority floor only (Action Center "high" vs "medium"). Not account-health Critical.
CREDIT_UTILIZATION_CRITICAL = Decimal("90")

# Soft credit watches (stale due, missing payment link, high APR) require meaningful debt.
CREDIT_MEANINGFUL_OWED = Decimal("25")

PAYMENT_DUE_WATCH_DAYS = 7
PAYMENT_DUE_RISK_DAYS = 3

LARGE_OUTFLOW_WINDOW_DAYS = 7
LARGE_OUTFLOW_BALANCE_FRACTION = Decimal("0.50")

HIGH_APR_THRESHOLD = Decimal("20")

HEALTH_STATUS_HEALTHY = "healthy"
HEALTH_STATUS_WATCH = "watch"
HEALTH_STATUS_RISK = "risk"
HEALTH_STATUS_CRITICAL = "critical"

STATUS_SEVERITY = {
    HEALTH_STATUS_HEALTHY: 0,
    HEALTH_STATUS_WATCH: 1,
    HEALTH_STATUS_RISK: 2,
    HEALTH_STATUS_CRITICAL: 3,
}

# Canonical reason codes (API: health_reason_code).
REASON_FORECAST_NEGATIVE = "forecast_negative"
REASON_FORECAST_BELOW_BUFFER = "forecast_below_buffer"
REASON_SPENDING_CUSHION_SHORT = "spending_cushion_short"
REASON_SAFE_TO_SPEND_LOW = "safe_to_spend_low"
REASON_LARGE_OUTFLOW = "large_upcoming_outflow"
REASON_UTILIZATION_ABOVE_TARGET = "utilization_above_target"
REASON_HIGH_UTILIZATION = "high_utilization"
REASON_NEAR_LIMIT = "near_limit"
REASON_OVER_LIMIT = "over_limit"
REASON_PAYMENT_PAST_DUE = "payment_past_due"
REASON_PAYMENT_DUE_SOON = "payment_due_soon"
REASON_DUE_DATE_STALE = "due_date_stale"
REASON_NO_PAYMENT_LINK = "no_payment_link"
REASON_MINIMUM_PAYMENT_UNAVAILABLE = "minimum_payment_unavailable"
REASON_PROJECTED_INTEREST = "projected_interest"
REASON_HIGH_APR = "high_apr"
REASON_PAYMENT_BELOW_INTEREST = "payment_below_interest"
REASON_BALANCE_TRENDING_DOWN = "balance_trending_down"
