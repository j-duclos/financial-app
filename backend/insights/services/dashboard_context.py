"""Shared dashboard request scope and bulk-loaded support data."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

from django.core.cache import cache

from accounts.models import Account
from accounts.services.account_health import (
    AccountHealthSupportData,
    build_account_health_context,
)
from accounts.services.balances import bulk_signed_ledger_balances
from common.services.cache import (
    DASHBOARD_SUMMARY_CACHE_SECONDS,
    get_dashboard_shared_context_cache_key,
)
from core.utils import get_households_for_user


@dataclass
class DashboardRequestContext:
    """Resolved once per dashboard request and passed down the pipeline."""

    user: Any
    today: date
    days: int
    households: list
    household_ids: list[int]
    accounts: list[Account]
    accounts_by_id: dict[int, Account]
    signed_balances: dict[int, Decimal]
    unmatched_import_counts: dict[int, int]
    payment_link_account_ids: set[int]
    planned_loan_payment_account_ids: set[int]
    payments_since_statement: dict[int, Decimal]

    def health_support(self) -> AccountHealthSupportData:
        return AccountHealthSupportData(
            signed_balances=self.signed_balances,
            unmatched_import_counts=self.unmatched_import_counts,
            payment_link_account_ids=self.payment_link_account_ids,
            planned_loan_payment_account_ids=self.planned_loan_payment_account_ids,
            payments_since_statement=self.payments_since_statement,
        )


def resolve_dashboard_scope(
    user,
    *,
    households=None,
    household_ids: list[int] | None = None,
) -> tuple[list, list[int], list[Account], dict[int, Account]]:
    if households is None:
        households = list(get_households_for_user(user))
    else:
        households = list(households)
    if household_ids is None:
        household_ids = [h.id for h in households]
    accounts = list(
        Account.objects.non_deleted()
        .filter(household_id__in=household_ids, is_hidden=False)
        .select_related("household")
    )
    accounts_by_id = {a.id: a for a in accounts}
    return households, household_ids, accounts, accounts_by_id


def build_dashboard_request_context(
    user,
    *,
    today: date,
    days: int,
    households=None,
    household_ids: list[int] | None = None,
    include_health_support: bool = True,
) -> DashboardRequestContext:
    households, household_ids, accounts, accounts_by_id = resolve_dashboard_scope(
        user, households=households, household_ids=household_ids
    )
    signed_balances: dict[int, Decimal] = {}
    unmatched: dict[int, int] = {}
    payment_links: set[int] = set()
    planned_loans: set[int] = set()
    statement_payments: dict[int, Decimal] = {}
    if include_health_support:
        signed_balances = bulk_signed_ledger_balances(accounts, today)
        health = build_account_health_context(
            accounts, today=today, signed_balances=signed_balances
        )
        unmatched = health.unmatched_import_counts
        payment_links = health.payment_link_account_ids
        planned_loans = health.planned_loan_payment_account_ids
        statement_payments = health.payments_since_statement
    return DashboardRequestContext(
        user=user,
        today=today,
        days=days,
        households=households,
        household_ids=household_ids,
        accounts=accounts,
        accounts_by_id=accounts_by_id,
        signed_balances=signed_balances,
        unmatched_import_counts=unmatched,
        payment_link_account_ids=payment_links,
        planned_loan_payment_account_ids=planned_loans,
        payments_since_statement=statement_payments,
    )


def dashboard_shared_context_scope(
    user,
    *,
    days: int,
    as_of_date: date,
    household_ids: list[int],
) -> dict[str, Any]:
    """Cache-key fields shared by dashboard fast/details and Action Center."""
    return {
        "user_id": user.pk,
        "household_ids": household_ids,
        "forecast_days": days,
        "as_of_date": as_of_date,
    }


def load_dashboard_shared_context(scope: dict[str, Any]) -> dict[str, Any] | None:
    """Return cached timeline/forecast/health core, or None on miss."""
    cache_key = get_dashboard_shared_context_cache_key(**scope)
    cached = cache.get(cache_key)
    return cached if isinstance(cached, dict) else None


def store_dashboard_shared_context(scope: dict[str, Any], context: dict[str, Any]) -> None:
    cache_key = get_dashboard_shared_context_cache_key(**scope)
    cache.set(cache_key, context, timeout=DASHBOARD_SUMMARY_CACHE_SECONDS)
