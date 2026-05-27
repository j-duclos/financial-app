"""Last activity date on account list/detail."""
from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Account
from core.models import Household, HouseholdMembership
from transactions.models import Transaction, TransactionMatch

User = get_user_model()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="lastact", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Last Activity HH")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


@pytest.fixture
def checking(db, household):
    return Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        currency="USD",
    )


def test_last_activity_date_from_latest_visible_transaction(auth_client, checking):
    Transaction.objects.create(
        account=checking,
        date=date(2025, 3, 1),
        payee="Old",
        amount=Decimal("-10"),
    )
    Transaction.objects.create(
        account=checking,
        date=date(2025, 5, 24),
        payee="Recent",
        amount=Decimal("-20"),
    )

    r = auth_client.get("/api/accounts/")
    assert r.status_code == 200
    row = next(x for x in r.json()["results"] if x["id"] == checking.id)
    assert row["last_activity_date"] == "2025-05-24"


def test_last_activity_date_excludes_matched_plaid_import(auth_client, checking):
    planned = Transaction.objects.create(
        account=checking,
        date=date(2025, 5, 20),
        payee="Planned rent",
        amount=Decimal("-500"),
        source=Transaction.Source.ONE_TIME,
    )
    imported = Transaction.objects.create(
        account=checking,
        date=date(2025, 5, 25),
        payee="PLAID RENT",
        amount=Decimal("-500"),
        source=Transaction.Source.PLAID,
        import_match_status=Transaction.ImportMatchStatus.MATCHED,
    )
    TransactionMatch.objects.create(
        planned_transaction=planned,
        imported_transaction=imported,
        match_type=TransactionMatch.MatchType.SAME_ACCOUNT,
        confidence=TransactionMatch.Confidence.AUTO,
        score=90,
    )

    r = auth_client.get(f"/api/accounts/{checking.id}/")
    assert r.status_code == 200
    assert r.json()["last_activity_date"] == "2025-05-20"


def test_last_activity_date_null_when_no_transactions(auth_client, checking):
    r = auth_client.get(f"/api/accounts/{checking.id}/")
    assert r.status_code == 200
    assert r.json()["last_activity_date"] is None
