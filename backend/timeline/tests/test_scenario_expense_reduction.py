"""Canceling or lowering an expense must not be flagged as a new cash problem."""
from datetime import date
from decimal import Decimal

import pytest

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule, Scenario, ScenarioRuleOverride
from timeline.services.scenario_comparison import build_scenario_comparison


@pytest.fixture
def hh(db, user):
    h = Household.objects.create(name="Reduce HH")
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
def test_zeroing_expense_override_is_not_risky(user, hh, checking):
    today = date.today()
    expense_cat = Category.objects.create(
        household=hh,
        name="Bills",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )
    RecurringRule.objects.create(
        household=hh,
        name="Affirm",
        account=checking,
        category=expense_cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("48.17"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=max(1, min(28, today.day)),
        start_date=date(2020, 1, 1),
        active=True,
    )
    RecurringRule.objects.create(
        household=hh,
        name="Paycheck",
        account=checking,
        category=Category.objects.create(
            household=hh,
            name="Salary",
            category_type=Category.CategoryType.INCOME,
            sort_order=0,
        ),
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("3000"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=max(1, min(28, today.day)),
        start_date=date(2020, 1, 1),
        active=True,
    )

    scenario = Scenario.objects.create(household=hh, name="Stop Affirm")
    ScenarioRuleOverride.objects.create(
        scenario=scenario,
        rule=RecurringRule.objects.get(name="Affirm"),
        override_amount=Decimal("0"),
    )

    result = build_scenario_comparison(
        user,
        scenario.id,
        horizon="12m",
        household_id=hh.id,
        as_of_date=today,
    )

    risk = result["risk_explanation"]
    assert risk["is_risky"] is False

    base_low = Decimal(result["metrics"]["lowest_projected_balance"]["base"])
    scenario_low = Decimal(result["metrics"]["lowest_projected_balance"]["scenario"])
    assert scenario_low >= base_low - Decimal("0.01")
