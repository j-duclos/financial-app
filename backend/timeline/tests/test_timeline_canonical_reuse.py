"""Timeline endpoint reuses canonical forecast cache; balance_after is server-owned."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APIClient

from accounts.models import Account
from categories.models import Category
from common.services.profiler import get_build_timeline_count, reset_build_timeline_count
from core.models import Household, HouseholdMembership
from timeline.models import RecurringRule
from timeline.services.canonical_timeline_cache import get_or_build_canonical_forecast_timeline
from timeline.services.ledger_section_balances import (
    annotate_transactions_ledger_balance_after,
    signed_timeline_ledger_amount,
)
from transactions.services.posting import post_transaction

User = get_user_model()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="tl_user", password="pass1234")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="TL HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def main_checking(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Main",
        currency="USD",
        starting_balance=Decimal("1000.00"),
        include_in_forecast=True,
    )


@pytest.fixture
def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
def test_annotate_ledger_balance_after_continues_from_posted_ending():
    today = date(2026, 8, 26)
    rows = [
        {
            "date": date(2026, 8, 21),
            "description": "Chewy",
            "account_id": 1,
            "amount": Decimal("-79.46"),
            "type": "OUTFLOW",
            "status": "PLANNED",
            "source": "rule",
            "rule_id": 1,
            "transaction_id": None,
            "running_balance": Decimal("703.72"),
        },
        {
            "date": date(2026, 8, 27),
            "description": "Move",
            "account_id": 1,
            "amount": Decimal("-497.00"),
            "type": "OUTFLOW",
            "status": "PLANNED",
            "source": "rule",
            "rule_id": 2,
            "transaction_id": None,
            "running_balance": Decimal("-1406.40"),
        },
    ]
    annotate_transactions_ledger_balance_after(
        rows,
        account_id=1,
        as_of=today,
        posted_ending_balance=Decimal("81.15"),
    )
    assert rows[0]["balance_after"] == "1.69"
    assert rows[1]["balance_after"] == "-495.31"
    assert signed_timeline_ledger_amount(rows[0]) == Decimal("-79.46")


@pytest.mark.django_db
def test_annotate_same_day_order_matches_balance_walk():
    """Same-day Bal depends on (date, transaction_id, description) order."""
    today = date(2026, 8, 26)
    rows = [
        {
            "date": today,
            "description": "Zebra",
            "account_id": 1,
            "amount": Decimal("-10.00"),
            "type": "OUTFLOW",
            "status": "PLANNED",
            "source": "rule",
            "rule_id": 1,
            "transaction_id": 20,
            "running_balance": Decimal("990"),
        },
        {
            "date": today,
            "description": "Alpha",
            "account_id": 1,
            "amount": Decimal("-5.00"),
            "type": "OUTFLOW",
            "status": "PLANNED",
            "source": "rule",
            "rule_id": 2,
            "transaction_id": 10,
            "running_balance": Decimal("995"),
        },
    ]
    annotate_transactions_ledger_balance_after(
        rows,
        account_id=1,
        as_of=today,
        posted_ending_balance=Decimal("100.00"),
    )
    # Walk order: tid 10 Alpha first, then tid 20 Zebra
    by_tid = {r["transaction_id"]: r["balance_after"] for r in rows}
    assert by_tid[10] == "95.00"
    assert by_tid[20] == "85.00"


@pytest.mark.django_db
def test_timeline_endpoint_reuses_canonical_forecast_after_home(
    user, household, main_checking, auth_client
):
    today = date.today()
    end = today + timedelta(days=30)
    cache.clear()
    reset_build_timeline_count()

    get_or_build_canonical_forecast_timeline(
        user,
        today=today,
        forecast_days=30,
        household_id=household.id,
        caller="test_home",
    )
    builds_home = get_build_timeline_count()
    assert builds_home >= 1

    reset_build_timeline_count()
    r = auth_client.get(
        "/api/timeline/",
        {
            "start": today.isoformat(),
            "end": end.isoformat(),
            "as_of": today.isoformat(),
            "account_id": main_checking.pk,
            "household_id": household.id,
            "exclude_reconciled_past": "true",
        },
    )
    assert r.status_code == 200
    assert get_build_timeline_count() == 0
    assert r.headers.get("X-Canonical-Timeline") == "hit"
    assert r.headers.get("X-Timeline-Elapsed-Ms") is not None


@pytest.mark.django_db
def test_timeline_rejects_client_ledger_anchor(
    user, household, main_checking, auth_client
):
    """Clients must not override canonical server balance_after."""
    today = date.today()
    end = today + timedelta(days=14)
    cache.clear()
    r = auth_client.get(
        "/api/timeline/",
        {
            "start": today.isoformat(),
            "end": end.isoformat(),
            "as_of": today.isoformat(),
            "account_id": main_checking.pk,
            "household_id": household.id,
            "exclude_reconciled_past": "true",
            "ledger_anchor": "950.00",
        },
    )
    assert r.status_code == 400
    assert "ledger_anchor" in r.json()["detail"].lower()


@pytest.mark.django_db
def test_account_filter_preserves_transfer_legs_via_household_canonical(
    user, household, main_checking, auth_client
):
    """Canonical build is household-wide; account filter slices without a second build."""
    today = date.today()
    savings = Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        name="Savings",
        currency="USD",
        starting_balance=Decimal("100.00"),
        include_in_forecast=True,
    )
    transfer_cat, _ = Category.objects.get_or_create(
        household=household,
        name="Bank Transfer",
        category_type=Category.CategoryType.EXPENSE,
        defaults={"sort_order": 9},
    )
    transfer_dom = min(today.day + 3, 28)
    RecurringRule.objects.create(
        household=household,
        name="Move to Savings",
        account=main_checking,
        transfer_to_account=savings,
        category=transfer_cat,
        direction=RecurringRule.Direction.TRANSFER,
        amount=Decimal("50.00"),
        currency="USD",
        frequency=RecurringRule.Frequency.MONTHLY_DAY,
        interval=1,
        day_of_month=transfer_dom,
        start_date=today - timedelta(days=60),
        active=True,
    )
    cache.clear()
    reset_build_timeline_count()
    get_or_build_canonical_forecast_timeline(
        user,
        today=today,
        forecast_days=30,
        household_id=household.id,
        caller="test_home",
    )
    reset_build_timeline_count()
    r = auth_client.get(
        "/api/timeline/",
        {
            "start": today.isoformat(),
            "end": (today + timedelta(days=30)).isoformat(),
            "as_of": today.isoformat(),
            "account_id": main_checking.pk,
            "household_id": household.id,
            "exclude_reconciled_past": "true",
        },
    )
    assert r.status_code == 200
    assert get_build_timeline_count() == 0
    assert r.headers.get("X-Canonical-Timeline") == "hit"
    body = r.json()
    for row in body["timeline"]:
        assert row["account_id"] == main_checking.pk
    transfer_rows = [
        row
        for row in body["timeline"]
        if "Move to Savings" in (row.get("description") or "") or row.get("is_transfer")
    ]
    assert transfer_rows
    assert transfer_rows[0].get("balance_after") is not None