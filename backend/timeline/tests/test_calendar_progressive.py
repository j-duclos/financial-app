"""Progressive Calendar: chunk windows, cache reuse, and full-range equality."""
from __future__ import annotations

import json
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext

from accounts.models import Account
from categories.models import Category
from common.services.cache import invalidate_financial_cache_for_household
from common.services.profiler import get_build_timeline_count, reset_build_timeline_count
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule, Scenario, ScenarioOneTimeEvent
from timeline.services.calendar import (
    build_timeline_calendar,
    calendar_chunk_payload,
    calendar_summary_payload,
    public_calendar_day,
)
from timeline.services.calendar_cache import get_or_build_canonical_calendar
from timeline.services.calendar_chunks import calendar_chunk_windows
from transactions.models import Transaction
from transactions.services.posting import create_transfer, post_transaction

User = get_user_model()
AS_OF = date(2025, 6, 1)
END_6M = AS_OF + timedelta(days=180)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="calprog", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Progressive Cal HH")
    HouseholdMembership.objects.create(
        household=h, user=user, role=HouseholdMembership.Role.OWNER
    )
    return h


@pytest.fixture
def checking(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Checking",
        starting_balance=Decimal("8000"),
        minimum_buffer=Decimal("500"),
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
def card(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name="Visa",
        credit_limit=Decimal("5000"),
        starting_balance=Decimal("-400"),
        current_balance=Decimal("400"),
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
    cat, _ = Category.objects.get_or_create(
        household=household,
        name="Bank Transfer",
        category_type=Category.CategoryType.EXPENSE,
        defaults={"sort_order": 3},
    )
    return cat


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


def _day_index(days: list[dict]) -> dict[str, dict]:
    return {d["date"]: d for d in days}


def _comparable_day(day: dict) -> dict:
    public = public_calendar_day(day)
    return {
        "date": public["date"],
        "net_total": public["net_total"],
        "ending_balance": public["ending_balance"],
        "risk_level": public["risk_level"],
        "income_total": public["income_total"],
        "expense_total": public["expense_total"],
        "transfer_total": public["transfer_total"],
    }


def test_chunk_windows_short_range_is_single():
    start = date(2025, 8, 1)
    end = date(2025, 8, 30)
    assert calendar_chunk_windows(start, end, date(2025, 8, 16)) == [(start, end)]


def test_chunk_windows_six_months_starts_with_two_months():
    start = date(2025, 8, 1)
    end = date(2026, 2, 12)
    windows = calendar_chunk_windows(start, end, date(2025, 8, 16))
    assert windows[0] == (date(2025, 8, 1), date(2025, 9, 30))
    assert windows[1][0] == date(2025, 10, 1)
    assert windows[-1][1] == end
    assert all(a <= b for a, b in windows)
    covered = []
    for a, b in windows:
        d = a
        while d <= b:
            covered.append(d)
            d += timedelta(days=1)
    assert covered[0] == start
    assert covered[-1] == end
    assert len(covered) == (end - start).days + 1


def test_full_range_equals_chunked_six_months(
    user, household, checking, income_category, expense_category
):
    RecurringRule.objects.create(
        household=household,
        name="Paycheck",
        account=checking,
        category=income_category,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("2400"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=1,
        start_date=date(2025, 1, 1),
        active=True,
    )
    RecurringRule.objects.create(
        household=household,
        name="Rent",
        account=checking,
        category=expense_category,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("1800"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=3,
        start_date=date(2025, 1, 1),
        active=True,
        is_bill=True,
    )
    full = build_timeline_calendar(
        user,
        start_date=AS_OF,
        end_date=END_6M,
        account_id=checking.id,
        as_of_date=AS_OF,
        projection_only=True,
    )
    windows = calendar_chunk_windows(AS_OF, END_6M, AS_OF)
    merged = []
    prev_continuation = None
    for start, end in windows:
        chunk = calendar_chunk_payload(full, start, end)
        if prev_continuation is not None:
            assert chunk["days"], "chunk should include days"
            assert prev_continuation["end_date"] < chunk["days"][0]["date"]
        merged.extend(chunk["days"])
        prev_continuation = chunk["continuation"]
        assert chunk["continuation"]["balances_by_account"]

    assert [_comparable_day(d) for d in merged] == [
        _comparable_day(d) for d in full["days"]
    ]
    summary = calendar_summary_payload(full)["summary"]
    assert "days" not in calendar_summary_payload(full)
    lowest_day = _day_index(full["days"])[summary["lowest_balance_date"]]
    assert lowest_day["lowest_balance"] == summary["lowest_balance"]
    best_day = _day_index(full["days"])[summary["best_balance_date"]]
    assert best_day["ending_balance"] == summary["best_balance"]
    risk_day = _day_index(full["days"])[summary["next_risk_date"]] if summary["next_risk_date"] else None
    if risk_day is not None:
        assert risk_day["has_risk"] is True
    income_from_days = sum(
        Decimal(d["income_total"])
        for d in full["days"]
        if d["date"] >= AS_OF.isoformat()
    )
    assert Decimal(summary["total_income"]) == income_from_days.quantize(Decimal("0.01"))


def test_transfer_spans_chunk_boundary(user, household, checking, savings, transfer_category):
    boundary = date(2025, 7, 31)
    create_transfer(
        user,
        checking.id,
        savings.id,
        Decimal("250"),
        boundary,
        payee="Boundary transfer",
    )
    RecurringRule.objects.create(
        household=household,
        name="Weekly savings",
        account=checking,
        category=transfer_category,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("50"),
        currency="USD",
        frequency=RecurringRule.Frequency.WEEKLY,
        interval=1,
        day_of_week=2,
        start_date=date(2025, 1, 1),
        active=True,
        transfer_to_account=savings,
    )
    full = build_timeline_calendar(
        user,
        start_date=AS_OF,
        end_date=END_6M,
        as_of_date=AS_OF,
        projection_only=True,
    )
    windows = calendar_chunk_windows(AS_OF, END_6M, AS_OF)
    assert windows[0][1] == boundary
    first = calendar_chunk_payload(full, *windows[0])
    second = calendar_chunk_payload(full, *windows[1])
    boundary_day = _day_index(first["days"])[boundary.isoformat()]
    assert Decimal(boundary_day["net_total"]) == Decimal("0")
    assert Decimal(boundary_day["transfer_total"]) > 0
    first_end_balances = first["continuation"]["balances_by_account"]
    second_first = second["days"][0]
    # Combined cash ending on the boundary equals first-chunk continuation.
    checking_end = Decimal(first_end_balances[str(checking.id)])
    savings_end = Decimal(first_end_balances[str(savings.id)])
    assert checking_end + savings_end == Decimal(boundary_day["ending_balance"])
    assert second_first["date"] == (boundary + timedelta(days=1)).isoformat()
    assert [_comparable_day(d) for d in first["days"] + second["days"]] == [
        _comparable_day(d)
        for d in full["days"]
        if d["date"] <= second["end_date"]
    ]


def test_recurring_rules_are_not_duplicated_across_chunks(
    user, household, checking, savings, card, income_category, expense_category, transfer_category
):
    RecurringRule.objects.create(
        household=household,
        name="Paycheck",
        account=checking,
        category=income_category,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("2000"),
        currency="USD",
        frequency=RecurringRule.Frequency.WEEKLY,
        interval=1,
        day_of_week=4,
        start_date=date(2025, 1, 1),
        active=True,
    )
    RecurringRule.objects.create(
        household=household,
        name="Every two weeks",
        account=checking,
        category=expense_category,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("80"),
        currency="USD",
        frequency=RecurringRule.Frequency.WEEKLY,
        interval=2,
        day_of_week=1,
        start_date=date(2025, 1, 1),
        active=True,
    )
    RecurringRule.objects.create(
        household=household,
        name="Rent",
        account=checking,
        category=expense_category,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("1500"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=5,
        start_date=date(2025, 1, 1),
        active=True,
        is_bill=True,
    )
    RecurringRule.objects.create(
        household=household,
        name="To savings",
        account=checking,
        category=transfer_category,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("100"),
        currency="USD",
        frequency=RecurringRule.Frequency.WEEKLY,
        interval=1,
        day_of_week=3,
        start_date=date(2025, 1, 1),
        active=True,
        transfer_to_account=savings,
    )
    RecurringRule.objects.create(
        household=household,
        name="Card payment",
        account=checking,
        category=transfer_category,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("75"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=12,
        start_date=date(2025, 1, 1),
        active=True,
        transfer_to_account=card,
    )
    full = build_timeline_calendar(
        user,
        start_date=AS_OF,
        end_date=END_6M,
        as_of_date=AS_OF,
        projection_only=True,
    )
    merged_txn_ids = []
    for start, end in calendar_chunk_windows(AS_OF, END_6M, AS_OF):
        chunk = calendar_chunk_payload(full, start, end)
        for day in chunk["days"]:
            for txn in day["transactions"]:
                merged_txn_ids.append((day["date"], txn.get("id"), txn.get("description"), txn.get("amount")))
    full_txn_ids = []
    for day in full["days"]:
        for txn in day["transactions"]:
            full_txn_ids.append((day["date"], txn.get("id"), txn.get("description"), txn.get("amount")))
    assert merged_txn_ids == full_txn_ids
    assert len(merged_txn_ids) == len(set(merged_txn_ids))


def test_scenario_chunking_does_not_persist_to_base(
    user, household, checking, income_category
):
    RecurringRule.objects.create(
        household=household,
        name="Paycheck",
        account=checking,
        category=income_category,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("1000"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=15,
        start_date=date(2025, 1, 1),
        active=True,
    )
    scenario = Scenario.objects.create(household=household, name="Bonus")
    event_date = date(2025, 10, 10)
    ScenarioOneTimeEvent.objects.create(
        scenario=scenario,
        date=event_date,
        account=checking,
        description="Signing bonus",
        direction=ScenarioOneTimeEvent.Direction.INCOME,
        amount=Decimal("5000"),
    )
    base = build_timeline_calendar(
        user,
        start_date=AS_OF,
        end_date=END_6M,
        account_id=checking.id,
        as_of_date=AS_OF,
        projection_only=True,
    )
    what_if = build_timeline_calendar(
        user,
        start_date=AS_OF,
        end_date=END_6M,
        account_id=checking.id,
        scenario_id=scenario.id,
        as_of_date=AS_OF,
        projection_only=True,
    )
    windows = calendar_chunk_windows(AS_OF, END_6M, AS_OF)
    oct_window = next(w for w in windows if w[0] <= event_date <= w[1])
    base_oct = calendar_chunk_payload(base, *oct_window)
    scenario_oct = calendar_chunk_payload(what_if, *oct_window)
    base_day = _day_index(base_oct["days"])[event_date.isoformat()]
    scenario_day = _day_index(scenario_oct["days"])[event_date.isoformat()]
    assert Decimal(scenario_day["income_total"]) - Decimal(base_day["income_total"]) == Decimal("5000")
    assert not Transaction.objects.filter(payee="Signing bonus").exists()
    later_base = build_timeline_calendar(
        user,
        start_date=AS_OF,
        end_date=END_6M,
        account_id=checking.id,
        as_of_date=AS_OF,
        projection_only=True,
    )
    assert _day_index(later_base["days"])[event_date.isoformat()]["income_total"] == base_day["income_total"]


def test_future_edit_invalidates_later_chunks(user, household, checking, expense_category):
    RecurringRule.objects.create(
        household=household,
        name="Rent",
        account=checking,
        category=expense_category,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("100"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=20,
        start_date=date(2025, 1, 1),
        active=True,
    )
    future = post_transaction(
        user, checking.id, date(2025, 6, 10), "Future bill", Decimal("-200")
    )
    reset_build_timeline_count()
    first = get_or_build_canonical_calendar(
        user,
        start_date=AS_OF,
        end_date=END_6M,
        account_id=checking.id,
        household_id=household.id,
        as_of_date=AS_OF,
        projection_only=True,
    )
    assert get_build_timeline_count() == 1
    windows = calendar_chunk_windows(AS_OF, END_6M, AS_OF)
    later = calendar_chunk_payload(first, *windows[1])
    later_end_before = later["days"][-1]["ending_balance"]
    june_before = _day_index(first["days"])["2025-06-10"]["ending_balance"]

    future.amount = Decimal("-350")
    future.save(update_fields=["amount"])
    invalidate_financial_cache_for_household(household.id)

    reset_build_timeline_count()
    refreshed = get_or_build_canonical_calendar(
        user,
        start_date=AS_OF,
        end_date=END_6M,
        account_id=checking.id,
        household_id=household.id,
        as_of_date=AS_OF,
        projection_only=True,
    )
    assert get_build_timeline_count() == 1
    later_after = calendar_chunk_payload(refreshed, *windows[1])
    june_after = _day_index(refreshed["days"])["2025-06-10"]["ending_balance"]
    assert Decimal(june_after) == Decimal(june_before) - Decimal("150")
    assert Decimal(later_after["days"][-1]["ending_balance"]) == Decimal(later_end_before) - Decimal(
        "150"
    )


def test_cached_chunks_do_not_rebuild_timeline(user, household, checking):
    reset_build_timeline_count()
    first = get_or_build_canonical_calendar(
        user,
        start_date=AS_OF,
        end_date=END_6M,
        account_id=checking.id,
        household_id=household.id,
        as_of_date=AS_OF,
        projection_only=True,
    )
    assert get_build_timeline_count() == 1
    reset_build_timeline_count()
    second = get_or_build_canonical_calendar(
        user,
        start_date=AS_OF,
        end_date=END_6M,
        account_id=checking.id,
        household_id=household.id,
        as_of_date=AS_OF,
        projection_only=True,
    )
    assert get_build_timeline_count() == 0
    assert first["summary"] == second["summary"]
    windows = calendar_chunk_windows(AS_OF, END_6M, AS_OF)
    chunk_a = calendar_chunk_payload(second, *windows[0])
    chunk_b = calendar_chunk_payload(second, *windows[1])
    assert chunk_a["days"][0]["date"] == AS_OF.isoformat()
    assert chunk_b["days"][0]["date"] > chunk_a["end_date"]
    assert "days" not in calendar_summary_payload(second)
    summary_json = json.dumps(calendar_summary_payload(second), default=str)
    full_json = json.dumps({"days": second["days"]}, default=str)
    assert len(summary_json) < len(full_json) / 10


@pytest.mark.django_db
def test_summary_and_chunk_api(api_client, user, household, checking, income_category):
    RecurringRule.objects.create(
        household=household,
        name="Paycheck",
        account=checking,
        category=income_category,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("100"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=10,
        start_date=date(2025, 1, 1),
        active=True,
    )
    api_client.force_authenticate(user=user)
    params = {
        "start": AS_OF.isoformat(),
        "end": END_6M.isoformat(),
        "as_of": AS_OF.isoformat(),
        "account_id": str(checking.id),
        "household_id": str(household.id),
    }
    summary_res = api_client.get("/api/timeline/calendar/summary/", params)
    assert summary_res.status_code == 200
    summary = summary_res.json()
    assert "days" not in summary
    assert summary["start_date"] == AS_OF.isoformat()
    assert summary["end_date"] == END_6M.isoformat()
    assert "lowest_balance" in summary["summary"]

    windows = calendar_chunk_windows(AS_OF, END_6M, AS_OF)
    reset_build_timeline_count()
    with CaptureQueriesContext(connection) as ctx:
        chunk_res = api_client.get(
            "/api/timeline/calendar/chunk/",
            {
                **params,
                "chunk_start": windows[0][0].isoformat(),
                "chunk_end": windows[0][1].isoformat(),
            },
        )
    assert chunk_res.status_code == 200
    chunk = chunk_res.json()
    assert chunk["days"]
    assert chunk["days"][-1]["date"] <= windows[0][1].isoformat()
    assert "_account_balances" not in chunk["days"][0]
    assert "continuation" in chunk
    assert get_build_timeline_count() == 0
    assert len(ctx.captured_queries) < 20


def test_calendar_query_count_does_not_add_per_day_tax(user, household, checking):
    """Calendar walk adds a roughly constant SQL overhead on top of build_timeline."""
    short_end = AS_OF + timedelta(days=30)
    long_end = AS_OF + timedelta(days=180)
    with CaptureQueriesContext(connection) as short_ctx:
        build_timeline_calendar(
            user,
            start_date=AS_OF,
            end_date=short_end,
            account_id=checking.id,
            as_of_date=AS_OF,
            projection_only=True,
        )
    with CaptureQueriesContext(connection) as long_ctx:
        build_timeline_calendar(
            user,
            start_date=AS_OF,
            end_date=long_end,
            account_id=checking.id,
            as_of_date=AS_OF,
            projection_only=True,
        )
    # Extra days may add Python work inside build_timeline, but a new per-day
    # N+1 would push this well above two queries per extra day.
    extra_days = (long_end - short_end).days
    delta = len(long_ctx.captured_queries) - len(short_ctx.captured_queries)
    assert extra_days > 0
    assert delta / extra_days < 3
