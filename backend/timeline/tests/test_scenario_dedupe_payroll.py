"""Duplicate planned + projected paycheck rows must not double-count in what-if."""
from datetime import date
from decimal import Decimal

import pytest

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule, Scenario, ScenarioRuleOverride
from timeline.services.ledger import (
    build_timeline,
    dedupe_future_rule_occurrence_rows,
    signed_amount_for_rule,
)
from timeline.services.scenario_comparison import build_scenario_comparison
from transactions.models import Transaction


@pytest.fixture
def hh(db, user):
    h = Household.objects.create(name="Dedupe HH")
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
def test_signed_amount_follows_existing_row_not_misclassified_rule(db, hh, checking):
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
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("1000"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=15,
        start_date=date(2020, 1, 1),
        active=True,
    )
    row = {"amount": Decimal("1835.52")}
    assert signed_amount_for_rule(rule, Decimal("2100"), row) == Decimal("2100")


@pytest.mark.django_db
def test_pay_raise_with_duplicate_planned_rows(user, hh, checking):
    today = date(2026, 5, 28)
    pay_day = date(2026, 6, 12)
    income_cat = Category.objects.create(
        household=hh,
        name="Salary",
        category_type=Category.CategoryType.INCOME,
        sort_order=0,
    )
    rule = RecurringRule.objects.create(
        household=hh,
        name="2930 JOHN GALT S PAYROLL",
        account=checking,
        category=income_cat,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("1835.52"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=12,
        start_date=date(2020, 1, 1),
        active=True,
    )
    Transaction.objects.create(
        account=checking,
        category=income_cat,
        rule=rule,
        date=pay_day,
        amount=Decimal("1835.52"),
        payee="2930 JOHN GALT S PAYROLL",
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.RULE,
    )

    rows = build_timeline(
        user,
        start_date=today,
        end_date=pay_day,
        account_id=checking.id,
        as_of_date=today,
        projection_only=False,
    )
    payroll_future = [
        r
        for r in rows
        if r.get("rule_id") == rule.id
        and r.get("date") == pay_day
        and r.get("account_id") == checking.id
    ]
    deduped = dedupe_future_rule_occurrence_rows(rows, today)
    payroll_deduped = [
        r
        for r in deduped
        if r.get("rule_id") == rule.id
        and r.get("date") == pay_day
        and r.get("account_id") == checking.id
    ]
    assert len(payroll_future) >= 1
    assert len(payroll_deduped) == 1

    scenario = Scenario.objects.create(household=hh, name="test")
    ScenarioRuleOverride.objects.create(
        scenario=scenario,
        rule=rule,
        override_amount=Decimal("2100"),
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
