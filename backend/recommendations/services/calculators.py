"""
Deterministic financial calculations for recommendations.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from accounts.models import Account
from accounts.services.available_to_spend import _decimal

UTILIZATION_TARGETS = (Decimal("70"), Decimal("50"), Decimal("30"))

NON_FLEXIBLE_NAME_FRAGMENTS = (
    "mortgage",
    "rent",
    "tax",
    "irs",
    "minimum payment",
    "loan payment",
    "student loan",
)

DISCRETIONARY_CATEGORY_FRAGMENTS = (
    "amazon",
    "dining",
    "restaurant",
    "entertainment",
    "shopping",
    "subscription",
    "streaming",
    "hobby",
    "coffee",
    "delivery",
)


def quantize_money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"))


def format_money(value: Decimal) -> str:
    return str(quantize_money(value))


def format_short_date(d: date | str | None) -> str | None:
    if not d:
        return None
    if isinstance(d, str):
        try:
            d = date.fromisoformat(d[:10])
        except ValueError:
            return None
    return d.strftime("%b %d").replace(" 0", " ")


def utilization_percent(balance: Decimal, limit: Decimal) -> Decimal | None:
    if limit <= 0:
        return None
    owed = abs(balance) if balance < 0 else balance
    return quantize_money((owed / limit) * Decimal("100"))


def payment_to_reach_utilization(
    balance_owed: Decimal,
    credit_limit: Decimal,
    target_pct: Decimal,
) -> Decimal:
    """Payment amount to bring utilization to target_pct (balance owed on card)."""
    if credit_limit <= 0:
        return Decimal("0")
    target_balance = (target_pct / Decimal("100")) * credit_limit
    needed = balance_owed - target_balance
    return quantize_money(max(Decimal("0"), needed))


def transfer_amount_to_restore(
    lowest_balance: Decimal,
    minimum_buffer: Decimal,
    *,
    restore_to_buffer: bool = True,
) -> Decimal:
    if lowest_balance < Decimal("0"):
        return quantize_money(abs(lowest_balance) + minimum_buffer)
    if restore_to_buffer and lowest_balance < minimum_buffer:
        return quantize_money(minimum_buffer - lowest_balance)
    return Decimal("0")


def latest_safe_transfer_date(risk_date: date, *, buffer_days: int = 2) -> date:
    return max(risk_date - timedelta(days=buffer_days), date.today())


def priority_score(
    *,
    severity: str,
    days_until: int | None = None,
    amount_at_risk: Decimal | None = None,
    interest_impact: Decimal | None = None,
    utilization_delta: Decimal | None = None,
) -> int:
    base = {
        "critical": 1000,
        "high": 750,
        "medium": 500,
        "low": 300,
        "info": 100,
        # dashboard legacy
        "warning": 750,
    }.get(severity, 400)
    if days_until is not None:
        if days_until <= 3:
            base += 200
        elif days_until <= 7:
            base += 100
        elif days_until <= 14:
            base += 40
    if amount_at_risk:
        base += min(150, int(amount_at_risk // Decimal("50")))
    if interest_impact and interest_impact > 0:
        base += min(120, int(interest_impact // Decimal("25")))
    if utilization_delta and utilization_delta > 0:
        base += min(80, int(utilization_delta // Decimal("5")))
    return base


def account_available_for_transfer(
    account: Account,
    forecast: dict[str, Any],
    *,
    goal_reserve: Decimal = Decimal("0"),
) -> Decimal:
    if not account.participates_in_forecast():
        return Decimal("0")
    if account.is_credit_card():
        return Decimal("0")
    if account.role in (Account.AccountRole.LOAN, Account.AccountRole.INVESTMENT):
        return Decimal("0")
    lowest = _decimal(forecast.get("lowest_projected_balance") or forecast.get("current_balance") or 0)
    buffer = _decimal(forecast.get("minimum_buffer") or account.minimum_buffer or 0)
    available = lowest - buffer - goal_reserve
    return quantize_money(max(Decimal("0"), available))


def is_category_discretionary(category_name: str | None) -> bool:
    if not category_name:
        return False
    lower = category_name.lower()
    return any(fragment in lower for fragment in DISCRETIONARY_CATEGORY_FRAGMENTS)


def rule_allows_payment_delay(rule) -> bool:
    days = int(getattr(rule, "payment_flexibility_days", 0) or 0)
    if days <= 0:
        return False
    name = (rule.name or "").lower()
    if any(fragment in name for fragment in NON_FLEXIBLE_NAME_FRAGMENTS):
        return False
    if rule.transfer_to_account_id:
        return False
    return True


def map_severity_to_dashboard(severity: str) -> str:
    if severity == "high":
        return "warning"
    if severity == "medium":
        return "info"
    if severity == "low":
        return "info"
    return severity
