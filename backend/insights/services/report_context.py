"""Lightweight shared scope for monthly Reports (not a full forecast context)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from accounts.models import Account
from core.utils import get_households_for_user
from insights.services.report_dates import ReportPeriod, report_period


@dataclass
class ReportContext:
    user: Any
    period: ReportPeriod
    households: Any
    household_ids: list[int]
    accounts: list[Account]
    accounts_by_id: dict[int, Account]
    account_ids: list[int]


def build_report_context(
    user,
    month: str,
    *,
    history_months: int = 12,
    household_id: int | None = None,
) -> ReportContext:
    period = report_period(month, history_months=history_months)
    households = get_households_for_user(user)
    if household_id:
        households = households.filter(pk=household_id)
    household_list = list(households)
    household_ids = [h.id for h in household_list]
    accounts = list(
        Account.objects.for_historical_reporting()
        .filter(household_id__in=household_ids)
        .select_related("household")
        .order_by("name")
    )
    return ReportContext(
        user=user,
        period=period,
        households=household_list,
        household_ids=household_ids,
        accounts=accounts,
        accounts_by_id={a.id: a for a in accounts},
        account_ids=[a.id for a in accounts],
    )
