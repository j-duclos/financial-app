"""AccountBalancesView must not N+1 signed balance queries."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import Account
from core.models import Household, HouseholdMembership
from transactions.services.posting import post_transaction

User = get_user_model()
AS_OF = date.today()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="acctbal", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Acct Bal HH")
    HouseholdMembership.objects.create(
        household=h, user=user, role=HouseholdMembership.Role.OWNER
    )
    return h


@pytest.fixture
def auth_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def test_account_balances_view_query_count_bounded(user, household, auth_client):
    for i in range(5):
        acc = Account.objects.create(
            household=household,
            account_type=Account.AccountType.CHECKING,
            role=Account.AccountRole.SPENDING,
            name=f"Checking {i}",
            starting_balance=Decimal("1000"),
            currency="USD",
        )
        post_transaction(user, acc.id, AS_OF, "Seed", Decimal("-10"))

    with CaptureQueriesContext(connection) as ctx:
        response = auth_client.get("/api/insights/account-balances/")
    assert response.status_code == 200
    assert len(response.json()["balances"]) == 5
    assert len(ctx.captured_queries) <= 12
