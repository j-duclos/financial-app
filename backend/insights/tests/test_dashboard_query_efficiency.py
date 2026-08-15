"""Dashboard SQL efficiency: N+1 bounds and before/after query profiling."""
from __future__ import annotations

import time
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext

from accounts.models import Account
from accounts.relationship_models import AccountRelationship
from core.models import Household, HouseholdMembership
from goals.models import GoalBucket, GoalContribution
from insights.services.dashboard_summary import (
    build_dashboard_summary_details,
    build_dashboard_summary_fast,
)
from transactions.models import Transaction
from transactions.services.posting import post_transaction

User = get_user_model()
AS_OF = date(2025, 5, 1)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="dasheff", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Dash Efficiency HH")
    HouseholdMembership.objects.create(
        household=h, user=user, role=HouseholdMembership.Role.OWNER
    )
    return h


def _make_checking(household, name: str, starting: str = "1000") -> Account:
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name=name,
        starting_balance=Decimal(starting),
        minimum_buffer=Decimal("100"),
        currency="USD",
    )


def _make_card(household, name: str, owed: str = "400") -> Account:
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name=name,
        credit_limit=Decimal("5000"),
        starting_balance=-Decimal(owed),
        current_balance=Decimal(owed),
        apr=Decimal("19.99"),
        payment_due_day=10,
        next_payment_due_date=AS_OF + timedelta(days=12),
        currency="USD",
    )


def _make_savings(household, name: str) -> Account:
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        name=name,
        starting_balance=Decimal("8000"),
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
        target_amount=Decimal("5000"),
        linked_account=savings,
        monthly_target=Decimal("0"),
        priority=GoalBucket.Priority.MEDIUM,
        status=GoalBucket.Status.ACTIVE,
        forecast_enabled=True,
        target_date=AS_OF + timedelta(days=180),
        include_in_safe_to_spend=True,
    )
    txn = post_transaction(user, savings.id, AS_OF - timedelta(days=10), f"{name} fund", Decimal("200"))
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
    txn2 = post_transaction(
        user, savings.id, AS_OF - timedelta(days=40), f"{name} older", Decimal("150")
    )
    GoalContribution.objects.update_or_create(
        transaction_id=txn2.pk,
        defaults={
            "bucket": bucket,
            "account_id": savings.id,
            "amount": Decimal("150"),
            "date": AS_OF - timedelta(days=40),
            "source": GoalContribution.Source.MANUAL,
        },
    )
    return bucket


def _seed_dashboard(
    user,
    household,
    *,
    n_checking: int,
    n_cards: int,
    n_goals: int,
) -> dict[str, list]:
    checkings = [_make_checking(household, f"Checking {i}") for i in range(n_checking)]
    cards = [_make_card(household, f"Card {i}") for i in range(n_cards)]
    savings = _make_savings(household, "Goals Savings")
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
    goals = [_seed_goal(user, household, savings, f"Goal {i}") for i in range(n_goals)]
    return {"checkings": checkings, "cards": cards, "goals": goals, "savings": [savings]}


def _count_queries(fn) -> tuple[int, float, object]:
    cache.clear()
    start = time.perf_counter()
    with CaptureQueriesContext(connection) as ctx:
        result = fn()
    elapsed_ms = (time.perf_counter() - start) * 1000
    return len(ctx.captured_queries), elapsed_ms, result


def test_profile_dashboard_query_counts(user, household, capsys):
    """Print baseline/regression query counts for a multi-account dashboard."""
    _seed_dashboard(user, household, n_checking=5, n_cards=5, n_goals=5)

    cache.clear()
    fast_q, fast_ms, _ = _count_queries(
        lambda: build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    )

    cache.clear()
    details_cold_q, details_cold_ms, _ = _count_queries(
        lambda: build_dashboard_summary_details(user, days=30, as_of_date=AS_OF)
    )

    cache.clear()
    start = time.perf_counter()
    with CaptureQueriesContext(connection) as combined:
        build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
        build_dashboard_summary_details(user, days=30, as_of_date=AS_OF)
    combined_ms = (time.perf_counter() - start) * 1000
    combined_q = len(combined.captured_queries)

    print(
        "\nDASHBOARD_QUERY_PROFILE "
        f"summary-fast={fast_q} ({fast_ms:.0f}ms) "
        f"details-cold={details_cold_q} ({details_cold_ms:.0f}ms) "
        f"combined-cold={combined_q} ({combined_ms:.0f}ms)"
    )
    assert fast_q > 0
    assert details_cold_q > 0
    assert combined_q > 0
    # Combined with shared context should not rebuild the expensive core from scratch.
    assert combined_q < fast_q + details_cold_q


def _sql_count(queries, needle: str) -> int:
    token = needle.lower()
    return sum(1 for q in queries if token in q["sql"].lower())


def _capture_fast(user):
    cache.clear()
    with CaptureQueriesContext(connection) as ctx:
        payload = build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    return ctx.captured_queries, payload


def test_unmatched_import_and_relationship_queries_do_not_scale_with_accounts(user, household):
    _seed_dashboard(user, household, n_checking=1, n_cards=1, n_goals=1)
    small_queries, _ = _capture_fast(user)

    household2 = Household.objects.create(name="Dash Efficiency HH 2")
    HouseholdMembership.objects.create(
        household=household2, user=user, role=HouseholdMembership.Role.OWNER
    )
    _seed_dashboard(user, household2, n_checking=5, n_cards=5, n_goals=1)
    large_queries, _ = _capture_fast(user)

    small_unmatched = _sql_count(small_queries, "UNMATCHED")
    large_unmatched = _sql_count(large_queries, "UNMATCHED")
    small_rel = _sql_count(small_queries, "accounts_account_relationship")
    large_rel = _sql_count(large_queries, "accounts_account_relationship")

    assert large_unmatched <= small_unmatched + 1
    assert large_rel <= small_rel + 1
    assert large_unmatched <= 3
    assert large_rel <= 3


def test_goal_contribution_queries_do_not_scale_with_goal_count(user, household):
    _seed_dashboard(user, household, n_checking=1, n_cards=0, n_goals=1)
    cache.clear()
    build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    with CaptureQueriesContext(connection) as small_ctx:
        build_dashboard_summary_details(user, days=30, as_of_date=AS_OF)
    small = _sql_count(small_ctx.captured_queries, "goals_goal_contribution")

    household2 = Household.objects.create(name="Dash Efficiency Goals HH")
    HouseholdMembership.objects.create(
        household=household2, user=user, role=HouseholdMembership.Role.OWNER
    )
    _seed_dashboard(user, household2, n_checking=1, n_cards=0, n_goals=6)
    cache.clear()
    build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    with CaptureQueriesContext(connection) as large_ctx:
        build_dashboard_summary_details(user, days=30, as_of_date=AS_OF)
    large = _sql_count(large_ctx.captured_queries, "goals_goal_contribution")

    assert large <= small + 2
    assert large <= 6


def test_account_health_loop_issues_no_sql_when_context_supplied(user, household):
    from accounts.services.account_health import (
        build_account_health_context,
        calculate_account_health_for_accounts,
    )
    from accounts.services.available_to_spend import calculate_forecast_summaries_for_accounts
    from accounts.services.balances import bulk_signed_ledger_balances

    seeded = _seed_dashboard(user, household, n_checking=3, n_cards=3, n_goals=0)
    accounts = seeded["checkings"] + seeded["cards"]
    balances = bulk_signed_ledger_balances(accounts, AS_OF)
    context = build_account_health_context(
        accounts, today=AS_OF, signed_balances=balances
    )
    forecasts = calculate_forecast_summaries_for_accounts(
        user, accounts, as_of_date=AS_OF, days=30, timeline_rows=[]
    )
    with CaptureQueriesContext(connection) as ctx:
        calculate_account_health_for_accounts(
            user,
            accounts,
            as_of_date=AS_OF,
            days=30,
            timeline_rows=[],
            forecast_summaries=forecasts,
            context=context,
        )
    assert ctx.captured_queries == []


def test_dashboard_get_does_not_persist_credit_or_goal_sync(user, household):
    seeded = _seed_dashboard(user, household, n_checking=1, n_cards=1, n_goals=1)
    card = seeded["cards"][0]
    bucket = seeded["goals"][0]
    Account.objects.filter(pk=card.pk).update(current_balance=Decimal("9999.00"))
    GoalBucket.objects.filter(pk=bucket.pk).update(allocated_amount=Decimal("1.00"))

    cache.clear()
    build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    build_dashboard_summary_details(user, days=30, as_of_date=AS_OF)

    card.refresh_from_db()
    bucket.refresh_from_db()
    assert card.current_balance == Decimal("9999.00")
    assert bucket.allocated_amount == Decimal("1.00")


def test_cached_fast_and_details_reuse_without_rebuild(user, household):
    _seed_dashboard(user, household, n_checking=2, n_cards=1, n_goals=1)
    cache.clear()
    first = build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    with CaptureQueriesContext(connection) as cached_fast:
        second = build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    assert second == first
    assert len(cached_fast.captured_queries) <= 2

    details = build_dashboard_summary_details(user, days=30, as_of_date=AS_OF)
    with CaptureQueriesContext(connection) as cached_details:
        details2 = build_dashboard_summary_details(user, days=30, as_of_date=AS_OF)
    assert details2 == details
    assert len(cached_details.captured_queries) <= 2


def test_details_works_without_shared_context(user, household):
    _seed_dashboard(user, household, n_checking=1, n_cards=1, n_goals=1)
    cache.clear()
    details = build_dashboard_summary_details(user, days=30, as_of_date=AS_OF)
    assert "upcoming_groups" in details
    assert "goals" in details


def test_zero_balance_and_empty_goal_accounts(user, household):
    _make_checking(household, "Empty Checking", "0")
    _make_card(household, "Empty Card", "0")
    savings = _make_savings(household, "Empty Savings")
    GoalBucket.objects.create(
        household=household,
        name="Empty Goal",
        type=GoalBucket.BucketType.CUSTOM,
        target_amount=Decimal("1000"),
        linked_account=savings,
        monthly_target=Decimal("0"),
        status=GoalBucket.Status.ACTIVE,
    )
    cache.clear()
    fast = build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    details = build_dashboard_summary_details(user, days=30, as_of_date=AS_OF)
    assert fast["top_summary"]["available_cash"] is not None
    assert details["goals_summary"]["goals_active_count"] >= 1
