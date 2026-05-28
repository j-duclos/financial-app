"""
Unified forecast severity for calendar, timeline, dashboard, and recommendations.

Severity is display-only; does not alter ledger math.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from insights.services.day_heat import (
    HEAT_DANGEROUS,
    HEAT_HEALTHY,
    HEAT_NEUTRAL,
    HEAT_TIGHT,
    HEAT_LABELS,
    AccountDayBalance,
    calculate_day_heat,
    heat_to_risk_level,
)

# Canonical severity tokens (alias heat levels for API stability).
SEVERITY_NEUTRAL = HEAT_NEUTRAL
SEVERITY_HEALTHY = HEAT_HEALTHY
SEVERITY_TIGHT = HEAT_TIGHT
SEVERITY_DANGEROUS = HEAT_DANGEROUS

SEVERITY_LABELS = HEAT_LABELS


def determine_forecast_severity(
    *,
    has_activity: bool,
    account_balances: list[AccountDayBalance],
    health_alert_names: list[str] | None = None,
) -> dict[str, Any]:
    """Classify forecast severity for a day or account snapshot."""
    return calculate_day_heat(
        has_activity=has_activity,
        account_balances=account_balances,
        health_alert_names=health_alert_names,
    )


def severity_to_risk_level(severity: str) -> str:
    return heat_to_risk_level(severity)


def is_stressed_severity(severity: str) -> bool:
    return severity in (SEVERITY_TIGHT, SEVERITY_DANGEROUS)


def recovery_threshold_for_severity(
    severity: str,
    minimum_buffer: Decimal,
) -> Decimal:
    """Balance target for recovery: zero when dangerous, buffer when only tight."""
    if severity == SEVERITY_DANGEROUS:
        return Decimal("0")
    return minimum_buffer
