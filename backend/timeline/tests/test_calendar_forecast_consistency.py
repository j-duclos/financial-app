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
def test_calendar_summary_first_and_chunk_first_match_financials(
    api_client, user, household, main_checking
):
    """Summary-first and chunk-first must return identical canonical financial results."""
    from timeline.services.calendar import calendar_chunk_payload, calendar_summary_payload
    from timeline.services.calendar_chunks import calendar_chunk_windows

    today = date.today()
    _planned(main_checking, today + timedelta(days=5), "Rent", Decimal("-400.00"))
    _planned(main_checking, today + timedelta(days=18), "Paycheck", Decimal("1200.00"))
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
        "account_id": str(main_checking.id),
    }
    api_client.force_authenticate(user=user)

    summary_first = api_client.get("/api/timeline/calendar/summary/", params)
    assert summary_first.status_code == 200, summary_first.content
    chunk_after_summary = api_client.get(
        "/api/timeline/calendar/chunk/",
        {
            **params,
            "chunk_start": windows[0][0].isoformat(),
            "chunk_end": windows[0][1].isoformat(),
        },
    )
    assert chunk_after_summary.status_code == 200, chunk_after_summary.content

    cache.clear()
    chunk_first = api_client.get(
        "/api/timeline/calendar/chunk/",
        {
            **params,
            "chunk_start": windows[0][0].isoformat(),
            "chunk_end": windows[0][1].isoformat(),
        },
    )
    assert chunk_first.status_code == 200, chunk_first.content
    summary_after_chunk = api_client.get("/api/timeline/calendar/summary/", params)
    assert summary_after_chunk.status_code == 200, summary_after_chunk.content

    s1 = summary_first.json()["summary"]
    s2 = summary_after_chunk.json()["summary"]
    assert s1["lowest_balance"] == s2["lowest_balance"]
    assert s1["next_risk_date"] == s2["next_risk_date"]
    assert s1["total_income"] == s2["total_income"]
    assert s1["total_expenses"] == s2["total_expenses"]
    assert s1.get("safe_until") == s2.get("safe_until")

    days_a = chunk_after_summary.json()["days"]
    days_b = chunk_first.json()["days"]
    assert len(days_a) == len(days_b)
    for da, db in zip(days_a, days_b):
        assert da["date"] == db["date"]
        assert da["ending_balance"] == db["ending_balance"]
        assert da["lowest_balance"] == db["lowest_balance"]


@pytest.mark.django_db
def test_calendar_summary_is_side_effect_free_for_chunk(
    user, household, main_checking
):
    """Chunk built before summary must match chunk built after summary (same cache epoch)."""
    from timeline.services.calendar import calendar_chunk_payload
    from timeline.services.calendar_cache import get_or_build_calendar_for_chunk, get_or_build_canonical_calendar
    from timeline.services.calendar_chunks import calendar_chunk_windows

    today = date.today()
    _planned(main_checking, today + timedelta(days=7), "Bill", Decimal("-75.00"))
    cache.clear()

    start = _lookback_start(today)
    end = today + timedelta(days=30)
    windows = calendar_chunk_windows(start, end, today)

    chunk_only = get_or_build_calendar_for_chunk(
        user,
        range_start=start,
        range_end=end,
        chunk_start=windows[0][0],
        chunk_end=windows[0][1],
        household_id=household.id,
        account_id=main_checking.id,
        as_of_date=today,
        projection_only=True,
        forecast_days=30,
    )
    payload_chunk_first = calendar_chunk_payload(chunk_only, windows[0][0], windows[0][1])

    full = get_or_build_canonical_calendar(
        user,
        start_date=start,
        end_date=end,
        household_id=household.id,
        account_id=main_checking.id,
        as_of_date=today,
        projection_only=True,
        forecast_days=30,
    )
    payload_summary_first = calendar_chunk_payload(full, windows[0][0], windows[0][1])

    assert payload_chunk_first["days"] == payload_summary_first["days"]


@pytest.mark.django_db
def test_calendar_safe_until_status_contract(user, household, main_checking):
    """Summary safe_until must expose explicit status semantics."""
    today = date.today()
    cache.clear()

    calendar = build_timeline_calendar(
        user,
        start_date=today,
        end_date=today + timedelta(days=30),
        household_id=household.id,
        account_id=main_checking.id,
        as_of_date=today,
        forecast_days=30,
    )
    safe_until = calendar["summary"]["safe_until"]
    assert safe_until["status"] in {"available", "no_upcoming_income", "unavailable"}
    assert "reason" in safe_until

    _planned(main_checking, today + timedelta(days=10), "Paycheck", Decimal("1500.00"))
    cache.clear()
    with_income = build_timeline_calendar(
        user,
        start_date=today,
        end_date=today + timedelta(days=30),
        household_id=household.id,
        account_id=main_checking.id,
        as_of_date=today,
        forecast_days=30,
    )["summary"]["safe_until"]
    assert with_income["status"] == "available"
    assert with_income["next_income_date"] is not None


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


@pytest.mark.django_db
def test_calendar_event_risk_flag_only_when_canonical_balance_negative(
    user, household, main_checking
):
    """Pending rows with positive canonical balance_after must not get risk_flag."""
    today = date.today()
    main_checking.minimum_buffer = Decimal("0")
    main_checking.starting_balance = Decimal("5000.00")
    main_checking.save(update_fields=["minimum_buffer", "starting_balance"])

    _planned(main_checking, today, "Income", Decimal("1500.00"))
    _planned(main_checking, today, "Rent", Decimal("-3100.00"))
    _planned(main_checking, today, "Deposit", Decimal("500.00"))
    cache.clear()

    calendar = build_timeline_calendar(
        user,
        start_date=today,
        end_date=today + timedelta(days=30),
        household_id=household.id,
        account_id=main_checking.id,
        as_of_date=today,
        forecast_days=30,
    )
    day = next(d for d in calendar["days"] if d["date"] == today.isoformat())
    for txn in day["transactions"]:
        bal = txn.get("balance_after")
        if bal is not None and Decimal(str(bal)) >= 0:
            assert txn.get("risk_flag") is False, (
                f"{txn.get('description')} balance_after={bal} must not be risk_flag"
            )


def test_bind_day_markers_uses_event_balance_after_not_heat_mix():
    """Regression: never show Chase balance with Main's after Electric."""
    from timeline.services.calendar import _bind_day_markers_to_canonical_events

    days = [
        {
            "date": "2026-09-10",
            "show_lowest_balance_marker": True,
            "lowest_projected_balance": "-208.00",
            "lowest_projected_balance_account_id": 2,
            "lowest_projected_balance_account_name": "Chase",
            "lowest_projected_balance_transaction_id": 55,
            "lowest_projected_balance_after_description": "Electric",
            "lowest_projected_balance_date": "2026-09-10",
            "transactions": [
                {
                    "id": 55,
                    "transaction_id": 55,
                    "account_id": 1,
                    "account_name": "Main",
                    "description": "Electric",
                    "balance_after": "-88.86",
                }
            ],
        }
    ]
    _bind_day_markers_to_canonical_events(days)
    # Marker account id 2 does not match event account 1 → clear mismatched card.
    assert days[0]["show_lowest_balance_marker"] is False
    assert days[0]["lowest_projected_balance"] is None


@pytest.mark.django_db
def test_calendar_future_event_balance_after_matches_transactions_ledger(
    user, household, main_checking
):
    """Every future Calendar event balance_after == canonical Transactions balance_after."""
    today = date.today()
    main_checking.starting_balance = Decimal("5000.00")
    main_checking.minimum_buffer = Decimal("0")
    main_checking.save(update_fields=["starting_balance", "minimum_buffer"])

    _planned(main_checking, today + timedelta(days=2), "Income", Decimal("1500.00"))
    _planned(main_checking, today + timedelta(days=2), "Rent", Decimal("-3100.00"))
    _planned(main_checking, today + timedelta(days=5), "Bill", Decimal("-200.00"))
    cache.clear()

    rows, _ = get_or_build_canonical_forecast_timeline(
        user,
        today=today,
        forecast_days=30,
        household_id=household.id,
        caller="test_txn_ledger",
    )
    txn_by_id = {
        int(r["transaction_id"]): str(
            Decimal(str(r["balance_after"])).quantize(Decimal("0.01"))
        )
        for r in rows
        if r.get("transaction_id") is not None
        and r.get("account_id") == main_checking.id
        and r.get("balance_after") is not None
    }
    assert len(txn_by_id) >= 3

    calendar = build_timeline_calendar(
        user,
        start_date=today,
        end_date=today + timedelta(days=30),
        household_id=household.id,
        account_id=main_checking.id,
        as_of_date=today,
        forecast_days=30,
    )
    matched = 0
    for day in calendar["days"]:
        if not day.get("is_forecast"):
            continue
        for ev in day.get("transactions") or []:
            tid = ev.get("transaction_id")
            if tid is None:
                continue
            tid = int(tid)
            if tid not in txn_by_id:
                continue
            cal_bal = str(Decimal(str(ev.get("balance_after"))).quantize(Decimal("0.01")))
            assert cal_bal == txn_by_id[tid], (
                f"event {ev.get('description')} calendar={cal_bal} "
                f"transactions={txn_by_id[tid]}"
            )
            matched += 1
    assert matched >= 3


@pytest.mark.django_db
def test_calendar_does_not_call_after_pending_seed(user, household, main_checking, monkeypatch):
    """Day-state seeding must not reconstruct via _after_pending_balance."""
    today = date.today()
    _planned(main_checking, today + timedelta(days=3), "Bill", Decimal("-50.00"))
    cache.clear()

    def boom(*_a, **_k):
        raise AssertionError("Calendar must not call _after_pending_balance for day state")

    monkeypatch.setattr(
        "timeline.services.ledger_section_balances._after_pending_balance",
        boom,
    )
    build_timeline_calendar(
        user,
        start_date=today,
        end_date=today + timedelta(days=14),
        household_id=household.id,
        account_id=main_checking.id,
        as_of_date=today,
        forecast_days=14,
    )

@pytest.mark.django_db
def test_calendar_historical_event_balance_matches_timeline_running_balance(
    user, household, main_checking
):
    """Past Calendar event balance == historical timeline running_balance for same event."""
    today = date.today()
    past = today - timedelta(days=5)
    main_checking.starting_balance = Decimal("5000.00")
    main_checking.save(update_fields=["starting_balance"])

    posted = Transaction.objects.create(
        account=main_checking,
        date=past,
        payee="Grocery",
        amount=Decimal("-42.50"),
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
    )
    cache.clear()

    from timeline.services.ledger import build_timeline

    historical = build_timeline(
        user,
        start_date=past,
        end_date=past,
        household_id=household.id,
        as_of_date=today,
        caller="test_hist_running",
    )
    hist_by_tid = {}
    for row in historical:
        tid = row.get("transaction_id")
        if tid is None or row.get("account_id") != main_checking.id:
            continue
        rb = row.get("running_balance")
        if rb is None:
            continue
        hist_by_tid[int(tid)] = str(Decimal(str(rb)).quantize(Decimal("0.01")))
    assert posted.id in hist_by_tid

    calendar = build_timeline_calendar(
        user,
        start_date=past,
        end_date=today + timedelta(days=7),
        household_id=household.id,
        account_id=main_checking.id,
        as_of_date=today,
        forecast_days=7,
    )
    matched = 0
    for day in calendar["days"]:
        if day.get("is_forecast"):
            continue
        for ev in day.get("transactions") or []:
            tid = ev.get("transaction_id")
            if tid is None:
                continue
            tid = int(tid)
            if tid not in hist_by_tid:
                continue
            cal_bal = str(Decimal(str(ev.get("balance_after"))).quantize(Decimal("0.01")))
            assert cal_bal == hist_by_tid[tid], (
                f"past event {ev.get('description')} calendar={cal_bal} "
                f"timeline_running_balance={hist_by_tid[tid]}"
            )
            matched += 1
    assert matched >= 1


def test_annotate_first_shortfall_keeps_day_local_marker_date():
    """Sep 4 keeps its -522.54 day marker; first_account_shortfall_date points at Sep 2."""
    from timeline.services.calendar import _annotate_first_account_shortfall_dates

    days = [
        {
            "date": "2026-09-02",
            "show_lowest_balance_marker": True,
            "lowest_projected_balance_account_id": 1,
            "lowest_projected_balance_date": "2026-09-02",
            "transactions": [
                {"account_id": 1, "balance_after": "-378.80", "description": "Exeterfina Loan"},
            ],
        },
        {
            "date": "2026-09-04",
            "show_lowest_balance_marker": True,
            "lowest_projected_balance_account_id": 1,
            "lowest_projected_balance_date": "2026-09-04",
            "lowest_projected_balance": "-522.54",
            "lowest_projected_balance_after_description": "Hulu",
            "transactions": [
                {"account_id": 1, "balance_after": "-522.54", "description": "Hulu"},
            ],
        },
    ]
    _annotate_first_account_shortfall_dates(days, date(2026, 8, 28))
    assert days[1]["lowest_projected_balance_date"] == "2026-09-04"
    assert days[1]["first_account_shortfall_date"] == "2026-09-02"
    assert days[0]["first_account_shortfall_date"] == "2026-09-02"
