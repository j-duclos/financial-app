"""
Daily heat indicators for Timeline and Dashboard upcoming groups.

Heat is for scanability only — does not change financial calculations.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from accounts.services.available_to_spend import _decimal

HEAT_NEUTRAL = "neutral"
HEAT_HEALTHY = "healthy"
HEAT_TIGHT = "tight"
HEAT_DANGEROUS = "dangerous"

HEAT_LABELS = {
    HEAT_NEUTRAL: "Neutral",
    HEAT_HEALTHY: "Healthy",
    HEAT_TIGHT: "Tight",
    HEAT_DANGEROUS: "Dangerous",
}


@dataclass(frozen=True)
class AccountDayBalance:
    account_name: str
    balance: Decimal
    minimum_buffer: Decimal = Decimal("0")


def _worst_account(
    accounts: list[AccountDayBalance],
) -> AccountDayBalance | None:
    if not accounts:
        return None
    return min(accounts, key=lambda a: a.balance)


def calculate_day_heat(
    *,
    has_activity: bool,
    account_balances: list[AccountDayBalance],
    health_alert_names: list[str] | None = None,
) -> dict[str, Any]:
    """
    Classify a day for heatmap display.

    dangerous: any scoped account projected below zero
    tight: below minimum buffer but not negative
    healthy: activity or balances above buffer
    neutral: no activity and no balance stress in scope
    """
    health_alert_names = health_alert_names or []
    worst = _worst_account(account_balances)

    is_negative = False
    below_buffer_amount = Decimal("0")
    heat_level = HEAT_HEALTHY

    if worst is not None:
        if worst.balance < Decimal("0"):
            is_negative = True
            heat_level = HEAT_DANGEROUS
        elif worst.minimum_buffer > 0 and worst.balance < worst.minimum_buffer:
            below_buffer_amount = (worst.minimum_buffer - worst.balance).quantize(
                Decimal("0.01")
            )
            heat_level = HEAT_TIGHT

    if heat_level != HEAT_DANGEROUS:
        for name in health_alert_names:
            if name:
                heat_level = HEAT_TIGHT if heat_level == HEAT_HEALTHY else heat_level
                break

    if not has_activity and heat_level == HEAT_HEALTHY and not health_alert_names:
        if worst is None or (
            worst.balance >= worst.minimum_buffer
            and worst.balance >= Decimal("0")
        ):
            heat_level = HEAT_NEUTRAL

    affected_account_name = worst.account_name if worst else None
    lowest_projected_balance = (
        str(worst.balance.quantize(Decimal("0.01"))) if worst else None
    )

    heat_reason = _build_heat_reason(
        heat_level=heat_level,
        worst=worst,
        is_negative=is_negative,
        below_buffer_amount=below_buffer_amount,
        health_alert_names=health_alert_names,
        multi_account=len(account_balances) > 1,
    )

    return {
        "heat_level": heat_level,
        "heat_label": HEAT_LABELS[heat_level],
        "heat_reason": heat_reason,
        "affected_account_name": affected_account_name,
        "lowest_projected_balance": lowest_projected_balance,
        "below_buffer_amount": (
            str(below_buffer_amount.quantize(Decimal("0.01")))
            if below_buffer_amount > 0
            else None
        ),
        "is_negative": is_negative,
    }


def _build_heat_reason(
    *,
    heat_level: str,
    worst: AccountDayBalance | None,
    is_negative: bool,
    below_buffer_amount: Decimal,
    health_alert_names: list[str],
    multi_account: bool,
) -> str | None:
    if heat_level == HEAT_NEUTRAL:
        return None
    if health_alert_names and heat_level != HEAT_DANGEROUS:
        if len(health_alert_names) == 1:
            return f"{health_alert_names[0]} projected below buffer"
        return f"{health_alert_names[0]} and others projected at risk"
    if worst is None:
        return None
    prefix = "Worst: " if multi_account and heat_level == HEAT_DANGEROUS else ""
    if is_negative:
        return f"{prefix}{worst.account_name} projected negative"
    if below_buffer_amount > 0:
        amt = below_buffer_amount.quantize(Decimal("0.01"))
        return f"Below buffer: {worst.account_name} ${amt}"
    if heat_level == HEAT_HEALTHY and not health_alert_names:
        return None
    return f"{worst.account_name} needs attention"


def account_balances_from_txn_lows(
    lowest_rows: list[dict[str, Any]],
    accounts_by_id: dict[int, Any],
) -> list[AccountDayBalance]:
    """Build account snapshots from serialized txn balance_after rows."""
    by_name: dict[str, Decimal] = {}
    for row in lowest_rows:
        name = (row.get("account_name") or "Account").strip()
        bal = _decimal(row.get("balance") or row.get("balance_after") or 0)
        if name not in by_name or bal < by_name[name]:
            by_name[name] = bal
    out: list[AccountDayBalance] = []
    for name, bal in by_name.items():
        buffer = Decimal("0")
        for acc in accounts_by_id.values():
            if acc.effective_display_name == name:
                buffer = _decimal(acc.minimum_buffer or 0)
                break
        out.append(AccountDayBalance(account_name=name, balance=bal, minimum_buffer=buffer))
    return out


def heat_to_risk_level(heat_level: str) -> str:
    """Map heat to legacy calendar risk_level."""
    if heat_level == HEAT_DANGEROUS:
        return "critical"
    if heat_level == HEAT_TIGHT:
        return "watch"
    return "none"
