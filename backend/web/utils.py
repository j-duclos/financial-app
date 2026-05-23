"""Shared helpers for the server-rendered web UI."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Q, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from accounts.models import Account
from accounts.services.account_health import (
    calculate_account_health_for_accounts,
)
from accounts.services.available_to_spend import (
    DEFAULT_FORECAST_DAYS,
    calculate_forecast_summaries_for_accounts,
    dashboard_safe_to_spend_aggregate,
)
from core.utils import get_households_for_user, get_user_profile
from timeline.services.ledger import _balance_at_end_of_date, build_timeline
from transactions.models import Transaction
from transactions.services.matching import ledger_visible_transactions


def get_default_household(user):
    households = get_households_for_user(user)
    profile = get_user_profile(user)
    if profile and profile.default_household_id:
        hh = households.filter(pk=profile.default_household_id).first()
        if hh:
            return hh
    return households.first()


def user_accounts(user, *, include_archived=False):
    households = get_households_for_user(user)
    qs = Account.objects.filter(household__in=households).select_related("household")
    if not include_archived:
        qs = qs.exclude(status=Account.Status.DELETED)
        if not include_archived:
            qs = qs.filter(
                Q(status=Account.Status.ACTIVE)
                | Q(status=Account.Status.ARCHIVED)
                | Q(status=Account.Status.CLOSED)
            )
    return qs.order_by("position", "display_name", "name")


def account_current_balance(account: Account, as_of: date | None = None) -> Decimal:
    return _balance_at_end_of_date(account.pk, as_of or timezone.localdate())


def format_money(val, *, prefix="$") -> str:
    if val is None:
        return "—"
    d = Decimal(str(val))
    sign = "-" if d < 0 else ""
    return f"{sign}{prefix}{abs(d):,.2f}"


def money_class(val) -> str:
    if val is None:
        return ""
    d = Decimal(str(val))
    if d < 0:
        return "negative"
    if d < Decimal("100"):
        return "low"
    return ""


def dashboard_summary(user) -> dict:
    today = timezone.localdate()
    accounts = list(user_accounts(user))
    active = [a for a in accounts if a.status == Account.Status.ACTIVE]
    cash_types = {
        Account.AccountType.CHECKING,
        Account.AccountType.SAVINGS,
        Account.AccountType.CASH,
    }
    cash_balance = Decimal("0")
    for acc in active:
        if acc.account_type in cash_types:
            cash_balance += account_current_balance(acc, today)

    unreconciled = ledger_visible_transactions(
        Transaction.objects.filter(
            account__in=[a.pk for a in active],
            reconciled=False,
            date__lte=today,
        )
    ).count()

    forecast_by_id = calculate_forecast_summaries_for_accounts(
        user, active, days=DEFAULT_FORECAST_DAYS
    ) if active else {}
    lowest = None
    for fs in forecast_by_id.values():
        lb = fs.get("lowest_projected_balance")
        if lb is not None:
            lb = Decimal(str(lb))
            if lowest is None or lb < lowest:
                lowest = lb

    end = today + timedelta(days=DEFAULT_FORECAST_DAYS)
    timeline_rows = build_timeline(user, start_date=today + timedelta(days=1), end_date=end) if active else []
    upcoming_count = len([r for r in timeline_rows if r.get("date") and r["date"] > today])

    return {
        "total_accounts": len(active),
        "cash_balance": cash_balance,
        "upcoming_transactions": upcoming_count,
        "lowest_projected_balance": lowest,
        "unreconciled_transactions": unreconciled,
    }


def budget_spent_for_category(household_id: int, category_id: int, year: int, month: int) -> Decimal:
    account_ids = Account.objects.for_historical_reporting().filter(
        household_id=household_id,
    ).values_list("id", flat=True)
    total = (
        Transaction.objects.filter(
            account_id__in=account_ids,
            category_id=category_id,
            date__year=year,
            date__month=month,
            amount__lt=0,
        ).aggregate(s=Coalesce(Sum("amount"), Decimal("0")))["s"]
        or Decimal("0")
    )
    return abs(total)


def insights_warnings(user) -> list[dict]:
    """Derive dashboard-style warnings from forecast, health, and recent activity."""
    warnings: list[dict] = []
    today = timezone.localdate()
    accounts = list(user_accounts(user))
    active = [a for a in accounts if a.status == Account.Status.ACTIVE]
    if not active:
        return warnings

    forecast_by_id = calculate_forecast_summaries_for_accounts(user, active, days=30)
    health_by_id = calculate_account_health_for_accounts(user, active, days=30)

    for acc in active:
        fs = forecast_by_id.get(acc.id) or {}
        lowest = fs.get("lowest_projected_balance")
        if lowest is not None and Decimal(str(lowest)) < 0:
            warnings.append({
                "level": "critical",
                "title": "Upcoming overdraft",
                "detail": f"{acc.effective_display_name} may go negative (lowest projected {format_money(lowest)}).",
            })
        risk = fs.get("risk_status")
        if risk in ("risk", "critical"):
            warnings.append({
                "level": "warning",
                "title": "Cashflow risk",
                "detail": fs.get("risk_reason") or f"{acc.effective_display_name} forecast risk: {risk}.",
            })
        health = health_by_id.get(acc.id) or {}
        hstatus = health.get("status")
        if hstatus and hstatus not in ("healthy", None):
            warnings.append({
                "level": "warning" if hstatus != "critical" else "critical",
                "title": "Account health",
                "detail": health.get("reason") or f"{acc.effective_display_name}: {hstatus}.",
            })

    month_start = today.replace(day=1)
    account_ids = [a.pk for a in active]
    large = (
        Transaction.objects.filter(
            account_id__in=account_ids,
            date__gte=month_start,
            amount__lt=Decimal("-500"),
        )
        .select_related("account", "category")
        .order_by("amount")[:5]
    )
    for txn in large:
        warnings.append({
            "level": "info",
            "title": "Large expense",
            "detail": f"{txn.payee or 'Expense'} on {txn.account.effective_display_name}: {format_money(txn.amount)}.",
        })

    from timeline.models import RecurringRule

    households = get_households_for_user(user)
    subs = RecurringRule.objects.filter(
        household__in=households,
        active=True,
        direction=RecurringRule.Direction.EXPENSE,
    ).filter(
        Q(name__icontains="subscription")
        | Q(name__icontains="netflix")
        | Q(name__icontains="spotify")
        | Q(name__icontains="hulu")
        | Q(name__icontains="disney")
    )[:8]
    for rule in subs:
        warnings.append({
            "level": "info",
            "title": "Possible subscription",
            "detail": f"{rule.name} — {format_money(rule.amount)}/{rule.get_frequency_display().lower()}.",
        })

    agg = dashboard_safe_to_spend_aggregate(forecast_by_id, {a.id: a for a in active})
    if agg.get("lowest_projected_balance") is not None:
        lb = Decimal(str(agg["lowest_projected_balance"]))
        if Decimal("0") <= lb < Decimal("100"):
            warnings.append({
                "level": "warning",
                "title": "Low balance",
                "detail": f"Household lowest projected balance in 30 days: {format_money(lb)}.",
            })

    return warnings[:20]
