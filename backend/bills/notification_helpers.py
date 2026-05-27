"""
Placeholder helpers for future bill notifications (no delivery wired here).
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from core.utils import get_households_for_user

from .services import get_monthly_bill_checklist


def bills_due_within_days(user, *, days: int = 3, as_of_date: date | None = None) -> list[dict[str, Any]]:
    """Bills with due date in (today, today + days] and status projected."""
    today = as_of_date or date.today()
    checklist = get_monthly_bill_checklist(user, month=today.month, year=today.year, as_of_date=today)
    end = today + timedelta(days=days)
    out = []
    for item in checklist.get("items") or []:
        if item.get("status") not in ("projected", "due_soon") or item.get("skipped"):
            continue
        due = date.fromisoformat(item["due_date"])
        if today < due <= end:
            out.append(item)
    return out


def missed_bills(user, *, as_of_date: date | None = None) -> list[dict[str, Any]]:
    today = as_of_date or date.today()
    checklist = get_monthly_bill_checklist(user, month=today.month, year=today.year, as_of_date=today)
    return [
        i
        for i in checklist.get("items") or []
        if i.get("status") in ("missed", "late") and not i.get("skipped")
    ]


def accounts_at_risk_for_upcoming_bills(
    user,
    *,
    as_of_date: date | None = None,
    lookahead_days: int = 7,
) -> list[dict[str, Any]]:
    """
    Placeholder: accounts where projected bill total may exceed available balance.
    Returns lightweight rows for a future notification worker.
    """
    from accounts.models import Account
    from accounts.services.balances import signed_ledger_balance

    today = as_of_date or date.today()
    due_soon = bills_due_within_days(user, days=lookahead_days, as_of_date=today)
    by_account: dict[int, Decimal] = {}
    for item in due_soon:
        aid = item["account"]["id"]
        by_account[aid] = by_account.get(aid, Decimal("0")) + Decimal(item["amount"])

    households = get_households_for_user(user)
    at_risk = []
    for acc in Account.objects.filter(household__in=households, is_hidden=False):
        need = by_account.get(acc.id)
        if not need:
            continue
        balance = signed_ledger_balance(acc, today)
        if balance < need:
            at_risk.append(
                {
                    "account_id": acc.id,
                    "account_name": acc.effective_display_name,
                    "balance": str(balance),
                    "upcoming_bills_total": str(need),
                }
            )
    return at_risk
