"""Transactions ledger: narrow projection must not scale with History Range."""
from __future__ import annotations

import time
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import Account
from categories.models import Category
from common.services.profiler import get_build_timeline_count, reset_build_timeline_count
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule
from timeline.services import ledger as ledger_mod
from timeline.services.ledger import build_timeline
from transactions.models import Transaction
from transactions.services.posting import post_transaction

User = get_user_model()
AS_OF = date.today()
FORECAST_END = AS_OF + timedelta(days=180)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="txnprojeff", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Txn Projection HH")
    HouseholdMembership.objects.create(
        household=h, user=user, role=HouseholdMembership.Role.OWNER
    )
    return h


@pytest.fixture
def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _seed_ledger(user, household) -> Account:
    expense = Category.objects.create(
        household=household,
        name="Utilities",
        category_type=Category.CategoryType.EXPENSE,
        sort_order=1,
    )
    income = Category.objects.create(
        household=household,
        name="Paycheck",
        category_type=Category.CategoryType.INCOME,
        sort_order=2,
    )
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main",
        starting_balance=Decimal("2500.00"),
        currency="USD",
        include_in_forecast=True,
    )
    for i in range(12):
        month_date = (AS_OF.replace(day=1) - timedelta(days=30 * i)).replace(day=min(AS_OF.day, 28))
        post_transaction(
            user=user,
            account_id=checking.id,
            date=month_date,
            payee=f"Posted grocery {i}",
            amount=Decimal("-40.00"),
            category_id=expense.id,
        )
    RecurringRule.objects.create(
        household=household,
        name="Rent",
        account=checking,
        category=expense,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("1200.00"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=min(AS_OF.day + 5, 28),
        start_date=AS_OF - timedelta(days=400),
        active=True,
    )
    RecurringRule.objects.create(
        household=household,
        name="Paycheck",
        account=checking,
        category=income,
        direction=RecurringRule.Direction.INCOME,
        amount=Decimal("2400.00"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=1,
        start_date=AS_OF - timedelta(days=400),
        active=True,
    )
    overdue_rule = RecurringRule.objects.create(
        household=household,
        name="Overdue electric",
        account=checking,
        category=expense,
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("85.00"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=min(AS_OF.day, 28),
        start_date=AS_OF - timedelta(days=400),
        active=True,
    )
    Transaction.objects.create(
        account=checking,
        date=AS_OF - timedelta(days=12),
        payee="Overdue electric",
        amount=Decimal("-85.00"),
        category=expense,
        status=Transaction.Status.PLANNED,
        source=Transaction.Source.RULE,
        rule=overdue_rule,
    )
    return checking


def _occurrence_span(monkeypatch):
    spans: list[tuple[date, date, int]] = []
    orig = ledger_mod.generate_rule_occurrence_dates

    def wrapped(rule, start_date, end_date, **kwargs):
        dates = orig(rule, start_date, end_date, **kwargs)
        spans.append((start_date, end_date, len(dates)))
        return dates

    monkeypatch.setattr(ledger_mod, "generate_rule_occurrence_dates", wrapped)
    return spans


def _future_key(row: dict) -> tuple:
    return (
        row["date"],
        row.get("account_id"),
        str(row.get("amount")),
        (row.get("description") or "")[:40],
        row.get("rule_id"),
    )


def test_narrow_projection_omits_posted_history_keeps_overdue_pending(user, household, monkeypatch):
    checking = _seed_ledger(user, household)
    cache.clear()
    spans = _occurrence_span(monkeypatch)
    wide_start = AS_OF - timedelta(days=365)

    reset_build_timeline_count()
    wide_t0 = time.perf_counter()
    with CaptureQueriesContext(connection) as wide_ctx:
        wide = build_timeline(
            user,
            wide_start,
            FORECAST_END,
            account_id=checking.id,
            as_of_date=AS_OF,
            projection_only=True,
            exclude_reconciled_past=True,
            caller="transactions_wide_history",
        )
    wide_ms = (time.perf_counter() - wide_t0) * 1000
    wide_occ = sum(n for _, _, n in spans)
    wide_sql = len(wide_ctx.captured_queries)
    spans.clear()

    reset_build_timeline_count()
    narrow_t0 = time.perf_counter()
    with CaptureQueriesContext(connection) as narrow_ctx:
        narrow = build_timeline(
            user,
            AS_OF,
            FORECAST_END,
            account_id=checking.id,
            as_of_date=AS_OF,
            projection_only=True,
            exclude_reconciled_past=True,
            caller="transactions_narrow_projection",
        )
    narrow_ms = (time.perf_counter() - narrow_t0) * 1000
    narrow_occ = sum(n for _, _, n in spans)
    narrow_sql = len(narrow_ctx.captured_queries)

    posted_old = [
        r
        for r in narrow
        if r.get("account_id") == checking.id
        and "Posted grocery" in (r.get("description") or "")
        and r["date"] < AS_OF
    ]
    overdue = [
        r
        for r in narrow
        if r.get("account_id") == checking.id
        and "Overdue electric" in (r.get("description") or "")
        and r["date"] < AS_OF
    ]
    assert posted_old == [], "ordinary posted history must not be reconstructed in the projection"
    assert overdue, "overdue unmatched planned rows must remain in the projection"

    wide_future = {
        _future_key(r): Decimal(str(r["running_balance"]))
        for r in wide
        if r.get("account_id") == checking.id and r["date"] > AS_OF
    }
    narrow_future = {
        _future_key(r): Decimal(str(r["running_balance"]))
        for r in narrow
        if r.get("account_id") == checking.id and r["date"] > AS_OF
    }
    shared = set(wide_future) & set(narrow_future)
    assert shared, "expected overlapping future projection rows"
    for key in shared:
        assert wide_future[key] == narrow_future[key], (
            f"running balance mismatch for {key}: wide={wide_future[key]} narrow={narrow_future[key]}"
        )

    assert narrow_occ <= wide_occ
    assert (wide_start, FORECAST_END) not in {(s, e) for s, e, _ in spans}
    for start, end, _ in spans:
        assert start >= AS_OF
        assert end == FORECAST_END

    print(
        "\nTRANSACTIONS_PROJECTION_PROFILE "
        f"wide_rows={len(wide)} wide_occ={wide_occ} wide_sql={wide_sql} wide_ms={wide_ms:.0f} "
        f"narrow_rows={len(narrow)} narrow_occ={narrow_occ} narrow_sql={narrow_sql} "
        f"narrow_ms={narrow_ms:.0f} overdue={len(overdue)} shared_future={len(shared)}"
    )


def test_history_range_does_not_change_projection_work(user, household, auth_client, monkeypatch):
    checking = _seed_ledger(user, household)
    cache.clear()
    params = {
        "start": AS_OF.isoformat(),
        "end": FORECAST_END.isoformat(),
        "as_of": AS_OF.isoformat(),
        "account_id": checking.id,
        "exclude_reconciled_past": "true",
    }
    spans = _occurrence_span(monkeypatch)
    reset_build_timeline_count()
    with CaptureQueriesContext(connection) as ctx:
        res = auth_client.get("/api/timeline/", params)
    assert res.status_code == 200, res.content
    occ_first = sum(n for _, _, n in spans)
    sql_first = len(ctx.captured_queries)
    builds_first = get_build_timeline_count()
    rows_first = len(res.json().get("timeline") or [])

    # A longer History Range only hits /transactions/, not a wider forecast start.
    one_month_after = (AS_OF - timedelta(days=30)).isoformat()
    twelve_month_after = (AS_OF - timedelta(days=365)).isoformat()
    with CaptureQueriesContext(connection) as txn_1m:
        r1 = auth_client.get(
            "/api/transactions/",
            {
                "account": checking.id,
                "date_after": one_month_after,
                "date_before": AS_OF.isoformat(),
                "page_size": 2000,
                "reconciled": "false",
            },
        )
    with CaptureQueriesContext(connection) as txn_12m:
        r12 = auth_client.get(
            "/api/transactions/",
            {
                "account": checking.id,
                "date_after": twelve_month_after,
                "date_before": AS_OF.isoformat(),
                "page_size": 2000,
                "reconciled": "false",
            },
        )
    assert r1.status_code == 200
    assert r12.status_code == 200
    n1 = len(r1.json().get("results") or [])
    n12 = len(r12.json().get("results") or [])
    assert n12 >= n1

    cache.clear()
    spans.clear()
    reset_build_timeline_count()
    with CaptureQueriesContext(connection) as ctx2:
        res2 = auth_client.get("/api/timeline/", params)
    assert res2.status_code == 200
    occ_second = sum(n for _, _, n in spans)
    assert occ_second == occ_first
    assert get_build_timeline_count() == builds_first
    assert abs(len(ctx2.captured_queries) - sql_first) <= 8
    assert len(res2.json().get("timeline") or []) == rows_first
    print(
        "\nTRANSACTIONS_HISTORY_RANGE_PROFILE "
        f"txn_1m_rows={n1} txn_1m_sql={len(txn_1m.captured_queries)} "
        f"txn_12m_rows={n12} txn_12m_sql={len(txn_12m.captured_queries)} "
        f"timeline_occ={occ_first} timeline_sql={sql_first} timeline_rows={rows_first}"
    )


def test_thirty_day_forecast_is_smaller_than_six_month(user, household, monkeypatch):
    """Operational 30-day window must not generate a full 6-month timeline."""
    checking = _seed_ledger(user, household)
    cache.clear()
    end_30 = AS_OF + timedelta(days=30)
    end_180 = AS_OF + timedelta(days=180)

    spans = _occurrence_span(monkeypatch)
    reset_build_timeline_count()
    t0 = time.perf_counter()
    with CaptureQueriesContext(connection) as ctx30:
        rows_30 = build_timeline(
            user,
            AS_OF,
            end_30,
            account_id=checking.id,
            as_of_date=AS_OF,
            projection_only=True,
            exclude_reconciled_past=True,
            caller="forecast_window_30",
        )
    ms_30 = (time.perf_counter() - t0) * 1000
    occ_30 = sum(n for _, _, n in spans)
    sql_30 = len(ctx30.captured_queries)
    future_30 = [
        r for r in rows_30 if str(r.get("date") or "")[:10] >= AS_OF.isoformat()
    ]
    spans.clear()

    reset_build_timeline_count()
    t1 = time.perf_counter()
    with CaptureQueriesContext(connection) as ctx180:
        rows_180 = build_timeline(
            user,
            AS_OF,
            end_180,
            account_id=checking.id,
            as_of_date=AS_OF,
            projection_only=True,
            exclude_reconciled_past=True,
            caller="forecast_window_180",
        )
    ms_180 = (time.perf_counter() - t1) * 1000
    occ_180 = sum(n for _, _, n in spans)
    sql_180 = len(ctx180.captured_queries)
    future_180 = [
        r for r in rows_180 if str(r.get("date") or "")[:10] >= AS_OF.isoformat()
    ]

    dates_30 = [str(r.get("date") or "")[:10] for r in future_30]
    dates_180 = [str(r.get("date") or "")[:10] for r in future_180]
    assert dates_30
    assert max(dates_30) <= end_30.isoformat()
    assert any(d > end_30.isoformat() for d in dates_180)
    assert len(future_30) < len(future_180)
    assert occ_30 < occ_180
    print(
        "\nFORECAST_WINDOW_ROW_PROFILE "
        f"BEFORE 6-month forecast: {len(future_180)} projected rows "
        f"occ={occ_180} sql={sql_180} ms={ms_180:.0f} | "
        f"AFTER 30-day forecast: {len(future_30)} projected rows "
        f"occ={occ_30} sql={sql_30} ms={ms_30:.0f}"
    )
