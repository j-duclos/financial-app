"""Lightweight extended cash-risk scan — same semantics as the canonical forecast."""
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APIClient

from accounts.models import Account
from accounts.services.extended_cash_risk import (
    ExtendedCashRiskResult,
    get_extended_cash_risk,
    looking_ahead_beyond_window,
    scan_first_negative_cash,
)
from accounts.services.lowest_projected_cash import get_first_cash_shortfall_from_forecasts
from categories.models import Category
from common.services.forecast_horizon import EXTENDED_CASH_RISK_DAYS
from common.services.profiler import get_build_timeline_callers, reset_build_timeline_count
from core.models import Household, HouseholdMembership
from insights.services.dashboard_summary import build_dashboard_summary_fast
from timeline.services.ledger import build_forecast_projection_timeline
from transactions.models import Transaction

User = get_user_model()
AS_OF = date(2026, 8, 16)
DAY_38 = AS_OF + timedelta(days=38)
DAY_10 = AS_OF + timedelta(days=10)


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="ext_risk", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Extended Risk HH")
    HouseholdMembership.objects.create(
        household=h, user=user, role=HouseholdMembership.Role.OWNER
    )
    return h


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


@pytest.fixture
def expense_category(db, household):
    return Category.objects.create(
        household=household,
        name="Bills",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )


@pytest.fixture
def main(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main",
        starting_balance=Decimal("1000.00"),
        minimum_buffer=Decimal("0"),
        currency="USD",
    )


def _planned(account, day, payee, amount, category=None):
    return Transaction.objects.create(
        account=account,
        date=day,
        payee=payee,
        amount=amount,
        category=category,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


def test_extended_constant_is_six_months():
    assert EXTENDED_CASH_RISK_DAYS == 180


def test_day_38_shortfall_is_outside_30_day_window_but_found_by_extended_scan(
    user, main, expense_category
):
    _planned(main, DAY_38, "Big bill", Decimal("-1500.00"), expense_category)

    fast = build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    assert fast["first_cash_shortfall"] is None

    payload = get_extended_cash_risk(user, as_of_date=AS_OF)
    risk = payload["risk"]
    assert risk is not None
    assert risk["account_name"] == "Main"
    assert risk["first_negative_date"] == DAY_38.isoformat()
    assert risk["days_from_as_of"] == 38
    assert Decimal(risk["projected_balance"]) < 0
    assert payload["horizon_days"] == 180

    result = ExtendedCashRiskResult(
        as_of=AS_OF,
        account_id=risk["account_id"],
        account_name=risk["account_name"],
        first_negative_date=DAY_38,
        projected_balance=Decimal(risk["projected_balance"]),
        days_from_as_of=38,
    )
    assert looking_ahead_beyond_window(result, 30) is True
    assert looking_ahead_beyond_window(result, 60) is False


def test_extended_scan_agrees_with_180_day_dashboard(user, main, expense_category):
    _planned(main, DAY_38, "Big bill", Decimal("-1500.00"), expense_category)

    build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    extended = get_extended_cash_risk(user, as_of_date=AS_OF)
    cache.clear()
    fast_180 = build_dashboard_summary_fast(user, days=180, as_of_date=AS_OF)
    shortfall = fast_180["first_cash_shortfall"]

    assert shortfall is not None
    assert extended["risk"]["first_negative_date"] == shortfall["date"]
    assert extended["risk"]["account_id"] == shortfall["account_id"]
    assert Decimal(extended["risk"]["projected_balance"]) == Decimal(shortfall["amount"])


def test_extended_scan_agrees_with_canonical_timeline_walk(user, main, expense_category):
    _planned(main, DAY_38, "Big bill", Decimal("-1500.00"), expense_category)
    rows = build_forecast_projection_timeline(
        user,
        today=AS_OF,
        end_date=AS_OF + timedelta(days=180),
        caller="test",
    )
    from accounts.services.available_to_spend import calculate_forecast_summaries_for_accounts

    summaries = calculate_forecast_summaries_for_accounts(
        user, [main], as_of_date=AS_OF, days=180, timeline_rows=rows
    )
    expected = get_first_cash_shortfall_from_forecasts([main], summaries)
    build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    extended = get_extended_cash_risk(user, as_of_date=AS_OF)

    assert expected is not None
    assert extended["risk"]["first_negative_date"] == expected["date"]
    assert Decimal(extended["risk"]["projected_balance"]) == Decimal(expected["amount"])


def test_in_window_shortfall_is_returned_but_not_looking_ahead(user, main, expense_category):
    _planned(main, DAY_10, "Near bill", Decimal("-1500.00"), expense_category)
    fast = build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    payload = get_extended_cash_risk(user, as_of_date=AS_OF)

    assert fast["first_cash_shortfall"]["date"] == DAY_10.isoformat()
    assert payload["risk"]["first_negative_date"] == DAY_10.isoformat()
    assert payload["risk"]["days_from_as_of"] == 10
    result = ExtendedCashRiskResult(
        as_of=AS_OF,
        account_id=payload["risk"]["account_id"],
        first_negative_date=DAY_10,
        projected_balance=Decimal(payload["risk"]["projected_balance"]),
        days_from_as_of=10,
    )
    assert looking_ahead_beyond_window(result, 30) is False


def test_credit_card_negative_is_not_a_cash_warning(user, household, main):
    Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Savor",
        starting_balance=Decimal("-2000.00"),
        credit_limit=Decimal("5000"),
        currency="USD",
    )
    build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    payload = get_extended_cash_risk(user, as_of_date=AS_OF)
    assert payload["risk"] is None


def test_earliest_date_wins_then_most_severe_same_day(
    user, household, main, expense_category
):
    bills = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.BILLS,
        name="Bills",
        starting_balance=Decimal("200.00"),
        minimum_buffer=Decimal("0"),
        currency="USD",
    )
    _planned(main, DAY_38, "Main hit", Decimal("-1100.00"), expense_category)
    _planned(bills, DAY_38, "Bills hit", Decimal("-500.00"), expense_category)

    build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    risk = get_extended_cash_risk(user, as_of_date=AS_OF)["risk"]
    assert risk["first_negative_date"] == DAY_38.isoformat()
    assert risk["account_name"] == "Bills"
    assert Decimal(risk["projected_balance"]) == Decimal("-300.00")
    extra_names = {row["account_name"] for row in risk["additional_accounts"]}
    assert extra_names == {"Main"}


def test_dashboard_fast_does_not_run_extended_scan(user, main, expense_category):
    _planned(main, DAY_38, "Big bill", Decimal("-1500.00"), expense_category)
    reset_build_timeline_count()
    build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    callers = get_build_timeline_callers()
    assert "extended_cash_risk" not in callers


def test_extended_result_is_not_recomputed_when_forecast_window_changes(
    user, main, expense_category
):
    _planned(main, DAY_38, "Big bill", Decimal("-1500.00"), expense_category)
    build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)
    first = get_extended_cash_risk(user, as_of_date=AS_OF)

    with patch(
        "accounts.services.extended_cash_risk.build_forecast_projection_timeline"
    ) as mock_build:
        build_dashboard_summary_fast(user, days=60, as_of_date=AS_OF)
        second = get_extended_cash_risk(user, as_of_date=AS_OF)
        mock_build.assert_not_called()

    assert second == first
    assert first["risk"]["days_from_as_of"] == 38


def test_continuation_does_not_rebuild_the_detailed_window(
    user, main, expense_category
):
    _planned(main, DAY_38, "Big bill", Decimal("-1500.00"), expense_category)
    build_dashboard_summary_fast(user, days=30, as_of_date=AS_OF)

    original = build_forecast_projection_timeline
    captured = {}

    def _wrap(*args, **kwargs):
        captured["start_date"] = kwargs.get("start_date")
        captured["end_date"] = kwargs.get("end_date")
        captured["opening_balances"] = kwargs.get("opening_balances")
        captured["caller"] = kwargs.get("caller")
        return original(*args, **kwargs)

    with patch(
        "accounts.services.extended_cash_risk.build_forecast_projection_timeline",
        side_effect=_wrap,
    ):
        get_extended_cash_risk(user, as_of_date=AS_OF)

    assert captured["caller"] == "extended_cash_risk"
    assert captured["start_date"] == AS_OF + timedelta(days=31)
    assert captured["end_date"] == AS_OF + timedelta(days=180)
    assert captured["opening_balances"]
    assert main.id in captured["opening_balances"]
    assert captured["opening_balances"][main.id] == Decimal("1000.00")


def test_scan_stops_on_first_negative_day():
    start = AS_OF + timedelta(days=31)
    later = AS_OF + timedelta(days=100)
    rows = [
        {
            "date": start,
            "account_id": 1,
            "amount": Decimal("-50"),
            "status": "PLANNED",
        },
        {
            "date": later,
            "account_id": 1,
            "amount": Decimal("-9999"),
            "status": "PLANNED",
        },
    ]
    account = Account(id=1, name="Main")
    result = scan_first_negative_cash(
        rows,
        opening={1: Decimal("10")},
        eligible_ids={1},
        accounts_by_id={1: account},
        start_date=start,
        end_date=AS_OF + timedelta(days=180),
        as_of=AS_OF,
    )
    assert result.first_negative_date == start
    assert result.projected_balance == Decimal("-40")
    assert result.days_from_as_of == 31


def test_extended_cash_risk_api_shape(auth_client, main):
    r = auth_client.get("/api/insights/extended-cash-risk/")
    assert r.status_code == 200
    data = r.json()
    assert data["horizon_days"] == 180
    assert "as_of" in data
    assert "risk" in data
    assert "forecast_days" not in data
    assert "timeline" not in data
    assert "transactions" not in data
