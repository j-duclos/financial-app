"""Reconcile setup query count must not grow ~1 query per transaction row."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import Account
from categories.models import Category
from core.models import Household, HouseholdMembership
from transactions.services.posting import post_transaction

User = get_user_model()
AS_OF = date.today()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="reconcilen1", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Reconcile N+1 HH")
    HouseholdMembership.objects.create(
        household=h, user=user, role=HouseholdMembership.Role.OWNER
    )
    return h


@pytest.fixture
def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _seed(user, household, n: int) -> Account:
    expense, _ = Category.objects.get_or_create(
        household=household,
        name="ReconcileGroceries",
        category_type=Category.CategoryType.EXPENSE,
        defaults={"sort_order": 1},
    )
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Checking",
        starting_balance=Decimal("5000.00"),
        currency="USD",
    )
    start = AS_OF - timedelta(days=n + 1)
    for i in range(n):
        post_transaction(
            user=user,
            account_id=checking.id,
            date=start + timedelta(days=i + 1),
            payee=f"Store {i}",
            amount=Decimal("-12.50"),
            category_id=expense.id,
        )
    return checking


def _profile(client: APIClient, account_id: int) -> dict:
    params = {
        "account_id": account_id,
        "start": (AS_OF - timedelta(days=400)).isoformat(),
        "end": AS_OF.isoformat(),
    }
    connection.queries_log.clear()
    with CaptureQueriesContext(connection) as ctx:
        res = client.get("/api/reconcile/setup/", params)
    assert res.status_code == 200, res.content[:500]
    rows = res.json().get("unreconciled_transactions") or []
    return {
        "queries": len(ctx.captured_queries),
        "rows": len(rows),
        "sql": [q["sql"][:180] for q in ctx.captured_queries],
    }


def test_reconcile_setup_query_count_does_not_scale_with_rows(user, household, auth_client):
    checking = _seed(user, household, n=10)
    small = _profile(auth_client, checking.id)
    assert small["rows"] == 10

    expense = Category.objects.get(household=household, name="ReconcileGroceries")
    start = AS_OF - timedelta(days=120)
    for i in range(90):
        post_transaction(
            user=user,
            account_id=checking.id,
            date=start + timedelta(days=i),
            payee=f"Extra {i}",
            amount=Decimal("-8.00"),
            category_id=expense.id,
        )
    large = _profile(auth_client, checking.id)
    assert large["rows"] >= 100
    # Healing on GET can add a handful of queries; it must not add ~1 query per row.
    assert large["queries"] <= small["queries"] + 8, (
        f"reconcile setup SQL grew with row count: {small['queries']} -> {large['queries']} "
        f"(rows {small['rows']} -> {large['rows']})"
    )
    print(
        "\nRECONCILE_SETUP_QUERY_PROFILE "
        f"small_rows={small['rows']} small_sql={small['queries']} "
        f"large_rows={large['rows']} large_sql={large['queries']}"
    )
