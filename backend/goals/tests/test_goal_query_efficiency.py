# BEFORE (captured 2026-08-15):
#   1 goal:  12 queries, 7.4ms, contrib_q=3 alloc_q=4 rule_q=5 acct_q=2 txn_q=1
#   4 goals: 39 queries list / 27 summary, contrib_q=12/1 alloc_q=16
#   10 goals: 99 queries, 44ms, contrib_q=34 alloc_q=40 rule_q=43
#   20 goals: 199 queries, 85ms, contrib_q=72 alloc_q=80 rule_q=85
# AFTER:
#   1 goal:  7 queries, ~6ms, contrib_q=1 alloc_q=2 rule_q=3
#   4 goals: 8 queries list / 7 summary, ~6–7ms
#   10 goals: 8 queries, ~9ms
#   20 goals: 8 queries, ~12ms
#   GET writes: 0

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
from core.models import Household, HouseholdMembership
from goals.models import GoalBucket, GoalContribution, RuleAllocation
from timeline.models import RecurringRule
from transactions.models import Transaction

User = get_user_model()
TODAY = date.today()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="goaleff", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Goals Efficiency HH")
    HouseholdMembership.objects.create(
        household=h, user=user, role=HouseholdMembership.Role.OWNER
    )
    return h


@pytest.fixture
def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


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
        "contribution_queries": _count_table(ctx.captured_queries, "goals_goal_contribution"),
        "allocation_queries": _count_table(ctx.captured_queries, "goals_rule_allocation"),
        "rule_queries": _count_table(ctx.captured_queries, "timeline_recurring_rule"),
        "account_queries": _count_table(ctx.captured_queries, "accounts_account"),
        "txn_queries": _count_table(ctx.captured_queries, "transactions_transaction"),
        "body": res.json(),
    }


def seed_goals(household, user, *, n_goals: int) -> list[GoalBucket]:
    buckets: list[GoalBucket] = []
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Paycheck Checking",
        starting_balance=Decimal("8000"),
        currency="USD",
    )
    income_rule = RecurringRule.objects.create(
        household=household,
        name="Paycheck",
        account=checking,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("2000"),
        frequency=RecurringRule.Frequency.BIWEEKLY,
        interval=1,
        start_date=TODAY - timedelta(days=90),
        active=True,
    )
    for i in range(n_goals):
        if i == n_goals - 1 and n_goals >= 2:
            acc = Account.objects.create(
                household=household,
                account_type=Account.AccountType.CREDIT,
                role=Account.AccountRole.CREDIT_CARD,
                name=f"Card {i}",
                starting_balance=Decimal("1200"),
                currency="USD",
            )
            bucket = GoalBucket.objects.create(
                household=household,
                created_by=user,
                name=f"Pay off card {i}",
                type=GoalBucket.BucketType.DEBT_PAYOFF,
                target_amount=Decimal("1200"),
                linked_account=acc,
                monthly_target=Decimal("100"),
                priority=GoalBucket.Priority.MEDIUM,
                status=GoalBucket.Status.ACTIVE,
                start_date=TODAY - timedelta(days=60),
                target_date=TODAY + timedelta(days=365),
            )
        else:
            acc = Account.objects.create(
                household=household,
                account_type=Account.AccountType.SAVINGS,
                role=Account.AccountRole.EMERGENCY_FUND,
                name=f"Savings {i}",
                starting_balance=Decimal("2500") + Decimal(i * 50),
                currency="USD",
            )
            bucket = GoalBucket.objects.create(
                household=household,
                created_by=user,
                name=f"Goal {i}",
                type=GoalBucket.BucketType.CUSTOM,
                target_amount=Decimal("10000"),
                linked_account=acc,
                monthly_target=Decimal("0") if i % 3 == 0 else Decimal("200"),
                auto_fund_enabled=(i % 4 == 0),
                priority=GoalBucket.Priority.HIGH if i < 3 else GoalBucket.Priority.MEDIUM,
                status=GoalBucket.Status.ACTIVE,
                start_date=TODAY - timedelta(days=120),
                target_date=TODAY + timedelta(days=400),
            )
            Transaction.objects.create(
                account=acc,
                date=TODAY - timedelta(days=10),
                payee="Deposit",
                amount=Decimal("300"),
                source=Transaction.Source.ACTUAL,
                status=Transaction.Status.CLEARED,
            )
            if i % 2 == 0:
                RuleAllocation.objects.create(
                    rule=income_rule,
                    bucket=bucket,
                    fixed_amount=Decimal("150"),
                    active=True,
                )
            if i % 3 == 0:
                txn = Transaction.objects.create(
                    account=acc,
                    date=TODAY - timedelta(days=40),
                    payee="Manual save",
                    amount=Decimal("400"),
                    source=Transaction.Source.ACTUAL,
                    status=Transaction.Status.CLEARED,
                )
                GoalContribution.objects.create(
                    bucket=bucket,
                    transaction=txn,
                    account=acc,
                    amount=Decimal("400"),
                    date=txn.date,
                    source=GoalContribution.Source.MANUAL,
                )
        buckets.append(bucket)
    return buckets


def test_goals_list_and_summary_metrics_report(auth_client, household, user, capsys):
    seed_goals(household, user, n_goals=4)
    list_stats = _profile(auth_client, "/api/buckets/?page_size=100")
    summary_stats = _profile(auth_client, f"/api/buckets/summary/?household={household.id}")
    print(
        f"BEFORE/AFTER list 4 goals={len(list_stats['body'].get('results', []))} "
        f"queries={list_stats['queries']} time_ms={list_stats['elapsed_ms']:.1f} "
        f"writes={list_stats['writes']} contrib_q={list_stats['contribution_queries']} "
        f"alloc_q={list_stats['allocation_queries']} rule_q={list_stats['rule_queries']} "
        f"acct_q={list_stats['account_queries']} txn_q={list_stats['txn_queries']}"
    )
    print(
        f"BEFORE/AFTER summary 4 queries={summary_stats['queries']} "
        f"time_ms={summary_stats['elapsed_ms']:.1f} writes={summary_stats['writes']} "
        f"contrib_q={summary_stats['contribution_queries']} "
        f"alloc_q={summary_stats['allocation_queries']}"
    )
    assert list_stats["writes"] == 0
    assert summary_stats["writes"] == 0
    assert list_stats["queries"] <= 12
    assert summary_stats["queries"] <= 12
    assert list_stats["contribution_queries"] <= 2
    assert summary_stats["contribution_queries"] <= 2

    overview = _profile(auth_client, f"/api/buckets/overview/?household={household.id}")
    print(
        f"AFTER overview 4 queries={overview['queries']} time_ms={overview['elapsed_ms']:.1f} "
        f"writes={overview['writes']}"
    )
    assert overview["writes"] == 0
    assert overview["queries"] <= 12
    assert len(overview["body"].get("goals", [])) == 4
    assert "total_saved" in overview["body"].get("summary", {})


@pytest.mark.parametrize("n_goals", [1, 10, 20])
def test_goals_query_count_does_not_scale_with_goals(auth_client, household, user, n_goals, capsys):
    seed_goals(household, user, n_goals=n_goals)
    stats = _profile(auth_client, "/api/buckets/?page_size=100")
    print(
        f"{n_goals}-goal list targets={len(stats['body'].get('results', []))} "
        f"queries={stats['queries']} time_ms={stats['elapsed_ms']:.1f} "
        f"writes={stats['writes']} contrib_q={stats['contribution_queries']} "
        f"alloc_q={stats['allocation_queries']} rule_q={stats['rule_queries']} "
        f"acct_q={stats['account_queries']} txn_q={stats['txn_queries']}"
    )
    assert stats["writes"] == 0
    assert len(stats["body"].get("results", [])) == n_goals
    assert stats["queries"] <= 12
    assert stats["contribution_queries"] <= 2
    assert stats["allocation_queries"] <= 3


def test_per_goal_calculation_issues_no_sql(household, user):
    from goals.bucket_services import (
        build_goal_calculation_context,
        calculate_bucket_progress,
        enrich_bucket,
    )

    seed_goals(household, user, n_goals=4)
    buckets = list(
        GoalBucket.objects.filter(household=household)
        .select_related("linked_account")
        .order_by("id")
    )
    ctx = build_goal_calculation_context(buckets, today=TODAY, as_of=TODAY, user=user)
    connection.queries_log.clear()
    with CaptureQueriesContext(connection) as cap:
        for bucket in buckets:
            progress = calculate_bucket_progress(
                bucket, today=TODAY, user=user, context=ctx
            )
            enrich_bucket(bucket, progress, today=TODAY, context=ctx)
    assert cap.captured_queries == []


def test_get_does_not_write_allocated_amount(auth_client, household, user):
    buckets = seed_goals(household, user, n_goals=3)
    GoalBucket.objects.filter(pk=buckets[0].pk).update(allocated_amount=Decimal("1.00"))
    stats = _profile(auth_client, "/api/buckets/?page_size=100")
    assert stats["writes"] == 0
    buckets[0].refresh_from_db()
    assert buckets[0].allocated_amount == Decimal("1.00")
