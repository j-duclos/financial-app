"""Profile and regression tests for Automation / recurring-rule list GET.

BEFORE (measured 2026-08-15, prior implementation):
  2 rules (1 checking + 1 credit): queries=9 writes=0 (already in sync)
    extra promote scan + nested AccountSerializer payoff txn query
  scaling checking-only: 1=7, 25=31, 100=106  — ~1 query/rule (account.household)
  due promotion GET: writes=1, persisted amount 80.00
  frontend: rules + operational accounts + categories + households + profile = 5 requests

AFTER:
  2 rules: queries=3 writes=0 bytes=2535 txn_q=0 sched_q=1
  scaling: 1=3, 25=3, 100=3
  due schedule GET: writes=0, response amount 80.00, DB row unchanged
  frontend initial load: rules only = 1 request
"""
from __future__ import annotations

import json
import time
from datetime import timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule, RecurringRuleSchedule

User = get_user_model()
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


def _make_rule(household, account, category, *, name, amount="50.00", future_change=True):
    today = timezone.localdate()
    start = today - timedelta(days=90)
    rule = RecurringRule.objects.create(
        household=household,
        name=name,
        account=account,
        category=category,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal(amount),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=15,
        start_date=start,
        active=True,
    )
    RecurringRuleSchedule.objects.create(
        rule=rule,
        effective_from=start,
        account=account,
        category=category,
        direction=rule.direction,
        amount=rule.amount,
        currency="USD",
        frequency=rule.frequency,
        interval=1,
        day_of_month=15,
        start_date=start,
    )
    if future_change:
        RecurringRuleSchedule.objects.create(
            rule=rule,
            effective_from=today + timedelta(days=40),
            account=account,
            category=category,
            direction=rule.direction,
            amount=Decimal(amount) + Decimal("10.00"),
            currency="USD",
            frequency=rule.frequency,
            interval=1,
            day_of_month=15,
            start_date=start,
        )
    return rule


def _stale_due_rule(household, account, category, *, name="Raise due"):
    today = timezone.localdate()
    start = today - timedelta(days=90)
    rule = RecurringRule.objects.create(
        household=household,
        name=name,
        account=account,
        category=category,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("50.00"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=15,
        start_date=start,
        active=True,
    )
    RecurringRuleSchedule.objects.create(
        rule=rule,
        effective_from=start,
        account=account,
        category=category,
        direction=rule.direction,
        amount=Decimal("50.00"),
        currency="USD",
        frequency=rule.frequency,
        interval=1,
        day_of_month=15,
        start_date=start,
    )
    RecurringRuleSchedule.objects.create(
        rule=rule,
        effective_from=today - timedelta(days=1),
        account=account,
        category=category,
        direction=rule.direction,
        amount=Decimal("80.00"),
        currency="USD",
        frequency=rule.frequency,
        interval=1,
        day_of_month=15,
        start_date=start,
    )
    return rule


def _profile(auth_client: APIClient, url: str = "/api/rules/?page_size=200") -> dict:
    connection.queries_log.clear()
    t0 = time.perf_counter()
    with CaptureQueriesContext(connection) as ctx:
        res = auth_client.get(url)
    elapsed_ms = (time.perf_counter() - t0) * 1000
    assert res.status_code == 200, res.content[:500]
    body = res.json()
    writes = [q for q in ctx.captured_queries if _sql_verb(q["sql"]) in WRITE_SQL]
    return {
        "queries": len(ctx.captured_queries),
        "elapsed_ms": elapsed_ms,
        "writes": len(writes),
        "bytes": len(json.dumps(body)),
        "rule_queries": _count_table(ctx.captured_queries, "timeline_recurring_rule"),
        "schedule_queries": _count_table(ctx.captured_queries, "timeline_recurring_rule_schedule"),
        "account_queries": _count_table(ctx.captured_queries, "accounts_account"),
        "category_queries": _count_table(ctx.captured_queries, "categories_category"),
        "household_queries": _count_table(ctx.captured_queries, "core_household"),
        "txn_queries": _count_table(ctx.captured_queries, "transactions_transaction"),
        "count": body.get("count", len(body.get("results") or [])),
        "sql": [q["sql"][:240] for q in ctx.captured_queries],
        "body": body,
    }


@pytest.mark.django_db
def test_profile_rules_list(auth_client, household, user):
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Chase",
        currency="USD",
    )
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        name="Savor",
        currency="USD",
        credit_limit=Decimal("5000"),
        statement_balance=Decimal("200"),
        last_statement_date=timezone.localdate() - timedelta(days=10),
    )
    bills, _ = Category.objects.get_or_create(
        household=household,
        name="Streaming",
        category_type=Category.CategoryType.EXPENSE,
        defaults={"sort_order": 1},
    )
    _make_rule(household, checking, bills, name="Netflix", amount="15.00")
    _make_rule(household, card, bills, name="Card charge", amount="40.00")
    stats = _profile(auth_client)
    print("\nRULES LIST PROFILE AFTER")
    print(
        f"queries={stats['queries']} time_ms={stats['elapsed_ms']:.1f} bytes={stats['bytes']} "
        f"writes={stats['writes']} rule_q={stats['rule_queries']} sched_q={stats['schedule_queries']} "
        f"account_q={stats['account_queries']} category_q={stats['category_queries']} "
        f"household_q={stats['household_queries']} txn_q={stats['txn_queries']}"
    )
    for i, sql in enumerate(stats["sql"]):
        print(f"  Q{i}: {sql}")
    assert stats["writes"] == 0
    assert stats["txn_queries"] == 0
    assert stats["schedule_queries"] <= 1
    netflix = next(r for r in stats["body"]["results"] if r["name"] == "Netflix")
    assert netflix["scheduled_change"] is not None
    assert Decimal(netflix["scheduled_change"]["amount"]) == Decimal("25.00")


@pytest.mark.django_db
def test_rules_list_query_count_does_not_scale_with_rules(auth_client, household, user):
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Chase",
        currency="USD",
    )
    bills, _ = Category.objects.get_or_create(
        household=household,
        name="Streaming",
        category_type=Category.CategoryType.EXPENSE,
        defaults={"sort_order": 1},
    )
    print("\nRULES LIST SCALING AFTER")
    counts = {}
    for n in (1, 25, 100):
        have = RecurringRule.objects.filter(household=household).count()
        for i in range(have, n):
            _make_rule(household, checking, bills, name=f"Rule {i:03d}", amount="20.00")
        stats = _profile(auth_client)
        counts[n] = stats["queries"]
        print(
            f"n={n}: queries={stats['queries']} time_ms={stats['elapsed_ms']:.1f} "
            f"bytes={stats['bytes']} writes={stats['writes']} sched_q={stats['schedule_queries']}"
        )
        assert stats["writes"] == 0
        assert stats["schedule_queries"] <= 1
        assert stats["account_queries"] <= 2
        assert stats["category_queries"] <= 2
        assert stats["count"] == n
    assert counts[25] <= counts[1] + 2
    assert counts[100] <= counts[1] + 2


@pytest.mark.django_db
def test_rules_list_get_is_read_only_and_shows_effective_amount(auth_client, household, user):
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Chase",
        currency="USD",
    )
    bills, _ = Category.objects.get_or_create(
        household=household,
        name="Streaming",
        category_type=Category.CategoryType.EXPENSE,
        defaults={"sort_order": 1},
    )
    rule = _stale_due_rule(household, checking, bills)
    stats = _profile(auth_client)
    print(
        f"\nDUE SCHEDULE GET writes={stats['writes']} queries={stats['queries']} "
        f"amount_in_response={stats['body']['results'][0]['amount']}"
    )
    assert stats["writes"] == 0
    assert Decimal(stats["body"]["results"][0]["amount"]) == Decimal("80.00")
    rule.refresh_from_db()
    assert rule.amount == Decimal("50.00")


@pytest.mark.django_db
def test_user_a_rules_get_does_not_mutate_user_b(api_client, user, household):
    checking_a = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="A checking",
        currency="USD",
    )
    bills_a, _ = Category.objects.get_or_create(
        household=household,
        name="Streaming",
        category_type=Category.CategoryType.EXPENSE,
        defaults={"sort_order": 1},
    )
    rule_a = _stale_due_rule(household, checking_a, bills_a, name="A raise")

    user_b = User.objects.create_user(username="rules_user_b", password="testpass123")
    household_b = Household.objects.create(name="House B")
    HouseholdMembership.objects.create(
        household=household_b, user=user_b, role=HouseholdMembership.Role.OWNER
    )
    checking_b = Account.objects.create(
        household=household_b,
        account_type=Account.AccountType.CHECKING,
        name="B checking",
        currency="USD",
    )
    bills_b, _ = Category.objects.get_or_create(
        household=household_b,
        name="Streaming",
        category_type=Category.CategoryType.EXPENSE,
        defaults={"sort_order": 1},
    )
    rule_b = _stale_due_rule(household_b, checking_b, bills_b, name="B raise")

    api_client.force_authenticate(user=user)
    stats = _profile(api_client)
    assert stats["writes"] == 0
    names = {row["name"] for row in stats["body"]["results"]}
    assert "A raise" in names
    assert "B raise" not in names

    rule_a.refresh_from_db()
    rule_b.refresh_from_db()
    assert rule_a.amount == Decimal("50.00")
    assert rule_b.amount == Decimal("50.00")
    assert rule_b.updated_at == RecurringRule.objects.get(pk=rule_b.pk).updated_at


@pytest.mark.django_db
def test_retrieve_get_is_read_only_and_shows_effective_amount(auth_client, household, user):
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Chase",
        currency="USD",
    )
    bills, _ = Category.objects.get_or_create(
        household=household,
        name="Streaming",
        category_type=Category.CategoryType.EXPENSE,
        defaults={"sort_order": 1},
    )
    rule = _stale_due_rule(household, checking, bills)
    stats = _profile(auth_client, f"/api/rules/{rule.id}/")
    assert stats["writes"] == 0
    assert Decimal(stats["body"]["amount"]) == Decimal("80.00")
    rule.refresh_from_db()
    assert rule.amount == Decimal("50.00")


@pytest.mark.django_db
def test_update_promotes_only_requesting_user_due_schedules(api_client, user, household):
    checking_a = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="A checking",
        currency="USD",
    )
    bills_a, _ = Category.objects.get_or_create(
        household=household,
        name="Streaming",
        category_type=Category.CategoryType.EXPENSE,
        defaults={"sort_order": 1},
    )
    rule_a = _stale_due_rule(household, checking_a, bills_a, name="A raise")

    user_b = User.objects.create_user(username="rules_user_b_patch", password="testpass123")
    household_b = Household.objects.create(name="House B patch")
    HouseholdMembership.objects.create(
        household=household_b, user=user_b, role=HouseholdMembership.Role.OWNER
    )
    checking_b = Account.objects.create(
        household=household_b,
        account_type=Account.AccountType.CHECKING,
        name="B checking",
        currency="USD",
    )
    bills_b, _ = Category.objects.get_or_create(
        household=household_b,
        name="Streaming",
        category_type=Category.CategoryType.EXPENSE,
        defaults={"sort_order": 1},
    )
    rule_b = _stale_due_rule(household_b, checking_b, bills_b, name="B raise")

    api_client.force_authenticate(user=user)
    res = api_client.patch(f"/api/rules/{rule_a.id}/", {"notes": "keep cadence"}, format="json")
    assert res.status_code == 200, res.content
    rule_a.refresh_from_db()
    rule_b.refresh_from_db()
    assert rule_a.amount == Decimal("80.00")
    assert rule_b.amount == Decimal("50.00")
