# BEFORE (captured 2026-08-15):
#   1 target:  9 queries, 6.5ms, category_q=4 txn_q=4 rule_q=3 skip_q=1
#   4 targets: 31 queries, ~50ms, category_q=13 txn_q=16 rule_q=10 skip_q=4
#   20 targets: 155 queries, 104ms, category_q=61 txn_q=80 rule_q=54 skip_q=20
# AFTER:
#   1/4/20 targets: 7 queries each, ~6–10ms, category_q=4 txn_q=2 rule_q=3 skip_q=1
#   4-target summary: 7 queries, ~6ms (first-request ~250ms includes test DB setup noise)

from __future__ import annotations

import time
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import Account
from budgets.models import SpendingTarget
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule, RecurringRuleSkip
from transactions.models import Transaction

User = get_user_model()
AS_OF = date.today()
ANCHOR = AS_OF.isoformat()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="steff", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Spending Efficiency HH")
    HouseholdMembership.objects.create(
        household=h, user=user, role=HouseholdMembership.Role.OWNER
    )
    return h


@pytest.fixture
def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _cat(household, name: str) -> Category:
    return Category.objects.get(
        household=household,
        name=name,
        category_type=Category.CategoryType.EXPENSE,
    )


def _sql_verb(sql: str) -> str:
    return sql.strip().split(None, 1)[0].upper() if sql.strip() else ""


def _count_table(queries, table: str) -> int:
    needle = table.lower()
    return sum(1 for q in queries if needle in q["sql"].lower())


def _profile(auth_client, url: str) -> dict:
    connection.queries_log.clear()
    t0 = time.perf_counter()
    with CaptureQueriesContext(connection) as ctx:
        res = auth_client.get(url)
    elapsed_ms = (time.perf_counter() - t0) * 1000
    assert res.status_code == 200, res.content[:400]
    writes = sum(
        1 for q in ctx.captured_queries if _sql_verb(q["sql"]) in ("INSERT", "UPDATE", "DELETE")
    )
    return {
        "queries": len(ctx.captured_queries),
        "elapsed_ms": elapsed_ms,
        "writes": writes,
        "category_queries": _count_table(ctx.captured_queries, "categories_category"),
        "txn_queries": _count_table(ctx.captured_queries, "transactions_transaction"),
        "rule_queries": _count_table(ctx.captured_queries, "timeline_recurring_rule"),
        "skip_queries": _count_table(ctx.captured_queries, "timeline_recurring_rule_skip"),
        "body": res.json(),
    }


def seed_spending_limits(household, *, n_targets: int) -> dict:
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Checking",
        starting_balance=Decimal("4000"),
        currency="USD",
    )
    names = [
        "Auto Insurance",
        "Credit Card Payment",
        "Groceries",
        "Health Insurance",
        "Electricity",
        "Internet",
        "Streaming",
        "Gym / Fitness",
        "Dining Out",
        "Gas / Fuel",
        "Mobile Phone",
        "Water / Sewer",
        "Trash",
        "Clothing",
        "Pharmacy",
        "Pet Food",
        "Hobbies",
        "Coffee / Snacks",
        "Parking / Tolls",
        "Movies / Games",
    ]
    targets = []
    for i in range(n_targets):
        name = names[i % len(names)]
        if i >= len(names):
            name = names[i % 4]
        cat = _cat(household, name)
        target, _ = SpendingTarget.objects.get_or_create(
            household=household,
            category=cat,
            period=SpendingTarget.Period.MONTHLY,
            account=None,
            defaults={
                "target_amount": Decimal("400") + Decimal(i),
                "target_type": SpendingTarget.TargetType.VARIABLE,
                "active": True,
            },
        )
        if target not in targets:
            targets.append(target)
        day = min(5 + (i % 20), 28)
        Transaction.objects.create(
            account=checking,
            date=AS_OF.replace(day=min(AS_OF.day, 28)) - timedelta(days=(i % 10)),
            payee=name,
            amount=Decimal("-50") - Decimal(i),
            category=cat,
            status=Transaction.Status.CLEARED,
            source=Transaction.Source.PLAID,
            cleared=True,
        )
        if i % 2 == 0:
            rule = RecurringRule.objects.create(
                household=household,
                name=f"{name} rule {i}",
                account=checking,
                category=cat,
                direction=RecurringRule.Direction.EXPENSE,
                amount=Decimal("80.00"),
                frequency=RecurringRule.Frequency.MONTHLY_DAY,
                day_of_month=day,
                start_date=date(2024, 1, 1),
                active=True,
            )
            future = AS_OF.replace(day=min(day, 28))
            if future <= AS_OF:
                future = date(AS_OF.year + (1 if AS_OF.month == 12 else 0), (AS_OF.month % 12) + 1, min(day, 28)) if False else AS_OF + timedelta(days=3)
            Transaction.objects.create(
                account=checking,
                date=AS_OF + timedelta(days=8 + (i % 5)),
                payee=name,
                amount=Decimal("-80.00"),
                category=cat,
                status=Transaction.Status.PLANNED,
                source=Transaction.Source.RULE,
                rule=rule,
            )
            if i % 4 == 0:
                RecurringRuleSkip.objects.create(rule=rule, date=AS_OF + timedelta(days=12))
    return {"checking": checking, "targets": targets}


def _print(label: str, stats: dict, n_targets: int) -> None:
    print(
        f"\n{label} targets={n_targets} queries={stats['queries']} "
        f"time_ms={stats['elapsed_ms']:.1f} writes={stats['writes']} "
        f"category_q={stats['category_queries']} txn_q={stats['txn_queries']} "
        f"rule_q={stats['rule_queries']} skip_q={stats['skip_queries']}"
    )


@pytest.mark.django_db
def test_spending_targets_summary_metrics_report(auth_client, household):
    seed_spending_limits(household, n_targets=4)
    url = f"/api/spending-targets/summary/?anchor={ANCHOR}"
    stats = _profile(auth_client, url)
    _print("BEFORE/AFTER summary 4", stats, 4)
    assert stats["writes"] == 0
    assert len(stats["body"]["targets"]) == 4


@pytest.mark.django_db
def test_spending_targets_query_count_does_not_scale_with_targets():
    url = f"/api/spending-targets/summary/?anchor={ANCHOR}"

    def setup(n: int, username: str) -> APIClient:
        user = User.objects.create_user(username=username, password="testpass123")
        household = Household.objects.create(name=username)
        HouseholdMembership.objects.create(
            household=household, user=user, role=HouseholdMembership.Role.OWNER
        )
        seed_spending_limits(household, n_targets=n)
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    one = _profile(setup(1, "steff1"), url)
    four = _profile(setup(4, "steff4"), url)
    twenty = _profile(setup(20, "steff20"), url)
    _print("1-target summary", one, 1)
    _print("4-target summary", four, 4)
    _print("20-target summary", twenty, 20)
    assert twenty["queries"] - one["queries"] < 8
    assert four["queries"] - one["queries"] < 6
    assert twenty["writes"] == 0
    assert twenty["queries"] < 25
