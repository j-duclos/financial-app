"""Scenario lowest balance must match calendar / Transactions ledger (no double-counting)."""
from datetime import date
from decimal import Decimal

import pytest

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule, Scenario, ScenarioOneTimeEvent
from timeline.services.calendar import build_timeline_calendar
from timeline.services.ledger import forecast_lowest_balance_from_rows
from timeline.services.scenario_comparison import build_scenario_comparison


@pytest.fixture
def hh(db, user):
    h = Household.objects.create(name="Lowest HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def checking(db, hh):
    return Account.objects.create(
        household=hh,
        account_type=Account.AccountType.CHECKING,
        name="Chase",
        starting_balance=Decimal("3397.83"),
        currency="USD",
        include_in_forecast=True,
    )


@pytest.mark.django_db
def test_scenario_lowest_matches_calendar_not_double_counted(user, hh, checking):
    """
    Historical cleared rows must not be applied twice on top of end-of-yesterday opening.
    Wrong math produced phantom lows like -810 when the ledger stays near zero.
    """
    today = date(2026, 5, 29)
    end = date(2026, 11, 30)
    income_cat = Category.objects.create(
        household=hh,
        name="Salary",
        category_type=Category.CategoryType.INCOME,
        sort_order=0,
    )
    expense_cat = Category.objects.create(
        household=hh,
        name="Rent",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )
    RecurringRule.objects.create(
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
    RecurringRule.objects.create(
        household=hh,
        name="Rent",
        account=checking,
        category=expense_cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("2100"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=1,
        start_date=date(2020, 1, 1),
        active=True,
    )

    calendar = build_timeline_calendar(
        user,
        start_date=today,
        end_date=end,
        account_id=checking.id,
        household_id=hh.id,
        as_of_date=today,
    )
    cal_low = Decimal(calendar["summary"]["lowest_balance"])

    scenario = Scenario.objects.create(household=hh, name="Gift")
    ScenarioOneTimeEvent.objects.create(
        scenario=scenario,
        direction=ScenarioOneTimeEvent.Direction.INCOME,
        date=date(2026, 6, 17),
        account=checking,
        description="GIFT",
        amount=Decimal("100"),
    )

    comparison = build_scenario_comparison(
        user,
        scenario.id,
        horizon="6m",
        household_id=hh.id,
        as_of_date=today,
    )
    base_low = Decimal(comparison["metrics"]["lowest_projected_balance"]["base"])
    risk_base = Decimal(comparison["risk_explanation"]["base_lowest_balance"])

    assert abs(base_low - cal_low) <= Decimal("0.01"), f"{base_low} vs calendar {cal_low}"
    assert abs(risk_base - cal_low) <= Decimal("0.01")
    assert base_low > Decimal("-500"), f"phantom double-count low: {base_low}"


@pytest.mark.django_db
def test_forecast_lowest_helper_matches_calendar(user, hh, checking):
    today = date(2026, 5, 29)
    end = date(2026, 8, 31)
    Category.objects.create(
        household=hh,
        name="Salary",
        category_type=Category.CategoryType.INCOME,
        sort_order=0,
    )
    expense_cat = Category.objects.create(
        household=hh,
        name="Bills",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )
    RecurringRule.objects.create(
        household=hh,
        name="Small bill",
        account=checking,
        category=expense_cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("50"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=15,
        start_date=date(2020, 1, 1),
        active=True,
    )

    calendar = build_timeline_calendar(
        user,
        start_date=today,
        end_date=end,
        account_id=checking.id,
        household_id=hh.id,
        as_of_date=today,
    )
    from timeline.services.ledger import build_timeline

    timeline_rows = build_timeline(
        user,
        start_date=today,
        end_date=end,
        account_id=checking.id,
        household_id=hh.id,
        as_of_date=today,
    )
    helper_low, _, _ = forecast_lowest_balance_from_rows(
        timeline_rows,
        account_ids={checking.id},
        today=today,
        end_date=end,
    )
    cal_low = Decimal(calendar["summary"]["lowest_balance"])
    assert helper_low is not None
    assert abs(helper_low - cal_low) <= Decimal("0.01")
