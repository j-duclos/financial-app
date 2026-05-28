"""
Recovery date detection for stressed forecast days.

When a scoped account dips below zero or buffer, find the first future day
balance returns to the recovery threshold (zero or safe buffer).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from accounts.services.available_to_spend import _decimal
from insights.services.forecast_severity import (
    SEVERITY_DANGEROUS,
    SEVERITY_TIGHT,
    recovery_threshold_for_severity,
)


def _parse_date(iso: str) -> date:
    return date.fromisoformat(iso[:10])


def _balance_on_day(day: dict[str, Any], account_id: int | None) -> Decimal | None:
    """Ending balance for account on a calendar day."""
    balances = day.get("account_balances") or {}
    if account_id is not None:
        raw = balances.get(str(account_id)) or balances.get(account_id)
        if raw is not None:
            return _decimal(raw)
    return _decimal(day.get("ending_balance"))


def _recovery_account_id(day: dict[str, Any]) -> int | None:
    aid = day.get("lowest_projected_balance_account_id")
    if aid is not None:
        try:
            return int(aid)
        except (TypeError, ValueError):
            pass
    return None


def _recovery_severity(day: dict[str, Any]) -> str | None:
    level = day.get("heat_level")
    if level in (SEVERITY_DANGEROUS, SEVERITY_TIGHT):
        return level
    if day.get("is_negative"):
        return SEVERITY_DANGEROUS
    if day.get("has_risk"):
        return SEVERITY_TIGHT
    return None


def _recovery_trigger_description(future_day: dict[str, Any], account_id: int | None) -> str | None:
    """Largest positive inflow on recovery day for the stressed account."""
    best_desc: str | None = None
    best_amt = Decimal("0")
    for txn in future_day.get("transactions") or []:
        if account_id is not None and txn.get("account_id") != account_id:
            continue
        if txn.get("is_transfer"):
            continue
        amt = _decimal(txn.get("amount") or 0)
        if amt > best_amt:
            best_amt = amt
            best_desc = (txn.get("description") or "").strip() or None
    return best_desc


def _is_payroll_like(description: str | None) -> bool:
    if not description:
        return False
    lower = description.lower()
    return any(
        token in lower
        for token in ("payroll", "pay check", "paycheck", "direct dep", "salary", "wages")
    )


def attach_recovery_to_days(
    days: list[dict[str, Any]],
    *,
    accounts_by_id: dict[int, Any],
) -> None:
    """
    Mutates each day dict with recovery_* fields when a future recovery exists.
    """
    n = len(days)
    for i, day in enumerate(days):
        severity = _recovery_severity(day)
        if not severity:
            continue
        account_id = _recovery_account_id(day)
        acc = accounts_by_id.get(account_id) if account_id else None
        buffer = _decimal(acc.minimum_buffer or 0) if acc else Decimal("0")
        threshold = recovery_threshold_for_severity(severity, buffer)
        start = _parse_date(day["date"])
        start_bal = _balance_on_day(day, account_id)
        if start_bal is None:
            continue
        if start_bal >= threshold and severity != SEVERITY_DANGEROUS:
            continue

        for j in range(i + 1, n):
            future = days[j]
            bal = _balance_on_day(future, account_id)
            if bal is None:
                continue
            if bal >= threshold:
                recovery_date = future["date"]
                days_until = (_parse_date(recovery_date) - start).days
                desc = _recovery_trigger_description(future, account_id)
                target = "zero" if threshold <= Decimal("0") else "buffer"
                day["recovery_date"] = recovery_date
                day["recovery_days_until"] = days_until
                day["recovery_target"] = target
                day["recovery_description"] = desc
                day["recovery_is_payroll"] = _is_payroll_like(desc)
                day["recovery_balance"] = str(bal.quantize(Decimal("0.01")))
                break
