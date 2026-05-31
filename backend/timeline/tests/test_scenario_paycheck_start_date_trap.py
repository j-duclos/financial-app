"""Start date on a paycheck amount edit must not delete payroll before that date."""
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
    h = Household.objects.create(name="StartDate HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def checking(db, hh):
    return Account.objects.create(
        household=hh,
        account_type=Account.AccountType.CHECKING,
        name="Chase",
        starting_balance=Decimal("1000"),
        currency="USD",
        include_in_forecast=True,
    )


@pytest.mark.django_db
def test_paycheck_raise_with_start_date_does_not_drop_prior_payrolls(user, hh, checking):
    """Matches production bug: override_start_date=bonus day + amount raise."""
    today = date(2026, 5, 28)
    income_cat = Category.objects.create(
        household=hh,
        name="Salary",
        category_type=Category.CategoryType.INCOME,
        sort_order=0,
    )
    rule = RecurringRule.objects.create(
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
    ScenarioRuleOverride.objects.create(
        scenario=scenario,
        rule=rule,
        override_amount=Decimal("2100"),
        override_start_date=date(2026, 5, 30),
        override_account_id=checking.id,
        override_category_id=income_cat.id,
    )

    comparison = build_scenario_comparison(
        user,
        scenario.id,
        horizon="6m",
        household_id=hh.id,
        as_of_date=today,
    )
    assert comparison["risk_explanation"]["is_risky"] is False
    scenario_low = Decimal(comparison["metrics"]["lowest_projected_balance"]["scenario"])
    base_low = Decimal(comparison["metrics"]["lowest_projected_balance"]["base"])
    assert scenario_low >= base_low
