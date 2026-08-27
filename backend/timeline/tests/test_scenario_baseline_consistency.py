"""Blank What-If scenario must match the canonical normal forecast baseline."""
from __future__ import annotations

from datetime import date, timedelta
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
from timeline.services.canonical_timeline_cache import get_or_build_canonical_forecast_timeline
from timeline.services.scenario_comparison import (
    _horizon_to_end,
    build_scenario_comparison,
    build_scenario_comparison_context,
)
from transactions.models import Transaction


@pytest.fixture
def hh(db, user):
    h = Household.objects.create(name="Baseline Consistency HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def world(db, hh):
    checking = Account.objects.create(
        household=hh,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main",
        starting_balance=Decimal("2500"),
        currency="USD",
        include_in_forecast=True,
    )
    income_cat = Category.objects.create(
        household=hh, name="Salary", category_type=Category.CategoryType.INCOME, sort_order=1
    )
    rent_cat = Category.objects.create(
        household=hh, name="Rent", category_type=Category.CategoryType.EXPENSE, sort_order=2
    )
    RecurringRule.objects.create(
        household=hh,
        name="Payroll",
        account=checking,
        category=income_cat,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("2000"),
        currency="USD",
        frequency=RecurringRule.Frequency.BIWEEKLY,
        interval=1,
        start_date=date(2020, 1, 3),
        active=True,
    )
    RecurringRule.objects.create(
        household=hh,
        name="Rent",
        account=checking,
        category=rent_cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("1500"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=1,
        start_date=date(2020, 1, 1),
        active=True,
    )
    blank = Scenario.objects.create(household=hh, name="Blank", template="blank", horizon_months=12)
    return {"checking": checking, "blank": blank}


def _row_fingerprint(rows: list[dict]) -> list[tuple]:
    out = []
    for r in rows:
        out.append(
            (
                str(r.get("date")),
                r.get("account_id"),
                r.get("rule_id"),
                r.get("source"),
                str(r.get("amount")),
                str(r.get("running_balance")),
                r.get("description"),
            )
        )
    return out


@pytest.mark.django_db
@pytest.mark.parametrize("horizon", ["3m", "6m", "12m", "24m"])
def test_empty_scenario_matches_canonical_forecast(user, hh, world, horizon):
    today = date(2026, 5, 28)
    end = _horizon_to_end(today, horizon)
    horizon_days = max((end - today).days, 7)

    canonical_rows, _ = get_or_build_canonical_forecast_timeline(
        user,
        today=today,
        forecast_days=horizon_days,
        household_id=hh.id,
        scenario_id=None,
        caller="test_canonical_baseline",
    )
    canonical_rows = [r for r in canonical_rows if r.get("date") is None or r["date"] <= end]

    ctx = build_scenario_comparison_context(
        user,
        world["blank"].id,
        horizon=horizon,
        household_id=hh.id,
        as_of_date=today,
    )

    assert _row_fingerprint(ctx.base_rows) == _row_fingerprint(canonical_rows)
    assert _row_fingerprint(ctx.scenario_rows) == _row_fingerprint(ctx.base_rows)

    comparison = build_scenario_comparison(
        user,
        world["blank"].id,
        horizon=horizon,
        household_id=hh.id,
        as_of_date=today,
    )
    metrics = comparison["metrics"]
    for key in ("ending_cash", "lowest_projected_balance", "risk_days"):
        m = metrics[key]
        assert m["base"] == m["scenario"], f"{key}: blank scenario diverged from baseline"
        assert Decimal(str(m["delta"] or 0)) == 0


@pytest.mark.django_db
def test_scenario_override_does_not_mutate_real_state_or_revision(user, hh, world):
    checking = world["checking"]
    blank = world["blank"]
    rev_before = Household.objects.get(pk=hh.pk).financial_revision
    txn_before = Transaction.objects.filter(account__household=hh).count()
    rule_before = RecurringRule.objects.filter(household=hh).count()
    bal_before = Account.objects.get(pk=checking.pk).starting_balance

    paycheck = RecurringRule.objects.filter(household=hh, name="Payroll").get()
    ScenarioRuleOverride.objects.create(
        scenario=blank,
        rule=paycheck,
        override_amount=Decimal("2500"),
    )
    ScenarioOneTimeEvent.objects.create(
        scenario=blank,
        date=date(2026, 6, 15),
        account=checking,
        description="Bonus",
        direction=ScenarioOneTimeEvent.Direction.INCOME,
        amount=Decimal("500"),
    )

    comparison = build_scenario_comparison(
        user,
        blank.id,
        horizon="6m",
        household_id=hh.id,
        as_of_date=date(2026, 5, 28),
    )
    assert Decimal(comparison["metrics"]["ending_cash"]["delta"]) != 0

    hh.refresh_from_db()
    checking.refresh_from_db()
    assert hh.financial_revision == rev_before
    assert Transaction.objects.filter(account__household=hh).count() == txn_before
    assert RecurringRule.objects.filter(household=hh).count() == rule_before
    assert checking.starting_balance == bal_before
    assert paycheck.amount == Decimal("2000")


@pytest.mark.django_db
def test_scenario_compare_reuses_warm_canonical_baseline(user, hh, world):
    from common.services.profiler import get_build_timeline_count, reset_build_timeline_count

    today = date(2026, 5, 28)
    horizon = "3m"
    end = _horizon_to_end(today, horizon)
    horizon_days = max((end - today).days, 7)

    get_or_build_canonical_forecast_timeline(
        user,
        today=today,
        forecast_days=horizon_days,
        household_id=hh.id,
        scenario_id=None,
        caller="warmup",
    )

    reset_build_timeline_count()
    build_scenario_comparison_context(
        user,
        world["blank"].id,
        horizon=horizon,
        household_id=hh.id,
        as_of_date=today,
    )
    # Warm canonical cache: compare must not rebuild the unchanged baseline.
    assert get_build_timeline_count() == 0
