"""Transactions list: reconciled history is excluded in SQL unless explicitly requested."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import Account
from transactions.models import Transaction
from transactions.services.posting import post_transaction

AS_OF = date(2026, 8, 16)


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def checking(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Main",
        currency="USD",
        starting_balance=Decimal("1000.00"),
    )


def _reconciled(account, d, payee, amount):
    return Transaction.objects.create(
        account=account,
        date=d,
        payee=payee,
        amount=amount,
        reconciled=True,
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
    )


@pytest.mark.django_db
def test_default_list_excludes_reconciled_server_side(api_client, user, checking):
    open_txn = post_transaction(
        user=user,
        account_id=checking.pk,
        date=date(2026, 8, 10),
        payee="Open",
        amount=Decimal("-10.00"),
    )
    closed_txn = _reconciled(checking, date(2026, 6, 1), "Closed", Decimal("-20.00"))
    api_client.force_authenticate(user=user)
    resp = api_client.get(
        "/api/transactions/",
        {
            "account": checking.id,
            "reconciled": "false",
            "date_before": AS_OF.isoformat(),
            "page_size": 2000,
        },
    )
    assert resp.status_code == 200
    ids = {r["id"] for r in resp.data["results"]}
    assert open_txn.id in ids
    assert closed_txn.id not in ids


@pytest.mark.django_db
def test_show_reconciled_returns_only_reconciled_in_range_plus_unreconciled(
    api_client, user, checking
):
    open_old = post_transaction(
        user=user,
        account_id=checking.pk,
        date=date(2026, 1, 15),
        payee="Old unreconciled",
        amount=Decimal("-5.00"),
    )
    in_range = _reconciled(checking, date(2026, 8, 1), "Recent closed", Decimal("-8.00"))
    out_of_range = Transaction.objects.create(
        account=checking,
        date=date(2026, 1, 2),
        payee="Ancient closed",
        amount=Decimal("-9.00"),
        reconciled=True,
        status=Transaction.Status.CLEARED,
        source=Transaction.Source.ACTUAL,
    )
    api_client.force_authenticate(user=user)
    after = (AS_OF - timedelta(days=30)).isoformat()
    resp = api_client.get(
        "/api/transactions/",
        {
            "account": checking.id,
            "show_reconciled": "true",
            "include_reconciled_after": after,
            "date_before": AS_OF.isoformat(),
            "page_size": 2000,
        },
    )
    assert resp.status_code == 200
    ids = {r["id"] for r in resp.data["results"]}
    assert open_old.id in ids
    assert in_range.id in ids
    assert out_of_range.id not in ids


@pytest.mark.django_db
def test_hidden_reconciled_history_does_not_scale_query_count(api_client, user, checking):
    post_transaction(
        user=user,
        account_id=checking.pk,
        date=date(2026, 8, 10),
        payee="Open",
        amount=Decimal("-10.00"),
    )
    api_client.force_authenticate(user=user)
    params = {
        "account": checking.id,
        "reconciled": "false",
        "date_before": AS_OF.isoformat(),
        "page_size": 2000,
    }
    with CaptureQueriesContext(connection) as small:
        resp = api_client.get("/api/transactions/", params)
    assert resp.status_code == 200
    small_n = len(resp.data["results"])
    small_sql = len(small.captured_queries)

    Transaction.objects.bulk_create(
        [
            Transaction(
                account=checking,
                date=date(2024, 1, 1) + timedelta(days=i % 200),
                payee=f"Hidden {i}",
                amount=Decimal("-1.00"),
                reconciled=True,
                status=Transaction.Status.CLEARED,
                source=Transaction.Source.ACTUAL,
            )
            for i in range(800)
        ],
        batch_size=200,
    )
    with CaptureQueriesContext(connection) as large:
        resp2 = api_client.get("/api/transactions/", params)
    assert resp2.status_code == 200
    large_n = len(resp2.data["results"])
    large_sql = len(large.captured_queries)
    assert large_n == small_n
    assert large_sql <= small_sql + 4, (
        f"hidden reconciled history increased SQL: {small_sql} -> {large_sql}"
    )
    returned_ids = {r["id"] for r in resp2.data["results"]}
    assert not Transaction.objects.filter(pk__in=returned_ids, reconciled=True).exists()
