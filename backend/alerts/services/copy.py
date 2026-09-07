from __future__ import annotations

from datetime import date
from decimal import Decimal

from alerts.models import ProjectedFundsAlert


def format_money(amount: Decimal | str | int | float) -> str:
    value = abs(Decimal(str(amount))).quantize(Decimal("0.01"))
    if value == value.to_integral():
        return f"${int(value):,}"
    return f"${value:,.2f}"


def format_short_date(value: date) -> str:
    return value.strftime("%b ") + str(value.day)


def relative_due_phrase(occurrence_date: date, today: date) -> str:
    days = (occurrence_date - today).days
    if days <= 0:
        return "today"
    if days == 1:
        return "tomorrow"
    return format_short_date(occurrence_date)


def alert_title(alert: ProjectedFundsAlert, account_name: str) -> str:
    name = (account_name or "Account").strip() or "Account"
    if alert.alert_type == ProjectedFundsAlert.AlertType.CREDIT_LIMIT_RISK:
        return f"Charge may exceed {name} limit"
    return f"Payment may overdraw {name}"


def alert_body(alert: ProjectedFundsAlert, *, today: date) -> str:
    amount = format_money(alert.amount)
    before = format_money(alert.projected_balance_before)
    when = relative_due_phrase(alert.occurrence_date, today)
    if when in ("today", "tomorrow"):
        return f"{amount} is due {when}. FlowSight projects only {before} available."
    return (
        f"{amount} is scheduled for {when}. "
        f"FlowSight projects a {before} balance before the payment."
    )


def banner_message(alert: ProjectedFundsAlert, account_name: str) -> str:
    name = (account_name or "Account").strip() or "Account"
    if alert.alert_type == ProjectedFundsAlert.AlertType.CREDIT_LIMIT_RISK:
        return f"Upcoming charge may exceed {name} limit"
    return f"Upcoming payment may overdraw {name}"
