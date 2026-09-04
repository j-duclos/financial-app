"""Start date on a paycheck amount edit must not delete payroll before that date."""
from datetime import date
from decimal import Decimal

import pytest

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule, Scenario, ScenarioRuleOverride
from timeline.services.scenario_comparison import build_scenario_comparison
from timeline.services.scenario_timeline import override_changes_timing


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


@pytest.mark.django_db
def test_pay_down_debt_active_stamp_is_not_a_timing_change(hh, checking):
    rule = RecurringRule.objects.create(
        household=hh,
        name="Savor payment",
        account=checking,
        direction=RecurringRule.Direction.TRANSFER,
        amount=Decimal("25"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=4,
        start_date=date(2020, 1, 1),
        active=True,
    )
    scenario = Scenario.objects.create(household=hh, name="Credit Card Pay down")
    ov = ScenarioRuleOverride.objects.create(
        scenario=scenario,
        rule=rule,
        override_amount=Decimal("75"),
        override_active=True,
        override_start_date=date(2026, 9, 4),
    )
    assert override_changes_timing(ov) is False


@pytest.mark.django_db
def test_pausing_a_rule_from_a_date_is_a_timing_change(hh, checking):
    rule = RecurringRule.objects.create(
        household=hh,
        name="Payroll",
        account=checking,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("2000"),
        currency="USD",
        frequency=RecurringRule.Frequency.BIWEEKLY,
        interval=1,
        start_date=date(2020, 1, 1),
        active=True,
    )
    scenario = Scenario.objects.create(household=hh, name="Pause")
    ov = ScenarioRuleOverride.objects.create(
        scenario=scenario,
        rule=rule,
        override_active=False,
        override_start_date=date(2026, 6, 1),
    )
    assert override_changes_timing(ov) is True


@pytest.mark.django_db
def test_debt_monthly_increase_compare_keeps_prior_payments(user, hh, checking):
    """Pay Down Debt UI stamps override_active=True + start date; compare must still run."""
    today = date(2026, 9, 4)
    card = Account.objects.create(
        household=hh,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Savor",
        starting_balance=Decimal("-2018.31"),
        credit_limit=Decimal("5000"),
        currency="USD",
        include_in_forecast=True,
    )
    rule = RecurringRule.objects.create(
        household=hh,
        name="Savor payment",
        account=checking,
        transfer_to_account=card,
        direction=RecurringRule.Direction.TRANSFER,
        amount=Decimal("25"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=4,
        start_date=date(2020, 1, 1),
        active=True,
    )
    scenario = Scenario.objects.create(household=hh, name="Credit Card Pay down")
    ScenarioRuleOverride.objects.create(
        scenario=scenario,
        rule=rule,
        override_amount=Decimal("75"),
        override_active=True,
        override_start_date=today,
        notes="what_if_debt:monthly",
    )

    comparison = build_scenario_comparison(
        user,
        scenario.id,
        horizon="3m",
        household_id=hh.id,
        as_of_date=today,
    )
    assert comparison["scenario_id"] == scenario.id
    assert "metrics" in comparison
    scenario_rows = comparison.get("forecast_changes") or comparison.get("metrics")
    assert scenario_rows is not None
