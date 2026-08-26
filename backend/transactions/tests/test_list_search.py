"""Transaction list search filter."""
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
    return User.objects.create_user(username="search_filter_user", password="pass1234")


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
def test_list_transactions_search_payee_and_memo(api_client, user, account):
    api_client.force_authenticate(user=user)
    match = Transaction.objects.create(
        account=account,
        date=date(2026, 6, 1),
        payee="Coffee Shop Downtown",
        memo="Morning latte",
        amount=Decimal("-4.50"),
    )
    other = Transaction.objects.create(
        account=account,
        date=date(2026, 6, 2),
        payee="Grocery Store",
        memo="Weekly groceries",
        amount=Decimal("-80.00"),
    )

    payee_resp = api_client.get("/api/transactions/", {"account": account.id, "search": "coffee"})
    assert payee_resp.status_code == 200
    payee_ids = {r["id"] for r in payee_resp.data["results"]}
    assert match.id in payee_ids
    assert other.id not in payee_ids

    memo_resp = api_client.get("/api/transactions/", {"account": account.id, "search": "groceries"})
    assert memo_resp.status_code == 200
    memo_ids = {r["id"] for r in memo_resp.data["results"]}
    assert other.id in memo_ids
    assert match.id not in memo_ids
