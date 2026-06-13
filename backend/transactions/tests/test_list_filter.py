"""Transaction list query filters."""
from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Account
from core.models import Household, HouseholdMembership
from transactions.models import Transaction

User = get_user_model()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="list_filter_user", password="pass1234")


@pytest.fixture
def account(db, user):
    h = Household.objects.create(name="H")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return Account.objects.create(
        household=h,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
    )


@pytest.mark.django_db
def test_list_transactions_reconciled_filter(api_client, user, account):
    api_client.force_authenticate(user=user)
    open_txn = Transaction.objects.create(
        account=account,
        date=date(2026, 6, 1),
        payee="Open",
        amount=Decimal("-10.00"),
        reconciled=False,
    )
    closed_txn = Transaction.objects.create(
        account=account,
        date=date(2026, 6, 2),
        payee="Closed",
        amount=Decimal("-20.00"),
        reconciled=True,
    )

    all_resp = api_client.get("/api/transactions/", {"account": account.id})
    assert all_resp.status_code == 200
    all_ids = {r["id"] for r in all_resp.data["results"]}
    assert open_txn.id in all_ids
    assert closed_txn.id in all_ids

    open_resp = api_client.get("/api/transactions/", {"account": account.id, "reconciled": "false"})
    assert open_resp.status_code == 200
    open_ids = {r["id"] for r in open_resp.data["results"]}
    assert open_txn.id in open_ids
    assert closed_txn.id not in open_ids

    closed_resp = api_client.get("/api/transactions/", {"account": account.id, "reconciled": "true"})
    assert closed_resp.status_code == 200
    closed_ids = {r["id"] for r in closed_resp.data["results"]}
    assert closed_txn.id in closed_ids
    assert open_txn.id not in closed_ids
