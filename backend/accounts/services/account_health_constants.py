"""Configurable thresholds for account health indicators.

Severity, user targets, and recommended actions are separate:

- USER TARGET: per-account optimization goal (e.g. 10% utilization).
  Used by Action Center / Payment Planner to compute the payment to reach the goal.
- HEALTH SEVERITY: how serious the current condition is (Watch / At Risk / Critical).
  Missing a utilization *target* is not a financial emergency.
- RECOMMENDED ACTION: what to do about it (still aims at the user target).
"""
from decimal import Decimal

SAFE_TO_SPEND_LOW_AMOUNT = Decimal("100")
SAFE_TO_SPEND_LOW_PERCENT = Decimal("0.10")

# Model default when a credit account has no saved preference.
# Not a recommendation target — each account's target_utilization_percent is canonical.
DEFAULT_TARGET_UTILIZATION_PERCENT = Decimal("10")

# Absolute utilization floors for health severity. Independent of the user's target.
# High utilization is Watch / At Risk; it is never Critical by itself.
# Critical is reserved for over-limit, past-due required payments, and cash overdraft.
CREDIT_UTILIZATION_WATCH = Decimal("50")
CREDIT_UTILIZATION_RISK = Decimal("70")
# Recommendation-priority floor only (Action Center "high" vs "medium"). Not account-health Critical.
CREDIT_UTILIZATION_CRITICAL = Decimal("90")

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
