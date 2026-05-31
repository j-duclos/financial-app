"""Scenario comparison: account-scoped cash risk and projection parity."""
from datetime import date, timedelta
from decimal import Decimal

import pytest

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule, Scenario, ScenarioRuleOverride
from timeline.services.scenario_comparison import build_scenario_comparison


@pytest.fixture
def hh(db, user):
    h = Household.objects.create(name="Compare HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def checking(db, hh):
    return Account.objects.create(
        household=hh,
        account_type=Account.AccountType.CHECKING,
        name="Main",
        starting_balance=Decimal("2000"),
        currency="USD",
        include_in_forecast=True,
    )


@pytest.fixture
def credit_card(db, hh):
    return Account.objects.create(
        household=hh,
        account_type=Account.AccountType.CREDIT,
        name="Venture",
        starting_balance=Decimal("-500"),
        currency="USD",
        include_in_forecast=True,
        credit_limit=Decimal("10000"),
    )


@pytest.fixture
def expense_category(db, hh):
    return Category.objects.create(
        household=hh,
        name="Subscriptions",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )


@pytest.mark.django_db
def test_credit_card_subscription_change_does_not_flag_cash_risky(
    user, hh, checking, credit_card, expense_category
):
    """Increasing a credit-card-only subscription must not invent checking overdrafts."""
    today = date.today()
    rule = RecurringRule.objects.create(
        household=hh,
        name="Cursor",
        account=credit_card,
        category=expense_category,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("65.52"),
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

    scenario = Scenario.objects.create(household=hh, name="Cursor bump")
    ScenarioRuleOverride.objects.create(
        scenario=scenario,
        rule=rule,
        override_amount=Decimal("75.00"),
    )

    result = build_scenario_comparison(
        user,
        scenario.id,
        horizon="6m",
        household_id=hh.id,
        as_of_date=today,
    )

    risk = result["risk_explanation"]
    assert risk["impact_scope"] == "credit_only"
    assert risk["cash_lowest_unchanged"] is True
    assert risk["is_risky"] is False
    assert risk["first_problem_date"] is None

    base_low = Decimal(result["metrics"]["lowest_projected_balance"]["base"])
    scenario_low = Decimal(result["metrics"]["lowest_projected_balance"]["scenario"])
    assert abs(base_low - scenario_low) <= Decimal("0.01")

    debt_delta = Decimal(result["metrics"]["credit_debt_after_horizon"]["delta"] or "0")
    assert debt_delta > Decimal("0")

    traceable = Decimal(result["risk_explanation"]["traceable_credit_charge_delta"])
    per_occ = Decimal(result["risk_explanation"]["traceable_per_occurrence"])
    count = result["risk_explanation"]["traceable_occurrence_count"]
    assert per_occ == Decimal("9.48")
    assert count >= 1
    assert traceable == (per_occ * count).quantize(Decimal("0.01"))
