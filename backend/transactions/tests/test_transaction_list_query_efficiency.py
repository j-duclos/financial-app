"""Historical transaction list must not N+1 as row count grows."""
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
from transactions.services.posting import create_transfer, post_transaction

User = get_user_model()
AS_OF = date.today()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="txnlistn1", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Txn List N+1 HH")
    HouseholdMembership.objects.create(
        household=h, user=user, role=HouseholdMembership.Role.OWNER
    )
    return h


@pytest.fixture
def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _seed_rows(user, household, n: int) -> Account:
    expense, _ = Category.objects.get_or_create(
        household=household,
        name="TxnListGroceries",
        category_type=Category.CategoryType.EXPENSE,
        defaults={"sort_order": 1},
    )
    checking = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        role=Account.AccountRole.SPENDING,
        name="Main",
        starting_balance=Decimal("4000.00"),
        currency="USD",
    )
    savings = Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        role=Account.AccountRole.SAVINGS,
        name="Savings",
        starting_balance=Decimal("1000.00"),
        currency="USD",
    )
    for i in range(n):
        post_transaction(
            user=user,
            account_id=checking.id,
            date=AS_OF - timedelta(days=(i % 200) + 1),
            payee=f"Store {i}",
            amount=Decimal("-12.50"),
            category_id=expense.id,
        )
    create_transfer(
        user=user,
        from_account_id=checking.id,
        to_account_id=savings.id,
        amount=Decimal("50.00"),
        transfer_date=AS_OF - timedelta(days=3),
        payee="Move to savings",
    )
    return checking


def test_transaction_list_query_count_does_not_scale_with_rows(user, household, auth_client):
    checking = _seed_rows(user, household, n=40)
    params = {
        "account": checking.id,
        "date_after": (AS_OF - timedelta(days=400)).isoformat(),
        "date_before": AS_OF.isoformat(),
        "page_size": 2000,
    }
    with CaptureQueriesContext(connection) as small:
        res = auth_client.get("/api/transactions/", params)
    assert res.status_code == 200, res.content
    small_n = len(res.json().get("results") or [])
    small_sql = len(small.captured_queries)
    assert small_n >= 40

    expense = Category.objects.get(household=household, name="TxnListGroceries")
    for i in range(80):
        post_transaction(
            user=user,
            account_id=checking.id,
            date=AS_OF - timedelta(days=(i % 180) + 1),
            payee=f"Extra {i}",
            amount=Decimal("-8.00"),
            category_id=expense.id,
        )
    with CaptureQueriesContext(connection) as large:
        res2 = auth_client.get("/api/transactions/", params)
    assert res2.status_code == 200
    large_n = len(res2.json().get("results") or [])
    large_sql = len(large.captured_queries)
    assert large_n > small_n
    assert large_sql <= small_sql + 6, (
        f"transaction list SQL grew with row count: {small_sql} -> {large_sql} "
        f"(rows {small_n} -> {large_n})"
    )
    print(
        "\nTRANSACTIONS_LIST_QUERY_PROFILE "
        f"small_rows={small_n} small_sql={small_sql} "
        f"large_rows={large_n} large_sql={large_sql}"
    )
