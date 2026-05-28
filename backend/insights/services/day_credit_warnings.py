"""
Credit-card projected balance warnings for Timeline / Dashboard day headers.

Cash accounts use negative balance_after; credit cards use owed amount vs limit/utilization.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from accounts.models import Account
from accounts.services.account_health import (
    _credit_utilization_percent,
    _credit_utilization_thresholds,
    _target_utilization_percent,
)
from accounts.services.available_to_spend import _decimal


def _owed_from_ledger_balance(balance: Decimal) -> Decimal:
    if balance < Decimal("0"):
        return (-balance).quantize(Decimal("0.01"))
    return Decimal("0")


def build_credit_day_warning(account: Account, projected_balance: Decimal) -> str | None:
    """One concise line for a credit card's projected end-of-day owed balance."""
    if not account.is_credit_card():
        return None

    owed = _owed_from_ledger_balance(projected_balance)
    if owed <= Decimal("0"):
        return None

    name = account.effective_display_name
    limit = _decimal(account.credit_limit or 0)

    if limit > 0 and owed > limit:
        over = (owed - limit).quantize(Decimal("0.01"))
        util = _credit_utilization_percent(owed, limit)
        if util is not None:
            util_int = int(util.to_integral_value(rounding=ROUND_HALF_UP))
            return f"{name} over limit · {util_int}% utilized"
        return f"{name} over limit by ${over}"

    util = _credit_utilization_percent(owed, limit)
    if util is None:
        return f"{name} owes ${owed} projected"

    target = _target_utilization_percent(account)
    watch_at, risk_at, critical_at = _credit_utilization_thresholds(target)
    util_int = int(util.to_integral_value(rounding=ROUND_HALF_UP))

    if util >= critical_at:
        return f"{name} {util_int}% utilized"
    if util >= risk_at:
        return f"{name} {util_int}% utilized"
    if util >= watch_at:
        return f"{name} {util_int}% utilized"
    return None


def _warning_severity(account: Account, projected_balance: Decimal) -> str:
    owed = _owed_from_ledger_balance(projected_balance)
    limit = _decimal(account.credit_limit or 0)
    if limit > 0 and owed > limit:
        return "dangerous"
    util = _credit_utilization_percent(owed, limit)
    if util is None:
        return "tight"
    target = _target_utilization_percent(account)
    _, risk_at, critical_at = _credit_utilization_thresholds(target)
    if util >= critical_at:
        return "dangerous"
    if util >= risk_at:
        return "dangerous"
    return "tight"


def scan_credit_day_warnings(
    transactions: list[dict[str, Any]],
    accounts_by_id: dict[int, Account],
) -> list[dict[str, str]]:
    """
    Per credit card: worst (most owed) balance_after that day, with a display message if notable.
    """
    by_account: dict[int, Decimal] = {}

    for txn in transactions:
        aid = txn.get("account_id")
        if aid is None:
            continue
        try:
            aid_int = int(aid)
        except (TypeError, ValueError):
            continue
        account = accounts_by_id.get(aid_int)
        if not account or not account.is_credit_card():
            continue
        bal_raw = txn.get("balance_after")
        if bal_raw is None:
            continue
        bal = _decimal(bal_raw)
        current = by_account.get(aid_int)
        if current is None or bal < current:
            by_account[aid_int] = bal

    warnings: list[dict[str, str]] = []
    for aid_int, bal in by_account.items():
        account = accounts_by_id[aid_int]
        message = build_credit_day_warning(account, bal)
        if not message:
            continue
        warnings.append(
            {
                "account_name": account.effective_display_name,
                "message": message,
                "severity": _warning_severity(account, bal),
            }
        )

    severity_rank = {"dangerous": 0, "tight": 1, "watch": 2}
    warnings.sort(
        key=lambda row: (
            severity_rank.get(row.get("severity") or "watch", 9),
            row.get("account_name") or "",
        )
    )
    return warnings
