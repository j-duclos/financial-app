"""Canonical forecast reuse for health, statements, goals, transfer baseline."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APIClient

from accounts.models import Account
from accounts.services.account_health import calculate_account_health
from accounts.services.projected_statement import calculate_projected_statement_for_account
from common.services.profiler import get_build_timeline_count, reset_build_timeline_count
from core.models import Household, HouseholdMembership
from goals.services import _timeline_balance_at_end_of_date
from timeline.services.canonical_timeline_cache import get_or_build_canonical_forecast_timeline
from timeline.services.transfer_simulation import prepare_transfer_simulation_context

User = get_user_model()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="canon_reuse", password="pass1234")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Canon HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def checking(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Main",
        currency="USD",
        starting_balance=Decimal("1000.00"),
        include_in_forecast=True,
        minimum_buffer=Decimal("100"),
    )


@pytest.fixture
def credit(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Card",
        currency="USD",
        credit_limit=Decimal("5000"),
        starting_balance=Decimal("-400.00"),
        current_balance=Decimal("400.00"),
        statement_closing_day=15,
        include_in_forecast=True,
    )


@pytest.fixture
def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
def test_standalone_account_health_reuses_warm_canonical(user, household, checking):
    today = date.today()
    cache.clear()
    reset_build_timeline_count()
    get_or_build_canonical_forecast_timeline(
        user,
        today=today,
        forecast_days=30,
        household_id=household.id,
        caller="test_home",
    )
    assert get_build_timeline_count() >= 1
    reset_build_timeline_count()
    calculate_account_health(user, checking, days=30)
    assert get_build_timeline_count() == 0


@pytest.mark.django_db
def test_projected_statement_reuses_warm_canonical(user, household, credit):
    today = date.today()
    closing = credit.get_statement_closing_day()
    assert closing is not None
    from accounts.services.credit_card import calculate_next_statement_date

    cycle_end = calculate_next_statement_date(closing, today)
    days = max((cycle_end - today).days, 0)
    cache.clear()
    reset_build_timeline_count()
    get_or_build_canonical_forecast_timeline(
        user,
        today=today,
        forecast_days=days,
        household_id=household.id,
        caller="test_home",
    )
    reset_build_timeline_count()
    result = calculate_projected_statement_for_account(user, credit)
    assert result["billing_cycle_end_date"] is not None
    assert get_build_timeline_count() == 0


@pytest.mark.django_db
def test_goal_future_balance_reuses_warm_canonical(user, household, checking):
    today = date.today()
    future = today + timedelta(days=30)
    cache.clear()
    reset_build_timeline_count()
    get_or_build_canonical_forecast_timeline(
        user,
        today=today,
        forecast_days=30,
        household_id=household.id,
        caller="test_home",
    )
    reset_build_timeline_count()
    _timeline_balance_at_end_of_date(user, checking.pk, future)
    assert get_build_timeline_count() == 0


@pytest.mark.django_db
def test_transfer_simulation_baseline_reuses_warm_canonical(user, household, checking):
    today = date.today()
    # 6m horizon ≈ 183 days depending on helper
    from timeline.services.transfer_simulation import _horizon_to_end

    end = _horizon_to_end(today, "6m")
    days = max((end - today).days, 7)
    cache.clear()
    reset_build_timeline_count()
    get_or_build_canonical_forecast_timeline(
        user,
        today=today,
        forecast_days=days,
        household_id=household.id,
        caller="test_home",
    )
    reset_build_timeline_count()
    prepare_transfer_simulation_context(user, horizon="6m", household_id=household.id)
    assert get_build_timeline_count() == 0


@pytest.mark.django_db
def test_transfer_simulation_ephemeral_still_builds(user, household, checking):
    """Hypothetical transfer must build once even when baseline is a canonical HIT."""
    from timeline.services.transfer_simulation import simulate_transfer_impact

    today = date.today()
    savings = Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        name="Save",
        currency="USD",
        starting_balance=Decimal("100.00"),
        include_in_forecast=True,
    )
    from timeline.services.transfer_simulation import _horizon_to_end

    end = _horizon_to_end(today, "6m")
    days = max((end - today).days, 7)
    cache.clear()
    reset_build_timeline_count()
    get_or_build_canonical_forecast_timeline(
        user,
        today=today,
        forecast_days=days,
        household_id=household.id,
        caller="test_home",
    )
    reset_build_timeline_count()
    simulate_transfer_impact(
        user,
        from_account_id=checking.id,
        to_account_id=savings.id,
        amount=Decimal("50.00"),
        transfer_date=today + timedelta(days=3),
        horizon="6m",
        household_id=household.id,
    )
    # One hypothetical build; baseline should HIT canonical.
    assert get_build_timeline_count() == 1


@pytest.mark.django_db
def test_rules_api_exposes_next_occurrence_and_monthly(auth_client, user, household, checking):
    from categories.models import Category
    from timeline.models import RecurringRule

    expense = Category.objects.create(
        household=household,
        name="Utilities",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )
    RecurringRule.objects.create(
        household=household,
        name="Electric",
        account=checking,
        category=expense,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("120.00"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=min(date.today().day + 2, 28),
        start_date=date.today() - timedelta(days=60),
        active=True,
        is_bill=True,
    )
    r = auth_client.get("/api/rules/")
    assert r.status_code == 200
    results = r.json().get("results") or r.json()
    if isinstance(results, dict):
        results = results.get("results") or []
    assert results
    row = next(x for x in results if x["name"] == "Electric")
    assert row.get("next_occurrence_date")
    assert Decimal(row["estimated_monthly_amount"]) == Decimal("-120.00")
