"""
Shared inputs for the recommendation engine.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any

from accounts.models import Account
from accounts.services.available_to_spend import _decimal
from accounts.services.balances import credit_owed_from_signed_balance


@dataclass
class RecommendationContext:
    user: Any
    today: date
    days: int
    accounts: list[Account]
    accounts_by_id: dict[int, Account]
    forecasts: dict[int, dict[str, Any]]
    st_aggregate: dict[str, Any]
    timeline_rows: list[dict[str, Any]]
    health_by_id: dict[int, dict[str, Any]]
    upcoming_events: list[dict[str, Any]] = field(default_factory=list)
    bills_summary: dict[str, Any] | None = None
    debt_summary: dict[str, Any] | None = None
    goals_aggregate: dict[str, Any] | None = None
    dashboard_goals: list[dict[str, Any]] = field(default_factory=list)
    recurring_rules: list[Any] = field(default_factory=list)
    rules_by_id: dict[int, Any] = field(default_factory=dict)
    scenario_id: int | None = None
    survival_mode: bool = False
    signed_balances: dict[int, Decimal] = field(default_factory=dict)
    owed_balances: dict[int, Decimal] = field(default_factory=dict)
    timeline_by_account: dict[int, list[dict[str, Any]]] = field(default_factory=dict)
    inflows_by_account_date: dict[int, dict[date, Decimal]] = field(default_factory=dict)
    spending_targets_summary: dict[str, Any] | None = None
    household_ids: list[int] = field(default_factory=list)

    def rows_for_account(self, account_id: int) -> list[dict[str, Any]]:
        if account_id in self.timeline_by_account:
            return self.timeline_by_account[account_id]
        return [row for row in self.timeline_rows if row.get("account_id") == account_id]

    def inflows_for_account(self, account_id: int) -> dict[date, Decimal]:
        if account_id in self.inflows_by_account_date:
            return self.inflows_by_account_date[account_id]
        daily: dict[date, Decimal] = defaultdict(lambda: Decimal("0"))
        for row in self.rows_for_account(account_id):
            amt = _decimal(row.get("amount") or 0)
            if amt > 0:
                daily[timeline_row_date(row)] += amt
        return dict(daily)

    def owed_for(self, account_id: int) -> Decimal:
        if account_id in self.owed_balances:
            return self.owed_balances[account_id]
        signed = self.signed_balances.get(account_id)
        if signed is not None:
            return credit_owed_from_signed_balance(signed)
        return Decimal("0")


def timeline_row_date(row: dict[str, Any]) -> date:
    row_date = row["date"]
    if isinstance(row_date, date):
        return row_date
    return date.fromisoformat(str(row_date)[:10])


def owed_balances_from_signed(signed_balances: dict[int, Decimal]) -> dict[int, Decimal]:
    return {
        account_id: credit_owed_from_signed_balance(balance)
        for account_id, balance in signed_balances.items()
    }


def index_timeline_rows(
    timeline_rows: list[dict[str, Any]],
) -> tuple[dict[int, list[dict[str, Any]]], dict[int, dict[date, Decimal]]]:
    """Group timeline rows by account and sum positive cashflow by account/date."""
    by_account: dict[int, list[dict[str, Any]]] = defaultdict(list)
    inflows: dict[int, dict[date, Decimal]] = defaultdict(lambda: defaultdict(lambda: Decimal("0")))
    for row in timeline_rows:
        account_id = row.get("account_id")
        if account_id is None:
            continue
        account_id = int(account_id)
        by_account[account_id].append(row)
        amount = _decimal(row.get("amount") or 0)
        if amount > 0:
            inflows[account_id][timeline_row_date(row)] += amount
    return dict(by_account), {aid: dict(days) for aid, days in inflows.items()}
