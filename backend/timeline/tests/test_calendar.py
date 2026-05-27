"""Tests for timeline calendar endpoint and daily aggregation."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule, Scenario
from timeline.services.calendar import build_timeline_calendar

User = get_user_model()
AS_OF = date(2025, 6, 1)


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Calendar HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def checking(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Checking",
        starting_balance=Decimal("5000"),
        minimum_buffer=Decimal("1000"),
        currency="USD",
        include_in_forecast=True,
    )


@pytest.fixture
def savings(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        name="Savings",
        starting_balance=Decimal("2000"),
        currency="USD",
        include_in_forecast=True,
    )


@pytest.fixture
def income_category(db, household):
    return Category.objects.create(
        household=household,
        name="Paycheck",
        category_type=Category.CategoryType.INCOME,
        sort_order=1,
    )


@pytest.fixture
def expense_category(db, household):
    return Category.objects.create(
        household=household,
        name="Rent",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=2,
    )


@pytest.fixture
def transfer_category(db, household):
    return Category.objects.create(
        household=household,
        name="Bank Transfer",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=3,
    )


def _income_rule(household, account, category, amount, day):
    return RecurringRule.objects.create(
        household=household,
        name="Paycheck",
        account=account,
        category=category,
        direction=RecurringRule.Direction.INCOME,
        amount=amount,
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=day,
        start_date=AS_OF,
        active=True,
    )


def _expense_rule(household, account, category, amount, day):
    return RecurringRule.objects.create(
        household=household,
        name="Rent",
        account=account,
        category=category,
        direction=RecurringRule.Direction.EXPENSE,
        amount=amount,
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=day,
        start_date=AS_OF,
        active=True,
    )


@pytest.mark.django_db
def test_calendar_groups_by_date_and_calculates_totals(
    user, household, checking, income_category, expense_category
):
    _income_rule(household, checking, income_category, Decimal("2200"), 1)
    _expense_rule(household, checking, expense_category, Decimal("1800"), 1)
    end = AS_OF + timedelta(days=30)
    result = build_timeline_calendar(
        user,
        start_date=AS_OF,
        end_date=end,
        account_id=checking.id,
        as_of_date=AS_OF,
    )
    june1 = next(d for d in result["days"] if d["date"] == "2025-06-01")
    assert Decimal(june1["income_total"]) == Decimal("2200")
    assert Decimal(june1["expense_total"]) == Decimal("1800")
    assert Decimal(june1["net_total"]) == Decimal("400")
    assert len(june1["transactions"]) >= 2


@pytest.mark.django_db
def test_transfer_excluded_from_net(
    user, household, checking, savings, transfer_category
):
    RecurringRule.objects.create(
        household=household,
        name="To savings",
        account=checking,
        category=transfer_category,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("300"),
        currency="USD",
        frequency=RecurringRule.Frequency.WEEKLY,
        interval=1,
        day_of_week=3,
        start_date=AS_OF,
        active=True,
        transfer_to_account=savings,
    )
    end = AS_OF + timedelta(days=14)
    result = build_timeline_calendar(
        user,
        start_date=AS_OF,
        end_date=end,
        as_of_date=AS_OF,
    )
    xfer_days = [d for d in result["days"] if Decimal(d["transfer_total"]) > 0]
    assert xfer_days, "expected at least one transfer day in horizon"
    day = xfer_days[0]
    assert Decimal(day["transfer_total"]) == Decimal("300")
    assert Decimal(day["net_total"]) == Decimal("0")
    assert any(t["is_transfer"] for t in day["transactions"])


@pytest.mark.django_db
def test_detects_risk_when_below_buffer(user, household, checking, expense_category):
    checking.minimum_buffer = Decimal("5000")
    checking.save()
    _expense_rule(household, checking, expense_category, Decimal("4800"), 2)
    end = AS_OF + timedelta(days=7)
    result = build_timeline_calendar(
        user,
        start_date=AS_OF,
        end_date=end,
        account_id=checking.id,
        as_of_date=AS_OF,
    )
    risky = [d for d in result["days"] if d["risk_level"] in ("watch", "critical")]
    assert risky
    assert result["summary"]["lowest_balance"] is not None
    assert risky[0]["heat_level"] in ("tight", "dangerous")
    assert risky[0]["heat_label"]


@pytest.mark.django_db
def test_calendar_day_includes_heat_fields(
    user, household, checking, income_category, expense_category
):
    _income_rule(household, checking, income_category, Decimal("2200"), 1)
    _expense_rule(household, checking, expense_category, Decimal("1800"), 1)
    end = AS_OF + timedelta(days=30)
    result = build_timeline_calendar(
        user,
        start_date=AS_OF,
        end_date=end,
        account_id=checking.id,
        as_of_date=AS_OF,
    )
    june1 = next(d for d in result["days"] if d["date"] == "2025-06-01")
    assert "heat_level" in june1
    assert "heat_label" in june1
    assert june1["heat_level"] in ("healthy", "neutral", "tight", "dangerous")


@pytest.mark.django_db
def test_calendar_api_respects_filters(api_client, user, household, checking, income_category):
    api_client.force_authenticate(user=user)
    _income_rule(household, checking, income_category, Decimal("100"), 10)
    res = api_client.get(
        "/api/timeline/calendar/",
        {
            "horizon": "14d",
            "account_id": str(checking.id),
            "household_id": str(household.id),
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert "days" in data
    assert data["start_date"]
    assert data["summary"]["total_income"] is not None


@pytest.mark.django_db
def test_scenario_does_not_mutate_base(
    user, household, checking, income_category, expense_category
):
    _income_rule(household, checking, income_category, Decimal("1000"), 15)
    scenario = Scenario.objects.create(household=household, name="Bonus")
    end = AS_OF + timedelta(days=45)
    base = build_timeline_calendar(
        user, start_date=AS_OF, end_date=end, account_id=checking.id, as_of_date=AS_OF
    )
    with_scenario = build_timeline_calendar(
        user,
        start_date=AS_OF,
        end_date=end,
        account_id=checking.id,
        scenario_id=scenario.id,
        as_of_date=AS_OF,
    )
    assert with_scenario["scenario_name"] == "Bonus"
    assert base["scenario_name"] is None
