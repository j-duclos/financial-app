"""Configurable thresholds for account health indicators."""
from decimal import Decimal

SAFE_TO_SPEND_LOW_AMOUNT = Decimal("100")
SAFE_TO_SPEND_LOW_PERCENT = Decimal("0.10")

# Model default when a credit account has no saved preference.
# Not a recommendation target — each account's target_utilization_percent is canonical.
DEFAULT_TARGET_UTILIZATION_PERCENT = Decimal("10")

# Fixed risk-severity floors (independent of the user's utilization target).
# A 10% target does not make 11% Critical; these classify how stretched a card is.
CREDIT_UTILIZATION_WATCH = Decimal("50")
CREDIT_UTILIZATION_RISK = Decimal("70")
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
