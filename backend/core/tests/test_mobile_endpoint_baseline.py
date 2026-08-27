"""
Mobile primary endpoint baseline — duration, payload size, SQL count, forecast builds.

Run: pytest core/tests/test_mobile_endpoint_baseline.py -s

Prints MOBILE_ENDPOINT_BASELINE rows for the completion report. Does not log financial values.
"""
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
from rest_framework.test import APIClient

from accounts.models import Account
from accounts.relationship_models import AccountRelationship
from categories.models import Category
from common.services.profiler import get_build_timeline_count, reset_build_timeline_count
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule
from transactions.models import Transaction
from transactions.services.posting import post_transaction

User = get_user_model()
AS_OF = date.today()
FORECAST_DAYS = 30

LIGHTWEIGHT_ACCOUNTS = "/api/accounts/?balance=true&page_size=500&active_only=true"
ENRICHED_ACCOUNTS = (
    "/api/accounts/?balance=true&forecast_summary=true&health=true"
    f"&days={FORECAST_DAYS}&page_size=500&active_only=true"
)


@pytest.fixture
def user(db):
    return User.objects.create_user(username="mobilebaseline", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Mobile Baseline HH")
    HouseholdMembership.objects.create(
        household=h, user=user, role=HouseholdMembership.Role.OWNER
    )
    return h


@pytest.fixture
def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _make_checking(household, name: str, starting: str = "1500") -> Account:
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name=name,
        starting_balance=Decimal(starting),
        minimum_buffer=Decimal("100"),
        currency="USD",
        include_in_forecast=True,
    )


def _make_card(household, name: str, owed: str = "400") -> Account:
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CREDIT,
        role=Account.AccountRole.CREDIT_CARD,
        name=name,
        credit_limit=Decimal("5000"),
        starting_balance=-Decimal(owed),
        current_balance=Decimal(owed),
        statement_balance=Decimal(owed),
        last_statement_date=AS_OF - timedelta(days=20),
        apr=Decimal("19.99"),
        payment_due_day=10,
        statement_closing_day=15,
        next_payment_due_date=AS_OF + timedelta(days=12),
        minimum_payment_amount=Decimal("25"),
        currency="USD",
        include_in_forecast=True,
    )


def seed_mobile_fixture(user, household) -> dict:
    checkings = [_make_checking(household, f"Checking {i}") for i in range(3)]
    cards = [_make_card(household, f"Card {i}") for i in range(2)]
    expense, _ = Category.objects.get_or_create(
        household=household,
        name="Groceries",
        category_type=Category.CategoryType.EXPENSE,
        defaults={"sort_order": 1},
    )
    for acc in checkings + cards:
        Transaction.objects.create(
            account=acc,
            date=AS_OF - timedelta(days=2),
            payee="Import",
            amount=Decimal("-12.34"),
            status=Transaction.Status.CLEARED,
            source=Transaction.Source.PLAID,
            import_match_status=Transaction.ImportMatchStatus.UNMATCHED,
        )
        for j in range(6):
            post_transaction(
                user,
                acc.id,
                AS_OF - timedelta(days=j + 1),
                f"{acc.name} txn {j}",
                Decimal("-11.50"),
                category_id=expense.id if acc.account_type == Account.AccountType.CHECKING else None,
            )
    if cards and checkings:
        AccountRelationship.objects.create(
            household=household,
            source_account=checkings[0],
            destination_account=cards[0],
            relationship_type=AccountRelationship.RelationshipType.CREDIT_CARD_PAYMENT,
            is_active=True,
        )
    checking = checkings[0]
    RecurringRule.objects.create(
        household=household,
        account=checking,
        name="Rent",
        direction=RecurringRule.Direction.EXPENSE,
        amount=Decimal("1200"),
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=1,
        start_date=AS_OF - timedelta(days=90),
        category=expense,
    )
    return {"checking": checking, "household": household}


def _profile_get(auth_client: APIClient, url: str) -> dict:
    cache.clear()
    reset_build_timeline_count()
    start = time.perf_counter()
    with CaptureQueriesContext(connection) as ctx:
        response = auth_client.get(url)
    elapsed_ms = (time.perf_counter() - start) * 1000
    assert response.status_code == 200, response.content
    body = response.content
    return {
        "url": url.split("?")[0],
        "status": response.status_code,
        "elapsed_ms": round(elapsed_ms, 1),
        "bytes": len(body),
        "sql": len(ctx.captured_queries),
        "timeline_builds": get_build_timeline_count(),
        "cache": response.get("X-Timeline-Cache")
        or response.get("X-Dashboard-Cache")
        or response.get("X-Cache"),
    }


def test_mobile_endpoint_baseline_table(auth_client, user, household, capsys):
    seeded = seed_mobile_fixture(user, household)
    hh_id = seeded["household"].id
    checking_id = seeded["checking"].id
    month = AS_OF.strftime("%Y-%m")
    timeline_start = AS_OF.isoformat()
    timeline_end = (AS_OF + timedelta(days=FORECAST_DAYS)).isoformat()
    cal_start = (AS_OF.replace(day=1)).isoformat()
    cal_end = (AS_OF + timedelta(days=60)).isoformat()

    endpoints = [
        ("dashboard_fast", f"/api/insights/dashboard/summary-fast/?forecast_days={FORECAST_DAYS}"),
        ("dashboard_details", f"/api/insights/dashboard/details/?forecast_days={FORECAST_DAYS}"),
        ("accounts_light", LIGHTWEIGHT_ACCOUNTS + f"&household={hh_id}"),
        ("accounts_enriched", ENRICHED_ACCOUNTS + f"&household={hh_id}"),
        (
            "transactions_page1",
            f"/api/transactions/?page=1&page_size=50&date_after={(AS_OF - timedelta(days=90)).isoformat()}&date_before={AS_OF.isoformat()}",
        ),
        (
            "timeline_projection",
            f"/api/timeline/?start={timeline_start}&end={timeline_end}&as_of={timeline_start}&exclude_reconciled_past=true",
        ),
        (
            "calendar_chunk",
            f"/api/timeline/calendar/chunk/?start={cal_start}&end={cal_end}&horizon=90&lookback_months=3&household_id={hh_id}&chunk_start={cal_start}&chunk_end={(AS_OF + timedelta(days=30)).isoformat()}",
        ),
        (
            "calendar_summary",
            f"/api/timeline/calendar/summary/?start={cal_start}&end={cal_end}&horizon=90&lookback_months=3&household_id={hh_id}",
        ),
        ("budget_summary", f"/api/spending-targets/summary/?household={hh_id}&anchor={AS_OF.isoformat()}"),
        ("reports_monthly", f"/api/insights/reports/monthly/?month={month}&household_id={hh_id}&months=12"),
    ]

    rows = []
    for label, url in endpoints:
        row = _profile_get(auth_client, url)
        row["label"] = label
        rows.append(row)

    print("\nMOBILE_ENDPOINT_BASELINE")
    print("| screen | endpoint | ms | bytes | sql | timeline_builds | cache |")
    print("| --- | --- | ---: | ---: | ---: | ---: | --- |")
    for row in rows:
        print(
            f"| {row['label']} | {row['url']} | {row['elapsed_ms']} | {row['bytes']} | "
            f"{row['sql']} | {row['timeline_builds']} | {row['cache'] or '-'} |"
        )

    enriched = next(r for r in rows if r["label"] == "accounts_enriched")
    light = next(r for r in rows if r["label"] == "accounts_light")
    assert enriched["timeline_builds"] <= 1
    assert enriched["sql"] >= light["sql"]
    assert all(r["status"] == 200 for r in rows)
    assert all(r["bytes"] > 0 for r in rows)
