"""Calendar SQL/CPU efficiency: N+1 bounds and before/after profiling."""
from __future__ import annotations

import json
import time
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext

from accounts.models import Account
from categories.models import Category
from common.services.profiler import get_build_timeline_count, reset_build_timeline_count
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule
from timeline.services.calendar import build_timeline_calendar
from transactions.services.posting import post_transaction

User = get_user_model()
AS_OF = date(2025, 6, 1)
WRITE_SQL = ("INSERT", "UPDATE", "DELETE")
FINANCIAL_TABLE_NEEDLES = (
    "accounts_account",
    "transactions_transaction",
    "timeline_recurringrule",
    "goals_",
    "buckets_",
)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="caleff", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Cal Efficiency HH")
    HouseholdMembership.objects.create(
        household=h, user=user, role=HouseholdMembership.Role.OWNER
    )
    return h


def _make_checking(household, name: str, starting: str = "2000") -> Account:
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name=name,
        starting_balance=Decimal(starting),
        minimum_buffer=Decimal("200"),
        currency="USD",
        include_in_forecast=True,
    )


def _make_card(household, name: str) -> Account:
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name=name,
        credit_limit=Decimal("5000"),
        starting_balance=Decimal("-800"),
        current_balance=Decimal("800"),
        apr=Decimal("19.99"),
        currency="USD",
        include_in_forecast=True,
    )


def _make_savings(household) -> Account:
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        name="Savings",
        starting_balance=Decimal("8000"),
        minimum_buffer=Decimal("500"),
        currency="USD",
        include_in_forecast=True,
    )


def seed_calendar_fixture(
    user,
    household,
    *,
    n_checking: int,
    n_cards: int,
    n_bills: int,
) -> dict[str, list]:
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
    checkings = [_make_checking(household, f"Checking {i}") for i in range(n_checking)]
    cards = [_make_card(household, f"Card {i}") for i in range(n_cards)]
    savings = _make_savings(household)
    bills = []
    if checkings:
        RecurringRule.objects.create(
            household=household,
            name="Paycheck",
            account=checkings[0],
            category=income,
            direction=RecurringRule.Direction.INCOME,
            amount=Decimal("2400"),
            currency="USD",
            frequency=RecurringRule.Frequency.MONTHLY_DAY,
            interval=1,
            day_of_month=1,
            start_date=date(2025, 1, 1),
            active=True,
        )
        for i in range(n_bills):
            bills.append(
                RecurringRule.objects.create(
                    household=household,
                    name=f"Bill {i}",
                    account=checkings[i % len(checkings)],
                    category=expense,
                    direction=RecurringRule.Direction.EXPENSE,
                    amount=Decimal("120"),
                    currency="USD",
                    frequency=RecurringRule.Frequency.MONTHLY_DAY,
                    interval=1,
                    day_of_month=5 + (i % 20),
                    start_date=date(2025, 1, 1),
                    active=True,
                    is_bill=True,
                    payment_flexibility_days=3,
                )
            )
        if savings:
            RecurringRule.objects.create(
                household=household,
                name="To savings",
                account=checkings[0],
                category=expense,
                direction=RecurringRule.Direction.EXPENSE,
                amount=Decimal("200"),
                currency="USD",
                frequency=RecurringRule.Frequency.WEEKLY,
                interval=1,
                day_of_week=2,
                start_date=date(2025, 1, 1),
                active=True,
                transfer_to_account=savings,
            )
    for acc in checkings:
        post_transaction(user, acc.id, AS_OF, f"{acc.name} txn", Decimal("-25"))
    return {
        "checkings": checkings,
        "cards": cards,
        "bills": bills,
        "savings": [savings],
    }


def _financial_writes(queries) -> list[str]:
    out = []
    for q in queries:
        sql = q["sql"].strip()
        verb = sql.split(None, 1)[0].upper() if sql else ""
        if verb not in WRITE_SQL:
            continue
        low = sql.lower()
        if any(needle in low for needle in FINANCIAL_TABLE_NEEDLES):
            out.append(sql)
    return out


def test_profile_calendar_query_counts(user, household, monkeypatch, capsys):
    seed_calendar_fixture(user, household, n_checking=5, n_cards=3, n_bills=12)

    import accounts.services.available_to_spend as ats
    import timeline.services.calendar as cal

    counters = {
        "forecast_account": 0,
        "forecast_batch": 0,
        "bulk_opening": 0,
    }
    orig_account = ats.calculate_account_forecast_summary
    orig_batch = ats._calculate_forecast_summaries_for_accounts
    orig_bulk = cal.bulk_signed_ledger_balances

    def wrapped_account(*args, **kwargs):
        counters["forecast_account"] += 1
        return orig_account(*args, **kwargs)

    def wrapped_batch(*args, **kwargs):
        counters["forecast_batch"] += 1
        return orig_batch(*args, **kwargs)

    def wrapped_bulk(*args, **kwargs):
        counters["bulk_opening"] += 1
        return orig_bulk(*args, **kwargs)

    monkeypatch.setattr(ats, "calculate_account_forecast_summary", wrapped_account)
    monkeypatch.setattr(ats, "_calculate_forecast_summaries_for_accounts", wrapped_batch)
    monkeypatch.setattr(cal, "bulk_signed_ledger_balances", wrapped_bulk)

    cache.clear()
    reset_build_timeline_count()
    end = AS_OF + timedelta(days=180)
    start = time.perf_counter()
    with CaptureQueriesContext(connection) as ctx:
        result = build_timeline_calendar(
            user,
            start_date=AS_OF,
            end_date=end,
            as_of_date=AS_OF,
        )
    elapsed_ms = (time.perf_counter() - start) * 1000
    payload = json.dumps(result, default=str)
    print(
        "\nCALENDAR_QUERY_PROFILE "
        f"sql={len(ctx.captured_queries)} "
        f"elapsed_ms={elapsed_ms:.0f} "
        f"timeline_builds={get_build_timeline_count()} "
        f"forecast_account_calls={counters['forecast_account']} "
        f"forecast_batches={counters['forecast_batch']} "
        f"bulk_opening_calls={counters['bulk_opening']} "
        f"response_bytes={len(payload.encode('utf-8'))} "
        f"days={len(result['days'])}"
    )
    assert len(ctx.captured_queries) > 0
    assert result["days"]
    assert get_build_timeline_count() == 1
    assert counters["bulk_opening"] == 1
    assert counters["forecast_batch"] == 1
    assert counters["forecast_account"] == 0
    assert not hasattr(cal, "_rows_for_account")


def test_calendar_query_count_does_not_scale_linearly_with_accounts(db):
    small_user = User.objects.create_user(username="cal_small", password="x")
    small_hh = Household.objects.create(name="Small HH")
    HouseholdMembership.objects.create(
        household=small_hh, user=small_user, role=HouseholdMembership.Role.OWNER
    )
    seed_calendar_fixture(small_user, small_hh, n_checking=2, n_cards=1, n_bills=4)

    large_user = User.objects.create_user(username="cal_large", password="x")
    large_hh = Household.objects.create(name="Large HH")
    HouseholdMembership.objects.create(
        household=large_hh, user=large_user, role=HouseholdMembership.Role.OWNER
    )
    seed_calendar_fixture(large_user, large_hh, n_checking=6, n_cards=3, n_bills=4)

    end = AS_OF + timedelta(days=30)

    cache.clear()
    reset_build_timeline_count()
    with CaptureQueriesContext(connection) as small_ctx:
        small = build_timeline_calendar(
            small_user, start_date=AS_OF, end_date=end, as_of_date=AS_OF
        )
    small_builds = get_build_timeline_count()

    cache.clear()
    reset_build_timeline_count()
    with CaptureQueriesContext(connection) as large_ctx:
        large = build_timeline_calendar(
            large_user, start_date=AS_OF, end_date=end, as_of_date=AS_OF
        )
    large_builds = get_build_timeline_count()

    small_n = len(small_ctx.captured_queries)
    large_n = len(large_ctx.captured_queries)
    assert small["days"] and large["days"]
    assert small_builds == 1
    assert large_builds == 1
    # Opening balances and forecasts are batched; extra accounts must not add
    # a per-account query tax on the order of the account delta.
    assert large_n - small_n < 40
    assert large_n < small_n * 2.5


def test_account_date_grouping_does_not_rescan_full_timeline(user, household, monkeypatch):
    checkings = [_make_checking(household, f"Scan {i}") for i in range(4)]
    import timeline.services.calendar as cal

    orig = cal.is_superseded_planned_row
    scanned_lengths: list[int] = []

    def wrapped(row, account_rows):
        scanned_lengths.append(len(account_rows))
        return orig(row, account_rows)

    monkeypatch.setattr(cal, "is_superseded_planned_row", wrapped)

    rows = []
    for acc in checkings:
        for day_offset in range(80):
            day = AS_OF + timedelta(days=day_offset)
            rows.append(
                {
                    "date": day,
                    "account_id": acc.id,
                    "account_name": acc.name,
                    "description": f"{acc.name} planned",
                    "amount": Decimal("-10"),
                    "status": "PLANNED",
                    "source": "rule",
                    "rule_id": 1,
                    "transaction_id": None,
                    "category_name": "Rent",
                    "transaction_type": "EXPENSE",
                }
            )
            rows.append(
                {
                    "date": day,
                    "account_id": acc.id,
                    "account_name": acc.name,
                    "description": f"{acc.name} cleared",
                    "amount": Decimal("-10"),
                    "status": "CLEARED",
                    "source": "actual",
                    "rule_id": 1,
                    "transaction_id": 1000 + day_offset,
                    "category_name": "Rent",
                    "transaction_type": "EXPENSE",
                }
            )

    result = build_timeline_calendar(
        user,
        start_date=AS_OF,
        end_date=AS_OF + timedelta(days=90),
        as_of_date=AS_OF,
        timeline_rows=rows,
    )
    assert result["days"]
    assert scanned_lengths
    # Indexed by (account, date): each planned/cleared pair is a tiny bucket.
    assert max(scanned_lengths) <= 4
    assert sum(scanned_lengths) < len(rows) * 4
    assert not hasattr(cal, "_rows_for_account")


@pytest.mark.django_db
def test_calendar_get_does_not_write_financial_state(
    api_client, user, household
):
    seed_calendar_fixture(user, household, n_checking=2, n_cards=1, n_bills=2)
    api_client.force_authenticate(user=user)
    cache.clear()
    with CaptureQueriesContext(connection) as ctx:
        res = api_client.get(
            "/api/timeline/calendar/",
            {"horizon": "14d", "household_id": str(household.id)},
        )
    assert res.status_code == 200
    assert _financial_writes(ctx.captured_queries) == []
