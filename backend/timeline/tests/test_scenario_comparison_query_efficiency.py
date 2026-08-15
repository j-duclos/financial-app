"""Query-count and timeline-build profile for What-If scenario comparison.

BEFORE (2026-08-15, 3m only — 12m/24m did not finish because writes!=0):
  3m: queries=585 time_ms=596.2 writes=16 timeline_builds=3
      callers=['unknown', 'forecast_summary', 'forecast_summary']
      scenario_derive=1 forecast=4 health=1 rec_ctx=1

AFTER (projection_only base + in-memory scenario + reused forecasts/health/recs):
  3m:  queries=179 time_ms=380 writes=0 timeline_builds=1 callers=['scenario_comparison_base']
  12m: queries=320 time_ms=223 writes=0 timeline_builds=1
  24m: queries=503 time_ms=362 writes=0 timeline_builds=1
      scenario_derive=1 forecast=2 health=2 rec_ctx=1
"""
from __future__ import annotations

import time
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import Account
from categories.models import Category
from common.services.profiler import (
    get_build_timeline_callers,
    get_build_timeline_count,
    reset_build_timeline_count,
)
from timeline.models import (
    RecurringRule,
    Scenario,
    ScenarioAddedRecurring,
    ScenarioOneTimeEvent,
    ScenarioRuleOverride,
)
from transactions.models import Transaction

TODAY = date.today()
WRITE_SQL = ("INSERT", "UPDATE", "DELETE")


def _sql_verb(sql: str) -> str:
    return sql.strip().split(None, 1)[0].upper() if sql.strip() else ""


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


def seed_whatif_world(household, user):
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Chase",
        starting_balance=Decimal("3500"),
        currency="USD",
        include_in_forecast=True,
    )
    savings = Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        name="Chase Savings",
        starting_balance=Decimal("8000"),
        currency="USD",
        include_in_forecast=True,
    )
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Savor",
        starting_balance=Decimal("-1200"),
        credit_limit=Decimal("5000"),
        apr=Decimal("24.99"),
        currency="USD",
        include_in_forecast=True,
        minimum_payment_amount=Decimal("35"),
    )
    income_cat = Category.objects.create(
        household=household, name="Salary", category_type=Category.CategoryType.INCOME, sort_order=1
    )
    rent_cat = Category.objects.create(
        household=household, name="Rent", category_type=Category.CategoryType.EXPENSE, sort_order=2
    )
    util_cat = Category.objects.create(
        household=household, name="Utilities", category_type=Category.CategoryType.EXPENSE, sort_order=3
    )
    paycheck = RecurringRule.objects.create(
        household=household,
        name="Payroll",
        account=checking,
        category=income_cat,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("1835.52"),
        currency="USD",
        frequency=RecurringRule.Frequency.BIWEEKLY,
        interval=1,
        start_date=date(2020, 1, 3),
        active=True,
    )
    RecurringRule.objects.create(
        household=household,
        name="Rent",
        account=checking,
        category=rent_cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("1800"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=1,
        start_date=date(2020, 1, 1),
        active=True,
    )
    RecurringRule.objects.create(
        household=household,
        name="Electric",
        account=checking,
        category=util_cat,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("120"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=15,
        start_date=date(2020, 1, 1),
        active=True,
    )
    RecurringRule.objects.create(
        household=household,
        name="Card payment",
        account=checking,
        transfer_to_account=card,
        direction=RecurringRule.Direction.TRANSFER,
        amount=Decimal("100"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=10,
        start_date=date(2020, 1, 1),
        active=True,
    )
    scenario = Scenario.objects.create(
        household=household, name="Raise and extra debt", horizon_months=12
    )
    ScenarioRuleOverride.objects.create(
        scenario=scenario,
        rule=paycheck,
        override_amount=Decimal("2500"),
    )
    ScenarioOneTimeEvent.objects.create(
        scenario=scenario,
        date=TODAY + timedelta(days=20),
        account=savings,
        transfer_to_account=checking,
        description="Transfer from Chase Savings to Chase",
        direction=ScenarioOneTimeEvent.Direction.TRANSFER,
        amount=Decimal("500"),
    )
    ScenarioOneTimeEvent.objects.create(
        scenario=scenario,
        date=TODAY + timedelta(days=7),
        account=checking,
        transfer_to_account=card,
        description="Pay toward Amazon",
        direction=ScenarioOneTimeEvent.Direction.TRANSFER,
        amount=Decimal("249.98"),
    )
    ScenarioAddedRecurring.objects.create(
        scenario=scenario,
        name="Extra to Savor",
        account=checking,
        transfer_to_account=card,
        direction=ScenarioAddedRecurring.Direction.TRANSFER,
        amount=Decimal("250"),
        currency="USD",
        frequency=ScenarioAddedRecurring.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=20,
        start_date=TODAY,
    )
    return {
        "checking": checking,
        "savings": savings,
        "card": card,
        "paycheck": paycheck,
        "scenario": scenario,
    }


def _profile_compare(auth_client: APIClient, scenario_id: int, household_id: int, horizon: str) -> dict:
    from accounts.services.available_to_spend import calculate_forecast_summaries_for_accounts
    from accounts.services.account_health import calculate_account_health_for_accounts
    from recommendations.services.engine import build_recommendation_context
    from timeline.services.scenario_timeline import build_scenario_timeline_from_base

    counts = {
        "forecast": 0,
        "health": 0,
        "rec_ctx": 0,
        "scenario_derive": 0,
    }

    orig_forecast = calculate_forecast_summaries_for_accounts
    orig_health = calculate_account_health_for_accounts
    orig_rec = build_recommendation_context
    orig_derive = build_scenario_timeline_from_base

    def wrap_forecast(*args, **kwargs):
        counts["forecast"] += 1
        return orig_forecast(*args, **kwargs)

    def wrap_health(*args, **kwargs):
        counts["health"] += 1
        return orig_health(*args, **kwargs)

    def wrap_rec(*args, **kwargs):
        counts["rec_ctx"] += 1
        return orig_rec(*args, **kwargs)

    def wrap_derive(*args, **kwargs):
        counts["scenario_derive"] += 1
        return orig_derive(*args, **kwargs)

    reset_build_timeline_count()
    connection.queries_log.clear()
    t0 = time.perf_counter()
    with (
        patch(
            "timeline.services.scenario_comparison.calculate_forecast_summaries_for_accounts",
            wrap_forecast,
        ),
        patch(
            "timeline.services.scenario_comparison.calculate_account_health_for_accounts",
            wrap_health,
        ),
        patch(
            "recommendations.services.engine.build_recommendation_context",
            wrap_rec,
        ),
        patch(
            "timeline.services.scenario_comparison.build_scenario_timeline_from_base",
            wrap_derive,
        ),
        CaptureQueriesContext(connection) as ctx,
    ):
        res = auth_client.get(
            f"/api/scenarios/{scenario_id}/compare/",
            {"horizon": horizon, "household_id": str(household_id)},
        )
    elapsed_ms = (time.perf_counter() - t0) * 1000
    assert res.status_code == 200, res.content[:500]
    writes = sum(1 for q in ctx.captured_queries if _sql_verb(q["sql"]) in WRITE_SQL)
    body = res.json()
    return {
        "queries": len(ctx.captured_queries),
        "elapsed_ms": elapsed_ms,
        "writes": writes,
        "timeline_builds": get_build_timeline_count(),
        "timeline_callers": get_build_timeline_callers(),
        "forecast": counts["forecast"],
        "health": counts["health"],
        "rec_ctx": counts["rec_ctx"],
        "scenario_derive": counts["scenario_derive"],
        "body": body,
    }


def _snapshot_real_state(household):
    accounts = list(Account.objects.filter(household=household).order_by("id"))
    return {
        "txn_count": Transaction.objects.filter(account__household=household).count(),
        "rule_count": RecurringRule.objects.filter(household=household).count(),
        "starting_balances": {a.id: a.starting_balance for a in accounts},
        "account_count": len(accounts),
    }


def _legacy_ending_scan(rows) -> dict[int, Decimal]:
    result: dict[int, Decimal] = {}
    for row in reversed(rows):
        aid = row.get("account_id")
        if aid is None or int(aid) in result:
            continue
        result[int(aid)] = Decimal(str(row.get("running_balance") or 0))
    return result


@pytest.mark.django_db
def test_profile_whatif_comparison(auth_client, household, user):
    world = seed_whatif_world(household, user)
    scenario = world["scenario"]
    print("\nWHAT-IF PROFILE AFTER")
    for horizon in ("3m", "12m", "24m"):
        stats = _profile_compare(auth_client, scenario.id, household.id, horizon)
        print(
            f"{horizon}: queries={stats['queries']} time_ms={stats['elapsed_ms']:.1f} "
            f"writes={stats['writes']} timeline_builds={stats['timeline_builds']} "
            f"callers={stats['timeline_callers']} scenario_derive={stats['scenario_derive']} "
            f"forecast={stats['forecast']} health={stats['health']} rec_ctx={stats['rec_ctx']}"
        )
        assert stats["writes"] == 0
        assert stats["timeline_builds"] == 1
        assert stats["timeline_callers"] == ["scenario_comparison_base"]
        assert stats["scenario_derive"] == 1
        assert stats["forecast"] == 2
        assert stats["health"] == 2
        assert stats["rec_ctx"] == 1
        assert "metrics" in stats["body"]


@pytest.mark.django_db
def test_compare_get_does_not_mutate_real_state(auth_client, household, user):
    world = seed_whatif_world(household, user)
    before = _snapshot_real_state(household)
    res = auth_client.get(
        f"/api/scenarios/{world['scenario'].id}/compare/",
        {"horizon": "12m", "household_id": str(household.id)},
    )
    assert res.status_code == 200
    after = _snapshot_real_state(household)
    assert after == before


@pytest.mark.django_db
def test_compare_reuses_timelines_for_forecasts_health_and_recs(auth_client, household, user):
    world = seed_whatif_world(household, user)
    stats = _profile_compare(auth_client, world["scenario"].id, household.id, "12m")
    assert stats["timeline_builds"] == 1
    assert stats["scenario_derive"] == 1
    assert stats["forecast"] == 2
    assert stats["rec_ctx"] == 1
    sts_base = stats["body"]["metrics"]["safe_to_spend"]["base"]
    sts_scenario = stats["body"]["metrics"]["safe_to_spend"]["scenario"]
    # Scenario STS must use scenario rows (raise + transfers), not the cached base forecast.
    assert sts_base is not None and sts_scenario is not None
    assert sts_base != sts_scenario


@pytest.mark.django_db
def test_forecasts_with_timeline_rows_do_not_rebuild_timeline(user, household):
    from accounts.services.available_to_spend import calculate_forecast_summaries_for_accounts
    from timeline.services.scenario_comparison import build_scenario_comparison_context

    world = seed_whatif_world(household, user)
    ctx = build_scenario_comparison_context(
        user, world["scenario"].id, horizon="3m", household_id=household.id
    )
    reset_build_timeline_count()
    calculate_forecast_summaries_for_accounts(
        user,
        [a for a in ctx.accounts if a.participates_in_forecast()],
        as_of_date=ctx.as_of_date,
        days=ctx.sts_days,
        timeline_rows=ctx.scenario_rows,
    )
    assert get_build_timeline_count() == 0


@pytest.mark.django_db
def test_health_with_precomputed_forecasts_does_not_rebuild_timeline(user, household):
    from accounts.services.account_health import (
        build_account_health_context,
        calculate_account_health_for_accounts,
    )
    from timeline.services.scenario_comparison import build_scenario_comparison_context

    world = seed_whatif_world(household, user)
    ctx = build_scenario_comparison_context(
        user, world["scenario"].id, horizon="3m", household_id=household.id
    )
    reset_build_timeline_count()
    calculate_account_health_for_accounts(
        user,
        ctx.accounts,
        as_of_date=ctx.as_of_date,
        days=ctx.sts_days,
        timeline_rows=ctx.scenario_rows,
        forecast_summaries=ctx.scenario_forecasts_by_account,
        context=build_account_health_context(
            ctx.accounts, today=ctx.as_of_date, signed_balances=ctx.signed_balances
        ),
    )
    assert get_build_timeline_count() == 0


@pytest.mark.django_db
def test_ending_balance_map_matches_reverse_scan(user, household):
    from timeline.services.scenario_comparison import (
        build_ending_balance_map,
        build_scenario_comparison_context,
    )

    world = seed_whatif_world(household, user)
    ctx = build_scenario_comparison_context(
        user, world["scenario"].id, horizon="12m", household_id=household.id
    )
    assert build_ending_balance_map(ctx.base_rows) == _legacy_ending_scan(ctx.base_rows)
    assert build_ending_balance_map(ctx.scenario_rows) == _legacy_ending_scan(ctx.scenario_rows)


@pytest.mark.django_db
def test_transfer_is_household_net_zero(user, household):
    from timeline.services.scenario_comparison import build_scenario_comparison

    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Checking",
        starting_balance=Decimal("2000"),
        currency="USD",
        include_in_forecast=True,
    )
    savings = Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        name="Savings",
        starting_balance=Decimal("5000"),
        currency="USD",
        include_in_forecast=True,
    )
    scenario = Scenario.objects.create(household=household, name="Move cash")
    ScenarioOneTimeEvent.objects.create(
        scenario=scenario,
        date=TODAY + timedelta(days=5),
        account=savings,
        transfer_to_account=checking,
        description="Transfer from Savings to Checking",
        direction=ScenarioOneTimeEvent.Direction.TRANSFER,
        amount=Decimal("500"),
    )
    result = build_scenario_comparison(
        user, scenario.id, horizon="3m", household_id=household.id, as_of_date=TODAY
    )
    ending_delta = Decimal(result["metrics"]["ending_cash"]["delta"] or "0")
    assert abs(ending_delta) <= Decimal("0.01")


@pytest.mark.django_db
def test_debt_paydown_reduces_cash_and_owed(user, household):
    from timeline.services.scenario_comparison import (
        build_scenario_comparison_context,
        serialize_scenario_comparison,
    )

    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Checking",
        starting_balance=Decimal("3000"),
        currency="USD",
        include_in_forecast=True,
    )
    card = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Card",
        starting_balance=Decimal("-1000"),
        credit_limit=Decimal("5000"),
        currency="USD",
        include_in_forecast=True,
    )
    scenario = Scenario.objects.create(household=household, name="Pay card")
    ScenarioOneTimeEvent.objects.create(
        scenario=scenario,
        date=TODAY + timedelta(days=3),
        account=checking,
        transfer_to_account=card,
        description="Pay toward Card",
        direction=ScenarioOneTimeEvent.Direction.TRANSFER,
        amount=Decimal("249.98"),
    )
    ctx = build_scenario_comparison_context(
        user, scenario.id, horizon="3m", household_id=household.id, as_of_date=TODAY
    )
    base = ctx.base_ending_balance_by_account
    scenario_ending = ctx.scenario_ending_balance_by_account
    event_rows = [
        r for r in ctx.scenario_rows if r.get("source") == "scenario_event"
    ]
    assert {r.get("account_id") for r in event_rows} == {checking.id, card.id}
    assert scenario_ending[checking.id] == base[checking.id] - Decimal("249.98")
    assert scenario_ending[card.id] == base[card.id] + Decimal("249.98")
    payload = serialize_scenario_comparison(ctx)
    debt_delta = Decimal(payload["metrics"]["credit_debt_after_horizon"]["delta"] or "0")
    assert debt_delta == Decimal("-249.98")


@pytest.mark.django_db
def test_income_override_does_not_double_paycheck(user, household):
    from timeline.services.scenario_comparison import build_scenario_comparison

    world = seed_whatif_world(household, user)
    paycheck = world["paycheck"]
    result = build_scenario_comparison(
        user, world["scenario"].id, horizon="3m", household_id=household.id, as_of_date=TODAY
    )
    payroll = [
        c
        for c in result["forecast_changes"]
        if c.get("rule_id") == paycheck.id
    ]
    assert payroll
    for change in payroll:
        assert abs(Decimal(change["base_amount"])) == Decimal("1835.52")
        assert abs(Decimal(change["scenario_amount"])) == Decimal("2500.00")
        assert abs(Decimal(change["delta"])) == Decimal("664.48")


@pytest.mark.django_db
def test_added_recurring_projects_without_real_rule(user, household):
    from timeline.services.scenario_comparison import build_scenario_comparison

    world = seed_whatif_world(household, user)
    rules_before = RecurringRule.objects.filter(household=household).count()
    for horizon in ("3m", "12m", "24m"):
        result = build_scenario_comparison(
            user, world["scenario"].id, horizon=horizon, household_id=household.id, as_of_date=TODAY
        )
        groups = result["forecast_change_groups"]
        assert any(
            g.get("event") == "Extra to Savor" or "Extra to Savor" in (g.get("event") or "")
            for g in groups
        )
    assert RecurringRule.objects.filter(household=household).count() == rules_before


@pytest.mark.django_db
def test_query_count_does_not_scale_with_per_account_forecast_rebuilds(auth_client, household, user):
    world = seed_whatif_world(household, user)
    stats_3 = _profile_compare(auth_client, world["scenario"].id, household.id, "3m")

    for i in range(7):
        Account.objects.create(
            household=household,
            account_type=Account.AccountType.CHECKING,
            role=Account.AccountRole.SPENDING,
            name=f"Extra {i}",
            starting_balance=Decimal("100"),
            currency="USD",
            include_in_forecast=True,
        )
    stats_10 = _profile_compare(auth_client, world["scenario"].id, household.id, "3m")

    for i in range(15):
        Account.objects.create(
            household=household,
            account_type=Account.AccountType.CHECKING,
            role=Account.AccountRole.SPENDING,
            name=f"More {i}",
            starting_balance=Decimal("100"),
            currency="USD",
            include_in_forecast=True,
        )
    stats_25 = _profile_compare(auth_client, world["scenario"].id, household.id, "3m")

    for stats in (stats_3, stats_10, stats_25):
        assert stats["timeline_builds"] == 1
        assert stats["scenario_derive"] == 1
        assert stats["forecast"] == 2
        assert stats["writes"] == 0
    extra_accounts = 22
    per_account = (stats_25["queries"] - stats_3["queries"]) / extra_accounts
    # Extra accounts add bulk/health SQL, not a timeline rebuild each.
    assert per_account < 50


@pytest.mark.django_db
def test_compare_get_is_read_only(auth_client, household, user):
    world = seed_whatif_world(household, user)
    stats = _profile_compare(auth_client, world["scenario"].id, household.id, "12m")
    assert stats["writes"] == 0
