"""Profile and regression tests for Reports endpoints.

BEFORE (2026-08-15, pre-refactor fixture month 2026-08):
  monthly-summary: queries=2 time_ms~272 bytes=86 writes=0
  category-breakdown: queries=5 time_ms~2.7 bytes=394 writes=0  (N+1 Category.objects.filter)
  credit-card-interest: CRASH Account.AccountStatus
  goals-report: queries=22 time_ms~21 bytes=4726 writes=0 contrib_q=3 (history[:500] + re-iterate)
  spending-targets: queries=6 time_ms~7.3 bytes=832 writes=0
  unified: not implemented
  frontend initial requests: 5
  sequential_total_ms~318

AFTER (same fixture):
  monthly-summary: queries=3 bytes=457 writes=0  (scope + one filtered aggregate over current+previous)
  category-breakdown: queries=3 bytes=643 writes=0  (grouped category__name, no N+1)
  credit-card-interest: queries=4 bytes=550 writes=0
  goals-report: queries=21 bytes=3754 writes=0 contrib_q=2  (SQL month totals, no raw history)
  spending-targets: queries=6 bytes=832 writes=0
  unified: queries=33 bytes=8420 writes=0
  frontend initial requests: 1
"""
from __future__ import annotations

import json
import time
from datetime import date
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import Account
from budgets.models import SpendingTarget
from categories.models import Category
from goals.models import GoalBucket
from timeline.models import RecurringRule
from transactions.models import Transaction

TODAY = date(2026, 8, 15)
MONTH = "2026-08"
WRITE_SQL = ("INSERT", "UPDATE", "DELETE")


def _sql_verb(sql: str) -> str:
    return sql.strip().split(None, 1)[0].upper() if sql.strip() else ""


def _count_table(queries, table: str) -> int:
    needle = table.lower()
    return sum(1 for q in queries if needle in q["sql"].lower())


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


def seed_reports_world(household, user):
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Chase",
        starting_balance=Decimal("4000"),
        currency="USD",
        include_in_forecast=True,
    )
    savings = Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        name="Savings",
        starting_balance=Decimal("8000"),
        currency="USD",
        include_in_forecast=True,
    )
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Savor",
        starting_balance=Decimal("-1200"),
        credit_limit=Decimal("5000"),
        apr=Decimal("24.99"),
        currency="USD",
        include_in_forecast=True,
        minimum_payment_amount=Decimal("35"),
    )
    salary = Category.objects.get(household=household, name="Paycheck / Salary")
    groceries = Category.objects.get(household=household, name="Groceries")
    dining = Category.objects.get(household=household, name="Dining Out")
    rent = Category.objects.get(household=household, name="Rent / Mortgage")
    Transaction.objects.create(
        account=checking, date=date(2026, 8, 1), payee="Payroll", amount=Decimal("3500"), category=salary
    )
    Transaction.objects.create(
        account=checking, date=date(2026, 8, 3), payee="Rent", amount=Decimal("-1800"), category=rent
    )
    Transaction.objects.create(
        account=checking, date=date(2026, 8, 8), payee="Store", amount=Decimal("-220"), category=groceries
    )
    Transaction.objects.create(
        account=checking, date=date(2026, 8, 12), payee="Dinner", amount=Decimal("-64"), category=dining
    )
    Transaction.objects.create(
        account=checking, date=date(2026, 7, 1), payee="Payroll", amount=Decimal("3400"), category=salary
    )
    Transaction.objects.create(
        account=checking, date=date(2026, 7, 3), payee="Rent", amount=Decimal("-1800"), category=rent
    )
    Transaction.objects.create(
        account=checking, date=date(2026, 7, 10), payee="Store", amount=Decimal("-310"), category=groceries
    )
    Transaction.objects.create(
        account=card,
        date=date(2026, 8, 20),
        payee="Interest",
        amount=Decimal("-18.40"),
        transaction_type=Transaction.TransactionType.INTEREST_CHARGE,
    )
    bucket = GoalBucket.objects.create(
        household=household,
        name="Emergency Fund",
        type=GoalBucket.BucketType.EMERGENCY,
        target_amount=Decimal("10000"),
        linked_account=savings,
        monthly_target=Decimal("400"),
        priority=GoalBucket.Priority.HIGH,
        status=GoalBucket.Status.ACTIVE,
    )
    for i, amt in enumerate((Decimal("400"), Decimal("400"), Decimal("-50"), Decimal("400"))):
        month_date = date(2026, 5 + i, 10)
        Transaction.objects.create(
            account=savings,
            date=month_date,
            payee="Goal fund",
            amount=amt,
        )
    future = date(2026, 11, 10)
    Transaction.objects.create(
        account=savings, date=future, payee="Future fund", amount=Decimal("400")
    )
    SpendingTarget.objects.create(
        household=household,
        category=groceries,
        name="Groceries limit",
        target_amount=Decimal("400"),
        period=SpendingTarget.Period.MONTHLY,
        active=True,
    )
    RecurringRule.objects.create(
        household=household,
        name="Payroll",
        account=checking,
        category=salary,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("3500"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=1,
        start_date=date(2020, 1, 1),
        active=True,
    )
    return {
        "checking": checking,
        "savings": savings,
        "card": card,
        "bucket": bucket,
        "groceries": groceries,
        "salary": salary,
    }


def _profile(auth_client: APIClient, url: str) -> dict:
    connection.queries_log.clear()
    t0 = time.perf_counter()
    with CaptureQueriesContext(connection) as ctx:
        res = auth_client.get(url)
    elapsed_ms = (time.perf_counter() - t0) * 1000
    assert res.status_code == 200, res.content[:500]
    body = res.json()
    writes = sum(1 for q in ctx.captured_queries if _sql_verb(q["sql"]) in WRITE_SQL)
    return {
        "queries": len(ctx.captured_queries),
        "elapsed_ms": elapsed_ms,
        "writes": writes,
        "bytes": len(json.dumps(body)),
        "category_queries": _count_table(ctx.captured_queries, "categories_category"),
        "contribution_queries": _count_table(ctx.captured_queries, "goals_goal_contribution"),
        "account_queries": _count_table(ctx.captured_queries, "accounts_account"),
        "body": body,
    }


@pytest.mark.django_db
def test_profile_reports_month(auth_client, household, user):
    seed_reports_world(household, user)
    endpoints = {
        "monthly-summary": f"/api/insights/monthly-summary/?month={MONTH}",
        "category-breakdown": f"/api/insights/category-breakdown/?month={MONTH}",
        "credit-card-interest": f"/api/credit-cards/interest-report/?month={MONTH}",
        "goals-report": f"/api/buckets/reports/?months=12&month={MONTH}",
        "spending-targets": f"/api/spending-targets/summary/?anchor={MONTH}-15",
    }
    print("\nREPORTS PROFILE")
    t0 = time.perf_counter()
    for name, url in endpoints.items():
        stats = _profile(auth_client, url)
        print(
            f"{name}: queries={stats['queries']} time_ms={stats['elapsed_ms']:.1f} "
            f"bytes={stats['bytes']} writes={stats['writes']} "
            f"category_q={stats['category_queries']} contrib_q={stats['contribution_queries']} "
            f"account_q={stats['account_queries']}"
        )
    unified = "/api/insights/reports/monthly/?month=" + MONTH
    unified_stats = _profile(auth_client, unified)
    print(
        f"unified: queries={unified_stats['queries']} time_ms={unified_stats['elapsed_ms']:.1f} "
        f"bytes={unified_stats['bytes']} writes={unified_stats['writes']}"
    )
    print(f"sequential_total_ms={(time.perf_counter() - t0) * 1000:.1f}")
    assert unified_stats["writes"] == 0
    assert unified_stats["queries"] < 50


@pytest.mark.django_db
def test_report_gets_are_read_only(auth_client, household, user):
    seed_reports_world(household, user)
    urls = [
        f"/api/insights/monthly-summary/?month={MONTH}",
        f"/api/insights/category-breakdown/?month={MONTH}",
        f"/api/credit-cards/interest-report/?month={MONTH}",
        f"/api/buckets/reports/?months=12&month={MONTH}",
        f"/api/spending-targets/summary/?anchor={MONTH}-15",
        f"/api/insights/reports/monthly/?month={MONTH}",
    ]
    for url in urls:
        stats = _profile(auth_client, url)
        assert stats["writes"] == 0, url


@pytest.mark.django_db
def test_monthly_summary_query_count_is_bounded(auth_client, household, user):
    seed_reports_world(household, user)
    stats = _profile(auth_client, f"/api/insights/monthly-summary/?month={MONTH}")
    assert stats["queries"] <= 5
    assert stats["writes"] == 0


@pytest.mark.django_db
def test_category_breakdown_query_count_does_not_scale_with_categories(
    auth_client, household, user
):
    world = seed_reports_world(household, user)
    checking = world["checking"]
    stats_small = _profile(auth_client, f"/api/insights/category-breakdown/?month={MONTH}")

    extra = []
    for i in range(25):
        cat = Category.objects.create(
            household=household,
            name=f"Report Cat {i:02d}",
            category_type=Category.CategoryType.EXPENSE,
            sort_order=200 + i,
        )
        extra.append(cat)
        Transaction.objects.create(
            account=checking,
            date=date(2026, 8, 9),
            payee=f"Cat {i}",
            amount=Decimal("-3.00"),
            category=cat,
        )
    stats_large = _profile(auth_client, f"/api/insights/category-breakdown/?month={MONTH}")
    assert stats_large["queries"] <= stats_small["queries"] + 1
    assert stats_large["category_queries"] <= 1
    assert len(stats_large["body"]["breakdown"]) >= 25


@pytest.mark.django_db
def test_goals_report_query_count_does_not_scale_per_goal(auth_client, household, user):
    world = seed_reports_world(household, user)
    savings = world["savings"]
    url = f"/api/buckets/reports/?months=12&month={MONTH}"
    one = _profile(auth_client, url)

    def add_goals(n: int):
        for i in range(n):
            GoalBucket.objects.create(
                household=household,
                name=f"Goal {i}",
                type=GoalBucket.BucketType.CUSTOM,
                target_amount=Decimal("1000"),
                linked_account=savings,
                monthly_target=Decimal("50"),
                priority=GoalBucket.Priority.MEDIUM,
                status=GoalBucket.Status.ACTIVE,
            )

    add_goals(9)
    ten = _profile(auth_client, url)
    add_goals(10)
    twenty = _profile(auth_client, url)
    # Shared GoalCalculationContext: contribution queries stay grouped, not 1/goal.
    assert ten["contribution_queries"] <= one["contribution_queries"] + 1
    assert twenty["contribution_queries"] <= one["contribution_queries"] + 1
    assert twenty["queries"] - one["queries"] < 20


@pytest.mark.django_db
def test_credit_card_report_query_count_does_not_scale_per_card(auth_client, household, user):
    world = seed_reports_world(household, user)
    url = f"/api/credit-cards/interest-report/?month={MONTH}"
    one = _profile(auth_client, url)

    def add_cards(n: int, start: int):
        for i in range(n):
            Account.objects.create(
                household=household,
                account_type=Account.AccountType.CREDIT,
                role=Account.AccountRole.CREDIT_CARD,
                name=f"Card {start + i}",
                starting_balance=Decimal("-200"),
                credit_limit=Decimal("2000"),
                apr=Decimal("19.99"),
                currency="USD",
                include_in_forecast=True,
                minimum_payment_amount=Decimal("25"),
            )

    add_cards(5, 1)
    six = _profile(auth_client, url)
    add_cards(14, 10)
    twenty = _profile(auth_client, url)
    assert six["queries"] <= one["queries"] + 1
    assert twenty["queries"] <= one["queries"] + 1
    assert twenty["body"]["by_card"]
    assert len(twenty["body"]["by_card"]) >= 20


@pytest.mark.django_db
def test_payoff_projection_is_sql_free_after_preload(household, user):
    world = seed_reports_world(household, user)
    from credit_cards.services.reports import _payoff_metrics_for_cards
    from accounts.services.balances import bulk_signed_ledger_balances, credit_owed_from_signed_balance

    cards = [world["card"]]
    signed = bulk_signed_ledger_balances(cards, TODAY)
    owed = {
        card.pk: credit_owed_from_signed_balance(signed.get(card.pk, Decimal("0")))
        for card in cards
    }
    connection.queries_log.clear()
    with CaptureQueriesContext(connection) as ctx:
        _payoff_metrics_for_cards(cards, owed_by_account=owed, as_of=TODAY)
    assert len(ctx.captured_queries) == 0
