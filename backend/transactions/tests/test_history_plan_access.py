"""Historical transaction list is not plan-gated; forecast horizon still is."""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from accounts.models import Account
from billing.models import BillingSubscription
from billing.services import downgrade_to_free
from billing.tests.helpers import grant_premium
from transactions.models import Transaction
from transactions.services.posting import create_transfer

pytestmark = pytest.mark.django_db

OLD = date.today() - timedelta(days=120)
RECENT = date.today() - timedelta(days=10)


def _create_txn(account, **kwargs):
    payload = {
        "account": account,
        "date": OLD,
        "payee": "Old grocery",
        "amount": Decimal("-12.00"),
        "source": Transaction.Source.ACTUAL,
    }
    payload.update(kwargs)
    return Transaction.objects.create(**payload)


def _ids(response):
    assert response.status_code == 200, response.data
    return {row["id"] for row in response.data["results"]}


def test_free_user_can_retrieve_transactions_older_than_90_days(authenticated_client, account):
    manual = _create_txn(account, payee="Old manual")
    imported = _create_txn(
        account,
        payee="Old plaid",
        source=Transaction.Source.PLAID,
        plaid_transaction_id="pl-hist-old",
    )
    reconciled = _create_txn(account, payee="Old reconciled", reconciled=True)
    recent = _create_txn(account, date=RECENT, payee="Recent coffee")

    response = authenticated_client.get(
        "/api/transactions/",
        {
            "account": account.id,
            "date_before": date.today().isoformat(),
            "page_size": 50,
        },
    )
    ids = _ids(response)
    assert manual.id in ids
    assert imported.id in ids
    assert reconciled.id in ids
    assert recent.id in ids
    assert response.status_code != 403


def test_premium_user_can_retrieve_same_historical_transactions(
    authenticated_client, user, account
):
    grant_premium(user)
    old = _create_txn(account, payee="Premium old")
    response = authenticated_client.get(
        "/api/transactions/",
        {
            "account": account.id,
            "date_before": date.today().isoformat(),
            "page_size": 50,
        },
    )
    assert old.id in _ids(response)


def test_downgraded_user_retains_historical_transaction_access(
    authenticated_client, user, account, household
):
    billing = grant_premium(user)
    imported = _create_txn(
        account,
        payee="Imported while premium",
        source=Transaction.Source.PLAID,
        plaid_transaction_id="pl-hist-keep",
    )
    savings = Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        name="Savings",
        currency="USD",
    )
    xfer = create_transfer(
        user,
        account.id,
        savings.id,
        Decimal("80.00"),
        OLD,
        payee="Old transfer",
    )

    downgrade_to_free(billing, status="canceled")
    billing.refresh_from_db()
    assert billing.plan == BillingSubscription.Plan.FREE

    response = authenticated_client.get(
        "/api/transactions/",
        {
            "account": account.id,
            "date_before": date.today().isoformat(),
            "page_size": 50,
        },
    )
    ids = _ids(response)
    assert imported.id in ids
    assert xfer.from_transaction_id in ids


def test_historical_pagination_still_works_without_plan_cap(authenticated_client, account):
    rows = [
        _create_txn(account, payee=f"Old {i}", date=OLD - timedelta(days=i), amount=Decimal(f"-{i + 1}.00"))
        for i in range(3)
    ]
    page1 = authenticated_client.get(
        "/api/transactions/",
        {
            "account": account.id,
            "ordering": "date,id",
            "page": 1,
            "page_size": 2,
        },
    )
    page2 = authenticated_client.get(
        "/api/transactions/",
        {
            "account": account.id,
            "ordering": "date,id",
            "page": 2,
            "page_size": 2,
        },
    )
    assert page1.status_code == 200
    assert page2.status_code == 200
    assert len(page1.data["results"]) == 2
    assert page1.data["next"]
    page1_ids = [row["id"] for row in page1.data["results"]]
    page2_ids = [row["id"] for row in page2.data["results"]]
    assert set(page1_ids).isdisjoint(page2_ids)
    assert {row.id for row in rows} <= set(page1_ids + page2_ids)
