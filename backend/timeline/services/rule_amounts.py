"""Canonical monthly amount estimates for recurring rules (Automation / insights)."""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from timeline.models import RecurringRule


def monthly_magnitude_from_fields(
    *,
    amount: Any,
    frequency: str,
    interval: int | None,
) -> Decimal:
    """Absolute monthly equivalent (frequency-normalized)."""
    raw = abs(Decimal(str(amount or "0")))
    step = max(1, int(interval or 1))
    freq = str(frequency or "")
    if freq == RecurringRule.Frequency.WEEKLY:
        per_month = (Decimal("52") / Decimal("12") / Decimal(step)) * raw
    elif freq == RecurringRule.Frequency.BIWEEKLY:
        per_month = (Decimal("26") / Decimal("12") / Decimal(step)) * raw
    elif freq in (
        RecurringRule.Frequency.MONTHLY_DAY,
        RecurringRule.Frequency.MONTHLY_NTH_WEEKDAY,
    ):
        per_month = raw / Decimal(step)
    elif freq == RecurringRule.Frequency.YEARLY:
        per_month = raw / (Decimal("12") * Decimal(step))
    else:
        per_month = raw / Decimal(step)
    return per_month.quantize(Decimal("0.01"))


def rule_estimated_monthly_amount_from_fields(
    *,
    amount: Any,
    frequency: str,
    interval: int | None,
    direction: str,
) -> Decimal:
    """
    Signed monthly cash-flow contribution for Automation summaries.

    INCOME / TRANSFER → positive magnitude; EXPENSE → negative.
    """
    magnitude = monthly_magnitude_from_fields(
        amount=amount, frequency=frequency, interval=interval
    )
    if str(direction).upper() == RecurringRule.Direction.EXPENSE:
        return (-magnitude).quantize(Decimal("0.01"))
    return magnitude


def rule_estimated_monthly_amount(rule: RecurringRule) -> Decimal:
    return rule_estimated_monthly_amount_from_fields(
        amount=rule.amount,
        frequency=rule.frequency,
        interval=rule.interval,
        direction=rule.direction,
    )
