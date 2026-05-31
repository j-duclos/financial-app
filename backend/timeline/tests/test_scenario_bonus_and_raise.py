"""Bonus + paycheck raise must improve lowest balance (matches user workflow)."""
from datetime import date
from decimal import Decimal

import pytest

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import (
    RecurringRule,
    Scenario,
    ScenarioOneTimeEvent,
    ScenarioRuleOverride,
)
from timeline.services.scenario_comparison import build_scenario_comparison


@pytest.fixture
def hh(db, user):
    h = Household.objects.create(name="Bonus Raise HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def checking(db, hh):
    return Account.objects.create(
        household=hh,
        account_type=Account.AccountType.CHECKING,
        name="Chase",
        starting_balance=Decimal("500"),
        currency="USD",
        include_in_forecast=True,
    )


@pytest.mark.django_db
def test_bonus_then_pay_raise_improves_lowest(user, hh, checking):
    today = date(2026, 5, 28)
    income_cat = Category.objects.create(
        household=hh,
        name="Salary",
        category_type=Category.CategoryType.INCOME,
        sort_order=0,
    )
    payroll = RecurringRule.objects.create(
        household=hh,
        name="Payroll",
        account=checking,
        category=income_cat,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("1835.52"),
        currency="USD",
        frequency=RecurringRule.Frequency.BIWEEKLY,
        interval=1,
        day_of_week=3,
        start_date=date(2020, 1, 1),
        active=True,
    )

    scenario = Scenario.objects.create(household=hh, name="test")
    ScenarioOneTimeEvent.objects.create(
        scenario=scenario,
        date=date(2026, 5, 30),
        account=checking,
        description="bonus",
        direction=ScenarioOneTimeEvent.Direction.INCOME,
        amount=Decimal("500"),
    )
    ScenarioRuleOverride.objects.create(
        scenario=scenario,
        rule=payroll,
        override_amount=Decimal("2100"),
    )

    comparison = build_scenario_comparison(
        user,
        scenario.id,
        horizon="6m",
        household_id=hh.id,
        as_of_date=today,
    )
    base_low = Decimal(comparison["metrics"]["lowest_projected_balance"]["base"])
    scenario_low = Decimal(comparison["metrics"]["lowest_projected_balance"]["scenario"])
    ending_delta = Decimal(comparison["metrics"]["ending_cash"]["delta"])

    assert ending_delta > 0
    assert scenario_low >= base_low
    assert comparison["risk_explanation"]["is_risky"] is False
