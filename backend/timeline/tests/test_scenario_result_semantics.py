"""What-If result semantics: shortfall is not SAFE just because it improved."""
from datetime import date
from decimal import Decimal

import pytest

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule, Scenario, ScenarioRuleOverride
from timeline.services.scenario_comparison import build_scenario_comparison
from transactions.models import Transaction


@pytest.fixture
def hh(db, user):
    h = Household.objects.create(name="Result HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def checking(db, hh):
    return Account.objects.create(
        household=hh,
        account_type=Account.AccountType.CHECKING,
        name="Main",
        starting_balance=Decimal("200"),
        currency="USD",
        include_in_forecast=True,
    )


def _bill(hh, checking, amount: Decimal, day: int) -> RecurringRule:
    cat = Category.objects.create(
        household=hh,
        name=f"Bill {amount}",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )
    return RecurringRule.objects.create(
        household=hh,
        name=f"Bill {amount}",
        account=checking,
        category=cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=amount,
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=day,
        start_date=date(2020, 1, 1),
        active=True,
    )


@pytest.mark.django_db
def test_improved_but_still_negative_is_not_comparatively_risky(user, hh, checking):
    today = date(2026, 5, 28)
    _bill(hh, checking, Decimal("800"), 15)
    paycheck = RecurringRule.objects.create(
        household=hh,
        name="Payroll",
        account=checking,
        category=Category.objects.create(
            household=hh,
            name="Salary",
            category_type=Category.CategoryType.INCOME,
            sort_order=0,
        ),
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("600"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=1,
        start_date=date(2020, 1, 1),
        active=True,
    )

    scenario = Scenario.objects.create(household=hh, name="Raise a little")
    ScenarioRuleOverride.objects.create(
        scenario=scenario,
        rule=paycheck,
        override_amount=Decimal("700"),
    )

    comparison = build_scenario_comparison(
        user,
        scenario.id,
        horizon="12m",
        household_id=hh.id,
        as_of_date=today,
    )
    risk = comparison["risk_explanation"]
    base_low = Decimal(comparison["metrics"]["lowest_projected_balance"]["base"])
    scenario_low = Decimal(comparison["metrics"]["lowest_projected_balance"]["scenario"])

    assert comparison["start_date"]
    assert comparison["end_date"]
    assert comparison["horizon"] == "12m"
    assert comparison["metrics"]["lowest_projected_balance"]["base"] is not None
    assert comparison["metrics"]["lowest_projected_balance"]["scenario"] is not None
    assert scenario_low >= base_low - Decimal("0.01")
    assert scenario_low < 0
    assert risk["is_risky"] is False
    assert risk["scenario_has_cash_shortfall"] is True
    assert risk["scenario_first_problem_date"] is not None
    assert Decimal(risk["amount_needed_to_stay_safe"]) > 0


@pytest.mark.django_db
def test_override_and_compare_do_not_mutate_real_plan(user, hh, checking):
    rule = _bill(hh, checking, Decimal("50"), 10)
    original_amount = rule.amount
    txn = Transaction.objects.create(
        account=checking,
        date=date(2026, 5, 1),
        amount=Decimal("-12.00"),
        payee="Coffee",
    )
    scenario = Scenario.objects.create(household=hh, name="Hypothetical")
    ScenarioRuleOverride.objects.create(
        scenario=scenario,
        rule=rule,
        override_amount=Decimal("1.00"),
    )

    build_scenario_comparison(
        user,
        scenario.id,
        horizon="6m",
        household_id=hh.id,
        as_of_date=date(2026, 5, 28),
    )

    rule.refresh_from_db()
    txn.refresh_from_db()
    checking.refresh_from_db()
    assert rule.amount == original_amount
    assert txn.amount == Decimal("-12.00")
    assert checking.starting_balance == Decimal("200")
    assert Transaction.objects.filter(account=checking).count() == 1
    assert RecurringRule.objects.filter(household=hh, amount=Decimal("1.00")).count() == 0
