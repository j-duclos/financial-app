"""Aggregate scenario changes read endpoint."""
from __future__ import annotations

from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import (
    RecurringRule,
    Scenario,
    ScenarioAddedRecurring,
    ScenarioCategoryShock,
    ScenarioOneTimeEvent,
    ScenarioRuleOverride,
)

User = get_user_model()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="scenario_changes", password="pass1234")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Changes HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def checking(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Main",
        currency="USD",
        starting_balance=Decimal("1000"),
    )


@pytest.fixture
def expense_cat(db, household):
    return Category.objects.create(
        household=household,
        name="Utilities",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )


@pytest.fixture
def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
def test_scenario_changes_aggregate(auth_client, household, checking, expense_cat):
    scenario = Scenario.objects.create(household=household, name="Plan A", horizon_months=12)
    rule = RecurringRule.objects.create(
        household=household,
        name="Rent",
        account=checking,
        category=expense_cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("1200"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=1,
        start_date="2026-01-01",
        active=True,
    )
    ScenarioRuleOverride.objects.create(scenario=scenario, rule=rule, override_amount=Decimal("1300"))
    ScenarioOneTimeEvent.objects.create(
        scenario=scenario,
        date="2026-06-01",
        account=checking,
        category=expense_cat,
        direction=ScenarioOneTimeEvent.Direction.EXPENSE,
        amount=Decimal("500"),
        description="Bonus spend",
    )
    ScenarioCategoryShock.objects.create(
        scenario=scenario,
        category=expense_cat,
        percent_change=Decimal("10"),
        start_date="2026-01-01",
    )
    ScenarioAddedRecurring.objects.create(
        scenario=scenario,
        name="Side gig",
        account=checking,
        category=expense_cat,
        direction=ScenarioAddedRecurring.Direction.INCOME,
        amount=Decimal("200"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=15,
        start_date="2026-01-01",
    )

    with CaptureQueriesContext(connection) as ctx:
        res = auth_client.get(f"/api/scenarios/{scenario.id}/changes/")
    assert res.status_code == 200
    body = res.json()
    assert len(body["overrides"]) == 1
    assert len(body["one_time_events"]) == 1
    assert len(body["category_shocks"]) == 1
    assert len(body["added_recurring"]) == 1
    # One query per relation set + scenario lookup — bounded, no N+1 per row.
    assert len(ctx.captured_queries) <= 12
