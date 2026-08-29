"""Calendar must agree with Dashboard and canonical forecast for the same account/window."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.core.cache import cache

from accounts.models import Account
from accounts.services.available_to_spend import calculate_forecast_summaries_for_accounts
from common.services.profiler import get_build_timeline_count, reset_build_timeline_count
from core.models import Household
from timeline.services.calendar import build_timeline_calendar
from timeline.services.calendar_chunks import calendar_chunk_windows
from timeline.services.canonical_timeline_cache import get_or_build_canonical_forecast_timeline
from timeline.services.ledger import build_forecast_projection_timeline, forecast_account_balance_metrics
from transactions.models import Transaction


@pytest.fixture
def main_checking(household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main",
        starting_balance=Decimal("1000.00"),
        minimum_buffer=Decimal("0"),
        currency="USD",
        include_in_forecast=True,
    )


def _planned(account, day, payee, amount):
    return Transaction.objects.create(
        account=account,
        date=day,
        payee=payee,
        amount=amount,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.ONE_TIME,
    )


@pytest.mark.django_db
def test_calendar_main_lowest_matches_dashboard_forecast(user, household, main_checking):
    today = date.today()
    forecast_days = 30
    _planned(main_checking, today + timedelta(days=4), "Rent", Decimal("-1200.00"))
    _planned(main_checking, today + timedelta(days=20), "Bill", Decimal("-900.00"))
    cache.clear()

    rows, _ = get_or_build_canonical_forecast_timeline(
        user,
        today=today,
        forecast_days=forecast_days,
        household_id=household.id,
        caller="test_dashboard",
    )
    summaries = calculate_forecast_summaries_for_accounts(
        user,
        [main_checking],
        as_of_date=today,
        days=forecast_days,
        timeline_rows=rows,
    )
    dash_summary = summaries[main_checking.id]
    metrics = forecast_account_balance_metrics(
        rows,
        account_id=main_checking.id,
        today=today,
        end_date=today + timedelta(days=forecast_days),
        minimum_buffer=Decimal("0"),
    )

    lookback_start = date(today.year, today.month, 1)
    if today.month == 1:
        lookback_start = date(today.year - 1, 12, 1)
    else:
        lookback_start = date(today.year, today.month - 1, 1)

    calendar = build_timeline_calendar(
        user,
        start_date=lookback_start,
        end_date=today + timedelta(days=forecast_days),
        household_id=household.id,
        account_id=main_checking.id,
        as_of_date=today,
        projection_only=True,
        forecast_days=forecast_days,
    )

    canonical_lowest = Decimal(dash_summary["lowest_projected_balance"])
    walk_lowest = metrics["lowest"]
    assert canonical_lowest == walk_lowest

    forecast_days_out = [d for d in calendar["days"] if d.get("is_forecast")]
    cal_lowest = min(Decimal(d["lowest_balance"]) for d in forecast_days_out)
    assert cal_lowest == canonical_lowest


@pytest.mark.django_db
def test_calendar_reuses_dashboard_canonical_timeline(user, household, main_checking):
    today = date.today()
    forecast_days = 30
    cache.clear()
    reset_build_timeline_count()

    get_or_build_canonical_forecast_timeline(
        user,
        today=today,
        forecast_days=forecast_days,
        household_id=household.id,
        caller="test_home",
    )
    builds_after_home = get_build_timeline_count()

    reset_build_timeline_count()
    build_timeline_calendar(
        user,
        start_date=today,
        end_date=today + timedelta(days=forecast_days),
        household_id=household.id,
        as_of_date=today,
        projection_only=True,
        forecast_days=forecast_days,
    )
    builds_after_calendar = get_build_timeline_count()

    assert builds_after_home >= 1
    assert builds_after_calendar == 0


@pytest.mark.django_db
def test_calendar_historical_days_not_marked_forecast(user, household, main_checking):
    today = date.today()
    past = today - timedelta(days=5)
    _planned(
        main_checking,
        past,
        "Past bill",
        Decimal("-50.00"),
    )
    cache.clear()

    if today.month == 1:
        start = date(today.year - 1, 12, 1)
    else:
        start = date(today.year, today.month - 1, 1)

    calendar = build_timeline_calendar(
        user,
        start_date=start,
        end_date=today + timedelta(days=30),
        household_id=household.id,
        account_id=main_checking.id,
        as_of_date=today,
        projection_only=True,
        forecast_days=30,
    )
    past_day = next(d for d in calendar["days"] if d["date"] == past.isoformat())
    assert past_day["is_forecast"] is False


@pytest.mark.django_db
def test_calendar_summary_and_chunk_share_one_build(user, household, main_checking):
    from timeline.services.calendar import calendar_chunk_payload, calendar_summary_payload
    from timeline.services.calendar_cache import get_or_build_canonical_calendar

    today = date.today()
    end = today + timedelta(days=30)
    if today.month == 1:
        start = date(today.year - 1, 12, 1)
    else:
        start = date(today.year, today.month - 1, 1)

    cache.clear()
    reset_build_timeline_count()
    full = get_or_build_canonical_calendar(
        user,
        start_date=start,
        end_date=end,
        household_id=household.id,
        as_of_date=today,
        projection_only=True,
        forecast_days=30,
    )
    assert get_build_timeline_count() >= 1

    reset_build_timeline_count()
    get_or_build_canonical_calendar(
        user,
        start_date=start,
        end_date=end,
        household_id=household.id,
        as_of_date=today,
        projection_only=True,
        forecast_days=30,
    )
    assert get_build_timeline_count() == 0

    summary = calendar_summary_payload(full)
    chunk = calendar_chunk_payload(full, today.replace(day=1), end)
    assert summary["summary"]["lowest_balance"] == full["summary"]["lowest_balance"]
    assert chunk["days"]


def _lookback_start(today: date) -> date:
    if today.month == 1:
        return date(today.year - 1, 12, 1)
    return date(today.year, today.month - 1, 1)


@pytest.mark.django_db
def test_calendar_household_lookback_with_past_planned(api_client, user, household, main_checking):
    """Household calendar must not mix historical planned rows into risk metrics."""
    today = date.today()
    _planned(main_checking, today - timedelta(days=5), "Past planned", Decimal("-40.00"))
    cache.clear()

    start = _lookback_start(today)
    end = today + timedelta(days=30)
    windows = calendar_chunk_windows(start, end, today)
    params = {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "forecast_days": "30",
        "lookback_months": "1",
        "household_id": str(household.id),
        "chunk_start": windows[0][0].isoformat(),
        "chunk_end": windows[0][1].isoformat(),
    }
    api_client.force_authenticate(user=user)

    summary_res = api_client.get("/api/timeline/calendar/summary/", params)
    assert summary_res.status_code == 200, summary_res.content

    chunk_res = api_client.get("/api/timeline/calendar/chunk/", params)
    assert chunk_res.status_code == 200, chunk_res.content
    assert chunk_res.json()["days"]


@pytest.mark.django_db
def test_calendar_household_lookback_builds(api_client, user, household, main_checking):
    today = date.today()
    _planned(main_checking, today - timedelta(days=5), "Past planned", Decimal("-40.00"))
    cache.clear()

    calendar = build_timeline_calendar(
        user,
        start_date=_lookback_start(today),
        end_date=today + timedelta(days=30),
        household_id=household.id,
        as_of_date=today,
        projection_only=True,
        forecast_days=30,
    )
    assert calendar["days"]
    assert calendar["summary"]["risky_accounts"] is not None
