"""Recommendation / Action Center SQL and CPU efficiency tests."""
from __future__ import annotations

import time
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import Account
from accounts.relationship_models import AccountRelationship
from categories.models import Category
from common.services.profiler import get_build_timeline_count, reset_build_timeline_count
from core.models import Household, HouseholdMembership
from goals.models import GoalBucket, GoalContribution
from timeline.models import RecurringRule
from transactions.models import Transaction
from transactions.services.posting import post_transaction

User = get_user_model()
AS_OF = date(2025, 6, 1)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="receff", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Rec Efficiency HH")
    HouseholdMembership.objects.create(
        household=h, user=user, role=HouseholdMembership.Role.OWNER
    )
    return h


@pytest.fixture
def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _make_checking(household, name: str, starting: str = "400") -> Account:
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name=name,
        starting_balance=Decimal(starting),
        minimum_buffer=Decimal("200"),
        currency="USD",
    )


def _make_card(household, name: str, owed: str = "4000") -> Account:
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name=name,
        credit_limit=Decimal("5000"),
        starting_balance=-Decimal(owed),
        current_balance=Decimal(owed),
        apr=Decimal("24.99"),
        payment_due_day=10,
        next_payment_due_date=AS_OF + timedelta(days=12),
        currency="USD",
    )


def _make_savings(household, name: str = "Savings") -> Account:
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        name=name,
        starting_balance=Decimal("8000"),
        minimum_buffer=Decimal("500"),
        currency="USD",
    )


def _seed_unmatched_import(account: Account) -> None:
    Transaction.objects.create(
        account=account,
        date=AS_OF - timedelta(days=2),
        payee="Plaid import",
        amount=Decimal("-12.34"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.PLAID,
        import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
    )


def _seed_goal(user, household, savings: Account, name: str) -> GoalBucket:
    bucket = GoalBucket.objects.create(
        household=household,
        name=name,
        type=GoalBucket.BucketType.CUSTOM,
        target_amount=Decimal("25000"),
        linked_account=savings,
        monthly_target=Decimal("500"),
        priority=GoalBucket.Priority.MEDIUM,
        status=GoalBucket.Status.ACTIVE,
        forecast_enabled=True,
        target_date=AS_OF + timedelta(days=365),
        include_in_safe_to_spend=True,
    )
    txn = post_transaction(
        user, savings.id, AS_OF - timedelta(days=10), f"{name} fund", Decimal("200")
    )
    GoalContribution.objects.update_or_create(
        transaction_id=txn.pk,
        defaults={
            "bucket": bucket,
            "account_id": savings.id,
            "amount": Decimal("200"),
            "date": AS_OF - timedelta(days=10),
            "source": GoalContribution.Source.MANUAL,
        },
    )
    return bucket


def _seed_bill(
    household,
    account: Account,
    category: Category,
    name: str,
    *,
    amount: str = "150",
    day: int = 15,
    flex: int = 5,
) -> RecurringRule:
    return RecurringRule.objects.create(
        household=household,
        name=name,
        account=account,
        category=category,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal(amount),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=day,
        start_date=date(2025, 1, 1),
        active=True,
        is_bill=True,
        payment_flexibility_days=flex,
    )


def seed_recommendation_fixture(
    user,
    household,
    *,
    n_checking: int,
    n_cards: int,
    n_goals: int,
    n_bills: int,
) -> dict[str, list]:
    category = Category.objects.create(
        household=household,
        name="Utilities",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )
    checkings = [
        _make_checking(household, f"Checking {i}", starting="350")
        for i in range(n_checking)
    ]
    cards = [_make_card(household, f"Card {i}") for i in range(n_cards)]
    savings = _make_savings(household)
    for acc in checkings + cards:
        _seed_unmatched_import(acc)
        post_transaction(user, acc.id, AS_OF, f"{acc.name} txn", Decimal("-25"))
    if cards and checkings:
        AccountRelationship.objects.create(
            household=household,
            source_account=checkings[0],
            destination_account=cards[0],
            relationship_type=AccountRelationship.RelationshipType.CREDIT_CARD_PAYMENT,
            is_active=True,
        )
    bills = []
    if checkings:
        for i in range(n_bills):
            bills.append(
                _seed_bill(
                    household,
                    checkings[i % len(checkings)],
                    category,
                    f"Flexible Bill {i}",
                    amount="180",
                    day=5 + (i % 20),
                    flex=7,
                )
            )
    goals = [_seed_goal(user, household, savings, f"Goal {i}") for i in range(n_goals)]
    return {
        "checkings": checkings,
        "cards": cards,
        "goals": goals,
        "bills": bills,
        "savings": [savings],
    }


def _sql_count(queries, needle: str) -> int:
    token = needle.lower()
    return sum(1 for q in queries if token in q["sql"].lower())


def test_profile_recommendations_query_counts(user, household, monkeypatch, capsys):
    """Print cold-request SQL / timeline / forecast / health counts for Action Center."""
    seed_recommendation_fixture(
        user, household, n_checking=5, n_cards=5, n_goals=5, n_bills=8
    )

    import accounts.services.account_health as ah
    import accounts.services.available_to_spend as ats
    import recommendations.services.engine as rec_engine

    counters = {"forecast_account": 0, "forecast_batch": 0, "health_batch": 0}
    orig_account = ats.calculate_account_forecast_summary
    orig_batch = ats._calculate_forecast_summaries_for_accounts
    orig_health = rec_engine.calculate_account_health_for_accounts

    def wrapped_account(*args, **kwargs):
        counters["forecast_account"] += 1
        return orig_account(*args, **kwargs)

    def wrapped_batch(*args, **kwargs):
        counters["forecast_batch"] += 1
        return orig_batch(*args, **kwargs)

    def wrapped_health(*args, **kwargs):
        counters["health_batch"] += 1
        return orig_health(*args, **kwargs)

    monkeypatch.setattr(ats, "calculate_account_forecast_summary", wrapped_account)
    monkeypatch.setattr(ats, "_calculate_forecast_summaries_for_accounts", wrapped_batch)
    monkeypatch.setattr(rec_engine, "calculate_account_health_for_accounts", wrapped_health)
    monkeypatch.setattr(ah, "calculate_account_health_for_accounts", wrapped_health)

    cache.clear()
    reset_build_timeline_count()
    start = time.perf_counter()
    with CaptureQueriesContext(connection) as ctx:
        rec_ctx = rec_engine.build_recommendation_context(user, days=30, as_of_date=AS_OF)
        recs = rec_engine.build_recommendations(rec_ctx)
    elapsed_ms = (time.perf_counter() - start) * 1000

    print(
        "\nRECOMMENDATIONS_QUERY_PROFILE "
        f"sql={len(ctx.captured_queries)} "
        f"elapsed_ms={elapsed_ms:.0f} "
        f"timeline_builds={get_build_timeline_count()} "
        f"forecast_account_calls={counters['forecast_account']} "
        f"forecast_batches={counters['forecast_batch']} "
        f"health_batches={counters['health_batch']} "
        f"recommendations={len(recs)}"
    )
    rec_sql = len(ctx.captured_queries)
    rec_timeline = get_build_timeline_count()
    rec_forecast_account = counters["forecast_account"]
    rec_forecast_batch = counters["forecast_batch"]
    rec_health = counters["health_batch"]

    cache.clear()
    reset_build_timeline_count()
    counters["forecast_account"] = 0
    counters["forecast_batch"] = 0
    counters["health_batch"] = 0
    dash_start = time.perf_counter()
    with CaptureQueriesContext(connection) as dash_ctx:
        from insights.services.dashboard_summary import build_dashboard_summary

        build_dashboard_summary(user, days=30, as_of_date=AS_OF)
    dash_ms = (time.perf_counter() - dash_start) * 1000
    print(
        "\nACTION_CENTER_DASHBOARD_SUMMARY_PROFILE "
        f"sql={len(dash_ctx.captured_queries)} "
        f"elapsed_ms={dash_ms:.0f} "
        f"timeline_builds={get_build_timeline_count()} "
        f"forecast_account_calls={counters['forecast_account']} "
        f"forecast_batches={counters['forecast_batch']} "
        f"health_batches={counters['health_batch']}"
    )
    assert rec_sql > 0
    assert isinstance(recs, list)
    assert rec_timeline == 1
    assert rec_forecast_account == 0
    assert rec_forecast_batch == 1
    assert rec_health == 1


def _capture_recommendation_queries(user):
    cache.clear()
    from recommendations.services.engine import (
        build_recommendation_context,
        build_recommendations,
    )

    with CaptureQueriesContext(connection) as ctx:
        rec_ctx = build_recommendation_context(user, days=30, as_of_date=AS_OF)
        build_recommendations(rec_ctx)
    return ctx.captured_queries, rec_ctx


def test_query_count_does_not_scale_linearly_with_accounts_cards_bills_goals(user, household):
    seed_recommendation_fixture(
        user, household, n_checking=1, n_cards=1, n_goals=1, n_bills=1
    )
    small_queries, _ = _capture_recommendation_queries(user)

    household2 = Household.objects.create(name="Rec Efficiency HH 2")
    HouseholdMembership.objects.create(
        household=household2, user=user, role=HouseholdMembership.Role.OWNER
    )
    seed_recommendation_fixture(
        user, household2, n_checking=5, n_cards=5, n_goals=5, n_bills=8
    )
    large_queries, _ = _capture_recommendation_queries(user)

    small_unmatched = _sql_count(small_queries, "UNMATCHED")
    large_unmatched = _sql_count(large_queries, "UNMATCHED")
    small_rel = _sql_count(small_queries, "accounts_account_relationship")
    large_rel = _sql_count(large_queries, "accounts_account_relationship")
    small_hh = _sql_count(small_queries, "core_householdmembership")
    large_hh = _sql_count(large_queries, "core_householdmembership")
    small_contrib = _sql_count(small_queries, "goals_goal_contribution")
    large_contrib = _sql_count(large_queries, "goals_goal_contribution")

    assert large_unmatched <= small_unmatched + 1
    assert large_rel <= small_rel + 1
    assert large_hh <= small_hh + 2
    assert large_contrib <= small_contrib + 2
    assert large_unmatched <= 3
    assert large_rel <= 3
    assert len(large_queries) < len(small_queries) * 4


def test_spending_targets_summary_calculated_once(user, household, monkeypatch):
    seed_recommendation_fixture(
        user, household, n_checking=1, n_cards=1, n_goals=0, n_bills=0
    )
    import budgets.services.spending_targets as st

    calls = {"n": 0}
    orig = st.spending_targets_summary

    def wrapped(*args, **kwargs):
        calls["n"] += 1
        return orig(*args, **kwargs)

    monkeypatch.setattr(st, "spending_targets_summary", wrapped)
    cache.clear()
    from recommendations.services.engine import (
        build_recommendation_context,
        build_recommendations,
    )

    ctx = build_recommendation_context(user, days=30, as_of_date=AS_OF)
    build_recommendations(ctx)
    assert calls["n"] == 1


def test_detectors_issue_no_sql_after_context_is_built(user, household):
    seed_recommendation_fixture(
        user, household, n_checking=3, n_cards=3, n_goals=2, n_bills=4
    )
    cache.clear()
    from recommendations.services.detectors import run_all_detectors
    from recommendations.services.engine import (
        build_recommendation_context,
        build_recommendations,
    )

    ctx = build_recommendation_context(user, days=30, as_of_date=AS_OF)
    with CaptureQueriesContext(connection) as detector_ctx:
        run_all_detectors(ctx)
    with CaptureQueriesContext(connection) as recs_ctx:
        build_recommendations(ctx)
    assert detector_ctx.captured_queries == []
    assert recs_ctx.captured_queries == []


def test_recommendations_get_does_not_persist_credit_or_goal_sync(user, household):
    seeded = seed_recommendation_fixture(
        user, household, n_checking=1, n_cards=1, n_goals=1, n_bills=0
    )
    card = seeded["cards"][0]
    bucket = seeded["goals"][0]
    Account.objects.filter(pk=card.pk).update(current_balance=Decimal("9999.00"))
    GoalBucket.objects.filter(pk=bucket.pk).update(allocated_amount=Decimal("1.00"))

    cache.clear()
    from recommendations.services.engine import (
        build_recommendation_context,
        build_recommendations,
    )

    build_recommendations(build_recommendation_context(user, days=30, as_of_date=AS_OF))
    card.refresh_from_db()
    bucket.refresh_from_db()
    assert card.current_balance == Decimal("9999.00")
    assert bucket.allocated_amount == Decimal("1.00")


def test_recommendations_reuse_dashboard_shared_context_when_available(user, household):
    seed_recommendation_fixture(
        user, household, n_checking=2, n_cards=2, n_goals=1, n_bills=2
    )
    cache.clear()
    reset_build_timeline_count()
    from insights.services.dashboard_summary import build_dashboard_summary_fast
    from recommendations.services.engine import build_recommendation_context

    build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    timeline_after_dashboard = get_build_timeline_count()
    assert timeline_after_dashboard >= 1

    rec_ctx = build_recommendation_context(user, days=30, as_of_date=AS_OF)
    assert get_build_timeline_count() == timeline_after_dashboard
    assert rec_ctx.timeline_rows
    assert rec_ctx.forecasts
    assert rec_ctx.health_by_id


def test_recommendations_work_without_dashboard_cache(user, household, auth_client):
    seed_recommendation_fixture(
        user, household, n_checking=1, n_cards=1, n_goals=1, n_bills=1
    )
    cache.clear()
    response = auth_client.get("/api/recommendations/?days=30")
    assert response.status_code == 200
    payload = response.json()
    assert payload["days"] == 30
    assert "recommendations" in payload


def test_bill_delay_indexes_preserve_shift_and_ignore_other_accounts(checking_account, household):
    from accounts.services.available_to_spend import RISK_STATUS_CRITICAL
    from recommendations.services.context import RecommendationContext, index_timeline_rows
    from recommendations.services.detectors import detect_bill_delay_opportunities

    category = Category.objects.create(
        household=household,
        name="Bill Delay Streaming",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=2,
    )
    rule = RecurringRule.objects.create(
        household=household,
        name="Hulu",
        account=checking_account,
        category=category,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("200"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=6,
        start_date=date(2025, 1, 1),
        active=True,
        is_bill=True,
        payment_flexibility_days=7,
    )
    other = _make_checking(household, "Other Checking")
    risk_date = AS_OF + timedelta(days=5)
    timeline_rows = [
        {
            "account_id": checking_account.id,
            "date": risk_date,
            "amount": Decimal("-200"),
            "rule_id": rule.id,
        },
        {
            "account_id": checking_account.id,
            "date": risk_date + timedelta(days=3),
            "amount": Decimal("300"),
        },
        {
            "account_id": other.id,
            "date": risk_date + timedelta(days=1),
            "amount": Decimal("5000"),
        },
    ]
    for extra in range(40):
        timeline_rows.append(
            {
                "account_id": other.id,
                "date": AS_OF + timedelta(days=extra + 1),
                "amount": Decimal("-10"),
            }
        )
    by_account, inflows = index_timeline_rows(timeline_rows)
    ctx = RecommendationContext(
        user=None,
        today=AS_OF,
        days=30,
        accounts=[checking_account, other],
        accounts_by_id={checking_account.id: checking_account, other.id: other},
        forecasts={
            checking_account.id: {
                "risk_status": RISK_STATUS_CRITICAL,
                "risk_date": risk_date.isoformat(),
            }
        },
        st_aggregate={},
        timeline_rows=timeline_rows,
        health_by_id={},
        rules_by_id={rule.id: rule},
        signed_balances={checking_account.id: Decimal("50"), other.id: Decimal("1000")},
        timeline_by_account=by_account,
        inflows_by_account_date=inflows,
    )
    detections = detect_bill_delay_opportunities(ctx)
    assert len(detections) == 1
    assert detections[0].days_shift == 3
    assert detections[0].target_date == risk_date
    assert detections[0].amount == Decimal("200")


@pytest.fixture
def checking_account(household):
    return _make_checking(household, "Main")
