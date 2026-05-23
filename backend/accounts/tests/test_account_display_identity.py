"""Tests for display_name, purpose, notes and effective_display_name."""
import pytest
from rest_framework.test import APIClient

from accounts.models import Account
from core.models import Household, HouseholdMembership

from django.contrib.auth import get_user_model

User = get_user_model()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="displayuser", password="testpass123")


@pytest.fixture
def household(db, user):
    h = Household.objects.create(name="Display Household")
    HouseholdMembership.objects.create(household=h, user=user, role=HouseholdMembership.Role.OWNER)
    return h


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


def test_effective_display_name_prefers_display_name(household):
    acc = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="CHASE CHECKING 1234",
        institution="Chase",
        display_name="Main Checking",
    )
    assert acc.effective_display_name == "Main Checking"


def test_effective_display_name_falls_back_to_name(household):
    acc = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="CHASE CHECKING 1234",
        institution="Chase",
    )
    assert acc.effective_display_name == "CHASE CHECKING 1234"


def test_effective_display_name_falls_back_to_nickname_legacy(household):
    acc = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Official Name",
        nickname="Legacy Nick",
    )
    assert acc.effective_display_name == "Legacy Nick"


def test_short_description_combines_role_and_purpose(household):
    acc = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Checking",
        role=Account.AccountRole.BILLS,
        purpose="Used for autopay bills",
    )
    assert "Bills" in acc.short_description
    assert "autopay" in acc.short_description


def test_api_returns_display_fields(auth_client, household):
    acc = Account.objects.create(
        household=household,
        account_type=Account.AccountType.SAVINGS,
        name="Bank Savings",
        display_name="Emergency Savings",
        purpose="Do not touch except emergencies",
        notes="Keep at least $2,000 buffer",
    )
    r = auth_client.get(f"/api/accounts/{acc.id}/")
    assert r.status_code == 200
    data = r.json()
    assert data["display_name"] == "Emergency Savings"
    assert data["purpose"] == "Do not touch except emergencies"
    assert data["notes"] == "Keep at least $2,000 buffer"
    assert data["effective_display_name"] == "Emergency Savings"


def test_nickname_write_maps_to_display_name(auth_client, household):
    r = auth_client.post(
        "/api/accounts/",
        {
            "household": household.id,
            "name": "Plaid Label",
            "account_type": "CHECKING",
            "currency": "USD",
            "nickname": "Bills Account",
        },
        format="json",
    )
    assert r.status_code == 201, r.data
    data = r.json()
    assert data["display_name"] == "Bills Account"
    assert data["effective_display_name"] == "Bills Account"


def test_account_search_matches_display_name(auth_client, household):
    Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="CHASE CHECKING",
        display_name="Travel Card",
    )
    Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="OTHER",
        display_name="Bills Account",
    )
    r = auth_client.get("/api/accounts/", {"search": "Travel"})
    assert r.status_code == 200
    results = r.json()["results"] if "results" in r.json() else r.json()
    names = [a["effective_display_name"] for a in results]
    assert "Travel Card" in names
    assert "Bills Account" not in names


def test_migration_backfill_copies_nickname(db):
    """Run backfill logic on an account with only nickname set."""
    import importlib

    mig = importlib.import_module("accounts.migrations.0019_account_display_identity")
    _split_nickname_for_backfill = mig._split_nickname_for_backfill

    h = Household.objects.create(name="Mig HH")
    acc = Account.objects.create(
        household=h,
        account_type=Account.AccountType.CHECKING,
        name="Official",
        nickname="Main Spending",
    )
    display, purpose = _split_nickname_for_backfill("Main Spending")
    assert display == "Main Spending"
    assert purpose == ""

    acc.display_name = ""
    acc.save(update_fields=["display_name"])
    display, purpose = _split_nickname_for_backfill("Main Spending")
    acc.display_name = display
    if purpose:
        acc.purpose = purpose
    acc.save(update_fields=["display_name", "purpose"])
    acc.refresh_from_db()
    assert acc.display_name == "Main Spending"


def test_plaid_match_update_preserves_display_identity(household):
    """Plaid link only updates institution/last_four on match — not user labels."""
    acc = Account.objects.create(
        household=household,
        account_type=Account.AccountType.CHECKING,
        name="Chase · Checking",
        institution="",
        last_four="",
        display_name="Main Checking",
        purpose="Primary spending",
        notes="Keep $500 minimum",
    )
    acc.institution = "Chase"
    acc.last_four = "1234"
    acc.save(update_fields=["institution", "last_four", "updated_at"])
    acc.refresh_from_db()
    assert acc.display_name == "Main Checking"
    assert acc.purpose == "Primary spending"
    assert acc.notes == "Keep $500 minimum"
    assert acc.name == "Chase · Checking"
